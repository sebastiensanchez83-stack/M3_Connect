import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SITE_URL = Deno.env.get("SITE_URL") || "https://smartmarinaconnect.com";

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

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

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

interface ReferenceEmailData {
  recipientFirstName: string;
  partnerLegalName: string;
  referenceId: string;
  verificationCode: string;
  expiresAt: string;
  recipientEmail: string;
  clientLegalName: string;
  clientCountry: string;
  clientWebsite: string;
  signerName: string;
  signerTitle: string;
  projectName: string;
  projectLocation: string;
  projectStartDate: string;
  projectEndDate: string;
  projectDeliveryDate: string;
  contractReference: string;
  solutionProduct: string;
  scopeDescription: string;
  resultsSummary: string;
  keyKpis: string;
  recommendationStatement: string;
  confirmUrl: string;
  rejectUrl: string;
}

// A section label inside the body: small teal capitals, like the eyebrow.
function refHeading(text: string): string {
  return `<p style="margin:22px 0 4px;font-family:${EM.font};font-size:12px;line-height:16px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${EM.teal};">${text}</p>`;
}

// HTML and plain-text parts of the reference confirmation request. Pure: no I/O. Every
// value (partner-entered text, names, addresses) is escaped before it reaches the HTML;
// the links, the codes and the wording are the ones the function always sent.
function buildReferenceEmail(data: ReferenceEmailData): { html: string; text: string } {
  const na = (v: string) => v || "N/A";
  const title = "Action required — confirm a client recommendation";
  const greeting = `Hello ${data.recipientFirstName},`;
  const introRest = " has indicated that you are authorised to confirm a client recommendation regarding the project below. This confirmation is part of Smart Marina Connect's partner onboarding and trust-verification process.";
  const privacy = "By confirming this recommendation, you agree that your name, title and confirmation may be shared with Smart Marina Connect as part of the partner's onboarding process. Your data is processed in accordance with our privacy policy.";
  const questions = "If you have any questions, please contact our team at";
  const contact = "contact@smartmarinaconnect.com";
  const address = "3 Boulevard des Moulins, Monte Carlo Palace, Office B21, 98000 Monaco";
  const sentBy = "This email was sent by Smart Marina Connect as part of a partner onboarding process.";

  const reference: Array<[string, string]> = [
    ["Smart Marina Connect reference", data.referenceId],
    ["Verification code", data.verificationCode],
    ["Expires", data.expiresAt],
    ["Recipient email", data.recipientEmail],
  ];
  const client: Array<[string, string]> = [
    ["Company", data.clientLegalName],
    ["Country", na(data.clientCountry)],
    ["Website", na(data.clientWebsite)],
    ["Declared signer", `${data.signerName}, ${data.signerTitle}`],
  ];
  const project: Array<[string, string]> = [
    ["Project", data.projectName],
    ["Location", na(data.projectLocation)],
    ["Period", `${na(data.projectStartDate)} to ${na(data.projectEndDate)}`],
    ["Delivered", na(data.projectDeliveryDate)],
    ["Contract reference", na(data.contractReference)],
    ["Solution / product", na(data.solutionProduct)],
    ["Scope", na(data.scopeDescription)],
  ];
  const quote = `“ ${data.recommendationStatement} ”`;
  const rowsHtml = (rows: Array<[string, string]>) =>
    emInfoTable(
      rows.map(([k, v]): [string, string] =>
        k === "Verification code"
          ? [emEsc(k), `<span style="font-family:${EM.mono};font-weight:bold;letter-spacing:2px;color:${EM.navy};">${emEsc(v)}</span>`]
          : [emEsc(k), emEsc(v)],
      ),
    );
  const rowsText = (rows: Array<[string, string]>) => rows.map(([k, v]) => `${k}: ${v}`).join("\n");

  const html = emailLayout({
    pageTitle: "Smart Marina Connect &ndash; Reference verification",
    preheader: emEsc(`Client reference confirmation, ${data.referenceId}, ${data.projectName}, action required.`),
    eyebrow: "Reference verification",
    title: "Action required &mdash; confirm a client recommendation",
    greeting: emEsc(greeting),
    bodyHtml:
      emP(`<strong style="color:${EM.navy};">${emEsc(data.partnerLegalName)}</strong>${emEsc(introRest)}`) +
      rowsHtml(reference) +
      refHeading("1. Client organisation") +
      rowsHtml(client) +
      refHeading("2. Project and scope") +
      rowsHtml(project) +
      refHeading("3. Results and value delivered") +
      emP(emEsc(na(data.resultsSummary)), 8) +
      emInfoTable([["KPIs", emEsc(na(data.keyKpis))]]) +
      emNote(`<em>${emEsc(quote)}</em>`, "Proposed recommendation"),
    cta: { label: "&#10003; I confirm and approve", url: emEsc(data.confirmUrl) },
    secondary: { label: "&#10007; I do not confirm", url: emEsc(data.rejectUrl) },
    footerNote: `<strong style="color:${EM.ink};">Privacy and consent</strong><br>${emEsc(privacy)}<br><br>${emEsc(questions)} <a href="mailto:${contact}" style="color:${EM.navy};text-decoration:underline;">${contact}</a>`,
    reason: `Smart Marina Connect &middot; ${emEsc(address)}<br>${emEsc(sentBy)}`,
  });

  const text = emText({
    title,
    greeting,
    body: [
      `${data.partnerLegalName}${introRest}`,
      rowsText(reference),
      `1. Client organisation\n${rowsText(client)}`,
      `2. Project and scope\n${rowsText(project)}`,
      `3. Results and value delivered\n${na(data.resultsSummary)}\nKPIs: ${na(data.keyKpis)}`,
      `Proposed recommendation\n${quote}`,
    ].join("\n\n"),
    cta: { label: "✓ I confirm and approve", url: data.confirmUrl },
    secondary: { label: "✗ I do not confirm", url: data.rejectUrl },
    footerNote: `Privacy and consent\n${privacy}\n\n${questions} ${contact}`,
    reason: `Smart Marina Connect · ${address}\n${sentBy}`,
  });
  return { html, text };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) });
  }

  const headers = { 'Content-Type': 'application/json', ...corsHeaders(req) };

  try {
    const { reference_request_id, recipients } = await req.json();

    if (!reference_request_id || !recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return new Response(JSON.stringify({ error: 'Missing reference_request_id or recipients' }), { status: 400, headers });
    }

    const { data: refReq, error: refErr } = await supabaseAdmin
      .from('reference_requests')
      .select('*')
      .eq('id', reference_request_id)
      .single();

    if (refErr || !refReq) {
      return new Response(JSON.stringify({ error: 'Reference request not found', details: refErr?.message }), { status: 404, headers });
    }

    const { data: partnerOrg } = await supabaseAdmin
      .from('organizations')
      .select('name')
      .eq('id', refReq.partner_organization_id)
      .single();

    const results: Array<{ email: string; status: string; error?: string }> = [];

    for (const recipient of recipients) {
      const confirmToken = generateToken();
      const rejectToken = generateToken();
      const openToken = generateToken();

      const confirmHash = await hashToken(confirmToken);
      const rejectHash = await hashToken(rejectToken);
      const openHash = await hashToken(openToken);

      const { error: recErr } = await supabaseAdmin
        .from('reference_recipients')
        .insert({
          reference_request_id,
          email: recipient.email,
          first_name: recipient.first_name || null,
          last_name: recipient.last_name || null,
          job_title: recipient.job_title || null,
          confirm_token_hash: confirmHash,
          reject_token_hash: rejectHash,
          open_token_hash: openHash,
        });

      if (recErr) {
        results.push({ email: recipient.email, status: 'failed', error: recErr.message });
        continue;
      }

      const confirmUrl = `${SITE_URL}/reference/confirm?token=${confirmToken}&ref=${refReq.reference_id}`;
      const rejectUrl = `${SITE_URL}/reference/reject?token=${rejectToken}&ref=${refReq.reference_id}`;

      const { html: emailHtml, text: emailText } = buildReferenceEmail({
        recipientFirstName: recipient.first_name || 'Madam/Sir',
        partnerLegalName: partnerOrg?.name || 'Partner',
        referenceId: refReq.reference_id,
        verificationCode: refReq.verification_code,
        expiresAt: new Date(refReq.expires_at).toLocaleString('en-GB', { timeZone: 'Europe/Paris' }),
        recipientEmail: recipient.email,
        clientLegalName: refReq.client_legal_name,
        clientCountry: refReq.client_country || '',
        clientWebsite: refReq.client_website || '',
        signerName: `${recipient.first_name || ''} ${recipient.last_name || ''}`.trim(),
        signerTitle: recipient.job_title || '',
        projectName: refReq.project_name,
        projectLocation: refReq.project_location || '',
        projectStartDate: refReq.project_start_date || '',
        projectEndDate: refReq.project_end_date || '',
        projectDeliveryDate: refReq.project_delivery_date || '',
        contractReference: refReq.contract_reference || '',
        solutionProduct: refReq.solution_product || '',
        scopeDescription: refReq.scope_description || '',
        resultsSummary: refReq.results_summary || '',
        keyKpis: refReq.key_kpis || '',
        recommendationStatement: refReq.recommendation_statement,
        confirmUrl,
        rejectUrl,
      });

      if (RESEND_API_KEY) {
        try {
          const emailResponse = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${RESEND_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: Deno.env.get("SENDER_EMAIL") || 'Smart Marina Connect <noreply@smartmarinaconnect.com>',
              to: recipient.email,
              reply_to: EM.contact,
              subject: `Action required — Confirm a client recommendation (${refReq.reference_id})`,
              html: emailHtml,
              text: emailText,
            }),
          });

          if (emailResponse.ok) {
            await supabaseAdmin
              .from('reference_recipients')
              .update({ delivery_status: 'sent', sent_at: new Date().toISOString() })
              .eq('reference_request_id', reference_request_id)
              .eq('email', recipient.email);

            await supabaseAdmin.from('reference_events').insert({
              reference_request_id,
              event_type: 'email_sent',
              actor_type: 'system',
              actor_id: 'edge-function',
              metadata: { recipient_email: recipient.email },
            });

            results.push({ email: recipient.email, status: 'sent' });
          } else {
            const errBody = await emailResponse.text();
            await supabaseAdmin
              .from('reference_recipients')
              .update({ delivery_status: 'failed' })
              .eq('reference_request_id', reference_request_id)
              .eq('email', recipient.email);
            results.push({ email: recipient.email, status: 'send_failed', error: errBody });
          }
        } catch (sendErr) {
          results.push({ email: recipient.email, status: 'send_failed', error: String(sendErr) });
        }
      } else {
        results.push({ email: recipient.email, status: 'recipient_created_no_email', error: 'No RESEND_API_KEY configured.' });
      }
    }

    const anySent = results.some(r => r.status === 'sent');
    const anyCreated = results.some(r => r.status === 'recipient_created_no_email' || r.status === 'sent');
    if (anySent) {
      await supabaseAdmin
        .from('reference_requests')
        .update({ status: 'sent' })
        .eq('id', reference_request_id);
    } else if (anyCreated) {
      await supabaseAdmin.from('reference_events').insert({
        reference_request_id,
        event_type: 'recipients_created_no_email',
        actor_type: 'system',
        actor_id: 'edge-function',
        metadata: { results },
      });
    }

    return new Response(JSON.stringify({ success: true, results }), { headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(req) },
    });
  }
});
