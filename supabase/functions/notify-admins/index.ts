// Fan-out notification: sends an admin notification email to EVERY admin user
// (verified persona = 'admin') plus, by default, the contact inbox.
//
// Callers (checked 7 Oct 2026):
//   - other edge functions with the service-role key (claim-code-signup:
//     "new user signup" after a claim-code sign-up). Trusted as before.
//   - the browser via notifyAdmin() in src/lib/notifications.ts:
//       * "new user signup" (AuthContext.signUp) -- runs BEFORE any session
//         exists when "Confirm email" is on. The browser only sends the new
//         address; everything in the e-mail is read here from the account that
//         was just created (< 30 min old), and each account alerts once.
//       * "Webinar Proposal", "RFP", "Project", "Consultation" (submit pages) --
//         signed-in members only; the real sender's sign-in address is appended.
//
// Security (audit S4, 7 Oct 2026): this function used to be public, forward any
// caller text to every admin and answer with the full list of admin addresses.
// Now: an unauthenticated caller can only trigger the server-built sign-up alert
// for a just-created account; free text needs a signed-in member or the service
// role; fields are capped (send-notification HTML-escapes them); members are
// limited to 10 alerts an hour; the response never contains recipients.
// verify_jwt stays false (the sign-up alert has no session; the function checks
// its callers itself).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://smartmarinaconnect.com",
  "https://m3connect.netlify.app",
  "http://localhost:5173",
  "http://localhost:3000",
];

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const CONTACT_INBOX = "contact@smartmarinaconnect.com";

const SIGNUP_WINDOW_MS = 30 * 60 * 1000;
const MEMBER_HOURLY_CAP = 10;

// Submission types the browser may send for a signed-in member (case-insensitive
// key -> label used in the e-mail).
const MEMBER_SUBMISSION_TYPES: Record<string, string> = {
  "webinar proposal": "Webinar Proposal",
  "rfp": "RFP",
  "project": "Project",
  "consultation": "Consultation",
};

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function sameSecret(a: string, b: string): boolean {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** Plain text field: strip control characters (newlines kept when asked), cap length. */
function clean(v: unknown, max: number, keepNewlines = false): string {
  if (typeof v !== "string" && typeof v !== "number") return "";
  let s = String(v);
  // deno-lint-ignore no-control-regex
  s = keepNewlines ? s.replace(/(?!\n)\p{Cc}/gu, "") : s.replace(/\p{Cc}+/gu, " ");
  return s.trim().slice(0, max);
}

function isEmail(s: string): boolean {
  return s.length <= 254 && /^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[^\s@<>()",;:\\]+$/.test(s);
}

// deno-lint-ignore no-explicit-any
type Db = any;

/** Fan out one admin_new_submission e-mail per recipient through send-notification. */
async function fanOut(db: Db, payload: { submission_type: string; submitter: string; details: string }, includeInbox: boolean): Promise<void> {
  // Only VERIFIED admins: a pending account with persona 'admin' is not staff
  // (is_admin() = is_verified('admin')) and must not receive sign-up details.
  const { data: adminProfiles, error } = await db
    .from("profiles")
    .select("email")
    .eq("persona", "admin")
    .eq("access_status", "verified")
    .not("email", "is", null);
  if (error) throw new Error(`admin lookup failed: ${error.message}`);

  const recipients = new Set<string>();
  for (const p of (adminProfiles || []) as { email: string | null }[]) {
    if (p.email) recipients.add(String(p.email).trim().toLowerCase());
  }
  if (includeInbox) recipients.add(CONTACT_INBOX);

  const results = await Promise.all(
    Array.from(recipients).map((email) =>
      fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
          "apikey": SERVICE_ROLE_KEY!,
        },
        body: JSON.stringify({ type: "admin_new_submission", email, data: payload }),
      })
        .then(async (r) => { await r.body?.cancel(); return r.ok; })
        .catch(() => false)
    ),
  );
  const failed = results.filter((ok) => !ok).length;
  if (failed) console.error(`notify-admins: ${failed}/${results.length} sends failed`);
}

/** Rate-log helper (public.email_rate_log, service role only). Fails open. */
async function countRecent(db: Db, actorId: string, kind: string, sinceIso: string | null): Promise<number> {
  try {
    let q = db.from("email_rate_log").select("id", { count: "exact", head: true }).eq("actor_id", actorId).eq("kind", kind);
    if (sinceIso) q = q.gte("created_at", sinceIso);
    const { count, error } = await q;
    if (error) throw error;
    return count || 0;
  } catch (e) {
    console.error("notify-admins: rate log unavailable, continuing:", (e as { message?: string })?.message || String(e));
    return 0;
  }
}

