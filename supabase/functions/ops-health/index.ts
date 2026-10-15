// ops-health -- the platform health monitor of Smart Marina Connect
// (docs/operations/health-monitor.md; migration 20261016120000_ops_health_check).
//
// Called by pg_cron through public.invoke_ops_health() with the Vault service key. The
// invoker runs every 15 minutes but only calls this function when
// platform_settings.ops_health.enabled is JSON true and the last run (ops_health_run) is
// older than ops_health.interval_minutes (15 to 300, default 60). Each run:
//   1. reads public.ops_health_report() (the database checks: ok / warn / fail);
//   2. adds three HTTP checks unless ops_health.http_checks is false: the site and its main
//      bundle, the RSS feed (X-SMC-Feed: live and at least one item), Supabase Auth health;
//   3. e-mails ops_health.recipients ONLY when a check is warn or fail, and at most once per
//      problem per ops_health.realert_hours (6 to 48, default 6). A problem is a check at a
//      level: a warn that turns into a fail is e-mailed at once. Checks listed in
//      ops_health.mute are recorded but never e-mailed ("<check id>:warn" mutes the warn
//      level only, so a fail of that check is still e-mailed);
//   4. records the run in ops_health_run (kept 30 days) and the problems in ops_health_alert;
//   5. pings ops_health.heartbeat_url (an external heartbeat service, optional) once the run
//      is recorded and nothing due was left unsent. When the pings stop (pg_cron, pg_net or
//      the Vault secrets broken, this function failing, e-mail not leaving), the external
//      service raises the alarm the monitor cannot raise about itself.
// It changes nothing else: it reads, e-mails and writes its own two tables.
//
// POST body, all optional:
//   {"force": true}  run even while ops_health.enabled is false (manual run);
//   {"send": false}  return the report only: no e-mail, nothing written;
//   {"test": true}   send one test e-mail to the recipients (current problems, or none),
//                    without touching the re-alert memory.
//
// verify_jwt = TRUE, and the caller must hold a service-role key (checked below: any valid
// user JWT passes the gateway). The e-mail holds check ids, counts and job or function
// names only, never personal data. It uses the shared layout (docs/email-layout.ts).
// This file must not contain a literal backslash-u escape (the MCP deploy mangles them).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const SITE_URL = (Deno.env.get("SITE_URL") || "https://smartmarinaconnect.com").replace(/\/+$/, "");
const PLATFORM_FROM = "Smart Marina Connect <noreply@smartmarinaconnect.com>";
const HTTP_TIMEOUT_MS = 10000;
const RUN_KEEP_DAYS = 30;
const MAX_RECIPIENTS = 10;

const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });

// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
type Status = "ok" | "warn" | "fail";
interface Check {
  check_id: string;
  area: string;
  status: Status;
  summary: string;
  detail?: Json | null;
}
interface Mail {
  subject: string;
  html: string;
  text: string;
}

const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// ─── Caller: service role only (same check as registration-cron) ─────────────
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

// ─── Settings (platform_settings.ops_health) ─────────────────────────────────
function settingsOf(value: unknown) {
  const o = obj(value);
  const num = (x: unknown, lo: number, hi: number, dflt: number) =>
    typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : dflt;
  const strings = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string").map((s) => s.trim()) : []);
  return {
    enabled: o.enabled === true,
    recipients: [...new Set(strings(o.recipients).map((s) => s.toLowerCase()).filter((s) => EMAIL_RE.test(s)))].slice(0, MAX_RECIPIENTS),
    realertHours: num(o.realert_hours, 6, 48, 6),
    mute: new Set(strings(o.mute)),
    httpChecks: o.http_checks !== false,
    heartbeatUrl: typeof o.heartbeat_url === "string" && /^https:\/\/[^\s]+$/.test(o.heartbeat_url.trim()) && o.heartbeat_url.trim().length <= 500
      ? o.heartbeat_url.trim()
      : "",
  };
}

