// registration -- public and staff API of the registration core (spec regspec-en.md
// §4.1; database contract docs/registration-contract.md of the DB lane). Full API:
// supabase/functions/registration/README.md.
//
// One store for every new event: gl_guest rows on a gl_event whose engine is
// 'core_v2'. Core_v2 rows are written ONLY through the service-role RPCs
// gl_register_v2 (new registration) and gl_decide_v2 (staff decisions); this
// function adds the e-mails, the status links, the rate limits and the flags.
// wys26 (engine guest_list_v1) keeps the FROZEN guest-list function; here it only
// gets the "parity" request form (flag wys_form_v2) and, behind wys_status_edit,
// edit / cancel / attach of a request through its personal link.
//
// verify_jwt = FALSE: anonymous visitors call it. When an Authorization header
// carries a user session, the session is checked here (auth.getUser).
//
// Never returns a token, a door code or a v1 personal link to a caller: status
// links (/registration?t=) and door QR codes go to the registration's inbox only.
// The one exception is the status page itself (token holder = inbox reader), and a
// signed-in owner whose e-mail is PROVEN (contract §2, §5).
//
// Kill switches (platform_settings.registration_flags, missing = false):
//   webinar_v2 / onsite_v2  core_v2 registration on webinars / on-site events
//                           (hidden test events and staff work with the flag off)
//   wys_form_v2             parity request form for guest_list_v1 events
//   wys_status_edit         edit / cancel / attach a wys26 request by its link
//   turnstile               Cloudflare Turnstile required for anonymous registration
//
// This file must not contain a literal backslash-u escape (the MCP deploy mangles
// them). E-mails are in English, in the SMC e-mail layout v1 (block below).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import QRCode from "https://esm.sh/qrcode@1.5.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
// Live site: the wys26 pages and the guest-list links (the frozen guest-list uses SITE_URL).
const SITE_URL = (Deno.env.get("SITE_URL") || "https://smartmarinaconnect.com").replace(/\/+$/, "");
// Site of the links of HIDDEN test events only (canaries, before the redesign is live):
// set REGISTRATION_SITE_URL to the preview for canary tests. Real events always link to
// SITE_URL (siteFor below), so a forgotten preview setting never reaches a real pass.
const REG_SITE = (Deno.env.get("REGISTRATION_SITE_URL") || SITE_URL).replace(/\/+$/, "");
const FROM_ADDRESS = "noreply@smartmarinaconnect.com";
const PLATFORM_FROM = `Smart Marina Connect <${FROM_ADDRESS}>`;
const TURNSTILE_SECRET = Deno.env.get("TURNSTILE_SECRET_KEY") || "";
const TURNSTILE_ENFORCE = (Deno.env.get("TURNSTILE_ENFORCE") || "").trim().toLowerCase() === "true";

// Limits (spec §4.1)
const REG_IP_PER_HOUR = 5;
const REG_EMAIL_PER_HOUR = 3;
// Signed-in callers skip the captcha but not the limits: Confirm email is off, so an
// account's address can be anyone's, and every register can e-mail it and the staff.
const REG_AUTH_ACCOUNT_PER_HOUR = 10;
const REG_AUTH_IP_PER_HOUR = 20;
const ALREADY_REGISTERED_MAIL_GAP_MS = 60 * 60000; // one "already registered" e-mail per hour and row
const STAFF_NEW_MAIL_GAP_MS = 24 * 3600000; // one staff alert per day and row (cancel + register again)
const RESEND_EMAIL_PER_DAY = 3;
const RESEND_IP_PER_HOUR = 10;
const FLOOD_PER_10_MIN = 40;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_DECIDE_IDS = 200;

const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });

/** Runs after the answer when the edge runtime allows it (EdgeRuntime.waitUntil), so the
 *  response time never tells whether an address is registered; else awaited. Never throws. */
function inBackground(label: string, task: () => Promise<unknown>): Promise<void> {
  const p = task().then(() => undefined, (e) => console.error(`registration: ${label} failed`, e instanceof Error ? e.message : e));
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt && typeof rt.waitUntil === "function") {
    rt.waitUntil(p);
    return Promise.resolve();
  }
  return p;
}

// ─── HTTP ────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  "https://smartmarinaconnect.com",
  "https://www.smartmarinaconnect.com",
  "https://m3connect.netlify.app",
  "https://m3connectv2.netlify.app",
];
const NETLIFY_SUBDOMAIN = /^https:\/\/[a-z0-9-]+--m3connect(v2)?\.netlify\.app$/;
const LOCAL_DEV = /^http:\/\/(localhost|127\.0\.0\.1):[0-9]{2,5}$/;
const isAllowed = (o: string) => ALLOWED_ORIGINS.includes(o) || NETLIFY_SUBDOMAIN.test(o) || LOCAL_DEV.test(o);
const cors = (req: Request) => ({
  "Access-Control-Allow-Origin": isAllowed(req.headers.get("origin") || "") ? (req.headers.get("origin") as string) : ALLOWED_ORIGINS[0],
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(req) } });

class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

// ─── Small helpers ───────────────────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;

