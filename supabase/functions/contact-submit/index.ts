// contact-submit -- the public contact form of smartmarinaconnect.com (/contact).
//
// Why (hotfix, 7 Oct 2026): the page inserted into public.contact_submissions, a
// table that did not exist, then opened the visitor's mail client and said
// "thank you" anyway, so messages were lost. Now every message is stored
// (migration 20261007211549_contact_submissions, service role only) and e-mailed
// to events@m3monaco.com, and the page shows its thank-you only on { ok: true },
// which is returned only once Resend has accepted the e-mail to the inbox.
//
// CONTRACT (other pages are built against it: keep it exactly)
//   POST JSON (Content-Type: application/json, as supabase-js invoke and any JSON
//   fetch send it; anything else -> 400, so a third-party page cannot post here
//   without a CORS preflight, which the origin allowlist refuses) {
//     name:     string, 1-120 characters
//     email:    string, a valid address, at most 254 characters
//     company?: string, at most 160
//     subject:  "general" | "partnership" | "support" | "media" | "other"
//     message:  string, 10-5000 characters
//     source?:  string, the page path, at most 200
//     website?: string, honeypot: must be empty
//     captcha?: string, the Cloudflare Turnstile token of the form (single-use,
//               at most 2048 characters). Checked when present; required only
//               once TURNSTILE_ENFORCE is "true" (see "Anti-spam" below)
//   }
//   -> 200 { ok: true } | 400 { error: "invalid" } | 400 { error: "captcha" }
//      | 429 { error: "rate_limited" } | 500 { error: "server" }
//   Lengths are characters (code points) after trimming. Unknown keys are ignored.
//   A token that is present but not accepted by Cloudflare, or a missing token
//   while TURNSTILE_ENFORCE is "true", is a 400 { error: "captcha" } (nothing
//   stored, nothing sent, no detail given). The page already on the live site
//   treats any 400 as "invalid", so it is not affected by the new code.
//   A string holding a lone UTF-16 surrogate is invalid (400): Postgres would
//   refuse it at insert time.
//   Honeypot filled -> 200 { ok: true }, nothing stored or sent.
//   Rate limits (rolling hour, counted on the stored rows): 5 per network (hashed
//   IP), 3 per e-mail address.
//   The row is stored first. If the insert fails -> 500. If the e-mail to the inbox
//   fails, the row is kept (emailed_at stays null, the error is logged) and the
//   answer is 500 as well: nobody reads the table day to day, so the visitor must
//   not be told the message went out. The page then shows its error box with
//   events@m3monaco.com. A retry stores a second row and counts toward the
//   3-per-address limit (accepted).
//   Errors never echo what the caller sent.
//
// Anti-spam: Cloudflare Turnstile, SOFT until TURNSTILE_ENFORCE is "true" (the
// pages that are live may not send a token yet). Secrets (Supabase > Edge
// Functions > Secrets): TURNSTILE_SECRET_KEY (unset: no check, logged once) and
// TURNSTILE_ENFORCE ("true": a request with no token is refused).
//
// verify_jwt must be FALSE (anonymous visitors). This file must not contain a
// literal backslash-u escape (the MCP deploy tool mangles them): control
// characters are matched with Unicode property classes and the u flag.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const SENDER_EMAIL = Deno.env.get("SENDER_EMAIL") || "Smart Marina Connect <noreply@smartmarinaconnect.com>";

const INBOX = "events@m3monaco.com";
const TABLE = "contact_submissions";

const MAX_BODY_BYTES = 16 * 1024;
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_IP_PER_HOUR = 5;
const MAX_PER_EMAIL_PER_HOUR = 3;
const RESEND_TIMEOUT_MS = 10_000;

// The values of SUBJECT_OPTIONS in src/pages/ContactPage.tsx -> label in the e-mail.
const SUBJECT_LABELS = new Map<string, string>([
  ["general", "General Inquiry"],
  ["partnership", "Partnership"],
  ["support", "Support"],
  ["media", "Media"],
  ["other", "Other"],
]);

