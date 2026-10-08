// Signup via a valid organization claim code.
//
// SECURITY HISTORY -- read before changing how the account is created below.
// This function used to pass email_confirm:true, on the stated assumption that
// "the user already proved ownership of the email by clicking the invitation
// link sent to that address". No token was ever passed or checked, and the
// endpoint is public (verify_jwt=false), so anyone holding a claim code could
// create a PRE-CONFIRMED account under someone else's address with a password of
// their choosing. Claim codes were readable by anonymous visitors at the time,
// so the code was not a secret either.
//
// v9 then created the account with createUser({ email_confirm:false }) on the
// belief that "GoTrue sends its own confirmation mail". It does not: the admin
// API never sends mail, so those accounts could never be confirmed and the
// client's sign-in failed with "Email not confirmed".
//
// Now generateLink({ type:'signup' }) creates the unconfirmed account and hands
// back its confirmation token in one call, and this function e-mails the link
// itself (Resend, the same way sm26-attendee-invite / sponsor-invite do). The
// account is inert until the real mailbox owner clicks it. None of this depends
// on the dashboard's "Confirm email" setting: an account created through the
// admin API is never auto-confirmed, so the behaviour is the same before and
// after that setting is switched on.
//
// The password is never the caller's. Whoever fills in the form is not proven to
// own the address, and a password they chose would keep working after the real
// owner clicks the link -- a pre-account takeover. The account is created with a
// random password nobody knows (any `password` in the request is ignored; older
// clients still send one), and the mailbox owner chooses theirs on /welcome,
// which makes that step mandatory for every type=signup link.
//
// The organisation waits for the mailbox owner too. This function used to run
// claim_organization_for_user as soon as the account existed: anyone holding a
// code could make any address -- one nobody reads -- the OWNER of an
// organisation that had none, with a verified profile, and the real manager
// could then only join as a collaborator. Nothing is claimed here any more. The
// confirmation link ends on /onboarding?code=<code>, where OnboardingPage claims
// the organisation with claim_organization as the confirmed, signed-in person
// (and under that RPC's attempt limit).
//
// Codes are short and human-readable (GROUP-CITY style), and this public endpoint says
// whether one is valid. Failed codes are therefore limited per network, as are
// new accounts (each one is an e-mail from our domain to an address the caller
// picks); see RATE_TABLE.
//
// A second submit for the same address only re-sends the link, and only for an
// unconfirmed account this function made for this same organisation. Any other
// existing account -- confirmed, or someone's own pending sign-up -- is refused
// with "already exists" and left untouched: no metadata rewrite, no new token
// (which would kill the link GoTrue already mailed them).

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://smartmarinaconnect.com",
  "https://m3connect.netlify.app",
  "http://localhost:5173",
  "http://localhost:3000",
];

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SITE_URL = Deno.env.get("SITE_URL") || "https://smartmarinaconnect.com";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const SENDER_EMAIL = Deno.env.get("SENDER_EMAIL") || "Smart Marina Connect <noreply@smartmarinaconnect.com>";

// Personas a visitor may pick on the signup form. The metadata becomes the
// profile row (handle_new_user casts it to persona_enum), so a crafted request
// must not be able to plant 'admin' or 'moderator' there -- anything else falls
// back to the organisation's type.
const SELF_SERVE_PERSONAS = new Set(["marina", "partner", "media_partner", "developer", "investor"]);

// Minimum gap between two confirmation e-mails to the same unconfirmed address
// (GoTrue's own resend window is 60 s too). Stops the retry path from being used
// to flood a mailbox.
const RESEND_COOLDOWN_MS = 60_000;

// Per network (IP), per rolling hour. Without the first limit this endpoint is
// an oracle that walks around claim_organization's own attempt limit (10 failed
// codes per account per hour). The second caps how many addresses one network
// can make us e-mail. Once a network has 10 failed codes, every call from it is
// refused until the oldest is an hour old, a valid code included, as in
// claim_organization.
// Rows go to guest_signup_rate_limits (ip_hash, created_at; RLS denies anon and
// authenticated), shared with guest-webinar-register. This function's keys are
// HMACs with their own prefix (rateKey), so they never match that function's
// rows and cannot be turned back into an address.
const RATE_TABLE = "guest_signup_rate_limits";
const MAX_FAILED_CODES_PER_HOUR = 10;
const MAX_NEW_ACCOUNTS_PER_HOUR = 10;

