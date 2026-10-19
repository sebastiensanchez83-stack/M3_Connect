// provision-person -- turns a confirmed on-site registration into a platform account
// (spec regspec-en.md §4.3; contract docs/registration-contract.md §2 and §5 of the DB
// lane). Generalised from sm26-provision. Writes no sm_* row.
//
// Input: the outbox public.account_provision_job, queued by the database trigger
// gl_guest_queue_provisioning when a registration becomes 'confirmed' on an on-site
// event (wys26 approvals made by guest-list included). gl_decide_v2 stores the staff
// choices on the job (org_action, validate_person).
//
// Callers (verify_jwt = TRUE; the caller is checked again here):
//   service role (registration-cron, every minute)  {action:"run"}
//       jobs (queued or failed, attempts < 5) for up to 30 s, then up to 50 due account
//       e-mails until 45 s (the rest on the next run; an e-mail that failed 5 times is
//       given up: email_due_at cleared, last_error "e-mail: gave up ..."). A queued job
//       left at 5 attempts (a run that kept crashing) is marked failed once it has shown
//       no result for 10 minutes (see capStalledJobs). Only while flag
//       registration_flags.provisioning is on. {force:true} from registration-cron's manual
//       run skips that check, but then needs job_ids and takes only jobs of hidden (test)
//       events, as staff do: a canary test never provisions the real queue. With job_ids
//       (flag on or off) the run is limited to those jobs and their e-mails.
//   verified staff JWT  {action:"run", job_ids:[...]}         those jobs now (whatever
//                                                             their attempts; a 'done'
//                                                             job left 'pending_link'
//                                                             runs again)
//                       {action:"send_emails", job_ids:[...]} their account e-mails now,
//                                                             whatever the due date (also
//                                                             one the run gave up on)
//       With the flag off, staff may only run jobs of hidden (test) events.
//
// One job, idempotent (a job is claimed by bumping attempts; a retry finds its own work):
//   1. The registration is gone or no longer confirmed -> status 'skipped'.
//   2. The row is already linked to an account (signed-in registration, attach):
//        PROVEN for THIS row's address (the account's auth e-mail = gl_guest.email,
//        and the account proved it) -> 'linked'; verify a pending person if
//        validate_person; org_action.
//        otherwise -> 'pending_link': nothing applied (review_log says what was not).
//          Same address, not proven yet: the proof re-queues the job (on_email_proven),
//          or a staff run of it once the address is proven applies it.
//          Another address (a status link forwarded and attached to someone else's
//          account): never applied automatically, staff decide by hand.
//   3. An account has the address (lower(auth.users.email); profiles.email is only used
//      to find candidates, each checked against auth):
//        PROVEN  -> link the row ('linked'), verify a pending person if validate_person;
//                   persona and companies untouched (never promoted or demoted), except
//                   org_action for a person who has no company at all;
//        not proven -> 'pending_link', no write (after the proof, on_email_proven re-queues
//                      the job and attach_my_records links the row).
//   4. No account -> auth.admin.createUser (CONFIRMED, no e-mail sent, metadata
//      pw_pending and the job id; GoTrue gives it a random password nobody knows),
//      then the profile: verified (if validate_person), onboarding completed, persona
//      individual (or the company's type), signup_source 'provisioned', affiliation =
//      declared company, country, job title (never the phone: co-members read
//      profiles); the row is linked ('created'), then org_action.
//      Confirmed on purpose (integration review, 10 Oct 2026): while Confirm email is
//      off, a public sign-up with the address of an UNCONFIRMED account confirms that
//      account and returns a session to whoever typed it, without changing its
//      password (GoTrue signup.go). A confirmed account answers "already registered".
//   5. org_action {mode: none|link|create, org_id, type, name, website, country, as_owner}:
//        link   collaborator (owner only with as_owner when the company has no owner);
//               the owner gets an FYI e-mail ("remove if wrong");
//        create a verified company of that type, the person as owner.
//   6. Done: status 'done'. email_due_at = null unless an account was created (no
//      account e-mail for linked / pending_link / skipped). email_proven_at is never
//      written here: the address is proven by mark_email_proven, which /welcome and
//      /reset-password call once a new password is saved from the e-mailed link (no
//      auth trigger proves anything; on the old main site the account works but stays
//      unproven until the person sets a password on the redesign).
//   One review_log row per processed job (subject 'registration', action 'provisioned').
// Account e-mail (account_ready_set_password) at email_due_at: the link is generated at
// send time (auth.admin.generateLink 'recovery' for the confirmed accounts made here;
// 'invite' only for an unconfirmed one made by an older version; nothing is sent by
// GoTrue) and goes through /welcome?token_hash=…, the scanner-proof page that redeems
// it. Skipped when the person already set a password.
// The confirmation e-mail first (Victor, 15 Oct 2026, WYS): the account e-mail of a
// registration never leaves before the event's own confirmation e-mail of THAT
// confirmation is logged in gl_email_log (guest-list's QR e-mail, kind 'pass', for a
// guest_list_v1 event such as wys26; the registration function's 'reg_confirmed' for a
// core_v2 event), and not until CONFIRMATION_MAIL_GAP_MS after it, so it always arrives
// second ("about one minute later": the database makes it due about a minute after the
// confirmation and registration-cron runs the job every minute). Until then the e-mail
// waits (last_error "e-mail: waiting ..." for staff, the run moves on to the next one).
// A staff "send now" keeps the order too. For a core_v2 event it no longer waits for a
// confirmation e-mail that never came once the confirmation is CONFIRMATION_MAIL_GIVE_UP_MS
// old (a decision made without e-mail, a lost log row); for guest-list's QR e-mail (wys26)
// it never skips the wait: staff resend the entry pass first (guest-list logs it as
// 'pass'), then the account e-mail follows. A registration no longer confirmed gets no
// account e-mail from a run (staff can still send it: it then names no event). How often
// pg_cron wakes the run for e-mails that keep waiting is the database's (the wake condition
// of invoke_registration_cron).
//
// This file must not contain a literal backslash-u escape (the MCP deploy mangles them).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const SITE_URL = (Deno.env.get("SITE_URL") || "https://smartmarinaconnect.com").replace(/\/+$/, "");
const REG_SITE = (Deno.env.get("REGISTRATION_SITE_URL") || SITE_URL).replace(/\/+$/, "");
const PLATFORM_FROM = "Smart Marina Connect <noreply@smartmarinaconnect.com>";

