// messages-digest -- the Friday e-mail of company messaging (Victor's decisions of
// 9 Oct 2026, memory "messaging-decisions"). There is NO e-mail per message or per
// request: once a week, each person who has something waiting gets ONE e-mail:
// "This week you received X messages", up to three previews (sender, company, first
// 140 characters; "Sent a file" for a photo or PDF sent without text, messaging v2 of
// 10 Oct 2026), the requests to connect waiting for their company listed
// separately, and a button to their Messages (/inbox: a signed-out reader gets the
// sign-in form there, then Messages; /?open=inbox would show them the public home
// page instead).
//
// Who and what: public.msg_digest_batch() (migration 20261009190000_company_messaging.sql)
// decides it in SQL: verified people whose "Messages from companies" e-mails are on
// (profiles.notification_prefs ->> 'b2b' is not false, the category send-notification
// uses for b2b), with unread messages from the other company since their last digest
// (where its data ended, covered_until; 7 days for a first one, never more than 30),
// or requests sent to their company in that time and still pending. A person whose
// digest for this ISO week is in public.digest_log (sent, or being sent for less than
// 15 minutes) is left out, so a second run in the same week sends nothing twice.
//
// Each send: claim the digest_log row (status 'sending', with covered_until = the
// batch's as_of, where the next digest starts; a conflict means another run has it:
// skipped; a 'sending' row older than 15 minutes is a run that died and is replaced),
// send through Resend (15 s at most, with an idempotency key per person and week, so
// a retry after a lost answer does not send it twice), then mark it 'sent' (or delete
// the claim when the send failed, so the 10:30 run retries). The unsubscribe link is personal and signed
// (category b2b), exactly like send-notification's; the one-click header points at the
// unsubscribe function.
//
// Trigger: pg_cron job "messages-digest-friday" (LAUNCH-DAY migration
// 20261009190001_messages_digest_cron.sql), which calls public.invoke_messages_digest()
// (POST with the Vault service_role key). It goes ahead on Fridays at 10:00 and 10:30
// in Monaco, summer and winter time alike: the 10:30 run sends what the first one
// left (time budget below, a send Resend refused). Deploy this function only on the
// day the refonte replaces the old site (the old site still e-mails each request and
// has no Messages screen).
// Security: verify_jwt = TRUE, and the caller must hold a service-role key (the env
// key, or a JWT GoTrue accepts as service role): the anon key and member tokens are
// refused (401). To run it by hand:
//   POST /functions/v1/messages-digest  Authorization: Bearer <service_role key>
//   body {}                     send this week's digests
//   body {"dry_run": true}      count and render them, send and log nothing
//   body {"limit": 50}          at most 50 people in this run
// or, from SQL, outside the Friday 10:00 Monaco window: SELECT public.invoke_messages_digest(true);
//
// No e-mail address is ever logged. E-mails are in English. This file must not
// contain a literal backslash-u escape (the MCP deploy tool mangles them).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const SENDER_EMAIL = Deno.env.get("SENDER_EMAIL") || "Smart Marina Connect <noreply@smartmarinaconnect.com>";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SITE_URL = (Deno.env.get("SITE_URL") || "https://smartmarinaconnect.com").replace(/\/+$/, "");

/** Resend accepts 2 requests a second by default: one e-mail every 600 ms. */
const SEND_GAP_MS = 600;
/** One call to Resend waits this long at most (budget below + one call stays under the edge wall clock). */
const SEND_TIMEOUT_MS = 15_000;
/** A 'sending' claim older than this belongs to a run that died: it is replaced (msg_digest_batch uses the same 15 minutes). */
const STALE_CLAIM_MS = 15 * 60_000;
/** Stop starting new e-mails after this long (the edge runtime has a wall-clock limit); the 10:30 run continues. */
const TIME_BUDGET_MS = 110_000;
const DEFAULT_LIMIT = 300;

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

