import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Emails a sponsor's contacts when M3 requests a deliverable asset from them
// (a sp_agreement_benefit moves to REQUESTED_FROM_SPONSOR). Staff-triggered from
// the sponsorship tracker. Recipients = the sponsor's primary contact + every
// linked portal user. Deep-links to their sponsor portal.

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
const isAllowed = (o) => ALLOWED_ORIGINS.includes(o) || NETLIFY_SUBDOMAIN.test(o);
const cors = (req) => ({
  "Access-Control-Allow-Origin": isAllowed(req.headers.get("origin") || "") ? req.headers.get("origin") : ALLOWED_ORIGINS[0],
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});
const json = (req, body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(req) } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });

  const token = (req.headers.get("authorization") || "").replace("Bearer ", "");
  if (!token) return json(req, { error: "Unauthorized" }, 401);
  const { data: u } = await admin.auth.getUser(token);
  const uid = u?.user?.id;
  if (!uid) return json(req, { error: "Unauthorized" }, 401);
  const { data: prof } = await admin.from("profiles").select("persona, access_status").eq("user_id", uid).maybeSingle();
  const p = prof;
  if (!p || !["admin", "moderator"].includes(p.persona || "") || p.access_status !== "verified")
    return json(req, { error: "Forbidden" }, 403);

  let body;
  try { body = await req.json(); } catch { return json(req, { error: "Invalid JSON" }, 400); }
  const benefitId = (body.benefit_id || "").trim();
  if (!benefitId) return json(req, { error: "benefit_id required" }, 400);

  // benefit -> agreement -> sponsor
  const { data: ben } = await admin.from("sp_agreement_benefit").select("id, name, agreement_id").eq("id", benefitId).maybeSingle();
  if (!ben) return json(req, { error: "Benefit not found" }, 404);
  const { data: agr } = await admin.from("sp_agreement").select("sponsor_id").eq("id", ben.agreement_id).maybeSingle();
  if (!agr) return json(req, { error: "Agreement not found" }, 404);
  const { data: sponsor } = await admin.from("sp_sponsor").select("company_name, primary_contact_email").eq("id", agr.sponsor_id).maybeSingle();
  if (!sponsor) return json(req, { error: "Sponsor not found" }, 404);

  // Recipients: primary contact + linked portal users.
  const emails = new Set();
  if (sponsor.primary_contact_email) emails.add(String(sponsor.primary_contact_email).trim().toLowerCase());
  const { data: links } = await admin.from("sp_sponsor_user").select("user_id").eq("sponsor_id", agr.sponsor_id);
  const userIds = (links || []).map((l) => l.user_id);
  if (userIds.length) {
    const { data: profs } = await admin.from("profiles").select("email").in("user_id", userIds);
    for (const pr of profs || []) if (pr.email) emails.add(String(pr.email).trim().toLowerCase());
  }
  const to = [...emails].filter(Boolean);
  if (to.length === 0) return json(req, { ok: true, sent: 0, skipped: "no recipient" });
  if (!RESEND_API_KEY) return json(req, { ok: true, sent: 0, skipped: "no RESEND_API_KEY" });

  const company = sponsor.company_name || "your sponsorship";
  const item = ben.name || "an asset";
  const portal = `${SITE_URL}/account?tab=sponsorship`;
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto">
    <div style="background:#0b2653;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
      <div style="font-size:13px;opacity:.7;text-transform:uppercase;letter-spacing:.5px">Smart Marina Connect</div>
      <div style="font-size:20px;font-weight:700;margin-top:4px">An asset is needed for your sponsorship</div>
    </div>
    <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px;color:#111827">
      <p>Hello,</p>
      <p>To fulfil <strong>${company}</strong>'s sponsorship, M3 needs the following from you: <strong>${item}</strong>.</p>
      <p>Please upload it (or paste a link) in your sponsor portal, where you can also see the full status of every entitlement.</p>
      <p style="text-align:center;margin:28px 0">
        <a href="${portal}" style="background:#0b2653;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600;display:inline-block">Open my sponsor portal</a>
      </p>
      <p style="font-size:12px;color:#6b7280">If you have any question, reply to this email or contact events@m3monaco.com.</p>
    </div>
  </div>`;

  let sent = 0, failed = 0;
  for (const addr of to) {
    try {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: SENDER_EMAIL, to: [addr], subject: `Asset needed for your sponsorship — ${company}`, html }),
      });
      if (resp.ok) sent++; else { failed++; console.error("resend failed", await resp.text()); }
    } catch (e) { failed++; console.error("send error", e); }
  }
  return json(req, { ok: true, sent, failed });
});