// Jobs read per run: processed until RUN_JOBS_MS has passed (a job takes about one to two
// seconds), then the due e-mails until RUN_TOTAL_MS; the rest goes on the next run, a minute
// later. The run thus ends before pg_net's 60 s timeout and before the next run starts, and
// a bulk approval flows at about 20 to 40 accounts a minute.
const BATCH_JOBS = 60;
const RUN_JOBS_MS = 30_000;
const RUN_TOTAL_MS = 45_000;
const BATCH_EMAILS = 50;
// Due e-mails read per run: those still waiting for their confirmation e-mail are skipped
// without counting towards BATCH_EMAILS, so they never hold the others back.
const SCAN_EMAILS = 300;
const MAX_ATTEMPTS = 5;
// The account e-mail leaves at least this long after the confirmation e-mail (the QR e-mail
// of guest-list for wys26), so that it arrives second.
const CONFIRMATION_MAIL_GAP_MS = 60_000;
// A confirmation e-mail logged up to this long before the confirmation time still counts
// (clock skew between the database and the sending function).
const CONFIRMATION_MAIL_SLACK_MS = 5 * 60_000;
// Staff "send now": no longer waits for a confirmation e-mail that never came this long
// after the confirmation.
const CONFIRMATION_MAIL_GIVE_UP_MS = 10 * 60_000;
// The account e-mail mentions "your entry pass is in a separate e-mail" when it follows the
// confirmation e-mail within this time.
const PASS_NOTE_WITHIN_MS = 24 * 3600_000;
const EMAIL_WAITING = "e-mail: waiting for the confirmation e-mail (entry pass) to leave first";
// A held account e-mail is given up after this long (staff can still send it).
const HOLD_LIMIT_MS = 7 * 86400_000;

const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });

// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const clean = (s: unknown, max = 200) => (typeof s === "string" ? s.trim().slice(0, max) : "");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ORG_TYPES = new Set(["marina", "partner", "media_partner", "investor", "developer"]);
const ORG_CREATE_TYPE_ERROR = "org_action.create without a company type (marina, partner, media_partner, investor or developer)";

// ─── HTTP ────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = ["https://smartmarinaconnect.com", "https://www.smartmarinaconnect.com", "https://m3connect.netlify.app", "https://m3connectv2.netlify.app"];
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

// ─── Callers ─────────────────────────────────────────────────────────────────
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

/** The verified staff member behind a user JWT, or null. */
async function staffOf(token: string): Promise<string | null> {
  if (jwtRole(token) !== "authenticated") return null;
  const { data } = await db.auth.getUser(token);
  const uid = data?.user?.id;
  if (!uid) return null;
  const { data: p } = await db.from("profiles").select("persona, access_status").eq("user_id", uid).maybeSingle();
  const prof = p as Json | null;
  return prof && ["admin", "moderator"].includes(String(prof.persona || "")) && prof.access_status === "verified" ? uid : null;
}

async function provisioningOn(): Promise<boolean> {
  const { data } = await db.from("platform_settings").select("value").eq("key", "registration_flags").maybeSingle();
  return obj((data as Json | null)?.value).provisioning === true;
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

type Mail = { subject: string; html: string; text: string };
const h = (v: unknown) => emEsc(String(v ?? ""));
const strong = (v: unknown) => `<strong style="color:${EM.navy};">${h(v)}</strong>`;

/**
 * account_ready_set_password: the account M3 created at the confirmation of an on-site
 * registration. passNote: it follows the event's confirmation e-mail (the entry pass) of
 * the same day, and says so, so nobody looks for a QR code in it.
 */
function renderAccountReady(firstName: string, eventTitle: string, url: string, passNote = false): Mail {
  const greeting = `Hello ${clean(firstName, 80) || "there"},`;
  const a = eventTitle
    ? `M3 has confirmed your place at ${eventTitle}, and we have created your Smart Marina Connect account with this e-mail address.`
    : "M3 has created your Smart Marina Connect account with this e-mail address.";
  const pass = eventTitle && passNote ? "Your entry pass is in a separate e-mail: keep it for the day of the event." : "";
  const b = "Choose your password to finish. Your account shows your event registrations and opens the Smart Marina Connect network of marinas and maritime businesses.";
  const note = "This link works once and expires after 24 hours. If it has expired, open smartmarinaconnect.com, choose Sign in, then \"Forgot password?\" with this e-mail address.";
  return {
    subject: "Your Smart Marina Connect account is ready",
    html: emailLayout({
      pageTitle: "Your account is ready",
      preheader: h("Choose your password to finish."),
      eyebrow: "Smart Marina Connect",
      title: "Your account is ready",
      greeting: h(greeting),
      bodyHtml: emP(eventTitle
        ? `M3 has confirmed your place at ${strong(eventTitle)}, and we have created your Smart Marina Connect account with this e-mail address.`
        : h(a)) + (pass ? emP(h(pass)) : "") + emP(h(b)),
      cta: { label: "Choose my password", url: h(url), showUrl: true },
      footerNote: h(note),
    }),
    text: emText({ title: "Your account is ready", greeting, body: [a, pass, b].filter(Boolean).join("\n\n"), cta: { label: "Choose my password", url }, footerNote: note }),
  };
}

/** team_member_added_fyi: to the owner of the company M3 linked a new member to. */
function renderTeamMemberAdded(ownerFirst: string, personName: string, personEmail: string, orgName: string, eventTitle: string, site = SITE_URL): Mail {
  const greeting = `Hello ${clean(ownerFirst, 80) || "there"},`;
  const via = eventTitle ? ` after confirming their registration for ${eventTitle}` : "";
  const a = `M3 added ${personName} (${personEmail}) to ${orgName} on Smart Marina Connect${via}.`;
  const b = "If this person is not part of your team, you can remove them in your company settings.";
  const url = `${site}/account?tab=organization`;
  return {
    subject: `${personName} joined ${orgName} on Smart Marina Connect`,
    html: emailLayout({
      pageTitle: "A new member in your team",
      eyebrow: h(orgName),
      title: "A new member in your team",
      greeting: h(greeting),
      bodyHtml: emP(`M3 added ${strong(personName)} (${h(personEmail)}) to ${strong(orgName)} on Smart Marina Connect${h(via)}.`) + emP(h(b)),
      cta: { label: "Open my team", url: h(url) },
    }),
    text: emText({ title: "A new member in your team", greeting, body: [a, b].join("\n\n"), cta: { label: "Open my team", url } }),
  };
}

async function sendMail(to: string, mail: Mail): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.error("provision-person: RESEND_API_KEY is not set, nothing sent");
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
        console.error("provision-person: resend failed", resp.status, (await resp.text()).slice(0, 300));
        return false;
      }
      await resp.body?.cancel();
      return true;
    } catch (e) {
      console.error("provision-person: send error", e instanceof Error ? e.message : e);
      return false;
    }
  }
  return false;
}