const ALLOWED_ORIGINS = [
  "https://smartmarinaconnect.com",
  "https://www.smartmarinaconnect.com",
  "https://m3connect.netlify.app",
  "https://refonte--m3connectv2.netlify.app",
  "http://localhost:5173",
  "http://localhost:3000",
];

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

// ─── Input ────────────────────────────────────────────────────────────────────

/** The request body as text, or null when it is larger than `max` bytes or not UTF-8. */
async function readBody(req: Request, max: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") || "0");
  if (!Number.isFinite(declared) || declared > max) return null;
  if (!req.body) return null;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return null;
  }
}

/** Length in characters (code points), as Postgres char_length counts them. */
const len = (s: string) => Array.from(s).length;

/** One line: invisible format characters removed, control and separator characters
 *  become spaces, runs of white space collapse. */
function oneLine(s: string): string {
  return s
    .replace(/\p{Cf}+/gu, "")
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Free text: line breaks and tabs kept (CRLF -> LF), other control characters and
 *  invisible format characters (bidi overrides...) removed, except the joiners
 *  emoji sequences use. */
function multiLine(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[\p{Zl}\p{Zp}]/gu, "\n")
    .replace(/(?![\n\t])\p{Cc}/gu, "")
    .replace(/(?!\p{Join_Control})\p{Cf}/gu, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

// The local part leaves out ? & = % (legal in RFC 5322, never typed by real
// visitors): in a mailto: URL they add headers, so "a?bcc=x%40evil.com&y=@ex.com"
// would BCC a stranger if a mail client turned the address into a link.
const EMAIL_RE =
  /^[A-Za-z0-9.!#$'*+\/^_`{|}~-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+(?:[A-Za-z]{2,63}|xn--[A-Za-z0-9-]{1,59})$/;

function isEmail(s: string): boolean {
  if (s.length > 254 || !EMAIL_RE.test(s)) return false;
  const local = s.slice(0, s.indexOf("@"));
  return !local.startsWith(".") && !local.endsWith(".") && !local.includes("..");
}

type Submission = {
  name: string;
  email: string;
  company: string | null;
  subject: string;
  message: string;
  source: string | null;
};

const isOptionalString = (v: unknown) => v === undefined || v === null || typeof v === "string";

/** A lone UTF-16 surrogate (JSON.parse makes one from an unpaired escape). With the
 *  u flag a well-formed pair is one code point, so only lone halves match Cs.
 *  Postgres refuses them (22P02), so they must be a 400 here, not a failed insert. */
const hasLoneSurrogate = (v: unknown) => typeof v === "string" && /\p{Cs}/u.test(v);

/** The cleaned submission, or null when anything breaks the contract. */
function validate(body: Record<string, unknown>): Submission | null {
  const { name, email, company, subject, message, source } = body;
  if (typeof name !== "string" || typeof email !== "string") return null;
  if (typeof subject !== "string" || typeof message !== "string") return null;
  if (!isOptionalString(company) || !isOptionalString(source)) return null;
  if ([name, email, company, subject, message, source].some(hasLoneSurrogate)) return null;

  const cleanName = oneLine(name);
  if (len(cleanName) < 1 || len(cleanName) > 120) return null;

  const cleanEmail = email.trim().toLowerCase();
  if (!isEmail(cleanEmail)) return null;

  const cleanSubject = subject.trim();
  if (!SUBJECT_LABELS.has(cleanSubject)) return null;

  const cleanCompany = typeof company === "string" ? oneLine(company) : "";
  if (len(cleanCompany) > 160) return null;

  const cleanMessage = multiLine(message);
  if (len(cleanMessage) < 10 || len(cleanMessage) > 5000) return null;

  const cleanSource = typeof source === "string" ? oneLine(source) : "";
  if (len(cleanSource) > 200) return null;

  return {
    name: cleanName,
    email: cleanEmail,
    company: cleanCompany || null,
    subject: cleanSubject,
    message: cleanMessage,
    source: cleanSource || null,
  };
}

/** Honeypot: people never see the field, so any value means a bot. */
function honeypotFilled(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v !== "string") return true;
  return v.trim() !== "";
}

// ─── Anti-spam: Cloudflare Turnstile ──────────────────────────────────────────
// SOFT until TURNSTILE_ENFORCE is "true": a token that is present is always
// checked (present and invalid => refused), but a request with no token still
// goes through, because the pages that are live may not send one yet.
// TURNSTILE_SECRET_KEY unset => the check is skipped (logged once). Cloudflare
// unreachable, or a secret it does not accept => the request goes through
// (logged): our setup is at fault, not the visitor.
// The same helper is inlined in newsletter-subscribe and guest-list.
const TURNSTILE_SECRET = Deno.env.get("TURNSTILE_SECRET_KEY") || "";
const TURNSTILE_ENFORCE = (Deno.env.get("TURNSTILE_ENFORCE") || "").trim().toLowerCase() === "true";
const TURNSTILE_SETUP_ERRORS = new Set(["missing-input-secret", "invalid-input-secret", "bad-request", "internal-error"]);
let turnstileSkipLogged = false;

/** true: the request may go on. false: answer with the "invalid" error and say nothing more. Never throws. */
async function turnstileAllows(token: unknown, ip: string | null): Promise<boolean> {
  if (!TURNSTILE_SECRET) {
    if (!turnstileSkipLogged) {
      turnstileSkipLogged = true;
      console.warn("contact-submit: TURNSTILE_SECRET_KEY is not set, the Turnstile check is skipped");
    }
    return true;
  }
  const response = typeof token === "string" ? token.trim() : "";
  if (!response) return !TURNSTILE_ENFORCE;
  if (response.length > 2048) return false;
  try {
    const form = new URLSearchParams({ secret: TURNSTILE_SECRET, response });
    if (ip) form.set("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(5000),
    });
    const out = (await res.json().catch(() => null)) as { success?: boolean; "error-codes"?: string[] } | null;
    if (out?.success === true) return true;
    const codes = out?.["error-codes"] ?? [];
    if (!out || codes.some((c) => TURNSTILE_SETUP_ERRORS.has(c))) {
      console.error("contact-submit: Turnstile siteverify could not judge the token", res.status, codes.join(","));
      return true;
    }
    return false;
  } catch (err) {
    console.error("contact-submit: Turnstile siteverify unreachable", err instanceof Error ? err.name : "error");
    return true;
  }
}

// ─── Rate limit ───────────────────────────────────────────────────────────────

// The caller's IP as the platform reports it (same headers as claim-code-signup
// and guest-webinar-register), or null.
function clientIp(req: Request): string | null {
  const ip = req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "";
  return ip || null;
}

// HMAC-SHA-256 of the IP under a server secret, with this function's own prefix:
// never the IP itself, and it cannot be matched against other functions' keys.
async function ipHash(ip: string | null): Promise<string | null> {
  if (!ip) return null;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(SERVICE_ROLE_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`contact-submit:ip:${ip}`));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Rows with this value in the rolling window, or null if the count failed (fail open). */
async function countRecent(db: SupabaseClient, column: "ip_hash" | "email", value: string): Promise<number | null> {
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const { count, error } = await db
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq(column, value)
    .gte("created_at", since);
  if (error) {
    console.error(`contact-submit: rate count (${column}) failed:`, error.code, error.message);
    return null;
  }
  return count ?? 0;
}

// ─── E-mail to the inbox ──────────────────────────────────────────────────────

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

function utcStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** Subject, HTML and plain-text parts of the e-mail to the inbox, and the address a reply
 *  should go to. Pure: no I/O. Everything the visitor typed is escaped before it reaches
 *  the HTML; the address is plain escaped text, never a mailto: link (a crafted local
 *  part could add headers such as bcc to the link), reply_to handles answering. */
function renderInboxEmail(
  s: Submission,
  id: string,
  createdAt: string,
): { subject: string; html: string; text: string; replyTo: string | null } {
  const label = SUBJECT_LABELS.get(s.subject) || s.subject;
  const replyTo = isEmail(s.email) ? s.email : null;
  const subject = `[Smart Marina Connect] ${label} — ${s.name}`;
  const received = utcStamp(createdAt);
  const title = "New message from the Smart Marina Connect contact form";
  const footerNote = `${replyTo ? "Reply to this e-mail to answer the sender directly. " : ""}Stored in the platform as contact_submissions ${id}.`;

  const notGiven = `<span style="color:${EM.muted};">not given</span>`;
  const rows: Array<[string, string]> = [
    ["Name", emEsc(s.name)],
    ["E-mail", emEsc(s.email)],
    ["Company", s.company ? emEsc(s.company) : notGiven],
    ["Subject", emEsc(label)],
    ["Page", s.source ? emEsc(s.source) : notGiven],
    ["Received", emEsc(received)],
    ["Submission ID", `<span style="font-family:${EM.mono};font-size:13px;">${emEsc(id)}</span>`],
  ];
  const html = emailLayout({
    pageTitle: emEsc(title),
    preheader: emEsc(`${label} from ${s.name}`),
    eyebrow: "Contact form",
    title: emEsc(title),
    bodyHtml: emInfoTable(rows) + emNote(emEsc(s.message).replace(/\n/g, "<br>"), "Message"),
    footerNote: emEsc(footerNote),
  });

  const text = emText({
    title,
    body: [
      [
        `Name: ${s.name}`,
        `E-mail: ${s.email}`,
        `Company: ${s.company || "not given"}`,
        `Subject: ${label}`,
        `Page: ${s.source || "not given"}`,
        `Received: ${received}`,
        `Submission ID: ${id}`,
      ].join("\n"),
      s.message,
    ].join("\n\n"),
    footerNote,
  });
  return { subject, html, text, replyTo };
}

/** Sends the one e-mail to the inbox. true when Resend accepted it. Never throws. */
async function sendToInbox(s: Submission, id: string, createdAt: string): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.error("contact-submit: RESEND_API_KEY is not set; submission", id, "stored, not e-mailed");
    return false;
  }
  const mail = renderInboxEmail(s, id, createdAt);

  const payload: Record<string, unknown> = {
    from: SENDER_EMAIL,
    to: [INBOX],
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  };
  // Replies go to the visitor, not to the inbox: no events@ override here.
  if (mail.replyTo) payload.reply_to = mail.replyTo;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("contact-submit: Resend error for submission", id, res.status, detail.slice(0, 300));
      return false;
    }
    await res.body?.cancel().catch(() => {});
    return true;
  } catch (e) {
    console.error("contact-submit: Resend request failed for submission", id, e instanceof Error ? e.name : "error");
    return false;
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const headers = { ...corsHeaders(req), "Content-Type": "application/json", "Cache-Control": "no-store" };
  const reply = (body: Record<string, unknown>, status: number) =>
    new Response(JSON.stringify(body), { status, headers });

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return reply({ error: "invalid" }, 405);

  // JSON only. A text/plain (or form) POST is a CORS "simple request": a browser
  // sends it from any site with no preflight, so the origin allowlist would never
  // apply. Requiring application/json forces the preflight.
  const contentType = (req.headers.get("content-type") || "").trim().toLowerCase();
  if (!contentType.startsWith("application/json")) return reply({ error: "invalid" }, 400);

  // Set once Resend has accepted the e-mail: the only point after which the
  // visitor may be told the message went out.
  let emailed = false;
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      console.error("contact-submit: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
      return reply({ error: "server" }, 500);
    }

    const raw = await readBody(req, MAX_BODY_BYTES);
    if (raw === null) return reply({ error: "invalid" }, 400);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return reply({ error: "invalid" }, 400);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return reply({ error: "invalid" }, 400);
    const body = parsed as Record<string, unknown>;

    // A bot filled the hidden field: same answer as a success, nothing kept or sent.
    if (honeypotFilled(body.website)) return reply({ ok: true }, 200);

    const submission = validate(body);
    if (!submission) return reply({ error: "invalid" }, 400);

    // Anti-spam (Turnstile), after the cheap checks so a form refused for another
    // reason does not use up the visitor's single-use token. Soft until
    // TURNSTILE_ENFORCE is "true". The answer is the distinct code "captcha" (the
    // form then says the security check did not go through, not that a field was
    // wrong); nothing more about the reason is sent back.
    if (!(await turnstileAllows(body.captcha, clientIp(req)))) return reply({ error: "captcha" }, 400);

    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const ipKey = await ipHash(clientIp(req));
    const userAgent = Array.from(oneLine(req.headers.get("user-agent") || "")).slice(0, 500).join("") || null;

    // 1. Store. Written before the rate-limit count, so concurrent calls see each
    //    other's rows and a burst cannot slip in between a count and an insert.
    const { data: row, error: insertError } = await db
      .from(TABLE)
      .insert({
        name: submission.name,
        email: submission.email,
        company: submission.company,
        subject: submission.subject,
        message: submission.message,
        source: submission.source,
        ip_hash: ipKey,
        user_agent: userAgent,
      })
      .select("id, created_at")
      .single();
    if (insertError || !row) {
      console.error("contact-submit: insert failed:", insertError?.code, insertError?.message);
      return reply({ error: "server" }, 500);
    }
    const { id, created_at: createdAt } = row as { id: string; created_at: string };

    // 2. Rate limit (this row included). Over the limit: the row is withdrawn and
    //    nothing is sent. A failed count lets the message through (fails open).
    const [ipCount, emailCount] = await Promise.all([
      ipKey ? countRecent(db, "ip_hash", ipKey) : Promise.resolve(null),
      countRecent(db, "email", submission.email),
    ]);
    if ((ipCount ?? 0) > MAX_PER_IP_PER_HOUR || (emailCount ?? 0) > MAX_PER_EMAIL_PER_HOUR) {
      const { error: deleteError } = await db.from(TABLE).delete().eq("id", id);
      if (deleteError) {
        console.error("contact-submit: could not withdraw over-limit submission", id, deleteError.code, deleteError.message);
        await db.from(TABLE).update({ status: "spam" }).eq("id", id);
      }
      console.warn("contact-submit: rate limited", (ipCount ?? 0) > MAX_PER_IP_PER_HOUR ? "(network)" : "(address)");
      return reply({ error: "rate_limited" }, 429);
    }

    // 3. E-mail the inbox. On failure the row is kept (emailed_at null) but the
    //    visitor gets 500 and the page's error box: the table alone is not read.
    emailed = await sendToInbox(submission, id, createdAt);
    if (!emailed) {
      console.error("contact-submit: stored", id, "-- e-mail FAILED, visitor told it was not sent (row kept in contact_submissions)");
      return reply({ error: "server" }, 500);
    }
    const { error: markError } = await db.from(TABLE).update({ emailed_at: new Date().toISOString() }).eq("id", id);
    if (markError) console.error("contact-submit: could not set emailed_at on", id, markError.code, markError.message);
    console.log("contact-submit: stored", id, "and e-mailed");
    return reply({ ok: true }, 200);
  } catch (err) {
    console.error("contact-submit: unexpected error:", err instanceof Error ? err.message : String(err));
    // Only once the inbox has the e-mail may the visitor be told it went out.
    return emailed ? reply({ ok: true }, 200) : reply({ error: "server" }, 500);
  }
});