const clean = (s: unknown, max = 200) => (typeof s === "string" ? s.trim().slice(0, max) : "");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCESS_TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
/** An ilike pattern that matches exactly this text, any case (escapes the backslash, % and _). */
const likeExact = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function b64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function maskEmail(e: string): string {
  const at = e.indexOf("@");
  if (at < 1) return "***";
  return `${e.slice(0, 1)}***${e.slice(at)}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const clientIp = (req: Request): string =>
  req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";

// ─── Flags and settings ──────────────────────────────────────────────────────
type Flags = Record<string, boolean>;

async function loadFlags(): Promise<Flags> {
  const out: Flags = {};
  try {
    const { data } = await db.from("platform_settings").select("value").eq("key", "registration_flags").maybeSingle();
    const v = obj((data as Json | null)?.value);
    for (const [k, x] of Object.entries(v)) out[k] = x === true;
  } catch (e) {
    console.error("registration: flags read failed", e instanceof Error ? e.message : e);
  }
  return out;
}

async function reviewSlaText(): Promise<string> {
  try {
    const { data } = await db.from("platform_settings").select("value").eq("key", "review_sla_text").maybeSingle();
    const v = (data as Json | null)?.value;
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 120);
  } catch { /* default below */ }
  return "within 2 working days";
}

const kindFlag = (kind: string) => (kind === "webinar" ? "webinar_v2" : "onsite_v2");

// ─── Events ──────────────────────────────────────────────────────────────────
type Ctx = {
  ev: Json; // gl_event row
  cat: Json | null; // events row (catalogue), null for the canaries
  title: string;
  startsAt: Date | null;
  endsAt: Date | null;
  location: string;
  imageUrl: string | null;
  eventId: string | null;
  tz: string;
};

const CAT_COLS = "id, title, description, date_time, end_date_time, is_full_day, location, image_url, event_type, published, replay_url, meeting_url";

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

/** Same rule as public.gl_event_window(): catalogue dates, else settings.starts_at / ends_at. */
function ctxOf(ev: Json, cat: Json | null): Ctx {
  const s = obj(ev.settings);
  const catStart = tryDate(cat?.date_time);
  const startsAt = catStart || tryDate(s.starts_at);
  let endsAt = tryDate(cat?.end_date_time) || tryDate(s.ends_at);
  if (!endsAt && catStart) endsAt = new Date(catStart.getTime() + (cat?.is_full_day ? 86400000 : 7200000));
  if (!endsAt && startsAt) endsAt = new Date(startsAt.getTime() + 7200000);
  const venue = [clean(s.venue, 120), clean(s.city, 80)].filter(Boolean).join(", ");
  const location = ev.kind === "webinar" ? "Online" : clean(cat?.location, 200) || venue;
  return {
    ev,
    cat,
    title: clean(cat?.title, 200) || clean(ev.title, 200) || "Smart Marina Connect event",
    startsAt,
    endsAt,
    location,
    imageUrl: cat?.image_url || null,
    eventId: cat?.id || null,
    tz: tzOf(ev),
  };
}

async function ctxFor(ev: Json): Promise<Ctx> {
  let cat: Json | null = null;
  if (ev.legacy_event_id) {
    const { data } = await db.from("events").select(CAT_COLS).eq("id", ev.legacy_event_id).maybeSingle();
    cat = (data as Json | null) || null;
  }
  return ctxOf(ev, cat);
}

/** By gl_event id, slug, or catalogue (events) id. */
async function loadEvent(body: Json): Promise<Ctx | null> {
  let q = db.from("gl_event").select("*");
  if (isUuid(body.gl_event_id)) q = q.eq("id", body.gl_event_id);
  else if (clean(body.slug, 60)) q = q.eq("slug", clean(body.slug, 60).toLowerCase());
  else if (isUuid(body.event_id)) q = q.eq("legacy_event_id", body.event_id);
  else return null;
  const { data } = await q.maybeSingle();
  return data ? await ctxFor(data as Json) : null;
}

async function loadEventById(id: string): Promise<Ctx | null> {
  const { data } = await db.from("gl_event").select("*").eq("id", id).maybeSingle();
  return data ? await ctxFor(data as Json) : null;
}

/** Core_v2 registration open to the public for this event right now (kill switch). */
const v2Enabled = (ctx: Ctx, flags: Flags, caller: Caller | null) =>
  flags[kindFlag(ctx.ev.kind)] === true || ctx.ev.hidden === true || !!caller?.isStaff;

const ended = (ctx: Ctx) => !!ctx.endsAt && Date.now() >= ctx.endsAt.getTime();
const started = (ctx: Ctx) => !!ctx.startsAt && Date.now() >= ctx.startsAt.getTime();

const joinUrlOf = (ctx: Ctx): string | null => {
  const u = clean(ctx.ev.meeting_url, 1000) || clean(ctx.cat?.meeting_url, 1000);
  return /^https:\/\//i.test(u) ? u : null;
};
const replayUrlOf = (ctx: Ctx): string | null => {
  const u = clean(ctx.ev.replay_url, 1000) || clean(ctx.cat?.replay_url, 1000);
  return /^https:\/\//i.test(u) ? u : null;
};
// Links of an event's e-mails: the live site for every real event (the door QR is
// printed and must never point at a preview); REGISTRATION_SITE_URL only for hidden
// test events (canaries), so a forgotten preview setting cannot leak into real passes.
const siteFor = (ctx: Ctx) => (ctx.ev.hidden === true ? REG_SITE : SITE_URL);
const eventPageUrl = (ctx: Ctx): string | null => (ctx.eventId ? `${siteFor(ctx)}/events/${ctx.eventId}` : null);
const statusUrl = (ctx: Ctx, raw: string) => `${siteFor(ctx)}/registration?t=${encodeURIComponent(raw)}`;
const passUrl = (ctx: Ctx, checkinToken: string) => `${siteFor(ctx)}/admin/guest-list/${ctx.ev.slug}/checkin?token=${checkinToken}`;
const adminUrl = (ctx: Ctx) => (ctx.eventId ? `${siteFor(ctx)}/admin/events/${ctx.eventId}` : `${siteFor(ctx)}/admin/events`);
const practicalInfo = (ctx: Ctx): string => clean(ctx.ev.settings?.practical_info, 2000) || clean(ctx.ev.settings?.programme_note, 2000);

// ─── Dates ───────────────────────────────────────────────────────────────────
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
/** "Thursday 18 February 2027, 15:00–16:00 (CET)" */
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

// ─── Calendar file ───────────────────────────────────────────────────────────
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
/** One VEVENT for the registration's event; null when the start is unknown. */
function buildIcs(ctx: Ctx, joinUrl: string | null): string | null {
  if (!ctx.startsAt) return null;
  const end = ctx.endsAt || new Date(ctx.startsAt.getTime() + 3600000);
  const page = eventPageUrl(ctx);
  const desc = [joinUrl ? `Join link: ${joinUrl}` : "", page ? `Event page: ${page}` : ""].filter(Boolean).join("\n");
  const lines = [
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
    "BEGIN:VALARM",
    "TRIGGER:-PT15M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsEsc(ctx.title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return lines.map(icsFold).join("\r\n");
}

// ─── Callers ─────────────────────────────────────────────────────────────────
type Caller = { id: string; email: string; isStaff: boolean; proven: boolean; profile: Json | null };

/** Unverified read of a JWT payload (only to tell a user session from the anon key). */
function jwtClaims(token: string): Json | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
  } catch {
    return null;
  }
}

const PROFILE_COLS = "user_id, first_name, last_name, email, job_title, country, phone, affiliation, persona, access_status, email_proven_at, notification_prefs";

/** null = anonymous (no header, the anon / publishable key); "expired" = a user JWT that GoTrue refuses. */
async function getCaller(req: Request): Promise<Caller | null | "expired"> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token || token === ANON_KEY) return null;
  const claims = jwtClaims(token);
  if (!claims || claims.role !== "authenticated") return null;
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) return "expired";
  const u = data.user;
  const { data: prof } = await db.from("profiles").select(PROFILE_COLS).eq("user_id", u.id).maybeSingle();
  const p = (prof as Json | null) || null;
  const email = (u.email || "").trim().toLowerCase();
  // Contract §2: proven = email_proven_at set AND profiles.email = the auth e-mail.
  const proven = !!p?.email_proven_at && !!email && String(p?.email || "").trim().toLowerCase() === email;
  const isStaff = !!p && ["admin", "moderator"].includes(String(p.persona || "")) && p.access_status === "verified";
  return { id: u.id, email, isStaff, proven, profile: p };
}

function requireStaff(caller: Caller | null): Caller {
  if (!caller) throw new HttpError(401, "sign_in_required");
  if (!caller.isStaff) throw new HttpError(403, "forbidden");
  return caller;
}

// ─── Rate limits (guest_signup_rate_limits, own scope and hash prefix) ───────
const ipHashOf = (ip: string) => sha256Hex(`reg:ip:${ip}`);
const emailHashOf = (email: string) => sha256Hex(`reg:email:${email}`);

async function rateCount(scope: string, column: "ip_hash" | "email_hash", hash: string, windowMs: number): Promise<number> {
  const since = new Date(Date.now() - windowMs).toISOString();
  const { count, error } = await db.from("guest_signup_rate_limits").select("id", { count: "exact", head: true })
    .eq("scope", scope).eq(column, hash).gte("created_at", since);
  if (error) {
    console.error("registration: rate-limit read failed", error.message);
    return 0; // fail open: a broken counter must not block real people
  }
  return count || 0;
}

async function rateRecord(scope: string, ipHash: string, emailHash: string | null) {
  const { error } = await db.from("guest_signup_rate_limits").insert({ scope, ip_hash: ipHash, email_hash: emailHash });
  if (error) console.error("registration: rate-limit write failed", error.message);
}

// ─── Anti-spam: Cloudflare Turnstile (same helper as guest-list) ─────────────
const TURNSTILE_SETUP_ERRORS = new Set(["missing-input-secret", "invalid-input-secret", "bad-request", "internal-error"]);

/** true: go on. Unset secret, unreachable Cloudflare or a setup error = allowed (logged). */
async function turnstileAllows(token: unknown, ip: string, enforce: boolean): Promise<boolean> {
  if (!TURNSTILE_SECRET) return true;
  const response = typeof token === "string" ? token.trim() : "";
  if (!response) return !enforce;
  if (response.length > 2048) return false;
  try {
    const form = new URLSearchParams({ secret: TURNSTILE_SECRET, response });
    if (ip && ip !== "unknown") form.set("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form, signal: AbortSignal.timeout(5000) });
    const out = (await res.json().catch(() => null)) as { success?: boolean; "error-codes"?: string[] } | null;
    if (out?.success === true) return true;
    const codes = out?.["error-codes"] ?? [];
    if (!out || codes.some((c) => TURNSTILE_SETUP_ERRORS.has(c))) {
      console.error("registration: Turnstile could not judge the token", res.status, codes.join(","));
      return true;
    }
    return false;
  } catch (err) {
    console.error("registration: Turnstile unreachable", err instanceof Error ? err.name : "error");
    return true;
  }
}

// ─── Questions, tickets, answers ─────────────────────────────────────────────
const Q_COLS = "key, label, help, kind, options, max_length, required, ticket_keys, profile_field, editable_after_submit, display_order";
const T_COLS = "key, label, description, price_cents, currency, price_note, invite_only, capacity, allowed_company_types, parts, display_order, active";

async function questionsOf(glEventId: string): Promise<Json[]> {
  const { data } = await db.from("gl_question").select(Q_COLS).eq("event_id", glEventId).order("display_order").order("key");
  return (data as Json[] | null) || [];
}
async function ticketsOf(glEventId: string): Promise<Json[]> {
  const { data } = await db.from("gl_ticket").select(T_COLS).eq("event_id", glEventId).eq("active", true).order("display_order").order("key");
  return (data as Json[] | null) || [];
}

const appliesTo = (q: Json, ticketKey: string | null) =>
  !Array.isArray(q.ticket_keys) || q.ticket_keys.length === 0 || (!!ticketKey && q.ticket_keys.includes(ticketKey));

function optionValues(q: Json): string[] | null {
  if (!Array.isArray(q.options)) return null;
  return q.options.map((o: unknown) => (o && typeof o === "object" ? String((o as Json).value ?? "") : String(o)));
}

function optionLabel(q: Json, value: string): string {
  if (Array.isArray(q.options)) {
    for (const o of q.options) {
      if (o && typeof o === "object" && String((o as Json).value) === value) return String((o as Json).label ?? value);
    }
  }
  return value;
}

/** Same checks as gl_register_v2. { empty } | { value } | { bad }. */
function checkAnswer(q: Json, v: unknown): { empty?: true; value?: unknown; bad?: true } {
  if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0) || (["checkbox", "consent"].includes(q.kind) && v === false)) {
    return { empty: true };
  }
  if (["checkbox", "consent"].includes(q.kind)) return typeof v === "boolean" ? { value: v } : { bad: true };
  if (["multiselect", "sectors", "parts"].includes(q.kind)) {
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) return { bad: true };
    const allowed = optionValues(q);
    if (["multiselect", "parts"].includes(q.kind) && allowed && v.some((x) => !allowed.includes(x as string))) return { bad: true };
    return { value: v };
  }
  if (typeof v !== "string") return { bad: true };
  const max = typeof q.max_length === "number" ? q.max_length : q.kind === "textarea" ? 4000 : 500;
  const s = v.slice(0, max);
  const allowed = optionValues(q);
  if (q.kind === "select" && allowed && !allowed.includes(s)) return { bad: true };
  return { value: s };
}

function answerText(q: Json, v: unknown): string {
  if (v === true) return "Yes";
  if (v === false) return "No";
  if (Array.isArray(v)) return v.map((x) => optionLabel(q, String(x))).join(", ");
  if (typeof v === "string") return q.kind === "select" ? optionLabel(q, v) : v;
  return "";
}

type StdField = "company" | "job_title" | "phone" | "country";
const STD_FIELDS: StdField[] = ["company", "job_title", "phone", "country"];
const STD_MAX: Record<StdField, number> = { company: 160, job_title: 160, phone: 40, country: 80 };

function fieldsOf(ev: Json): Record<StdField, "required" | "optional" | "hidden"> {
  const sf = obj(ev.standard_fields);
  const out = {} as Record<StdField, "required" | "optional" | "hidden">;
  for (const f of STD_FIELDS) out[f] = sf[f] === "required" || sf[f] === "hidden" ? sf[f] : "optional";
  return out;
}

function consentsFrom(raw: unknown): Json {
  const c = obj(raw);
  const out: Json = {};
  const now = new Date().toISOString();
  if (c.terms === true || (typeof c.terms_at === "string" && c.terms_at.trim())) out.terms_at = now;
  if (typeof c.image === "boolean") out.image = c.image;
  if (c.marketing === true || (typeof c.marketing_at === "string" && c.marketing_at.trim())) out.marketing_at = now;
  return out;
}

// ─── Statuses ────────────────────────────────────────────────────────────────
const STATUS_DISPLAY: Record<string, string> = {
  requested: "under_review",
  needs_info: "needs_info",
  waitlisted: "waitlisted",
  invited: "invited",
  approved: "payment_due",
  confirmed: "confirmed",
  rejected: "not_accepted",
  declined: "declined",
  cancelled: "cancelled",
};
const ACTIVE_STATUSES = new Set(["requested", "needs_info", "waitlisted", "invited", "approved", "confirmed"]);
const NAME_EDIT_STATUSES = new Set(["requested", "needs_info", "waitlisted"]);

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

type Mail = { subject: string; html: string; text: string };
type Attachment = { filename: string; content: string; content_type: string; content_id?: string };

// Values typed by people or staff reach the HTML only through h(). Same helpers as guest-list.
const h = (v: unknown) => emEsc(String(v ?? ""));
const strong = (v: unknown) => `<strong style="color:${EM.navy};">${h(v)}</strong>`;

/** "Thursday 18 February 2027, 15:00–16:00 (CET) · Online" (plain text). */
const eventLineOf = (ctx: Ctx) => [whenText(ctx), ctx.location].filter(Boolean).join(" · ");

/** One registration e-mail in the shared frame. `body` is HTML-safe, `text` its plain twin. */
function regMail(ctx: Ctx | null, subject: string, o: {
  eyebrow?: string;
  title: string;
  greeting?: string;
  body: string;
  text: string;
  preheader?: string;
  cta?: { label: string; url: string };
  secondary?: { label: string; url: string };
  note?: string;
}): Mail {
  const line = ctx ? eventLineOf(ctx) : "";
  const footerHtml = [o.note ? h(o.note) : "", line ? h(line) : ""].filter(Boolean).join("<br>");
  const footerText = [o.note || "", line].filter(Boolean).join("\n");
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
    }),
    text: emText({
      title: o.title,
      greeting: o.greeting,
      body: o.text,
      cta: o.cta,
      secondary: o.secondary,
      footerNote: footerText || undefined,
    }),
  };
}

const hello = (g: Json) => `Hello ${clean(g.first_name, 80) || "there"},`;
const fullName = (g: Json) => `${clean(g.first_name, 80)} ${clean(g.last_name, 80)}`.trim();
const statusCta = (ctx: Ctx, url: string | null) =>
  url ? { label: "View my registration", url } : eventPageUrl(ctx) ? { label: "Open the event page", url: eventPageUrl(ctx) as string } : undefined;
const PERSONAL_NOTE = "The button opens your personal registration page. Please do not forward this e-mail.";

/** reg_webinar_confirmed: instant webinar registration (.ics attached by the sender). */
function renderWebinarConfirmed(ctx: Ctx, g: Json, links: { status: string | null; join: string | null }): Mail {
  const when = whenText(ctx);
  const joinRow: [string, string] = links.join
    ? ["Join link", emLink(h("Join the webinar"), h(links.join))]
    : ["Join link", h("We will e-mail it to you before the start.")];
  const after = "A calendar invitation is attached. We will remind you before the start. Can't come any more? You can cancel from your registration page.";
  return regMail(ctx, `You're registered: ${ctx.title}`, {
    title: "You're registered",
    greeting: hello(g),
    preheader: `${ctx.title}: ${when}`,
    body: emP(`Your place is confirmed for ${strong(ctx.title)}.`, 10) +
      emInfoTable([["When", h(when)], ["Where", h("Online")], joinRow]) +
      emP(h(after)),
    text: [
      `Your place is confirmed for ${ctx.title}.`,
      `When: ${when}\nWhere: Online\nJoin link: ${links.join || "we will e-mail it to you before the start."}`,
      after,
    ].join("\n\n"),
    cta: statusCta(ctx, links.status),
    note: links.status ? PERSONAL_NOTE : undefined,
  });
}

