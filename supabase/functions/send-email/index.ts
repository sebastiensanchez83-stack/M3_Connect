import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const HOOK_SECRET = Deno.env.get("SEND_EMAIL_HOOK_SECRET");
const SENDER_EMAIL = Deno.env.get("SENDER_EMAIL") || "Smart Marina Connect <noreply@smartmarinaconnect.com>";

interface EmailPayload {
  user: {
    email: string;
    // The address an email change is moving to (only set while one is pending).
    new_email?: string;
    // Whatever was sent at sign-up or later through updateUser — untrusted.
    user_metadata?: Record<string, unknown>;
  };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: string;
    site_url: string;
    token_new?: string;
    token_hash_new?: string;
  };
}

interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: { message: "Method not allowed" } }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!RESEND_API_KEY) {
      console.error("FATAL: RESEND_API_KEY environment variable is not set");
      return new Response(JSON.stringify({ error: { http_code: 500, message: "RESEND_API_KEY not configured" } }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!HOOK_SECRET) {
      console.error("FATAL: SEND_EMAIL_HOOK_SECRET environment variable is not set");
      return new Response(JSON.stringify({ error: { http_code: 500, message: "SEND_EMAIL_HOOK_SECRET not configured" } }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const payload = await req.text();
    const headers = Object.fromEntries(req.headers);

    const wh = new Webhook(HOOK_SECRET.replace("v1,whsec_", ""));

    let data: EmailPayload;
    try {
      data = wh.verify(payload, headers) as EmailPayload;
    } catch (err) {
      console.error("Webhook verification failed:", err);
      return new Response(JSON.stringify({ error: { http_code: 401, message: "Invalid signature" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { user, email_data } = data;
    const { token, token_hash, token_hash_new, redirect_to, email_action_type, site_url } = email_data;

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const redirectTarget = redirect_to || site_url;

    // Two ways to land someone back in the app, and the difference is why people
    // could not reset their password.
    //
    // The GoTrue /auth/v1/verify link spends its token on the FIRST GET. Corporate
    // mail scanners (Outlook ATP and friends) fetch every link before the recipient
    // ever sees it, so the token is already spent by the time they click: the
    // platform says "email link has expired" on the very first attempt, for ever.
    // It also redirects back with a PKCE code, which only resolves in the browser
    // that asked for the reset — so a link requested on a laptop and opened on a
    // phone cannot work either.
    //
    // Handing the token_hash to a page that redeems it itself fixes both: a scanner
    // fetching the page runs no JavaScript and so spends nothing, and verifyOtp is
    // checked server-side, so any device can complete it. Only pages that actually
    // call verifyOtp may be sent the hash — everything else keeps the old link.
    //
    // Built per token hash, because an email change under "Secure email change"
    // carries two of them, one for each address.
    const REDEEMING_PATHS = new Set(["/reset-password", "/welcome"]);
    const linkFor = (hash: string): { url: string; anyDevice: boolean } => {
      try {
        const target = new URL(redirectTarget);
        if (
          (target.protocol === "https:" || target.protocol === "http:") &&
          REDEEMING_PATHS.has(target.pathname.replace(/\/+$/, "") || "/")
        ) {
          target.searchParams.set("token_hash", hash);
          target.searchParams.set("type", email_action_type);
          return { url: target.toString(), anyDevice: true };
        }
      } catch {
        /* unparseable redirect target — keep the GoTrue link */
      }
      return {
        url: `${supabaseUrl}/auth/v1/verify?token=${encodeURIComponent(hash)}&type=${encodeURIComponent(email_action_type)}&redirect_to=${encodeURIComponent(redirectTarget)}`,
        anyDevice: false,
      };
    };

    const lang = pickLang(user.user_metadata?.lang, redirectTarget);
    const copy = COPY[lang];
    const greeting = copy.hello(displayName(user.user_metadata?.first_name));

    const emails: OutgoingEmail[] = [];
    const add = (to: string, mail: MailCopy, action: { link?: string; code?: string }, hello = greeting) => {
      const props: EmailTemplateProps = { lang, greeting: hello, ...mail, buttonUrl: action.link, code: action.code };
      emails.push({ to, subject: mail.subject, html: buildEmail(props), text: buildEmailText(props) });
    };

    switch (email_action_type) {
      case "signup":
        // Always through /welcome, whatever page the caller asked for: see signupConfirmLink.
        add(user.email, copy.signup, { link: signupConfirmLink(redirectTarget, site_url, token_hash) ?? linkFor(token_hash).url });
        break;
      case "recovery": {
        const link = linkFor(token_hash);
        add(user.email, copy.recovery(link.anyDevice), { link: link.url });
        break;
      }
      case "email_change": {
        // Supabase kept these field names reversed for backward compatibility:
        //   token_hash     → the NEW address (user.new_email)
        //   token_hash_new → the CURRENT address (user.email); only sent with
        //                    "Secure email change" ON
        // ON: each address gets its own link, and the change happens once both
        // have been used. OFF: only the new address is asked to confirm.
        const newEmail = user.new_email || "";
        if (!newEmail || !token_hash) {
          console.error("email_change payload without new_email or token_hash; nothing sent", user.email);
          return new Response(
            JSON.stringify({ error: { http_code: 500, message: "email_change payload is missing the new address" } }),
            { status: 500, headers: { "Content-Type": "application/json" } }
          );
        }
        const secure = Boolean(token_hash_new && user.email);
        add(newEmail, copy.emailChangeNew(newEmail, secure), { link: linkFor(token_hash).url });
        if (secure) {
          add(user.email, copy.emailChangeCurrent(user.email, newEmail), { link: linkFor(token_hash_new as string).url });
        }
        break;
      }
      case "magiclink":
        add(user.email, copy.magiclink, { link: linkFor(token_hash).url });
        break;
      case "invite":
        add(user.email, copy.invite, { link: linkFor(token_hash).url }, copy.hello(""));
        break;
      case "reauthentication":
        // supabase.auth.reauthenticate(): a one-time code to type in, no link.
        if (token) add(user.email, copy.reauthentication, { code: token });
        break;
      default:
        // Security notices (password_changed_notification, email_changed_notification,
        // mfa_factor_enrolled_notification…) only arrive if they are switched on
        // in the dashboard. They carry no token, and there is no template for them
        // yet: acknowledge without sending rather than mail an "Action Required"
        // with a dead link.
        if (email_action_type.endsWith("_notification")) break;
        if (token_hash) add(user.email, copy.actionLink, { link: linkFor(token_hash).url });
        else if (token) add(user.email, copy.actionCode, { code: token });
    }

    if (emails.length === 0) {
      console.log("No email sent for type:", email_action_type, "to:", user.email);
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const results = await Promise.all(emails.map(sendViaResend));

    const failed = results.find((r) => !r.ok);
    if (failed) {
      console.error("Resend API error:", failed.status, failed.body);
      return new Response(
        JSON.stringify({ error: { http_code: 500, message: `Resend API error: ${failed.status} - ${failed.body}` } }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const ids = results.map((r) => {
      try {
        return JSON.parse(r.body).id || r.body;
      } catch {
        return r.body;
      }
    });

    console.log(
      "Email sent successfully:", ids.join(", "),
      "to:", emails.map((e) => e.to).join(", "),
      "type:", email_action_type,
      "lang:", lang,
    );

    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : "";
    console.error("UNHANDLED ERROR in send-email hook:", message, "\nStack:", stack);
    return new Response(
      JSON.stringify({ error: { http_code: 500, message } }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// ---- Sign-up activation link ----
// Pre-registration takeover (9 Oct 2026). Anyone can sign up with someone else's address
// and a password of their choosing, through the website or straight through the Auth API
// with the public key, and they choose redirect_to too. Once "Confirm email" is ON, the
// real owner of the mailbox gets this e-mail: if the link only confirmed the address, the
// stranger's password would keep working on the now-confirmed account. So the activation
// link ALWAYS opens /welcome, which redeems the token_hash itself and then forces the
// "choose your password" step (type=signup) on the old and the new site alike. The page
// the caller asked for only becomes ?next= (WelcomePage keeps it to a path on the site).
// GoTrue passes on only a redirect_to it accepted (Site URL or allow list), else the Site
// URL, so the origin is ours. null when neither URL can be read (the caller then keeps
// the old link).
function signupConfirmLink(redirectTarget: string, siteUrl: string, hash: string): string | null {
  const web = (u: URL) => u.protocol === "https:" || u.protocol === "http:";
  let base: URL | null = null;
  try {
    const r = new URL(redirectTarget);
    if (web(r)) base = r;
  } catch {
    /* unreadable: the Site URL below */
  }
  if (!base) {
    try {
      const s = new URL(siteUrl);
      if (web(s)) base = new URL("/", s.origin);
    } catch {
      return null;
    }
  }
  if (!base) return null;
  const path = base.pathname.replace(/\/+$/, "") || "/";
  let link: URL;
  if (path === "/welcome") {
    link = new URL(base.toString());
  } else {
    link = new URL("/welcome", base.origin);
    // A bare site address (no redirect asked for) or a password page: the sign-up's own next step.
    link.searchParams.set("next", path === "/" || path === "/reset-password" ? "/onboarding" : `${path}${base.search}`);
  }
  link.hash = "";
  link.searchParams.set("token_hash", hash);
  link.searchParams.set("type", "signup");
  return link.toString();
}

async function sendViaResend(email: OutgoingEmail): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: SENDER_EMAIL,
      to: [email.to],
      reply_to: EM.contact,
      subject: email.subject,
      html: email.html,
      text: email.text,
    }),
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

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

// ---- Untrusted values ----

// The first name is the one part of these e-mails a stranger writes: with
// "Confirm email" ON, anyone can sign up with someone else's address and pick
// the name the greeting will carry, sent from our domain. So it is kept to what
// a name looks like — one line, at most 60 characters, letters and the
// punctuation names use. Anything else (a URL, an address, digits, markup) drops
// the name and the plain greeting is used. buildEmail escapes it (emEsc) on top of that.
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

// ---- Copy (EN / FR) ----
// Plain text only: buildEmail escapes every value (emEsc), the addresses included.

type Lang = "en" | "fr";

// 1. The language chosen on the site at sign-up (AuthContext.signUp stores it
//    as user_metadata.lang), so a re-sent link reads like the first one.
// 2. Accounts that have none (every account made before that, and those made by
//    claim codes, SM26 or invitations): a lang=fr|en on the redirect URL, i.e.
//    the language of the page that asked for this e-mail ("fr", "fr-FR"…).
//    GoTrue only passes on a redirect URL it accepted, and the value is never
//    more than a choice between the two copies below.
// 3. English.
// Victor decided on 6 Oct 2026 that every platform e-mail is sent in English, auth
// e-mails included. The French copy below stays for a later change of mind: flip
// this to false to choose the language from user_metadata.lang / ?lang= again.
const ENGLISH_ONLY = true;

function pickLang(stored: unknown, redirectTarget: string): Lang {
  if (ENGLISH_ONLY) return "en";
  if (stored === "fr" || stored === "en") return stored;
  try {
    return /^fr(-|$)/i.test(new URL(redirectTarget).searchParams.get("lang") || "") ? "fr" : "en";
  } catch {
    return "en";
  }
}

interface MailCopy {
  subject: string;
  // Small capitals above the title (the refonte look).
  eyebrow: string;
  title: string;
  body: string;
  buttonText?: string;
  footer: string;
}

interface Copy {
  hello: (name: string) => string;
  signup: MailCopy;
  recovery: (anyDevice: boolean) => MailCopy;
  magiclink: MailCopy;
  invite: MailCopy;
  emailChangeNew: (newEmail: string, secure: boolean) => MailCopy;
  emailChangeCurrent: (currentEmail: string, newEmail: string) => MailCopy;
  reauthentication: MailCopy;
  actionLink: MailCopy;
  actionCode: MailCopy;
}

const COPY: Record<Lang, Copy> = {
  en: {
    hello: (name) => (name ? `Hello ${name},` : "Hello,"),
    signup: {
      subject: "Confirm your Smart Marina Connect account",
      eyebrow: "Welcome",
      title: "Welcome to Smart Marina Connect!",
      body: "Thank you for creating your account. Please confirm your email address by clicking the button below.",
      buttonText: "Confirm Email",
      footer: "If you did not create an account, you can safely ignore this email.",
    },
    recovery: (anyDevice) => ({
      subject: "Reset your Smart Marina Connect password",
      eyebrow: "Security",
      title: "Password Reset Request",
      body: "We received a request to reset your password. Click the button below to choose a new password.",
      buttonText: "Reset Password",
      footer: anyDevice
        ? "If you did not request a password reset, you can safely ignore this email. The link works on any device; if it has expired, simply request a new one."
        : "If you did not request a password reset, you can safely ignore this email. If the link has expired, simply request a new one.",
    }),
    magiclink: {
      subject: "Your Smart Marina Connect login link",
      eyebrow: "Sign in",
      title: "Login Link",
      body: "Click the button below to log in to your Smart Marina Connect account.",
      buttonText: "Log In",
      footer: "If you did not request this login link, you can safely ignore this email.",
    },
    invite: {
      subject: "You're invited to Smart Marina Connect",
      eyebrow: "Invitation",
      title: "You've Been Invited!",
      body: "You have been invited to join Smart Marina Connect, the B2B platform for the marina industry. Click the button below to accept your invitation and set up your account.",
      buttonText: "Accept Invitation",
      footer: "If you were not expecting this invitation, you can safely ignore this email.",
    },
    emailChangeNew: (newEmail, secure) => ({
      subject: "Confirm your new email address — Smart Marina Connect",
      eyebrow: "Security",
      title: "Email Change Confirmation",
      body:
        `You requested to change the email address of your Smart Marina Connect account to ${newEmail}. Please confirm this change by clicking the button below.` +
        (secure ? " A confirmation link has also been sent to your current address: the change takes effect once both links have been used." : ""),
      buttonText: "Confirm Email Change",
      footer: "If you did not request this change, you can safely ignore this email: the address will not be changed without this confirmation.",
    }),
    emailChangeCurrent: (currentEmail, newEmail) => ({
      subject: "Approve the change of your email address — Smart Marina Connect",
      eyebrow: "Security",
      title: "Email Change Confirmation",
      body: `A request was made to change the email address of your Smart Marina Connect account from ${currentEmail} to ${newEmail}. To approve it, click the button below. A confirmation link has also been sent to the new address: the change takes effect once both links have been used.`,
      buttonText: "Approve Email Change",
      footer: "If you did not request this change, do not click the button and contact support immediately.",
    }),
    reauthentication: {
      subject: "Your Smart Marina Connect verification code",
      eyebrow: "Security",
      title: "Verification Code",
      body: "Enter the code below to confirm it's you. It expires shortly and can only be used once.",
      footer: "If you did not request this code, we recommend changing your password.",
    },
    actionLink: {
      subject: "Smart Marina Connect — Action Required",
      eyebrow: "Your account",
      title: "Action Required",
      body: "Please click the button below to complete your action.",
      buttonText: "Continue",
      footer: "If you did not initiate this action, you can safely ignore this email.",
    },
    actionCode: {
      subject: "Your Smart Marina Connect verification code",
      eyebrow: "Security",
      title: "Verification Code",
      body: "Enter the code below to complete your action. It expires shortly.",
      footer: "If you did not initiate this action, you can safely ignore this email.",
    },
  },
  fr: {
    hello: (name) => (name ? `Bonjour ${name},` : "Bonjour,"),
    signup: {
      subject: "Confirmez votre compte Smart Marina Connect",
      eyebrow: "Bienvenue",
      title: "Bienvenue sur Smart Marina Connect !",
      body: "Merci d’avoir créé votre compte. Veuillez confirmer votre adresse e-mail en cliquant sur le bouton ci-dessous.",
      buttonText: "Confirmer mon adresse e-mail",
      footer: "Si vous n’avez pas créé de compte, vous pouvez ignorer cet e-mail.",
    },
    recovery: (anyDevice) => ({
      subject: "Réinitialisez votre mot de passe Smart Marina Connect",
      eyebrow: "Sécurité",
      title: "Réinitialisation du mot de passe",
      body: "Nous avons reçu une demande de réinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous pour en choisir un nouveau.",
      buttonText: "Réinitialiser mon mot de passe",
      footer: anyDevice
        ? "Si vous n’êtes pas à l’origine de cette demande, vous pouvez ignorer cet e-mail. Le lien fonctionne sur n’importe quel appareil ; s’il a expiré, demandez-en simplement un nouveau."
        : "Si vous n’êtes pas à l’origine de cette demande, vous pouvez ignorer cet e-mail. Si le lien a expiré, demandez-en simplement un nouveau.",
    }),
    magiclink: {
      subject: "Votre lien de connexion Smart Marina Connect",
      eyebrow: "Connexion",
      title: "Lien de connexion",
      body: "Cliquez sur le bouton ci-dessous pour vous connecter à votre compte Smart Marina Connect.",
      buttonText: "Me connecter",
      footer: "Si vous n’avez pas demandé ce lien de connexion, vous pouvez ignorer cet e-mail.",
    },
    invite: {
      subject: "Votre invitation à rejoindre Smart Marina Connect",
      eyebrow: "Invitation",
      title: "Vous avez reçu une invitation !",
      body: "Une invitation vous a été adressée pour rejoindre Smart Marina Connect, la plateforme B2B de l’industrie des marinas. Cliquez sur le bouton ci-dessous pour l’accepter et créer votre compte.",
      buttonText: "Accepter l’invitation",
      footer: "Si vous n’attendiez pas cette invitation, vous pouvez ignorer cet e-mail.",
    },
    emailChangeNew: (newEmail, secure) => ({
      subject: "Confirmez votre nouvelle adresse e-mail — Smart Marina Connect",
      eyebrow: "Sécurité",
      title: "Confirmation du changement d’adresse e-mail",
      body:
        `Vous avez demandé à remplacer l’adresse e-mail de votre compte Smart Marina Connect par ${newEmail}. Veuillez confirmer ce changement en cliquant sur le bouton ci-dessous.` +
        (secure ? " Un lien de confirmation a également été envoyé à votre adresse actuelle : le changement prend effet une fois les deux liens utilisés." : ""),
      buttonText: "Confirmer le changement",
      footer: "Si vous n’êtes pas à l’origine de cette demande, vous pouvez ignorer cet e-mail : l’adresse ne sera pas modifiée sans cette confirmation.",
    }),
    emailChangeCurrent: (currentEmail, newEmail) => ({
      subject: "Approuvez le changement de votre adresse e-mail — Smart Marina Connect",
      eyebrow: "Sécurité",
      title: "Confirmation du changement d’adresse e-mail",
      body: `Une demande a été faite pour remplacer l’adresse e-mail de votre compte Smart Marina Connect, ${currentEmail}, par ${newEmail}. Pour l’approuver, cliquez sur le bouton ci-dessous. Un lien de confirmation a également été envoyé à la nouvelle adresse : le changement prend effet une fois les deux liens utilisés.`,
      buttonText: "Approuver le changement",
      footer: "Si vous n’êtes pas à l’origine de cette demande, ne cliquez pas sur le bouton et contactez immédiatement le support.",
    }),
    reauthentication: {
      subject: "Votre code de vérification Smart Marina Connect",
      eyebrow: "Sécurité",
      title: "Code de vérification",
      body: "Saisissez le code ci-dessous pour confirmer votre identité. Il expire rapidement et ne peut être utilisé qu’une seule fois.",
      footer: "Si vous n’avez pas demandé ce code, nous vous recommandons de changer votre mot de passe.",
    },
    actionLink: {
      subject: "Smart Marina Connect — Action requise",
      eyebrow: "Votre compte",
      title: "Action requise",
      body: "Cliquez sur le bouton ci-dessous pour finaliser votre démarche.",
      buttonText: "Continuer",
      footer: "Si vous n’êtes pas à l’origine de cette démarche, vous pouvez ignorer cet e-mail.",
    },
    actionCode: {
      subject: "Votre code de vérification Smart Marina Connect",
      eyebrow: "Sécurité",
      title: "Code de vérification",
      body: "Saisissez le code ci-dessous pour finaliser votre démarche. Il expire rapidement.",
      footer: "Si vous n’êtes pas à l’origine de cette démarche, vous pouvez ignorer cet e-mail.",
    },
  },
};

// ---- Email template builder ----

interface EmailTemplateProps {
  lang: Lang;
  greeting: string;
  eyebrow?: string;
  title: string;
  body: string;
  buttonText?: string;
  buttonUrl?: string;
  code?: string;
  footer: string;
}

// Every interpolated value is escaped here (emEsc), so nothing a caller passes —
// copy, names, addresses, links, codes — can turn into markup. The layout itself
// is the shared SMC block above (refonte look, same frame as the Mailchimp welcome).
function buildEmail({ lang, greeting, eyebrow, title, body, buttonText, buttonUrl, code, footer }: EmailTemplateProps): string {
  const codeBlock = code ? `<p style="margin:4px 0 18px;">${emCode(emEsc(code))}</p>` : "";
  return emailLayout({
    lang,
    pageTitle: emEsc(title),
    preheader: emEsc(body),
    eyebrow: eyebrow ? emEsc(eyebrow) : undefined,
    title: emEsc(title),
    greeting: emEsc(greeting),
    bodyHtml: emP(emEsc(body)) + codeBlock,
    cta: buttonText && buttonUrl ? { label: emEsc(buttonText), url: emEsc(buttonUrl), showUrl: true } : undefined,
    footerNote: emEsc(footer),
  });
}

// Plain-text alternative of the same e-mail (link and code included).
function buildEmailText({ greeting, title, body, buttonText, buttonUrl, code, footer }: EmailTemplateProps): string {
  return emText({
    title,
    greeting,
    body: code ? `${body}\n\n${code}` : body,
    cta: buttonText && buttonUrl ? { label: buttonText, url: buttonUrl } : undefined,
    footerNote: footer,
  });
}
