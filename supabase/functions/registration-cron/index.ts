// registration-cron -- the timed jobs of the registration core (spec regspec-en.md §4.2;
// contract docs/registration-contract.md §5 of the DB lane).
//
// Called by pg_cron through public.invoke_registration_cron(job) with the Vault service
// key (migration 20261009210000_registration_core):
//   POST {"job": "provision"}  every 5 min   -> provision-person {action:"run"}
//   POST {"job": "reminders"}  hourly at :10 -> reminders, absentee follow-up, event digests
//   POST {"job": "digest"}     08:00 Monaco  -> staff_review_digest
// The SQL invoker already skips a job whose flag is off; this function checks again
// (kill switch). {"force": true} runs a job whatever its flag (manual run by staff of
// M3 with the service key, e.g. a canary test).
//
// verify_jwt = TRUE, and the caller must hold a service-role key (checked below: any
// valid user JWT passes the gateway, so the gateway check alone is not enough).
//
// Reminders (core_v2 events only; wys26 e-mails stay with the frozen guest-list):
//   gl_event.reminders = ISO-8601 durations before the start. Empty = the default of the
//   kind: webinar P7D, P1D, PT1H (the join link) / on-site P7D (practical information and
//   the entry QR). gl_event.settings.no_reminders = true turns them off for one event.
//   Only CONFIRMED rows. When several reminders are due at once (a late registration),
//   only the nearest is sent; a reminder whose window started before the person was
//   confirmed is skipped (they just got the confirmation). Each duration is stamped in
//   gl_guest.reminders_sent before sending (claimed with updated_at, so two runs never
//   send the same reminder) and unstamped if the send fails.
//   Flags: webinar_v2 for webinars, onsite_v2 for on-site events (hidden test events:
//   always).
// Absentee follow-up (webinars, Victor 9 Oct): after the end, confirmed registrants who
//   were not checked in get "Sorry we missed you" with the replay link
//   (gl_event.replay_url, else events.replay_url). No replay yet: the follow-up waits
//   48 h, then goes without it, and "The replay is available" follows if the link is
//   added within 14 days. When nobody was checked in (attendance not recorded), only the
//   replay is sent, worded for everyone. Stamped as reminders_sent.followup / .replay.
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

const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });

// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const clean = (s: unknown, max = 200) => (typeof s === "string" ? s.trim().slice(0, max) : "");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
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
const eventPageUrl = (ctx: Ctx): string | null => (ctx.eventId ? `${REG_SITE}/events/${ctx.eventId}` : null);
const passUrl = (ctx: Ctx, checkinToken: string) => `${REG_SITE}/admin/guest-list/${ctx.ev.slug}/checkin?token=${checkinToken}`;
const adminUrl = (ctx: Ctx) => (ctx.eventId ? `${REG_SITE}/admin/events/${ctx.eventId}` : `${REG_SITE}/admin/events`);
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
// frame as the Mailchimp welcome e-mail (navy band, 4 px gold rule, white 600 px card on a
// pale page, gold pill button, teal eyebrow, light footer). Pure functions: no import, no
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
  gold: "#d7a647",
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

