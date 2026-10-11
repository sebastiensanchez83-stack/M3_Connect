// account-signup -- public helpers of the account sign-up form (spec regspec-en.md §4.4,
// §5, §7; database contract docs/registration-contract.md). Phase 2 EDGE lane, 11 Oct 2026.
//
// Sign-up itself stays the client call supabase.auth.signUp (GoTrue's per-IP limits apply
// per real visitor). This function only adds what the browser cannot do alone.
//
// verify_jwt = FALSE: anonymous visitors call it from the sign-up form. send_email_proof
// checks the caller's session itself (auth.getUser), like the registration function.
//
// Actions (POST JSON { action, ... }):
//   company_search   { q }      public. "My company is already listed": up to 8 public
//                               company cards { id, name, logo_url, city, country, type,
//                               type_label } for at least 3 letters or digits. Never an
//                               owner, a member, a status, a domain or a claim code. Archived
//                               and duplicate companies are left out by the database RPC
//                               company_search(p_q, p_limit) (normalize_org_name trigram
//                               similarity, DB lane); until that RPC exists, a plain
//                               accent-folded name match on organizations.name_search.
//                               10 searches per network per minute.
//   notify_existing  { email }  public. Called by the form when supabase.auth.signUp did not
//                               create an account (an obfuscated user with Confirm email ON,
//                               "User already registered" with it OFF). If a CONFIRMED account
//                               has this address, it gets account_already_exists (sign in /
//                               reset password). The answer is always { ok: true } and the
//                               lookup runs after it: neither tells whether the address has
//                               an account (spec §5). 1 e-mail per address per hour (3 a
//                               day), 5 calls per network per hour.
//   send_email_proof {}         signed in. The "Confirm your e-mail" banner: an account whose
//                               address is not proven (contract §2) gets /verify-email?t=<token>
//                               (24 hours; only sha256 is stored, in email_proof_token);
//                               /verify-email calls the RPC confirm_email_proof(p_token) with
//                               the session, which stamps the proof. Not a sign-in link.
//                               1 per minute and 5 per day per account.
//
// Flags (platform_settings.registration_flags; a switch is on only as JSON true):
//   company_search, notify_existing  need account_signup_v2
//   send_email_proof                 needs account_signup_v2 or front_door
// Off: company_search and send_email_proof answer 403 not_enabled; notify_existing
// answers { ok: true } and sends nothing.
//
// Rate limits: guest_signup_rate_limits (scope column of the registration core), scopes
// acct_search / acct_exists / acct_proof, hashes prefixed "acct:" so they never count the
// rows of guest-webinar-register or registration (contract §2).
//
// This file must not contain a literal backslash-u escape (the MCP deploy mangles them).
// E-mails are in English, in the SMC e-mail layout v1 (block below, checked by
// scripts/email-previews.mjs).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const SITE_URL = (Deno.env.get("SITE_URL") || "https://smartmarinaconnect.com").replace(/\/+$/, "");
// Site of the links in these e-mails. SITE_URL by default; set ACCOUNT_SITE_URL to the
// redesign preview to test before the redesign is live (the old main site has no
// /verify-email page).
const ACCOUNT_SITE = (Deno.env.get("ACCOUNT_SITE_URL") || SITE_URL).replace(/\/+$/, "");
const PLATFORM_FROM = "Smart Marina Connect <noreply@smartmarinaconnect.com>";

const SEARCH_MIN_CHARS = 3;
const SEARCH_MAX_CHARS = 80;
const SEARCH_ROWS = 8;
const SEARCH_IP_PER_MINUTE = 10;
const EXISTS_EMAIL_PER_HOUR = 1;
const EXISTS_EMAIL_PER_DAY = 3;
const EXISTS_IP_PER_HOUR = 5;
const PROOF_PER_MINUTE = 1;
const PROOF_PER_DAY = 5;
const PROOF_TTL_MS = 24 * 3600000;
const MAX_BODY_BYTES = 16 * 1024;
const MINUTE = 60000;
const HOUR = 3600000;
const DAY = 24 * HOUR;

const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });

