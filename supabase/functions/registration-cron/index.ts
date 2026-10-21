// registration-cron -- the timed jobs of the registration core (spec regspec-en.md §4.2;
// contract docs/registration-contract.md §5 of the DB lane).
//
// Called by pg_cron through public.invoke_registration_cron(job) with the Vault service
// key (migration 20261009210000_registration_core):
//   POST {"job": "provision"}  every minute  -> provision-person {action:"run"}
//                              (Phase 3: was every 5 min; every minute makes the account
//                              e-mail of a WYS guest arrive one to two minutes after the QR
//                              e-mail. The schedule is the database's: cron job
//                              registration-cron-provision.)
//   POST {"job": "outbox"}     every minute  -> the notification outbox (Phase 3, below)
//   POST {"job": "reminders"}  hourly at :10 -> reminders, absentee follow-up, event digests
//   POST {"job": "digest"}     08:00 Monaco  -> staff_review_digest
// The SQL invoker already skips a job whose flag is off; this function checks again
// (kill switch). {"force": true} runs a job whatever its flag (manual run by staff of
// M3 with the service key, e.g. a canary test). While its flag is off, a forced outbox or
// provision run must NAME its rows, or it is refused (400): {"job":"outbox","force":true,
// "ids":[notification_outbox ids]} (those rows go at once: no wait for a new row or a
// back-off), {"job":"provision","force":true,"job_ids":[...]} (provision-person then takes
// only jobs of hidden test events). A canary test never e-mails the real queue.
//
// Notification outbox (Phase 3; registration contract §10.5). The database queues e-mails
// in public.notification_outbox (Phase 2: account_under_review, team_join_request; Phase 3
// review decisions: user_account_approved, user_account_rejected, account_info_requested,
// company_validated, claim_approved, claim_declined; article comments, 21 Oct 2026:
// comment_mention, comment_report, sent by send-notification from the database's own words,
// resource_comment_email). This job sends the ones nobody sent:
//   - only while registration_flags.outbox_sender is JSON true (off until go-live; M3 may
//     turn it on earlier), or with force;
//   - each kind goes through the function that owns its template: send-notification
//     (Phase 2 kinds) or send-status-notification (decisions), with the service key;
//   - before claiming anything, it asks each function whether the DEPLOYED version knows
//     the kind (a request that cannot send: send-notification {type} alone answers 400
//     "Could not resolve the row ..." when it knows the type and 400 "Unknown notification
//     type" when it is main's older version; send-status-notification {action:"types"}
//     lists its types, the old version answers 400). A kind the deployed version does not
//     know is NOT claimed: its rows stay queued with their attempts untouched, and each
//     row is marked once (last_error "held: ...") and logged once; they leave on their own
//     once the go-live version is deployed;
//   - a row is claimed alone with a compare-and-set on attempts (the same claim
//     notification_outbox_claim makes: claimed_at = now, attempts + 1), so two runs, or a
//     run and the RPC, never send one row twice. notification_outbox_claim itself is not
//     used: it cannot skip a kind, wait out a back-off or leave the newest rows alone;
//   - rows younger than OUTBOX_MIN_AGE_MS are left to the page that queued them (it asks
//     send-notification right away; two senders at once could both pass its checks);
//   - held rows are read apart from the others, and only on a recheck (once a quarter of an
//     hour), so however many pile up they never push the rows that can go out of the scan;
//     a held account_under_review, team_join_request or decision whose news is out of date
//     (below) is settled then, without waiting for its sender;
//   - a row whose news is out of date is settled WITHOUT sending (sent_at set, last_error
//     "not sent: ..."): a team_join_request whose invitation is no longer join_requested
//     (or is past its expiry), an account_under_review whose person is no longer pending
//     or that waited more than 3 days, a decision of M3 queued more than 72 hours ago
//     ("not sent: stale: ...", contract §11.7: nothing old leaves in a burst on the day the
//     sender is switched on), a decision the database no longer shows
//     (send-status-notification answers 409 stale), a row the go-live send-notification
//     could not resolve twice in a row (no real owner, no address: 400 "Could not resolve
//     the row this notification is about");
//   - sent: notification_outbox_done(id) (the sending function marks it too). An answer
//     {skipped, reason: "duplicate"} is NOT taken for a send: send-notification also gives
//     it when the same e-mail was only TRIED less than 10 minutes ago (it logs the try
//     before calling the provider, so a provider error leaves the log). The row is read
//     again: marked sent = done; otherwise it counts as a failed attempt and waits 11
//     minutes (out of that window) before the next one;
//   - failed: last_error "attempt n failed: ...", the claim kept; retried after 2 min,
//     10 min, 30 min, then 2 h (a 429 of send-notification's daily cap: a day later);
//     after the 5th attempt the row stays unsent ("gave up ...", in the daily review
//     digest; only those that gave up within the last 24 hours make it go out).
//   Never twice, with one exception: send-notification sent the e-mail but could not mark
//   the row (notification_outbox_done failed). The duplicate answer then comes back, the
//   row is retried after the 10-minute window, and the person gets it a second time.
//
// verify_jwt = TRUE, and the caller must hold a service-role key (checked below: any
// valid user JWT passes the gateway, so the gateway check alone is not enough).
//
// Reminders (core_v2 events only; wys26 e-mails stay with the frozen guest-list):
//   gl_event.reminders = ISO-8601 durations before the start. Empty = the default of the
//   kind: webinar P7D, P1D, PT1H (the join link) / on-site P7D (practical information and
//   the entry QR). gl_event.settings.no_reminders = true turns them off for one event.
//   Only CONFIRMED rows. A reminder is due 30 minutes early (the job runs hourly: "1 hour
//   before" arrives 30 to 90 minutes before the start). When several reminders are due at
//   once (a late registration), only the nearest is sent; a reminder whose window started
//   before the person was confirmed (decided_at, created_at, or the latest confirmation
//   e-mail for a reactivated row) is skipped: they just got the confirmation. Each duration is stamped in
//   gl_guest.reminders_sent before sending (claimed with updated_at, so two runs never
//   send the same reminder) and unstamped if the send fails.
//   Flags: webinar_v2 for webinars, onsite_v2 for on-site events. Hidden test events are
//   served whenever the job runs, but pg_cron wakes it only when one of those flags is on:
//   a canary test with both flags off needs a manual POST {"job":"reminders","force":true}
//   with the service key.
// Absentee follow-up (webinars, Victor 9 Oct): after the end, confirmed registrants who
//   were not checked in get "Sorry we missed you" with the replay link
//   (gl_event.replay_url, else events.replay_url). No replay yet: the follow-up waits
//   48 h, then goes without it, and "The replay is available" follows if the link is
//   added within 14 days. Who came = checked_in_at (staff mark the attendees in the
//   event's Registrations tab, gl_checkin_v2, e.g. from the webinar tool's list).
//   Absentees are known when gl_event.settings.attendance_recorded is true, or, when that
//   setting is absent, once at least one person is marked AND nobody was marked in the
//   last 30 minutes (the marking is over: a list half marked never turns everyone else
//   into an absentee). attendance_recorded = false: never. Until absentees are known only
//   the replay is sent, worded for everyone, and nothing goes without a replay.
//   Stamped as reminders_sent.followup / .replay.
// Opt-out: reminders_sent.off (the "Stop reminders" link of the status page, action
//   "reminders" of the registration function) and, for a registration linked to an
//   account, notification_prefs.events = false (the signed unsubscribe link).
// Every send is logged in gl_email_log (kind reg_reminder_<duration>, reg_followup,
// reg_replay_available, reg_staff_digest, staff_review_digest).
//
// This file must not contain a literal backslash-u escape (the MCP deploy mangles them).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import QRCode from "https://esm.sh/qrcode@1.5.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const SITE_URL = (Deno.env.get("SITE_URL") || "https://smartmarinaconnect.com").replace(/\/+$/, "");
const REG_SITE = (Deno.env.get("REGISTRATION_SITE_URL") || SITE_URL).replace(/\/+$/, "");
const FROM_ADDRESS = "noreply@smartmarinaconnect.com";
const PLATFORM_FROM = `Smart Marina Connect <${FROM_ADDRESS}>`;

const DEFAULT_REMINDERS: Record<string, string[]> = { webinar: ["P7D", "P1D", "PT1H"], onsite: ["P7D"] };
const FOLLOWUP_AFTER_MS = 3600000; // 1 h after the end
const FOLLOWUP_NO_REPLAY_AFTER_MS = 48 * 3600000;
const FOLLOWUP_WINDOW_MS = 14 * 86400000;
// The job runs at :10 every hour: a reminder is due this much before its exact time, so
// "1 hour before" arrives 30 to 90 minutes before the start (never 5 minutes before).
const REMINDER_LEAD_MS = 30 * 60000;
// Attendance marks older than this = the marking is over (absentee follow-up).
const ATTENDANCE_SETTLE_MS = 30 * 60000;

const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });

// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const clean = (s: unknown, max = 200) => (typeof s === "string" ? s.trim().slice(0, max) : "");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// ─── Caller: service role only (same check as send-profile-reminders) ────────
function sameSecret(a: string, b: string): boolean {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** Unverified read of a JWT's "role" claim -- only a pre-filter, never trusted alone. */
function jwtRole(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

/** The env service-role key, or another JWT that claims service_role AND that GoTrue accepts on an admin endpoint. */
async function isServiceRole(token: string): Promise<boolean> {
  if (!token) return false;
  if (sameSecret(token, SERVICE_ROLE)) return true;
  if (jwtRole(token) !== "service_role") return false;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1`, {
      headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY || token },
    });
    await r.body?.cancel();
    return r.ok;
  } catch {
    return false;
  }
}

// ─── Flags, events, dates ────────────────────────────────────────────────────
type Flags = Record<string, boolean>;
async function loadFlags(): Promise<Flags> {
  const out: Flags = {};
  const { data } = await db.from("platform_settings").select("value").eq("key", "registration_flags").maybeSingle();
  for (const [k, x] of Object.entries(obj((data as Json | null)?.value))) out[k] = x === true;
  return out;
}

type Ctx = { ev: Json; cat: Json | null; title: string; startsAt: Date | null; endsAt: Date | null; location: string; eventId: string | null; tz: string };

const CAT_COLS = "id, title, date_time, end_date_time, is_full_day, location, image_url, published, replay_url, meeting_url";

function tryDate(v: unknown): Date | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function tzOf(ev: Json): string {
  const tz = typeof ev.settings?.timezone === "string" ? ev.settings.timezone : "";
  if (tz) {
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: tz });
      return tz;
    } catch { /* fall through */ }
  }
  return "Europe/Monaco";
}

/** Same rule as public.gl_event_window(). */
function ctxOf(ev: Json, cat: Json | null): Ctx {
  const s = obj(ev.settings);
  const catStart = tryDate(cat?.date_time);
  const startsAt = catStart || tryDate(s.starts_at);
  let endsAt = tryDate(cat?.end_date_time) || tryDate(s.ends_at);
  if (!endsAt && catStart) endsAt = new Date(catStart.getTime() + (cat?.is_full_day ? 86400000 : 7200000));
  if (!endsAt && startsAt) endsAt = new Date(startsAt.getTime() + 7200000);
  const venue = [clean(s.venue, 120), clean(s.city, 80)].filter(Boolean).join(", ");
  return {
    ev,
    cat,
    title: clean(cat?.title, 200) || clean(ev.title, 200) || "Smart Marina Connect event",
    startsAt,
    endsAt,
    location: ev.kind === "webinar" ? "Online" : clean(cat?.location, 200) || venue,
    eventId: cat?.id || null,
    tz: tzOf(ev),
  };
}

/** Every core_v2 event, with its catalogue row. */
async function loadV2Events(): Promise<Ctx[]> {
  const { data: evs } = await db.from("gl_event").select("*").eq("engine", "core_v2");
  const list = (evs as Json[] | null) || [];
  const ids = list.map((e) => e.legacy_event_id).filter(Boolean);
  const cats = new Map<string, Json>();
  if (ids.length) {
    const { data } = await db.from("events").select(CAT_COLS).in("id", ids);
    for (const c of (data as Json[] | null) || []) cats.set(c.id, c);
  }
  return list.map((e) => ctxOf(e, e.legacy_event_id ? cats.get(e.legacy_event_id) || null : null));
}

const joinUrlOf = (ctx: Ctx): string | null => {
  const u = clean(ctx.ev.meeting_url, 1000) || clean(ctx.cat?.meeting_url, 1000);
  return /^https:\/\//i.test(u) ? u : null;
};
const replayUrlOf = (ctx: Ctx): string | null => {
  const u = clean(ctx.ev.replay_url, 1000) || clean(ctx.cat?.replay_url, 1000);
  return /^https:\/\//i.test(u) ? u : null;
};
// Links of an event's e-mails: the live site for every real event (the door QR is printed);
// REGISTRATION_SITE_URL only for hidden test events (canaries before the redesign is live).
const siteFor = (ctx: Ctx) => (ctx.ev.hidden === true ? REG_SITE : SITE_URL);
const eventPageUrl = (ctx: Ctx): string | null => (ctx.eventId ? `${siteFor(ctx)}/events/${ctx.eventId}` : null);
const passUrl = (ctx: Ctx, checkinToken: string) => `${siteFor(ctx)}/admin/guest-list/${ctx.ev.slug}/checkin?token=${checkinToken}`;
const adminUrl = (ctx: Ctx) => (ctx.eventId ? `${siteFor(ctx)}/admin/events/${ctx.eventId}` : `${siteFor(ctx)}/admin/events`);
const practicalInfo = (ctx: Ctx): string => clean(ctx.ev.settings?.practical_info, 2000) || clean(ctx.ev.settings?.programme_note, 2000);

function fmtDate(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d);
}
function fmtTime(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}
function tzLabel(d: Date, tz: string): string {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, timeZoneName: "short" }).formatToParts(d).find((x) => x.type === "timeZoneName");
  return p?.value || tz;
}
function whenText(ctx: Ctx): string {
  const s = ctx.startsAt;
  if (!s) return clean(ctx.ev.settings?.date_label, 120) || "Date to be announced";
  const tz = ctx.tz;
  const realEnd = tryDate(ctx.cat?.end_date_time) || tryDate(ctx.ev.settings?.ends_at);
  if (ctx.cat?.is_full_day) {
    return realEnd && fmtDate(realEnd, tz) !== fmtDate(s, tz) ? `${fmtDate(s, tz)} to ${fmtDate(realEnd, tz)}` : fmtDate(s, tz);
  }
  const e = ctx.endsAt;
  if (e && fmtDate(e, tz) === fmtDate(s, tz)) return `${fmtDate(s, tz)}, ${fmtTime(s, tz)}–${fmtTime(e, tz)} (${tzLabel(s, tz)})`;
  return `${fmtDate(s, tz)}, ${fmtTime(s, tz)} (${tzLabel(s, tz)})`;
}

function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.[0-9]{3}/, "");
}
function icsEsc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
function icsFold(line: string): string {
  if (line.length <= 73) return line;
  const out = [line.slice(0, 73)];
  for (let i = 73; i < line.length; i += 72) out.push(" " + line.slice(i, i + 72));
  return out.join("\r\n");
}
function buildIcs(ctx: Ctx, joinUrl: string | null): string | null {
  if (!ctx.startsAt) return null;
  const end = ctx.endsAt || new Date(ctx.startsAt.getTime() + 3600000);
  const page = eventPageUrl(ctx);
  const desc = [joinUrl ? `Join link: ${joinUrl}` : "", page ? `Event page: ${page}` : ""].filter(Boolean).join("\n");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Smart Marina Connect//Registration//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:reg-${ctx.ev.id}@smartmarinaconnect.com`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(ctx.startsAt)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsEsc(ctx.title)}`,
    desc ? `DESCRIPTION:${icsEsc(desc)}` : "",
    `LOCATION:${icsEsc(joinUrl || ctx.location || "Online")}`,
    page ? `URL:${page}` : "",
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean).map(icsFold).join("\r\n");
}

function b64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** ISO-8601 duration of gl_event.reminders (contract: ^P(T?[0-9]+[DHMW])+$) in ms, or null. */
function durationMs(d: string): number | null {
  if (!/^P(T?[0-9]+[DHMW])+$/.test(d)) return null;
  let ms = 0;
  let inTime = false;
  for (const m of d.slice(1).matchAll(/(T?)([0-9]+)([DHMW])/g)) {
    if (m[1]) inTime = true;
    const n = Number(m[2]);
    const unit = m[3];
    ms += unit === "W" ? n * 7 * 86400000 : unit === "D" ? n * 86400000 : unit === "H" ? n * 3600000 : inTime ? n * 60000 : n * 30 * 86400000;
  }
  return ms > 0 ? ms : null;
}

function remindersOf(ctx: Ctx): Array<{ key: string; ms: number }> {
  if (ctx.ev.settings?.no_reminders === true) return [];
  const list = Array.isArray(ctx.ev.reminders) && ctx.ev.reminders.length ? ctx.ev.reminders : DEFAULT_REMINDERS[ctx.ev.kind] || [];
  const out: Array<{ key: string; ms: number }> = [];
  for (const k of list) {
    const ms = typeof k === "string" ? durationMs(k) : null;
    if (ms && !out.some((x) => x.key === k)) out.push({ key: k, ms });
  }
  return out.sort((a, b) => a.ms - b.ms);
}

// ─── E-mail ──────────────────────────────────────────────────────────────────
// The shared layout (refonte look, same frame as the Mailchimp welcome e-mail) is pasted
// below. Keep it identical in every function that sends an e-mail: docs/email-layout.ts,
// checked by `node scripts/email-previews.mjs --check`.
// ---- SMC e-mail layout v1 (keep identical in every function) ----
// Shared look of every Smart Marina Connect service e-mail: the refonte design, the same
// frame as the Mailchimp welcome e-mail (navy band, 4 px sky-blue rule, white 600 px card on a
// pale page, sky-blue pill button, teal eyebrow, light footer). Pure functions: no import, no
// Deno API, no network. Reference copy: docs/email-layout.ts. Rules: docs/email-design.md.
//
// CONTRACT. Every string passed as HTML (title, eyebrow, greeting, bodyHtml, labels, urls,
// notes) must ALREADY be HTML-safe: escape whatever a user or a database row wrote with
// emEsc() first. Only trusted template markup (<strong>, <br>, entities) may stay raw.
// emText() works on plain, unescaped text.
const EM = {
  brand: "Smart Marina Connect",
  byline: "by M3 Monaco",
  site: "https://smartmarinaconnect.com",
  logo: "https://smartmarinaconnect.com/logo-white.png",
  contact: "events@m3monaco.com",
  navy: "#0b2653",
  accent: "#7cc4f0", // sky blue (site accent since 21 Oct 2026); navy text on it
  teal: "#1f7a8c",
  ink: "#1f2937",
  muted: "#5b6475",
  line: "#e3e7ee",
  page: "#eef2f8",
  soft: "#f6f7f9",
  white: "#ffffff",
  font: "Arial, Helvetica, sans-serif",
  mono: "'Courier New', Courier, monospace",
};

function emEsc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function emStripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "");
}

/** A body paragraph (HTML-safe content). */
function emP(html: string, gap = 16): string {
  return `<p style="margin:0 0 ${gap}px;font-family:${EM.font};font-size:16px;line-height:25px;color:${EM.ink};">${html}</p>`;
}

/** The sky-blue pill button. `label` and `url` are HTML-safe. */
function emButton(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="${EM.accent}" style="border-radius:999px;background-color:${EM.accent};"><a href="${url}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${EM.font};font-size:16px;line-height:20px;font-weight:bold;color:${EM.navy};text-decoration:none;border-radius:999px;">${label} &rarr;</a></td></tr></table>`;
}

/** A bold underlined text link (secondary action). */
function emLink(label: string, url: string): string {
  return `<a href="${url}" target="_blank" style="color:${EM.navy};font-weight:bold;text-decoration:underline;">${label}</a>`;
}

/** Label / value rows. Labels render as small teal capitals; both sides are HTML-safe. */
function emInfoTable(rows: Array<[string, string]>): string {
  if (!rows.length) return "";
  const last = rows.length - 1;
  const tr = rows
    .map(([k, v], i) => {
      const edge = `border-top:1px solid ${EM.line};${i === last ? `border-bottom:1px solid ${EM.line};` : ""}`;
      return `<tr><td valign="top" width="36%" style="padding:11px 12px 11px 0;${edge}font-family:${EM.font};font-size:12px;line-height:20px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${EM.teal};">${k}</td><td valign="top" style="padding:11px 0;${edge}font-family:${EM.font};font-size:15px;line-height:20px;color:${EM.ink};word-break:break-word;">${v}</td></tr>`;
    })
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:2px 0 18px;">${tr}</table>`;
}

/** A highlighted quote or reason: pale box, sky-blue left rule, optional small-caps label. */
function emNote(html: string, label?: string): string {
  const head = label
    ? `<span style="display:block;margin:0 0 4px;font-size:12px;line-height:16px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${EM.teal};">${label}</span>`
    : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:2px 0 18px;"><tr><td bgcolor="${EM.soft}" style="background-color:${EM.soft};border-left:4px solid ${EM.accent};padding:14px 18px;font-family:${EM.font};font-size:15px;line-height:23px;color:${EM.ink};">${head}${html}</td></tr></table>`;
}

/** A code to read or type (verification code, organization code). `code` is HTML-safe. */
function emCode(code: string): string {
  return `<span style="display:inline-block;padding:12px 22px;background-color:${EM.soft};border:1px solid ${EM.line};border-radius:10px;font-family:${EM.mono};font-size:26px;line-height:32px;font-weight:bold;letter-spacing:5px;color:${EM.navy};">${code}</span>`;
}

function emBullets(items: string[]): string {
  const rows = items
    .map(
      (it) =>
        `<tr><td valign="top" width="18" style="padding:0 0 6px;font-family:${EM.font};font-size:16px;line-height:25px;font-weight:bold;color:${EM.teal};">&bull;</td><td valign="top" style="padding:0 0 6px;font-family:${EM.font};font-size:16px;line-height:25px;color:${EM.ink};">${it}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;">${rows}</table>`;
}

// Turns an HTML-safe text body into paragraphs. Blank line = new paragraph, line break =
// <br>. Three conventions are recognised (everything else stays a plain paragraph):
//   "• item" lines                         -> bullet list
//   "Reason: ..." / "Feedback: ..." / "Message: ..." / "Moderator notes: ..." paragraph
//                                          -> note box
//   trailing "Date:" / "Location:" / "Payment type:" / "Transaction ID:" /
//   "Organization:" / "Deadline:" lines    -> info table
const EM_NOTE_RE = /^(Reason provided by our team|Reason|Feedback|Moderator notes|Message):[ \t]*/;
const EM_ROW_RE = /^(Date|Location|Payment type|Transaction ID|Organization|Deadline):[ \t]*(.*)$/;
const EM_BULLET_RE = /^•[ \t]+(.*)$/;

function emBlock(block: string): string {
  const note = block.match(EM_NOTE_RE);
  if (note) {
    const rest = block.slice(note[0].length).replace(/^\n+/, "").trim().replace(/\n/g, "<br>");
    return emNote(rest, note[1]);
  }
  const lines = block.split("\n");
  const rows: Array<[string, string]> = [];
  while (lines.length) {
    const m = lines[lines.length - 1].match(EM_ROW_RE);
    if (!m) break;
    rows.unshift([m[1], m[2]]);
    lines.pop();
  }
  const out: string[] = [];
  let run: string[] = [];
  let bullets: string[] = [];
  const flushRun = (beforeBullets: boolean) => {
    if (run.length) out.push(emP(run.join("<br>"), beforeBullets ? 8 : 16));
    run = [];
  };
  const flushBullets = () => {
    if (bullets.length) out.push(emBullets(bullets));
    bullets = [];
  };
  for (const line of lines) {
    const b = line.match(EM_BULLET_RE);
    if (b) {
      flushRun(true);
      bullets.push(b[1]);
    } else {
      flushBullets();
      run.push(line);
    }
  }
  flushRun(false);
  flushBullets();
  if (rows.length) out.push(emInfoTable(rows));
  return out.join("\n");
}

function emTextToHtml(safe: string): string {
  const text = safe
    .replace(/\r\n?/g, "\n")
    .replace(/<strong>/g, `<strong style="color:${EM.navy};">`)
    .trim();
  if (!text) return "";
  return text
    .split(/\n\s*\n/)
    .map(emBlock)
    .filter(Boolean)
    .join("\n");
}

interface EmailLayoutInput {
  /** <title> of the page. */
  pageTitle?: string;
  /** Inbox preview line, hidden in the body. */
  preheader?: string;
  /** Small teal capitals above the title. */
  eyebrow?: string;
  /** Main heading; empty = none (introductions). */
  title?: string;
  /** "Hello Alex," */
  greeting?: string;
  /** Body, built with emP / emTextToHtml / emInfoTable / emNote / emCode. */
  bodyHtml: string;
  /** Sky-blue pill button; showUrl prints the link under it for clients that block buttons. */
  cta?: { label: string; url: string; showUrl?: boolean };
  /** Text link under the button. */
  secondary?: { label: string; url: string };
  /** Closing lines in body size ("Best regards, ..."). */
  signoff?: string;
  /** Small muted line under the content ("If you did not ask for this, ..."). */
  footerNote?: string;
  /** Footer: why the recipient gets this e-mail. */
  reason?: string;
  /** Footer: extra small links (preferences...). */
  footerLinks?: Array<{ label: string; url: string }>;
  lang?: string;
}

function emailLayout(o: EmailLayoutInput): string {
  const f = EM.font;
  const preheader = o.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${EM.page};opacity:0;">${o.preheader}${"&zwnj;&nbsp;".repeat(40)}</div>`
    : "";
  const eyebrow = o.eyebrow
    ? `<p style="margin:0 0 10px;font-family:${f};font-size:12px;line-height:16px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${EM.teal};">${o.eyebrow}</p>`
    : "";
  const title = o.title
    ? `<h1 class="h1" style="margin:0 0 18px;font-family:${f};font-size:26px;line-height:32px;font-weight:bold;color:${EM.navy};">${o.title}</h1>`
    : "";
  const greeting = o.greeting ? emP(o.greeting) : "";
  const showUrl = o.cta?.showUrl
    ? `<p style="margin:14px 0 0;font-family:${f};font-size:13px;line-height:19px;color:${EM.muted};word-break:break-all;">If the button does not work, copy this link into your browser:<br><a href="${o.cta.url}" style="color:${EM.muted};text-decoration:underline;">${o.cta.url}</a></p>`
    : "";
  const secondary = o.secondary
    ? `<p style="margin:16px 0 0;font-family:${f};font-size:15px;line-height:22px;">${emLink(o.secondary.label, o.secondary.url)}</p>`
    : "";
  const cta = o.cta
    ? `<tr><td class="px" align="left" style="padding:8px 40px 8px;">${emButton(o.cta.label, o.cta.url)}${showUrl}${secondary}</td></tr>`
    : o.secondary
      ? `<tr><td class="px" align="left" style="padding:0 40px 8px;">${secondary}</td></tr>`
      : "";
  const signoff = o.signoff
    ? `<tr><td class="px" style="padding:18px 40px 0;font-family:${f};font-size:16px;line-height:25px;color:${EM.ink};">${o.signoff}</td></tr>`
    : "";
  const note = o.footerNote
    ? `<tr><td class="px" style="padding:22px 40px 32px;"><div style="border-top:1px solid ${EM.line};padding-top:16px;font-family:${f};font-size:14px;line-height:21px;color:${EM.muted};">${o.footerNote}</div></td></tr>`
    : `<tr><td style="height:28px;line-height:28px;font-size:0;">&nbsp;</td></tr>`;
  const reason = o.reason ? `<p style="margin:10px 0 0;">${o.reason}</p>` : "";
  const links = o.footerLinks && o.footerLinks.length
    ? `<p style="margin:10px 0 0;">${o.footerLinks
        .map((l) => `<a href="${l.url}" style="color:${EM.muted};text-decoration:underline;">${l.label}</a>`)
        .join(" &nbsp;&middot;&nbsp; ")}</p>`
    : "";
  return `<!DOCTYPE html>
<html lang="${o.lang || "en"}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${o.pageTitle || o.title || EM.brand}</title>
<style>
  :root { color-scheme: light; supported-color-schemes: light; }
  body { margin: 0; padding: 0; background: ${EM.page}; }
  a { color: ${EM.navy}; }
  @media only screen and (max-width: 620px) {
    .container { width: 100% !important; }
    .px { padding-left: 24px !important; padding-right: 24px !important; }
    .h1 { font-size: 23px !important; line-height: 29px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${EM.page};" bgcolor="${EM.page}">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${EM.page}" style="background-color:${EM.page};">
<tr><td align="center" style="padding:32px 12px;">
<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${EM.white}" style="width:100%;max-width:600px;background-color:${EM.white};border-radius:16px;overflow:hidden;">
<tr><td class="px" bgcolor="${EM.navy}" style="background-color:${EM.navy};padding:24px 40px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle" style="padding-right:12px;"><img src="${EM.logo}" width="22" alt="" style="display:block;width:22px;height:auto;border:0;"></td>
<td valign="middle" style="font-family:${f};font-size:18px;line-height:24px;font-weight:bold;color:${EM.white};letter-spacing:0.2px;">${EM.brand}</td>
</tr></table>
</td></tr>
<tr><td bgcolor="${EM.accent}" style="height:4px;line-height:4px;font-size:0;background-color:${EM.accent};">&nbsp;</td></tr>
<tr><td class="px" style="padding:34px 40px 6px;">
${eyebrow}${title}${greeting}
${o.bodyHtml}
</td></tr>
${cta}
${signoff}
${note}
<tr><td class="px" bgcolor="${EM.soft}" style="background-color:${EM.soft};padding:22px 40px;font-family:${f};font-size:12px;line-height:18px;color:${EM.muted};">
<p style="margin:0 0 6px;font-weight:bold;">${EM.brand} &middot; ${EM.byline}</p>
<p style="margin:0 0 6px;">Questions? <a href="mailto:${EM.contact}" style="color:${EM.muted};text-decoration:underline;">${EM.contact}</a></p>
<p style="margin:0;"><a href="${EM.site}" style="color:${EM.muted};text-decoration:underline;">smartmarinaconnect.com</a></p>
${reason}${links}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** Plain-text alternative of an e-mail. Every field is plain, unescaped text without markup (strip tags with emStripTags first). */
function emText(o: {
  title?: string;
  greeting?: string;
  body: string;
  cta?: { label: string; url: string };
  secondary?: { label: string; url: string };
  signoff?: string;
  footerNote?: string;
  reason?: string;
  links?: Array<{ label: string; url: string }>;
}): string {
  const out: string[] = [];
  if (o.title) out.push(o.title, "");
  if (o.greeting) out.push(o.greeting, "");
  const body = o.body.trim();
  if (body) out.push(body, "");
  if (o.cta) out.push(`${o.cta.label}: ${o.cta.url}`, "");
  if (o.secondary) out.push(`${o.secondary.label}: ${o.secondary.url}`, "");
  if (o.signoff) out.push(o.signoff.trim(), "");
  out.push("---");
  if (o.footerNote) out.push(o.footerNote.trim(), "");
  out.push(`${EM.brand} · ${EM.byline}`, `Questions? ${EM.contact}`, EM.site);
  if (o.reason) out.push("", o.reason);
  if (o.links) for (const l of o.links) out.push(`${l.label}: ${l.url}`);
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
// ---- end SMC e-mail layout ----

// The personal unsubscribe link of a registration linked to an account (category
// "events"), verified by the unsubscribe function.
// ---- SMC unsubscribe token v1 (keep identical in send-notification and unsubscribe) ----
// token = base64url(payload JSON) + "." + base64url(HMAC-SHA-256(key, first part)),
// payload = { v: 1, u: <user id>, c: <notification category or "all">, iat: <unix s> },
// key = SHA-256("smc-unsubscribe-v1:" + service-role key): no extra secret to set. A
// token made under an older service-role key no longer verifies (the page then
// offers the preferences page after signing in).
const UNSUB_KEY_PREFIX = "smc-unsubscribe-v1:";
let unsubKeyCache: { secret: string; key: Promise<CryptoKey> } | null = null;

function unsubKey(secret: string): Promise<CryptoKey> {
  if (!unsubKeyCache || unsubKeyCache.secret !== secret) {
    const key = crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(UNSUB_KEY_PREFIX + secret))
      .then((raw) => crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]));
    unsubKeyCache = { secret, key };
  }
  return unsubKeyCache.key;
}

function unsubB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unsubUnB64(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** A signed unsubscribe token for one account and one category ("all" for every optional one). */
async function signUnsubToken(secret: string, userId: string, category: string): Promise<string> {
  const body = unsubB64(new TextEncoder().encode(JSON.stringify({ v: 1, u: userId, c: category, iat: Math.floor(Date.now() / 1000) })));
  const sig = await crypto.subtle.sign("HMAC", await unsubKey(secret), new TextEncoder().encode(body));
  return `${body}.${unsubB64(new Uint8Array(sig))}`;
}

/** The token's account and category, or null when it is malformed or not signed with the current key. */
async function verifyUnsubToken(secret: string, token: unknown): Promise<{ userId: string; category: string; issuedAt: number } | null> {
  if (!secret || typeof token !== "string" || token.length > 600) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const sig = unsubUnB64(parts[1]);
  const raw = unsubUnB64(parts[0]);
  if (!sig || sig.length !== 32 || !raw) return null;
  const valid = await crypto.subtle.verify("HMAC", await unsubKey(secret), sig, new TextEncoder().encode(parts[0]));
  if (!valid) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(raw));
    if (!p || p.v !== 1 || typeof p.u !== "string" || typeof p.c !== "string" || typeof p.iat !== "number") return null;
    if (!/^[a-z0-9_]{1,40}$/.test(p.c)) return null;
    return { userId: p.u, category: p.c, issuedAt: p.iat };
  } catch {
    return null;
  }
}
// ---- end SMC unsubscribe token ----

type Mail = { subject: string; html: string; text: string };
type Attachment = { filename: string; content: string; content_type: string; content_id?: string };
type OptOut = { label: string; url: string; oneClick?: string };

const h = (v: unknown) => emEsc(String(v ?? ""));
const strong = (v: unknown) => `<strong style="color:${EM.navy};">${h(v)}</strong>`;
const hello = (g: Json) => `Hello ${clean(g.first_name, 80) || "there"},`;
const eventLineOf = (ctx: Ctx) => [whenText(ctx), ctx.location].filter(Boolean).join(" · ");

/** A registration e-mail in the shared frame, with the opt-out line of reminders. */
function cronMail(ctx: Ctx | null, subject: string, o: {
  eyebrow?: string;
  title: string;
  greeting?: string;
  body: string;
  text: string;
  preheader?: string;
  cta?: { label: string; url: string };
  secondary?: { label: string; url: string };
  note?: string;
  optOut?: OptOut;
}): Mail {
  const line = ctx ? eventLineOf(ctx) : "";
  const footerHtml = [o.note ? h(o.note) : "", line ? h(line) : ""].filter(Boolean).join("<br>");
  const footerText = [o.note || "", line].filter(Boolean).join("\n");
  const reason = ctx && o.optOut ? `You receive this e-mail because you registered for ${ctx.title}.` : "";
  return {
    subject,
    html: emailLayout({
      pageTitle: h(o.title),
      preheader: o.preheader ? h(o.preheader) : undefined,
      eyebrow: h(o.eyebrow ?? ctx?.title ?? ""),
      title: h(o.title),
      greeting: o.greeting ? h(o.greeting) : undefined,
      bodyHtml: o.body,
      cta: o.cta ? { label: h(o.cta.label), url: h(o.cta.url) } : undefined,
      secondary: o.secondary ? { label: h(o.secondary.label), url: h(o.secondary.url) } : undefined,
      footerNote: footerHtml || undefined,
      reason: reason ? h(reason) : undefined,
      footerLinks: o.optOut ? [{ label: h(o.optOut.label), url: h(o.optOut.url) }] : undefined,
    }),
    text: emText({
      title: o.title,
      greeting: o.greeting,
      body: o.text,
      cta: o.cta,
      secondary: o.secondary,
      footerNote: footerText || undefined,
      reason: reason || undefined,
      links: o.optOut ? [{ label: o.optOut.label, url: o.optOut.url }] : undefined,
    }),
  };
}

/** reg_reminder: before a webinar (join link) or an on-site event (practical information, QR "passqr"). */
function renderReminder(ctx: Ctx, g: Json, r: { key: string; ms: number }, links: { status: string | null; join: string | null; qr: boolean; optOut: OptOut }): Mail {
  const when = whenText(ctx);
  const soon = r.ms <= 2 * 3600000;
  const tomorrow = !soon && r.ms <= 36 * 3600000;
  const webinar = ctx.ev.kind === "webinar";
  const subject = soon ? `Starting soon: ${ctx.title}` : tomorrow ? `Tomorrow: ${ctx.title}` : `Coming up: ${ctx.title}`;
  const title = soon ? (webinar ? "The webinar starts soon" : "See you soon") : tomorrow ? "See you tomorrow" : "Coming up soon";
  const rows: Array<[string, string]> = [["When", h(when)], ["Where", h(ctx.location || (webinar ? "Online" : ""))]];
  if (webinar) rows.push(["Join link", links.join ? emLink(h("Join the webinar"), h(links.join)) : h("We will send it before the start.")]);
  const info = webinar ? "" : practicalInfo(ctx);
  const intro = `This is a reminder of ${ctx.title}.`;
  const qrCaption = "Your entry QR code is attached as entry-pass.png. Show it at the entrance, or just give your name at the desk.";
  const qrBlock = links.qr
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 20px;"><tr><td align="center" bgcolor="${EM.soft}" style="background-color:${EM.soft};border-radius:12px;padding:22px 18px;"><img src="cid:passqr" alt="Entry QR code" width="200" height="200" style="display:block;margin:0 auto;border:1px solid ${EM.line};border-radius:8px;padding:8px;background-color:#ffffff;" /><p style="margin:14px 0 0;font-family:${EM.font};font-size:13px;line-height:19px;color:${EM.muted};text-align:center;">${h(qrCaption)}</p></td></tr></table>`
    : "";
  const joinCta = webinar && links.join && (soon || tomorrow) ? { label: "Join the webinar", url: links.join } : undefined;
  const statusLink = links.status ? { label: "View my registration", url: links.status } : eventPageUrl(ctx) ? { label: "Open the event page", url: eventPageUrl(ctx) as string } : undefined;
  return cronMail(ctx, subject, {
    title,
    greeting: hello(g),
    preheader: `${ctx.title}: ${when}`,
    body: emP(`This is a reminder of ${strong(ctx.title)}.`, 10) + emInfoTable(rows.filter(([, v]) => v)) + qrBlock +
      (info ? emNote(h(info).replace(/\n/g, "<br>"), "Practical information") : "") +
      (webinar && links.join && soon ? emP(h("The webinar room opens a few minutes before the start.")) : ""),
    text: [
      intro,
      `When: ${when}\nWhere: ${ctx.location || (webinar ? "Online" : "")}${webinar ? `\nJoin link: ${links.join || "we will send it before the start."}` : ""}`,
      links.qr ? `[QR code: attached to this e-mail as entry-pass.png]\n${qrCaption}` : "",
      info ? `Practical information: ${info}` : "",
    ].filter(Boolean).join("\n\n"),
    cta: joinCta || statusLink,
    secondary: joinCta ? statusLink : undefined,
    optOut: links.optOut,
  });
}

/** reg_followup: after a webinar, to confirmed registrants who were not checked in. */
function renderFollowup(ctx: Ctx, g: Json, o: { replay: string | null; attendanceKnown: boolean; optOut: OptOut }): Mail {
  const date = ctx.startsAt ? fmtDate(ctx.startsAt, ctx.tz) : "";
  const upcoming = `${siteFor(ctx)}/events`;
  if (o.attendanceKnown) {
    const a = `We missed you at ${ctx.title}${date ? ` on ${date}` : ""}.`;
    const b = o.replay
      ? "Good news: the replay is available. Watch it whenever suits you."
      : "The recording is not available yet. If it is published, we will send you the link.";
    return cronMail(ctx, `Sorry we missed you: ${ctx.title}`, {
      title: "Sorry we missed you",
      greeting: hello(g),
      body: emP(`We missed you at ${strong(ctx.title)}${date ? ` on ${h(date)}` : ""}.`) + emP(h(b)),
      text: [a, b].join("\n\n"),
      cta: o.replay ? { label: "Watch the replay", url: o.replay } : { label: "See upcoming events", url: upcoming },
      secondary: o.replay ? { label: "See upcoming events", url: upcoming } : undefined,
      optOut: o.optOut,
    });
  }
  // Attendance was not recorded: only sent with a replay, worded for everyone.
  const a = `Thank you for registering for ${ctx.title}.`;
  const b = "In case you could not join us live, or would like to watch it again, the replay is available.";
  return cronMail(ctx, `The replay is available: ${ctx.title}`, {
    title: "The replay is available",
    greeting: hello(g),
    body: emP(`Thank you for registering for ${strong(ctx.title)}.`) + emP(h(b)),
    text: [a, b].join("\n\n"),
    cta: { label: "Watch the replay", url: o.replay || upcoming },
    secondary: { label: "See upcoming events", url: upcoming },
    optOut: o.optOut,
  });
}

/** reg_replay_available: the replay link was added after a follow-up without it. */
function renderReplayAvailable(ctx: Ctx, g: Json, o: { replay: string; optOut: OptOut }): Mail {
  const a = `As promised, the replay of ${ctx.title} is now available.`;
  return cronMail(ctx, `The replay is available: ${ctx.title}`, {
    title: "The replay is available",
    greeting: hello(g),
    body: emP(`As promised, the replay of ${strong(ctx.title)} is now available.`),
    text: a,
    cta: { label: "Watch the replay", url: o.replay },
    optOut: o.optOut,
  });
}

/** reg_staff_digest: new registrations of the last 24 h (events with staff_alert_mode = digest). */
function renderEventDigest(ctx: Ctx, rows: Json[], total: number): Mail {
  const label = (s: string) => (s === "confirmed" ? "Confirmed" : s === "waitlisted" ? "Waiting list" : s === "cancelled" ? "Cancelled" : "To review");
  const lines = rows.map((g) => `${clean(g.first_name, 80)} ${clean(g.last_name, 80)}`.trim() + `${g.company ? ` (${clean(g.company, 120)})` : ""}: ${label(String(g.status))}`);
  const a = `${total} new registration${total === 1 ? "" : "s"} for ${ctx.title} in the last 24 hours.`;
  const more = total > rows.length ? `And ${total - rows.length} more in the admin.` : "";
  return cronMail(ctx, `${total} new registration${total === 1 ? "" : "s"}: ${ctx.title}`, {
    title: "New registrations",
    body: emP(h(a), 10) + emBullets(lines.map((l) => h(l))) + (more ? emP(h(more)) : ""),
    text: [a, lines.map((l) => `• ${l}`).join("\n"), more].filter(Boolean).join("\n\n"),
    cta: { label: "Open in the admin", url: adminUrl(ctx) },
  });
}

/** One tab of the review queue (/admin/review, spec §8.1) in the daily digest. */
type DigestTab = {
  label: string;
  /** Items waiting for M3 (for an FYI tab: new items). */
  count: number;
  /** Age of the oldest waiting item in days; null = not shown. */
  oldestDays: number | null;
  /** What the count is made of ("3 people, 1 company claim"). */
  detail: string;
  url: string;
  /** For information only ("new in the last 24 hours"): never makes the digest go out on its own. */
  fyi?: string;
};

type DigestData = {
  /** In the queue's order: People & companies, Event registrations, Team joins, Duplicates. */
  tabs: DigestTab[];
  /** The Event registrations tab, event by event. */
  registrations: Array<{ title: string; slug: string; requested: number; needs_info: number; oldestDays: number; url: string }>;
  provisioning: { failed: number; queued: number };
  /**
   * notification_outbox: e-mails that gave up after 5 attempts (all of them / those whose
   * last attempt was within 24 hours: only these make the digest go out, so one old row
   * does not send it every morning) / held until the go-live version of their sender.
   */
  emails: { gaveUp: number; gaveUpRecent: number; held: number };
};

const ageText = (days: number) => (days < 1 ? "today" : days === 1 ? "1 day" : `${days} days`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Items that make the digest go out: everything but the FYI tabs (team joins, duplicates), held e-mails and e-mails that gave up more than a day ago. */
function digestTotal(d: DigestData): number {
  return d.tabs.filter((t) => !t.fyi).reduce((n, t) => n + t.count, 0) + d.provisioning.failed + d.emails.gaveUpRecent;
}

/** staff_review_digest: what waits for M3, tab by tab, once a day. */
function renderReviewDigest(d: DigestData): Mail {
  const total = digestTotal(d);
  const rows: Array<[string, string]> = [];
  const textRows: string[] = [];
  for (const t of d.tabs) {
    const head = t.fyi
      ? `${t.count} ${t.fyi}`
      : `${t.count} to review${t.oldestDays !== null && t.count ? ` (oldest: ${ageText(t.oldestDays)})` : ""}`;
    const v = [head, t.detail].filter(Boolean).join(" · ");
    rows.push([h(t.label), `${h(v)}<br>${emLink(h("Open"), h(t.url))}`]);
    textRows.push(`${t.label}: ${v}\n  ${t.url}`);
  }
  const events: string[] = d.registrations.map((r) =>
    `${r.title}: ${r.requested} to review${r.needs_info ? `, ${r.needs_info} waiting for an answer` : ""} (oldest: ${ageText(r.oldestDays)})`
  );
  const ops: Array<[string, string]> = [];
  if (d.provisioning.failed || d.provisioning.queued) ops.push(["Account creation", `${d.provisioning.failed} failed, ${d.provisioning.queued} waiting`]);
  if (d.emails.gaveUp) {
    const recent = d.emails.gaveUpRecent ? `, ${d.emails.gaveUpRecent} of them in the last 24 hours` : "";
    ops.push(["E-mails not sent", `${plural(d.emails.gaveUp, "e-mail")} gave up after 5 attempts${recent} (notification outbox)`]);
  }
  if (d.emails.held) ops.push(["E-mails on hold", `${plural(d.emails.held, "e-mail")} wait for the go-live version of their sender`]);
  const a = `${plural(total, "item")} wait${total === 1 ? "s" : ""} for M3 this morning.`;
  const note = "Sent every morning at 08:00 (Monaco time) to the review digest recipients set in the platform settings.";
  return {
    subject: `To review: ${plural(total, "item")} — Smart Marina Connect`,
    html: emailLayout({
      pageTitle: "Daily review",
      eyebrow: "M3 daily review",
      title: "What is waiting for you",
      bodyHtml: emP(h(a), 10) + emInfoTable(rows) +
        (events.length ? emP(h("Event registrations, event by event:"), 8) + emBullets(events.map((e) => h(e))) : "") +
        (ops.length ? emP(h("Needs attention:"), 8) + emInfoTable(ops.map(([k, v]) => [h(k), h(v)])) : ""),
      cta: { label: h("Open the review queue"), url: h(`${SITE_URL}/admin/review`) },
      footerNote: h(note),
    }),
    text: emText({
      title: "What is waiting for you",
      body: [
        a,
        textRows.join("\n"),
        events.length ? `Event registrations, event by event:\n${events.map((e) => `• ${e}`).join("\n")}` : "",
        ops.length ? `Needs attention:\n${ops.map(([k, v]) => `${k}: ${v}`).join("\n")}` : "",
      ].filter(Boolean).join("\n\n"),
      cta: { label: "Open the review queue", url: `${SITE_URL}/admin/review` },
      footerNote: note,
    }),
  };
}

// ─── Sending ─────────────────────────────────────────────────────────────────
const safeName = (s: string) => s.replace(/["<>\\]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
const eventFrom = (title: string) => `"${safeName(title) || "Smart Marina Connect"}" <${FROM_ADDRESS}>`;
const replyToOf = (settings: Json | null | undefined) => {
  const c = clean(settings?.contact_email, 200);
  return EMAIL_RE.test(c) ? c : EM.contact;
};

async function sendMail(o: {
  from: string;
  to: string;
  replyTo: string;
  mail: Mail;
  attachments?: Attachment[];
  headers?: Record<string, string>;
  log?: { guestId?: string | null; eventId?: string | null; kind: string };
}): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.error("registration-cron: RESEND_API_KEY is not set, nothing sent");
    return false;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: o.from,
          to: [o.to],
          reply_to: o.replyTo,
          subject: o.mail.subject,
          html: o.mail.html,
          text: o.mail.text,
          ...(o.headers ? { headers: o.headers } : {}),
          ...(o.attachments?.length ? { attachments: o.attachments } : {}),
        }),
      });
      if (resp.status === 429 && attempt < 2) {
        await resp.body?.cancel();
        await sleep(1100);
        continue;
      }
      if (!resp.ok) {
        console.error("registration-cron: resend failed", resp.status, (await resp.text()).slice(0, 300));
        return false;
      }
      await resp.body?.cancel();
      if (o.log) {
        const { error } = await db.from("gl_email_log").insert({ guest_id: o.log.guestId || null, event_id: o.log.eventId || null, kind: o.log.kind, to_email: o.to });
        if (error) console.error("registration-cron: e-mail log failed", error.message);
      }
      return true;
    } catch (e) {
      console.error("registration-cron: send error", e instanceof Error ? e.message : e);
      return false;
    }
  }
  return false;
}