// The account's password until the mailbox owner sets theirs on /welcome: 40
// characters from a 64-symbol alphabet (240 random bits; 256 is a multiple of 64,
// so `& 63` is unbiased). The fixed "aA1!" tail only satisfies whatever
// character-class policy the project enforces; the secret is the random part.
// 44 ASCII bytes stays under bcrypt's 72-byte limit.
const PASSWORD_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function unguessablePassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(40));
  let out = "";
  for (const b of bytes) out += PASSWORD_ALPHABET[b & 63];
  return `${out}aA1!`;
}

const ALREADY_EXISTS = "An account with this email already exists. Please log in instead.";
const SEND_FAILED = "We could not send the confirmation e-mail. Please try again in a minute, or contact us.";
const TOO_SOON =
  "A confirmation e-mail was requested for this address less than a minute ago. Check your inbox (and spam folder), or try again in a minute.";
const RATE_LIMITED = "Too many attempts from this network. Please try again later.";

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

// Copied from send-email (keep the two in step). The names are whatever the
// caller typed, and this endpoint is public: they go out from our domain to an
// address the caller picks, and to the admins. So a name is kept to what a name
// looks like -- one line, at most 60 characters, letters and the punctuation
// names use. Anything else (a URL, an address, digits, markup) drops it, and
// the plain greeting is used.
function displayName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const oneLine = raw
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const name = Array.from(oneLine).slice(0, 60).join("").trim();
  if (!name) return "";
  if (!/^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u.test(name)) return "";
  if (/\p{L}\.\p{L}{2,}/u.test(name)) return ""; // reads like a domain name
  return name;
}

// The caller's IP as the platform reports it (the same headers as
// guest-webinar-register and sm_vote_ip_hash), or null.
function clientIp(req: Request): string | null {
  const ip = req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "";
  return ip || null;
}

// HMAC-SHA-256 of the IP (or, for resend_addr, the e-mail address) under a
// server secret: never the value itself.
async function rateKey(
  kind: "failed_code" | "new_account" | "resend" | "resend_addr",
  subject: string | null,
): Promise<string | null> {
  if (!subject) return null;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(SERVICE_ROLE_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`claim-code-signup:${kind}:${subject}`));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Re-sends e-mail an address that already has a pending claim account. They are
// capped too, or one valid code would let anyone mail that address every minute
// from our domain: per network per hour, and per address per day.
const MAX_RESENDS_PER_HOUR = 10;
const MAX_RESENDS_PER_ADDRESS_PER_DAY = 3;

type AdminClient = SupabaseClient;