// ─── People ──────────────────────────────────────────────────────────────────
type AuthUser = { id: string; email?: string; email_confirmed_at?: string | null; user_metadata?: Json };

/** The auth user of this address (lower(auth.users.email)); profiles.email only finds candidates. */
async function findAuthUser(email: string): Promise<AuthUser | null> {
  const pattern = email.replace(/[\\%_]/g, (c) => "\\" + c);
  const { data } = await db.from("profiles").select("user_id").ilike("email", pattern).limit(5);
  for (const p of (data as Json[] | null) || []) {
    const { data: u } = await db.auth.admin.getUserById(p.user_id);
    const user = u?.user as AuthUser | undefined;
    if (user && (user.email || "").trim().toLowerCase() === email) return user;
  }
  return null;
}

/** Contract §2: proven = email_proven_at set AND profiles.email = the auth e-mail. */
async function profileOf(userId: string): Promise<Json | null> {
  const { data } = await db.from("profiles").select("user_id, first_name, persona, access_status, email, email_proven_at").eq("user_id", userId).maybeSingle();
  return (data as Json | null) || null;
}
const isProven = (p: Json | null, authEmail: string) =>
  !!p?.email_proven_at && String(p?.email || "").trim().toLowerCase() === authEmail.trim().toLowerCase();

async function verifyIfPending(userId: string): Promise<boolean> {
  const { data, error } = await db.from("profiles").update({ access_status: "verified" }).eq("user_id", userId).eq("access_status", "pending").select("user_id");
  if (error) throw new Error(`profile verify: ${error.message}`);
  return ((data as Json[] | null) || []).length > 0;
}

// ─── Companies ───────────────────────────────────────────────────────────────
// Accents dropped with a Unicode property class (\p{M}), not a backslash-u range.
const slugify = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/\p{M}+/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "org";

async function applyOrgAction(job: Json, userId: string, created: boolean, eventTitle: string, personName: string, site = SITE_URL): Promise<Json> {
  const oa = obj(job.org_action);
  const mode = String(oa.mode || "none");
  if (mode === "none") return { mode };
  if (!created) {
    const { count } = await db.from("organization_members").select("id", { count: "exact", head: true }).eq("user_id", userId);
    if ((count || 0) > 0) return { mode, skipped: "has_company" };
  }
  let orgId: string;
  let orgType: string | null;
  let orgVerified: boolean;
  let role = "collaborator";
  if (mode === "link") {
    if (!UUID_RE.test(String(oa.org_id || ""))) throw new Error("org_action.link without org_id");
    const { data: org } = await db.from("organizations").select("id, name, organization_type, access_status, owner_user_id").eq("id", oa.org_id).maybeSingle();
    const o = org as Json | null;
    if (!o) throw new Error("org_action.link: company not found");
    orgId = o.id;
    orgType = o.organization_type || null;
    orgVerified = o.access_status === "verified";
    const { data: owners } = await db.from("organization_members").select("user_id").eq("organization_id", orgId).eq("role", "owner").limit(1);
    const ownerId: string | null = ((owners as Json[] | null) || [])[0]?.user_id || null;
    if (oa.as_owner === true && !ownerId && (!o.owner_user_id || o.owner_user_id === userId)) role = "owner";
    const { data: mine } = await db.from("organization_members").select("id").eq("organization_id", orgId).eq("user_id", userId).maybeSingle();
    if (!mine) {
      const { error } = await db.from("organization_members").insert({ organization_id: orgId, user_id: userId, role });
      if (error && error.code !== "23505") throw new Error(`membership: ${error.message}`);
      if (role === "owner" && !o.owner_user_id) await db.from("organizations").update({ owner_user_id: userId }).eq("id", orgId).is("owner_user_id", null);
      // FYI to the owner: "remove if wrong".
      const fyiTo = ownerId && ownerId !== userId ? ownerId : null;
      if (fyiTo) {
        const { data: ou } = await db.auth.admin.getUserById(fyiTo);
        const ownerEmail = (ou?.user?.email || "").trim();
        const op = await profileOf(fyiTo);
        if (EMAIL_RE.test(ownerEmail)) {
          await sendMail(ownerEmail, renderTeamMemberAdded(String(op?.first_name || ""), personName, String(job.email), String(o.name || "your company"), eventTitle, site));
        }
      }
    }
  } else if (mode === "create") {
    const name = clean(oa.name, 160);
    if (!name) throw new Error("org_action.create without a name");
    // A company M3 creates is VERIFIED: never untyped (spec §3.9; processJob checks it first).
    if (!ORG_TYPES.has(String(oa.type))) throw new Error(ORG_CREATE_TYPE_ERROR);
    orgType = String(oa.type);
    orgVerified = true;
    role = "owner";
    let inserted: string | null = null;
    for (let attempt = 0; attempt < 4 && !inserted; attempt++) {
      const slug = attempt === 0 ? slugify(name) : `${slugify(name)}-${Math.floor(1000 + Math.random() * 9000)}`;
      const website = clean(oa.website, 300);
      const { data: org, error } = await db.from("organizations").insert({
        name, slug, organization_type: orgType, tier: "member", access_status: "verified",
        created_by_user_id: userId, owner_user_id: userId,
        website: /^https?:\/\//i.test(website) ? website : website ? `https://${website}` : null,
        country: clean(oa.country, 80) || null,
      }).select("id").single();
      if (!error && org) inserted = (org as Json).id;
      else if (error?.code !== "23505") throw new Error(`company create: ${error?.message}`);
    }
    if (!inserted) throw new Error("company create: no free slug");
    orgId = inserted;
    const { error: memErr } = await db.from("organization_members").insert({ organization_id: orgId, user_id: userId, role: "owner" });
    if (memErr && memErr.code !== "23505") throw new Error(`owner membership: ${memErr.message}`);
  } else {
    throw new Error(`org_action: unknown mode ${mode}`);
  }
  // Display persona follows a verified, typed company (never for staff or an established persona).
  if (orgVerified && orgType) {
    const p = await profileOf(userId);
    if (p && (created || p.persona === "individual")) {
      await db.from("profiles").update({ persona: orgType }).eq("user_id", userId).eq("persona", p.persona);
    }
  }
  if (job.source_kind === "gl_guest" && job.source_id) {
    await db.from("gl_guest").update({ organization_id: orgId }).eq("id", job.source_id).is("organization_id", null);
  }
  return { mode, org_id: orgId, role };
}

