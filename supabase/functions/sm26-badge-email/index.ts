import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Emails each attendee their personal on-site entry QR. The QR encodes the
// check-in URL (/admin/sm26/checkin?token=<badge checkin_token>); at the door a
// staff phone scans it (in-app scanner or native camera while signed in) to
// check that ONE person in. Staff-triggered. Badges must already exist — the
// caller runs sm_ensure_badges first; attendees without a badge (e.g. jury who
// didn't opt onsite) or without an email are skipped and reported.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SITE_URL = Deno.env.get("SITE_URL") || "https://smartmarinaconnect.com";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const SENDER_EMAIL = Deno.env.get("SENDER_EMAIL") || "Smart Marina Connect <noreply@smartmarinaconnect.com>";

const EVENT = "Smart & Sustainable Marina Rendezvous 2026";
const WHEN = "20–21 September 2026, Yacht Club de Monaco";

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

interface Row {
  id: string; first_name: string | null; last_name: string | null; email: string | null;
  registration: { status?: string; company_name?: string } | { status?: string; company_name?: string }[] | null;
  badge: { checkin_token?: string } | { checkin_token?: string }[] | null;
}
const one = <T,>(x: T[] | T | null): T | null => (Array.isArray(x) ? (x[0] || null) : x);

function badgeHtml(firstName: string, company: string, checkinUrl: string): string {
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=10&data=${encodeURIComponent(checkinUrl)}`;
  const hi = firstName ? `Dear ${firstName},` : "Hello,";
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto">
    <div style="background:#0b2653;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
      <div style="font-size:13px;opacity:.7;text-transform:uppercase;letter-spacing:.5px">${EVENT}</div>
      <div style="font-size:20px;font-weight:700;margin-top:4px">Your entry pass</div>
    </div>
    <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px;color:#111827">
      <p>${hi}</p>
      <p>Here is your personal entry pass for the <strong>${EVENT}</strong> (${WHEN})${company ? ` — attending with <strong>${company}</strong>` : ""}. Show this QR code at check-in; our team will scan it to admit you.</p>
      <p style="text-align:center;margin:24px 0">
        <img src="${qr}" alt="Entry QR code" width="240" height="240" style="border:1px solid #e5e7eb;border-radius:8px;padding:8px;background:#fff" />
      </p>
      <p style="font-size:13px;color:#6b7280;text-align:center">Keep this handy on your phone — you can screenshot it. It's unique to you.</p>
    </div>
  </div>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });

  // Staff only.
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "");
  if (!token) return json(req, { error: "Unauthorized" }, 401);
  const { data: u } = await admin.auth.getUser(token);
  const uid = u?.user?.id;
  if (!uid) return json(req, { error: "Unauthorized" }, 401);
  const { data: prof } = await admin.from("profiles").select("persona, access_status").eq("user_id", uid).maybeSingle();
  const p = prof as { persona?: string; access_status?: string } | null;
  if (!p || !["admin", "moderator"].includes(p.persona || "") || p.access_status !== "verified")
    return json(req, { error: "Forbidden" }, 403);

  if (!RESEND_API_KEY) return json(req, { error: "Email is not configured (no RESEND_API_KEY)" }, 500);

  let body: { registration_id?: string; event_id?: string; all?: boolean };
  try { body = await req.json(); } catch { return json(req, { error: "Invalid JSON" }, 400); }

  let q = admin.from("sm_attendee")
    .select("id, first_name, last_name, email, registration:sm_registration!inner(status, company_name), badge:sm_badge(checkin_token)")
    .eq("attending", true);
  if (body.registration_id) q = q.eq("registration_id", body.registration_id);
  else if (body.event_id) q = q.eq("event_id", body.event_id);
  else return json(req, { error: "registration_id or event_id required" }, 400);

  const { data, error } = await q;
  if (error) return json(req, { error: error.message }, 500);
  const rows = (data || []) as Row[];

  let sent = 0, noEmail = 0, noBadge = 0, declined = 0, failed = 0;
  for (const r of rows) {
    const reg = one(r.registration);
    if (reg?.status === "declined" || reg?.status === "cancelled") { declined++; continue; }
    const email = (r.email || "").trim();
    if (!email) { noEmail++; continue; }
    const tok = one(r.badge)?.checkin_token;
    if (!tok) { noBadge++; continue; }
    const checkinUrl = `${SITE_URL}/admin/sm26/checkin?token=${tok}`;
    try {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: SENDER_EMAIL, to: [email], subject: `Your entry pass — ${EVENT}`, html: badgeHtml(r.first_name || "", reg?.company_name || "", checkinUrl) }),
      });
      if (resp.ok) sent++; else { failed++; console.error("resend failed", await resp.text()); }
    } catch (e) { failed++; console.error("send error", e); }
  }

  return json(req, { ok: true, sent, skipped: { no_email: noEmail, no_badge: noBadge, declined }, failed });
});