// Takes one of this key's slots for the rolling hour. The row is written first
// and counted after, so concurrent calls see each other's rows and a burst
// cannot slip in between a count and an insert. Returns:
//  - the row id: the slot is taken (releaseSlot gives it back);
//  - "full": `max` slots were already taken; nothing is kept;
//  - null: no IP, or the table failed. Fails open: a broken limiter must not
//    lock invited managers out.
async function takeSlot(
  admin: AdminClient,
  key: string | null,
  max: number,
  windowMs = 3_600_000,
): Promise<number | "full" | null> {
  if (!key) return null;
  const { data, error } = await admin.from(RATE_TABLE).insert({ ip_hash: key }).select("id").single();
  if (error || !data) { console.error("rate limit insert failed", error); return null; }
  const id = (data as { id: number }).id;
  const { count, error: countError } = await admin
    .from(RATE_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", key)
    .gte("created_at", new Date(Date.now() - windowMs).toISOString());
  if (countError) { console.error("rate limit count failed", countError); return id; }
  if ((count ?? 0) > max) {
    await releaseSlot(admin, id);
    return "full";
  }
  // This key's rows older than a day are no longer used.
  await admin
    .from(RATE_TABLE)
    .delete()
    .eq("ip_hash", key)
    .lt("created_at", new Date(Date.now() - 86_400_000).toISOString());
  return id;
}

async function releaseSlot(admin: AdminClient, id: number | null) {
  if (id === null) return;
  const { error } = await admin.from(RATE_TABLE).delete().eq("id", id);
  if (error) console.error("rate limit release failed", error);
}

type Lang = "en" | "fr";

// Each value that reaches these templates is already HTML-escaped.
const COPY: Record<Lang, {
  subject: string;
  hello: (name: string) => string;
  eyebrow: string;
  title: string;
  body: (org: string) => string;
  button: string;
  fallback: string;
  ignore: string;
}> = {
  en: {
    subject: "Confirm your Smart Marina Connect account",
    hello: (name) => (name ? `Hello ${name},` : "Hello,"),
    eyebrow: "Your account",
    title: "Confirm your e-mail address",
    body: (org) =>
      `A Smart Marina Connect account was requested with this e-mail address to join <strong>${org}</strong>. Confirm your address to activate it &mdash; you will then choose your password.`,
    button: "Confirm my e-mail address",
    fallback: "If the button does not work, copy this link into your browser:",
    ignore: "If you did not request this account, you can safely ignore this e-mail: the account stays inactive until this link is used.",
  },
  fr: {
    subject: "Confirmez votre compte Smart Marina Connect",
    hello: (name) => (name ? `Bonjour ${name},` : "Bonjour,"),
    eyebrow: "Votre compte",
    title: "Confirmez votre adresse e-mail",
    body: (org) =>
      `Un compte Smart Marina Connect a &eacute;t&eacute; demand&eacute; avec cette adresse e-mail pour rejoindre <strong>${org}</strong>. Confirmez votre adresse pour l&rsquo;activer &mdash; vous choisirez ensuite votre mot de passe.`,
    button: "Confirmer mon adresse e-mail",
    fallback: "Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur&nbsp;:",
    ignore: "Si vous n&rsquo;&ecirc;tes pas &agrave; l&rsquo;origine de cette demande, ignorez simplement cet e-mail&nbsp;: le compte reste inactif tant que ce lien n&rsquo;est pas utilis&eacute;.",
  },
};

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

// The COPY strings are HTML (entities, <strong>); the plain-text part needs them as text.
const COPY_ENTITIES: Record<string, string> = {
  "&mdash;": "—", "&eacute;": "é", "&rsquo;": "’", "&ecirc;": "ê", "&agrave;": "à", "&nbsp;": " ",
};
const plainFromHtml = (s: string) => emStripTags(s).replace(/&[a-z]+;/g, (m) => COPY_ENTITIES[m] ?? m);

// Subject, HTML and plain-text parts of the confirmation e-mail. Pure: no I/O. The name is
// whatever the caller typed, and goes to whatever address they typed: only something that
// looks like a name (displayName), escaped on top of that. The link is escaped as well.
function buildConfirmationEmail(
  lang: Lang,
  firstName: string,
  orgName: string,
  link: string,
): { subject: string; html: string; text: string } {
  const c = COPY[lang];
  const name = displayName(firstName);
  const href = esc(link);
  const ORG = "@@ORG@@";
  const bodyText = plainFromHtml(c.body(ORG)).replace(ORG, () => orgName);
  const html = emailLayout({
    lang,
    pageTitle: c.title,
    preheader: esc(bodyText),
    eyebrow: c.eyebrow,
    title: c.title,
    greeting: c.hello(esc(name)),
    bodyHtml: emP(c.body(esc(orgName))),
    cta: { label: c.button, url: href },
    footerNote: `${c.fallback}<br><a href="${href}" target="_blank" style="color:${EM.navy};text-decoration:underline;word-break:break-all;">${href}</a><br><br>${c.ignore}`,
  });
  const text = emText({
    title: plainFromHtml(c.title),
    greeting: plainFromHtml(c.hello(name)),
    body: bodyText,
    cta: { label: plainFromHtml(c.button), url: link },
    footerNote: `${plainFromHtml(c.fallback)}\n${link}\n\n${plainFromHtml(c.ignore)}`,
  });
  return { subject: c.subject, html, text };
}

async function sendConfirmationEmail(email: string, lang: Lang, firstName: string, orgName: string, link: string): Promise<boolean> {
  if (!RESEND_API_KEY) { console.error("RESEND_API_KEY not set"); return false; }
  const { subject, html, text } = buildConfirmationEmail(lang, firstName, orgName, link);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: SENDER_EMAIL, to: [email], reply_to: EM.contact, subject, html, text }),
    });
    if (!res.ok) { console.error("Resend error", res.status, await res.text()); return false; }
    return true;
  } catch (e) {
    console.error("confirmation email failed", e);
    return false;
  }
}

