import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import QRCode from "https://esm.sh/qrcode@1.5.4";

// Guest-list events (gl_event / gl_guest): invitation-only events run on a
// plain guest list. First user: World Yachting Summit 2026 (/wys26).
//
// Public actions (no account): read the event, request an invitation, open
// one's personal page by token, accept/decline an invitation, request a
// plus-one once confirmed. Staff actions (admin/moderator JWT): approve or
// reject requests, send invitations, resend a mail, cancel a guest.
//
// Seats: everyone "confirmed" or "invited" (answer pending) holds a seat, so
// staff cannot promise more than the capacity. Accepting an invitation is
// never refused — the seat was held when it was sent.
//
// The entry QR encodes /admin/guest-list/<slug>/checkin?token=<token>. A staff
// phone scanning it lands on the check-in console. It is attached to the mail
// (inline + as a file), never fetched from a third party — see sm26-badge-email.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SITE_URL = Deno.env.get("SITE_URL") || "https://smartmarinaconnect.com";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const SENDER_DOMAIN_FROM = "noreply@smartmarinaconnect.com";

const ALLOWED_ORIGINS = [
  "https://smartmarinaconnect.com", "https://m3connect.netlify.app", "https://m3connectv2.netlify.app",
  "http://localhost:5173", "http://localhost:3000",
];
const NETLIFY_SUBDOMAIN = /^https:\/\/[a-z0-9-]+--m3connect(v2)?\.netlify\.app$/;
const isAllowed = (o: string) => ALLOWED_ORIGINS.includes(o) || NETLIFY_SUBDOMAIN.test(o);
const cors = (req: Request) => ({
  "Access-Control-Allow-Origin": isAllowed(req.headers.get("origin") || "") ? req.headers.get("origin")! : ALLOWED_ORIGINS[0],
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(req) } });

const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });

// ─── Anti-spam: Cloudflare Turnstile (public "request" action only) ─────────
// SOFT until TURNSTILE_ENFORCE is "true": a token that is present is always
// checked (present and invalid => refused), but a request with no token still
// goes through, because the pages that are live may not send one yet.
// TURNSTILE_SECRET_KEY unset => the check is skipped (logged once). Cloudflare
// unreachable, or a secret it does not accept => the request goes through
// (logged): our setup is at fault, not the visitor.
// The same helper is inlined in contact-submit and newsletter-subscribe.
const TURNSTILE_SECRET = Deno.env.get("TURNSTILE_SECRET_KEY") || "";
const TURNSTILE_ENFORCE = (Deno.env.get("TURNSTILE_ENFORCE") || "").trim().toLowerCase() === "true";
const TURNSTILE_SETUP_ERRORS = new Set(["missing-input-secret", "invalid-input-secret", "bad-request", "internal-error"]);
let turnstileSkipLogged = false;

const clientIp = (req: Request): string | null =>
  req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;

/** true: the request may go on. false: answer with the "captcha" error and say nothing more. Never throws. */
async function turnstileAllows(token: unknown, ip: string | null): Promise<boolean> {
  if (!TURNSTILE_SECRET) {
    if (!turnstileSkipLogged) {
      turnstileSkipLogged = true;
      console.warn("guest-list: TURNSTILE_SECRET_KEY is not set, the Turnstile check is skipped");
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
      console.error("guest-list: Turnstile siteverify could not judge the token", res.status, codes.join(","));
      return true;
    }
    return false;
  } catch (err) {
    console.error("guest-list: Turnstile siteverify unreachable", err instanceof Error ? err.name : "error");
    return true;
  }
}

const clean = (s: unknown, max = 200) => (typeof s === "string" ? s.trim().slice(0, max) : "");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ev = { id: string; slug: string; title: string; capacity: number | null; notify_email: string | null; requests_open: boolean; settings: Record<string, any> };
type Guest = Record<string, any>;

async function loadEvent(slug: string): Promise<Ev | null> {
  const { data } = await db.from("gl_event").select("id, slug, title, capacity, notify_email, requests_open, settings").eq("slug", slug).maybeSingle();
  return data as Ev | null;
}
async function eventById(id: string): Promise<Ev | null> {
  const { data } = await db.from("gl_event").select("id, slug, title, capacity, notify_email, requests_open, settings").eq("id", id).maybeSingle();
  return data as Ev | null;
}
async function seatsHeld(eventId: string): Promise<number> {
  const { count } = await db.from("gl_guest").select("id", { count: "exact", head: true })
    .eq("event_id", eventId).in("status", ["confirmed", "invited"]);
  return count || 0;
}

