import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Emails each attending person the link to the post-event feedback form.
// Staff-triggered from Admin → SM26 → Feedback. Nothing sends this on a
// schedule: feedback goes out once the organiser decides the event is over.
//
// Two things shape this mail:
//
// 1. It links to /sm26, NOT to /sm26/feedback. The form is behind
//    ProtectedRoute, and a logged-out visitor opening it is bounced to the
//    home page with the destination forgotten. /sm26 is public (it is the
//    address printed on every badge QR), and its "Your feedback" tile opens a
//    sign-in that returns to the form. Same click count for people who are
//    signed in, no dead end for those who are not.
//
// 2. Answering needs an account, and on SM26 about 40% of the people on site
//    were added from the organiser's own list and never had one. They cannot
//    be silently dropped, so the mail offers the reply-to as a way in: a
//    human reads it. reply_to is set for exactly that reason.
//
// Recipients are ATTENDEES (each named person), not registration contacts —
// the same list the entry passes went to, minus the organising team, whose
// answers would otherwise land in the published averages.
//
// Every send is written to sm_email_log (kind 'feedback'), so a second run
// chases only the people who have not been asked yet.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SITE_URL = Deno.env.get("SITE_URL") || "https://smartmarinaconnect.com";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const SENDER_EMAIL = Deno.env.get("SENDER_EMAIL") || "Smart Marina Connect <noreply@smartmarinaconnect.com>";
const REPLY_TO = "contact@smartmarinaconnect.com";

const EVENT = "Smart & Sustainable Marina Rendezvous 2026";
const KIND = "feedback";
// The organising team attends too; their ratings would skew the report.
const STAFF_DOMAIN = "@m3monaco.com";

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

function feedbackHtml(firstName) {
  const hi = firstName ? `Dear ${firstName},` : "Hello,";
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto">
    <div style="background:#0b2653;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
      <div style="font-size:13px;opacity:.7;text-transform:uppercase;letter-spacing:.5px">${EVENT}</div>
      <div style="font-size:20px;font-weight:700;margin-top:4px">How was it for you?</div>
    </div>
    <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px;color:#111827">
      <p>${hi}</p>
      <p>Thank you for being with us at the <strong>${EVENT}</strong>, at the Yacht Club de Monaco.</p>
      <p>We would like to know how it went for you — the sessions, the people you met, what was missing. It takes about five minutes, and it genuinely shapes the next edition.</p>
      <p style="text-align:center;margin:28px 0">
        <a href="${SITE_URL}/sm26" style="background:#0b2653;color:#fff;text-decoration:none;padding:13px 26px;border-radius:8px;font-weight:700;display:inline-block">Give my feedback</a>
      </p>
      <p style="font-size:13px;color:#6b7280">The button opens the event page — the same address as the QR code on your badge. Tap <strong>Your feedback</strong> there and sign in with this email address.</p>
      <p style="font-size:13px;color:#6b7280">No account, or would rather not create one? Just <strong>reply to this email</strong> and tell us in your own words — someone reads every answer.</p>
      <p style="margin-top:22px">Thank you,<br>The Monaco Marina Management team</p>
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
  if (!prof || !["admin", "moderator"].includes(prof.persona || "") || prof.access_status !== "verified")
    return json(req, { error: "Forbidden" }, 403);

  let body;
  try { body = await req.json(); } catch { return json(req, { error: "Invalid JSON" }, 400); }
  if (!RESEND_API_KEY) return json(req, { error: "Email is not configured (no RESEND_API_KEY)" }, 500);

  const send = async (to: string, firstName: string) => {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: SENDER_EMAIL,
        to: [to],
        reply_to: REPLY_TO,
        subject: `How was it? — ${EVENT}`,
        html: feedbackHtml(firstName),
      }),
    });
    if (!resp.ok) throw new Error(await resp.text());
  };

  // A staff member can post the real thing to themselves first; nothing is logged.
  if (body.test_email) {
    try {
      await send(String(body.test_email), String(body.test_first_name || ""));
      return json(req, { ok: true, test: true, to: body.test_email });
    } catch (e) {
      return json(req, { error: `Send failed: ${String(e)}` }, 500);
    }
  }

  if (!body.event_id) return json(req, { error: "event_id required" }, 400);

  const { data, error } = await admin.from("sm_attendee")
    .select("id, registration_id, event_id, first_name, email, registration:sm_registration!inner(status)")
    .eq("event_id", body.event_id)
    .eq("attending", true);
  if (error) return json(req, { error: error.message }, 500);
  const rows = data || [];

  const resend = body.resend === true;
  const already = new Set<string>();
  if (!resend && rows.length) {
    const { data: log } = await admin.from("sm_email_log")
      .select("registration_id, to_email").eq("kind", KIND)
      .in("registration_id", [...new Set(rows.map((r) => r.registration_id))]);
    for (const l of log || []) already.add(`${l.registration_id}|${(l.to_email || "").toLowerCase()}`);
  }

  let sent = 0, noEmail = 0, notConfirmed = 0, staff = 0, skippedSent = 0, failed = 0;
  for (const r of rows) {
    const reg = one(r.registration);
    if (reg?.status !== "confirmed") { notConfirmed++; continue; }
    const email = (r.email || "").trim();
    if (!email) { noEmail++; continue; }
    if (email.toLowerCase().endsWith(STAFF_DOMAIN)) { staff++; continue; }
    if (!resend && already.has(`${r.registration_id}|${email.toLowerCase()}`)) { skippedSent++; continue; }

    try {
      await send(email, r.first_name || "");
      sent++;
      await admin.from("sm_email_log").insert({
        event_id: r.event_id, registration_id: r.registration_id,
        kind: KIND, to_email: email, sent_by: uid,
      }).then(() => {}, (e) => console.error("feedback log failed", e));
    } catch (e) { failed++; console.error("send error", String(e)); }
  }

  return json(req, {
    ok: true, sent,
    skipped: { no_email: noEmail, not_confirmed: notConfirmed, organising_team: staff, already_sent: skippedSent },
    failed,
  });
});