// Fire-and-forget admin notification (fans out to every admin via notify-admins)
// send-notification puts submitter and details into the HTML unescaped, and the
// names and the address come from an anonymous caller: names pass displayName,
// the rest is escaped here.
async function notifyAdminsOfSignup(data: { email: string; first_name?: string; last_name?: string; org_name?: string; claim_code?: string; resend?: boolean; emailed?: boolean }) {
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return;
    const email = esc(data.email);
    const fullName = [displayName(data.first_name), displayName(data.last_name)].filter(Boolean).join(" ") || email;
    const details = [
      `Email: ${email}`,
      `Signup method: Claim code (${esc(data.claim_code || "unknown")})${data.resend ? " -- confirmation e-mail re-requested" : ""}`,
      data.org_name ? `Organization: ${esc(data.org_name)} (they join it only once they have confirmed their address)` : "",
      data.emailed
        ? "Confirmation e-mail: sent (the account is inactive until they click it)"
        : "Confirmation e-mail: FAILED -- they cannot log in until their address is confirmed",
    ].filter(Boolean).join("\n");
    await fetch(`${SUPABASE_URL}/functions/v1/notify-admins`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "apikey": SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({
        submission_type: "new user signup",
        submitter: fullName,
        details,
        include_contact_inbox: true,
      }),
    });
  } catch {
    // Swallow any errors -- notifications must never block signup
  }
}

