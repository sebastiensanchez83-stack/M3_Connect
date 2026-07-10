import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Invite ONE attendee (from a company's SM26 roster) to a real platform account.
// Idempotent by email: creates the account or links an existing one, adds them
// to the company's organization, tags sm_attendee.user_id, and emails a
// set-password / welcome link. Callable by staff OR by the registration's
// owner / org-member (so a company can onboard its own delegation).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SITE_URL = Deno.env.get("SITE_URL") || "https://smartmarinaconnect.com";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const SENDER_EMAIL = Deno.env.get("SENDER_EMAIL") || "Smart Marina Connect <noreply@smartmarinaconnect.com>";

const ALLOWED_ORIGINS = [
  "https://smartmarinaconnect.com", "https://m3connect.netlify.app", "https://m3connectv2.netlify.app",
  "http://localhost:5173", "http://localhost:3000",
];
const NETLIFY_SUBDOMAIN = /^https:\/\/[a-z0-9-]+--m3connect(v2)?\.netlify\.app$/;
const isAllowed = (o: string) => ALLOWED_ORIGINS.includes(o) || NETLIFY_SUBDOMAIN.test(o);
const cors = (req: Request) => ({
  "Access-Control-Allow-Origin": isAllowed(req.headers.get("origin") || "") ? (req.headers.get("origin") as string) : ALLOWED_ORIGINS[0],
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(req) } });