// ─── Email ───────────────────────────────────────────────────────────────
// The shared layout (refonte look, same frame as the Mailchimp welcome e-mail) is pasted
// below. Keep it identical in every function that sends an e-mail: docs/email-layout.ts,
// checked by `node scripts/email-previews.mjs --check`. Every e-mail of this function is
// built by a pure render function (no I/O) and sent by the send* wrappers further down.
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

// Guest and event fields are typed by guests or staff: they reach the HTML only through h().
const h = (v: unknown) => emEsc(String(v ?? ""));
const strong = (v: unknown) => `<strong style="color:${EM.navy};">${h(v)}</strong>`;

const partsText = (g: Guest) =>
  g.conference && g.gala ? "the conference and the gala dinner" : g.gala ? "the gala dinner" : g.conference ? "the conference" : "the event";
const guestUrl = (ev: Ev, g: Guest) => `${SITE_URL}/${ev.slug}/guest?t=${g.token}`;
const checkinUrl = (ev: Ev, g: Guest) => `${SITE_URL}/admin/guest-list/${ev.slug}/checkin?token=${g.token}`;

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

async function qrPngBase64(text: string): Promise<string> {
  const dataUrl: string = await QRCode.toDataURL(text, {
    margin: 2, width: 600, errorCorrectionLevel: "M", color: { dark: "#000000ff", light: "#ffffffff" },
  });
  return dataUrl.split(",")[1] || "";
}

// The pass: the QR image is the attachment with content id "entryqr" (see sendPass).
function renderPass(ev: Ev, g: Guest): Mail {
  const intro = `We are delighted to confirm your place at ${ev.title} for ${partsText(g)}.`;
  const caption = "Show this QR code at the entrance — it is personal to you. It is also attached as entry-pass.png. No QR? Just give your name at the desk.";
  const plusOne = g.plus_one_of
    ? ""
    : "Would you like to bring a guest? You can ask for a plus-one from your personal page — each plus-one is reviewed by our team.";
  const note = ev.settings?.programme_note || "";
  const qr = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 20px;"><tr><td align="center" bgcolor="${EM.soft}" style="background-color:${EM.soft};border-radius:12px;padding:22px 18px;"><img src="cid:entryqr" alt="Entry QR code" width="240" height="240" style="display:block;margin:0 auto;border:1px solid ${EM.line};border-radius:8px;padding:8px;background-color:#ffffff;" /><p style="margin:14px 0 0;font-family:${EM.font};font-size:13px;line-height:19px;color:${EM.muted};text-align:center;">${h(caption).replace("entry-pass.png", "<strong>entry-pass.png</strong>")}</p></td></tr></table>`;
  return glMail(ev, `Your invitation is confirmed — ${ev.title}`, {
    title: "Your invitation is confirmed",
    greeting: `Dear ${g.first_name},`,
    body:
      emP(`We are delighted to confirm your place at ${strong(ev.title)} for ${strong(partsText(g))}.`) +
      qr +
      (plusOne ? emP(h(plusOne)) : ""),
    text: [intro, `[QR code: attached to this e-mail as entry-pass.png]\n${caption}`, plusOne].filter(Boolean).join("\n\n"),
    cta: { label: "Open my invitation", url: guestUrl(ev, g) },
    note,
  });
}

function renderInvitation(ev: Ev, g: Guest): Mail {
  const url = guestUrl(ev, g);
  const s = ev.settings || {};
  const tagline = s.tagline ? ` — ${s.tagline}` : "";
  const where = `on ${s.date_label || ""} at ${s.venue || ""}, ${s.city || ""}`;
  const note = "Once you accept, you will receive your personal entry QR code by email.";
  const ask = "Please let us know whether you will join us:";
  return glMail(ev, `Invitation — ${ev.title}`, {
    title: "You are invited",
    greeting: `Dear ${g.first_name},`,
    body:
      emP(`It is our pleasure to invite you to ${strong(ev.title)}${s.tagline ? ` — <em>${h(s.tagline)}</em>` : ""}, on ${strong(s.date_label || "")} at ${h(s.venue || "")}, ${h(s.city || "")}.`) +
      emP(`This invitation is for ${strong(partsText(g))} and is personal to you.`) +
      emP(h(ask), 8),
    text: [
      `It is our pleasure to invite you to ${ev.title}${tagline}, ${where}.`,
      `This invitation is for ${partsText(g)} and is personal to you.`,
      ask,
    ].join("\n\n"),
    cta: { label: "Accept", url: `${url}&answer=accept` },
    secondary: { label: "Decline", url: `${url}&answer=decline` },
    note,
  });
}