async function qrPngBase64(text: string): Promise<string> {
  const dataUrl: string = await QRCode.toDataURL(text, {
    margin: 2, width: 600, errorCorrectionLevel: "M", color: { dark: "#000000ff", light: "#ffffffff" },
  });
  return dataUrl.split(",")[1] || "";
}

async function mintStatus(guestId: string): Promise<string | null> {
  const { data, error } = await db.rpc("gl_issue_access_token", { p_guest_id: guestId });
  if (error || typeof data !== "string" || !data) {
    console.error("registration-cron: status token not issued", error?.message || "empty");
    return null;
  }
  return data;
}

/** Account: signed unsubscribe from "events" (+ one-click header). Guest: "Stop reminders" on the status page. */
async function optOutFor(ctx: Ctx, g: Json, rawToken: string | null): Promise<{ optOut: OptOut; headers?: Record<string, string> }> {
  // Same site as the other links of the e-mail (the live site has /unsubscribe once the
  // redesign is live; real events only send after their flag, i.e. after that).
  const site = siteFor(ctx);
  if (g.user_id && SERVICE_ROLE) {
    const t = await signUnsubToken(SERVICE_ROLE, g.user_id, "events");
    return {
      optOut: { label: "Unsubscribe from event e-mails", url: `${site}/unsubscribe?t=${t}` },
      headers: {
        "List-Unsubscribe": `<${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/unsubscribe?t=${t}>, <mailto:unsubscribe@smartmarinaconnect.com>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    };
  }
  if (rawToken) {
    return { optOut: { label: "Stop e-mails about this event", url: `${site}/registration?t=${encodeURIComponent(rawToken)}&reminders=off` } };
  }
  return { optOut: { label: "Unsubscribe", url: `${site}/unsubscribe` } };
}

/** notification_prefs.events of the accounts linked to these rows (false = opted out). */
async function eventsOptedOut(rows: Json[]): Promise<Set<string>> {
  const ids = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
  const out = new Set<string>();
  if (!ids.length) return out;
  const { data } = await db.from("profiles").select("user_id, notification_prefs").in("user_id", ids);
  for (const p of (data as Json[] | null) || []) if (obj(p.notification_prefs).events === false) out.add(p.user_id);
  return out;
}

/** Claims keys of reminders_sent (optimistic on updated_at). Returns the new row or null if someone else wrote first. */
async function stamp(g: Json, keys: string[], at: string): Promise<Json | null> {
  const rs = { ...obj(g.reminders_sent) };
  for (const k of keys) rs[k] = at;
  const { data, error } = await db.from("gl_guest").update({ reminders_sent: rs }).eq("id", g.id).eq("updated_at", g.updated_at).select("*").maybeSingle();
  if (error) {
    console.error("registration-cron: stamp failed", error.message);
    return null;
  }
  return (data as Json | null) || null;
}

async function unstamp(g: Json, keys: string[]) {
  const rs = { ...obj(g.reminders_sent) };
  for (const k of keys) delete rs[k];
  const { error } = await db.from("gl_guest").update({ reminders_sent: rs }).eq("id", g.id).eq("updated_at", g.updated_at);
  if (error) console.error("registration-cron: unstamp failed", error.message);
}

const G_COLS = "id, event_id, status, email, first_name, last_name, company, user_id, reminders_sent, created_at, decided_at, updated_at, checkin_token, checked_in_at, ticket_key";

/** When the row was (last) confirmed: decided_at, created_at, or its latest confirmation
 *  e-mail (a reactivated registration keeps its old created_at and has no decided_at). */
async function confirmedAtOf(g: Json): Promise<Date | null> {
  let at = tryDate(g.decided_at) || tryDate(g.created_at);
  const { data } = await db.from("gl_email_log").select("sent_at").eq("guest_id", g.id)
    .in("kind", ["reg_webinar_confirmed", "reg_confirmed"]).order("sent_at", { ascending: false }).limit(1);
  const last = tryDate(((data as Json[] | null) || [])[0]?.sent_at);
  if (last && (!at || last.getTime() > at.getTime())) at = last;
  return at;
}

/** Absentees of a webinar are known: settings.attendance_recorded (true / false) wins;
 *  absent, someone was marked as attended and the last mark is ATTENDANCE_SETTLE_MS old. */
async function attendanceKnownOf(ev: Json, now: number): Promise<boolean> {
  const set = obj(ev.settings).attendance_recorded;
  if (set === true) return true;
  if (set === false) return false;
  const { data, error } = await db.from("gl_guest").select("checked_in_at").eq("event_id", ev.id)
    .not("checked_in_at", "is", null).order("checked_in_at", { ascending: false }).limit(1);
  if (error) {
    console.error("registration-cron: attendance read failed", error.message);
    return false;
  }
  const last = tryDate(((data as Json[] | null) || [])[0]?.checked_in_at);
  return !!last && now - last.getTime() >= ATTENDANCE_SETTLE_MS;
}

// ─── Job: reminders, follow-ups, event digests ───────────────────────────────
async function jobReminders(flags: Flags, force: boolean): Promise<Json> {
  const out = { events: 0, reminders: 0, followups: 0, replays: 0, digests: 0, skipped: 0, failed: 0 };
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const monacoHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Monaco", hour: "2-digit", hourCycle: "h23" }).format(new Date(now)));
  for (const ctx of await loadV2Events()) {
    const ev = ctx.ev;
    if (!(force || ev.hidden === true || flags[ev.kind === "webinar" ? "webinar_v2" : "onsite_v2"] === true)) continue;
    if (!ctx.startsAt) continue;
    const start = ctx.startsAt.getTime();
    const end = (ctx.endsAt || ctx.startsAt).getTime();
    const reminders = remindersOf(ctx);
    const maxLead = reminders.length ? reminders[reminders.length - 1].ms : 0;
    const inReminderWindow = reminders.length > 0 && now < start && now >= start - maxLead - REMINDER_LEAD_MS;
    const inFollowupWindow = ev.kind === "webinar" && now >= end + FOLLOWUP_AFTER_MS && now < end + FOLLOWUP_WINDOW_MS;
    const digestDue = ev.staff_alert_mode === "digest" && monacoHour === 8 && EMAIL_RE.test(clean(ev.notify_email, 200));
    if (!inReminderWindow && !inFollowupWindow && !digestDue) continue;
    out.events++;

    if (inReminderWindow) {
      const { data } = await db.from("gl_guest").select(G_COLS).eq("event_id", ev.id).eq("status", "confirmed").limit(2000);
      const rows = (data as Json[] | null) || [];
      const optedOut = await eventsOptedOut(rows);
      const join = joinUrlOf(ctx);
      for (const g of rows) {
        const rs = obj(g.reminders_sent);
        // Due a little early (REMINDER_LEAD_MS): the job runs hourly, so "1 hour before"
        // goes 30 to 90 minutes before the start, never 5 minutes before.
        const due = reminders.filter((r) => now >= start - r.ms - REMINDER_LEAD_MS && !rs[r.key]);
        if (!due.length) continue;
        const nearest = due[0];
        const keys = due.map((r) => r.key);
        // Confirmed inside this reminder's window: they just got the confirmation e-mail.
        const confirmedAt = await confirmedAtOf(g);
        const justConfirmed = !!confirmedAt && confirmedAt.getTime() > start - nearest.ms - REMINDER_LEAD_MS;
        if (rs.off || (g.user_id && optedOut.has(g.user_id)) || justConfirmed) {
          if (await stamp(g, keys, nowIso)) out.skipped++;
          continue;
        }
        const claimed = await stamp(g, keys, nowIso);
        if (!claimed) continue;
        const raw = await mintStatus(g.id);
        const { optOut, headers } = await optOutFor(ctx, g, raw);
        const attachments: Attachment[] = [];
        let qr = false;
        if (ev.kind === "onsite" && g.checkin_token) {
          try {
            const png = await qrPngBase64(passUrl(ctx, g.checkin_token));
            attachments.push(
              { filename: "qr-inline.png", content: png, content_type: "image/png", content_id: "passqr" },
              { filename: "entry-pass.png", content: png, content_type: "image/png" },
            );
            qr = true;
          } catch (e) {
            console.error("registration-cron: QR failed", e instanceof Error ? e.message : e);
          }
        }
        if (nearest.ms > 2 * 3600000) {
          const ics = buildIcs(ctx, ev.kind === "webinar" ? join : null);
          if (ics) attachments.push({ filename: "event.ics", content: b64Utf8(ics), content_type: "text/calendar; charset=utf-8; method=PUBLISH" });
        }
        const ok = await sendMail({
          from: eventFrom(ctx.title),
          to: String(g.email),
          replyTo: replyToOf(ev.settings),
          mail: renderReminder(ctx, g, nearest, { status: raw ? `${siteFor(ctx)}/registration?t=${encodeURIComponent(raw)}` : null, join, qr, optOut }),
          attachments,
          headers,
          log: { guestId: g.id, eventId: ev.id, kind: `reg_reminder_${nearest.key}` },
        });
        if (ok) out.reminders++;
        else {
          out.failed++;
          await unstamp(claimed, keys);
        }
      }
    }

    if (inFollowupWindow) {
      // Absentees known (see the header): explicit setting, else marks done and settled.
      // Until then only the replay goes out, worded for everyone.
      const attendanceKnown = await attendanceKnownOf(ev, now);
      const replay = replayUrlOf(ctx);
      let q = db.from("gl_guest").select(G_COLS).eq("event_id", ev.id).eq("status", "confirmed");
      if (attendanceKnown) q = q.is("checked_in_at", null);
      const { data } = await q.limit(2000);
      const rows = (data as Json[] | null) || [];
      const optedOut = await eventsOptedOut(rows);
      for (const g of rows) {
        const rs = obj(g.reminders_sent);
        if (rs.off || (g.user_id && optedOut.has(g.user_id))) continue;
        let kind: "followup" | "replay" | null = null;
        let keys: string[] = [];
        if (!rs.followup) {
          if (replay) {
            kind = "followup";
            keys = ["followup", "replay"];
          } else if (attendanceKnown && now >= end + FOLLOWUP_NO_REPLAY_AFTER_MS) {
            kind = "followup";
            keys = ["followup"];
          }
        } else if (!rs.replay && replay) {
          kind = "replay";
          keys = ["replay"];
        }
        if (!kind) continue;
        const claimed = await stamp(g, keys, nowIso);
        if (!claimed) continue;
        const raw = await mintStatus(g.id);
        const { optOut, headers } = await optOutFor(ctx, g, raw);
        const mail = kind === "followup"
          ? renderFollowup(ctx, g, { replay, attendanceKnown, optOut })
          : renderReplayAvailable(ctx, g, { replay: replay as string, optOut });
        const ok = await sendMail({
          from: eventFrom(ctx.title),
          to: String(g.email),
          replyTo: replyToOf(ev.settings),
          mail,
          headers,
          log: { guestId: g.id, eventId: ev.id, kind: kind === "followup" ? "reg_followup" : "reg_replay_available" },
        });
        if (ok && kind === "followup") out.followups++;
        else if (ok) out.replays++;
        else {
          out.failed++;
          await unstamp(claimed, keys);
        }
      }
    }

    if (digestDue) {
      const since20h = new Date(now - 20 * 3600000).toISOString();
      const { count: already } = await db.from("gl_email_log").select("id", { count: "exact", head: true })
        .eq("event_id", ev.id).eq("kind", "reg_staff_digest").gte("sent_at", since20h);
      if (!already) {
        const since = new Date(now - 24 * 3600000).toISOString();
        const { data, count } = await db.from("gl_guest").select("first_name, last_name, company, status", { count: "exact" })
          .eq("event_id", ev.id).gte("created_at", since).order("created_at", { ascending: true }).limit(50);
        const rows = (data as Json[] | null) || [];
        if (rows.length) {
          const ok = await sendMail({
            from: eventFrom(ctx.title),
            to: clean(ev.notify_email, 200),
            replyTo: EM.contact,
            mail: renderEventDigest(ctx, rows, count || rows.length),
            log: { eventId: ev.id, kind: "reg_staff_digest" },
          });
          if (ok) out.digests++;
          else out.failed++;
        }
      }
    }
  }
  return out;
}

// ─── Job: daily review digest for M3 ─────────────────────────────────────────
const daysSince = (iso: unknown, now: number) => {
  const d = tryDate(iso);
  return d ? Math.max(0, Math.floor((now - d.getTime()) / 86400000)) : 0;
};

// public.normalize_org_name (Phase 2) in JS, for the Duplicates count: lower case, accents
// and dots off, other punctuation as a space, legal-form suffixes dropped (never a leading
// word), spaces collapsed.
const LEGAL_SUFFIXES = new Set(["sas", "sarl", "sa", "sam", "ltd", "llc", "inc", "gmbh", "srl", "spa", "bv", "doo"]);
function normOrgName(name: unknown): string {
  const words = String(name || "").toLowerCase().normalize("NFKD").replace(/\p{M}+/gu, "").replace(/\./g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

const pieces = (parts: Array<[number, string, string?]>) =>
  parts.filter(([n]) => n > 0).map(([n, one, many]) => plural(n, one, many)).join(", ");

/**
 * The tabs of the review queue (/admin/review, spec §8.1). Counts and oldest dates come from the
 * queue itself, admin_review_queue_counts() (part 3, 20261016091000; the service role may call
 * it), so the digest announces exactly what the page lists: no hidden test or canary-% event, a
 * pending company and its pending owner as ONE card, the legacy drafts v2 lists, claims and
 * join requests; the FYI tabs (team joins, duplicates) as the page shows them until marked seen.
 * The Retro-review tab (a one-time list) is not counted.
 * Before part 3 is applied (a forced canary run), the tables are counted instead:
 *   People & companies   pending people who sent their profile (not drafts, not staff),
 *                        pending companies (not archived or merged), company claims;
 *   Event registrations  gl_guest requested on the events the queue lists;
 *   Team joins           FYI: invitations and join requests accepted in the last 24 hours;
 *   Duplicates           FYI: companies sharing a normalised name.
 * Either way, Event registrations are also listed event by event (requested, and needs_info
 * waiting for an answer), hidden test events and canary-% events left out as in the queue.
 */
async function collectDigest(): Promise<DigestData> {
  const now = Date.now();
  const since24h = new Date(now - 86400000).toISOString();
  const review = `${SITE_URL}/admin/review`;
  const oldestOf = (dates: unknown[]) => dates.reduce<number>((m, x) => Math.max(m, daysSince(x, now)), 0);
  const d: DigestData = { tabs: [], registrations: [], provisioning: { failed: 0, queued: 0 }, emails: { gaveUp: 0, gaveUpRecent: 0, held: 0 } };

  // The queue's own counts: {total, people, registrations, team_joins, duplicates, retro, content, oldest: {<tab>: ts}}.
  const { data: qc, error: qcErr } = await db.rpc("admin_review_queue_counts");
  if (qcErr) console.error("registration-cron: admin_review_queue_counts unreadable, the digest counts the tables", qcErr.message);
  const q = !qcErr && qc && typeof qc === "object" && !Array.isArray(qc) ? (qc as Json) : null;
  const qOldest: Json = q && q.oldest && typeof q.oldest === "object" && !Array.isArray(q.oldest) ? q.oldest : {};
  const qCount = (tab: string) => Math.max(0, Math.floor(Number(q?.[tab]) || 0));
  const qDays = (tab: string) => (qOldest[tab] ? daysSince(qOldest[tab], now) : 0);

  // People & companies.
  const { data: claims, error: cErr } = await db.from("organization_invitations").select("created_at").eq("status", "claim_requested").limit(5000);
  if (cErr) throw new Error(`digest claims: ${cErr.message}`);
  const cl = (claims as Json[] | null) || [];
  let orgs: Json[] = [];
  if (q) {
    d.tabs.push({
      label: "People & companies",
      count: qCount("people"),
      oldestDays: qDays("people"),
      detail: cl.length ? `including ${plural(cl.length, "company claim")}` : "",
      url: review,
    });
  } else {
    const { data: people, error: pErr } = await db.from("profiles").select("created_at")
      .eq("access_status", "pending").neq("onboarding_status", "draft").not("persona", "in", "(admin,moderator)").limit(5000);
    if (pErr) throw new Error(`digest people: ${pErr.message}`);
    const { data: orgRows, error: oErr } = await db.from("organizations").select("id, name, access_status, created_at").limit(5000);
    if (oErr) throw new Error(`digest companies: ${oErr.message}`);
    // archived_at / duplicate_of come with part 1: absent columns = nothing hidden.
    const hidden = new Set<string>();
    const { data: gone, error: goneErr } = await db.from("organizations").select("id")
      .or("archived_at.not.is.null,duplicate_of.not.is.null").limit(5000);
    if (!goneErr) for (const o of (gone as Json[] | null) || []) hidden.add(String(o.id));
    orgs = ((orgRows as Json[] | null) || []).filter((o) => !hidden.has(String(o.id)));
    const pendingOrgs = orgs.filter((o) => o.access_status === "pending");
    const ppl = (people as Json[] | null) || [];
    d.tabs.push({
      label: "People & companies",
      count: ppl.length + pendingOrgs.length + cl.length,
      oldestDays: oldestOf([...ppl, ...pendingOrgs, ...cl].map((x) => x.created_at)),
      detail: pieces([[ppl.length, "person", "people"], [pendingOrgs.length, "company", "companies"], [cl.length, "company claim"]]),
      url: review,
    });
  }

  // Event registrations, event by event.
  const { data: regs, error: rErr } = await db.from("gl_guest").select("event_id, status, created_at").in("status", ["requested", "needs_info"]).limit(5000);
  if (rErr) throw new Error(`digest registrations: ${rErr.message}`);
  const byEvent = new Map<string, { requested: number; needs_info: number; oldest: string }>();
  for (const r of (regs as Json[] | null) || []) {
    const e = byEvent.get(r.event_id) || { requested: 0, needs_info: 0, oldest: r.created_at };
    if (r.status === "needs_info") e.needs_info++;
    else e.requested++;
    if (String(r.created_at) < String(e.oldest)) e.oldest = r.created_at;
    byEvent.set(r.event_id, e);
  }
  if (byEvent.size) {
    const { data: evs, error: eErr } = await db.from("gl_event").select("id, slug, title, engine, legacy_event_id, hidden").in("id", [...byEvent.keys()]);
    if (eErr) console.error("registration-cron: digest events unreadable", eErr.message);
    for (const ev of (evs as Json[] | null) || []) {
      // The queue never lists a hidden test event or a canary-% event: nor does the digest.
      if (ev.hidden === true || String(ev.slug || "").startsWith("canary-")) continue;
      const e = byEvent.get(ev.id)!;
      d.registrations.push({
        title: clean(ev.title, 200),
        slug: ev.slug,
        requested: e.requested,
        needs_info: e.needs_info,
        oldestDays: daysSince(e.oldest, now),
        // As the queue's cards: the guest list, the catalogue event's editor, else the events list.
        url: ev.engine === "guest_list_v1" ? `${SITE_URL}/admin/guest-list/${ev.slug}`
          : ev.legacy_event_id ? `${SITE_URL}/admin/events/${ev.legacy_event_id}` : `${SITE_URL}/admin/events`,
      });
    }
    d.registrations.sort((a, b) => b.oldestDays - a.oldestDays);
  }
  const requested = d.registrations.reduce((n, r) => n + r.requested, 0);
  const needsInfo = d.registrations.reduce((n, r) => n + r.needs_info, 0);
  d.tabs.push({
    label: "Event registrations",
    count: q ? qCount("registrations") : requested,
    oldestDays: q ? qDays("registrations") : d.registrations.length ? Math.max(...d.registrations.map((r) => r.oldestDays)) : 0,
    detail: [d.registrations.length ? `${plural(d.registrations.length, "event")}` : "", needsInfo ? `${needsInfo} waiting for an answer` : ""].filter(Boolean).join(", "),
    url: review,
  });

  // Team joins and Duplicates (FYI): the queue's cards still to look at.
  if (q) {
    d.tabs.push({ label: "Team joins", count: qCount("team_joins"), oldestDays: null, detail: "", url: review, fyi: "to look at" });
    d.tabs.push({ label: "Duplicates", count: qCount("duplicates"), oldestDays: null, detail: "", url: review, fyi: "to check" });
  } else {
    const { count: joins } = await db.from("organization_invitations").select("id", { count: "exact", head: true })
      .eq("status", "accepted").gte("updated_at", since24h);
    d.tabs.push({ label: "Team joins", count: joins || 0, oldestDays: null, detail: "", url: review, fyi: "new in the last 24 hours" });
    pushTableDuplicates(d, orgs, review);
  }
  return withAttention(d, since24h);
}

/** Duplicates counted from the tables (before part 3): companies sharing a normalised name. */
function pushTableDuplicates(d: DigestData, orgs: Json[], review: string) {
  const groups = new Map<string, string[]>();
  for (const o of orgs) {
    const k = normOrgName(o.name);
    if (!k) continue;
    groups.set(k, [...(groups.get(k) || []), clean(o.name, 80)]);
  }
  const dupes = [...groups.values()].filter((g) => g.length > 1);
  d.tabs.push({
    label: "Duplicates",
    count: dupes.length,
    oldestDays: null,
    detail: dupes.length ? `possible duplicate companies, e.g. ${dupes.slice(0, 2).map((g) => g.slice(0, 2).join(" / ")).join("; ")}` : "",
    url: review,
    fyi: "to check",
  });
}

/** Needs attention: account creation and the notification outbox. */
async function withAttention(d: DigestData, since24h: string): Promise<DigestData> {
  const { count: failed } = await db.from("account_provision_job").select("id", { count: "exact", head: true }).eq("status", "failed");
  const { count: queued } = await db.from("account_provision_job").select("id", { count: "exact", head: true }).eq("status", "queued");
  d.provisioning = { failed: failed || 0, queued: queued || 0 };
  const { count: gaveUp } = await db.from("notification_outbox").select("id", { count: "exact", head: true })
    .is("sent_at", null).gte("attempts", OUTBOX_MAX_ATTEMPTS);
  // claimed_at of a row that gave up = the time of its 5th attempt.
  const { count: gaveUpRecent } = await db.from("notification_outbox").select("id", { count: "exact", head: true })
    .is("sent_at", null).gte("attempts", OUTBOX_MAX_ATTEMPTS).gte("claimed_at", since24h);
  const { count: held } = await db.from("notification_outbox").select("id", { count: "exact", head: true })
    .is("sent_at", null).like("last_error", "held:%");
  d.emails = { gaveUp: gaveUp || 0, gaveUpRecent: gaveUpRecent || 0, held: held || 0 };
  return d;
}

async function jobDigest(flags: Flags, force: boolean): Promise<Json> {
  if (!force && flags.review_queue !== true) return { skipped: "flag review_queue is off" };
  const since20h = new Date(Date.now() - 20 * 3600000).toISOString();
  const { count: already } = await db.from("gl_email_log").select("id", { count: "exact", head: true }).eq("kind", "staff_review_digest").gte("sent_at", since20h);
  if (already && !force) return { skipped: "already sent today" };
  const { data: rec } = await db.from("platform_settings").select("value").eq("key", "review_digest_recipients").maybeSingle();
  const value = (rec as Json | null)?.value;
  const to = (Array.isArray(value) ? value : []).map((x: unknown) => clean(x, 200).toLowerCase()).filter((x: string) => EMAIL_RE.test(x));
  if (!to.length) return { skipped: "no recipients" };
  const d = await collectDigest();
  const total = digestTotal(d);
  if (!total) return { sent: 0, nothing_to_review: true };
  const mail = renderReviewDigest(d);
  let sent = 0;
  for (const addr of [...new Set(to)].slice(0, 10)) {
    if (await sendMail({ from: PLATFORM_FROM, to: addr, replyTo: EM.contact, mail, log: { kind: "staff_review_digest" } })) sent++;
  }
  return { sent, total };
}

// ─── Job: notification outbox (Phase 3; see the header) ──────────────────────
type OutboxSender = "send-notification" | "send-status-notification";
const OUTBOX_SENDERS: Record<string, OutboxSender> = {
  account_under_review: "send-notification",
  team_join_request: "send-notification",
  user_account_approved: "send-status-notification",
  user_account_rejected: "send-status-notification",
  account_info_requested: "send-status-notification",
  company_validated: "send-status-notification",
  claim_approved: "send-status-notification",
  claim_declined: "send-status-notification",
  // Article comments (20261021130000_article_comments.sql): the page that queued them asks
  // send-notification at once; these are the ones it could not send.
  comment_mention: "send-notification",
  comment_report: "send-notification",
};
/** Sent per run (each is one call to a sending function, about a second). */
const OUTBOX_BATCH = 20;
/** Unsent rows read per query (rows that may go; held rows apart, on a recheck only). */
const OUTBOX_SCAN = 300;
/** notification_outbox_claim's own limit: a row with 5 attempts is never claimed again. */
const OUTBOX_MAX_ATTEMPTS = 5;
/** Left to the page that queued the row (it asks send-notification at once). */
const OUTBOX_MIN_AGE_MS = 2 * 60000;
/** A claim not followed by a recorded result (a run that died): taken again after this (as notification_outbox_claim). */
const OUTBOX_LEASE_MS = 10 * 60000;
/** Wait after the n-th failed attempt (index n). */
const OUTBOX_BACKOFF_MS = [0, 2 * 60000, 10 * 60000, 30 * 60000, 2 * 3600000];
/**
 * send-notification answers {success, skipped, reason: "duplicate"} in two cases: the queued
 * row is already sent, or the same e-mail was TRIED for this recipient less than 10 minutes
 * ago (it logs the try BEFORE calling the provider, so a provider error leaves the log). Only
 * the first is a send: in the second case the row is not marked, it waits out the window and
 * is tried again (the failure note carries this marker).
 */
const OUTBOX_DUPLICATE_NOTE = "duplicate window";
const OUTBOX_DUPLICATE_WAIT_MS = 11 * 60000;
/** send-notification's daily cap on e-mails naming a company M3 has not verified (429): tried again a day later. */
const OUTBOX_RATE_LIMITED_WAIT_MS = 24 * 3600000;
/** The go-live send-notification found no one to send the e-mail to (a company with no real owner, an account without an address). */
const OUTBOX_UNRESOLVED = "Could not resolve the row this notification is about";
/** Most rows a forced run may name. */
const OUTBOX_FORCE_IDS = 50;
/** Held rows checked for out-of-date news per run (one read each). */
const OUTBOX_HELD_CHECKS = 50;
/** account_under_review is news for a few days only. */
const OUTBOX_UNDER_REVIEW_MAX_AGE_MS = 3 * 86400000;
/** A decision of M3 (the send-status-notification kinds) queued longer ago than this is settled unsent (see the header). */
const OUTBOX_DECISION_MAX_AGE_MS = 72 * 3600000;
/** A comment e-mail (a tag, a report) queued longer ago than this is settled unsent: old news. */
const OUTBOX_COMMENT_MAX_AGE_MS = 72 * 3600000;
const isCommentKind = (kind: string) => kind === "comment_mention" || kind === "comment_report";
const OUTBOX_COLS = "id, kind, user_id, subject_id, data, created_at, claimed_at, attempts, last_error";
const FN_BASE = `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1`;

type OutboxRow = {
  id: number;
  kind: string;
  user_id: string;
  subject_id: string | null;
  data: Json | null;
  created_at: string;
  claimed_at: string | null;
  attempts: number;
  last_error: string | null;
};
type Support = "yes" | "no" | "unknown";
/** The function that sends this kind, or null (own keys only). */
const senderOf = (kind: string): OutboxSender | null => (Object.prototype.hasOwnProperty.call(OUTBOX_SENDERS, kind) ? OUTBOX_SENDERS[kind] : null);

async function callFunction(name: string, body: Json): Promise<{ status: number; body: Json }> {
  try {
    const r = await fetch(`${FN_BASE}/${name}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_ROLE}`, apikey: ANON_KEY || SERVICE_ROLE, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    let parsed: Json = {};
    try {
      parsed = obj(JSON.parse(text));
    } catch {
      parsed = { error: text.slice(0, 200) };
    }
    return { status: r.status, body: parsed };
  } catch (e) {
    return { status: 0, body: { error: e instanceof Error ? e.message : String(e) } };
  }
}

/** Which kinds the DEPLOYED sending functions know (see the header). Nothing is sent by these calls. */
async function outboxSupport(kinds: string[]): Promise<Map<string, Support>> {
  const out = new Map<string, Support>();
  for (const k of kinds) if (!senderOf(k)) out.set(k, "no");
  for (const k of kinds.filter((x) => senderOf(x) === "send-notification")) {
    // No user_id, no data: the go-live version stops at the missing row (400 "Could not
    // resolve the row this notification is about"), main's at the unknown type.
    const r = await callFunction("send-notification", { type: k });
    if (r.status === 400 && r.body.error === "Unknown notification type") out.set(k, "no");
    else if (r.status === 400) out.set(k, "yes");
    else out.set(k, "unknown");
  }
  const st = kinds.filter((x) => senderOf(x) === "send-status-notification");
  if (st.length) {
    const r = await callFunction("send-status-notification", { action: "types" });
    const types = r.status === 200 && Array.isArray(r.body.types) ? (r.body.types as unknown[]).map(String) : null;
    for (const k of st) out.set(k, types ? (types.includes(k) ? "yes" : "no") : r.status === 400 ? "no" : "unknown");
  }
  return out;
}

const heldNote = (kind: string) =>
  senderOf(kind)
    ? `held: the deployed ${senderOf(kind)} cannot send ${kind} yet; it leaves once the go-live version is deployed`
    : `held: registration-cron has no sender for ${kind}`;

/**
 * When the row may be claimed (ms). forced = a forced run that names its rows: no wait for a
 * new row or a back-off, but never while an attempt may still be in flight, nor inside
 * send-notification's duplicate window.
 */
function outboxDueAt(r: OutboxRow, forced = false): number {
  const earliest = forced ? 0 : Date.parse(r.created_at) + OUTBOX_MIN_AGE_MS;
  if (!r.claimed_at) return earliest;
  const claimed = Date.parse(r.claimed_at);
  const note = String(r.last_error || "");
  // The latest attempt's failure was recorded: back off; otherwise it may still be in flight.
  if (!note.startsWith(`attempt ${r.attempts} failed`)) return Math.max(earliest, claimed + OUTBOX_LEASE_MS);
  const backoff = OUTBOX_BACKOFF_MS[r.attempts] ?? OUTBOX_LEASE_MS;
  if (note.includes(OUTBOX_DUPLICATE_NOTE)) return Math.max(earliest, claimed + Math.max(backoff, OUTBOX_DUPLICATE_WAIT_MS));
  if (forced) return earliest;
  // Refused by send-notification's daily cap (429): the next day.
  const wait = / 429( |$)/.test(note) ? Math.max(backoff, OUTBOX_RATE_LIMITED_WAIT_MS) : backoff;
  return Math.max(earliest, claimed + wait);
}

/** Claims one row: attempts + 1 only if nobody else did since it was read. */
async function claimOutbox(r: OutboxRow): Promise<OutboxRow | null> {
  const { data, error } = await db.from("notification_outbox")
    .update({ claimed_at: new Date().toISOString(), attempts: r.attempts + 1 })
    .eq("id", r.id).eq("attempts", r.attempts).is("sent_at", null)
    .select(OUTBOX_COLS).maybeSingle();
  if (error) {
    console.error("registration-cron: outbox claim failed", r.id, error.message);
    return null;
  }
  return (data as OutboxRow | null) || null;
}

/** Marked once (not claimed, attempts untouched): why the row waits. */
async function noteHeld(r: OutboxRow, note: string): Promise<boolean> {
  if (r.last_error === note) return false;
  const { data, error } = await db.from("notification_outbox").update({ last_error: note })
    .eq("id", r.id).eq("attempts", r.attempts).is("sent_at", null).is("claimed_at", null).select("id");
  if (error) console.error("registration-cron: outbox note failed", r.id, error.message);
  return ((data as Json[] | null) || []).length > 0;
}

/** A claimed row the deployed function turned out not to know: the attempt is given back. */
async function unclaimHeld(r: OutboxRow, note: string) {
  const { error } = await db.from("notification_outbox").update({ attempts: Math.max(r.attempts - 1, 0), claimed_at: null, last_error: note })
    .eq("id", r.id).eq("attempts", r.attempts).is("sent_at", null);
  if (error) console.error("registration-cron: outbox unclaim failed", r.id, error.message);
}

/** Settled without sending: the news is out of date. */
async function settleOutbox(r: OutboxRow, why: string) {
  const { error } = await db.from("notification_outbox").update({ sent_at: new Date().toISOString(), last_error: `not sent: ${why}`.slice(0, 500) })
    .eq("id", r.id).is("sent_at", null);
  if (error) console.error("registration-cron: outbox settle failed", r.id, error.message);
}

async function markOutboxSent(r: OutboxRow) {
  const { error } = await db.rpc("notification_outbox_done", { p_id: r.id, p_error: null });
  if (error) console.error("registration-cron: notification_outbox_done failed", r.id, error.message);
}

/** The failure of this attempt; the claim stays (see outboxDueAt). */
async function failOutbox(r: OutboxRow, msg: string) {
  const text = r.attempts >= OUTBOX_MAX_ATTEMPTS ? `gave up after ${r.attempts} attempts: ${msg}` : `attempt ${r.attempts} failed: ${msg}`;
  const { error } = await db.from("notification_outbox").update({ last_error: text.slice(0, 500) })
    .eq("id", r.id).eq("attempts", r.attempts).is("sent_at", null);
  if (error) console.error("registration-cron: outbox failure note failed", r.id, error.message);
}

const invitationOf = (r: OutboxRow) =>
  [r.subject_id, obj(r.data).invitation_id].map((x) => String(x || "")).find((x) => UUID_RE.test(x)) || "";

/** Why this row must not be sent any more, or null. */
async function outboxOutOfDate(r: OutboxRow): Promise<string | null> {
  if (isCommentKind(r.kind) && Date.now() - Date.parse(r.created_at) > OUTBOX_COMMENT_MAX_AGE_MS) {
    return "stale: a comment e-mail queued more than 72 hours ago is never sent late";
  }
  if (senderOf(r.kind) === "send-status-notification" && Date.now() - Date.parse(r.created_at) > OUTBOX_DECISION_MAX_AGE_MS) {
    return "stale: a decision queued more than 72 hours ago is never sent late";
  }
  if (r.kind === "team_join_request") {
    const id = invitationOf(r);
    if (!id) return "no join request named";
    const { data, error } = await db.from("organization_invitations").select("status, expires_at").eq("id", id).maybeSingle();
    if (error) throw new Error(`invitation read: ${error.message}`);
    const inv = data as Json | null;
    if (!inv) return "the join request no longer exists";
    if (inv.status !== "join_requested") return `the join request was already answered (${inv.status})`;
    const exp = Date.parse(String(inv.expires_at || ""));
    if (Number.isFinite(exp) && exp < Date.now()) return "the join request has expired";
  }
  if (r.kind === "account_under_review") {
    if (Date.now() - Date.parse(r.created_at) > OUTBOX_UNDER_REVIEW_MAX_AGE_MS) return "queued more than 3 days ago: too late to announce the review";
    const { data, error } = await db.from("profiles").select("access_status").eq("user_id", r.user_id).maybeSingle();
    if (error) throw new Error(`profile read: ${error.message}`);
    const p = data as Json | null;
    if (!p) return "the account no longer exists";
    if (p.access_status !== "pending") return `the person is no longer pending (${p.access_status})`;
  }
  return null;
}

/** The request the owning function takes (the row id goes along where the function settles it by id). */
function outboxRequest(r: OutboxRow): Json {
  if (r.kind === "account_under_review") return { type: r.kind, user_id: r.user_id };
  if (r.kind === "team_join_request") return { type: r.kind, data: { invitation_id: invitationOf(r) } };
  return { type: r.kind, user_id: r.user_id, subject_id: r.subject_id, data: obj(r.data), outbox_id: r.id };
}

async function sendOutboxRow(r: OutboxRow): Promise<"sent" | "settled" | "held" | "failed"> {
  try {
    const why = await outboxOutOfDate(r);
    if (why) {
      await settleOutbox(r, why);
      return "settled";
    }
  } catch (e) {
    await failOutbox(r, e instanceof Error ? e.message : String(e));
    return "failed";
  }
  const fn = senderOf(r.kind) as OutboxSender;
  const res = await callFunction(fn, outboxRequest(r));
  const err = clean(res.body.error, 200);
  if (res.status >= 200 && res.status < 300 && res.body.success === true) {
    if (res.body.skipped === true && res.body.reason === "duplicate") {
      // Already sent (the function read sent_at and marked nothing), or only TRIED less than
      // 10 minutes ago (see OUTBOX_DUPLICATE_NOTE): only the row itself tells which.
      const state = await outboxSentState(r.id);
      if (state === "sent") return "sent";
      if (state === "gone") return "settled";
      await failOutbox(r, `${fn} answered "duplicate" for a row ${state === "unsent" ? "nobody marked sent" : "that could not be read again"}: the same e-mail was tried less than 10 minutes ago (${OUTBOX_DUPLICATE_NOTE}), tried again after it`);
      return "failed";
    }
    // Sent, or the recipient opted out of the category: settled (the sending function marks it too).
    await markOutboxSent(r);
    return "sent";
  }
  if (res.status === 409 && res.body.stale === true) {
    await settleOutbox(r, clean(res.body.detail, 200) || "the decision changed before the e-mail left");
    return "settled";
  }
  // The deployed version does not know the kind after all (a rollback since the check).
  const legacy = fn === "send-notification"
    ? res.status === 400 && err === "Unknown notification type"
    : res.status === 400 && err === "user_id and status are required";
  if (legacy) {
    await unclaimHeld(r, heldNote(r.kind));
    return "held";
  }
  // No one to send it to (the go-live send-notification: a company with no real owner, an
  // account without an address). Once may be a passing read error; twice in a row it is
  // the row: settled unsent, so it never gives up and raises the daily digest for good.
  if (fn === "send-notification" && res.status === 400 && err === OUTBOX_UNRESOLVED && String(r.last_error || "").includes(OUTBOX_UNRESOLVED)) {
    await settleOutbox(r, `send-notification found no one to send it to, twice (${OUTBOX_UNRESOLVED.toLowerCase()})`);
    return "settled";
  }
  await failOutbox(r, `${fn} ${res.status}${err ? ` ${err}` : ""}`);
  return "failed";
}

/** The row as the database has it now: sent, unsent, gone, or unknown (unreadable). */
async function outboxSentState(id: number): Promise<"sent" | "unsent" | "gone" | "unknown"> {
  const { data, error } = await db.from("notification_outbox").select("sent_at").eq("id", id).maybeSingle();
  if (error) return "unknown";
  if (!data) return "gone";
  return (data as Json).sent_at ? "sent" : "unsent";
}

async function jobOutbox(flags: Flags, force: boolean, ids: number[] = []): Promise<Json> {
  if (!force && flags.outbox_sender !== true) return { skipped: "flag outbox_sender is off" };
  // A forced run while the sender is off (a canary test before go-live) names its rows: it
  // never drains the queue of real people.
  if (force && flags.outbox_sender !== true && !ids.length) {
    return { refused: "force_needs_ids", detail: "outbox_sender is off: a forced run must name its rows ({\"ids\": [notification_outbox ids]})" };
  }
  const now = Date.now();
  const forced = force && ids.length > 0;
  // Rows held for a kind the deployed sender does not know are looked at again once a
  // quarter of an hour (pg_cron wakes the job for them at minutes 0, 15, 30 and 45; one
  // minute of slack), or on a forced run, not every minute.
  const recheckHeld = force || new Date(now).getUTCMinutes() % 15 <= 1;
  const base = () => db.from("notification_outbox").select(OUTBOX_COLS).is("sent_at", null).lt("attempts", OUTBOX_MAX_ATTEMPTS);
  // Held rows are read apart, so that however many pile up they never push the rows that
  // can go out of the scan.
  const reads = ids.length
    ? [base().in("id", ids)]
    : [
      base().is("last_error", null).order("id", { ascending: true }).limit(OUTBOX_SCAN),
      base().not("last_error", "like", "held:%").order("id", { ascending: true }).limit(OUTBOX_SCAN),
      ...(recheckHeld ? [base().like("last_error", "held:%").order("id", { ascending: true }).limit(OUTBOX_SCAN)] : []),
    ];
  const byId = new Map<number, OutboxRow>();
  for (const q of reads) {
    const { data, error } = await q;
    if (error) throw new Error(`outbox read: ${error.message}`);
    for (const r of (data as OutboxRow[] | null) || []) byId.set(Number(r.id), r);
  }
  const rows = [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id));
  if (!rows.length) return { sent: 0 };
  // Only rows that may go now (not too new, not backing off); the senders are asked about
  // their kinds only.
  const ready = rows.filter((r) => outboxDueAt(r, forced) <= now);
  if (!ready.length) return { sent: 0, waiting: rows.length };
  const kinds = [...new Set(ready.map((r) => r.kind))];
  const support = await outboxSupport(kinds);
  const held: Record<string, number> = {};
  const newlyHeld: Record<string, number> = {};
  const counts = { sent: 0, settled: 0, failed: 0, busy: 0 };
  let heldChecks = 0;
  for (const r of ready) {
    if (support.get(r.kind) !== "no") continue;
    // News already out of date is settled now, not when its sender arrives (a held
    // account_under_review would otherwise wait for go-live to be found too old).
    if (heldChecks < OUTBOX_HELD_CHECKS
        && (r.kind === "account_under_review" || r.kind === "team_join_request" || isCommentKind(r.kind) || senderOf(r.kind) === "send-status-notification")) {
      heldChecks++;
      try {
        const why = await outboxOutOfDate(r);
        if (why) {
          await settleOutbox(r, why);
          counts.settled++;
          continue;
        }
      } catch (e) {
        console.error("registration-cron: held row check failed", r.id, e instanceof Error ? e.message : e);
      }
    }
    held[r.kind] = (held[r.kind] || 0) + 1;
    if (await noteHeld(r, heldNote(r.kind))) newlyHeld[r.kind] = (newlyHeld[r.kind] || 0) + 1;
  }
  // Logged once: when rows are first marked held.
  for (const [kind, n] of Object.entries(newlyHeld)) console.warn(`registration-cron: ${n} queued ${kind} e-mail(s) held: ${heldNote(kind)}`);
  const due = ready.filter((r) => support.get(r.kind) === "yes").slice(0, OUTBOX_BATCH);
  for (const r of due) {
    const claimed = await claimOutbox(r);
    if (!claimed) {
      counts.busy++;
      continue;
    }
    const result = await sendOutboxRow(claimed);
    if (result === "held") held[r.kind] = (held[r.kind] || 0) + 1;
    else counts[result]++;
  }
  const unknown = kinds.filter((k) => support.get(k) === "unknown");
  return { ...counts, held, ...(unknown.length ? { sender_unreachable: unknown } : {}) };
}

// ─── Job: provisioning (provision-person does the work) ──────────────────────
async function jobProvision(flags: Flags, force: boolean, jobIds: string[] = []): Promise<Json> {
  if (!force && flags.provisioning !== true) return { skipped: "flag provisioning is off" };
  // A forced run while provisioning is off (a canary test) names its jobs, and provision-person
  // then takes only jobs of hidden (test) events: it never provisions the real queue.
  if (force && flags.provisioning !== true && !jobIds.length) {
    return { refused: "force_needs_job_ids", detail: "provisioning is off: a forced run must name its jobs ({\"job_ids\": [...]}, hidden test events only)" };
  }
  const r = await fetch(`${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/provision-person`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_ROLE}`, "Content-Type": "application/json", apikey: ANON_KEY || SERVICE_ROLE },
    body: JSON.stringify({ action: "run", force, ...(jobIds.length ? { job_ids: jobIds } : {}) }),
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, ...obj(body) };
}

// ─── Handler ─────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonRes({ ok: false, error: "method_not_allowed" }, 405);
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!(await isServiceRole(bearer))) return jsonRes({ ok: false, error: "unauthorized" }, 401);
  let body: Json = {};
  try {
    body = obj(await req.json());
  } catch { /* empty body */ }
  const job = String(body.job || "");
  const force = body.force === true;
  // The rows a forced run names (see the header): notification_outbox ids / provisioning job ids.
  const ids = (Array.isArray(body.ids) ? body.ids : []).map((x: unknown) => Number(x)).filter((n: number) => Number.isSafeInteger(n) && n > 0).slice(0, OUTBOX_FORCE_IDS);
  const jobIds = (Array.isArray(body.job_ids) ? body.job_ids : []).filter((x: unknown) => typeof x === "string" && UUID_RE.test(x)).slice(0, 100);
  const answer = (r: Json) => jsonRes({ ok: !r.refused, job, ...r }, r.refused ? 400 : 200);
  try {
    const flags = await loadFlags();
    if (job === "reminders") return jsonRes({ ok: true, job, ...(await jobReminders(flags, force)) });
    if (job === "digest") return jsonRes({ ok: true, job, ...(await jobDigest(flags, force)) });
    if (job === "provision") return answer(await jobProvision(flags, force, jobIds));
    if (job === "outbox") return answer(await jobOutbox(flags, force, ids));
    return jsonRes({ ok: false, error: "unknown_job" }, 400);
  } catch (e) {
    console.error("registration-cron: job failed", job, e instanceof Error ? e.message : JSON.stringify(e));
    return jsonRes({ ok: false, error: "server" }, 500);
  }
});