/** The gold pill button. `label` and `url` are HTML-safe. */
function emButton(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="${EM.gold}" style="border-radius:999px;background-color:${EM.gold};"><a href="${url}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${EM.font};font-size:16px;line-height:20px;font-weight:bold;color:${EM.navy};text-decoration:none;border-radius:999px;">${label} &rarr;</a></td></tr></table>`;
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

/** A highlighted quote or reason: pale box, gold left rule, optional small-caps label. */
function emNote(html: string, label?: string): string {
  const head = label
    ? `<span style="display:block;margin:0 0 4px;font-size:12px;line-height:16px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${EM.teal};">${label}</span>`
    : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:2px 0 18px;"><tr><td bgcolor="${EM.soft}" style="background-color:${EM.soft};border-left:4px solid ${EM.gold};padding:14px 18px;font-family:${EM.font};font-size:15px;line-height:23px;color:${EM.ink};">${head}${html}</td></tr></table>`;
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
  /** Gold pill button; showUrl prints the link under it for clients that block buttons. */
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
<tr><td bgcolor="${EM.gold}" style="height:4px;line-height:4px;font-size:0;background-color:${EM.gold};">&nbsp;</td></tr>
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
  const upcoming = `${REG_SITE}/events`;
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

type DigestData = {
  registrations: Array<{ title: string; slug: string; requested: number; needs_info: number; oldestDays: number; url: string }>;
  people: { pending: number; submitted: number; oldestDays: number };
  companies: { pending: number; byVerifiedMembers: number; oldestDays: number };
  provisioning: { failed: number; queued: number };
};

const ageText = (days: number) => (days < 1 ? "today" : days === 1 ? "1 day" : `${days} days`);

/** staff_review_digest: what waits for M3, once a day. */
function renderReviewDigest(d: DigestData): Mail {
  const regTotal = d.registrations.reduce((n, r) => n + r.requested + r.needs_info, 0);
  const total = regTotal + d.people.pending + d.companies.pending + d.provisioning.failed;
  const rows: Array<[string, string]> = [];
  const textRows: string[] = [];
  for (const r of d.registrations) {
    const v = `${r.requested} to review${r.needs_info ? `, ${r.needs_info} waiting for an answer` : ""} (oldest: ${ageText(r.oldestDays)})`;
    rows.push([h(r.title), `${h(v)}<br>${emLink(h("Open"), h(r.url))}`]);
    textRows.push(`${r.title}: ${v}\n  ${r.url}`);
  }
  if (d.people.pending) {
    const v = `${d.people.pending} waiting (${d.people.submitted} submitted, oldest: ${ageText(d.people.oldestDays)})`;
    rows.push([h("People"), `${h(v)}<br>${emLink(h("Open"), h(`${REG_SITE}/admin/users`))}`]);
    textRows.push(`People: ${v}\n  ${REG_SITE}/admin/users`);
  }
  if (d.companies.pending) {
    const v = `${d.companies.pending} waiting${d.companies.byVerifiedMembers ? ` (${d.companies.byVerifiedMembers} created by validated members)` : ""}, oldest: ${ageText(d.companies.oldestDays)}`;
    rows.push([h("Companies"), `${h(v)}<br>${emLink(h("Open"), h(`${REG_SITE}/admin/organizations`))}`]);
    textRows.push(`Companies: ${v}\n  ${REG_SITE}/admin/organizations`);
  }
  if (d.provisioning.failed || d.provisioning.queued) {
    const v = `${d.provisioning.failed} failed, ${d.provisioning.queued} waiting`;
    rows.push([h("Account creation"), h(v)]);
    textRows.push(`Account creation: ${v}`);
  }
  const a = `${total} item${total === 1 ? "" : "s"} wait${total === 1 ? "s" : ""} for M3 this morning.`;
  return {
    subject: `To review: ${total} item${total === 1 ? "" : "s"} — Smart Marina Connect`,
    html: emailLayout({
      pageTitle: "Daily review",
      eyebrow: "M3 daily review",
      title: "What is waiting for you",
      bodyHtml: emP(h(a), 10) + emInfoTable(rows),
      cta: { label: "Open the admin", url: h(`${REG_SITE}/admin`) },
      footerNote: h("Sent every morning at 08:00 (Monaco time) to the review digest recipients set in the platform settings."),
    }),
    text: emText({
      title: "What is waiting for you",
      body: [a, textRows.join("\n")].join("\n\n"),
      cta: { label: "Open the admin", url: `${REG_SITE}/admin` },
      footerNote: "Sent every morning at 08:00 (Monaco time) to the review digest recipients set in the platform settings.",
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
async function optOutFor(g: Json, rawToken: string | null): Promise<{ optOut: OptOut; headers?: Record<string, string> }> {
  if (g.user_id && SERVICE_ROLE) {
    const t = await signUnsubToken(SERVICE_ROLE, g.user_id, "events");
    return {
      optOut: { label: "Unsubscribe from event e-mails", url: `${SITE_URL}/unsubscribe?t=${t}` },
      headers: {
        "List-Unsubscribe": `<${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/unsubscribe?t=${t}>, <mailto:unsubscribe@smartmarinaconnect.com>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    };
  }
  if (rawToken) {
    return { optOut: { label: "Stop e-mails about this event", url: `${REG_SITE}/registration?t=${encodeURIComponent(rawToken)}&reminders=off` } };
  }
  return { optOut: { label: "Unsubscribe", url: `${SITE_URL}/unsubscribe` } };
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
    const inReminderWindow = now < start && now >= start - maxLead;
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
        const due = reminders.filter((r) => now >= start - r.ms && !rs[r.key]);
        if (!due.length) continue;
        const nearest = due[0];
        const keys = due.map((r) => r.key);
        const confirmedAt = tryDate(g.decided_at) || tryDate(g.created_at);
        const justConfirmed = !!confirmedAt && confirmedAt.getTime() > start - nearest.ms;
        if (rs.off || (g.user_id && optedOut.has(g.user_id)) || justConfirmed) {
          if (await stamp(g, keys, nowIso)) out.skipped++;
          continue;
        }
        const claimed = await stamp(g, keys, nowIso);
        if (!claimed) continue;
        const raw = await mintStatus(g.id);
        const { optOut, headers } = await optOutFor(g, raw);
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
          mail: renderReminder(ctx, g, nearest, { status: raw ? `${REG_SITE}/registration?t=${encodeURIComponent(raw)}` : null, join, qr, optOut }),
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
      const { count: attended } = await db.from("gl_guest").select("id", { count: "exact", head: true }).eq("event_id", ev.id).not("checked_in_at", "is", null);
      const attendanceKnown = (attended || 0) > 0;
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
        const { optOut, headers } = await optOutFor(g, raw);
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

async function collectDigest(): Promise<DigestData> {
  const now = Date.now();
  const d: DigestData = {
    registrations: [],
    people: { pending: 0, submitted: 0, oldestDays: 0 },
    companies: { pending: 0, byVerifiedMembers: 0, oldestDays: 0 },
    provisioning: { failed: 0, queued: 0 },
  };
  const { data: regs } = await db.from("gl_guest").select("event_id, status, created_at").in("status", ["requested", "needs_info"]).limit(5000);
  const byEvent = new Map<string, { requested: number; needs_info: number; oldest: string }>();
  for (const r of (regs as Json[] | null) || []) {
    const e = byEvent.get(r.event_id) || { requested: 0, needs_info: 0, oldest: r.created_at };
    if (r.status === "needs_info") e.needs_info++;
    else e.requested++;
    if (String(r.created_at) < String(e.oldest)) e.oldest = r.created_at;
    byEvent.set(r.event_id, e);
  }
  if (byEvent.size) {
    const { data: evs } = await db.from("gl_event").select("id, slug, title, engine, legacy_event_id").in("id", [...byEvent.keys()]);
    for (const ev of (evs as Json[] | null) || []) {
      const e = byEvent.get(ev.id)!;
      d.registrations.push({
        title: clean(ev.title, 200),
        slug: ev.slug,
        requested: e.requested,
        needs_info: e.needs_info,
        oldestDays: daysSince(e.oldest, now),
        url: ev.engine === "guest_list_v1" || !ev.legacy_event_id ? `${REG_SITE}/admin/guest-list/${ev.slug}` : `${REG_SITE}/admin/events/${ev.legacy_event_id}`,
      });
    }
    d.registrations.sort((a, b) => b.oldestDays - a.oldestDays);
  }
  const { data: people } = await db.from("profiles").select("onboarding_status, created_at")
    .eq("access_status", "pending").not("persona", "in", "(admin,moderator)").limit(5000);
  for (const p of (people as Json[] | null) || []) {
    d.people.pending++;
    if (p.onboarding_status === "submitted") d.people.submitted++;
    d.people.oldestDays = Math.max(d.people.oldestDays, daysSince(p.created_at, now));
  }
  const { data: orgs } = await db.from("organizations").select("id, created_at").eq("access_status", "pending").limit(5000);
  const orgIds = ((orgs as Json[] | null) || []).map((o) => o.id);
  d.companies.pending = orgIds.length;
  for (const o of (orgs as Json[] | null) || []) d.companies.oldestDays = Math.max(d.companies.oldestDays, daysSince(o.created_at, now));
  if (orgIds.length) {
    const { data: flagged } = await db.from("organization_audit_log").select("organization_id")
      .eq("event_type", "organization_pending_review").in("organization_id", orgIds.slice(0, 500));
    d.companies.byVerifiedMembers = new Set(((flagged as Json[] | null) || []).map((f) => f.organization_id)).size;
  }
  const { count: failed } = await db.from("account_provision_job").select("id", { count: "exact", head: true }).eq("status", "failed");
  const { count: queued } = await db.from("account_provision_job").select("id", { count: "exact", head: true }).eq("status", "queued");
  d.provisioning = { failed: failed || 0, queued: queued || 0 };
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
  const total = d.registrations.reduce((n, r) => n + r.requested + r.needs_info, 0) + d.people.pending + d.companies.pending + d.provisioning.failed;
  if (!total) return { sent: 0, nothing_to_review: true };
  const mail = renderReviewDigest(d);
  let sent = 0;
  for (const addr of [...new Set(to)].slice(0, 10)) {
    if (await sendMail({ from: PLATFORM_FROM, to: addr, replyTo: EM.contact, mail, log: { kind: "staff_review_digest" } })) sent++;
  }
  return { sent, total };
}

// ─── Job: provisioning (provision-person does the work) ──────────────────────
async function jobProvision(flags: Flags, force: boolean): Promise<Json> {
  if (!force && flags.provisioning !== true) return { skipped: "flag provisioning is off" };
  const r = await fetch(`${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/provision-person`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_ROLE}`, "Content-Type": "application/json", apikey: ANON_KEY || SERVICE_ROLE },
    body: JSON.stringify({ action: "run", force }),
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
  try {
    const flags = await loadFlags();
    if (job === "reminders") return jsonRes({ ok: true, job, ...(await jobReminders(flags, force)) });
    if (job === "digest") return jsonRes({ ok: true, job, ...(await jobDigest(flags, force)) });
    if (job === "provision") return jsonRes({ ok: true, job, ...(await jobProvision(flags, force)) });
    return jsonRes({ ok: false, error: "unknown_job" }, 400);
  } catch (e) {
    console.error("registration-cron: job failed", job, e instanceof Error ? e.message : JSON.stringify(e));
    return jsonRes({ ok: false, error: "server" }, 500);
  }
});
