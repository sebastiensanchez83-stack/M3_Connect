import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import QRCode from "https://esm.sh/qrcode@1.5.4";

// Emails each attendee their personal on-site entry QR. The QR encodes the
// check-in URL (/admin/sm26/checkin?token=<badge checkin_token>); at the door a
// staff phone scans it to check that ONE person in. Staff-triggered. Badges must
// already exist (caller runs sm_ensure_badges first); attendees without a badge
// or email are skipped and reported.
//
// The QR used to be an <img> pointing at api.qrserver.com, rendered when the
// recipient opened the mail. That put the thing people need to get through the
// door behind a free third party AND behind the recipient's remote-image
// setting -- which most mail clients block by default. It is now generated here
// and attached to the message, so it travels with the mail and shows offline.
// The token is also printed as text, so staff can type it in if an image fails.
//
// Every send is written to sm_email_log (kind 'entry_qr'), so it is possible to
// answer "who has their pass" and to chase only the people who do not.

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
const isAllowed = (o) => ALLOWED_ORIGINS.includes(o) || NETLIFY_SUBDOMAIN.test(o);
const cors = (req) => ({
  "Access-Control-Allow-Origin": isAllowed(req.headers.get("origin") || "") ? req.headers.get("origin") : ALLOWED_ORIGINS[0],
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});
const json = (req, body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(req) } });

const one = (x) => (Array.isArray(x) ? (x[0] || null) : x);

// PNG bytes, base64, ready to attach. Same library the admin networking screen
// already uses, so the encoding is the one this platform has always produced.
//
// The knob that matters is how big each module ends up on the screen the door
// staff points a camera at. Widening the quiet zone was tried and measured
// against simulated camera blur: at a fixed displayed size it makes every
// module smaller and decodes slightly WORSE, so margin stays at 2. What does
// help is rendering larger (600px for a 240px display slot, so a phone at 2-3x
// still gets whole pixels per module) and pure black instead of the brand navy,
// since blur pulls dark toward the background and black has furthest to fall.
async function qrPngBase64(text: string): Promise<string> {
  const dataUrl: string = await QRCode.toDataURL(text, {
    margin: 2, width: 600, errorCorrectionLevel: "M",
    color: { dark: "#000000ff", light: "#ffffffff" },
  });
  return dataUrl.split(",")[1] || "";
}

function badgeHtml(firstName, company, checkinUrl, token) {
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
        <img src="cid:entryqr" alt="Entry QR code" width="240" height="240" style="border:1px solid #e5e7eb;border-radius:8px;padding:8px;background:#fff" />
      </p>
      <p style="font-size:13px;color:#6b7280;text-align:center">Keep this handy on your phone — you can screenshot it. It's unique to you.</p>
      <p style="font-size:12px;color:#9ca3af;text-align:center;margin-top:18px">If the code does not appear, show this reference to our team instead:<br><span style="font-family:monospace;font-size:13px;color:#374151;letter-spacing:1px">${token}</span></p>
    </div>
  </div>`;
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
  const { data: prof } = await admin.from("profiles").select("persona, access_status").eq("user_id", uid).maybeSingle();
  const p = prof;
  if (!p || !["admin", "moderator"].includes(p.persona || "") || p.access_status !== "verified")
    return json(req, { error: "Forbidden" }, 403);

  let body;
  try { body = await req.json(); } catch { return json(req, { error: "Invalid JSON" }, 400); }

  // Preview: prove the QR generator works and is scannable WITHOUT emailing
  // anybody. Returns the PNG so it can be decoded and checked.
  if (body.preview === true) {
    const sample = `${SITE_URL}/admin/sm26/checkin?token=preview0000000000000000000000000000`;
    try {
      const b64 = await qrPngBase64(sample);
      return json(req, { ok: true, preview: true, encodes: sample, png_base64: b64, bytes: Math.floor(b64.length * 3 / 4) });
    } catch (e) {
      return json(req, { error: `QR generation failed: ${String(e)}` }, 500);
    }
  }

  if (!RESEND_API_KEY) return json(req, { error: "Email is not configured (no RESEND_API_KEY)" }, 500);

  let q = admin.from("sm_attendee")
    .select("id, registration_id, event_id, first_name, last_name, email, registration:sm_registration!inner(status, company_name), badge:sm_badge(checkin_token)")
    .eq("attending", true);
  if (body.registration_id) q = q.eq("registration_id", body.registration_id);
  else if (body.event_id) q = q.eq("event_id", body.event_id);
  else return json(req, { error: "registration_id or event_id required" }, 400);

  const { data, error } = await q;
  if (error) return json(req, { error: error.message }, 500);
  const rows = data || [];

  // Skip anyone already sent, unless explicitly told to send again. Re-running
  // this used to mail everybody a second time with no way to tell.
  const resend = body.resend === true;
  const already = new Set<string>();
  if (!resend && rows.length) {
    const { data: log } = await admin.from("sm_email_log")
      .select("registration_id, to_email").eq("kind", "entry_qr")
      .in("registration_id", [...new Set(rows.map((r) => r.registration_id))]);
    for (const l of log || []) already.add(`${l.registration_id}|${(l.to_email || "").toLowerCase()}`);
  }

  let sent = 0, noEmail = 0, noBadge = 0, declined = 0, failed = 0, skippedSent = 0, qrFailed = 0;
  for (const r of rows) {
    const reg = one(r.registration);
    if (reg?.status === "declined" || reg?.status === "cancelled") { declined++; continue; }
    const email = (r.email || "").trim();
    if (!email) { noEmail++; continue; }
    const tok = one(r.badge)?.checkin_token;
    if (!tok) { noBadge++; continue; }
    if (!resend && already.has(`${r.registration_id}|${email.toLowerCase()}`)) { skippedSent++; continue; }

    const checkinUrl = `${SITE_URL}/admin/sm26/checkin?token=${tok}`;
    let png = "";
    try { png = await qrPngBase64(checkinUrl); } catch (e) { qrFailed++; console.error("qr failed", e); continue; }
    if (!png) { qrFailed++; continue; }

    try {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: SENDER_EMAIL,
          to: [email],
          subject: `Your entry pass — ${EVENT}`,
          html: badgeHtml(r.first_name || "", reg?.company_name || "", checkinUrl, tok),
          attachments: [{ filename: "entry-pass.png", content: png, content_type: "image/png", content_id: "entryqr" }],
        }),
      });
      if (resp.ok) {
        sent++;
        await admin.from("sm_email_log").insert({
          event_id: r.event_id, registration_id: r.registration_id,
          kind: "entry_qr", to_email: email, sent_by: uid,
        }).then(() => {}, (e) => console.error("entry_qr log failed", e));
      } else { failed++; console.error("resend failed", await resp.text()); }
    } catch (e) { failed++; console.error("send error", e); }
  }

  return json(req, { ok: true, sent, skipped: { no_email: noEmail, no_badge: noBadge, declined, already_sent: skippedSent }, qr_failed: qrFailed, failed });
});