function renderRequestAck(ev: Ev, g: Guest): Mail {
  const text = `Thank you for your interest in ${ev.title}. Attendance is by invitation only; our team reviews every request and will come back to you by email.`;
  return glMail(ev, `Your request — ${ev.title}`, {
    title: g.plus_one_of ? "Plus-one request received" : "Request received",
    greeting: `Dear ${g.first_name},`,
    body: emP(`Thank you for your interest in ${strong(ev.title)}. Attendance is by invitation only; our team reviews every request and will come back to you by email.`),
    text,
  });
}

function renderReject(ev: Ev, g: Guest): Mail {
  const text = `Thank you for your interest in ${ev.title}. Unfortunately we are not able to extend an invitation for this edition, as places are very limited. We hope to welcome you at a future event.`;
  return glMail(ev, `Your request — ${ev.title}`, {
    title: "About your request",
    greeting: `Dear ${g.first_name},`,
    body: emP(`Thank you for your interest in ${strong(ev.title)}. Unfortunately we are not able to extend an invitation for this edition, as places are very limited. We hope to welcome you at a future event.`),
    text,
  });
}

function renderStaffNotice(ev: Ev, g: Guest, host?: Guest | null): Mail {
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

// Replies go to the event's own contact address (admin setting settings.contact_email), or to the
// M3 events inbox when none is set. Set it to events@m3monaco.com so footer and reply-to agree.
async function send(ev: Ev, to: string, mail: Mail, opts: { guestId?: string; kind: string; by?: string | null; attachments?: unknown[] }) {
  if (!RESEND_API_KEY) { console.error("no RESEND_API_KEY"); return false; }
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${ev.title.replace(/[<>"]/g, "")} <${SENDER_DOMAIN_FROM}>`,
        to: [to],
        reply_to: ev.settings?.contact_email || EM.contact,
        subject: mail.subject, html: mail.html, text: mail.text,
        ...(opts.attachments ? { attachments: opts.attachments } : {}),
      }),
    });
    if (!resp.ok) { console.error("resend failed", await resp.text()); return false; }
    await db.from("gl_email_log").insert({ guest_id: opts.guestId || null, event_id: ev.id, kind: opts.kind, to_email: to, sent_by: opts.by || null })
      .then(() => {}, (e) => console.error("log failed", e));
    return true;
  } catch (e) { console.error("send error", e); return false; }
}

async function sendPass(ev: Ev, g: Guest, by: string | null) {
  const png = await qrPngBase64(checkinUrl(ev, g));
  return send(ev, g.email, renderPass(ev, g), {
    guestId: g.id, kind: "pass", by,
    attachments: [
      { filename: "qr-inline.png", content: png, content_type: "image/png", content_id: "entryqr" },
      { filename: "entry-pass.png", content: png, content_type: "image/png" },
    ],
  });
}

async function sendInvitation(ev: Ev, g: Guest, by: string | null) {
  return send(ev, g.email, renderInvitation(ev, g), { guestId: g.id, kind: "invitation", by });
}

async function sendRequestAck(ev: Ev, g: Guest) {
  return send(ev, g.email, renderRequestAck(ev, g), { guestId: g.id, kind: "request_ack" });
}

async function sendReject(ev: Ev, g: Guest, by: string | null) {
  return send(ev, g.email, renderReject(ev, g), { guestId: g.id, kind: "reject", by });
}

async function notifyStaff(ev: Ev, g: Guest, host?: Guest | null) {
  if (!ev.notify_email) return;
  await send(ev, ev.notify_email, renderStaffNotice(ev, g, host), { guestId: g.id, kind: "staff_notify" });
}