/** A check id muted whole ("reg.provisioning") or at this level only ("reg.provisioning:warn"). */
function isMuted(c: Check, mute: Set<string>): boolean {
  return mute.has(c.check_id) || mute.has(`${c.check_id}:${c.status}`);
}

/** The heartbeat goes only when the run is recorded and every problem due now was e-mailed. */
function heartbeatDue(runRecorded: boolean, dueCount: number, emailed: number): boolean {
  return runRecorded && (dueCount === 0 || emailed > 0);
}

// ─── Re-alert rule ───────────────────────────────────────────────────────────
/** The problems to e-mail now: never e-mailed, escalated to fail, or last e-mailed realertMs ago or more. Muted checks never. */
function decideDue(problems: Check[], previous: Map<string, Json>, mute: Set<string>, realertMs: number, nowMs: number): Check[] {
  return problems.filter((c) => {
    if (isMuted(c, mute)) return false;
    const p = previous.get(c.check_id);
    if (!p || !p.last_alert_at) return true;
    if (c.status === "fail" && p.last_alert_status !== "fail") return true;
    const last = Date.parse(String(p.last_alert_at));
    return !Number.isFinite(last) || nowMs - last >= realertMs;
  });
}

// ─── HTTP checks ─────────────────────────────────────────────────────────────
async function fetchSoon(url: string, init: RequestInit = {}): Promise<Response | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), HTTP_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, redirect: "follow", signal: ac.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Runs a probe, and once more after 5 s if it was not ok (one network blip is not an alert). */
async function twice(probe: () => Promise<Check>): Promise<Check> {
  const first = await probe();
  if (first.status === "ok") return first;
  await sleep(5000);
  return probe();
}

/**
 * The index AND the bundle it names. Netlify answers ANY missing path with index.html and a
 * 200 (the SPA catch-all of netlify.toml), so the bundle must also BE JavaScript: a
 * javascript content type and a body that does not start with "<".
 */
async function probeSite(): Promise<Check> {
  const base = { check_id: "web.site", area: "web" };
  const r = await fetchSoon(`${SITE_URL}/`);
  if (!r || !r.ok) {
    await r?.body?.cancel();
    return { ...base, status: "fail", summary: `The site did not answer (${r ? r.status : "no answer"}).` };
  }
  const html = await r.text();
  const bundle = html.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/);
  if (!bundle) return { ...base, status: "warn", summary: "The site answered, but its page names no main bundle." };
  const b = await fetchSoon(`${SITE_URL}${bundle[0]}`);
  if (!b || !b.ok) {
    await b?.body?.cancel();
    return { ...base, status: "fail", summary: `The site answered, but its main bundle did not (${b ? b.status : "no answer"}): broken deploy?` };
  }
  const type = (b.headers.get("content-type") || "").toLowerCase();
  // The first chunk is enough: the bundle itself is megabytes.
  const reader = b.body?.getReader();
  let head = "";
  try {
    const first = reader ? await reader.read() : null;
    head = new TextDecoder().decode(first?.value || new Uint8Array()).slice(0, 200).trimStart();
  } catch { /* unreadable body: judged on the type alone */ }
  await reader?.cancel().catch(() => {});
  if (!type.includes("javascript") || head.startsWith("<")) {
    return { ...base, status: "fail", summary: `The site answered, but its main bundle came back as a page, not JavaScript (${type || "no type"}): broken deploy?` };
  }
  return { ...base, status: "ok", summary: "The site and its main bundle answer (JavaScript)." };
}

async function probeRss(): Promise<Check> {
  const base = { check_id: "web.rss", area: "web" };
  const r = await fetchSoon(`${SITE_URL}/rss.xml`);
  if (!r || !r.ok) {
    await r?.body?.cancel();
    return { ...base, status: "warn", summary: `The RSS feed did not answer (${r ? r.status : "no answer"}).` };
  }
  const feed = (r.headers.get("x-smc-feed") || "").toLowerCase();
  const items = ((await r.text()).match(/<item>/g) || []).length;
  if (feed !== "live" || items === 0) return { ...base, status: "warn", summary: `The RSS feed answered ${feed || "without its live marker"} with ${items} item(s).` };
  return { ...base, status: "ok", summary: `The RSS feed is live (${items} item(s)).` };
}