/** reg_received: review mode, or a request for an invitation. */
function renderReceived(ctx: Ctx, g: Json, links: { status: string | null }, sla: string): Mail {
  const isRequest = g.source === "request";
  const intro = isRequest
    ? `Thank you for asking to attend ${ctx.title}. Attendance is by invitation.`
    : `Thank you for registering for ${ctx.title}.`;
  const review = `M3 reviews every registration. You will hear from us ${sla}.`;
  const manage = "You can view or change your answers at any time from your registration page.";
  return regMail(ctx, isRequest ? `Your request: ${ctx.title}` : `Registration received: ${ctx.title}`, {
    title: isRequest ? "Request received" : "Registration received",
    greeting: hello(g),
    body: emP(isRequest
      ? `Thank you for asking to attend ${strong(ctx.title)}. Attendance is by invitation.`
      : `Thank you for registering for ${strong(ctx.title)}.`) + emP(h(review)) + emP(h(manage)),
    text: [intro, review, manage].join("\n\n"),
    cta: statusCta(ctx, links.status),
    note: links.status ? PERSONAL_NOTE : undefined,
  });
}

/** reg_waitlisted */
function renderWaitlisted(ctx: Ctx, g: Json, links: { status: string | null }): Mail {
  const a = `${ctx.title} is full at the moment, so you are on the waiting list.`;
  const b = "If a place opens up, we will e-mail you straight away. You do not need to do anything until then.";
  return regMail(ctx, `You're on the waiting list: ${ctx.title}`, {
    title: "You're on the waiting list",
    greeting: hello(g),
    body: emP(`${strong(ctx.title)} is full at the moment, so you are on the waiting list.`) + emP(h(b)),
    text: [a, b].join("\n\n"),
    cta: statusCta(ctx, links.status),
    note: links.status ? PERSONAL_NOTE : undefined,
  });
}

/** reg_already_registered: a second registration with the same address (same public answer as a new one). */
function renderAlreadyRegistered(ctx: Ctx, g: Json, links: { status: string | null }): Mail {
  const a = `We received a new registration for ${ctx.title} with this e-mail address. You were already on the list, so nothing has changed.`;
  const b = "Use the button below to view or change your registration.";
  return regMail(ctx, `Your registration: ${ctx.title}`, {
    title: "You're already registered",
    greeting: hello(g),
    body: emP(`We received a new registration for ${strong(ctx.title)} with this e-mail address. You were already on the list, so nothing has changed.`) + emP(h(b)),
    text: [a, b].join("\n\n"),
    cta: statusCta(ctx, links.status),
    note: "If you did not try to register, you can ignore this e-mail.",
  });
}

/** reg_confirmed: on-site place confirmed by M3, with the entry QR (attachment "passqr"). */
function renderOnsiteConfirmed(ctx: Ctx, g: Json, links: { status: string | null; ticket?: string | null }): Mail {
  const when = whenText(ctx);
  const caption = "Show this QR code at the entrance. It is personal to you. It is also attached as entry-pass.png. No QR? Just give your name at the desk.";
  const info = practicalInfo(ctx);
  const rows: Array<[string, string]> = [["When", h(when)]];
  if (ctx.location) rows.push(["Where", h(ctx.location)]);
  if (links.ticket) rows.push(["Participation", h(links.ticket)]);
  const qr = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 20px;"><tr><td align="center" bgcolor="${EM.soft}" style="background-color:${EM.soft};border-radius:12px;padding:22px 18px;"><img src="cid:passqr" alt="Entry QR code" width="240" height="240" style="display:block;margin:0 auto;border:1px solid ${EM.line};border-radius:8px;padding:8px;background-color:#ffffff;" /><p style="margin:14px 0 0;font-family:${EM.font};font-size:13px;line-height:19px;color:${EM.muted};text-align:center;">${h(caption).replace("entry-pass.png", "<strong>entry-pass.png</strong>")}</p></td></tr></table>`;
  return regMail(ctx, `Your place is confirmed: ${ctx.title}`, {
    title: "Your place is confirmed",
    greeting: hello(g),
    preheader: `${ctx.title}: ${when}`,
    body: emP(`M3 has confirmed your place at ${strong(ctx.title)}.`, 10) +
      emInfoTable(rows) +
      qr +
      (info ? emNote(h(info).replace(/\n/g, "<br>"), "Practical information") : ""),
    text: [
      `M3 has confirmed your place at ${ctx.title}.`,
      rows.map(([k]) => `${k}: ${k === "When" ? when : k === "Where" ? ctx.location : links.ticket}`).join("\n"),
      `[QR code: attached to this e-mail as entry-pass.png]\n${caption}`,
      info ? `Practical information: ${info}` : "",
    ].filter(Boolean).join("\n\n"),
    cta: statusCta(ctx, links.status),
    note: links.status ? PERSONAL_NOTE : undefined,
  });
}

/** reg_info_requested: staff asked for a detail (needs_info). */
function renderInfoRequested(ctx: Ctx, g: Json, links: { status: string | null }, info: string): Mail {
  const a = `Thank you for registering for ${ctx.title}. Before M3 can confirm your place, we need a little more information.`;
  const b = "Please answer from your registration page. It only takes a minute.";
  return regMail(ctx, `We need a detail: ${ctx.title}`, {
    title: "We need a little more information",
    greeting: hello(g),
    body: emP(`Thank you for registering for ${strong(ctx.title)}. Before M3 can confirm your place, we need a little more information.`) +
      emNote(h(info).replace(/\n/g, "<br>"), "Our question") +
      emP(h(b)),
    text: [a, `Our question: ${info}`, b].join("\n\n"),
    cta: links.status ? { label: "Answer now", url: links.status } : statusCta(ctx, null),
    note: links.status ? PERSONAL_NOTE : undefined,
  });
}

/** reg_not_accepted (sent only when staff ask for it). */
function renderNotAccepted(ctx: Ctx, g: Json): Mail {
  const a = `Thank you for your interest in ${ctx.title}. Unfortunately we are not able to confirm your place for this event.`;
  const b = "We hope to welcome you at a future event.";
  return regMail(ctx, `About your registration: ${ctx.title}`, {
    title: "About your registration",
    greeting: hello(g),
    body: emP(`Thank you for your interest in ${strong(ctx.title)}. Unfortunately we are not able to confirm your place for this event.`) + emP(h(b)),
    text: [a, b].join("\n\n"),
    cta: { label: "See upcoming events", url: `${siteFor(ctx)}/events` },
  });
}

/** reg_cancelled */
function renderCancelled(ctx: Ctx, g: Json): Mail {
  const a = `Your registration for ${ctx.title} is cancelled. Thank you for letting us know.`;
  const b = "Changed your mind? You can register again from the event page while registration is open.";
  const page = eventPageUrl(ctx);
  return regMail(ctx, `Registration cancelled: ${ctx.title}`, {
    title: "Your registration is cancelled",
    greeting: hello(g),
    body: emP(`Your registration for ${strong(ctx.title)} is cancelled. Thank you for letting us know.`) + emP(h(b)),
    text: [a, b].join("\n\n"),
    cta: page ? { label: "Open the event page", url: page } : { label: "See upcoming events", url: `${siteFor(ctx)}/events` },
  });
}

/** reg_status_links: "Get my links" (one e-mail for every upcoming registration of an address). */
function renderStatusLinks(firstName: string, items: Array<{ title: string; when: string; url: string; label: string }>): Mail {
  const intro = items.length === 1
    ? "Here is the link to your registration."
    : `Here are the links to your ${items.length} registrations.`;
  const keep = "Each link is personal. Please do not forward this e-mail.";
  const greeting = `Hello ${clean(firstName, 80) || "there"},`;
  const single = items.length === 1 ? items[0] : null;
  return {
    subject: items.length === 1 ? `Your registration link: ${items[0].title}` : "Your registration links",
    html: emailLayout({
      pageTitle: "Your registration links",
      eyebrow: "Smart Marina Connect",
      title: items.length === 1 ? "Your registration link" : "Your registration links",
      greeting: h(greeting),
      bodyHtml: emP(h(intro), 10) +
        emBullets(items.map((i) => `${strong(i.title)}<br>${h(i.when)}<br>${emLink(h(i.label), h(i.url))}`)) +
        emP(h(keep)),
      cta: single ? { label: h(single.label), url: h(single.url) } : undefined,
      footerNote: h("If you did not ask for these links, you can ignore this e-mail."),
    }),
    text: emText({
      title: items.length === 1 ? "Your registration link" : "Your registration links",
      greeting,
      body: [intro, items.map((i) => `• ${i.title}\n  ${i.when}\n  ${i.label}: ${i.url}`).join("\n"), keep].join("\n\n"),
      cta: single ? { label: single.label, url: single.url } : undefined,
      footerNote: "If you did not ask for these links, you can ignore this e-mail.",
    }),
  };
}

/** Rows of a staff e-mail: identity, standard fields, ticket, answers (plain values). */
function staffRows(g: Json, questions: Json[], ticketLabel: string | null): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ["Name", fullName(g)],
    ["Email", String(g.email || "")],
    ["Company", String(g.company || "")],
    ["Job title", String(g.job_title || "")],
    ["Phone", String(g.phone || "")],
    ["Country", String(g.country || "")],
  ];
  if (ticketLabel) rows.push(["Participation", ticketLabel]);
  const answers = obj(g.answers);
  for (const q of questions) {
    const v = answerText(q, answers[q.key]);
    if (v) rows.push([String(q.label || q.key).slice(0, 80), v]);
  }
  return rows.filter(([, v]) => v);
}

/** admin_new_registration (staff alert, staff_alert_mode = each). */
function renderStaffNewRegistration(ctx: Ctx, g: Json, questions: Json[], ticketLabel: string | null): Mail {
  const rows = staffRows(g, questions, ticketLabel);
  const st = String(g.status || "");
  const what = st === "confirmed" ? "Confirmed at once (open registration)." : st === "waitlisted" ? "Put on the waiting list (the event is full)." : "Waiting for your review.";
  return regMail(ctx, `New registration: ${fullName(g)} — ${ctx.title}`, {
    title: "New registration",
    body: emP(h(what), 10) + emInfoTable(rows.map(([k, v]): [string, string] => [h(k), h(v).replace(/\n/g, "<br>")])),
    text: [what, rows.map(([k, v]) => `${k}: ${v}`).join("\n")].join("\n\n"),
    cta: { label: "Open in the admin", url: adminUrl(ctx) },
  });
}

/** admin_info_provided: the person answered a needs_info question (their message, what they changed). */
function renderStaffInfoProvided(ctx: Ctx, g: Json, questions: Json[], ticketLabel: string | null, reply: { answer: string; changed: string[] } = { answer: "", changed: [] }): Mail {
  const rows = staffRows(g, questions, ticketLabel);
  const asked = clean(g.info_request, 2000);
  const answer = clean(reply.answer, 2000);
  const list = reply.changed.join(", ");
  const changed = reply.changed.length
    ? `Details changed: ${list}${/[.?!]$/.test(list) ? "" : "."}`
    : "No details were changed.";
  const intro = `${fullName(g)} answered your question. The registration is back in your review list.`;
  return regMail(ctx, `Information provided: ${fullName(g)} — ${ctx.title}`, {
    title: "Information provided",
    body: emP(`${strong(fullName(g))} answered your question. The registration is back in your review list.`, 10) +
      (asked ? emNote(h(asked).replace(/\n/g, "<br>"), "Your question") : "") +
      (answer ? emNote(h(answer).replace(/\n/g, "<br>"), "Their answer") : "") +
      emP(h(changed), 10) +
      emInfoTable(rows.map(([k, v]): [string, string] => [h(k), h(v).replace(/\n/g, "<br>")])),
    text: [
      intro,
      asked ? `Your question: ${asked}` : "",
      answer ? `Their answer: ${answer}` : "",
      changed,
      rows.map(([k, v]) => `${k}: ${v}`).join("\n"),
    ].filter(Boolean).join("\n\n"),
    cta: { label: "Review in the admin", url: adminUrl(ctx) },
  });
}

