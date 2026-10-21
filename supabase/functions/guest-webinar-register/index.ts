import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SENDER_EMAIL = Deno.env.get("SENDER_EMAIL") || "Smart Marina Connect <noreply@smartmarinaconnect.com>";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SITE_URL = Deno.env.get("SITE_URL") || "https://smartmarinaconnect.com";

// Rate limits
const MAX_PER_IP_PER_HOUR = 5;
const MAX_PER_EMAIL_PER_HOUR = 3;

const ALLOWED_ORIGINS = [
  "https://smartmarinaconnect.com",
  "https://m3connect.netlify.app",
  "http://localhost:5173",
  "http://localhost:3000",
];

function getCorsOrigin(req: Request): string {
  const origin = req.headers.get("origin") || "";
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

function corsHeaders(req: Request) {
  return {
    "Access-Control-Allow-Origin": getCorsOrigin(req),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function getClientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function toICSDate(d: Date): string {
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

function escapeICSText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

interface EventRow {
  id: string;
  title: string;
  description: string | null;
  date_time: string | null;
  end_date_time: string | null;
  location: string | null;
  event_type: string;
  access_level: string | null;
  invitation_only: boolean | null;
  published: boolean | null;
}

function buildICS(event: EventRow, guestEmail: string): string {
  const start = event.date_time ? new Date(event.date_time) : new Date();
  const end = event.end_date_time ? new Date(event.end_date_time) : new Date(start.getTime() + 60 * 60 * 1000);
  const now = new Date();
  const eventUrl = `${SITE_URL}/events/${event.id}`;
  const descText = `${event.description || ""}\n\nJoin at: ${eventUrl}`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Smart Marina Connect//Webinar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.id}@smartmarinaconnect.com`,
    `DTSTAMP:${toICSDate(now)}`,
    `DTSTART:${toICSDate(start)}`,
    `DTEND:${toICSDate(end)}`,
    `SUMMARY:${escapeICSText(event.title)}`,
    `DESCRIPTION:${escapeICSText(descText)}`,
    `LOCATION:${escapeICSText(event.location || eventUrl)}`,
    `URL:${eventUrl}`,
    `ORGANIZER;CN=Smart Marina Connect:mailto:noreply@smartmarinaconnect.com`,
    `ATTENDEE;CN=${guestEmail};RSVP=TRUE:mailto:${guestEmail}`,
    "STATUS:CONFIRMED",
    "BEGIN:VALARM",
    "TRIGGER:-PT15M",
    "ACTION:DISPLAY",
    `DESCRIPTION:Reminder: ${escapeICSText(event.title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

function formatHumanDate(isoString: string | null): string {
  if (!isoString) return "TBD";
  try {
    const d = new Date(isoString);
    return d.toLocaleString("en-GB", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return isoString;
  }
}

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

// Subject, HTML and plain-text parts of the guest confirmation. Pure: no I/O. The first
// name was typed by an anonymous visitor and the title is database text: both are escaped
// before they reach the HTML.
function buildConfirmationEmail(params: {
  firstName: string;
  event: EventRow;
}): { subject: string; html: string; text: string } {
  const { firstName, event } = params;
  const eventUrl = `${SITE_URL}/events/${event.id}`;
  const signupUrl = `${SITE_URL}/become-partner`;
  const when = formatHumanDate(event.date_time);
  const subject = `You're registered — ${event.title}`;
  const greeting = `Hello ${firstName || "there"},`;
  const title = "You're registered for the webinar";
  const intro = "Thanks for signing up! Your spot is confirmed for:";
  const calendar = "A calendar invite (.ics) is attached to this email so you can add it to your calendar in one click. We'll send you a reminder 24 hours before the webinar starts.";
  const accountA = "If you want full access to the platform (resources, events, partner network), you can ";
  const accountLink = "create a free account";
  const accountB = " with the same email and your registration will be automatically linked.";
  return {
    subject,
    html: emailLayout({
      pageTitle: emEsc(subject),
      preheader: emEsc(`${event.title}: ${when}`),
      eyebrow: "Webinar registration",
      title: emEsc(title),
      greeting: emEsc(greeting),
      bodyHtml: emP(emEsc(intro), 10) + emInfoTable([["Webinar", emEsc(event.title)], ["When", emEsc(when)]]) + emP(emEsc(calendar)),
      cta: { label: "View Webinar Details", url: emEsc(eventUrl) },
      footerNote: `${emEsc(accountA)}${emLink(accountLink, emEsc(signupUrl))}${emEsc(accountB)}`,
    }),
    text: emText({
      title,
      greeting,
      body: `${intro}\n\nWebinar: ${event.title}\nWhen: ${when}\n\n${calendar}`,
      cta: { label: "View Webinar Details", url: eventUrl },
      footerNote: `${accountA}${accountLink} (${signupUrl})${accountB}`,
    }),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }

  const headers = { "Content-Type": "application/json", ...corsHeaders(req) };

  try {
    const body = await req.json();
    const eventId: string | undefined = body.event_id;
    const firstName: string = (body.first_name || "").trim();
    const lastName: string = (body.last_name || "").trim();
    const email: string = (body.email || "").trim().toLowerCase();
    const company: string | null = body.company ? String(body.company).trim() : null;

    if (!eventId || !firstName || !lastName || !email) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ error: "Invalid email format" }), { status: 400, headers });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── Rate limiting ────────────────────────────────
    const ip = getClientIp(req);
    const ipHash = await sha256(`ip:${ip}`);
    const emailHash = await sha256(`email:${email}`);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const [ipCount, emailCount] = await Promise.all([
      supabase.from("guest_signup_rate_limits").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("created_at", oneHourAgo),
      supabase.from("guest_signup_rate_limits").select("id", { count: "exact", head: true }).eq("email_hash", emailHash).gte("created_at", oneHourAgo),
    ]);

    if ((ipCount.count ?? 0) >= MAX_PER_IP_PER_HOUR) {
      return new Response(JSON.stringify({ error: "Too many signups from this network. Please try again later.", code: "RATE_LIMIT_IP" }), { status: 429, headers });
    }
    if ((emailCount.count ?? 0) >= MAX_PER_EMAIL_PER_HOUR) {
      return new Response(JSON.stringify({ error: "This email has reached the signup limit. Please try again later.", code: "RATE_LIMIT_EMAIL" }), { status: 429, headers });
    }

    // ── Fetch event (validate it's an eligible public webinar) ────────────────
    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id, title, description, date_time, end_date_time, location, event_type, access_level, invitation_only, published")
      .eq("id", eventId)
      .maybeSingle();

    if (eventError || !event) {
      return new Response(JSON.stringify({ error: "Event not found" }), { status: 404, headers });
    }
    if (event.event_type !== "webinar" || event.access_level !== "public" || event.invitation_only === true || event.published === false) {
      return new Response(JSON.stringify({ error: "This event is not open for guest signup" }), { status: 403, headers });
    }

    // ── Insert registration ────────────────────────────────
    const { error: insertError } = await supabase.from("event_registrations").insert({
      event_id: eventId,
      user_id: null,
      guest_first_name: firstName,
      guest_last_name: lastName,
      guest_email: email,
      guest_company: company || null,
      registration_type: "guest",
      payment_status: "free",
    });

    if (insertError) {
      if (insertError.code === "23505") {
        return new Response(JSON.stringify({ error: "This email is already registered for this webinar.", code: "DUPLICATE" }), { status: 409, headers });
      }
      console.error(JSON.stringify({ tag: "guest_webinar_insert_error", message: insertError.message, code: insertError.code }));
      return new Response(JSON.stringify({ error: "Could not register", details: insertError.message }), { status: 500, headers });
    }

    // ── Record rate-limit entries (only after successful insert) ────────────
    await supabase.from("guest_signup_rate_limits").insert([
      { ip_hash: ipHash, email_hash: emailHash },
    ]);

    // ── Send confirmation email with .ics attachment ────────────────
    let emailStatus: "sent" | "failed" | "skipped" = "skipped";
    let emailId: string | null = null;
    let emailError: string | null = null;

    if (RESEND_API_KEY) {
      try {
        const { subject, html, text } = buildConfirmationEmail({ firstName, event: event as EventRow });
        const ics = buildICS(event as EventRow, email);
        const icsBase64 = btoa(ics);

        const resendRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: SENDER_EMAIL,
            to: [email],
            reply_to: EM.contact,
            subject,
            html,
            text,
            attachments: [
              {
                filename: "webinar.ics",
                content: icsBase64,
                content_type: "text/calendar; charset=utf-8; method=PUBLISH",
              },
            ],
          }),
        });
        const resendBody = await resendRes.text();
        if (!resendRes.ok) {
          emailStatus = "failed";
          emailError = `${resendRes.status} ${resendBody}`;
          console.error(JSON.stringify({
            tag: "guest_webinar_email_failed",
            status: resendRes.status,
            body: resendBody,
            to: email,
            event_id: eventId,
            sender: SENDER_EMAIL,
          }));
        } else {
          emailStatus = "sent";
          try {
            const parsed = JSON.parse(resendBody);
            emailId = parsed?.id ?? null;
          } catch { /* ignore */ }
          console.log(JSON.stringify({
            tag: "guest_webinar_email_sent",
            resend_id: emailId,
            to: email,
            event_id: eventId,
          }));
        }
      } catch (e) {
        emailStatus = "failed";
        emailError = e instanceof Error ? e.message : String(e);
        console.error(JSON.stringify({
          tag: "guest_webinar_email_exception",
          error: emailError,
          to: email,
          event_id: eventId,
        }));
      }
    } else {
      console.warn(JSON.stringify({ tag: "guest_webinar_email_skipped", reason: "RESEND_API_KEY not set" }));
    }

    return new Response(JSON.stringify({ success: true, email_status: emailStatus, email_id: emailId, email_error: emailError }), { status: 200, headers });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ tag: "guest_webinar_register_error", message }));
    return new Response(JSON.stringify({ error: message }), { status: 500, headers });
  }
});