async function probeAuth(): Promise<Check> {
  const base = { check_id: "web.auth", area: "web" };
  const r = await fetchSoon(`${SUPABASE_URL}/auth/v1/health`, { headers: { apikey: ANON_KEY || SERVICE_ROLE } });
  await r?.body?.cancel();
  if (!r || !r.ok) return { ...base, status: "fail", summary: `Supabase Auth did not answer its health check (${r ? r.status : "no answer"}): sign-in may be down.` };
  return { ...base, status: "ok", summary: "Supabase Auth answers." };
}

// ─── E-mail ──────────────────────────────────────────────────────────────────
// The shared layout is pasted below. Keep it identical in every function that sends an
// e-mail: docs/email-layout.ts, checked by `node scripts/email-previews.mjs --check`.
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

const h = (v: unknown) => emEsc(String(v ?? ""));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The alert (or test) e-mail. `due` are the problems e-mailed now; `others` are still open but reported less than realertHours ago. */
function renderAlert(o: { due: Check[]; others: Check[]; when: Date; realertHours: number; ctaUrl: string; test?: boolean }): Mail {
  const all = [...o.due, ...o.others];
  const nFail = all.filter((c) => c.status === "fail").length;
  const nWarn = all.length - nFail;
  const when = `${o.when.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  const title = o.test ? "Health monitor test" : `${plural(o.due.length, "check needs", "checks need")} attention`;
  const intro = o.test
    ? `This is a test of the health monitor e-mail. ${all.length ? `${plural(all.length, "check is", "checks are")} not ok right now:` : "Every check is ok right now."}`
    : `The health check of ${when} found ${plural(o.due.length, "problem", "problems")} to report. Nothing was changed automatically.`;
  const rows: Array<[string, string]> = (o.test ? all : o.due).map((c) => [
    `${h(c.status.toUpperCase())} &middot; ${h(c.area)}`,
    `<strong style="color:${EM.navy};">${h(c.check_id)}</strong><br>${h(c.summary)}`,
  ]);
  const textRows = (o.test ? all : o.due).map((c) => `${c.status.toUpperCase()} ${c.check_id}: ${c.summary}`);
  const still = !o.test && o.others.length
    ? `Still open, already reported in the last ${o.realertHours} hours: ${o.others.map((c) => c.check_id).join(", ")}.`
    : "";
  const help = "Full report: run select * from ops_health_report(); in the Supabase SQL editor. What each check means and what to do: docs/operations/health-monitor.md. To stop e-mails about a known problem, add its check id (or check id:warn, which still lets a fail through) to mute in the ops_health platform setting.";
  const footer = `Sent by the ops-health monitor, at most once every ${o.realertHours} hours per problem. Recipients and schedule: platform setting ops_health.`;
  const subject = o.test
    ? "Test: Smart Marina Connect health monitor"
    : `Health check: ${nFail ? `${nFail} failing` : ""}${nFail && nWarn ? ", " : ""}${nWarn ? plural(nWarn, "warning", "warnings") : ""} - Smart Marina Connect`;
  return {
    subject,
    html: emailLayout({
      pageTitle: h(title),
      preheader: h(textRows[0] || intro),
      eyebrow: "Platform health",
      title: h(title),
      bodyHtml: emP(h(intro), 10) + emInfoTable(rows) + (still ? emP(h(still)) : "") + emP(h(help)),
      cta: { label: "Open the Supabase project", url: h(o.ctaUrl) },
      footerNote: h(footer),
    }),
    text: emText({
      title,
      body: [intro, textRows.join("\n"), still, help].filter(Boolean).join("\n\n"),
      cta: { label: "Open the Supabase project", url: o.ctaUrl },
      footerNote: footer,
    }),
  };
}

/** https://supabase.com/dashboard/project/<ref> from https://<ref>.supabase.co, else the site's admin. */
function projectUrl(supabaseUrl: string, site: string): string {
  const m = supabaseUrl.match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/);
  return m ? `https://supabase.com/dashboard/project/${m[1]}` : `${site}/admin`;
}