// ─── One job ─────────────────────────────────────────────────────────────────
async function eventTitleOf(job: Json): Promise<{ title: string; hidden: boolean }> {
  const id = obj(job.payload).gl_event_id;
  if (!UUID_RE.test(String(id || ""))) return { title: "", hidden: false };
  const { data: ev } = await db.from("gl_event").select("title, hidden, legacy_event_id").eq("id", id).maybeSingle();
  const e = ev as Json | null;
  if (!e) return { title: "", hidden: false };
  let title = clean(e.title, 200);
  if (e.legacy_event_id) {
    const { data: cat } = await db.from("events").select("title").eq("id", e.legacy_event_id).maybeSingle();
    title = clean((cat as Json | null)?.title, 200) || title;
  }
  return { title, hidden: e.hidden === true };
}

async function finish(job: Json, patch: Json) {
  const { error } = await db.from("account_provision_job").update({ status: "done", done_at: new Date().toISOString(), last_error: null, ...patch }).eq("id", job.id);
  if (error) throw new Error(`job update: ${error.message}`);
}

async function logReview(job: Json, by: string | null, details: Json) {
  if (job.source_kind !== "gl_guest" || !job.source_id) return;
  const { error } = await db.from("review_log").insert({
    subject_type: "registration", subject_id: job.source_id, action: "provisioned",
    details: { job_id: job.id, ...details }, actor_id: by,
  });
  if (error) console.error("provision-person: review_log failed", error.message);
}

async function linkGuest(job: Json, userId: string, action: string): Promise<string> {
  if (job.source_kind !== "gl_guest" || !job.source_id) return action;
  const { error } = await db.from("gl_guest").update({ user_id: userId, account_action: action, provisioned_at: new Date().toISOString() })
    .eq("id", job.source_id).is("user_id", null);
  if (error) {
    // The account already holds another registration of this event (unique event + account).
    if (error.code === "23505") {
      await db.from("gl_guest").update({ account_action: "skipped", provisioned_at: new Date().toISOString() }).eq("id", job.source_id);
      return "skipped";
    }
    throw new Error(`link: ${error.message}`);
  }
  return action;
}

async function guestActionOf(job: Json): Promise<string | null> {
  if (job.source_kind !== "gl_guest" || !job.source_id) return null;
  const { data } = await db.from("gl_guest").select("account_action").eq("id", job.source_id).maybeSingle();
  return (data as Json | null)?.account_action || null;
}

async function setGuestAction(job: Json, action: string) {
  if (job.source_kind !== "gl_guest" || !job.source_id) return;
  const { error } = await db.from("gl_guest").update({ account_action: action, provisioned_at: new Date().toISOString() }).eq("id", job.source_id);
  if (error) throw new Error(`guest update: ${error.message}`);
}

