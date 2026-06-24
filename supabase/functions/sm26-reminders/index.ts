// SM26 pre-event reminder sender. Bulk-emails CONFIRMED participants once per
// reminder kind (idempotent via sm_event_reminder). Two callers:
//   - staff (admin button): authenticated by JWT; can also send a single test
//   - pg_cron: authenticated by the shared secret in sm_cron_secret
// Scheduled kinds are date-guarded so the cron is a no-op except near the event.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SENDER_EMAIL = Deno.env.get("SENDER_EMAIL") || "Smart Marina Connect <noreply@smartmarinaconnect.com>";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SITE_URL = Deno.env.get("SITE_URL") || "https://smartmarinaconnect.com";

const ALLOWED_ORIGINS = [
  "https://smartmarinaconnect.com", "https://m3connect.netlify.app",
  "http://localhost:5173", "http://localhost:3000",
];
const NETLIFY_SUBDOMAIN = /^https:\/\/[a-z0-9-]+--m3connect\.netlify\.app$/;
const isAllowedOrigin = (o: string) => ALLOWED_ORIGINS.includes(o) || NETLIFY_SUBDOMAIN.test(o);
const cors = (req: Request) => {
  const o = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(o) ? o : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
};
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(req) } });

const EVENT = "Smart & Sustainable Marina Rendezvous 2026";

// Scheduled kinds only fire within their day-window before the event start.
const WINDOWS: Record<string, [number, number]> = {
  pre_event_7d: [1, 14],
  pre_event_1d: [0, 3],
};

function fmtWhen(start: string | null, end: string | null): string {
  if (!start) return "20–21 September 2026";
  const s = new Date(start + "T00:00:00Z");
  const e = end ? new Date(end + "T00:00:00Z") : s;
  const mY = (d: Date) => d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", timeZone: "UTC" });
  if (!end || start === end) return `${day(s)} ${mY(s)}`;
  if (s.getUTCMonth() === e.getUTCMonth() && s.getUTCFullYear() === e.getUTCFullYear()) return `${day(s)}–${day(e)} ${mY(s)}`;
  return `${day(s)} ${mY(s)} – ${day(e)} ${mY(e)}`;
}

async function sendReminder(email: string, firstName: string, whenText: string, venue: string): Promise<boolean> {
  if (!RESEND_API_KEY) { console.error("no RESEND_API_KEY"); return false; }
  const hi = `<p>Dear ${firstName || "participant"},</p>`;
  const btn = (href: string, label: string) =>
    `<p><a href="${href}" style="background:#0b2653;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">${label}</a></p>`;
  const html =
    `${hi}<p>The <strong>${EVENT}</strong> is almost here — <strong>${whenText}</strong> at ${venue}.</p>` +
    `<p>A few things before you arrive:</p>` +
    `<ul><li>Have your entry QR (sent by email) ready at the welcome desk for a quick check-in.</li>` +
    `<li>Review the latest programme and your participation details online.</li></ul>` +
    btn(`${SITE_URL}/sm26/me`, "View my participation") +
    `<p style="font-size:14px"><a href="${SITE_URL}/sm26/agenda">See the programme</a></p>` +
    `<p style="color:#64748b;font-size:13px">We look forward to welcoming you in Monaco.<br>Smart Marina Connect · Monaco Marina Management</p>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: SENDER_EMAIL, to: [email], subject: `It's nearly here — ${EVENT}`, html }),
  });
  if (!res.ok) { console.error("reminder send failed", res.status, await res.text()); return false; }
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const body = await req.json().catch(() => ({})) as { kind?: string; test_email?: string; secret?: string };
  const kind = (body.kind || "manual").toString();
  const testEmail = typeof body.test_email === "string" ? body.test_email.trim() : "";
  const passedSecret = typeof body.secret === "string" ? body.secret : "";

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Auth: a verified staff JWT, OR the shared cron secret.
  let allowed = false; let staff = false;
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "");
  if (token) {
    const { data } = await admin.auth.getUser(token);
    const uid = data?.user?.id;
    if (uid) {
      const { data: prof } = await admin.from("profiles").select("persona, access_status").eq("user_id", uid).maybeSingle();
      const p = prof as { persona?: string; access_status?: string } | null;
      if (p && ["admin", "moderator"].includes(p.persona || "") && p.access_status === "verified") { allowed = true; staff = true; }
    }
  }
  if (!allowed && passedSecret) {
    const { data } = await admin.from("sm_cron_secret").select("secret").eq("name", "reminders").maybeSingle();
    if (data && (data as { secret?: string }).secret === passedSecret) allowed = true;
  }
  if (!allowed) return json(req, { error: "Forbidden" }, 403);

  const { data: ev } = await admin.from("sm_event").select("id, start_date, end_date, venue").eq("slug", "sm26").maybeSingle();
  if (!ev) return json(req, { error: "Event not found" }, 404);
  const e = ev as { id: string; start_date: string | null; end_date: string | null; venue: string | null };
  const whenText = fmtWhen(e.start_date, e.end_date);
  const venue = e.venue || "Yacht Club de Monaco";

  // Single test send (staff only) — never logged, so it can be repeated.
  if (testEmail) {
    if (!staff) return json(req, { error: "Forbidden" }, 403);
    const ok = await sendReminder(testEmail, "there", whenText, venue);
    return json(req, { ok, test: true });
  }

  // Date-window guard for scheduled kinds (so the cron does nothing off-season).
  const win = WINDOWS[kind];
  if (win) {
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const start = e.start_date ? new Date(e.start_date + "T00:00:00Z") : null;
    const days = start ? Math.round((start.getTime() - today.getTime()) / 86400000) : -1;
    if (days < win[0] || days > win[1]) return json(req, { ok: true, skipped: "outside_window", days });
  }

  // Confirmed participants who haven't had this reminder yet.
  const { data: regs } = await admin.from("sm_registration")
    .select("id, email, first_name").eq("event_id", e.id).eq("status", "confirmed").not("email", "is", null);
  const list = (regs || []) as { id: string; email: string | null; first_name: string | null }[];
  const { data: sentRows } = await admin.from("sm_event_reminder").select("registration_id").eq("kind", kind);
  const sent = new Set((sentRows || []).map((x) => (x as { registration_id: string }).registration_id));

  let n = 0;
  for (const r of list) {
    if (!r.email || sent.has(r.id)) continue;
    const ok = await sendReminder(r.email, r.first_name || "there", whenText, venue);
    if (ok) { await admin.from("sm_event_reminder").insert({ event_id: e.id, registration_id: r.id, kind }); n++; }
  }
  return json(req, { ok: true, sent: n, kind });
});