async function sendWelcomeEmail(email: string, firstName: string, link: string): Promise<boolean> {
  if (!RESEND_API_KEY) return false;
  const hi = firstName ? `Hi ${firstName},` : "Hello,";
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto">
    <div style="background:#0b2653;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
      <div style="font-size:13px;opacity:.7;text-transform:uppercase;letter-spacing:.5px">Smart &amp; Sustainable Marina Rendezvous 2026</div>
      <div style="font-size:20px;font-weight:700;margin-top:4px">You're on the attendee list</div>
    </div>
    <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px;color:#111827">
      <p>${hi}</p>
      <p>Your company has added you as an attendee for the <strong>Smart &amp; Sustainable Marina Rendezvous 2026</strong> (20–21 September, Yacht Club de Monaco). Set your password to open your event hub — your badge and programme live there.</p>
      <p style="text-align:center;margin:28px 0">
        <a href="${link}" style="background:#0b2653;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600;display:inline-block">Set my password &amp; open my event hub</a>
      </p>
      <p style="font-size:12px;color:#6b7280">If you didn't expect this, you can ignore this email.</p>
    </div>
  </div>`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: SENDER_EMAIL, to: [email], subject: "Your Smart Marina Connect account is ready", html }),
    });
    return res.ok;
  } catch (_e) { return false; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });

  // Authn: who is calling?
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "");
  if (!token) return json(req, { error: "Unauthorized" }, 401);
  const { data: u } = await admin.auth.getUser(token);
  const uid = u?.user?.id;
  if (!uid) return json(req, { error: "Unauthorized" }, 401);

  let body: { attendee_id?: string; send_email?: boolean };
  try { body = await req.json(); } catch { return json(req, { error: "Invalid JSON" }, 400); }
  const attendeeId = (body.attendee_id || "").trim();
  if (!attendeeId) return json(req, { error: "attendee_id required" }, 400);
  const sendEmail = body.send_email !== false;

  // Load the attendee + its registration (for the company org + access check).
  const { data: att } = await admin.from("sm_attendee")
    .select("id, registration_id, event_id, first_name, last_name, email, job_title, user_id, is_primary")
    .eq("id", attendeeId).maybeSingle();
  const a = att as { id: string; registration_id: string; event_id: string; first_name?: string; last_name?: string; email?: string; job_title?: string; user_id?: string } | null;
  if (!a) return json(req, { error: "Attendee not found" }, 404);
  const email = (a.email || "").trim().toLowerCase();
  if (!email) return json(req, { error: "This attendee has no email — add one first" }, 400);

  const { data: regRow } = await admin.from("sm_registration")
    .select("id, user_id, organization_id, first_name").eq("id", a.registration_id).maybeSingle();
  const reg = regRow as { id: string; user_id?: string; organization_id?: string; first_name?: string } | null;
  if (!reg) return json(req, { error: "Registration not found" }, 404);

  // Authz: staff, OR the registration owner, OR a member of its org.
  const { data: caller } = await admin.from("profiles").select("persona, access_status").eq("user_id", uid).maybeSingle();
  const cp = caller as { persona?: string; access_status?: string } | null;
  const isStaff = !!cp && ["admin", "moderator"].includes(cp.persona || "") && cp.access_status === "verified";
  let allowed = isStaff || reg.user_id === uid;
  if (!allowed && reg.organization_id) {
    const { data: mem } = await admin.from("organization_members")
      .select("id").eq("organization_id", reg.organization_id).eq("user_id", uid).maybeSingle();
    allowed = !!mem;
  }
  if (!allowed) return json(req, { error: "Forbidden" }, 403);

  // Idempotent account: reuse the attendee's link, else create, else find by email.
  let userId = a.user_id || null;
  let createdAccount = false;
  if (!userId) {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email, email_confirm: true,
      user_metadata: { first_name: a.first_name || "", last_name: a.last_name || "", job_title: a.job_title || "", persona: "individual", pw_pending: true },
    });
    if (createErr) {
      const msg = (createErr.message || "").toLowerCase();
      const exists = (createErr as { code?: string }).code === "email_exists" || msg.includes("already");
      if (!exists) { console.error("createUser failed", createErr); return json(req, { error: "Could not create the account" }, 500); }
      const { data: existing } = await admin.from("profiles").select("user_id").ilike("email", email).maybeSingle();
      userId = (existing as { user_id?: string } | null)?.user_id || null;
      if (!userId) return json(req, { error: "An auth user exists for this email but has no profile — resolve in Supabase" }, 409);
    } else {
      userId = created.user!.id;
      createdAccount = true;
    }
  }

  // Only bootstrap the profile for a BRAND-NEW account — never demote an existing
  // marina/partner/etc. to 'individual'.
  if (createdAccount) {
    const { error: profErr } = await admin.from("profiles")
      .update({ persona: "individual", access_status: "verified", onboarding_status: "completed" })
      .eq("user_id", userId);
    if (profErr) console.error("profile bootstrap failed", profErr);
  }

  // Add to the company organization (owner if none yet, else collaborator).
  if (reg.organization_id) {
    const { data: existingMem } = await admin.from("organization_members")
      .select("id").eq("organization_id", reg.organization_id).eq("user_id", userId).maybeSingle();
    if (!existingMem) {
      const { data: hasOwner } = await admin.from("organization_members")
        .select("id").eq("organization_id", reg.organization_id).eq("role", "owner").limit(1).maybeSingle();
      const { error: memErr } = await admin.from("organization_members")
        .insert({ organization_id: reg.organization_id, user_id: userId, role: hasOwner ? "collaborator" : "owner" });
      if (memErr && (memErr as { code?: string }).code !== "23505") console.error("membership failed", memErr);
    }
  }

  // Tag the attendee with the resolved account.
  if (a.user_id !== userId) {
    const { error: linkErr } = await admin.from("sm_attendee").update({ user_id: userId, updated_at: new Date().toISOString() }).eq("id", a.id);
    if (linkErr) console.error("attendee link failed", linkErr);
  }

  // If this is the primary attendee (the registration contact), link the
  // registration to the account too, so it stops showing as "no account".
  if (a.is_primary && !reg.user_id) {
    const { error: regLinkErr } = await admin.from("sm_registration").update({ user_id: userId }).eq("id", a.registration_id).is("user_id", null);
    if (regLinkErr) console.error("registration link failed", regLinkErr);
  }

  // Welcome / set-password email (fire-and-forget).
  let emailed = false;
  if (sendEmail) {
    try {
      const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
        type: "magiclink", email, options: { redirectTo: `${SITE_URL}/welcome?next=${encodeURIComponent("/account?tab=event")}` },
      });
      if (linkErr) console.error("generateLink failed", linkErr);
      const actionLink = (linkData as { properties?: { action_link?: string } })?.properties?.action_link;
      if (actionLink) emailed = await sendWelcomeEmail(email, a.first_name || "", actionLink);
    } catch (e) { console.error("welcome email failed", e); }
  }

  return json(req, { ok: true, user_id: userId, created_account: createdAccount, emailed });
});