async function processJob(job: Json, by: string | null): Promise<Json> {
  // Claim: bump attempts only if nobody else did (two runs never process one job).
  const { data: claimedRow } = await db.from("account_provision_job").update({ attempts: (job.attempts || 0) + 1 })
    .eq("id", job.id).eq("attempts", job.attempts || 0).in("status", ["queued", "failed"]).select("*").maybeSingle();
  if (!claimedRow) return { id: job.id, result: "busy" };
  const j = claimedRow as Json;
  try {
    const email = String(j.email || "").trim().toLowerCase();
    const pl = obj(j.payload);
    let guest: Json | null = null;
    if (j.source_kind === "gl_guest") {
      const { data } = await db.from("gl_guest").select("id, status, user_id, email").eq("id", j.source_id).maybeSingle();
      guest = (data as Json | null) || null;
      if (!guest || guest.status !== "confirmed") {
        await db.from("account_provision_job").update({ status: "skipped", email_due_at: null, done_at: new Date().toISOString(), last_error: null }).eq("id", j.id);
        return { id: j.id, result: "skipped" };
      }
    }
    if (!EMAIL_RE.test(email)) throw new Error("job without a valid e-mail");
    // Checked before anything is written (no account, no link): a company M3 creates is
    // verified, so it needs a type (gl_decide_v2 and gl_invite_v2 refuse it too). The job
    // fails with the reason; staff fix its org_action and run it again.
    const oa0 = obj(j.org_action);
    if (String(oa0.mode || "none") === "create" && !ORG_TYPES.has(String(oa0.type))) throw new Error(ORG_CREATE_TYPE_ERROR);
    const { title: eventTitle, hidden } = await eventTitleOf(j);
    // Links: the live site, or REGISTRATION_SITE_URL for hidden test events only.
    const site = hidden ? REG_SITE : SITE_URL;
    const personName = `${clean(pl.first_name, 80)} ${clean(pl.last_name, 80)}`.trim() || email;

    // 2. Already linked to an account.
    if (guest?.user_id) {
      const { data: u } = await db.auth.admin.getUserById(guest.user_id);
      const user = u?.user as AuthUser | undefined;
      const p = user ? await profileOf(user.id) : null;
      const accountEmail = (user?.email || "").trim().toLowerCase();
      // The account must have proved THIS registration's address (contract §5): a status
      // link forwarded to someone else and attached to their own (proven) account must
      // never get them validated by M3, or made a company member.
      const sameAddress = !!accountEmail && accountEmail === String(guest.email || "").trim().toLowerCase();
      if (!user || !sameAddress || !isProven(p, user.email || "")) {
        // M3's choices (validate the person, company action) are NOT applied.
        // 'pending_link' + review_log say so in the queue.
        //  - Same address, not proven yet (Confirm email is off): a staff run of the job
        //    after the proof applies them ({action:"run", job_ids}); the proof itself also
        //    re-queues it (on_email_proven puts the person's pending_link jobs of that
        //    address back to queued).
        //  - Another address: never applied by a run; staff decide by hand.
        await setGuestAction(j, "pending_link");
        await finish(j, { email_due_at: null });
        await logReview(j, by, {
          account_action: "pending_link", already_linked: true, proven: false, same_address: sameAddress,
          not_applied: { validate_person: !!j.validate_person, org_action: String(obj(j.org_action).mode || "none") },
        });
        return { id: j.id, result: "pending_link" };
      }
      let verified = false;
      if (j.validate_person) verified = await verifyIfPending(user.id);
      const org = await applyOrgAction(j, user.id, false, eventTitle, personName, site);
      await setGuestAction(j, "linked");
      await finish(j, { email_due_at: null });
      await logReview(j, by, { account_action: "linked", already_linked: true, proven: true, verified, org });
      return { id: j.id, result: "linked" };
    }

    // 3. An account has this address.
    let user = await findAuthUser(email);
    let created = false;
    if (user && obj(user.user_metadata).provision_job_id === j.id) created = true; // our own, from an earlier attempt
    if (user && !created) {
      const p = await profileOf(user.id);
      if (!isProven(p, user.email || "")) {
        await setGuestAction(j, "pending_link");
        await finish(j, { email_due_at: null });
        await logReview(j, by, {
          account_action: "pending_link", proven: false,
          not_applied: { validate_person: !!j.validate_person, org_action: String(obj(j.org_action).mode || "none") },
        });
        return { id: j.id, result: "pending_link" };
      }
      const action = await linkGuest(j, user.id, "linked");
      let verified = false;
      let org: Json = { mode: "none" };
      if (action === "linked") {
        if (j.validate_person) verified = await verifyIfPending(user.id);
        org = await applyOrgAction(j, user.id, false, eventTitle, personName, site);
      }
      await finish(j, { email_due_at: null });
      await logReview(j, by, { account_action: action, verified, org });
      return { id: j.id, result: action };
    }

    // 4. No account: create one (no e-mail from GoTrue). CONFIRMED, as sm26-provision
    // does: an unconfirmed account can be taken over by a public sign-up with its address
    // while Confirm email is off (GoTrue confirms it and returns a session to that caller).
    if (!user) {
      const { data: c, error } = await db.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: {
          first_name: clean(pl.first_name, 80), last_name: clean(pl.last_name, 80), job_title: clean(pl.job_title, 160),
          persona: "individual", pw_pending: true, pw_pending_reason: "provisioned", provision_job_id: j.id, lang: "en",
        },
      });
      if (error || !c?.user) {
        const msg = (error?.message || "").toLowerCase();
        if ((error as { code?: string } | null)?.code === "email_exists" || msg.includes("already")) {
          // An account we could not see through profiles: never touch it blindly.
          await setGuestAction(j, "pending_link");
          await finish(j, { email_due_at: null });
          await logReview(j, by, { account_action: "pending_link", note: "account exists, profile e-mail out of step" });
          return { id: j.id, result: "pending_link" };
        }
        throw new Error(`createUser: ${error?.message || "no user"}`);
      }
      user = c.user as AuthUser;
      created = true;
    }
    const patch: Json = {
      onboarding_status: "completed",
      signup_source: "provisioned",
      affiliation: clean(pl.company, 200) || null,
      country: clean(pl.country, 80) || null,
      // Never the phone: co-members of a company read each other's profiles, and a
      // number given to M3 for one event stays on the registration (gl_guest.phone).
      job_title: clean(pl.job_title, 160) || null,
    };
    if (j.validate_person) patch.access_status = "verified";
    const { error: profErr } = await db.from("profiles").update(patch).eq("user_id", user.id);
    if (profErr) throw new Error(`profile: ${profErr.message}`);
    const action = await linkGuest(j, user.id, "created");
    const org = await applyOrgAction(j, user.id, true, eventTitle, personName, site);
    await finish(j, {}); // email_due_at kept: the account e-mail goes at its time
    await logReview(j, by, { account_action: action, created: true, verified: !!j.validate_person, org });
    return { id: j.id, result: "created" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("provision-person: job failed", j.id, msg);
    await db.from("account_provision_job").update({ status: "failed", last_error: msg.slice(0, 500) }).eq("id", j.id);
    return { id: j.id, result: "failed", error: msg.slice(0, 200) };
  }
}