async function sendMail(to: string, mail: Mail): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.error("ops-health: RESEND_API_KEY is not set, nothing sent");
    return false;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: PLATFORM_FROM, to: [to], reply_to: EM.contact, subject: mail.subject, html: mail.html, text: mail.text }),
      });
      if (resp.status === 429 && attempt < 2) {
        await resp.body?.cancel();
        await sleep(1100);
        continue;
      }
      if (!resp.ok) {
        console.error("ops-health: resend failed", resp.status, (await resp.text()).slice(0, 300));
        return false;
      }
      await resp.body?.cancel();
      return true;
    } catch (e) {
      console.error("ops-health: send error", e instanceof Error ? e.message : e);
      return false;
    }
  }
  return false;
}

// ─── Run ─────────────────────────────────────────────────────────────────────
async function collect(httpChecks: boolean): Promise<{ checks: Check[]; error: string | null }> {
  let checks: Check[] = [];
  let error: string | null = null;
  const { data, error: rpcError } = await db.rpc("ops_health_report");
  if (rpcError) {
    error = rpcError.message;
    checks.push({ check_id: "report.unavailable", area: "monitor", status: "fail", summary: `The health report could not run: ${rpcError.message.slice(0, 200)}` });
  } else {
    checks = ((data as Check[] | null) || []).filter((c) => c && typeof c.check_id === "string");
  }
  if (httpChecks) checks = checks.concat(await Promise.all([twice(probeSite), twice(probeRss), twice(probeAuth)]));
  return { checks, error };
}