Deno.serve(async (req: Request) => {
  const startedAt = Date.now();
  const headers = { "Content-Type": "application/json", ...corsHeaders(req) };
  const reply = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers });

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }

  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return reply({ error: "Server not configured" }, 500);
    }

    // `password` is deliberately not read (see the note at the top): older
    // clients still send one, and it must not reach the account.
    const body = await req.json();
    const { persona, claim_code } = body;
    const firstName = typeof body.first_name === "string" ? body.first_name.trim() : "";
    const lastName = typeof body.last_name === "string" ? body.last_name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    // Every platform e-mail is in English (Victor, 6 Oct 2026). The FR copy stays
    // for a later change of mind; body.lang is accepted but not used.
    const lang: Lang = "en";

    if (!email || !claim_code) {
      return reply({ error: "Email and claim_code are required" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const ip = clientIp(req);
    const failedCodeKey = await rateKey("failed_code", ip);

    // 0. Every lookup takes a failed-code slot, given back below if the code is
    //    valid. Once the hour's slots are used, refuse before the lookup, so the
    //    answer says nothing about this code.
    const codeSlot = await takeSlot(admin, failedCodeKey, MAX_FAILED_CODES_PER_HOUR);
    if (codeSlot === "full") {
      return reply({ error: RATE_LIMITED, code: "rate_limited" }, 429);
    }

    // 1. Validate the claim code matches a real organization. Stored codes are
    //    always upper-case letters, digits and dashes (admin_set_org_claim_code
    //    normalises them), so anything else is invalid without a lookup, and the
    //    lookup is an EXACT match: a pattern (ilike, where PostgREST reads '*' as
    //    '%') would let 'ACI-*' probe many codes for the price of one slot.
    const normalizedCode = String(claim_code).trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9-]{1,63}$/.test(normalizedCode)) {
      // The slot stays taken, as for any failed code.
      return reply({ error: "Invalid organization code. Please use the normal signup process.", code: "invalid_code" }, 400);
    }
    const { data: org, error: orgError } = await admin
      .from("organizations")
      .select("id, name, organization_type")
      .eq("claim_code", normalizedCode)
      .maybeSingle();

    if (orgError) {
      // Not "invalid": the client would drop a code that may be fine.
      console.error("claim code lookup failed", orgError);
      await releaseSlot(admin, codeSlot);
      return reply({ error: "Could not check this code. Please try again in a minute." }, 500);
    }
    if (!org) {
      // The slot stays taken: one failed code for this network.
      return reply({ error: "Invalid organization code. Please use the normal signup process.", code: "invalid_code" }, 400);
    }
    await releaseSlot(admin, codeSlot);

    // 2. Is there already an account for this address? This replaces a
    //    listUsers({ perPage: 1000 }) scan that silently missed every user past
    //    the first thousand. handle_new_user copies the auth email (GoTrue stores
    //    it lowercased) into profiles, so an exact match on the lowercased input
    //    finds it. generateLink in step 3 stays the authoritative check for a
    //    CONFIRMED account either way.
    //    An UNCONFIRMED one is a retry (lost or failed e-mail) ONLY when this
    //    function made it for this org: app_metadata.claim_org_id (set in step 4;
    //    a caller cannot set app_metadata), or, for an account made before the
    //    claim waited for confirmation, the membership granted back then. It gets
    //    a fresh link, never a second account. Anything else unconfirmed is
    //    somebody's own pending sign-up (with "Confirm email" ON every normal
    //    sign-up waits like that) and is refused like a confirmed one. A retry
    //    changes nothing on the account: GoTrue keeps the first (random)
    //    password, step 3 sends no metadata and step 4 is skipped -- this caller
    //    is no more proven than the first one.
    //    profiles.email is editable by its owner, so a profile row is only a lead:
    //    the account counts only if its SIGN-IN address is the one typed (otherwise
    //    anyone could set their profile e-mail to a target's address and block
    //    every claim-code sign-up for it).
    const { data: priors, error: priorErr } = await admin
      .from("profiles")
      .select("user_id")
      .eq("email", email)
      .limit(100);
    // Fail closed if the cap is reached: decoy profiles (owners can set their own
    // profile e-mail) must not be able to hide the real account past the cap.
    if (priorErr || (priors?.length ?? 0) >= 100) {
      console.error("profile lookup failed or capped", priorErr);
      return reply({ error: "Could not check this e-mail address. Please try again in a minute." }, 500);
    }
    let existing: Awaited<ReturnType<typeof admin.auth.admin.getUserById>>["data"]["user"] | null = null;
    for (const p of priors ?? []) {
      const { data: found, error: findErr } = await admin.auth.admin.getUserById(p.user_id);
      if (!found?.user && findErr && findErr.status !== 404) {
        // Fail closed: without knowing the account, step 3 could rewrite it.
        console.error("getUserById failed", findErr);
        return reply({ error: "Could not check this e-mail address. Please try again in a minute." }, 500);
      }
      if (found?.user && (found.user.email || "").toLowerCase() === email) {
        existing = found.user;
        break;
      }
    }
    let resend: { userId: string; firstName: string; lastName: string } | null = null;
    {
      if (existing?.email_confirmed_at) {
        return reply({ error: ALREADY_EXISTS, code: "already_exists" }, 400);
      }
      if (existing) {
        let ours = (existing.app_metadata as Record<string, unknown> | undefined)?.claim_org_id === org.id;
        if (!ours) {
          const { data: member } = await admin
            .from("organization_members")
            .select("user_id")
            .eq("user_id", existing.id)
            .eq("organization_id", org.id)
            .maybeSingle();
          ours = !!member;
        }
        if (!ours) {
          return reply({ error: ALREADY_EXISTS, code: "already_exists" }, 400);
        }
        const sentAt = existing.confirmation_sent_at ? Date.parse(existing.confirmation_sent_at) : 0;
        if (Date.now() - sentAt < RESEND_COOLDOWN_MS) {
          return reply({ error: TOO_SOON, code: "too_soon", needs_confirmation: true }, 429);
        }
        const meta = existing.user_metadata || {};
        resend = {
          userId: existing.id,
          firstName: String(meta.first_name || ""),
          lastName: String(meta.last_name || ""),
        };
      }
    }

    // A new account means an e-mail to an address the caller picked: capped per
    // network. The slot is given back if no account comes out of step 3. A retry
    // re-sends to the same address: capped per network and per address (on top of
    // its 60 s cooldown); those slots are kept once taken.
    if (resend) {
      const perNetwork = await takeSlot(admin, await rateKey("resend", ip), MAX_RESENDS_PER_HOUR);
      if (perNetwork === "full") {
        return reply({ error: RATE_LIMITED, code: "rate_limited" }, 429);
      }
      const perAddress = await takeSlot(
        admin,
        await rateKey("resend_addr", email),
        MAX_RESENDS_PER_ADDRESS_PER_DAY,
        86_400_000,
      );
      if (perAddress === "full") {
        return reply({ error: RATE_LIMITED, code: "rate_limited" }, 429);
      }
    }
    const accountSlot = resend
      ? null
      : await takeSlot(admin, await rateKey("new_account", ip), MAX_NEW_ACCOUNTS_PER_HOUR);
    if (accountSlot === "full") {
      return reply({ error: RATE_LIMITED, code: "rate_limited" }, 429);
    }

    // 3. Create the user UNCONFIRMED and mint its confirmation token in one call.
    //    The password is a random one nobody knows (see the note at the top);
    //    the person chooses theirs on /welcome after clicking the link.
    //    For an existing unconfirmed user GoTrue issues a new token, ignores the
    //    password and merges options.data into its metadata -- hence no data on a
    //    retry. It refuses a confirmed one with email_exists, mapped to the
    //    message the client matches on: keep "already exists" in it.
    //    `lang` is stored with the account so the send-email hook writes later
    //    auth e-mails (GoTrue resends, password recovery) in the same language.
    //    After the link: /welcome (password step), then /onboarding with the
    //    code, which claims the organisation for the confirmed person.
    const afterConfirm = `/onboarding?code=${encodeURIComponent(normalizedCode)}`;
    const safePersona = SELF_SERVE_PERSONAS.has(persona) ? persona : (org.organization_type || "marina");
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: "signup",
      email,
      password: unguessablePassword(),
      options: {
        ...(resend ? {} : {
          data: {
            first_name: firstName,
            last_name: lastName,
            persona: safePersona,
            lang,
          },
        }),
        redirectTo: `${SITE_URL}/welcome?next=${encodeURIComponent(afterConfirm)}`,
      },
    });

    if (linkError || !link?.user) {
      await releaseSlot(admin, accountSlot);
      const code = (linkError as { code?: string } | null)?.code;
      const message = linkError?.message || "";
      if (code === "email_exists" || code === "user_already_exists" || /already (been )?registered|already exists/i.test(message)) {
        return reply({ error: ALREADY_EXISTS, code: "already_exists" }, 400);
      }
      return reply({ error: message || "Failed to create account" }, 400);
    }
    const user = link.user;

    // Step 2 should have caught every existing account. Should its lookup ever
    // miss one, GoTrue has just handed back a user that predates this request
    // (a minute of slack for clock skew): refuse it like any other existing
    // address and do nothing more to it.
    const preExisting = resend
      ? user.id !== resend.userId
      : Date.parse(user.created_at) < startedAt - 60_000;
    if (preExisting) {
      console.error("generateLink returned an account step 2 did not find", user.id);
      await releaseSlot(admin, accountSlot);
      return reply({ error: ALREADY_EXISTS, code: "already_exists" }, 400);
    }

    // 4. A new account (its slot stays taken): mark it as made by this function
    //    for this organisation, which is how step 2 recognises a retry.
    //    app_metadata only, which leaves the confirmation token alone (a
    //    password change would not). No membership here (see the top).
    if (!resend) {
      const { error: markErr } = await admin.auth.admin.updateUserById(user.id, { app_metadata: { claim_org_id: org.id } });
      // The link below still works; only a later "resend" would be refused.
      if (markErr) console.error("could not mark the claim-code account", user.id, markErr);
    }

    // 5. E-mail the confirmation link. Not GoTrue's action_link: that
    //    /auth/v1/verify URL comes back with an implicit-grant #access_token,
    //    which our PKCE client rejects ("Not a valid PKCE flow url"), so the
    //    person would land logged out; and mail scanners that pre-fetch links
    //    would spend it -- confirming the account -- before the owner clicks.
    //    /welcome redeems a token_hash itself with verifyOtp (the same link the
    //    send-email hook builds for /welcome), which works on any device, and a
    //    scanner running no JavaScript spends nothing. `next` then takes them to
    //    onboarding with the code. The link is only ever e-mailed, never
    //    returned to the caller.
    const props = link.properties as { hashed_token?: string; action_link?: string } | undefined;
    let confirmUrl = props?.action_link || "";
    if (props?.hashed_token) {
      const target = new URL("/welcome", SITE_URL);
      target.searchParams.set("token_hash", props.hashed_token);
      target.searchParams.set("type", "signup");
      target.searchParams.set("next", afterConfirm);
      confirmUrl = target.toString();
    }
    //    On a retry the greeting uses the name stored with the account, not the
    //    one this caller typed.
    const greetName = resend ? resend.firstName : firstName;
    const emailed = confirmUrl ? await sendConfirmationEmail(email, lang, greetName, org.name, confirmUrl) : false;

    // 6. Notify all admins of a new signup (fire-and-forget), incl. the outcome.
    //    A re-request is only worth a notification when the e-mail failed again.
    if (!resend || !emailed) {
      notifyAdminsOfSignup({
        email,
        first_name: resend ? resend.firstName : firstName,
        last_name: resend ? resend.lastName : lastName,
        org_name: org.name,
        claim_code: normalizedCode,
        resend: !!resend,
        emailed,
      });
    }

    // The account exists either way; a later submit with the same address takes
    // the retry branch in step 2 and sends a fresh link. Nothing about the
    // account or the organisation goes back: this caller is not proven to be
    // the person the account is for.
    if (!emailed) {
      return reply({ error: SEND_FAILED, code: "email_send_failed", needs_confirmation: true }, 502);
    }
    return reply({
      success: true,
      needs_confirmation: true,
      email_confirmation_required: true,
      resent: !!resend,
    }, 200);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return reply({ error: message }, 500);
  }
});