/** reg_flood_alert: more than 40 registrations in ten minutes. */
function renderFloodAlert(ctx: Ctx, count: number): Mail {
  const a = `${count} registrations arrived in the last ten minutes for ${ctx.title}.`;
  const b = "New registrations from people who are not signed in are paused for a few minutes. Signed-in members can still register. Please check the list for fake entries.";
  return regMail(ctx, `Unusual activity: ${ctx.title}`, {
    title: "Unusual number of registrations",
    body: emP(h(a)) + emP(h(b)),
    text: [a, b].join("\n\n"),
    cta: { label: "Open in the admin", url: adminUrl(ctx) },
  });
}

// ─── wys26 parity: guest-list's templates, copied verbatim (guest-list is frozen) ───
// renderParityAck = guest-list renderRequestAck + the "View my request" button.
// renderParityStaffNotice = guest-list renderStaffNotice, unchanged.
// scripts/email-previews.mjs checks both against the guest-list code.
type Ev = { id: string; slug: string; title: string; capacity: number | null; notify_email: string | null; requests_open: boolean; settings: Record<string, any> };
type Guest = Record<string, any>;

const guestUrl = (ev: Ev, g: Guest) => `${SITE_URL}/${ev.slug}/guest?t=${g.token}`;

/** The line under every e-mail: date, venue, city (plain text, may be empty). */
function eventLine(ev: Ev): string {
  const s = ev.settings || {};
  return `${s.date_label || ""}${s.venue ? ` · ${s.venue}` : ""}${s.city ? `, ${s.city}` : ""}`;
}

/** One e-mail in the shared frame: the event title is the eyebrow, `title` the heading.
 *  `body` is HTML-safe markup, `text` the same content as plain text, `note` a plain
 *  small-print line above the event line. */
function glMail(ev: Ev, subject: string, o: {
  title: string;
  greeting?: string;
  body: string;
  text: string;
  cta?: { label: string; url: string };
  secondary?: { label: string; url: string };
  note?: string;
}): Mail {
  const line = eventLine(ev);
  const footerHtml = [o.note ? h(o.note) : "", line ? h(line) : ""].filter(Boolean).join("<br>");
  const footerText = [o.note || "", line].filter(Boolean).join("\n");
  return {
    subject,
    html: emailLayout({
      pageTitle: h(o.title),
      eyebrow: h(ev.title),
      title: h(o.title),
      greeting: o.greeting ? h(o.greeting) : undefined,
      bodyHtml: o.body,
      cta: o.cta ? { label: h(o.cta.label), url: h(o.cta.url) } : undefined,
      secondary: o.secondary ? { label: h(o.secondary.label), url: h(o.secondary.url) } : undefined,
      footerNote: footerHtml || undefined,
    }),
    text: emText({
      title: o.title,
      greeting: o.greeting,
      body: o.text,
      cta: o.cta,
      secondary: o.secondary,
      footerNote: footerText || undefined,
    }),
  };
}

function renderParityAck(ev: Ev, g: Guest): Mail {
  const text = `Thank you for your interest in ${ev.title}. Attendance is by invitation only; our team reviews every request and will come back to you by email.`;
  return glMail(ev, `Your request — ${ev.title}`, {
    title: g.plus_one_of ? "Plus-one request received" : "Request received",
    greeting: `Dear ${g.first_name},`,
    body: emP(`Thank you for your interest in ${strong(ev.title)}. Attendance is by invitation only; our team reviews every request and will come back to you by email.`),
    text,
    cta: { label: "View my request", url: guestUrl(ev, g) },
  });
}

function renderParityStaffNotice(ev: Ev, g: Guest, host?: Guest | null): Mail {
  const rows: [string, unknown][] = [
    ["Name", `${g.first_name} ${g.last_name}`], ["Email", g.email], ["Phone", g.phone], ["Company", g.company],
    ["Job title", g.job_title], ["Country", g.country],
    ["Wishes to attend", [g.wants_conference && "Conference", g.wants_gala && "Gala dinner"].filter(Boolean).join(" + ")],
  ];
  if (host) rows.unshift(["Plus-one of", `${host.first_name} ${host.last_name} (${host.email})`]);
  const shown = rows.filter(([, v]) => v) as [string, string][];
  const why = g.motivation ? String(g.motivation) : "";
  return glMail(ev, `${host ? "Plus-one request" : "Invitation request"}: ${g.first_name} ${g.last_name} — ${ev.title}`, {
    title: host ? "New plus-one request" : "New invitation request",
    body:
      emInfoTable(shown.map(([k, v]): [string, string] => [h(k), h(v)])) +
      (why ? emNote(h(why).replace(/\n/g, "<br>"), "Why") : ""),
    text: [shown.map(([k, v]) => `${k}: ${v}`).join("\n"), why ? `Why: ${why}` : ""].filter(Boolean).join("\n\n"),
    cta: { label: "Review in the admin", url: `${SITE_URL}/admin/guest-list/${ev.slug}` },
  });
}