/** Writes the re-alert memory: every current problem (muted ones too), the e-mailed ones stamped, the solved ones cleared. */
async function remember(problems: Check[], previous: Map<string, Json>, emailedIds: Set<string>, now: Date): Promise<void> {
  const iso = now.toISOString();
  if (problems.length) {
    const rows = problems.map((c) => {
      const p = previous.get(c.check_id);
      const open = p && !p.cleared_at;
      const mailed = emailedIds.has(c.check_id);
      return {
        check_id: c.check_id,
        status: c.status,
        summary: c.summary.slice(0, 500),
        first_seen_at: open ? p.first_seen_at : iso,
        last_seen_at: iso,
        last_alert_at: mailed ? iso : p?.last_alert_at ?? null,
        last_alert_status: mailed ? c.status : p?.last_alert_status ?? null,
        cleared_at: null,
      };
    });
    const { error } = await db.from("ops_health_alert").upsert(rows, { onConflict: "check_id" });
    if (error) console.error("ops-health: alert memory not written", error.message);
  }
  const current = new Set(problems.map((c) => c.check_id));
  const solved = [...previous.values()].filter((p) => !p.cleared_at && !current.has(p.check_id)).map((p) => p.check_id);
  if (solved.length) {
    const { error } = await db.from("ops_health_alert").update({ cleared_at: iso }).in("check_id", solved);
    if (error) console.error("ops-health: solved problems not cleared", error.message);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonRes({ ok: false, error: "method_not_allowed" }, 405);
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!(await isServiceRole(bearer))) return jsonRes({ ok: false, error: "unauthorized" }, 401);
  let body: Json = {};
  try {
    body = obj(await req.json());
  } catch { /* empty body */ }
  const force = body.force === true;
  const send = body.send !== false;
  const test = body.test === true;
  try {
    const { data: row, error: cfgError } = await db.from("platform_settings").select("value").eq("key", "ops_health").maybeSingle();
    if (cfgError) console.error("ops-health: settings not read", cfgError.message);
    const cfg = settingsOf((row as Json | null)?.value);
    if (!cfg.enabled && !force && !test) return jsonRes({ ok: true, skipped: "disabled" });

    const now = new Date();
    const { checks, error } = await collect(cfg.httpChecks);
    const problems = checks.filter((c) => c.status === "warn" || c.status === "fail");
    const counts = {
      ok: checks.length - problems.length,
      warn: problems.filter((c) => c.status === "warn").length,
      fail: problems.filter((c) => c.status === "fail").length,
    };
    const worst: Status = counts.fail ? "fail" : counts.warn ? "warn" : "ok";
    const brief = problems.map((c) => ({ check_id: c.check_id, status: c.status }));
    if (!send) return jsonRes({ ok: true, preview: true, worst, counts, checks });

    const ctaUrl = projectUrl(SUPABASE_URL, SITE_URL);
    if (test) {
      const mail = renderAlert({ due: problems, others: [], when: now, realertHours: cfg.realertHours, ctaUrl, test: true });
      let sent = 0;
      for (const to of cfg.recipients) if (await sendMail(to, mail)) sent++;
      return jsonRes({ ok: true, test: true, worst, counts, recipients: cfg.recipients.length, emailed: sent });
    }

    const previous = new Map<string, Json>();
    const { data: prevRows, error: prevError } = await db.from("ops_health_alert").select("*");
    if (prevError) console.error("ops-health: alert memory not read", prevError.message);
    for (const p of (prevRows as Json[] | null) || []) previous.set(String(p.check_id), p);

    const due = decideDue(problems, previous, cfg.mute, cfg.realertHours * 3600000, now.getTime());
    const dueIds = new Set(due.map((c) => c.check_id));
    const others = problems.filter((c) => !dueIds.has(c.check_id) && !isMuted(c, cfg.mute));
    let emailed = 0;
    if (due.length && cfg.recipients.length) {
      const mail = renderAlert({ due, others, when: now, realertHours: cfg.realertHours, ctaUrl });
      for (const to of cfg.recipients) if (await sendMail(to, mail)) emailed++;
    } else if (due.length) {
      console.error("ops-health: problems to report but no valid recipient in ops_health.recipients");
    }
    // Only an e-mail that left stamps the problems: a failed send is retried on the next run.
    await remember(problems, previous, emailed ? dueIds : new Set(), now);

    const { error: runError } = await db.from("ops_health_run").insert({
      run_at: now.toISOString(), worst, n_ok: counts.ok, n_warn: counts.warn, n_fail: counts.fail, emailed, problems: brief, error,
    });
    if (runError) console.error("ops-health: run not recorded", runError.message);
    const { error: pruneError } = await db.from("ops_health_run").delete().lt("run_at", new Date(now.getTime() - RUN_KEEP_DAYS * 86400000).toISOString());
    if (pruneError) console.error("ops-health: old runs not pruned", pruneError.message);

    // The heartbeat: silence from it is what tells the external service that this monitor
    // stopped. Nothing is sent but the GET itself.
    let heartbeat = "off";
    if (cfg.heartbeatUrl) {
      if (heartbeatDue(!runError, due.length, emailed)) {
        const hb = await fetchSoon(cfg.heartbeatUrl);
        await hb?.body?.cancel();
        heartbeat = hb && hb.ok ? "sent" : "failed";
        if (heartbeat === "failed") console.error("ops-health: heartbeat not accepted", hb ? hb.status : "no answer");
      } else {
        heartbeat = "withheld";
        console.error("ops-health: heartbeat withheld (run not recorded, or problems due and no e-mail left)");
      }
    }

    return jsonRes({ ok: true, worst, counts, problems: brief, due: [...dueIds], emailed, heartbeat });
  } catch (e) {
    console.error("ops-health: run failed", e instanceof Error ? e.message : JSON.stringify(e));
    return jsonRes({ ok: false, error: "server" }, 500);
  }
});