// ─── Public views ────────────────────────────────────────────────────────
function publicEvent(ev: Ev) {
  return { slug: ev.slug, title: ev.title, requests_open: ev.requests_open, settings: ev.settings };
}
async function guestView(ev: Ev, g: Guest) {
  let host = null, plusOne = null;
  if (g.plus_one_of) {
    const { data } = await db.from("gl_guest").select("first_name, last_name").eq("id", g.plus_one_of).maybeSingle();
    host = data;
  } else {
    const { data } = await db.from("gl_guest").select("first_name, last_name, status")
      .eq("plus_one_of", g.id).not("status", "in", "(rejected,cancelled,declined)").order("created_at", { ascending: false }).limit(1);
    plusOne = data?.[0] || null;
  }
  return {
    event: publicEvent(ev),
    guest: {
      first_name: g.first_name, last_name: g.last_name, company: g.company, status: g.status, source: g.source,
      conference: g.conference, gala: g.gala, checked_in: !!g.checked_in_at,
      checkin_url: g.status === "confirmed" ? checkinUrl(ev, g) : null,
      is_plus_one: !!g.plus_one_of, host, plus_one: plusOne,
    },
  };
}

// ─── Handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
  let body: Record<string, any>;
  try { body = await req.json(); } catch { return json(req, { error: "Invalid JSON" }, 400); }
  const action = String(body.action || "");

  // ── Public ──
  if (action === "event") {
    const ev = await loadEvent(clean(body.slug, 60));
    if (!ev) return json(req, { error: "not_found" }, 404);
    return json(req, { event: publicEvent(ev) });
  }

  if (action === "request") {
    if (clean(body.website)) return json(req, { ok: true }); // honeypot: pretend success
    const ev = await loadEvent(clean(body.slug, 60));
    if (!ev) return json(req, { error: "not_found" }, 404);
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
    // Anti-spam (Turnstile), after the field checks so a form refused for another
    // reason does not use up the visitor's single-use token. Soft until
    // TURNSTILE_ENFORCE is "true". A distinct code (400), so the page can say the
    // check did not go through; nothing else is given away.
    if (!(await turnstileAllows(body.captcha, clientIp(req)))) return json(req, { error: "captcha" }, 400);
    // Flood guard: a burst of requests in ten minutes is not people.
    const since = new Date(Date.now() - 10 * 60_000).toISOString();
    const { count } = await db.from("gl_guest").select("id", { count: "exact", head: true })
      .eq("event_id", ev.id).eq("source", "request").gte("created_at", since);
    if ((count || 0) > 40) return json(req, { error: "busy" }, 429);
    const { data: existing } = await db.from("gl_guest").select("id").eq("event_id", ev.id).eq("email", g.email).maybeSingle();
    // Same answer as a new request, whatever the existing status: this form must not reveal who is on the list.
    if (existing) return json(req, { ok: true });
    const { data: row, error } = await db.from("gl_guest").insert({ ...g, event_id: ev.id, source: "request", status: "requested" }).select("*").single();
    if (error) {
      if (error.code === "23505") return json(req, { ok: true });
      return json(req, { error: error.message }, 500);
    }
    await Promise.all([sendRequestAck(ev, row), notifyStaff(ev, row)]);
    return json(req, { ok: true });
  }

  if (action === "guest" || action === "rsvp" || action === "plus_one") {
    const token = clean(body.token, 40);
    if (!UUID_RE.test(token)) return json(req, { error: "not_found" }, 404);
    const { data: g } = await db.from("gl_guest").select("*").eq("token", token).maybeSingle();
    if (!g) return json(req, { error: "not_found" }, 404);
    const ev = await eventById(g.event_id);
    if (!ev) return json(req, { error: "not_found" }, 404);

    if (action === "rsvp") {
      const answer = body.answer;
      if (answer === "accept") {
        // Only an invitation (or an invitation they declined and now want back)
        // can be accepted by the guest. A request is accepted by staff.
        const canAccept = g.status === "invited" || (g.status === "declined" && g.source !== "request");
        if (g.status === "confirmed") return json(req, await guestView(ev, g));
        if (!canAccept) return json(req, { error: "not_allowed" }, 400);
        if (g.status === "declined" && ev.capacity != null && (await seatsHeld(ev.id)) >= ev.capacity)
          return json(req, { error: "full" }, 409);
        const { data: up } = await db.from("gl_guest").update({ status: "confirmed", responded_at: new Date().toISOString() })
          .eq("id", g.id).select("*").single();
        await sendPass(ev, up, null);
        return json(req, await guestView(ev, up));
      }
      if (answer === "decline") {
        if (!["invited", "confirmed"].includes(g.status)) return json(req, await guestView(ev, g));
        const { data: up } = await db.from("gl_guest").update({ status: "declined", responded_at: new Date().toISOString() })
          .eq("id", g.id).select("*").single();
        return json(req, await guestView(ev, up));
      }
      return json(req, { error: "bad_answer" }, 400);
    }

    if (action === "plus_one") {
      if (g.status !== "confirmed" || g.plus_one_of) return json(req, { error: "not_allowed" }, 400);
      const { data: open } = await db.from("gl_guest").select("id").eq("plus_one_of", g.id)
        .not("status", "in", "(rejected,cancelled,declined)").limit(1);
      if (open?.length) return json(req, { error: "already" }, 400);
      const p = {
        first_name: clean(body.first_name, 80), last_name: clean(body.last_name, 80), email: clean(body.email, 200).toLowerCase(),
        company: clean(body.company, 160), job_title: clean(body.job_title, 160), phone: clean(body.phone, 40),
      };
      if (!p.first_name || !p.last_name || !EMAIL_RE.test(p.email)) return json(req, { error: "missing_fields" }, 400);
      if (p.email === g.email.toLowerCase()) return json(req, { error: "same_email" }, 400);
      const { data: dupe } = await db.from("gl_guest").select("id").eq("event_id", ev.id).eq("email", p.email).maybeSingle();
      if (dupe) return json(req, { error: "email_taken" }, 400);
      const { data: row, error } = await db.from("gl_guest").insert({
        ...p, event_id: ev.id, source: "plus_one", status: "requested", plus_one_of: g.id,
        wants_conference: g.conference, wants_gala: g.gala,
      }).select("*").single();
      if (error) return json(req, { error: error.code === "23505" ? "email_taken" : error.message }, 400);
      await notifyStaff(ev, row, g);
      return json(req, await guestView(ev, g));
    }

    return json(req, await guestView(ev, g));
  }

  // ── Staff ──
  const jwt = (req.headers.get("authorization") || "").replace("Bearer ", "");
  const { data: u } = jwt ? await db.auth.getUser(jwt) : { data: null };
  const uid = u?.user?.id;
  if (!uid) return json(req, { error: "Unauthorized" }, 401);
  const { data: prof } = await db.from("profiles").select("persona, access_status").eq("user_id", uid).maybeSingle();
  if (!prof || !["admin", "moderator"].includes(prof.persona || "") || prof.access_status !== "verified")
    return json(req, { error: "Forbidden" }, 403);

  const ev = body.event_id ? await eventById(clean(body.event_id, 40)) : await loadEvent(clean(body.slug, 60));
  if (!ev) return json(req, { error: "event not found" }, 404);
  const force = body.force === true;
  const now = new Date().toISOString();

  if (action === "decide") {
    const ids: string[] = (Array.isArray(body.guest_ids) ? body.guest_ids : []).filter((x: unknown) => typeof x === "string" && UUID_RE.test(x));
    if (!ids.length) return json(req, { error: "no guests" }, 400);
    const { data: rows } = await db.from("gl_guest").select("*").eq("event_id", ev.id).in("id", ids);
    const pending = (rows || []).filter((r) => r.status === "requested");
    if (body.decision === "approve") {
      if (ev.capacity != null && !force) {
        const held = await seatsHeld(ev.id);
        if (held + pending.length > ev.capacity) return json(req, { error: "capacity", held, capacity: ev.capacity, adding: pending.length }, 409);
      }
      let sent = 0, failed = 0;
      for (const r of pending) {
        const conference = typeof body.conference === "boolean" ? body.conference : r.wants_conference;
        const gala = typeof body.gala === "boolean" ? body.gala : r.wants_gala;
        const { data: up } = await db.from("gl_guest").update({ status: "confirmed", conference, gala, decided_at: now, decided_by: uid })
          .eq("id", r.id).eq("status", "requested").select("*").maybeSingle();
        if (!up) continue;
        (await sendPass(ev, up, uid)) ? sent++ : failed++;
      }
      return json(req, { ok: true, approved: pending.length, sent, failed, skipped: ids.length - pending.length });
    }
    if (body.decision === "reject") {
      let sent = 0;
      for (const r of pending) {
        const { data: up } = await db.from("gl_guest").update({ status: "rejected", decided_at: now, decided_by: uid })
          .eq("id", r.id).eq("status", "requested").select("*").maybeSingle();
        if (up && body.notify === true && (await sendReject(ev, up, uid))) sent++;
      }
      return json(req, { ok: true, rejected: pending.length, sent, skipped: ids.length - pending.length });
    }
    return json(req, { error: "bad decision" }, 400);
  }

  if (action === "invite") {
    const list: Record<string, unknown>[] = Array.isArray(body.guests) ? body.guests.slice(0, 500) : [];
    const conference = body.conference !== false, gala = body.gala !== false;
    if (!conference && !gala) return json(req, { error: "Choose conference, gala or both" }, 400);
    const valid: Guest[] = [], invalid: string[] = [];
    const seen = new Set<string>();
    for (const x of list) {
      const g = {
        first_name: clean(x.first_name, 80), last_name: clean(x.last_name, 80), email: clean(x.email, 200).toLowerCase(),
        company: clean(x.company, 160), job_title: clean(x.job_title, 160), phone: clean(x.phone, 40), country: clean(x.country, 80),
      };
      if (!g.first_name || !g.last_name || !EMAIL_RE.test(g.email) || seen.has(g.email)) { invalid.push(g.email || `${g.first_name} ${g.last_name}`.trim() || "(empty row)"); continue; }
      seen.add(g.email); valid.push(g);
    }
    const { data: existingRows } = valid.length
      ? await db.from("gl_guest").select("email, status").eq("event_id", ev.id).in("email", valid.map((g) => g.email))
      : { data: [] };
    const existing = new Map((existingRows || []).map((r) => [r.email.toLowerCase(), r.status]));
    const fresh = valid.filter((g) => !existing.has(g.email));
    const alreadyOnList = valid.filter((g) => existing.has(g.email)).map((g) => `${g.email} (${existing.get(g.email)})`);
    if (ev.capacity != null && !force) {
      const held = await seatsHeld(ev.id);
      if (held + fresh.length > ev.capacity) return json(req, { error: "capacity", held, capacity: ev.capacity, adding: fresh.length }, 409);
    }
    let sent = 0, failed = 0;
    for (const g of fresh) {
      const { data: row, error } = await db.from("gl_guest").insert({
        ...g, event_id: ev.id, source: "invitation", status: "invited", conference, gala,
        wants_conference: conference, wants_gala: gala, invited_at: now, decided_by: uid, decided_at: now,
      }).select("*").single();
      if (error || !row) { failed++; continue; }
      (await sendInvitation(ev, row, uid)) ? sent++ : failed++;
    }
    return json(req, { ok: true, invited: fresh.length, sent, failed, already_on_list: alreadyOnList, invalid });
  }

  if (action === "resend" || action === "cancel" || action === "update") {
    const id = clean(body.guest_id, 40);
    const { data: g } = await db.from("gl_guest").select("*").eq("event_id", ev.id).eq("id", id).maybeSingle();
    if (!g) return json(req, { error: "guest not found" }, 404);
    if (action === "resend") {
      if (g.status === "invited") return json(req, { ok: await sendInvitation(ev, g, uid), kind: "invitation" });
      if (g.status === "confirmed") return json(req, { ok: await sendPass(ev, g, uid), kind: "pass" });
      return json(req, { error: `Nothing to resend for a guest who is ${g.status}` }, 400);
    }
    if (action === "cancel") {
      await db.from("gl_guest").update({ status: "cancelled", decided_at: now, decided_by: uid }).eq("id", g.id);
      return json(req, { ok: true });
    }
    // update: change access (conference/gala) of a guest; optionally re-send the pass
    const patch: Record<string, unknown> = {};
    if (typeof body.conference === "boolean") patch.conference = body.conference;
    if (typeof body.gala === "boolean") patch.gala = body.gala;
    if (typeof body.admin_note === "string") patch.admin_note = clean(body.admin_note, 2000);
    const { data: up } = await db.from("gl_guest").update(patch).eq("id", g.id).select("*").single();
    return json(req, { ok: true, guest: up });
  }

  return json(req, { error: "Unknown action" }, 400);
});
