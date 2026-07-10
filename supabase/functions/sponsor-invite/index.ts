// Sponsor invite — set up a login for a sponsor contact who has no account yet
// (or find their existing one), grant them portal access (sp_sponsor_user), and
// email a magic link to set their password → they land on their Sponsorship tab.
// Staff-triggered (M3 admin/moderator OR a Yacht Club de Monaco manager).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SITE_URL = Deno.env.get("SITE_URL") || "https://smartmarinaconnect.com";

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

async function sendInviteEmail(email: string, firstName: string, company: string, link: string) {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const SENDER_EMAIL = Deno.env.get("SENDER_EMAIL") || "Smart Marina Connect <noreply@smartmarinaconnect.com>";
  if (!RESEND_API_KEY) { console.error("RESEND_API_KEY not set"); return false; }
  const greeting = firstName ? `Hello ${firstName},` : "Hello,";
  const html = `
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f5f7;padding:40px 20px;"><tr><td align="center">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06);">
<tr><td style="background:#0b2653;padding:32px 40px;text-align:center;">
<h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">Smart Marina Connect</h1>
<p style="margin:6px 0 0;color:#93c5fd;font-size:13px;">Sponsorship portal</p></td></tr>
<tr><td style="padding:40px;">
<p style="margin:0 0 8px;color:#374151;font-size:16px;">${greeting}</p>
<h2 style="margin:0 0 16px;color:#111827;font-size:20px;font-weight:600;">Your ${company ? `${company} ` : ""}sponsorship portal is ready</h2>
<p style="margin:0 0 28px;color:#4b5563;font-size:15px;line-height:1.6;">M3 has set up your Smart Marina Connect account. Click below to choose a password &mdash; you'll land on your sponsorship page, where you can see exactly what's included, track what we've delivered, and upload any assets we need from you.</p>
<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto;"><tr><td style="background:#0b2653;border-radius:8px;">
<a href="${link}" target="_blank" style="display:inline-block;padding:14px 32px;color:#fff;font-size:15px;font-weight:600;text-decoration:none;">Set my password &amp; open my portal</a>
</td></tr></table>
<p style="margin:28px 0 0;color:#9ca3af;font-size:13px;line-height:1.5;">If you weren't expecting this email, you can safely ignore it.</p>
</td></tr>
<tr><td style="padding:24px 40px;background:#f9fafb;border-top:1px solid #e5e7eb;text-align:center;">
<p style="margin:0;color:#9ca3af;font-size:12px;">Smart Marina Connect &middot; M3 Monaco</p></td></tr>
</table></td></tr></table></body></html>`.trim();
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: SENDER_EMAIL, to: [email], subject: "Your Smart Marina Connect sponsorship portal is ready", html }),
  });
  if (!res.ok) { console.error("Resend error", res.status, await res.text()); return false; }
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Gate: M3 admin/moderator OR a Yacht Club de Monaco manager (parity).
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "");
  if (!token) return json(req, { error: "Unauthorized" }, 401);
  const { data: u } = await admin.auth.getUser(token);
  const uid = u?.user?.id;
  if (!uid) return json(req, { error: "Unauthorized" }, 401);
  const { data: prof } = await admin.from("profiles").select("persona, access_status").eq("user_id", uid).maybeSingle();
  const p = prof as { persona?: string; access_status?: string } | null;
  let isManager = !!p && ["admin", "moderator"].includes(p.persona || "") && p.access_status === "verified";
  if (!isManager) {
    const { data: yc } = await admin.from("sm_event_partner").select("id").eq("user_id", uid).eq("kind", "yacht_club").limit(1).maybeSingle();
    isManager = !!yc;
  }
  if (!isManager) return json(req, { error: "Forbidden" }, 403);

  let body: { sponsor_id?: string; email?: string; first_name?: string; last_name?: string };
  try { body = await req.json(); } catch { return json(req, { error: "Invalid JSON" }, 400); }

  const email = (body.email || "").trim().toLowerCase();
  if (!body.sponsor_id || !email) return json(req, { error: "sponsor_id and email are required" }, 400);

  const { data: spData } = await admin.from("sp_sponsor").select("id, company_name, organization_id").eq("id", body.sponsor_id).maybeSingle();
  if (!spData) return json(req, { error: "Sponsor not found" }, 404);
  const sponsor = spData as { id: string; company_name: string; organization_id: string | null };

  // 1) Ensure an auth account.
  let userId: string | null = null;
  let createdAccount = false;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email, email_confirm: true,
    user_metadata: { first_name: body.first_name || "", last_name: body.last_name || "", persona: "partner", pw_pending: true },
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

  // 2) Verify a fresh account (never touch staff or an already-verified profile).
  const { data: tprof } = await admin.from("profiles").select("persona, access_status").eq("user_id", userId).maybeSingle();
  const tp = tprof as { persona?: string; access_status?: string } | null;
  if (tp && !["admin", "moderator"].includes(tp.persona || "") && tp.access_status !== "verified") {
    await admin.from("profiles").update({ persona: "partner", access_status: "verified", onboarding_status: "completed" }).eq("user_id", userId);
  }

  // 3) Optional org membership (so they show as a partner team member).
  if (sponsor.organization_id) {
    const { data: mem } = await admin.from("organization_members").select("id").eq("organization_id", sponsor.organization_id).eq("user_id", userId).maybeSingle();
    if (!mem) {
      const { data: owner } = await admin.from("organization_members").select("id").eq("organization_id", sponsor.organization_id).eq("role", "owner").limit(1).maybeSingle();
      await admin.from("organization_members").insert({ organization_id: sponsor.organization_id, user_id: userId, role: owner ? "collaborator" : "owner" });
    }
  }

  // 4) Grant sponsorship-portal access (per-person).
  await admin.from("sp_sponsor_user").upsert({ sponsor_id: sponsor.id, user_id: userId }, { onConflict: "sponsor_id,user_id" });

  // 5) Email a magic link → /welcome (set password) → their Sponsorship tab.
  const redirectTo = `${SITE_URL}/welcome?next=${encodeURIComponent("/account?tab=sponsorship")}`;
  let emailed = false;
  try {
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo } });
    if (linkErr) console.error("generateLink failed", linkErr);
    const actionLink = (linkData as { properties?: { action_link?: string } })?.properties?.action_link;
    if (actionLink) emailed = await sendInviteEmail(email, body.first_name || "", sponsor.company_name || "", actionLink);
  } catch (e) { console.error("invite email failed", e); }

  return json(req, { ok: true, user_id: userId, created_account: createdAccount, emailed });
});