async function logSend(db: Db, actorId: string, kind: string): Promise<void> {
  const { error } = await db.from("email_rate_log").insert({ actor_id: actorId, kind });
  if (error) console.error("notify-admins: rate log insert failed:", error.message);
}

Deno.serve(async (req: Request) => {
  const headers = { "Content-Type": "application/json", ...corsHeaders(req) };
  const reply = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers });

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return reply({ error: "Server not configured" }, 500);
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return reply({ error: "Invalid JSON body" }, 400);

    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();

    // ── 1. Service role (other edge functions): trusted, fields capped. ──
    if (sameSecret(bearer, SERVICE_ROLE_KEY)) {
      const submission_type = clean(body.submission_type, 100);
      if (!submission_type) return reply({ error: "submission_type is required" }, 400);
      await fanOut(db, {
        submission_type,
        submitter: clean(body.submitter, 200) || "a user",
        details: clean(body.details, 2000, true),
      }, body.include_contact_inbox !== false);
      return reply({ success: true }, 200);
    }

    // ── 2. Sign-up alert: no session needed, nothing taken from the caller but
    //       the address. Always answers the same, so it reveals nothing about
    //       which addresses have accounts. ──
    if (typeof body.signup_email === "string") {
      const email = clean(body.signup_email, 254).toLowerCase();
      if (!isEmail(email)) return reply({ success: true }, 200);
      const since = new Date(Date.now() - SIGNUP_WINDOW_MS).toISOString();
      const { data: profs } = await db
        .from("profiles")
        .select("user_id, first_name, last_name, persona, job_title, email, created_at")
        .eq("email", email)
        .gte("created_at", since)
        .limit(5);
      for (const p of (profs || []) as {
        user_id: string; first_name: string | null; last_name: string | null; persona: string | null;
        job_title: string | null; email: string | null;
      }[]) {
        // The account itself (not the editable profile) must carry this address
        // and be new.
        const { data: authData } = await db.auth.admin.getUserById(p.user_id);
        const u = authData?.user;
        if (!u?.email || u.email.toLowerCase() !== email) continue;
        if (!u.created_at || Date.parse(u.created_at) < Date.now() - SIGNUP_WINDOW_MS) continue;
        if ((await countRecent(db, u.id, "notify-admins:signup", null)) > 0) break;
        await logSend(db, u.id, "notify-admins:signup");

        const meta = (u.user_metadata || {}) as Record<string, unknown>;
        const fullName = [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || email;
        const details = [
          `Email: ${email}`,
          `Persona: ${p.persona || "unknown"}`,
          p.job_title ? `Job title: ${clean(p.job_title, 200)}` : "",
          meta.company_name ? `Company: ${clean(meta.company_name, 200)}` : "",
          meta.company_website ? `Website: ${clean(meta.company_website, 300)}` : "",
        ].filter(Boolean).join("\n");
        await fanOut(db, { submission_type: "new user signup", submitter: clean(fullName, 200), details }, true);
        break;
      }
      return reply({ success: true }, 200);
    }

    // ── 3. Signed-in member: allowed submission types only. ──
    if (!bearer) return reply({ error: "Unauthorized" }, 401);
    const { data: callerData } = await db.auth.getUser(bearer);
    const caller = callerData?.user;
    if (!caller?.id) return reply({ error: "Unauthorized" }, 401);

    const label = MEMBER_SUBMISSION_TYPES[clean(body.submission_type, 100).toLowerCase()];
    if (!label) return reply({ error: "Unknown submission type" }, 400);

    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    if ((await countRecent(db, caller.id, "notify-admins:member", hourAgo)) >= MEMBER_HOURLY_CAP) {
      return reply({ error: "Too many notifications, try again later" }, 429);
    }
    await logSend(db, caller.id, "notify-admins:member");

    const details = [
      clean(body.details, 1500, true),
      `Sent by: ${caller.email || "unknown address"} (account ${caller.id})`,
    ].filter(Boolean).join("\n\n");
    await fanOut(db, {
      submission_type: label,
      submitter: clean(body.submitter, 200) || "a member",
      details,
    }, true);
    return reply({ success: true }, 200);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("notify-admins error:", message);
    return reply({ error: "Internal error" }, 500);
  }
});