// ─── Jobs whose run never finished ──────────────────────────────────────────
// A job whose run crashed or timed out stays 'queued' with its attempts counted. One left at
// MAX_ATTEMPTS is either being processed right now (its last attempt, by a run that overlaps
// this one) or abandoned. The table has no claim time, so it is stamped first (last_error
// STALL_MARK + the time), and marked failed only if the stamp is still there STALL_MS later:
// every end of processJob writes last_error (done: null, skipped: null, failed: the error),
// so a run that finishes the job removes the stamp. Staff can still run a failed job by
// hand; it is never retried forever.
const STALL_MARK = "check: no result yet for the last attempt, seen at ";
const STALL_MS = 10 * 60_000;

async function capStalledJobs(): Promise<void> {
  const { data, error } = await db.from("account_provision_job").select("id, attempts, last_error")
    .eq("status", "queued").gte("attempts", MAX_ATTEMPTS).limit(100);
  if (error) {
    console.error("provision-person: attempts cap read failed", error.message);
    return;
  }
  for (const c of (data as Json[] | null) || []) {
    const note = typeof c.last_error === "string" ? c.last_error : null;
    const seenAt = note && note.startsWith(STALL_MARK) ? Date.parse(note.slice(STALL_MARK.length)) : NaN;
    if (!Number.isFinite(seenAt)) {
      let q = db.from("account_provision_job").update({ last_error: `${STALL_MARK}${new Date().toISOString()}` })
        .eq("id", c.id).eq("status", "queued").eq("attempts", c.attempts);
      q = note === null ? q.is("last_error", null) : q.eq("last_error", note);
      const { error: e1 } = await q;
      if (e1) console.error("provision-person: attempts cap stamp failed", c.id, e1.message);
    } else if (Date.now() - seenAt >= STALL_MS) {
      const { error: e2 } = await db.from("account_provision_job")
        .update({ status: "failed", last_error: `stopped after ${MAX_ATTEMPTS} attempts (the run never finished)` })
        .eq("id", c.id).eq("status", "queued").eq("last_error", note as string);
      if (e2) console.error("provision-person: attempts cap failed", c.id, e2.message);
    }
  }
}

// ─── Account e-mail ──────────────────────────────────────────────────────────
const EMAIL_GAVE_UP = "e-mail: gave up";
const emailAttemptsOf = (lastError: unknown) => Number(/^e-mail \(attempt ([0-9]+)\)/.exec(String(lastError || ""))?.[1] || 0);

type MailOrder =
  | { state: "ok"; confirmationMailAt: number | null }
  // strict: the event's confirmation e-mail is guest-list's QR e-mail (guest_list_v1, wys26):
  // the account e-mail never goes before it, not even on a staff "send now" (Victor, 15 Oct).
  | { state: "waiting"; giveUp: boolean; strict: boolean }
  | { state: "too_soon" }
  | { state: "not_confirmed" };

/** gl_event.engine per event, read once per request (many due e-mails share an event). */
const engineCache = new Map<string, string>();
async function engineOf(eventId: string): Promise<string> {
  const known = engineCache.get(eventId);
  if (known !== undefined) return known;
  const { data: ev, error } = await db.from("gl_event").select("engine").eq("id", eventId).maybeSingle();
  if (error) throw new Error(`event read: ${error.message}`);
  const engine = String((ev as Json | null)?.engine || "");
  engineCache.set(eventId, engine);
  return engine;
}

/**
 * Where the account e-mail of this job stands against the event's own confirmation e-mail
 * (see the header): guest-list logs its QR e-mail as 'pass' (guest_list_v1, wys26), the
 * registration function its on-site confirmation as 'reg_confirmed' (core_v2). Only a log
 * row of THIS confirmation counts: sent at or after the latest decision (decided_at: staff
 * approval) or answer (responded_at: an invitation accepted), minus a little clock slack.
 */
async function confirmationMailOf(job: Json): Promise<MailOrder> {
  if (job.source_kind !== "gl_guest" || !UUID_RE.test(String(job.source_id || ""))) return { state: "ok", confirmationMailAt: null };
  const { data: g, error } = await db.from("gl_guest").select("id, event_id, status, decided_at, responded_at").eq("id", job.source_id).maybeSingle();
  if (error) throw new Error(`registration read: ${error.message}`);
  const guest = g as Json | null;
  if (!guest) return { state: "ok", confirmationMailAt: null }; // gone: the send finds no account and stops
  if (guest.status !== "confirmed") return { state: "not_confirmed" };
  const coreV2 = (await engineOf(String(guest.event_id))) === "core_v2";
  const kind = coreV2 ? "reg_confirmed" : "pass";
  const times = [guest.decided_at, guest.responded_at].map((t) => Date.parse(String(t || ""))).filter((t) => Number.isFinite(t));
  const confirmedAt = times.length ? Math.max(...times) : Date.parse(String(job.created_at || "")) || Date.now();
  const { data: logs, error: logErr } = await db.from("gl_email_log").select("sent_at")
    .eq("guest_id", guest.id).eq("kind", kind).gte("sent_at", new Date(confirmedAt - CONFIRMATION_MAIL_SLACK_MS).toISOString())
    .order("sent_at", { ascending: false }).limit(1);
  if (logErr) throw new Error(`e-mail log read: ${logErr.message}`);
  const last = Date.parse(String(((logs as Json[] | null) || [])[0]?.sent_at || ""));
  if (!Number.isFinite(last)) return { state: "waiting", giveUp: Date.now() - confirmedAt >= CONFIRMATION_MAIL_GIVE_UP_MS, strict: !coreV2 };
  if (Date.now() - last < CONFIRMATION_MAIL_GAP_MS) return { state: "too_soon" };
  return { state: "ok", confirmationMailAt: last };
}