/** Runs after the answer when the edge runtime allows it (EdgeRuntime.waitUntil), so the
 *  response time never tells whether an address has an account; else awaited. Never throws. */
function inBackground(label: string, task: () => Promise<unknown>): Promise<void> {
  const p = task().then(() => undefined, (e) => console.error(`account-signup: ${label} failed`, e instanceof Error ? e.message : e));
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

// ─── Small helpers ───────────────────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;

const clean = (s: unknown, max = 200) => (typeof s === "string" ? s.trim().slice(0, max) : "");
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 32 random bytes as base64url (43 characters): the e-mail proof token. */
function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const clientIp = (req: Request): string =>
  req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";

/** An ilike pattern that matches this text literally (escapes the backslash, % and _). */
const likeLiteral = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

/** Same folding as public.smc_fold (organizations.name_search): lower case, accents
 *  dropped (a Unicode property class, not a backslash-u range), typographic quotes and
 *  dashes made plain. */
function foldName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[‘’ʼ`´′]/g, "'")
    .replace(/[‐‑‒–—―]/g, "-")
    .toLowerCase();
}

/** Letters and digits of a query (the "at least 3 characters" rule). */
const significantLength = (s: string) => foldName(s).replace(/[^\p{L}\p{N}]+/gu, "").length;

// ─── Flags ───────────────────────────────────────────────────────────────────
type Flags = Record<string, boolean>;

async function loadFlags(): Promise<Flags> {
  const out: Flags = {};
  try {
    const { data } = await db.from("platform_settings").select("value").eq("key", "registration_flags").maybeSingle();
    for (const [k, x] of Object.entries(obj((data as Json | null)?.value))) out[k] = x === true;
  } catch (e) {
    console.error("account-signup: flags read failed", e instanceof Error ? e.message : e);
  }
  return out;
}

// ─── Callers ─────────────────────────────────────────────────────────────────
type Caller = { id: string; email: string; proven: boolean; firstName: string };

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

/** null = anonymous (no header, the anon / publishable key); "expired" = a user JWT GoTrue refuses. */
async function getCaller(req: Request): Promise<Caller | null | "expired"> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token || token === ANON_KEY) return null;
  const claims = jwtClaims(token);
  if (!claims || claims.role !== "authenticated") return null;
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) return "expired";
  const u = data.user;
  const email = (u.email || "").trim().toLowerCase();
  const { data: prof } = await db.from("profiles").select("first_name, email, email_proven_at").eq("user_id", u.id).maybeSingle();
  const p = (prof as Json | null) || null;
  // Contract §2: proven = email_proven_at set AND profiles.email = the auth e-mail.
  const proven = !!p?.email_proven_at && !!email && String(p?.email || "").trim().toLowerCase() === email;
  return { id: u.id, email, proven, firstName: clean(p?.first_name, 80) };
}

// ─── Rate limits (guest_signup_rate_limits, own scope and hash prefix) ───────
const ipHashOf = (ip: string) => sha256Hex(`acct:ip:${ip}`);
const emailHashOf = (email: string) => sha256Hex(`acct:email:${email}`);
const userHashOf = (userId: string) => sha256Hex(`acct:user:${userId}`);

async function rateCount(scope: string, column: "ip_hash" | "email_hash", hash: string, windowMs: number): Promise<number> {
  const since = new Date(Date.now() - windowMs).toISOString();
  const { count, error } = await db.from("guest_signup_rate_limits").select("id", { count: "exact", head: true })
    .eq("scope", scope).eq(column, hash).gte("created_at", since);
  if (error) {
    console.error("account-signup: rate-limit read failed", error.message);
    return 0; // fail open: a broken counter must not block real people
  }
  return count || 0;
}

async function rateRecord(scope: string, ipHash: string, emailHash: string | null) {
  const { error } = await db.from("guest_signup_rate_limits").insert({ scope, ip_hash: ipHash, email_hash: emailHash });
  if (error) console.error("account-signup: rate-limit write failed", error.message);
}

// ─── People ──────────────────────────────────────────────────────────────────
type AuthUser = { id: string; email?: string; email_confirmed_at?: string | null };

/** The auth user of this address (lower(auth.users.email)); profiles.email only finds candidates. */
async function findAuthUser(email: string): Promise<AuthUser | null> {
  const { data } = await db.from("profiles").select("user_id").ilike("email", likeLiteral(email)).limit(5);
  for (const p of (data as Json[] | null) || []) {
    if (!UUID_RE.test(String(p.user_id || ""))) continue;
    const { data: u } = await db.auth.admin.getUserById(p.user_id);
    const user = u?.user as AuthUser | undefined;
    if (user && (user.email || "").trim().toLowerCase() === email) return user;
  }
  return null;
}

// ─── Companies ───────────────────────────────────────────────────────────────
/** The public word for a company type ("partner" is shown as Service provider: partners
 *  are paying sponsors only, Victor 6 Oct 2026). */
const TYPE_LABELS: Record<string, string> = {
  marina: "Marina",
  partner: "Service provider",
  investor: "Investor",
  developer: "Developer",
  media_partner: "Media",
};
const typeLabel = (t: unknown) => TYPE_LABELS[String(t || "")] || "";

/** Public card fields only (whatever the source row carries). */
function companyCard(r: Json): Json | null {
  const id = String(r.id || "");
  const name = clean(r.name, 200);
  if (!UUID_RE.test(id) || !name) return null;
  const logo = clean(r.logo_url, 1000);
  const type = TYPE_LABELS[String(r.organization_type || "")] ? String(r.organization_type) : null;
  return {
    id,
    name,
    logo_url: /^https:\/\//.test(logo) ? logo : null,
    city: clean(r.city, 80) || null,
    country: clean(r.country, 80) || null,
    type,
    type_label: typeLabel(type),
  };
}

/** Up to 8 companies whose name matches. The DB lane's RPC company_search ranks by
 *  normalize_org_name trigram similarity and leaves out archived and duplicate companies;
 *  until it exists (or if it fails), an accent-folded substring match on name_search. */
async function searchCompanies(q: string): Promise<Json[]> {
  const { data, error } = await db.rpc("company_search", { p_q: q, p_limit: SEARCH_ROWS });
  if (!error && Array.isArray(data)) return data as Json[];
  if (error && error.code !== "PGRST202" && error.code !== "42883") {
    console.error("account-signup: company_search RPC failed, plain match used", error.code, error.message);
  }
  const folded = foldName(q).replace(/\s+/g, " ").trim();
  const { data: rows, error: e2 } = await db
    .from("organizations")
    .select("id, name, logo_url, city, country, organization_type")
    .in("access_status", ["verified", "pending"])
    .ilike("name_search", `%${likeLiteral(folded)}%`)
    // verified first ('verified' > 'pending'), then by name
    .order("access_status", { ascending: false })
    .order("name", { ascending: true })
    .limit(SEARCH_ROWS);
  if (e2) throw e2;
  return (rows as Json[] | null) || [];
}

// ─── E-mail ──────────────────────────────────────────────────────────────────
// The shared layout (refonte look, same frame as the Mailchimp welcome e-mail) is pasted
// below. Keep it identical in every function that sends an e-mail: docs/email-layout.ts,
// checked by scripts/email-previews.mjs.

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

/** account_already_exists: a sign-up was tried with the address of an existing account. */
function renderAccountAlreadyExists(firstName: string, links: { signIn: string; reset: string }): Mail {
  const greeting = `Hello ${clean(firstName, 80) || "there"},`;
  const a = "Someone, hopefully you, just tried to create a Smart Marina Connect account with this e-mail address. You already have an account, so nothing was created and nothing has changed.";
  const b = "Sign in with your password. Forgotten it, or never chose one? Choose a new one with \"Reset my password\".";
  const note = "If this was not you, you can ignore this e-mail: your account is unchanged.";
  return {
    subject: "You already have a Smart Marina Connect account",
    html: emailLayout({
      pageTitle: "You already have an account",
      preheader: h("Nothing was created: sign in with your password, or reset it."),
      eyebrow: "Your account",
      title: "You already have an account",
      greeting: h(greeting),
      bodyHtml: emP(h(a)) + emP(h(b)),
      cta: { label: "Sign in", url: h(links.signIn) },
      secondary: { label: "Reset my password", url: h(links.reset) },
      footerNote: h(note),
    }),
    text: emText({
      title: "You already have an account",
      greeting,
      body: [a, b].join("\n\n"),
      cta: { label: "Sign in", url: links.signIn },
      secondary: { label: "Reset my password", url: links.reset },
      footerNote: note,
    }),
  };
}

/** email_proof: "Confirm your e-mail address" (dashboard banner). Not a sign-in link. */
function renderEmailProof(firstName: string, email: string, url: string): Mail {
  const greeting = `Hello ${clean(firstName, 80) || "there"},`;
  const a = `Please confirm that ${email} is your e-mail address. Once it is confirmed, your account shows every event registration made with this address.`;
  const b = "Open the link in the browser where you are signed in to Smart Marina Connect.";
  const note = "The link works once and expires in 24 hours. It does not sign you in. If you did not ask for it, you can ignore this e-mail.";
  return {
    subject: "Confirm your e-mail address",
    html: emailLayout({
      pageTitle: "Confirm your e-mail address",
      preheader: h("One click to see all your registrations in your account."),
      eyebrow: "Your account",
      title: "Confirm your e-mail address",
      greeting: h(greeting),
      bodyHtml: emP(`Please confirm that ${strong(email)} is your e-mail address. Once it is confirmed, your account shows every event registration made with this address.`) + emP(h(b)),
      cta: { label: "Confirm my e-mail", url: h(url), showUrl: true },
      footerNote: h(note),
    }),
    text: emText({ title: "Confirm your e-mail address", greeting, body: [a, b].join("\n\n"), cta: { label: "Confirm my e-mail", url }, footerNote: note }),
  };
}

/** Sign-in and reset links of account_already_exists (the sign-in window of the site). */
const signInLinks = (site = ACCOUNT_SITE) => ({ signIn: `${site}/?signin=true`, reset: `${site}/?signin=true&forgot=true` });

/** Resend, with a retry on its 2-per-second limit. */
async function sendMail(to: string, mail: Mail): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.error("account-signup: RESEND_API_KEY is not set, nothing sent");
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
        console.error("account-signup: resend failed", resp.status, (await resp.text()).slice(0, 300));
        return false;
      }
      await resp.body?.cancel();
      return true;
    } catch (e) {
      console.error("account-signup: send error", e instanceof Error ? e.message : e);
      return false;
    }
  }
  return false;
}

// ─── Actions ─────────────────────────────────────────────────────────────────
async function actionCompanySearch(req: Request, body: Json, _caller: Caller | null, flags: Flags): Promise<Response> {
  if (flags.account_signup_v2 !== true) return json(req, { error: "not_enabled" }, 403);
  const q = clean(body.q, 200).replace(/\s+/g, " ").slice(0, SEARCH_MAX_CHARS);
  if (significantLength(q) < SEARCH_MIN_CHARS) return json(req, { results: [] });
  const ipHash = await ipHashOf(clientIp(req));
  const recent = await rateCount("acct_search", "ip_hash", ipHash, MINUTE);
  if (recent >= SEARCH_IP_PER_MINUTE) return json(req, { error: "rate_limited" }, 429);
  await rateRecord("acct_search", ipHash, null);
  const rows = await searchCompanies(q);
  const results: Json[] = [];
  for (const r of rows) {
    const card = companyCard(r);
    if (card && !results.some((x) => x.id === card.id)) results.push(card);
    if (results.length >= SEARCH_ROWS) break;
  }
  return json(req, { results });
}

async function actionNotifyExisting(req: Request, body: Json, _caller: Caller | null, flags: Flags): Promise<Response> {
  const email = clean(body.email, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) return json(req, { error: "invalid_email" }, 400);
  if (flags.account_signup_v2 !== true) return json(req, { ok: true });
  const ipHash = await ipHashOf(clientIp(req));
  const emailHash = await emailHashOf(email);
  const [byEmail, byEmailToday, byIp] = await Promise.all([
    rateCount("acct_exists", "email_hash", emailHash, HOUR),
    rateCount("acct_exists", "email_hash", emailHash, DAY),
    rateCount("acct_exists", "ip_hash", ipHash, HOUR),
  ]);
  await rateRecord("acct_exists", ipHash, emailHash);
  // Same answer whatever happens (spec §5): over the limit, unknown address, or sent.
  if (byEmail >= EXISTS_EMAIL_PER_HOUR || byEmailToday >= EXISTS_EMAIL_PER_DAY || byIp >= EXISTS_IP_PER_HOUR) return json(req, { ok: true });
  await inBackground("notify existing", async () => {
    const user = await findAuthUser(email);
    // Only a CONFIRMED account: GoTrue itself re-sends the confirmation of an unconfirmed
    // one, and a claim-code account waiting for its link cannot sign in yet.
    if (!user || !user.email_confirmed_at || !user.email) return;
    const { data: p } = await db.from("profiles").select("first_name").eq("user_id", user.id).maybeSingle();
    await sendMail(user.email.trim(), renderAccountAlreadyExists(String((p as Json | null)?.first_name || ""), signInLinks()));
  });
  return json(req, { ok: true });
}

// email_proof_token.token_hash = sha256 of the raw token, BYTEA like gl_access_token
// (contract §2), written through PostgREST as "\x" + hex. If the DB lane makes it a text
// column of lower-case hex instead, write `hex` alone (one line below).
const proofHashValue = (hex: string) => `\\x${hex}`;

async function actionSendEmailProof(req: Request, _body: Json, caller: Caller | null, flags: Flags): Promise<Response> {
  if (flags.account_signup_v2 !== true && flags.front_door !== true) return json(req, { error: "not_enabled" }, 403);
  if (!caller) return json(req, { error: "sign_in_required" }, 401);
  if (caller.proven) return json(req, { ok: true, already_proven: true });
  if (!EMAIL_RE.test(caller.email)) return json(req, { error: "no_email" }, 400);
  const userHash = await userHashOf(caller.id);
  const [lastMinute, lastDay] = await Promise.all([
    rateCount("acct_proof", "email_hash", userHash, MINUTE),
    rateCount("acct_proof", "email_hash", userHash, DAY),
  ]);
  if (lastMinute >= PROOF_PER_MINUTE) return json(req, { error: "rate_limited", retry_after: 60 }, 429);
  if (lastDay >= PROOF_PER_DAY) return json(req, { error: "rate_limited" }, 429);
  await rateRecord("acct_proof", await ipHashOf(clientIp(req)), userHash);

  const raw = randomToken();
  const { error } = await db.from("email_proof_token").insert({
    token_hash: proofHashValue(await sha256Hex(raw)),
    user_id: caller.id,
    email: caller.email,
    expires_at: new Date(Date.now() + PROOF_TTL_MS).toISOString(),
  });
  if (error) {
    console.error("account-signup: email_proof_token insert failed", error.code, error.message);
    return json(req, { error: "server" }, 500);
  }
  const url = `${ACCOUNT_SITE}/verify-email?t=${encodeURIComponent(raw)}`;
  const sent = await sendMail(caller.email, renderEmailProof(caller.firstName, caller.email, url));
  if (!sent) return json(req, { error: "send_failed" }, 502);
  // Never the token in the answer: it proves the inbox, so it only goes to the inbox.
  return json(req, { ok: true, sent: true });
}

// ─── Handler ─────────────────────────────────────────────────────────────────
type Handler = (req: Request, body: Json, caller: Caller | null, flags: Flags) => Promise<Response>;
const ACTIONS: Record<string, Handler> = {
  company_search: actionCompanySearch,
  notify_existing: actionNotifyExisting,
  send_email_proof: actionSendEmailProof,
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
    // Only send_email_proof acts for an account; the public actions ignore a session.
    let caller: Caller | null = null;
    if (action === "send_email_proof") {
      const who = await getCaller(req);
      if (who === "expired") return json(req, { error: "session_expired" }, 401);
      caller = who;
    }
    const flags = await loadFlags();
    return await handler(req, body, caller, flags);
  } catch (e) {
    console.error("account-signup: error in", action, e instanceof Error ? e.message : JSON.stringify(e));
    return json(req, { error: "server" }, 500);
  }
});