/**
 * True for the env service-role key, or for another JWT that claims the
 * service_role AND that GoTrue accepts on an admin-only endpoint (which verifies
 * the signature). The anon key, member tokens and forged tokens are refused.
 */
async function isServiceRole(token: string): Promise<boolean> {
  if (!token) return false;
  if (sameSecret(token, SUPABASE_SERVICE_ROLE_KEY)) return true;
  if (jwtRole(token) !== "service_role") return false;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY || token },
    });
    await r.body?.cancel();
    return r.ok;
  } catch {
    return false;
  }
}

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

// ──────────────────────────────────────────────────────────────── the e-mail

interface DigestItem {
  name: string;
  company: string;
  text: string;
}

interface DigestContent {
  firstName: string;
  messageCount: number;
  previews: DigestItem[];
  requestCount: number;
  requests: DigestItem[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The preview of a message that is a file without text (a photo or a PDF, messaging v2). */
const SENT_A_FILE = "Sent a file";

/** The first 140 characters (cut by the database), with an ellipsis when there was more. */
function excerpt(text: string): string {
  const t = (text || "").replace(/\s+/g, " ").trim();
  return t.length >= 140 ? `${t.slice(0, 139).trimEnd()}…` : t;
}

function digestSubject(c: DigestContent): string {
  if (c.messageCount > 0) return `This week you received ${plural(c.messageCount, "message", "messages")}`;
  return c.requestCount === 1 ? "This week, a company would like to connect with you" : `This week, ${c.requestCount} companies would like to connect with you`;
}

/** Subject, HTML and plain-text parts of one digest. Pure: no I/O. */
function renderDigest(c: DigestContent, unsubscribeUrl: string): { subject: string; html: string; text: string } {
  const subject = digestSubject(c);
  const inboxUrl = `${SITE_URL}/inbox`;
  const prefsUrl = `${SITE_URL}/account?tab=notifications`;
  const who = (it: DigestItem) => (it.company ? `${it.name}, ${it.company}` : it.name);

  // HTML (every database value escaped)
  const parts: string[] = [];
  const textParts: string[] = [];
  if (c.messageCount > 0) {
    parts.push(emP(c.messageCount === 1
      ? "A company you are connected with wrote to you on Smart Marina Connect:"
      : "Companies you are connected with wrote to you on Smart Marina Connect. The latest:", 14));
    textParts.push(c.messageCount === 1
      ? "A company you are connected with wrote to you on Smart Marina Connect:"
      : "Companies you are connected with wrote to you on Smart Marina Connect. The latest:");
    for (const it of c.previews.slice(0, 3)) {
      parts.push(emP(`<strong style="color:${EM.navy};">${emEsc(it.name)}</strong>${it.company ? ` &middot; ${emEsc(it.company)}` : ""}`, 6));
      // A photo or a PDF sent without text (messaging v2): its preview is empty.
      const said = excerpt(it.text);
      parts.push(emNote(said ? emEsc(said) : `<em>${SENT_A_FILE}</em>`));
      textParts.push(`${who(it)}:\n${said ? `"${said}"` : SENT_A_FILE}`);
    }
    const more = c.messageCount - Math.min(c.previews.length, 3);
    if (more > 0) {
      const line = `And ${plural(more, "more message", "more messages")} waiting for you.`;
      parts.push(emP(line));
      textParts.push(line);
    }
  }
  if (c.requestCount > 0) {
    const head = c.requestCount === 1
      ? "A company would like to connect with you. Accept to start the conversation, or decline:"
      : `${c.requestCount} companies would like to connect with you. Accept to start the conversation, or decline:`;
    parts.push(emP(`<strong style="color:${EM.navy};">Waiting for your answer</strong><br>${emEsc(head)}`, 10));
    textParts.push(`Waiting for your answer\n${head}`);
    const shown = c.requests.slice(0, 5);
    parts.push(emBullets(shown.map((it) =>
      `<strong style="color:${EM.navy};">${emEsc(it.name)}</strong>${it.company ? `, ${emEsc(it.company)}` : ""}${it.text ? `: &ldquo;${emEsc(excerpt(it.text))}&rdquo;` : ""}`)));
    textParts.push(shown.map((it) => `- ${who(it)}${it.text ? `: "${excerpt(it.text)}"` : ""}`).join("\n"));
    if (c.requestCount > shown.length) {
      const line = `And ${plural(c.requestCount - shown.length, "more request", "more requests")}.`;
      parts.push(emP(line));
      textParts.push(line);
    }
  }

  const greeting = c.firstName ? `Hello ${c.firstName},` : "Hello,";
  const footerNote = "We send this summary on Fridays, only when something is waiting for you. We never e-mail you for each message.";
  const reason = "You received this e-mail because you have an account on Smart Marina Connect.";
  const preheader = c.previews[0]
    ? excerpt(`${c.previews[0].name}: ${excerpt(c.previews[0].text) || SENT_A_FILE}`)
    : c.requests[0] ? excerpt(`${c.requests[0].name} would like to connect`) : subject;

  const html = emailLayout({
    pageTitle: emEsc(subject),
    preheader: emEsc(preheader),
    eyebrow: "Your week on Smart Marina Connect",
    title: emEsc(subject),
    greeting: emEsc(greeting),
    bodyHtml: parts.join("\n"),
    cta: { label: "Open my messages", url: emEsc(inboxUrl) },
    footerNote,
    reason,
    footerLinks: [
      { label: "Manage preferences", url: emEsc(prefsUrl) },
      { label: "Unsubscribe", url: emEsc(unsubscribeUrl) },
      { label: "Contact", url: emEsc(`${SITE_URL}/contact`) },
    ],
  });
  const text = emText({
    title: subject,
    greeting,
    body: textParts.join("\n\n"),
    cta: { label: "Open my messages", url: inboxUrl },
    footerNote,
    reason,
    links: [
      { label: "Manage preferences", url: prefsUrl },
      { label: "To unsubscribe from these e-mails", url: unsubscribeUrl },
    ],
  });
  return { subject, html, text };
}

// ──────────────────────────────────────────────────────────────── the run

interface BatchRow {
  user_id: string;
  email: string;
  first_name: string | null;
  week_start: string;
  as_of: string | null;
  message_count: number;
  previews: unknown;
  request_count: number;
  requests: unknown;
}

function items(raw: unknown): DigestItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x) => x && typeof x === "object")
    .map((x) => {
      const o = x as Record<string, unknown>;
      return {
        name: typeof o.name === "string" && o.name.trim() ? o.name.trim().slice(0, 120) : "A member",
        company: typeof o.company === "string" ? o.company.trim().slice(0, 120) : "",
        text: typeof o.text === "string" ? o.text : "",
      };
    });
}

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply(405, { ok: false, error: "method" });
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!(await isServiceRole(bearer))) return reply(401, { ok: false, error: "Unauthorized" });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return reply(500, { ok: false, error: "Missing env vars" });

  let dryRun = false;
  let limit = DEFAULT_LIMIT;
  try {
    const body = await req.json();
    if (body && typeof body === "object") {
      dryRun = (body as Record<string, unknown>).dry_run === true;
      const l = Number((body as Record<string, unknown>).limit);
      if (Number.isFinite(l) && l > 0) limit = Math.min(Math.floor(l), 1000);
    }
  } catch {
    /* no body: defaults */
  }
  if (!dryRun && !RESEND_API_KEY) return reply(500, { ok: false, error: "Missing RESEND_API_KEY" });

  const started = Date.now();
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await db.rpc("msg_digest_batch", { p_week_start: null, p_limit: limit });
  if (error) {
    console.error("messages-digest: batch failed:", error.code || "", error.message || "");
    return reply(500, { ok: false, error: "batch" });
  }
  const rows = (Array.isArray(data) ? data : []) as BatchRow[];
  const result = { ok: true, dry_run: dryRun, candidates: rows.length, sent: 0, skipped: 0, failed: 0, left_for_next_run: 0 };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (Date.now() - started > TIME_BUDGET_MS) {
      result.left_for_next_run = rows.length - i;
      break;
    }
    const email = (row.email || "").trim();
    if (!isEmail(email)) {
      result.skipped++;
      continue;
    }
    const content: DigestContent = {
      firstName: (row.first_name || "").trim().slice(0, 80),
      messageCount: Number(row.message_count) || 0,
      previews: items(row.previews),
      requestCount: Number(row.request_count) || 0,
      requests: items(row.requests),
    };
    if (dryRun) {
      renderDigest(content, `${SITE_URL}/unsubscribe`);
      result.sent++;
      continue;
    }

    // A claim left by a run that died (the batch already let this person through): replaced.
    await db.from("digest_log").delete()
      .eq("user_id", row.user_id).eq("kind", "messages").eq("week_start", row.week_start)
      .eq("status", "sending").lt("created_at", new Date(Date.now() - STALE_CLAIM_MS).toISOString());
    // Claim this person for this week: a second run (or a parallel one) skips them.
    const { error: claimErr } = await db.from("digest_log").insert({
      user_id: row.user_id,
      kind: "messages",
      week_start: row.week_start,
      status: "sending",
      message_count: content.messageCount,
      request_count: content.requestCount,
      covered_until: row.as_of || new Date(started).toISOString(),
    });
    if (claimErr) {
      if (claimErr.code !== "23505") console.error("messages-digest: claim failed:", claimErr.code || "", claimErr.message || "");
      result.skipped++;
      continue;
    }

    let unsubscribeUrl = `${SITE_URL}/unsubscribe`;
    let unsubscribeHeaders: Record<string, string> = {
      "List-Unsubscribe": `<${unsubscribeUrl}>, <mailto:unsubscribe@smartmarinaconnect.com>`,
    };
    try {
      const token = await signUnsubToken(SUPABASE_SERVICE_ROLE_KEY, row.user_id, "b2b");
      unsubscribeUrl = `${SITE_URL}/unsubscribe?t=${token}`;
      unsubscribeHeaders = {
        "List-Unsubscribe": `<${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/unsubscribe?t=${token}>, <mailto:unsubscribe@smartmarinaconnect.com>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      };
    } catch (e) {
      console.error("messages-digest: unsubscribe token failed:", (e as { message?: string })?.message || String(e));
    }

    const { subject, html, text } = renderDigest(content, unsubscribeUrl);
    let ok = false;
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `messages-digest-${row.week_start}-${row.user_id}`,
        },
        body: JSON.stringify({
          from: SENDER_EMAIL,
          to: [email],
          reply_to: EM.contact,
          subject,
          html,
          text,
          headers: { ...unsubscribeHeaders, "X-Entity-Ref-ID": `messages-digest-${row.week_start}-${row.user_id}` },
        }),
      });
      const body = await res.text();
      ok = res.ok;
      if (!ok) console.error("messages-digest: Resend error", res.status, body.slice(0, 300));
    } catch (e) {
      console.error("messages-digest: Resend unreachable or too slow:", (e as { message?: string })?.message || String(e));
    }

    if (ok) {
      await db.from("digest_log")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("user_id", row.user_id).eq("kind", "messages").eq("week_start", row.week_start);
      result.sent++;
    } else {
      // Not sent: release the claim so the 10:30 run (or a run by hand) retries.
      await db.from("digest_log").delete()
        .eq("user_id", row.user_id).eq("kind", "messages").eq("week_start", row.week_start).eq("status", "sending");
      result.failed++;
    }
    if (i < rows.length - 1) await sleep(SEND_GAP_MS);
  }

  console.log(`messages-digest: ${result.sent} ${dryRun ? "rendered (dry run)" : "sent"}, ${result.skipped} skipped, ${result.failed} failed, ${result.left_for_next_run} left`);
  return reply(200, result);
});
