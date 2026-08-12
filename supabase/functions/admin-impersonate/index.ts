import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// "View as user": mints a real session for a target user so an ADMIN can see and
// do exactly what that user sees. Guardrails: caller must be a verified admin
// (not merely a moderator); the target must NOT be staff; every start is logged
// to admin_impersonation_log. The admin's client swaps to the returned session
// and shows an "impersonating" banner with a one-click return.
//
// IMPORTANT, learned the hard way on 30 July 2026: minting the session below
// calls generateLink({type:'magiclink'}), and Supabase stores magic-link and
// password-recovery tokens in the SAME slot -- auth.one_time_tokens keeps one
// row per (user_id, token_type) and the type is 'recovery_token' for both. So
// impersonating somebody DESTROYS the password-reset link they were just
// emailed. A participant spent a morning clicking dead links for exactly this
// reason: an impersonation at 09:41:12 was followed at 09:55:25 by her click
// returning 403 "One-time token not found". The probe below refuses to
// impersonate anyone with an outstanding link unless the admin says otherwise.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

const ALLOWED_ORIGINS = [
  "https://smartmarinaconnect.com", "https://m3connect.netlify.app", "https://m3connectv2.netlify.app",
  "http://localhost:5173", "http://localhost:3000",
];
const NETLIFY_SUBDOMAIN = /^https:\/\/[a-z0-9-]+--m3connect(v2)?\.netlify\.app$/;
const isAllowed = (o) => ALLOWED_ORIGINS.includes(o) || NETLIFY_SUBDOMAIN.test(o);
const cors = (req) => ({
  "Access-Control-Allow-Origin": isAllowed(req.headers.get("origin") || "") ? req.headers.get("origin") : ALLOWED_ORIGINS[0],
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});
const json = (req, body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(req) } });

function ago(mins: number): string {
  if (mins < 1) return "less than a minute ago";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} ago`;
  return `${Math.round(h / 24)} days ago`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });

  const token = (req.headers.get("authorization") || "").replace("Bearer ", "");
  if (!token) return json(req, { error: "Unauthorized" }, 401);
  const { data: u } = await admin.auth.getUser(token);
  const uid = u?.user?.id;
  if (!uid) return json(req, { error: "Unauthorized" }, 401);

  // Caller must be a verified ADMIN (impersonation is not granted to moderators).
  const { data: caller } = await admin.from("profiles").select("persona, access_status").eq("user_id", uid).maybeSingle();
  const c = caller;
  if (!c || c.persona !== "admin" || c.access_status !== "verified") return json(req, { error: "Forbidden" }, 403);

  let body;
  try { body = await req.json(); } catch { return json(req, { error: "Invalid JSON" }, 400); }
  const targetId = (body.target_user_id || "").trim();
  if (!targetId) return json(req, { error: "target_user_id required" }, 400);
  if (targetId === uid) return json(req, { error: "Cannot impersonate yourself" }, 400);

  const { data: target } = await admin.from("profiles").select("persona, access_status, email, first_name, last_name").eq("user_id", targetId).maybeSingle();
  const t = target;
  if (!t) return json(req, { error: "User not found" }, 404);
  if (["admin", "moderator"].includes(t.persona || "")) return json(req, { error: "Cannot impersonate another staff member" }, 403);
  const email = (t.email || "").trim();
  if (!email) return json(req, { error: "This user has no email on file" }, 400);
  const who = `${t.first_name || ""} ${t.last_name || ""}`.trim() || email;

  // Look before leaping: if this person is holding an unused password-reset or
  // welcome link, starting here would silently kill it. Reported as ok:false
  // rather than a non-2xx so the browser client gets a body it can branch on.
  if (body.force !== true) {
    const { data: probe, error: probeErr } = await admin.rpc("admin_pending_recovery", { p_user_id: targetId });
    if (probeErr) console.error("admin_pending_recovery failed", probeErr);
    const p = probe as { pending?: boolean; age_minutes?: number } | null;
    if (p?.pending) {
      const mins = p.age_minutes ?? 0;
      return json(req, {
        ok: false,
        code: "pending_recovery",
        age_minutes: mins,
        error: `${who} asked for a password link ${ago(mins)} and has not used it yet. Viewing as them now would cancel that link and they would have to start again. Wait until they are in, or continue and send them a fresh link afterwards.`,
        target: { email, name: who },
      });
    }
  }

  // Audit the start (best-effort; do not block on a log failure).
  await admin.from("admin_impersonation_log").insert({ admin_user_id: uid, target_user_id: targetId, target_email: email }).then(() => {}, () => {});

  // Mint a session for the target: generate a magic-link token, then verify it
  // with an anon client to obtain access + refresh tokens (no email is sent).
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const hashed = link?.properties?.hashed_token;
  if (linkErr || !hashed) { console.error("generateLink failed", linkErr); return json(req, { error: "Could not start impersonation" }, 500); }

  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: verified, error: verErr } = await anon.auth.verifyOtp({ token_hash: hashed, type: "magiclink" });
  const session = verified?.session;
  if (verErr || !session?.access_token || !session?.refresh_token) { console.error("verifyOtp failed", verErr); return json(req, { error: "Could not start impersonation" }, 500); }

  return json(req, {
    ok: true,
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    target: { email, name: who },
  });
});
