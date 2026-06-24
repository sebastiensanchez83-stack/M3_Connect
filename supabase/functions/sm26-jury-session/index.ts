// Schedule innovation<->jury online sessions: create a Zoom meeting and email a
// calendar (.ics) invitation to the startup, assigned jurors, Yachting Ventures
// and Victor. Staff or a yachting_ventures partner only. Actions: create, cancel.

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
const ORGANIZER_EMAIL = "victor@m3monaco.com";
// Always on every session, on top of the startup + jurors.
const ALWAYS_INVITE = ["victor@m3monaco.com", "gabriella@yachtingventures.co"];

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

const icsStamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
function buildIcs(o: { uid: string; seq: number; method: "REQUEST" | "CANCEL"; start: Date; duration: number; title: string; joinUrl: string; attendees: { email: string; name?: string }[] }) {
  const end = new Date(o.start.getTime() + o.duration * 60000);
  const desc = `Innovation jury session for the Smart & Sustainable Marina Rendezvous 2026.\\nJoin Zoom: ${o.joinUrl}`;
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Smart Marina Connect//SM26//EN", `METHOD:${o.method}`, "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT", `UID:${o.uid}`, `SEQUENCE:${o.seq}`, `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(o.start)}`, `DTEND:${icsStamp(end)}`,
    `SUMMARY:${o.title}`, `DESCRIPTION:${desc}`, `LOCATION:${o.joinUrl}`,
    `ORGANIZER;CN=Smart Marina Connect:mailto:${ORGANIZER_EMAIL}`,
    ...o.attendees.map(a => `ATTENDEE;CN=${(a.name || a.email).replace(/[,;]/g, " ")};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a.email}`),
    `STATUS:${o.method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT", "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}
async function sendInvite(to: string, subject: string, html: string, ics: string) {
  if (!RESEND_API_KEY) { console.error("no RESEND_API_KEY"); return; }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: SENDER_EMAIL, to: [to], subject, html,
      attachments: [{ filename: "invite.ics", content: btoa(unescape(encodeURIComponent(ics))) }] }),
  });
  if (!res.ok) console.error("resend invite error", res.status, await res.text());
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

    const { data: ev0 } = await admin.from("sm_event").select("id").eq("slug", "sm26").maybeSingle();
    if (!ev0) return json(req, { error: "Event not available" }, 400);
    const eventId = (ev0 as { id: string }).id;

    const { data: prof } = await admin.from("profiles").select("persona, access_status").eq("user_id", uid).maybeSingle();
    const p = prof as { persona?: string; access_status?: string } | null;
    const isStaff = !!p && ["admin", "moderator"].includes(p.persona || "") && p.access_status === "verified";
    const { data: yv } = await admin.from("sm_event_partner").select("id").eq("user_id", uid).eq("event_id", eventId).eq("kind", "yachting_ventures").maybeSingle();
    if (!isStaff && !yv) return json(req, { error: "Forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = body.action;

    // Build the attendee list for an entry (startup + assigned jurors + extras).
    async function attendeesFor(entryRaId: string | null): Promise<{ email: string; name?: string }[]> {
      const out = new Map<string, { email: string; name?: string }>();
      const add = (email?: string | null, name?: string) => {
        const e = (email || "").trim().toLowerCase();
        if (e && e.includes("@") && !out.has(e)) out.set(e, { email: e, name });
      };
      if (entryRaId) {
        const { data: sr } = await admin.from("sm_role_assignment").select("registration_id").eq("id", entryRaId).maybeSingle();
        const regId = (sr as { registration_id?: string } | null)?.registration_id;
        if (regId) {
          const { data: r } = await admin.from("sm_registration").select("email, first_name, last_name").eq("id", regId).maybeSingle();
          const rr = r as { email?: string; first_name?: string; last_name?: string } | null;
          if (rr) add(rr.email, `${rr.first_name || ""} ${rr.last_name || ""}`.trim());
        }
        const { data: ja } = await admin.from("sm_jury_assignment").select("juror_user_id").eq("entry_role_assignment_id", entryRaId).eq("competition", "innovation");
        const ids = ((ja || []) as { juror_user_id: string }[]).map(x => x.juror_user_id);
        if (ids.length) {
          const { data: jp } = await admin.from("profiles").select("email, first_name, last_name").in("user_id", ids);
          for (const x of (jp || []) as { email?: string; first_name?: string; last_name?: string }[]) add(x.email, `${x.first_name || ""} ${x.last_name || ""}`.trim());
        }
      }
      if (out.size <= ALWAYS_INVITE.length) {
        // no entry / no assigned jurors -> invite all confirmed innovation jurors
        const { data: jr } = await admin.from("sm_role_assignment").select("registration_id").eq("event_id", eventId).eq("role", "jury").eq("status", "confirmed");
        const regIds = ((jr || []) as { registration_id: string }[]).map(x => x.registration_id);
        if (regIds.length) {
          const { data: rr } = await admin.from("sm_registration").select("email, first_name, last_name").in("id", regIds);
          for (const x of (rr || []) as { email?: string; first_name?: string; last_name?: string }[]) add(x.email, `${x.first_name || ""} ${x.last_name || ""}`.trim());
        }
      }
      for (const e of ALWAYS_INVITE) add(e);
      // include any YV partner accounts too
      const { data: yvs } = await admin.from("sm_event_partner").select("user_id").eq("event_id", eventId).eq("kind", "yachting_ventures");
      const yvIds = ((yvs || []) as { user_id: string }[]).map(x => x.user_id);
      if (yvIds.length) {
        const { data: yp } = await admin.from("profiles").select("email, first_name, last_name").in("user_id", yvIds);
        for (const x of (yp || []) as { email?: string; first_name?: string; last_name?: string }[]) add(x.email, `${x.first_name || ""} ${x.last_name || ""}`.trim());
      }
      return [...out.values()];
    }

    if (action === "create") {
      const rawTitle = (typeof body.title === "string" && body.title.trim()) || "Innovation jury session";
      // Dry-run: when test_email is given, invite ONLY that address — never the real
      // startup / jurors / Yachting Ventures / Victor. A real Zoom is still created.
      const testEmail = typeof body.test_email === "string" && body.test_email.includes("@") ? body.test_email.trim().toLowerCase() : null;
      const title = testEmail ? `[TEST] ${rawTitle}` : rawTitle;
      const entryRaId = typeof body.entry_role_assignment_id === "string" ? body.entry_role_assignment_id : null;
      const startISO = typeof body.scheduled_at === "string" ? body.scheduled_at : "";
      const duration = Math.max(10, Math.min(240, Number(body.duration_minutes) || 30));
      if (!startISO) return json(req, { error: "A date/time is required" }, 400);
      const start = new Date(startISO);
      if (isNaN(start.getTime())) return json(req, { error: "Invalid date/time" }, 400);

      const ztoken = await zoomToken();
      const host = await zoomHostId(ztoken);
      const meeting = await zoomCreate(ztoken, host, title, start.toISOString(), duration);

      const { data: ins, error: insErr } = await admin.from("sm_jury_session").insert({
        event_id: eventId, competition: "innovation", entry_role_assignment_id: entryRaId,
        title, scheduled_at: start.toISOString(), duration_minutes: duration,
        zoom_meeting_id: meeting.id, zoom_join_url: meeting.join_url, zoom_start_url: meeting.start_url,
        created_by: uid, is_test: !!testEmail,
      }).select("id, ics_uid, ics_sequence").single();
      if (insErr || !ins) { console.error("session insert failed", insErr); return json(req, { error: "Could not save session" }, 500); }
      const s = ins as { id: string; ics_uid: string; ics_sequence: number };

      const attendees = testEmail ? [{ email: testEmail }] : await attendeesFor(entryRaId);
      const ics = buildIcs({ uid: s.ics_uid, seq: s.ics_sequence, method: "REQUEST", start, duration, title, joinUrl: meeting.join_url, attendees });
      const when = start.toUTCString();
      const html = `<p>You're invited to an innovation jury session for the <strong>Smart &amp; Sustainable Marina Rendezvous 2026</strong>.</p><p><strong>${title}</strong><br>${when} (UTC) · ${duration} min</p><p><a href="${meeting.join_url}">Join the Zoom meeting</a></p><p>Accept the attached calendar invitation to add it to your calendar.</p>`;
      for (const a of attendees) { try { await sendInvite(a.email, `Invitation: ${title}`, html, ics); } catch (e) { console.error("invite send failed", a.email, e); } }

      return json(req, { ok: true, id: s.id, join_url: meeting.join_url, invited: attendees.length, test: !!testEmail });
    }

    if (action === "cancel") {
      const sessionId = typeof body.session_id === "string" ? body.session_id : "";
      if (!sessionId) return json(req, { error: "Missing session_id" }, 400);
      const { data: sess } = await admin.from("sm_jury_session").select("*").eq("id", sessionId).maybeSingle();
      const s = sess as Record<string, unknown> | null;
      if (!s) return json(req, { error: "Session not found" }, 404);
      if (s.zoom_meeting_id) { try { const t = await zoomToken(); await zoomDelete(t, String(s.zoom_meeting_id)); } catch (e) { console.error("zoom delete", e); } }
      const newSeq = (Number(s.ics_sequence) || 0) + 1;
      await admin.from("sm_jury_session").update({ status: "cancelled", ics_sequence: newSeq, updated_at: new Date().toISOString() }).eq("id", sessionId);
      // Test sessions only ever emailed the tester (address not stored) -> no cancel mail.
      if (s.is_test) return json(req, { ok: true });
      const attendees = await attendeesFor((s.entry_role_assignment_id as string) || null);
      const ics = buildIcs({ uid: String(s.ics_uid), seq: newSeq, method: "CANCEL", start: new Date(String(s.scheduled_at)), duration: Number(s.duration_minutes) || 30, title: String(s.title), joinUrl: String(s.zoom_join_url || ""), attendees });
      const html = `<p>The innovation jury session <strong>${String(s.title)}</strong> has been <strong>cancelled</strong>. The calendar entry will be removed.</p>`;
      for (const a of attendees) { try { await sendInvite(a.email, `Cancelled: ${String(s.title)}`, html, ics); } catch (e) { console.error(e); } }
      return json(req, { ok: true });
    }

    return json(req, { error: "Unknown action" }, 400);
  } catch (e) {
    console.error("sm26-jury-session error", e);
    return json(req, { error: String((e as Error).message || e) }, 500);
  }
});
