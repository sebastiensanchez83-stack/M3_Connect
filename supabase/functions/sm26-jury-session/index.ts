// Innovation jury sessions, run the way Yachting Ventures actually runs them:
// a jury panel hears a startup batch in one time slot. Panels and batches are
// sized freely, so every count in the emails comes from the session itself.
// The session is created as a DRAFT by sm_yv_session_create (no Zoom, no email);
// this function owns the three outbound steps that follow:
//   1. notify_availability - ask each panel juror if the slot works (tokened
//      Confirm / Not-available buttons -> sm_jury_availability_by_token).
//   2. send_zoom           - once the panel has confirmed, create the Zoom
//      meeting and send the .ics invitation to jurors + startups.
//   3. notify_evaluate     - after the session, ask each juror to score.
// Plus cancel (deletes the Zoom, sends a CANCEL .ics) and notify_schedule (a
// juror's full slate in one email). Staff or a yachting_ventures partner only.
//
// Every action takes an optional test_email: a dry run that emails ONLY that
// address. Sessions flagged is_test refuse to email anyone else, ever.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://smartmarinaconnect.com", "https://m3connect.netlify.app",
  "http://localhost:5173", "http://localhost:3000",
];
const NETLIFY_SUBDOMAIN = /^https:\/\/[a-z0-9-]+--m3connect\.netlify\.app$/;
const isAllowed = (o: string) => ALLOWED_ORIGINS.includes(o) || NETLIFY_SUBDOMAIN.test(o);
const cors = (req: Request) => ({
  "Access-Control-Allow-Origin": isAllowed(req.headers.get("origin") || "") ? (req.headers.get("origin") as string) : ALLOWED_ORIGINS[0],
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(req) } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ZOOM_ACCOUNT_ID = Deno.env.get("ZOOM_ACCOUNT_ID") || "";
const ZOOM_CLIENT_ID = Deno.env.get("ZOOM_CLIENT_ID") || "";
const ZOOM_CLIENT_SECRET = Deno.env.get("ZOOM_CLIENT_SECRET") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SENDER_EMAIL = Deno.env.get("SENDER_EMAIL") || "Smart Marina Connect <noreply@smartmarinaconnect.com>";
const SITE_URL = Deno.env.get("SITE_URL") || "https://smartmarinaconnect.com";
const ORGANIZER_EMAIL = "victor@m3monaco.com";
// SENDER_EMAIL carries a display name ("Name <box@host>"); the calendar needs
// the bare address.
const SENDER_ADDRESS = (SENDER_EMAIL.match(/<([^>]+)>/)?.[1] || SENDER_EMAIL).trim();
// Always on every Zoom invitation, on top of the panel jurors + startups.
const ALWAYS_INVITE = ["victor@m3monaco.com", "gabriella@yachtingventures.co"];

// ---- Zoom -------------------------------------------------------------------
async function zoomToken(): Promise<string> {
  const basic = btoa(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`);
  const res = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(ZOOM_ACCOUNT_ID)}`,
    { method: "POST", headers: { Authorization: `Basic ${basic}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(`zoom token: ${data.reason || res.status}`);
  return data.access_token as string;
}
async function zoomHostId(token: string): Promise<string> {
  const res = await fetch("https://api.zoom.us/v2/users?status=active&page_size=1", { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  return (data.users && data.users[0] && data.users[0].id) || "me";
}
async function zoomCreate(token: string, host: string, topic: string, startISO: string, duration: number) {
  const res = await fetch(`https://api.zoom.us/v2/users/${encodeURIComponent(host)}/meetings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ topic, type: 2, start_time: startISO, duration, timezone: "UTC",
      settings: { join_before_host: true, waiting_room: false, approval_type: 2 } }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`zoom create: ${data.message || res.status}`);
  return { id: String(data.id), join_url: data.join_url as string, start_url: data.start_url as string };
}
async function zoomDelete(token: string, meetingId: string) {
  await fetch(`https://api.zoom.us/v2/meetings/${meetingId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
}

// ---- Calendar ---------------------------------------------------------------
const icsStamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
// The same instant written as Monaco wall-clock time. Sending the event in UTC
// was correct but made Outlook announce "08:00 - 09:00 in (UTC)" above a body
// that said 10:00-11:00, which reads like two different meetings. Anchoring the
// event to a named zone lets every client show the local hour the panel agreed.
function localStamp(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Monaco", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(d);
  const g = (t: string) => parts.find(x => x.type === t)?.value || "00";
  return `${g("year")}${g("month")}${g("day")}T${g("hour")}${g("minute")}${g("second")}`;
}
// Monaco follows the EU rule: last Sunday of March / October.
const VTIMEZONE = [
  "BEGIN:VTIMEZONE", "TZID:Europe/Monaco",
  "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "TZNAME:CEST",
  "DTSTART:19700329T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT",
  "BEGIN:STANDARD", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "TZNAME:CET",
  "DTSTART:19701025T030000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD",
  "END:VTIMEZONE",
];
const icsEsc = (s: string) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
// One .ics per recipient: organiser + that person only, so grouped startups
// never see each other's email addresses in the attachment.
function buildIcs(o: { uid: string; seq: number; method: "REQUEST" | "CANCEL"; start: Date; duration: number; title: string; joinUrl: string; recipient: { email: string; name?: string } }) {
  const end = new Date(o.start.getTime() + o.duration * 60000);
  const desc = `Innovation jury session for the Smart & Sustainable Marina Rendezvous 2026.\\nJoin Zoom: ${o.joinUrl}`;
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Smart Marina Connect//SM26//EN", `METHOD:${o.method}`, "CALSCALE:GREGORIAN",
    ...VTIMEZONE,
    "BEGIN:VEVENT", `UID:${o.uid}`, `SEQUENCE:${o.seq}`, `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART;TZID=Europe/Monaco:${localStamp(o.start)}`, `DTEND;TZID=Europe/Monaco:${localStamp(end)}`,
    `SUMMARY:${icsEsc(o.title)}`, `DESCRIPTION:${desc}`, `LOCATION:${icsEsc(o.joinUrl)}`,
    // The organiser is the address that receives the acceptances; SENT-BY names
    // the mailbox the message actually left from, which is what stops Outlook
    // treating the mismatch as suspect.
    `ORGANIZER;CN=Smart Marina Connect;SENT-BY="mailto:${SENDER_ADDRESS}":mailto:${ORGANIZER_EMAIL}`,
    `ATTENDEE;CN=${icsEsc(o.recipient.name || o.recipient.email)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${o.recipient.email}`,
    `STATUS:${o.method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT", "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

// ---- Mail -------------------------------------------------------------------
// Both helpers report success/failure so callers can tell the console how many
// messages actually left, instead of silently claiming everything was sent.
async function sendMail(to: string, subject: string, html: string, ics?: string, method: "REQUEST" | "CANCEL" = "REQUEST"): Promise<boolean> {
  if (!RESEND_API_KEY) { console.error("no RESEND_API_KEY"); return false; }
  const body: Record<string, unknown> = { from: SENDER_EMAIL, to: [to], subject, html };
  if (ics) {
    body.attachments = [{
      filename: "invite.ics",
      content: btoa(unescape(encodeURIComponent(ics))),
      // Outlook decides whether to draw Accept / Decline from the calendar
      // part's content type, not from the file extension. Without an explicit
      // method Resend derives "text/calendar" from the filename alone, and the
      // invitation lands as a .ics file to download and open by hand. Declaring
      // the method makes it a meeting request the recipient can answer in one
      // click. It must match the METHOD inside the payload.
      content_type: `text/calendar; charset=utf-8; method=${method}`,
    }];
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) { console.error("resend error", to, res.status, await res.text()); return false; }
    return true;
  } catch (e) { console.error("resend threw", to, e); return false; }
}

// ---- Formatting (Europe/Monaco) --------------------------------------------
const TZ = "Europe/Monaco";
const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...opts }).format(d);
// Monaco is CET (UTC+1) in winter and CEST (UTC+2) in summer.
function tzLabel(d: Date): string {
  const local = new Date(d.toLocaleString("en-US", { timeZone: TZ }));
  const utc = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
  return Math.round((local.getTime() - utc.getTime()) / 3600000) === 2 ? "CEST" : "CET";
}
const sessionDay = (d: Date) => fmt(d, { weekday: "long", day: "numeric", month: "long" });
const hhmm = (d: Date) => fmt(d, { hour: "2-digit", minute: "2-digit", hour12: false });
function slotTime(start: Date, minutes: number): string {
  return `${hhmm(start)} to ${hhmm(new Date(start.getTime() + minutes * 60000))}`;
}
// slot_label is free text from the console and normally already carries the
// zone ("10:00-11:00 CEST"). Appending the zone unconditionally printed
// "10:00-11:00 CEST CEST", so only add it when it isn't there.
function slotWithZone(label: string | null, start: Date, minutes: number): string {
  const raw = (label || "").trim() || slotTime(start, minutes);
  return /\b(CET|CEST|UTC|GMT)\b/i.test(raw) ? raw : `${raw} ${tzLabel(start)}`;
}
// "20-21 September 2026" / "20 September 2026" from the sm_event record.
function eventDates(startDate: string | null, endDate: string | null): string {
  if (!startDate) return "";
  const s = new Date(`${startDate}T12:00:00Z`);
  const e = endDate ? new Date(`${endDate}T12:00:00Z`) : s;
  const sameMonth = s.getUTCMonth() === e.getUTCMonth() && s.getUTCFullYear() === e.getUTCFullYear();
  const day = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric" }).format(d);
  const monthYear = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long", year: "numeric" }).format(d);
  if (s.getTime() === e.getTime()) return `${day(s)} ${monthYear(s)}`;
  if (sameMonth) return `${day(s)}-${day(e)} ${monthYear(s)}`;
  return `${day(s)} ${monthYear(s)} - ${day(e)} ${monthYear(e)}`;
}
const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const BTN = (href: string, label: string, bg: string) =>
  `<a href="${href}" style="display:inline-block;padding:11px 20px;margin:4px 6px 4px 0;border-radius:6px;background:${bg};color:#ffffff;text-decoration:none;font-weight:600;font-family:Helvetica,Arial,sans-serif;font-size:14px">${label}</a>`;

interface EventRow { id: string; name: string; venue: string | null; start_date: string | null; end_date: string | null; settings: Record<string, unknown> | null }
interface SessionRow {
  id: string; event_id: string; title: string; scheduled_at: string; duration_minutes: number;
  status: string; is_test: boolean; slot_label: string | null;
  jury_group_id: string | null; startup_group_id: string | null; entry_role_assignment_id: string | null;
  zoom_meeting_id: string | null; zoom_join_url: string | null; zoom_sent: boolean;
  ics_uid: string; ics_sequence: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  try {
    const token = (req.headers.get("authorization") || "").replace("Bearer ", "");
    if (!token) return json(req, { error: "Unauthorized" }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: u } = await admin.auth.getUser(token);
    const uid = u?.user?.id;
    if (!uid) return json(req, { error: "Unauthorized" }, 401);

    const { data: ev0 } = await admin.from("sm_event")
      .select("id, name, venue, start_date, end_date, settings").eq("slug", "sm26").maybeSingle();
    if (!ev0) return json(req, { error: "Event not available" }, 400);
    const event = ev0 as EventRow;
    const eventId = event.id;

    const { data: prof } = await admin.from("profiles").select("persona, access_status").eq("user_id", uid).maybeSingle();
    const p = prof as { persona?: string; access_status?: string } | null;
    const isStaff = !!p && ["admin", "moderator"].includes(p.persona || "") && p.access_status === "verified";
    const { data: yv } = await admin.from("sm_event_partner").select("id").eq("user_id", uid).eq("event_id", eventId).eq("kind", "yachting_ventures").maybeSingle();
    if (!isStaff && !yv) return json(req, { error: "Forbidden" }, 403);

    if (!RESEND_API_KEY) return json(req, { error: "Email is not configured" }, 500);

    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const testEmail = typeof body.test_email === "string" && body.test_email.includes("@") ? body.test_email.trim().toLowerCase() : null;

    // ---- shared loaders -----------------------------------------------------
    async function loadSession(id: string): Promise<SessionRow | null> {
      const { data } = await admin.from("sm_jury_session").select("*").eq("id", id).eq("event_id", eventId).maybeSingle();
      return (data as SessionRow) || null;
    }
    // The startups heard in this session (batch members, legacy single fallback).
    async function sessionEntryIds(s: SessionRow): Promise<string[]> {
      const { data: se } = await admin.from("sm_jury_session_entry").select("entry_role_assignment_id").eq("session_id", s.id);
      const ids = ((se || []) as { entry_role_assignment_id: string }[]).map(x => x.entry_role_assignment_id);
      if (ids.length) return ids;
      return s.entry_role_assignment_id ? [s.entry_role_assignment_id] : [];
    }
    async function companyNames(entryIds: string[]): Promise<string[]> {
      if (!entryIds.length) return [];
      const { data: ras } = await admin.from("sm_role_assignment").select("registration_id").in("id", entryIds);
      const regIds = ((ras || []) as { registration_id: string }[]).map(x => x.registration_id);
      if (!regIds.length) return [];
      const { data: regs } = await admin.from("sm_registration").select("company_name, first_name, last_name").in("id", regIds);
      return ((regs || []) as { company_name?: string; first_name?: string; last_name?: string }[])
        .map(r => (r.company_name || "").trim() || `${r.first_name || ""} ${r.last_name || ""}`.trim() || "Innovation");
    }
    // The panel jurors + their RSVP rows (the token lives here).
    async function sessionJurors(sessionId: string) {
      const { data: sj } = await admin.from("sm_jury_session_juror")
        .select("id, juror_user_id, status, token").eq("session_id", sessionId);
      const rows = (sj || []) as { id: string; juror_user_id: string; status: string; token: string }[];
      if (!rows.length) return [];
      const { data: pr } = await admin.from("profiles").select("user_id, email, first_name, last_name").in("user_id", rows.map(r => r.juror_user_id));
      const byId = new Map<string, { email?: string; first_name?: string; last_name?: string }>();
      for (const x of (pr || []) as { user_id: string; email?: string; first_name?: string; last_name?: string }[]) byId.set(x.user_id, x);
      return rows.map(r => {
        const pf = byId.get(r.juror_user_id) || {};
        return {
          ...r,
          email: (pf.email || "").trim().toLowerCase(),
          first_name: (pf.first_name || "").trim(),
          name: `${pf.first_name || ""} ${pf.last_name || ""}`.trim(),
        };
      });
    }
    // A test session never reaches a real inbox: only the tester's address.
    function guardTest(s: SessionRow): string | null {
      if (s.is_test && !testEmail) return "This is a test session - it can only email the address you run the test from.";
      return null;
    }
    const editionLabel = (): string => {
      const v = event.settings && typeof event.settings === "object" ? (event.settings as Record<string, unknown>)["edition_label"] : null;
      return typeof v === "string" && v.trim() ? v.trim() : "";
    };
    const eventLine = () => {
      const ed = editionLabel();
      const where = event.venue ? ` at the ${esc(event.venue)}` : "";
      const when = eventDates(event.start_date, event.end_date);
      return `${ed ? `the ${esc(ed)} edition of ` : ""}the Smart Marina Rendezvous, which will take place${where}${when ? ` on ${when}` : ""}`;
    };

    // ---- 1. Availability request -------------------------------------------
    // Gabbi's own wording, personalised, with Confirm / Not-available buttons.
    if (action === "notify_availability") {
      const sessionId = typeof body.session_id === "string" ? body.session_id : "";
      if (!sessionId) return json(req, { error: "Missing session_id" }, 400);
      const s = await loadSession(sessionId);
      if (!s) return json(req, { error: "Session not found" }, 404);
      if (s.status === "cancelled") return json(req, { error: "This session is cancelled" }, 400);
      const blocked = guardTest(s);
      if (blocked) return json(req, { error: blocked }, 400);

      const jurors = await sessionJurors(sessionId);
      if (!jurors.length) return json(req, { error: "This session has no panel jurors yet." }, 400);
      const entryIds = await sessionEntryIds(s);
      if (!entryIds.length) return json(req, { error: "This session's batch has no startups yet, so there is nothing to ask the panel about." }, 400);
      const names = await companyNames(entryIds);
      // Always the real batch size -- panels and batches are sized freely.
      const startupCount = entryIds.length;
      const pitchMinutes = Math.max(1, Number(body.pitch_minutes) || 5);
      const qaMinutes = Math.max(1, Number(body.qa_minutes) || 5);
      const coJurors = Math.max(jurors.length - 1, 0);

      const start = new Date(s.scheduled_at);
      const day = sessionDay(start);
      const time = esc(slotWithZone(s.slot_label, start, s.duration_minutes));
      const tz = tzLabel(start);

      let sent = 0; let failed = 0;
      for (const j of jurors) {
        const to = testEmail || j.email;
        if (!to || !to.includes("@")) { failed++; continue; }
        const yes = `${SITE_URL}/sm26/jury/rsvp?token=${encodeURIComponent(j.token)}&answer=available`;
        const no = `${SITE_URL}/sm26/jury/rsvp?token=${encodeURIComponent(j.token)}&answer=unavailable`;
        const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1e2838">
<p>Dear ${esc(j.first_name || "there")},</p>
<p>Thanks once again for agreeing to participate as a jury member in ${eventLine()}.</p>
<p>We are now scheduling the jury sessions and would like to ask whether you're available on <strong>${esc(day)} from ${time}</strong> for your session?</p>
<p>During this hour, you will hear a pitch from <strong>${startupCount} of the chosen startups</strong> (${pitchMinutes} minute pitch per startup, followed by ${qaMinutes} minutes Q&amp;A). You will also be joined on the call by <strong>${coJurors} other jury member${coJurors === 1 ? "" : "s"}</strong>, and you will be asked to submit a short feedback form on each of the ${startupCount} startups after the call.</p>
<p>Please let me know if that works for you, and we will send you a zoom invitation.</p>
<p style="margin:22px 0 6px">${BTN(yes, "Confirm availability", "#16a34a")}${BTN(no, "Not available", "#64748b")}</p>
<p style="font-size:12px;color:#8a95a8;margin-top:18px">All times are ${tz} (Monaco).${names.length ? ` Startups in this session: ${esc(names.join(", "))}.` : ""}</p>
</div>`;
        const ok = await sendMail(to, "Your jury session - Smart Marina Rendezvous", html);
        // A preview must not make a juror look contacted.
        if (ok) { sent++; if (!testEmail) await admin.from("sm_jury_session_juror").update({ invited_at: new Date().toISOString() }).eq("id", j.id); }
        else failed++;
        if (testEmail) break; // one preview mail only
      }
      if (!testEmail) await admin.from("sm_jury_session").update({ last_availability_email_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", sessionId);
      return json(req, { ok: true, sent, failed, test: !!testEmail });
    }

    // ---- 2. Zoom invitation (deliberate second step) ------------------------
    // Only after the panel has answered: creates the meeting and sends the .ics
    // to the confirmed jurors, the batch's startups and the organisers.
    if (action === "send_zoom") {
      const sessionId = typeof body.session_id === "string" ? body.session_id : "";
      if (!sessionId) return json(req, { error: "Missing session_id" }, 400);
      const s = await loadSession(sessionId);
      if (!s) return json(req, { error: "Session not found" }, 404);
      if (s.status === "cancelled") return json(req, { error: "This session is cancelled" }, 400);
      // Previews stay allowed after the real send - looking costs nothing.
      if (s.zoom_sent && !testEmail) return json(req, { error: "The Zoom invitation has already been sent for this session." }, 400);
      const blocked = guardTest(s);
      if (blocked) return json(req, { error: blocked }, 400);

      const jurors = await sessionJurors(sessionId);
      const availableJurors = jurors.filter(j => j.status === "available" || j.status === "confirmed");
      const force = body.force === true;
      // A preview does not need a confirmed panel: it is shown to the tester only.
      if (!availableJurors.length && !force && !testEmail) {
        return json(req, { error: "No juror has confirmed availability yet. Send the availability request first, or tick 'send anyway'." }, 400);
      }
      const invitedJurors = force ? jurors : availableJurors;

      const entryIds = await sessionEntryIds(s);
      const start = new Date(s.scheduled_at);

      // Recipients: confirmed panel jurors + the batch's startups + organisers.
      const out = new Map<string, { email: string; name?: string }>();
      const add = (email?: string | null, name?: string) => {
        const e = (email || "").trim().toLowerCase();
        if (e && e.includes("@") && !out.has(e)) out.set(e, { email: e, name });
      };
      if (testEmail) {
        add(testEmail, "Test run");
      } else {
        for (const j of invitedJurors) add(j.email, j.name);
        if (entryIds.length) {
          const { data: ras } = await admin.from("sm_role_assignment").select("registration_id").in("id", entryIds);
          const regIds = ((ras || []) as { registration_id?: string }[]).map(x => x.registration_id).filter(Boolean) as string[];
          if (regIds.length) {
            const { data: rr } = await admin.from("sm_registration").select("email, first_name, last_name").in("id", regIds);
            for (const x of (rr || []) as { email?: string; first_name?: string; last_name?: string }[]) add(x.email, `${x.first_name || ""} ${x.last_name || ""}`.trim());
          }
        }
        for (const e of ALWAYS_INVITE) add(e);
        const { data: yvs } = await admin.from("sm_event_partner").select("user_id").eq("event_id", eventId).eq("kind", "yachting_ventures");
        const yvIds = ((yvs || []) as { user_id: string }[]).map(x => x.user_id);
        if (yvIds.length) {
          const { data: yp } = await admin.from("profiles").select("email, first_name, last_name").in("user_id", yvIds);
          for (const x of (yp || []) as { email?: string; first_name?: string; last_name?: string }[]) add(x.email, `${x.first_name || ""} ${x.last_name || ""}`.trim());
        }
      }
      const recipients = [...out.values()];
      if (!recipients.length) return json(req, { error: "Nobody to invite" }, 400);

      const ztoken = await zoomToken();
      const host = await zoomHostId(ztoken);
      // A preview reuses the real meeting when one exists; otherwise it spins up
      // a throwaway purely so the mail looks authentic, and deletes it below.
      const reuse = !!testEmail && !!s.zoom_meeting_id && !!s.zoom_join_url;
      const meeting = reuse
        ? { id: String(s.zoom_meeting_id), join_url: String(s.zoom_join_url), start_url: "" }
        : await zoomCreate(ztoken, host, s.title, start.toISOString(), s.duration_minutes);
      const throwaway = !!testEmail && !reuse;

      // Nothing is persisted for a preview: the slot must still be at the
      // availability step afterwards, with no Zoom recorded against it.
      if (!testEmail) {
        const { error: upErr } = await admin.from("sm_jury_session").update({
          zoom_meeting_id: meeting.id, zoom_join_url: meeting.join_url, zoom_start_url: meeting.start_url,
          zoom_sent: true, zoom_sent_at: new Date().toISOString(), status: "scheduled", updated_at: new Date().toISOString(),
        }).eq("id", sessionId);
        // Don't leave an orphan meeting on the Zoom account if we can't record it.
        if (upErr) { console.error("session update failed", upErr); await zoomDelete(ztoken, meeting.id); return json(req, { error: "Could not save the meeting" }, 500); }
        // Mark the jurors we invited as confirmed for this slot.
        if (invitedJurors.length) {
          await admin.from("sm_jury_session_juror").update({ status: "confirmed" }).in("id", invitedJurors.map(j => j.id));
        }
      }

      const dayLabel = `${sessionDay(start)}, ${slotWithZone(s.slot_label, start, s.duration_minutes)}`;
      const names = await companyNames(entryIds);
      let sent = 0; let failed = 0;
      for (const a of recipients) {
        const ics = buildIcs({ uid: s.ics_uid, seq: s.ics_sequence, method: "REQUEST", start, duration: s.duration_minutes, title: s.title, joinUrl: meeting.join_url, recipient: a });
        const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1e2838">
<p>You're invited to an innovation jury session for the <strong>${esc(event.name)}</strong>.</p>
<p><strong>${esc(s.title)}</strong><br>${esc(dayLabel)} &middot; ${s.duration_minutes} min</p>
${names.length ? `<p>Startups pitching in this session: ${esc(names.join(", "))}.</p>` : ""}
<p>${BTN(meeting.join_url, "Join the Zoom meeting", "#0b2653")}</p>
<p style="font-size:12px;color:#8a95a8">Use the Accept button on this invitation to add the session to your calendar.</p>
</div>`;
        const ok = await sendMail(a.email, `Invitation: ${s.title}`, html, ics);
        if (ok) sent++; else failed++;
      }
      // The preview meeting never belonged to anyone - remove it.
      if (throwaway) await zoomDelete(ztoken, meeting.id);
      return json(req, { ok: true, id: s.id, join_url: meeting.join_url, sent, failed, invited: recipients.length, test: !!testEmail });
    }

    // ---- Cancel -------------------------------------------------------------
    if (action === "cancel") {
      const sessionId = typeof body.session_id === "string" ? body.session_id : "";
      if (!sessionId) return json(req, { error: "Missing session_id" }, 400);
      const s = await loadSession(sessionId);
      if (!s) return json(req, { error: "Session not found" }, 404);
      if (s.zoom_meeting_id) { try { const t = await zoomToken(); await zoomDelete(t, String(s.zoom_meeting_id)); } catch (e) { console.error("zoom delete", e); } }
      const newSeq = (Number(s.ics_sequence) || 0) + 1;
      await admin.from("sm_jury_session").update({ status: "cancelled", ics_sequence: newSeq, updated_at: new Date().toISOString() }).eq("id", sessionId);
      // Nothing ever left for a draft or a test session, so nobody to un-invite.
      if (s.is_test || !s.zoom_sent) return json(req, { ok: true, sent: 0, failed: 0 });

      const entryIds = await sessionEntryIds(s);
      const out = new Map<string, { email: string; name?: string }>();
      const add = (email?: string | null, name?: string) => {
        const e = (email || "").trim().toLowerCase();
        if (e && e.includes("@") && !out.has(e)) out.set(e, { email: e, name });
      };
      for (const j of await sessionJurors(sessionId)) add(j.email, j.name);
      if (entryIds.length) {
        const { data: ras } = await admin.from("sm_role_assignment").select("registration_id").in("id", entryIds);
        const regIds = ((ras || []) as { registration_id?: string }[]).map(x => x.registration_id).filter(Boolean) as string[];
        if (regIds.length) {
          const { data: rr } = await admin.from("sm_registration").select("email, first_name, last_name").in("id", regIds);
          for (const x of (rr || []) as { email?: string; first_name?: string; last_name?: string }[]) add(x.email, `${x.first_name || ""} ${x.last_name || ""}`.trim());
        }
      }
      for (const e of ALWAYS_INVITE) add(e);

      const start = new Date(s.scheduled_at);
      const html = `<p style="font-family:Helvetica,Arial,sans-serif">The innovation jury session <strong>${esc(s.title)}</strong> has been <strong>cancelled</strong>. The calendar entry will be removed.</p>`;
      let sent = 0; let failed = 0;
      for (const a of out.values()) {
        const ics = buildIcs({ uid: String(s.ics_uid), seq: newSeq, method: "CANCEL", start, duration: s.duration_minutes, title: s.title, joinUrl: String(s.zoom_join_url || ""), recipient: a });
        const ok = await sendMail(a.email, `Cancelled: ${s.title}`, html, ics, "CANCEL");
        if (ok) sent++; else failed++;
      }
      return json(req, { ok: true, sent, failed });
    }

    // ---- 3. Post-session "please score" ------------------------------------
    if (action === "notify_evaluate") {
      const sessionId = typeof body.session_id === "string" ? body.session_id : "";
      if (!sessionId) return json(req, { error: "Missing session_id" }, 400);
      const s = await loadSession(sessionId);
      if (!s) return json(req, { error: "Session not found" }, 404);
      const blocked = guardTest(s);
      if (blocked) return json(req, { error: blocked }, 400);

      const entryIds = await sessionEntryIds(s);
      if (!entryIds.length) return json(req, { error: "This session has no innovations attached, so there's nothing to evaluate." }, 400);

      // Company name per entry, so each juror sees exactly what they must score.
      const { data: ras } = await admin.from("sm_role_assignment").select("id, registration_id").in("id", entryIds);
      const regOf = new Map<string, string>();
      for (const x of (ras || []) as { id: string; registration_id: string }[]) regOf.set(x.id, x.registration_id);
      const { data: regs } = await admin.from("sm_registration").select("id, company_name, first_name, last_name").in("id", [...regOf.values()]);
      const compOfReg = new Map<string, string>();
      for (const r of (regs || []) as { id: string; company_name?: string; first_name?: string; last_name?: string }[])
        compOfReg.set(r.id, (r.company_name && r.company_name.trim()) || `${r.first_name || ""} ${r.last_name || ""}`.trim() || "Innovation");
      const companyOfEntry = (eid: string) => compOfReg.get(regOf.get(eid) || "") || "Innovation";

      // Panel jurors first; fall back to whoever is actually assigned to these
      // entries (covers the pre-panel ad-hoc assignments).
      const panel = await sessionJurors(sessionId);
      const perJuror = new Map<string, string[]>();
      if (panel.length) {
        for (const j of panel) perJuror.set(j.juror_user_id, entryIds);
      } else {
        const { data: ja } = await admin.from("sm_jury_assignment").select("juror_user_id, entry_role_assignment_id").in("entry_role_assignment_id", entryIds).eq("competition", "innovation");
        for (const a of (ja || []) as { juror_user_id: string; entry_role_assignment_id: string }[]) {
          const arr = perJuror.get(a.juror_user_id) || []; arr.push(a.entry_role_assignment_id); perJuror.set(a.juror_user_id, arr);
        }
      }
      if (perJuror.size === 0) return json(req, { error: "No jurors are assigned to this session's innovations yet." }, 400);

      const { data: jp } = await admin.from("profiles").select("user_id, email, first_name").in("user_id", [...perJuror.keys()]);
      const profOf = new Map<string, { email?: string; first_name?: string }>();
      for (const x of (jp || []) as { user_id: string; email?: string; first_name?: string }[]) profOf.set(x.user_id, x);

      const link = `${SITE_URL}/sm26/jury`;
      let sent = 0; let failed = 0;
      for (const [jid, eids] of perJuror) {
        const profile = profOf.get(jid);
        const to = testEmail || (profile?.email || "").trim().toLowerCase();
        if (!to || !to.includes("@")) { failed++; continue; }
        const names = [...new Set(eids.map(companyOfEntry))];
        const list = names.map(n => `<li>${esc(n)}</li>`).join("");
        const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1e2838">
<p>Hi ${esc(profile?.first_name || "there")},</p>
<p>Thank you for taking part in the jury session for the <strong>${esc(event.name)}</strong>${s.title ? ` ("${esc(s.title)}")` : ""}.</p>
<p>Please now submit your evaluation for the innovation${names.length > 1 ? "s" : ""} you reviewed:</p>
<ul>${list}</ul>
<p>${BTN(link, "Open your jury scorecards", "#0b2653")}</p>
</div>`;
        const ok = await sendMail(to, "Please score the innovations from your jury session", html);
        if (ok) sent++; else failed++;
        if (testEmail) break;
      }
      return json(req, { ok: true, sent, failed, test: !!testEmail });
    }

    // ---- Optional: a juror's whole slate in one email -----------------------
    if (action === "notify_schedule") {
      const jurorId = typeof body.juror_user_id === "string" ? body.juror_user_id : "";
      if (!jurorId) return json(req, { error: "Missing juror_user_id" }, 400);
      const { data: rows } = await admin.from("sm_jury_session_juror")
        .select("session_id, status, sm_jury_session!inner(id, title, scheduled_at, duration_minutes, slot_label, status, zoom_sent, zoom_join_url, is_test, event_id)")
        .eq("juror_user_id", jurorId);
      const slots = ((rows || []) as { status: string; sm_jury_session: SessionRow }[])
        .map(r => ({ rsvp: r.status, s: r.sm_jury_session }))
        .filter(x => x.s && x.s.event_id === eventId && x.s.status !== "cancelled" && !x.s.is_test)
        .sort((a, b) => a.s.scheduled_at.localeCompare(b.s.scheduled_at));
      if (!slots.length) return json(req, { error: "This juror has no scheduled sessions." }, 400);

      const { data: pr } = await admin.from("profiles").select("email, first_name").eq("user_id", jurorId).maybeSingle();
      const pf = (pr || {}) as { email?: string; first_name?: string };
      const to = testEmail || (pf.email || "").trim().toLowerCase();
      if (!to || !to.includes("@")) return json(req, { error: "This juror has no email address." }, 400);

      const blocks: string[] = [];
      for (const { rsvp, s } of slots) {
        const start = new Date(s.scheduled_at);
        const names = await companyNames(await sessionEntryIds(s));
        blocks.push(`<li style="margin-bottom:10px"><strong>${esc(sessionDay(start))}, ${esc(slotWithZone(s.slot_label, start, s.duration_minutes))}</strong>
${names.length ? `<br><span style="color:#55637a">${esc(names.join(", "))}</span>` : ""}
${s.zoom_sent && s.zoom_join_url ? `<br><a href="${s.zoom_join_url}">Join the Zoom meeting</a>` : `<br><span style="color:#8a95a8">Zoom link to follow${rsvp === "invited" ? " once you confirm your availability" : ""}</span>`}</li>`);
      }
      const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1e2838">
<p>Hi ${esc(pf.first_name || "there")},</p>
<p>Here is your full jury schedule for the <strong>${esc(event.name)}</strong>. All times are Monaco time.</p>
<ul style="padding-left:18px">${blocks.join("")}</ul>
<p>${BTN(`${SITE_URL}/sm26/jury`, "Open your jury space", "#0b2653")}</p>
</div>`;
      const ok = await sendMail(to, "Your jury schedule - Smart Marina Rendezvous", html);
      if (ok && !testEmail) {
        await admin.from("sm_jury_session").update({ last_scheduled_email_at: new Date().toISOString() }).in("id", slots.map(x => x.s.id));
      }
      return json(req, { ok: true, sent: ok ? 1 : 0, failed: ok ? 0 : 1, slots: slots.length, test: !!testEmail });
    }

    return json(req, { error: "Unknown action" }, 400);
  } catch (e) {
    console.error("sm26-jury-session error", e);
    return json(req, { error: String((e as Error).message || e) }, 500);
  }
});