async function sendAccountEmail(job: Json, force: boolean): Promise<Json> {
  // The confirmation e-mail first (see the header). Checked before the claim: a waiting
  // e-mail is left exactly as it was, due, for the next run.
  let order: MailOrder;
  try {
    order = await confirmationMailOf(job);
  } catch (e) {
    console.error("provision-person: confirmation e-mail check failed", job.id, e instanceof Error ? e.message : e);
    return { id: job.id, email: "check_failed" };
  }
  // A run stops looking at an e-mail held for a week (the cron's own wake-up window):
  // email_due_at cleared, last_error says why; staff can still send it ("send now").
  const heldTooLong = !force && Date.now() - Date.parse(String(job.email_due_at || "")) > HOLD_LIMIT_MS;
  // A staff "send now" stops waiting for a confirmation e-mail that never came once the
  // confirmation is CONFIRMATION_MAIL_GIVE_UP_MS old, but never for guest-list's QR e-mail
  // (strict): staff resend the entry pass first, then this e-mail follows.
  if (order.state === "too_soon" || (order.state === "waiting" && !(force && order.giveUp && !order.strict))) {
    if (order.state === "waiting" && heldTooLong) {
      await db.from("account_provision_job").update({ email_due_at: null, last_error: `${EMAIL_GAVE_UP} waiting for the confirmation e-mail (entry pass): resend it from the event admin, then send this one` })
        .eq("id", job.id).is("email_sent_at", null);
      return { id: job.id, email: "gave_up_waiting" };
    }
    if (order.state === "waiting" && !job.last_error) {
      await db.from("account_provision_job").update({ last_error: EMAIL_WAITING }).eq("id", job.id).is("last_error", null).is("email_sent_at", null);
    }
    if (order.state === "waiting") {
      return {
        id: job.id,
        email: "waiting_for_confirmation_email",
        ...(force ? { hint: order.strict ? "Resend the entry pass first: the account e-mail never leaves before it." : "The confirmation e-mail has not left yet: try again in a few minutes." } : {}),
      };
    }
    return { id: job.id, email: "too_soon" };
  }
  if (order.state === "not_confirmed" && !force) {
    // Left due: if the registration is confirmed again within a week, it goes then.
    if (heldTooLong) {
      await db.from("account_provision_job").update({ email_due_at: null, last_error: `${EMAIL_GAVE_UP}: the registration is no longer confirmed` })
        .eq("id", job.id).is("email_sent_at", null);
    }
    return { id: job.id, email: "registration_not_confirmed" };
  }
  const now = new Date().toISOString();
  // Staff "Send account e-mails now" on an e-mail the run gave up on: due again now.
  if (force && !job.email_due_at && !job.email_sent_at && String(job.last_error || "").startsWith(EMAIL_GAVE_UP)) {
    await db.from("account_provision_job").update({ email_due_at: now }).eq("id", job.id).is("email_due_at", null).is("email_sent_at", null);
  }
  let q = db.from("account_provision_job").update({ email_sent_at: now }).eq("id", job.id).eq("status", "done").is("email_sent_at", null).not("email_due_at", "is", null);
  if (!force) q = q.lte("email_due_at", now);
  const { data: claimed } = await q.select("*").maybeSingle();
  if (!claimed) return { id: job.id, email: "busy" };
  const j = claimed as Json;
  const release = async (patch: Json) => {
    await db.from("account_provision_job").update({ email_sent_at: null, ...patch }).eq("id", j.id);
  };
  try {
    let userId: string | null = null;
    if (j.source_kind === "gl_guest") {
      const { data } = await db.from("gl_guest").select("user_id, status").eq("id", j.source_id).maybeSingle();
      userId = (data as Json | null)?.user_id || null;
    } else {
      userId = (await findAuthUser(String(j.email)))?.id || null;
    }
    if (!userId) {
      await release({ email_due_at: null });
      return { id: j.id, email: "no_account" };
    }
    const { data: u } = await db.auth.admin.getUserById(userId);
    const user = u?.user as AuthUser | undefined;
    if (!user?.email) {
      await release({ email_due_at: null });
      return { id: j.id, email: "no_account" };
    }
    if (obj(user.user_metadata).pw_pending !== true) {
      await release({ email_due_at: null }); // the person already chose a password
      return { id: j.id, email: "not_needed" };
    }
    const type = user.email_confirmed_at ? "recovery" : "invite";
    const { data: link, error } = await db.auth.admin.generateLink({ type, email: user.email } as never);
    const props = obj((link as Json | null)?.properties);
    const hashed = clean(props.hashed_token, 500);
    if (error || !hashed) throw new Error(`generateLink: ${error?.message || "no token"}`);
    const { title, hidden } = await eventTitleOf(j);
    // The live site's /welcome for real events (wys26 included); the preview only for hidden tests.
    const url = `${hidden ? REG_SITE : SITE_URL}/welcome?token_hash=${encodeURIComponent(hashed)}&type=${encodeURIComponent(clean(props.verification_type, 20) || type)}&next=${encodeURIComponent("/dashboard")}`;
    const p = await profileOf(userId);
    // A registration no longer confirmed (staff sent it anyway): the e-mail names no event.
    const confirmed = order.state !== "not_confirmed";
    const passNote = order.state === "ok" && order.confirmationMailAt !== null && Date.now() - order.confirmationMailAt < PASS_NOTE_WITHIN_MS;
    const ok = await sendMail(user.email, renderAccountReady(String(p?.first_name || obj(j.payload).first_name || ""), confirmed ? title : "", url, passNote));
    if (!ok) throw new Error("resend refused the account e-mail");
    // Sent: the count of earlier failed tries is no longer an error to show staff.
    if (String(j.last_error || "").startsWith("e-mail")) {
      await db.from("account_provision_job").update({ last_error: null }).eq("id", j.id).not("email_sent_at", "is", null);
    }
    return { id: j.id, email: "sent" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("provision-person: account e-mail failed", j.id, msg);
    // Counted in last_error; after MAX_ATTEMPTS failures the run stops trying (email_due_at
    // cleared) so one bad address never holds the batch. Staff can still send it by hand.
    const n = emailAttemptsOf(j.last_error) + 1;
    if (n >= MAX_ATTEMPTS) await release({ email_due_at: null, last_error: `${EMAIL_GAVE_UP} after ${n} attempts: ${msg}`.slice(0, 500) });
    else await release({ last_error: `e-mail (attempt ${n}): ${msg}`.slice(0, 500) });
    return { id: j.id, email: n >= MAX_ATTEMPTS ? "failed_gave_up" : "failed" };
  }
}

// ─── Handler ─────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  let body: Json = {};
  try {
    body = obj(await req.json());
  } catch { /* empty */ }
  try {
    const service = await isServiceRole(token);
    const staff = service ? null : await staffOf(token);
    if (!service && !staff) return json(req, { error: "forbidden" }, 403);
    const action = String(body.action || "run");
    const ids: string[] = (Array.isArray(body.job_ids) ? body.job_ids : []).filter((x: unknown) => typeof x === "string" && UUID_RE.test(x)).slice(0, 100);
    const flagOn = await provisioningOn();
    engineCache.clear();

    if (staff) {
      if (!ids.length) return json(req, { error: "job_ids required" }, 400);
      const { data } = await db.from("account_provision_job").select("*").in("id", ids);
      const jobs = (data as Json[] | null) || [];
      if (!flagOn) {
        // Flag off: only jobs of hidden (test) events.
        for (const j of jobs) {
          if (!(await eventTitleOf(j)).hidden) return json(req, { error: "provisioning_off" }, 409);
        }
      }
      const results: Json[] = [];
      if (action === "run") {
        for (const j of jobs) {
          if (["queued", "failed"].includes(j.status)) results.push(await processJob(j, staff));
          else if (j.status === "done" && (await guestActionOf(j)) === "pending_link") {
            // "Run again" once the person proved the address: the job goes back to the queue.
            const { data: again } = await db.from("account_provision_job").update({ status: "queued", done_at: null, last_error: null })
              .eq("id", j.id).eq("status", "done").select("*").maybeSingle();
            results.push(again ? await processJob(again as Json, staff) : { id: j.id, result: "busy" });
          } else results.push({ id: j.id, result: j.status });
        }
      } else if (action === "send_emails") {
        for (const j of jobs) results.push(await sendAccountEmail(j, true));
      } else {
        return json(req, { error: "unknown_action" }, 400);
      }
      return json(req, { ok: true, results });
    }

    // Service role (registration-cron).
    if (!flagOn && body.force !== true) return json(req, { ok: true, skipped: "flag provisioning is off" });
    // A forced run while the flag is off (registration-cron's manual run: a canary test) takes
    // only the jobs it names, and only jobs of hidden (test) events, as a staff run does: it
    // never provisions the real queue.
    if (!flagOn) {
      if (!ids.length) return json(req, { error: "job_ids required: provisioning is off" }, 400);
      const { data } = await db.from("account_provision_job").select("*").in("id", ids);
      for (const j of (data as Json[] | null) || []) {
        if (!(await eventTitleOf(j)).hidden) return json(req, { error: "provisioning_off" }, 409);
      }
    }
    const started = Date.now();
    if (!ids.length) await capStalledJobs();
    let jobsQ = db.from("account_provision_job").select("*").in("status", ["queued", "failed"]).lt("attempts", MAX_ATTEMPTS);
    if (ids.length) jobsQ = jobsQ.in("id", ids);
    const { data: jobs } = await jobsQ.order("created_at", { ascending: true }).limit(BATCH_JOBS);
    const results: Json[] = [];
    let more = false;
    for (const j of (jobs as Json[] | null) || []) {
      // Within the time budget (see RUN_JOBS_MS): the rest goes on the next run, a minute later.
      if (Date.now() - started > RUN_JOBS_MS) {
        more = true;
        break;
      }
      results.push(await processJob(j, null));
    }
    let dueQ = db.from("account_provision_job").select("*")
      .eq("status", "done").is("email_sent_at", null).not("email_due_at", "is", null).lte("email_due_at", new Date().toISOString());
    if (ids.length) dueQ = dueQ.in("id", ids);
    const { data: due } = await dueQ.order("email_due_at", { ascending: true }).limit(SCAN_EMAILS);
    const emails: Json[] = [];
    const waiting: Json[] = [];
    let tried = 0;
    for (const j of (due as Json[] | null) || []) {
      if (tried >= BATCH_EMAILS) break;
      if (Date.now() - started > RUN_TOTAL_MS) {
        more = true;
        break;
      }
      const r = await sendAccountEmail(j, false);
      // Waiting for the confirmation e-mail (or for the registration to be confirmed again):
      // nothing was attempted, the next e-mail gets the slot.
      if (["waiting_for_confirmation_email", "too_soon", "registration_not_confirmed", "check_failed"].includes(String(r.email))) waiting.push(r);
      else {
        tried++;
        emails.push(r);
      }
    }
    return json(req, { ok: true, jobs: results, emails, waiting: waiting.length, ...(more ? { more: true } : {}) });
  } catch (e) {
    console.error("provision-person: error", e instanceof Error ? e.message : JSON.stringify(e));
    return json(req, { error: "server" }, 500);
  }
});