// ─── Sending ─────────────────────────────────────────────────────────────────
const safeName = (s: string) => s.replace(/["<>\\]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
const eventFrom = (title: string) => `"${safeName(title) || "Smart Marina Connect"}" <${FROM_ADDRESS}>`;
const replyToOf = (settings: Json | null | undefined) => {
  const c = clean(settings?.contact_email, 200);
  return EMAIL_RE.test(c) ? c : EM.contact;
};

/** Resend, with a retry on its 2-per-second limit. Logged in gl_email_log when `log` is given. */
async function sendMail(o: {
  from: string;
  to: string;
  replyTo: string;
  mail: Mail;
  attachments?: Attachment[];
  log?: { guestId?: string | null; eventId?: string | null; kind: string; by?: string | null };
}): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.error("registration: RESEND_API_KEY is not set, nothing sent");
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
          ...(o.attachments?.length ? { attachments: o.attachments } : {}),
        }),
      });
      if (resp.status === 429 && attempt < 2) {
        await resp.body?.cancel();
        await sleep(1100);
        continue;
      }
      if (!resp.ok) {
        console.error("registration: resend failed", resp.status, (await resp.text()).slice(0, 300));
        return false;
      }
      await resp.body?.cancel();
      if (o.log) {
        const { error } = await db.from("gl_email_log").insert({
          guest_id: o.log.guestId || null,
          event_id: o.log.eventId || null,
          kind: o.log.kind,
          to_email: o.to,
          sent_by: o.log.by || null,
        });
        if (error) console.error("registration: e-mail log failed", error.message);
      }
      return true;
    } catch (e) {
      console.error("registration: send error", e instanceof Error ? e.message : e);
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

/** A fresh status link (raw token only in the e-mail), or null. */
async function mintStatusUrl(ctx: Ctx, guestId: string): Promise<string | null> {
  const { data, error } = await db.rpc("gl_issue_access_token", { p_guest_id: guestId });
  if (error || typeof data !== "string" || !data) {
    console.error("registration: status token not issued", error?.message || "empty");
    return null;
  }
  return statusUrl(ctx, data);
}

async function loadGuest(id: string): Promise<Json | null> {
  const { data } = await db.from("gl_guest").select("*").eq("id", id).maybeSingle();
  return (data as Json | null) || null;
}

async function ticketLabelOf(ctx: Ctx, key: string | null): Promise<string | null> {
  if (!key) return null;
  const { data } = await db.from("gl_ticket").select("label").eq("event_id", ctx.ev.id).eq("key", key).maybeSingle();
  return clean((data as Json | null)?.label, 120) || null;
}

/** The e-mail that matches the row's current status (registration, staff decision, resend). */
async function sendStatusMail(ctx: Ctx, g: Json, by: string | null, sla?: string): Promise<boolean> {
  const status = String(g.status);
  const link = await mintStatusUrl(ctx, g.id);
  const base = { from: eventFrom(ctx.title), to: String(g.email), replyTo: replyToOf(ctx.ev.settings) };
  if (status === "confirmed" && ctx.ev.kind === "webinar") {
    const join = joinUrlOf(ctx);
    const ics = buildIcs(ctx, join);
    return sendMail({
      ...base,
      mail: renderWebinarConfirmed(ctx, g, { status: link, join }),
      attachments: ics ? [{ filename: "event.ics", content: b64Utf8(ics), content_type: "text/calendar; charset=utf-8; method=PUBLISH" }] : undefined,
      log: { guestId: g.id, eventId: ctx.ev.id, kind: "reg_webinar_confirmed", by },
    });
  }
  if (status === "confirmed") {
    const attachments: Attachment[] = [];
    if (g.checkin_token) {
      try {
        const png = await qrPngBase64(passUrl(ctx, g.checkin_token));
        attachments.push(
          { filename: "qr-inline.png", content: png, content_type: "image/png", content_id: "passqr" },
          { filename: "entry-pass.png", content: png, content_type: "image/png" },
        );
      } catch (e) {
        console.error("registration: QR failed", e instanceof Error ? e.message : e);
      }
    }
    const ics = buildIcs(ctx, null);
    if (ics) attachments.push({ filename: "event.ics", content: b64Utf8(ics), content_type: "text/calendar; charset=utf-8; method=PUBLISH" });
    const ticket = await ticketLabelOf(ctx, g.ticket_key || null);
    return sendMail({
      ...base,
      mail: renderOnsiteConfirmed(ctx, g, { status: link, ticket }),
      attachments,
      log: { guestId: g.id, eventId: ctx.ev.id, kind: "reg_confirmed", by },
    });
  }
  if (status === "waitlisted") {
    return sendMail({ ...base, mail: renderWaitlisted(ctx, g, { status: link }), log: { guestId: g.id, eventId: ctx.ev.id, kind: "reg_waitlisted", by } });
  }
  if (status === "needs_info") {
    return sendMail({
      ...base,
      mail: renderInfoRequested(ctx, g, { status: link }, clean(g.info_request, 2000)),
      log: { guestId: g.id, eventId: ctx.ev.id, kind: "reg_info_requested", by },
    });
  }
  if (status === "requested") {
    return sendMail({
      ...base,
      mail: renderReceived(ctx, g, { status: link }, sla || (await reviewSlaText())),
      log: { guestId: g.id, eventId: ctx.ev.id, kind: "reg_received", by },
    });
  }
  return false;
}

/** An e-mail of this kind was logged for this registration within the last `ms`. */
async function sentRecently(guestId: string, kind: string, ms: number): Promise<boolean> {
  const since = new Date(Date.now() - ms).toISOString();
  const { count, error } = await db.from("gl_email_log").select("id", { count: "exact", head: true })
    .eq("guest_id", guestId).eq("kind", kind).gte("sent_at", since);
  if (error) {
    console.error("registration: e-mail log read failed", error.message);
    return false;
  }
  return (count || 0) > 0;
}

async function notifyStaffNew(ctx: Ctx, g: Json, reactivated = false) {
  const to = clean(ctx.ev.notify_email, 200);
  if (!EMAIL_RE.test(to)) return;
  // Cancel then register again: one alert per day and registration is enough.
  if (reactivated && (await sentRecently(g.id, "admin_new_registration", STAFF_NEW_MAIL_GAP_MS))) return;
  const questions = (await questionsOf(ctx.ev.id)).filter((q) => appliesTo(q, g.ticket_key || null));
  const ticket = await ticketLabelOf(ctx, g.ticket_key || null);
  await sendMail({
    from: eventFrom(ctx.title),
    to,
    replyTo: EM.contact,
    mail: renderStaffNewRegistration(ctx, g, questions, ticket),
    log: { guestId: g.id, eventId: ctx.ev.id, kind: "admin_new_registration" },
  });
}

/** Flood: alert the event's staff address at most once per 30 minutes. */
async function floodAlert(ctx: Ctx, count: number) {
  const to = clean(ctx.ev.notify_email, 200);
  if (!EMAIL_RE.test(to)) return;
  const since = new Date(Date.now() - 30 * 60000).toISOString();
  const { count: recent } = await db.from("gl_email_log").select("id", { count: "exact", head: true })
    .eq("event_id", ctx.ev.id).eq("kind", "reg_flood_alert").gte("sent_at", since);
  if ((recent || 0) > 0) return;
  await sendMail({ from: eventFrom(ctx.title), to, replyTo: EM.contact, mail: renderFloodAlert(ctx, count), log: { eventId: ctx.ev.id, kind: "reg_flood_alert" } });
}

// ─── Public: form ────────────────────────────────────────────────────────────
async function actionForm(req: Request, body: Json, caller: Caller | null, flags: Flags): Promise<Response> {
  const ctx = await loadEvent(body);
  if (!ctx) return json(req, { error: "not_found" }, 404);
  const ev = ctx.ev;
  const { data: st, error } = await db.rpc("gl_registration_state", caller ? { p_gl_event_id: ev.id, p_user_id: caller.id } : { p_gl_event_id: ev.id });
  if (error) throw error;
  let s = obj(st);
  // "registered" found through the auth e-mail only counts for an account that proved
  // it (Confirm email is off: anyone can sign up with someone else's address).
  if (caller && s.state === "registered" && s.my_guest_id && !caller.proven) {
    const mine = await loadGuest(String(s.my_guest_id));
    if (mine?.user_id !== caller.id) {
      const { data: anonSt } = await db.rpc("gl_registration_state", { p_gl_event_id: ev.id });
      s = obj(anonSt);
      if (s.state === "members_only" && obj(caller.profile).access_status === "verified") s.state = "open";
    }
  }
  let state = String(s.state || "closed");
  let paused = false;
  if (ev.engine === "core_v2" && state !== "registered" && !v2Enabled(ctx, flags, caller)) {
    state = "closed";
    paused = true;
  }
  if (ev.engine === "guest_list_v1") {
    // The wys26 page uses guest-list's "event" action; this only says which form to post to.
    return json(req, {
      ok: true,
      engine: ev.engine,
      state,
      parity: flags.wys_form_v2 === true || ev.hidden === true,
      event: { gl_event_id: ev.id, slug: ev.slug, title: ctx.title },
      ...(caller && state === "registered" && s.my_status ? { mine: { status: s.my_status, status_display: STATUS_DISPLAY[s.my_status] || s.my_status } } : {}),
    });
  }
  if (state === "not_published" && !caller?.isStaff) {
    return json(req, { ok: true, engine: ev.engine, state, event: { gl_event_id: ev.id, slug: ev.slug } });
  }

  const [tickets, questions, sla] = await Promise.all([ticketsOf(ev.id), questionsOf(ev.id), reviewSlaText()]);
  let allowedTypes: Set<string> | null = null;
  let prefill: Json | undefined;
  if (caller) {
    const { data: mem } = await db.from("organization_members")
      .select("organization_id, organizations(id, name, organization_type, access_status)").eq("user_id", caller.id);
    const orgs = ((mem as Json[] | null) || []).map((m) => obj(m.organizations)).filter((o) => o.id);
    allowedTypes = new Set(orgs.filter((o) => o.access_status === "verified" && o.organization_type).map((o) => String(o.organization_type)));
    const p = obj(caller.profile);
    prefill = {
      first_name: p.first_name || "",
      last_name: p.last_name || "",
      email: caller.email,
      email_locked: true,
      job_title: p.job_title || "",
      country: p.country || "",
      phone: p.phone || "",
      company: orgs.length === 1 ? orgs[0].name : p.affiliation || "",
      organizations: orgs.map((o) => ({ id: o.id, name: o.name })),
      verified: p.access_status === "verified",
    };
  }
  return json(req, {
    ok: true,
    engine: ev.engine,
    state,
    ...(paused ? { paused: true } : {}),
    event: {
      gl_event_id: ev.id,
      event_id: ctx.eventId,
      slug: ev.slug,
      title: ctx.title,
      kind: ev.kind,
      mode: ev.registration_mode,
      access: ev.access,
      public_requests: ev.public_requests,
      waitlist: ev.waitlist,
      starts_at: ctx.startsAt?.toISOString() || null,
      ends_at: ctx.endsAt?.toISOString() || null,
      opens_at: ev.opens_at || null,
      closes_at: ev.closes_at || ctx.endsAt?.toISOString() || null,
      edit_locks_at: ev.edit_locks_at || null,
      timezone: ctx.tz,
      location: ctx.location,
      image_url: ctx.imageUrl,
      hidden: ev.hidden === true,
    },
    fields: fieldsOf(ev),
    tickets: tickets.map((t) => ({
      key: t.key,
      label: t.label,
      description: t.description,
      price_cents: t.price_cents,
      currency: t.currency,
      price_note: t.price_note,
      invite_only: t.invite_only,
      parts: t.parts,
      restricted_to: Array.isArray(t.allowed_company_types) && t.allowed_company_types.length ? t.allowed_company_types : null,
      // Same order as gl_register_v2: invite-only first, then the company types.
      allowed: !t.invite_only && (Array.isArray(t.allowed_company_types) && t.allowed_company_types.length
        ? (allowedTypes ? t.allowed_company_types.some((x: string) => allowedTypes!.has(x)) : false)
        : true),
    })),
    questions: questions.map((q) => ({
      key: q.key, label: q.label, help: q.help, kind: q.kind, options: q.options, max_length: q.max_length,
      required: q.required, ticket_keys: q.ticket_keys, editable_after_submit: q.editable_after_submit,
    })),
    review_sla_text: sla,
    ...(prefill ? { prefill } : {}),
    ...(caller && state === "registered" && s.my_guest_id
      ? { mine: { registration_id: s.my_guest_id, status: s.my_status, status_display: STATUS_DISPLAY[s.my_status] || s.my_status } }
      : {}),
  });
}

// ─── Public: register ────────────────────────────────────────────────────────
async function actionRegister(req: Request, body: Json, caller: Caller | null, flags: Flags): Promise<Response> {
  if (clean(body.website)) return json(req, { ok: true }); // honeypot: pretend success
  const ctx = await loadEvent(body);
  if (!ctx) return json(req, { error: "not_found" }, 404);
  if (ctx.ev.engine === "guest_list_v1") return parityRegister(req, body, caller, flags, ctx);
  if (ctx.ev.engine !== "core_v2") return json(req, { error: "not_found" }, 404);
  if (!v2Enabled(ctx, flags, caller)) return json(req, { ok: false, state: "closed", paused: true });

  const anon = !caller;
  const email = anon ? clean(body.email, 200).toLowerCase() : caller!.email;
  const ip = clientIp(req);
  const scope = anon ? "reg_register" : "reg_register_auth";
  if (anon) {
    if (!EMAIL_RE.test(email)) return json(req, { error: "invalid_email" }, 400);
    const c = obj(body.consents);
    if (!(c.terms === true || (typeof c.terms_at === "string" && c.terms_at.trim()))) return json(req, { error: "terms_required" }, 400);
  }
  // Limits for everyone (signed in: per account address and per IP, looser; no captcha).
  const ipHash = await ipHashOf(ip);
  const emailHash = await emailHashOf(email);
  const [byIp, byEmail] = await Promise.all([
    rateCount(scope, "ip_hash", ipHash, 3600000),
    rateCount(scope, "email_hash", emailHash, 3600000),
  ]);
  if (anon ? byIp >= REG_IP_PER_HOUR || byEmail >= REG_EMAIL_PER_HOUR : byIp >= REG_AUTH_IP_PER_HOUR || byEmail >= REG_AUTH_ACCOUNT_PER_HOUR) {
    return json(req, { error: "rate_limited" }, 429);
  }
  if (anon) {
    if (!(await turnstileAllows(body.captcha, ip, TURNSTILE_ENFORCE || flags.turnstile === true))) return json(req, { error: "captcha" }, 400);
    // Flood guard (contract §5): anonymous callers wait, members and invitations go on.
    const since = new Date(Date.now() - 10 * 60000).toISOString();
    const { count } = await db.from("gl_guest").select("id", { count: "exact", head: true }).eq("event_id", ctx.ev.id).gte("created_at", since);
    if ((count || 0) > FLOOD_PER_10_MIN) {
      await floodAlert(ctx, count || 0);
      return json(req, { error: "busy" }, 429);
    }
  }

  // An account that has not PROVED its address must not take over a cancelled or declined
  // registration of that address made by someone else (signed out, or another account):
  // gl_register_v2 would link it. Noted here, undone right after (DB lane: link on
  // reactivation only when proven).
  let foreignRow: Json | null = null;
  if (caller && !caller.proven) {
    const { data: own } = await db.from("gl_guest").select("id").eq("event_id", ctx.ev.id).eq("user_id", caller.id).limit(1);
    if (!((own as Json[] | null) || []).length) {
      const { data: same } = await db.from("gl_guest").select("id, user_id, status").eq("event_id", ctx.ev.id)
        .ilike("email", likeExact(caller.email)).limit(5);
      foreignRow = ((same as Json[] | null) || []).find((x) => ["cancelled", "declined"].includes(String(x.status))) || null;
    }
  }

  const payload: Json = {
    gl_event_id: ctx.ev.id,
    user_id: caller?.id ?? null,
    email,
    first_name: clean(body.first_name, 80),
    last_name: clean(body.last_name, 80),
    company: clean(body.company, 160),
    job_title: clean(body.job_title, 160),
    phone: clean(body.phone, 40),
    country: clean(body.country, 80),
    ticket_key: clean(body.ticket_key, 40) || null,
    answers: obj(body.answers),
    consents: consentsFrom(body.consents),
    source_detail: obj(body.source_detail),
    organization_id: caller && isUuid(body.organization_id) ? body.organization_id : null,
  };
  const { data, error } = await db.rpc("gl_register_v2", { p: payload });
  if (error) throw error;
  const r = obj(data);
  if (r.ok !== true) {
    if (r.state) return json(req, { ok: false, state: r.state });
    const code = String(r.error || "bad_input");
    const status = code === "account_suspended" ? 403 : code === "not_found" ? 404 : 400;
    return json(req, { error: code, ...(r.fields ? { fields: r.fields } : {}), ...(r.keys ? { keys: r.keys } : {}) }, status);
  }
  await rateRecord(scope, ipHash, emailHash);

  let g = await loadGuest(String(r.guest_id));
  // Undo the link gl_register_v2 made to an unproven account on someone else's row.
  if (g && caller && foreignRow && r.reactivated === true && g.id === foreignRow.id && foreignRow.user_id !== caller.id && g.user_id === caller.id) {
    const { data: undone, error: undoErr } = await db.from("gl_guest").update({ user_id: null })
      .eq("id", g.id).eq("user_id", caller.id).select("*").maybeSingle();
    if (undoErr) console.error("registration: unlink after reactivation failed", undoErr.message);
    else if (undone) g = undone as Json;
  }

  // E-mails after the answer: the timing must not tell a new registration from a repeat.
  const row = g;
  await inBackground("register e-mails", async () => {
    if (!row) return;
    if (r.duplicate === true) {
      // Repeated clicks: one "already registered" e-mail per hour is plenty.
      if (await sentRecently(row.id, "reg_already_registered", ALREADY_REGISTERED_MAIL_GAP_MS)) return;
      const link = await mintStatusUrl(ctx, row.id);
      await sendMail({
        from: eventFrom(ctx.title),
        to: String(row.email),
        replyTo: replyToOf(ctx.ev.settings),
        mail: renderAlreadyRegistered(ctx, row, { status: link }),
        log: { guestId: row.id, eventId: ctx.ev.id, kind: "reg_already_registered" },
      });
    } else {
      await sendStatusMail(ctx, row, null);
      if (ctx.ev.staff_alert_mode !== "digest") await notifyStaffNew(ctx, row, r.reactivated === true);
    }
  });
  // Public answer: identical for a new and a repeated registration (no token, no status).
  if (anon) return json(req, { ok: true });
  // A row that is not this account's and whose address the account has not proved: same public answer.
  if (g?.user_id !== caller!.id && !(caller!.proven && !g?.user_id)) return json(req, { ok: true });
  return json(req, { ok: true, status: r.status, duplicate: r.duplicate === true, registration_id: r.guest_id });
}

/** wys26 parity: guest-list's "request" rules, byte for byte (+ consents, + user_id when proven). */
async function parityRegister(req: Request, body: Json, caller: Caller | null, flags: Flags, ctx: Ctx): Promise<Response> {
  const ev = ctx.ev as Ev & Json;
  if (!(flags.wys_form_v2 === true || ctx.ev.hidden === true)) return json(req, { error: "not_available" }, 403);
  if (!ev.requests_open) return json(req, { error: "closed" }, 400);
  const g = {
    first_name: clean(body.first_name, 80), last_name: clean(body.last_name, 80),
    email: clean(body.email, 200).toLowerCase(), phone: clean(body.phone, 40), company: clean(body.company, 160),
    job_title: clean(body.job_title, 160), country: clean(body.country, 80), motivation: clean(body.motivation, 2000),
    wants_conference: body.wants_conference !== false, wants_gala: body.wants_gala !== false,
  };
  if (!g.first_name || !g.last_name || !EMAIL_RE.test(g.email) || !g.company || !g.job_title)
    return json(req, { error: "missing_fields" }, 400);
  if (!g.wants_conference && !g.wants_gala) return json(req, { error: "no_part" }, 400);
  if (!(await turnstileAllows(body.captcha, clientIp(req), TURNSTILE_ENFORCE || flags.turnstile === true))) return json(req, { error: "captcha" }, 400);
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const { count } = await db.from("gl_guest").select("id", { count: "exact", head: true })
    .eq("event_id", ev.id).eq("source", "request").gte("created_at", since);
  if ((count || 0) > 40) return json(req, { error: "busy" }, 429);
  const { data: existing } = await db.from("gl_guest").select("id, source, status, decided_by, user_id").eq("event_id", ev.id).eq("email", g.email).maybeSingle();
  const extra: Json = { consents: consentsFrom(body.consents) };
  // Linked only to an account that PROVED this very address (the DB guard drops anything else).
  const proven = !!caller && caller.proven && caller.email === g.email;
  let row: Json | null = null;
  if (existing) {
    // Same answer as a new request, whatever the existing status: this form must not reveal
    // who is on the list. One exception: a request its author cancelled from the personal
    // link (wys_status_edit; never touched by staff, whose cancel sets decided_by) comes back
    // to life as a new request (same token, legacy values only).
    const e = existing as Json;
    if (e.source !== "request" || e.status !== "cancelled" || e.decided_by) return json(req, { ok: true });
    const { data: revived, error: reviveErr } = await db.from("gl_guest")
      .update({ ...g, ...extra, ...(proven && !e.user_id ? { user_id: caller!.id } : {}), status: "requested", cancelled_at: null })
      .eq("id", e.id).eq("status", "cancelled").is("decided_by", null).select("*").maybeSingle();
    if (reviveErr) {
      console.error("registration: parity revive failed", reviveErr.code, reviveErr.message);
      return json(req, { ok: true });
    }
    if (!revived) return json(req, { ok: true });
    row = revived as Json;
  } else {
    if (proven) extra.user_id = caller!.id;
    const { data: inserted, error } = await db.from("gl_guest")
      .insert({ ...g, ...extra, event_id: ev.id, source: "request", status: "requested" }).select("*").single();
    if (error) {
      if (error.code === "23505") return json(req, { ok: true });
      console.error("registration: parity insert failed", error.code, error.message);
      return json(req, { error: "server" }, 500);
    }
    row = inserted as Json;
  }
  const evRow: Ev = { id: ev.id, slug: ev.slug, title: ev.title, capacity: ev.capacity, notify_email: ev.notify_email, requests_open: ev.requests_open, settings: ev.settings || {} };
  const from = `${evRow.title.replace(/[<>"]/g, "")} <${FROM_ADDRESS}>`;
  const replyTo = evRow.settings?.contact_email || EM.contact;
  const sent = row as Json;
  await inBackground("wys26 request e-mails", () => Promise.all([
    sendMail({ from, to: sent.email, replyTo, mail: renderParityAck(evRow, sent), log: { guestId: sent.id, eventId: evRow.id, kind: "request_ack" } }),
    evRow.notify_email
      ? sendMail({ from, to: evRow.notify_email, replyTo, mail: renderParityStaffNotice(evRow, sent), log: { guestId: sent.id, eventId: evRow.id, kind: "staff_notify" } })
      : Promise.resolve(false),
  ]));
  return json(req, { ok: true });
}

// ─── Finding the registration of a request (status link, v1 link or session) ─
type Target = {
  g: Json;
  ctx: Ctx;
  via: "token" | "session" | "guest_link";
  readOnly: boolean; // linked to an account and not opened by that account: "Sign in to manage"
  showPass: boolean; // door QR may be shown (inbox holder, or a proven owner)
  callerId: string | null; // the signed-in account that asked (null: signed out)
};

/** Contract §2 for one row: the account proved an address (email_proven_at, profiles.email =
 *  auth e-mail) and that address is the row's. */
async function accountProvenFor(userId: string, rowEmail: string): Promise<boolean> {
  const { data: p } = await db.from("profiles").select("email, email_proven_at").eq("user_id", userId).maybeSingle();
  const prof = p as Json | null;
  const email = rowEmail.trim().toLowerCase();
  if (!prof?.email_proven_at || String(prof.email || "").trim().toLowerCase() !== email) return false;
  const { data: u } = await db.auth.admin.getUserById(userId);
  return (u?.user?.email || "").trim().toLowerCase() === email;
}

async function resolveTarget(body: Json, caller: Caller | null, flags: Flags, o: { touch: boolean; allowGuestLink: boolean }): Promise<Target> {
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (token) {
    if (UUID_RE.test(token)) {
      // A wys26 personal link (gl_guest.token): edit / cancel / attach a request, behind wys_status_edit.
      if (!o.allowGuestLink) throw new HttpError(404, "not_found");
      if (flags.wys_status_edit !== true) throw new HttpError(403, "not_available");
      const { data } = await db.from("gl_guest").select("*").eq("token", token).maybeSingle();
      const g = data as Json | null;
      if (!g) throw new HttpError(404, "not_found");
      const ctx = await loadEventById(g.event_id);
      // A core_v2 gl_guest.token is never a key (contract §1).
      if (!ctx || ctx.ev.engine !== "guest_list_v1") throw new HttpError(404, "not_found");
      return { g, ctx, via: "guest_link", readOnly: false, showPass: false, callerId: caller?.id ?? null };
    }
    if (!ACCESS_TOKEN_RE.test(token)) throw new HttpError(404, "not_found");
    const { data: gid, error } = await db.rpc("gl_resolve_access_token", { p_token: token, p_touch: o.touch });
    if (error) throw error;
    if (typeof gid !== "string" || !gid) throw new HttpError(404, "not_found");
    const g = await loadGuest(gid);
    if (!g) throw new HttpError(404, "not_found");
    const ctx = await loadEventById(g.event_id);
    if (!ctx || ctx.ev.engine !== "core_v2") throw new HttpError(404, "not_found");
    // The token proves the mailbox. Only an account that PROVED this row's address
    // outranks it (Confirm email is off: an unproven account may not be the inbox owner).
    const readOnly = !!g.user_id && g.user_id !== caller?.id && (await accountProvenFor(g.user_id, String(g.email || "")));
    return { g, ctx, via: "token", readOnly, showPass: true, callerId: caller?.id ?? null };
  }
  if (!caller) throw new HttpError(401, "sign_in_required");
  // The account's rows, or (proven address only) a row of that address no account holds yet:
  // `form` and `register` report those too, so the person can manage them.
  const mineOrProven = (x: Json | null) =>
    !!x && (x.user_id === caller.id || (caller.proven && !x.user_id && String(x.email || "").trim().toLowerCase() === caller.email));
  let g: Json | null = null;
  if (isUuid(body.registration_id)) {
    const { data } = await db.from("gl_guest").select("*").eq("id", body.registration_id).maybeSingle();
    g = mineOrProven(data as Json | null) ? (data as Json) : null;
  } else {
    const ctx0 = await loadEvent(body);
    if (ctx0) {
      const { data } = await db.from("gl_guest").select("*").eq("event_id", ctx0.ev.id).eq("user_id", caller.id).maybeSingle();
      g = (data as Json | null) || null;
      if (!g && caller.proven) {
        const { data: byEmail } = await db.from("gl_guest").select("*").eq("event_id", ctx0.ev.id).is("user_id", null)
          .ilike("email", likeExact(caller.email)).limit(1);
        g = ((byEmail as Json[] | null) || [])[0] || null;
      }
    }
  }
  if (!g) throw new HttpError(404, "not_found");
  const ctx = await loadEventById(g.event_id);
  if (!ctx || ctx.ev.engine !== "core_v2") throw new HttpError(404, "not_found");
  // Door codes go to a session only when its address is proven (contract §5).
  return { g, ctx, via: "session", readOnly: false, showPass: caller.proven, callerId: caller.id };
}

// ─── Public: status ──────────────────────────────────────────────────────────
async function statusView(t: Target): Promise<Json> {
  const { g, ctx } = t;
  const ev = ctx.ev;
  const [questions, ticket] = await Promise.all([questionsOf(ev.id), ticketLabelOf(ctx, g.ticket_key || null)]);
  const now = Date.now();
  const lock = tryDate(ev.edit_locks_at);
  const editWindow = !started(ctx) && (!lock || now < lock.getTime());
  const status = String(g.status);
  const canEdit = !t.readOnly && editWindow && ACTIVE_STATUSES.has(status);
  const canCancel = !t.readOnly && !ended(ctx) && ACTIVE_STATUSES.has(status);
  const confirmed = status === "confirmed";
  const answers = obj(g.answers);
  const mine = questions.filter((q) => appliesTo(q, g.ticket_key || null));
  const timeline: Array<{ step: string; at: string }> = [{ step: "received", at: g.created_at }];
  if (g.info_requested_at) timeline.push({ step: "needs_info", at: g.info_requested_at });
  if (g.decided_at && ["confirmed", "rejected", "waitlisted"].includes(status)) timeline.push({ step: STATUS_DISPLAY[status], at: g.decided_at });
  else if (confirmed) timeline.push({ step: "confirmed", at: g.decided_at || g.created_at });
  if (g.cancelled_at && status === "cancelled") timeline.push({ step: "cancelled", at: g.cancelled_at });
  if (g.checked_in_at) timeline.push({ step: "checked_in", at: g.checked_in_at });
  timeline.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const fields = fieldsOf(ev);
  const reminders = obj(g.reminders_sent);
  return {
    ok: true,
    engine: ev.engine,
    via: t.via,
    read_only: t.readOnly,
    event: {
      gl_event_id: ev.id,
      event_id: ctx.eventId,
      slug: ev.slug,
      title: ctx.title,
      kind: ev.kind,
      mode: ev.registration_mode,
      starts_at: ctx.startsAt?.toISOString() || null,
      ends_at: ctx.endsAt?.toISOString() || null,
      timezone: ctx.tz,
      location: ctx.location,
      image_url: ctx.imageUrl,
      ended: ended(ctx),
    },
    registration: {
      id: g.id,
      status,
      status_display: STATUS_DISPLAY[status] || status,
      payment_display: g.payment_status || "none",
      first_name: g.first_name,
      last_name: g.last_name,
      email_masked: maskEmail(String(g.email || "")),
      company: fields.company === "hidden" ? null : g.company,
      job_title: fields.job_title === "hidden" ? null : g.job_title,
      phone: fields.phone === "hidden" ? null : g.phone,
      country: fields.country === "hidden" ? null : g.country,
      ticket_key: g.ticket_key,
      ticket_label: ticket,
      answers,
      info_request: status === "needs_info" ? g.info_request : null,
      created_at: g.created_at,
      linked: !!g.user_id,
      // Linked to the account that is asking (a status link opened while signed in).
      linked_to_me: !!t.callerId && g.user_id === t.callerId,
    },
    timeline,
    fields,
    questions: mine.map((q) => ({
      key: q.key, label: q.label, help: q.help, kind: q.kind, options: q.options, max_length: q.max_length,
      required: q.required, editable: canEdit && q.editable_after_submit !== false,
    })),
    can_edit: canEdit,
    can_edit_names: canEdit && NAME_EDIT_STATUSES.has(status),
    can_cancel: canCancel,
    edit_locks_at: ev.edit_locks_at || null,
    reminders_on: !reminders.off,
    meeting_url: confirmed && ev.kind === "webinar" && !ended(ctx) ? joinUrlOf(ctx) : null,
    replay_url: confirmed && ended(ctx) ? replayUrlOf(ctx) : null,
    pass: confirmed && ev.kind === "onsite" && t.showPass && g.checkin_token ? { qr_text: passUrl(ctx, g.checkin_token) } : null,
    calendar: ctx.startsAt
      ? { title: ctx.title, starts_at: ctx.startsAt.toISOString(), ends_at: (ctx.endsAt || new Date(ctx.startsAt.getTime() + 3600000)).toISOString(), location: ctx.location, url: eventPageUrl(ctx) }
      : null,
  };
}

async function actionStatus(req: Request, body: Json, caller: Caller | null, flags: Flags): Promise<Response> {
  const t = await resolveTarget(body, caller, flags, { touch: true, allowGuestLink: false });
  return json(req, await statusView(t));
}

// ─── Public: update ──────────────────────────────────────────────────────────
async function actionUpdate(req: Request, body: Json, caller: Caller | null, flags: Flags): Promise<Response> {
  const t = await resolveTarget(body, caller, flags, { touch: false, allowGuestLink: true });
  if (t.via === "guest_link") return updateGuestListRequest(req, body, t);
  if (t.readOnly) throw new HttpError(403, "sign_in_required");
  const { g, ctx } = t;
  const ev = ctx.ev;
  const status = String(g.status);
  const lock = tryDate(ev.edit_locks_at);
  if (!ACTIVE_STATUSES.has(status) || started(ctx) || (lock && Date.now() >= lock.getTime())) throw new HttpError(409, "locked");

  const patch: Json = {};
  const missing: string[] = [];
  if (NAME_EDIT_STATUSES.has(status)) {
    for (const f of ["first_name", "last_name"]) {
      if (typeof body[f] === "string") {
        const v = clean(body[f], 80);
        if (!v) missing.push(f);
        else patch[f] = v;
      }
    }
  }
  const fields = fieldsOf(ev);
  for (const f of STD_FIELDS) {
    if (fields[f] === "hidden" || typeof body[f] !== "string") continue;
    const v = clean(body[f], STD_MAX[f]);
    if (!v && fields[f] === "required") missing.push(f);
    else patch[f] = v || null;
  }
  if (missing.length) return json(req, { error: "missing_fields", fields: missing }, 400);

  const incoming = obj(body.answers);
  if (Object.keys(incoming).length) {
    const questions = (await questionsOf(ev.id)).filter((q) => appliesTo(q, g.ticket_key || null) && q.editable_after_submit !== false);
    const answers = { ...obj(g.answers) };
    const bad: string[] = [];
    for (const q of questions) {
      if (!(q.key in incoming)) continue;
      const r = checkAnswer(q, incoming[q.key]);
      if (r.bad) bad.push(q.key);
      else if (r.empty) {
        if (q.required) bad.push(q.key);
        else delete answers[q.key];
      } else answers[q.key] = r.value;
    }
    if (bad.length) return json(req, { error: "invalid_answers", keys: bad }, 400);
    patch.answers = answers;
  }
  // needs_info: sending the form is the answer (changed details, and/or a message to M3 in
  // `info_answer`; confirming the details as they are is an answer too).
  const answeredInfo = status === "needs_info";
  const infoAnswer = answeredInfo && typeof body.info_answer === "string" ? body.info_answer.trim().slice(0, 2000) : "";
  if (answeredInfo) patch.status = "requested";
  if (!Object.keys(patch).length) return json(req, await statusView(t));

  // Optimistic: updated_at is stamped by the DB on every write.
  const { data: up, error } = await db.from("gl_guest").update(patch).eq("id", g.id).eq("updated_at", g.updated_at).select("*").maybeSingle();
  if (error) throw error;
  if (!up) throw new HttpError(409, "changed");
  if (answeredInfo) {
    const allQuestions = await questionsOf(ev.id);
    const changed = changedLabels(g, up as Json, allQuestions);
    // The answer is kept in the registration's history (staff read review_log).
    const { error: logErr } = await db.from("review_log").insert({
      subject_type: "registration",
      subject_id: g.id,
      action: "info_provided",
      note: infoAnswer || null,
      details: { gl_event_id: ev.id, info_request: clean(g.info_request, 2000) || null, changed, via: t.via },
      actor_id: caller?.id ?? null,
    });
    if (logErr) console.error("registration: review_log failed", logErr.message);
    const to = clean(ev.notify_email, 200);
    if (EMAIL_RE.test(to)) {
      const questions = allQuestions.filter((q) => appliesTo(q, up.ticket_key || null));
      await sendMail({
        from: eventFrom(ctx.title),
        to,
        replyTo: EM.contact,
        mail: renderStaffInfoProvided(ctx, up, questions, await ticketLabelOf(ctx, up.ticket_key || null), { answer: infoAnswer, changed }),
        log: { guestId: up.id, eventId: ev.id, kind: "admin_info_provided" },
      });
    }
  }
  return json(req, await statusView({ ...t, g: up as Json }));
}

/** Names of what an update changed (staff e-mail of an answered question). */
function changedLabels(before: Json, after: Json, questions: Json[]): string[] {
  const LABELS: Record<string, string> = { first_name: "First name", last_name: "Last name", company: "Company", job_title: "Job title", phone: "Phone", country: "Country" };
  const norm = (v: unknown) => (v === undefined || v === null || v === "" ? null : v);
  const out: string[] = [];
  for (const [k, label] of Object.entries(LABELS)) if (norm(before[k]) !== norm(after[k])) out.push(label);
  const a = obj(before.answers);
  const b = obj(after.answers);
  for (const q of questions) {
    if (JSON.stringify(norm(a[q.key])) !== JSON.stringify(norm(b[q.key]))) out.push(String(q.label || q.key).slice(0, 80));
  }
  return out;
}

/** wys26 request edited from its personal link (flag wys_status_edit): only while requested. */
async function updateGuestListRequest(req: Request, body: Json, t: Target): Promise<Response> {
  const g = t.g;
  if (g.status !== "requested") throw new HttpError(409, "locked");
  const patch: Json = {};
  if (typeof body.phone === "string") patch.phone = clean(body.phone, 40);
  if (typeof body.country === "string") patch.country = clean(body.country, 80);
  if (typeof body.motivation === "string") patch.motivation = clean(body.motivation, 2000);
  if (typeof body.company === "string") patch.company = clean(body.company, 160);
  if (typeof body.job_title === "string") patch.job_title = clean(body.job_title, 160);
  if ("company" in patch && !patch.company) return json(req, { error: "missing_fields", fields: ["company"] }, 400);
  if ("job_title" in patch && !patch.job_title) return json(req, { error: "missing_fields", fields: ["job_title"] }, 400);
  if (typeof body.wants_conference === "boolean") patch.wants_conference = body.wants_conference;
  if (typeof body.wants_gala === "boolean") patch.wants_gala = body.wants_gala;
  const conf = "wants_conference" in patch ? patch.wants_conference : g.wants_conference;
  const gala = "wants_gala" in patch ? patch.wants_gala : g.wants_gala;
  if (!conf && !gala) return json(req, { error: "no_part" }, 400);
  if (!Object.keys(patch).length) return json(req, { ok: true });
  const { data: up, error } = await db.from("gl_guest").update(patch).eq("id", g.id).eq("status", "requested").select("id").maybeSingle();
  if (error) throw error;
  if (!up) throw new HttpError(409, "locked");
  return json(req, { ok: true });
}

// ─── Public: cancel ──────────────────────────────────────────────────────────
async function actionCancel(req: Request, body: Json, caller: Caller | null, flags: Flags): Promise<Response> {
  const t = await resolveTarget(body, caller, flags, { touch: false, allowGuestLink: true });
  const { g, ctx } = t;
  if (t.via === "guest_link") {
    // wys26: a request only; confirmed guests decline through guest-list's RSVP.
    if (g.status !== "requested") throw new HttpError(409, "locked");
    const { data: up, error } = await db.from("gl_guest").update({ status: "cancelled" }).eq("id", g.id).eq("status", "requested").select("id").maybeSingle();
    if (error) throw error;
    if (!up) throw new HttpError(409, "locked");
    return json(req, { ok: true, status: "cancelled" });
  }
  if (t.readOnly) throw new HttpError(403, "sign_in_required");
  if (!ACTIVE_STATUSES.has(String(g.status)) || ended(ctx)) throw new HttpError(409, "locked");
  const { data: up, error } = await db.from("gl_guest").update({ status: "cancelled" }).eq("id", g.id).eq("status", g.status).select("*").maybeSingle();
  if (error) throw error;
  if (!up) throw new HttpError(409, "changed");
  await sendMail({
    from: eventFrom(ctx.title),
    to: String(up.email),
    replyTo: replyToOf(ctx.ev.settings),
    mail: renderCancelled(ctx, up),
    log: { guestId: up.id, eventId: ctx.ev.id, kind: "reg_cancelled", by: caller?.id || null },
  });
  return json(req, { ok: true, status: "cancelled" });
}

// ─── Public: reminders on / off for one registration ─────────────────────────
async function actionReminders(req: Request, body: Json, caller: Caller | null, flags: Flags): Promise<Response> {
  const t = await resolveTarget(body, caller, flags, { touch: false, allowGuestLink: false });
  const on = body.on === true;
  const g = t.g;
  const rs = { ...obj(g.reminders_sent) };
  if (on) delete rs.off;
  else rs.off = new Date().toISOString();
  const { data: up, error } = await db.from("gl_guest").update({ reminders_sent: rs }).eq("id", g.id).eq("updated_at", g.updated_at).select("id").maybeSingle();
  if (error) throw error;
  if (!up) throw new HttpError(409, "changed");
  return json(req, { ok: true, reminders_on: on });
}

// ─── Public: "Get my links" ──────────────────────────────────────────────────
async function actionResendLinks(req: Request, body: Json, _caller: Caller | null, flags: Flags): Promise<Response> {
  const email = clean(body.email, 200).toLowerCase();
  if (!EMAIL_RE.test(email)) return json(req, { error: "invalid_email" }, 400);
  if (clean(body.website)) return json(req, { ok: true });
  const ip = clientIp(req);
  const ipHash = await ipHashOf(ip);
  const emailHash = await emailHashOf(email);
  const [byEmail, byIp] = await Promise.all([
    rateCount("reg_resend", "email_hash", emailHash, 86400000),
    rateCount("reg_resend", "ip_hash", ipHash, 3600000),
  ]);
  await rateRecord("reg_resend", ipHash, emailHash);
  // Same answer whatever happens: this form never says whether an address registered.
  if (byEmail >= RESEND_EMAIL_PER_DAY || byIp >= RESEND_IP_PER_HOUR) return json(req, { ok: true });

  // The lookup and the e-mail run after the answer: its timing must not tell a known
  // address from an unknown one (spec §5).
  await inBackground("resend links", async () => {
    const { data: rows } = await db.from("gl_guest").select("id, event_id, status, token, first_name, email")
      .eq("email", email).not("status", "in", "(cancelled,declined,rejected)").limit(50);
    const list = (rows as Json[] | null) || [];
    if (!list.length) return;
    const v1Links = flags.wys_status_edit === true || flags.wys_form_v2 === true;
    const items: Array<{ title: string; when: string; url: string; label: string; guestId: string; eventId: string }> = [];
    const ctxCache = new Map<string, Ctx | null>();
    for (const g of list) {
      if (!ctxCache.has(g.event_id)) ctxCache.set(g.event_id, await loadEventById(g.event_id));
      const ctx = ctxCache.get(g.event_id);
      if (!ctx || ended(ctx)) continue;
      if (ctx.ev.engine === "core_v2") {
        const url = await mintStatusUrl(ctx, g.id);
        if (url) items.push({ title: ctx.title, when: whenText(ctx), url, label: "View my registration", guestId: g.id, eventId: ctx.ev.id });
      } else if (v1Links && g.token) {
        const label = g.status === "requested" ? "View my request" : "Open my invitation";
        items.push({ title: ctx.title, when: clean(ctx.ev.settings?.date_label, 120) || whenText(ctx), url: `${SITE_URL}/${ctx.ev.slug}/guest?t=${g.token}`, label, guestId: g.id, eventId: ctx.ev.id });
      }
    }
    if (!items.length) return;
    const sent = await sendMail({ from: PLATFORM_FROM, to: email, replyTo: EM.contact, mail: renderStatusLinks(String(list[0].first_name || ""), items) });
    if (sent) {
      const { error } = await db.from("gl_email_log").insert(items.map((i) => ({ guest_id: i.guestId, event_id: i.eventId, kind: "reg_status_links", to_email: email })));
      if (error) console.error("registration: e-mail log failed", error.message);
    }
  });
  return json(req, { ok: true });
}

// ─── Signed in: attach a registration to my account ──────────────────────────
async function actionAttach(req: Request, body: Json, caller: Caller | null, flags: Flags): Promise<Response> {
  if (!caller) throw new HttpError(401, "sign_in_required");
  if (typeof body.token !== "string" || !body.token.trim()) return json(req, { error: "bad_input" }, 400);
  const t = await resolveTarget({ token: body.token }, caller, flags, { touch: false, allowGuestLink: true });
  const g = t.g;
  if (g.user_id === caller.id) return json(req, { ok: true, already: true });
  if (g.user_id) return json(req, { error: "linked_elsewhere" }, 409);
  const { data: other } = await db.from("gl_guest").select("id").eq("event_id", g.event_id).eq("user_id", caller.id).limit(1);
  if ((other as Json[] | null)?.length) return json(req, { error: "already_registered" }, 409);
  // The token proves the registration's mailbox, the session proves the account.
  // Never stamps email_proven_at (contract §5).
  const { data: up, error } = await db.from("gl_guest").update({ user_id: caller.id }).eq("id", g.id).is("user_id", null).select("id").maybeSingle();
  if (error) {
    if (error.code === "23505") return json(req, { error: "already_registered" }, 409);
    throw error;
  }
  if (!up) return json(req, { error: "linked_elsewhere" }, 409);
  const { error: logErr } = await db.from("review_log").insert({
    subject_type: "registration",
    subject_id: g.id,
    action: "attach",
    details: { gl_event_id: g.event_id, via: t.via, same_email: String(g.email || "").toLowerCase() === caller.email },
    actor_id: caller.id,
  });
  if (logErr) console.error("registration: review_log failed", logErr.message);
  return json(req, { ok: true });
}

// ─── Staff ───────────────────────────────────────────────────────────────────
async function actionDecide(req: Request, body: Json, caller: Caller | null): Promise<Response> {
  const staff = requireStaff(caller);
  if (!isUuid(body.gl_event_id)) return json(req, { error: "bad_input" }, 400);
  const ids = (Array.isArray(body.guest_ids) ? body.guest_ids : []).filter(isUuid).slice(0, MAX_DECIDE_IDS);
  if (!ids.length) return json(req, { error: "bad_input" }, 400);
  const decision = clean(body.decision, 20);
  const orgAction = body.org_action && typeof body.org_action === "object" && !Array.isArray(body.org_action) ? body.org_action : { mode: "none" };
  const { data, error } = await db.rpc("gl_decide_v2", {
    p_gl_event_id: body.gl_event_id,
    p_guest_ids: ids,
    p_decision: decision,
    p_actor: staff.id,
    p_org_action: orgAction,
    p_validate_person: body.validate_person !== false,
    p_force: body.force === true,
    p_info_request: typeof body.info_request === "string" ? body.info_request : null,
    p_note: typeof body.note === "string" ? body.note : null,
  });
  if (error) throw error;
  const r = obj(data);
  if (r.ok !== true) {
    const code = String(r.error || "bad_input");
    const status = code === "forbidden" ? 403 : code === "not_found" ? 404 : code === "capacity" || code === "ticket_capacity" ? 409 : 400;
    return json(req, r, status);
  }
  const changed: string[] = Array.isArray(r.changed) ? r.changed : [];
  let sent = 0;
  let failed = 0;
  const notify = decision === "reject" ? body.notify === true : body.notify !== false;
  if (changed.length && notify) {
    const ctx = await loadEventById(body.gl_event_id);
    const { data: rows } = await db.from("gl_guest").select("*").in("id", changed);
    const sla = await reviewSlaText();
    for (const g of (rows as Json[] | null) || []) {
      if (!ctx) break;
      let ok: boolean;
      if (decision === "reject") {
        ok = await sendMail({
          from: eventFrom(ctx.title), to: String(g.email), replyTo: replyToOf(ctx.ev.settings),
          mail: renderNotAccepted(ctx, g), log: { guestId: g.id, eventId: ctx.ev.id, kind: "reg_not_accepted", by: staff.id },
        });
      } else {
        ok = await sendStatusMail(ctx, g, staff.id, sla);
      }
      if (ok) sent++;
      else failed++;
    }
  }
  return json(req, { ...r, sent, failed });
}

/** Staff: e-mail a registration's link again (also wys26 rows: the fallback when the kill switch is off). */
async function actionSendStatusLink(req: Request, body: Json, caller: Caller | null): Promise<Response> {
  const staff = requireStaff(caller);
  if (!isUuid(body.guest_id)) return json(req, { error: "bad_input" }, 400);
  const g = await loadGuest(body.guest_id);
  if (!g) return json(req, { error: "not_found" }, 404);
  const ctx = await loadEventById(g.event_id);
  if (!ctx) return json(req, { error: "not_found" }, 404);
  let item: { title: string; when: string; url: string; label: string } | null = null;
  if (ctx.ev.engine === "core_v2") {
    const url = await mintStatusUrl(ctx, g.id);
    if (url) item = { title: ctx.title, when: whenText(ctx), url, label: "View my registration" };
  } else if (g.token) {
    item = {
      title: ctx.title,
      when: clean(ctx.ev.settings?.date_label, 120) || whenText(ctx),
      url: `${SITE_URL}/${ctx.ev.slug}/guest?t=${g.token}`,
      label: g.status === "requested" ? "View my request" : "Open my invitation",
    };
  }
  if (!item) return json(req, { error: "server" }, 500);
  const ok = await sendMail({
    from: eventFrom(ctx.title),
    to: String(g.email),
    replyTo: replyToOf(ctx.ev.settings),
    mail: renderStatusLinks(String(g.first_name || ""), [item]),
    log: { guestId: g.id, eventId: ctx.ev.id, kind: "reg_status_links", by: staff.id },
  });
  return json(req, { ok });
}

/** Staff: send the e-mail of the row's current status again (core_v2 only). */
async function actionResend(req: Request, body: Json, caller: Caller | null): Promise<Response> {
  const staff = requireStaff(caller);
  if (!isUuid(body.guest_id)) return json(req, { error: "bad_input" }, 400);
  const g = await loadGuest(body.guest_id);
  if (!g) return json(req, { error: "not_found" }, 404);
  const ctx = await loadEventById(g.event_id);
  if (!ctx) return json(req, { error: "not_found" }, 404);
  if (ctx.ev.engine !== "core_v2") return json(req, { error: "use_guest_list" }, 400);
  if (!["confirmed", "waitlisted", "requested", "needs_info"].includes(String(g.status))) return json(req, { error: "nothing_to_resend" }, 400);
  return json(req, { ok: await sendStatusMail(ctx, g, staff.id) });
}

// ─── Handler ─────────────────────────────────────────────────────────────────
type Handler = (req: Request, body: Json, caller: Caller | null, flags: Flags) => Promise<Response>;
// An expired or revoked session is answered 401 "session_expired" by the actions that
// act for the account; the token-based ones (status link pages) go on as anonymous.
const SESSION_ACTIONS = new Set(["register", "attach", "decide", "send_status_link", "resend"]);
const ACTIONS: Record<string, Handler> = {
  form: actionForm,
  register: actionRegister,
  status: actionStatus,
  update: actionUpdate,
  cancel: actionCancel,
  reminders: actionReminders,
  resend_links: actionResendLinks,
  attach: actionAttach,
  decide: (req, body, caller) => actionDecide(req, body, caller),
  send_status_link: (req, body, caller) => actionSendStatusLink(req, body, caller),
  resend: (req, body, caller) => actionResend(req, body, caller),
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);
  let body: Json;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return json(req, { error: "too_large" }, 413);
    body = obj(JSON.parse(raw));
  } catch {
    return json(req, { error: "invalid_json" }, 400);
  }
  const action = String(body.action || "");
  const handler = ACTIONS[action];
  if (!handler) return json(req, { error: "unknown_action" }, 400);
  try {
    const who = await getCaller(req);
    const tokenOnly = typeof body.token === "string" && body.token.trim() !== "" && action !== "attach";
    if (who === "expired" && (SESSION_ACTIONS.has(action) || !tokenOnly && action !== "form" && action !== "resend_links")) {
      return json(req, { error: "session_expired" }, 401);
    }
    const caller = who === "expired" ? null : who;
    const flags = await loadFlags();
    return await handler(req, body, caller, flags);
  } catch (e) {
    if (e instanceof HttpError) return json(req, { error: e.code }, e.status);
    console.error("registration: error in", String(body.action), e instanceof Error ? e.message : JSON.stringify(e));
    return json(req, { error: "server" }, 500);
  }
});
