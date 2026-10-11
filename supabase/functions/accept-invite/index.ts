// accept-invite -- the team invitation page /join/<token> (spec regspec-en.md §3.9, §4.5,
// §5; database contract docs/registration-contract.md). Phase 2 EDGE lane, 11 Oct 2026.
//
// verify_jwt = FALSE: the invitee usually has no account yet. Nothing here acts for a
// session: an invitee who already has an account signs in on the page and accepts with the
// RPC accept_org_invitation(p_invitation_id), as before.
//
// The link. New invitation e-mails (send-notification, team_invitation and
// team_invitation_reminder, flag account_signup_v2) link to /join/<token>, a token signed
// for the invitation row and the address it was sent to (block "SMC invite token v1"
// below, identical in send-notification). Holding it proves the invitee's inbox, so it
// can create the account AND prove the address (spec §5 (c)). Old e-mails link to
// /join/<invitation id>: the id is readable by every member of the company
// (organization_invitations RLS org_members_can_view_invitations), so it proves nothing:
// it still opens the page, and "send_link" e-mails a fresh signed link to the invited
// address.
//
// Actions (POST JSON { action, token, ... }); token = the path segment after /join/:
//   preview    { token }   the page. 200 { ok, kind: "token"|"legacy", state:
//                          "open"|"expired"|"accepted"|"closed", invitation_id, organization:
//                          { name, logo_url, type, type_label, verified }, email (full for a
//                          signed token, masked for a legacy id), expires_at, and for a
//                          signed token first_name, last_name, account_exists }.
//                          404 invalid_link.
//   accept     { token, first_name, last_name, password, job_title?, email? }
//                          signed token only (a legacy id: 400 legacy_link). Checks: the
//                          invitation is pending, not expired, its address is the one the
//                          token was signed for (and equals `email` when given), the company
//                          is not suspended or rejected; password at least 10 characters
//                          (at most 72 bytes). Then:
//                            the address has an account -> 200 { sign_in_required: true,
//                              invitation_id, email } (nothing written);
//                            no account -> the invitation becomes 'accepted', the account
//                              is created CONFIRMED with that password, the profile gets the
//                              names, job title, persona of the company type and
//                              signup_source 'invitation'; collaborator of the company; the
//                              person is verified ONLY if M3 verified the company, else
//                              pending with it (onboarding 'submitted'), like
//                              accept_org_invitation; the address is proven
//                              (on_email_proven: the person chose a new password from the
//                              e-mailed link, contract §4); a review_log row (subject 'join',
//                              action 'invitation_accepted') is the FYI of the M3 queue's
//                              Team joins. 200 { ok: true, email, verified, organization_name }:
//                              the page then signs in with that e-mail and password.
//                          4xx: invalid_link, legacy_link, expired, accepted, closed,
//                          email_mismatch, missing_fields (+ fields), weak_password,
//                          password_too_long, rate_limited.
//   send_link  { token }   legacy id only, flag account_signup_v2: e-mails a fresh signed
//                          link to the invited address. 200 { ok: true, email (masked) };
//                          409 expired / accepted / closed; 403 not_enabled. 1 per invitation
//                          per 10 minutes, 3 per day; 10 per network per hour.
//
// Rate limits: guest_signup_rate_limits (scope column of the registration core), scopes
// invite_preview / invite_accept / invite_link, hashes prefixed "invite:".
//
// This file must not contain a literal backslash-u escape (the MCP deploy mangles them).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const SITE_URL = (Deno.env.get("SITE_URL") || "https://smartmarinaconnect.com").replace(/\/+$/, "");
// Site of the link in the "send_link" e-mail. SITE_URL by default; ACCOUNT_SITE_URL points
// it at the redesign preview for tests before the redesign is live.
const ACCOUNT_SITE = (Deno.env.get("ACCOUNT_SITE_URL") || SITE_URL).replace(/\/+$/, "");
const PLATFORM_FROM = "Smart Marina Connect <noreply@smartmarinaconnect.com>";

const PASSWORD_MIN_CHARS = 10;
const PASSWORD_MAX_BYTES = 72; // bcrypt (GoTrue) ignores anything longer
const TOKEN_MAX_AGE_S = 60 * 86400; // invitations last 30 days; a reminder extends them
const PREVIEW_IP_PER_HOUR = 60;
const ACCEPT_IP_PER_HOUR = 20;
const LINK_IP_PER_HOUR = 10;
const LINK_PER_INVITATION_10_MIN = 1;
const LINK_PER_INVITATION_DAY = 3;
const MAX_BODY_BYTES = 16 * 1024;
const HOUR = 3600000;

const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });

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
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", ...cors(req) } });

class HttpError extends Error {
  status: number;
  code: string;
  extra: Record<string, unknown>;
  constructor(status: number, code: string, extra: Record<string, unknown> = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

// ─── Small helpers ───────────────────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;

const clean = (s: unknown, max = 200) => (typeof s === "string" ? s.trim().slice(0, max) : "");
/** A name: one line, no control characters, capped. */
const oneLine = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim().slice(0, max).trim() : "");
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const likeLiteral = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function maskEmail(e: string): string {
  const at = e.indexOf("@");
  if (at < 1) return "***";
  return `${e.slice(0, 1)}***${e.slice(at)}`;
}

const clientIp = (req: Request): string =>
  req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";

/** "10 November 2026" (Monaco time). */
function fmtDay(iso: unknown): string {
  const d = new Date(String(iso || ""));
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Monaco" });
}

// ─── Flags ───────────────────────────────────────────────────────────────────
async function flagOn(key: string): Promise<boolean> {
  try {
    const { data } = await db.from("platform_settings").select("value").eq("key", "registration_flags").maybeSingle();
    return obj((data as Json | null)?.value)[key] === true;
  } catch (e) {
    console.error("accept-invite: flags read failed", e instanceof Error ? e.message : e);
    return false;
  }
}

// ─── Rate limits (guest_signup_rate_limits, own scope and hash prefix) ───────
const ipHashOf = (ip: string) => sha256Hex(`invite:ip:${ip}`);
const invitationHashOf = (id: string) => sha256Hex(`invite:row:${id.toLowerCase()}`);

async function rateCount(scope: string, column: "ip_hash" | "email_hash", hash: string, windowMs: number): Promise<number> {
  const since = new Date(Date.now() - windowMs).toISOString();
  const { count, error } = await db.from("guest_signup_rate_limits").select("id", { count: "exact", head: true })
    .eq("scope", scope).eq(column, hash).gte("created_at", since);
  if (error) {
    console.error("accept-invite: rate-limit read failed", error.message);
    return 0; // fail open: a broken counter must not block real people
  }
  return count || 0;
}

async function rateRecord(scope: string, ipHash: string, otherHash: string | null) {
  const { error } = await db.from("guest_signup_rate_limits").insert({ scope, ip_hash: ipHash, email_hash: otherHash });
  if (error) console.error("accept-invite: rate-limit write failed", error.message);
}

/** Counts and records one call of `scope` from this network; throws 429 over `perHour`. */
async function ipLimit(req: Request, scope: string, perHour: number): Promise<string> {
  const ipHash = await ipHashOf(clientIp(req));
  const n = await rateCount(scope, "ip_hash", ipHash, HOUR);
  if (n >= perHour) throw new HttpError(429, "rate_limited");
  await rateRecord(scope, ipHash, null);
  return ipHash;
}

// ---- SMC invite token v1 (keep identical in send-notification and accept-invite) ----
// The secret of a team invitation link /join/<token>:
//   token = base64url(16-byte invitation id + 4-byte issue time, unix seconds, big-endian)
//           + "." + base64url(first 16 bytes of HMAC-SHA-256(key, message)),
//   message = "<invitation id>|<organization id>|<invitee e-mail, lower case>|<issue time>",
//   key = SHA-256("smc-invite-v1:" + service-role key): no extra secret to set.
// The address is bound but not readable in the link: an invitation whose address or
// company changed no longer opens. A new service-role key voids the links already sent
// (the page then offers a fresh link by e-mail). Signed by send-notification, checked by
// accept-invite; scripts/email-previews.mjs checks that both copies are identical.
const INVITE_KEY_PREFIX = "smc-invite-v1:";
let inviteKeyCache: { secret: string; key: Promise<CryptoKey> } | null = null;

function inviteKey(secret: string): Promise<CryptoKey> {
  if (!inviteKeyCache || inviteKeyCache.secret !== secret) {
    const key = crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(INVITE_KEY_PREFIX + secret))
      .then((raw) => crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]));
    inviteKeyCache = { secret, key };
  }
  return inviteKeyCache.key;
}

function inviteB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function inviteUnB64(s: string): Uint8Array | null {
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

async function inviteMac(secret: string, invitationId: string, organizationId: string, email: string, issuedAt: number): Promise<Uint8Array> {
  const message = `${invitationId.toLowerCase()}|${organizationId.toLowerCase()}|${email.trim().toLowerCase()}|${issuedAt}`;
  const sig = await crypto.subtle.sign("HMAC", await inviteKey(secret), new TextEncoder().encode(message));
  return new Uint8Array(sig).slice(0, 16);
}

/** The link token of one invitation row (its id, its company and the address it is sent to). */
async function signInviteToken(secret: string, invitationId: string, organizationId: string, email: string, issuedAt = Math.floor(Date.now() / 1000)): Promise<string> {
  const hex = invitationId.replace(/-/g, "").toLowerCase();
  if (!secret || !/^[0-9a-f]{32}$/.test(hex)) throw new Error("invite token: missing key or bad invitation id");
  const head = new Uint8Array(20);
  for (let i = 0; i < 16; i++) head[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  new DataView(head.buffer).setUint32(16, issuedAt >>> 0);
  return `${inviteB64(head)}.${inviteB64(await inviteMac(secret, invitationId, organizationId, email, issuedAt))}`;
}

/** The invitation id and issue time a token names, or null when it is malformed. NOT checked yet: see inviteTokenValid. */
function readInviteToken(token: unknown): { invitationId: string; issuedAt: number; mac: Uint8Array } | null {
  if (typeof token !== "string" || token.length > 120) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const head = inviteUnB64(parts[0]);
  const mac = inviteUnB64(parts[1]);
  if (!head || head.length !== 20 || !mac || mac.length !== 16) return null;
  const hex = Array.from(head.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
  const invitationId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return { invitationId, issuedAt: new DataView(head.buffer, head.byteOffset).getUint32(16), mac };
}

/** true when the token was signed with the current key for this invitation row as it is now. */
async function inviteTokenValid(secret: string, t: { invitationId: string; issuedAt: number; mac: Uint8Array }, organizationId: string, email: string): Promise<boolean> {
  if (!secret || !t || !(t.mac instanceof Uint8Array)) return false;
  const want = await inviteMac(secret, t.invitationId, organizationId, email, t.issuedAt);
  let diff = want.length ^ t.mac.length;
  for (let i = 0; i < want.length && i < t.mac.length; i++) diff |= want[i] ^ t.mac[i];
  return diff === 0;
}
// ---- end SMC invite token ----

// ─── Invitations ─────────────────────────────────────────────────────────────
type Inv = {
  id: string;
  organization_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  status: string;
  expires_at: string;
  invited_by_user_id: string | null;
};
type Org = { id: string; name: string; logo_url: string | null; organization_type: string | null; access_status: string | null };
type Link = { kind: "token" | "legacy"; inv: Inv; org: Org };

const TYPE_LABELS: Record<string, string> = {
  marina: "Marina",
  partner: "Service provider",
  investor: "Investor",
  developer: "Developer",
  media_partner: "Media",
};
const PERSONAS = new Set(["marina", "partner", "media_partner", "developer", "investor"]);

async function loadInvitation(id: string): Promise<Inv | null> {
  const { data, error } = await db
    .from("organization_invitations")
    .select("id, organization_id, email, first_name, last_name, status, expires_at, invited_by_user_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as Inv | null) || null;
}

async function loadOrg(id: string): Promise<Org | null> {
  const { data, error } = await db.from("organizations").select("id, name, logo_url, organization_type, access_status").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as Org | null) || null;
}

/** The invitation a /join/ segment names: a signed token (checked against the row as it is
 *  now), or a legacy invitation id. null = no such invitation, or a token that does not match. */
async function resolveLink(raw: unknown): Promise<Link | null> {
  const token = typeof raw === "string" ? raw.trim() : "";
  if (!token) return null;
  let kind: Link["kind"];
  let inv: Inv | null;
  if (UUID_RE.test(token)) {
    kind = "legacy";
    inv = await loadInvitation(token.toLowerCase());
  } else {
    const t = readInviteToken(token);
    if (!t) return null;
    const now = Math.floor(Date.now() / 1000);
    if (t.issuedAt > now + 300 || now - t.issuedAt > TOKEN_MAX_AGE_S) return null;
    kind = "token";
    inv = await loadInvitation(t.invitationId);
    if (!inv || !(await inviteTokenValid(SERVICE_ROLE, t, inv.organization_id, inv.email))) return null;
  }
  if (!inv) return null;
  const org = await loadOrg(inv.organization_id);
  if (!org) return null;
  return { kind, inv, org };
}

/** open = can be accepted now. A join request (join_requested, claim_requested) is not an
 *  invitation; a suspended or rejected company takes nobody in. */
function stateOf(l: Link): "open" | "expired" | "accepted" | "closed" {
  const st = String(l.inv.status || "");
  if (st === "accepted") return "accepted";
  if (st === "expired") return "expired";
  if (st !== "pending") return "closed";
  if (["suspended", "rejected"].includes(String(l.org.access_status || ""))) return "closed";
  const exp = new Date(l.inv.expires_at).getTime();
  return !isNaN(exp) && exp > Date.now() ? "open" : "expired";
}

type AuthUser = { id: string; email?: string };

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

/** team_invitation_link: a fresh signed link, asked for from an older invitation e-mail
 *  (/join/<id>). The company is named in the subject only when M3 verified it (as in
 *  send-notification). */
function renderInviteLink(firstName: string, orgName: string, orgVerified: boolean, url: string, expiresOn: string): Mail {
  const greeting = `Hello ${clean(firstName, 80) || "there"},`;
  const org = oneLine(orgName, orgVerified ? 120 : 80) || "your team";
  const a = `Here is a new link to your invitation to join ${org} on Smart Marina Connect, the B2B platform for the marina industry.`;
  const b = "Open it to choose your password: you will be linked to the team straight away.";
  const c = expiresOn ? `This invitation expires on ${expiresOn}.` : "";
  const note = "You asked for this link from an older invitation e-mail. If you did not, you can ignore this e-mail.";
  return {
    subject: orgVerified ? `Your invitation to join ${org} on Smart Marina Connect` : "Your invitation to join a team on Smart Marina Connect",
    html: emailLayout({
      pageTitle: "Your invitation link",
      preheader: h("Choose your password and join your team."),
      eyebrow: "Your team",
      title: "Your invitation link",
      greeting: h(greeting),
      bodyHtml: emP(`Here is a new link to your invitation to join ${strong(org)} on Smart Marina Connect, the B2B platform for the marina industry.`) +
        emP(h(b)) + (c ? emP(h(c)) : ""),
      cta: { label: "Accept the invitation", url: h(url), showUrl: true },
      footerNote: h(note),
    }),
    text: emText({ title: "Your invitation link", greeting, body: [a, b, c].filter(Boolean).join("\n\n"), cta: { label: "Accept the invitation", url }, footerNote: note }),
  };
}

/** Resend, with a retry on its 2-per-second limit. */
async function sendMail(to: string, mail: Mail): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.error("accept-invite: RESEND_API_KEY is not set, nothing sent");
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
        console.error("accept-invite: resend failed", resp.status, (await resp.text()).slice(0, 300));
        return false;
      }
      await resp.body?.cancel();
      return true;
    } catch (e) {
      console.error("accept-invite: send error", e instanceof Error ? e.message : e);
      return false;
    }
  }
  return false;
}

// ─── Actions ─────────────────────────────────────────────────────────────────
function orgCard(org: Org): Json {
  const type = TYPE_LABELS[String(org.organization_type || "")] ? String(org.organization_type) : null;
  const logo = clean(org.logo_url, 1000);
  const verified = org.access_status === "verified";
  return {
    name: oneLine(org.name, verified ? 120 : 80),
    logo_url: /^https:\/\//.test(logo) ? logo : null,
    type,
    type_label: type ? TYPE_LABELS[type] : "",
    verified,
  };
}

async function actionPreview(req: Request, body: Json): Promise<Response> {
  await ipLimit(req, "invite_preview", PREVIEW_IP_PER_HOUR);
  const link = await resolveLink(body.token);
  if (!link) return json(req, { error: "invalid_link" }, 404);
  const { kind, inv, org } = link;
  const state = stateOf(link);
  const email = inv.email.trim().toLowerCase();
  const out: Json = {
    ok: true,
    kind,
    state,
    invitation_id: inv.id,
    organization: orgCard(org),
    expires_at: inv.expires_at,
  };
  if (kind === "token") {
    // The token holder read the invitee's inbox: the address and the names are theirs.
    out.email = email;
    out.first_name = oneLine(inv.first_name, 80);
    out.last_name = oneLine(inv.last_name, 80);
    out.account_exists = state === "open" ? !!(await findAuthUser(email)) : null;
  } else {
    out.email = maskEmail(email);
  }
  return json(req, out);
}

async function actionAccept(req: Request, body: Json): Promise<Response> {
  await ipLimit(req, "invite_accept", ACCEPT_IP_PER_HOUR);
  const link = await resolveLink(body.token);
  if (!link) return json(req, { error: "invalid_link" }, 404);
  if (link.kind === "legacy") return json(req, { error: "legacy_link" }, 400);
  const { inv, org } = link;
  const state = stateOf(link);
  if (state !== "open") return json(req, { error: state }, 409);
  const email = inv.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return json(req, { error: "invalid_link" }, 404);
  const given = clean(body.email, 254).toLowerCase();
  if (given && given !== email) return json(req, { error: "email_mismatch" }, 400);

  const firstName = oneLine(body.first_name, 80);
  const lastName = oneLine(body.last_name, 80);
  const jobTitle = oneLine(body.job_title, 160);
  const missing = [!firstName && "first_name", !lastName && "last_name"].filter(Boolean);
  if (missing.length) return json(req, { error: "missing_fields", fields: missing }, 400);
  const password = typeof body.password === "string" ? body.password : "";
  if ([...password].length < PASSWORD_MIN_CHARS) return json(req, { error: "weak_password" }, 400);
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) return json(req, { error: "password_too_long" }, 400);

  // An account already has this address: its owner signs in and accepts with the RPC.
  if (await findAuthUser(email)) return json(req, { sign_in_required: true, invitation_id: inv.id, email });

  // Claim the invitation first (a second click, or the owner cancelling at the same time,
  // finds it no longer pending), then create the account; undo the claim if that fails.
  const nowIso = new Date().toISOString();
  const { data: claimed, error: claimErr } = await db
    .from("organization_invitations")
    .update({ status: "accepted" })
    .eq("id", inv.id)
    .eq("status", "pending")
    .gt("expires_at", nowIso)
    .select("id")
    .maybeSingle();
  if (claimErr) throw claimErr;
  if (!claimed) {
    const again = await loadInvitation(inv.id);
    return json(req, { error: again ? stateOf({ ...link, inv: again }) : "closed" }, 409);
  }
  const unclaim = async () => {
    const { error } = await db.from("organization_invitations").update({ status: "pending" }).eq("id", inv.id).eq("status", "accepted");
    if (error) console.error("accept-invite: could not reopen the invitation", inv.id, error.message);
  };

  const orgVerified = org.access_status === "verified";
  const persona = PERSONAS.has(String(org.organization_type || "")) ? String(org.organization_type) : "individual";
  // CONFIRMED, with the invitee's own password: the signed link reached this inbox.
  const { data: created, error: createErr } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { first_name: firstName, last_name: lastName, job_title: jobTitle, persona, signup_source: "invitation", lang: "en" },
  });
  if (createErr || !created?.user) {
    await unclaim();
    const code = (createErr as { code?: string } | null)?.code || "";
    const msg = (createErr?.message || "").toLowerCase();
    if (code === "email_exists" || msg.includes("already")) return json(req, { sign_in_required: true, invitation_id: inv.id, email });
    if (code === "weak_password" || msg.includes("password")) return json(req, { error: "weak_password" }, 400);
    throw new Error(`createUser: ${createErr?.message || "no user"}`);
  }
  const uid = created.user.id;

  // Collaborator of the company (accept_org_invitation's rule).
  const { error: memErr } = await db.from("organization_members").insert({ organization_id: inv.organization_id, user_id: uid, role: "collaborator" });
  if (memErr && memErr.code !== "23505") {
    // The account exists with the person's password: reopen the invitation so that,
    // signed in, they can still accept it with the RPC.
    await unclaim();
    console.error("accept-invite: membership failed", inv.id, memErr.message);
    return json(req, { error: "server", sign_in_required: true, invitation_id: inv.id, email }, 500);
  }

  // The profile (handle_new_user made it). Verified ONLY if M3 verified the company
  // (spec §0, the decided exception); otherwise pending with it, as accept_org_invitation.
  const patch: Json = {
    first_name: firstName,
    last_name: lastName,
    job_title: jobTitle || null,
    persona,
    signup_source: "invitation",
    onboarding_status: orgVerified ? "completed" : "submitted",
  };
  if (orgVerified) patch.access_status = "verified";
  let { error: profErr } = await db.from("profiles").update(patch).eq("user_id", uid);
  if (profErr && (profErr.code === "PGRST204" || profErr.code === "42703")) {
    // profiles.signup_source comes with the registration core migration: without it, the rest.
    delete patch.signup_source;
    ({ error: profErr } = await db.from("profiles").update(patch).eq("user_id", uid));
  }
  if (profErr) console.error("accept-invite: profile update failed", uid, profErr.message);

  // Proof (spec §5 (c), contract §4): the person chose a new password from the e-mailed
  // signed link. on_email_proven stamps it, attaches the registrations of the address and
  // runs complete_signup_for (nothing to do: no signup_intent).
  let proven = false;
  const { error: proofErr } = await db.rpc("on_email_proven", { p_user_id: uid });
  if (proofErr) console.error("accept-invite: on_email_proven failed", uid, proofErr.code, proofErr.message);
  else proven = true;

  // FYI for the M3 queue (Team joins).
  const { error: logErr } = await db.from("review_log").insert({
    subject_type: "join",
    subject_id: inv.id,
    action: "invitation_accepted",
    details: {
      organization_id: inv.organization_id,
      user_id: uid,
      org_verified: orgVerified,
      person_status: orgVerified ? "verified" : "pending",
      invited_by: inv.invited_by_user_id,
      account: "created",
      proven,
      via: "accept-invite",
    },
    actor_id: uid,
  });
  if (logErr) console.error("accept-invite: review_log failed", logErr.message);

  return json(req, { ok: true, email, verified: orgVerified, organization_name: orgCard(org).name });
}

async function actionSendLink(req: Request, body: Json): Promise<Response> {
  if (!(await flagOn("account_signup_v2"))) return json(req, { error: "not_enabled" }, 403);
  const ipHash = await ipLimit(req, "invite_link", LINK_IP_PER_HOUR);
  const link = await resolveLink(body.token);
  if (!link) return json(req, { error: "invalid_link" }, 404);
  if (link.kind !== "legacy") return json(req, { error: "bad_input" }, 400);
  const state = stateOf(link);
  if (state !== "open") return json(req, { error: state }, 409);
  const { inv, org } = link;
  const email = inv.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return json(req, { error: "invalid_link" }, 404);
  const rowHash = await invitationHashOf(inv.id);
  const [recent, today] = await Promise.all([
    rateCount("invite_link", "email_hash", rowHash, 10 * 60000),
    rateCount("invite_link", "email_hash", rowHash, 24 * HOUR),
  ]);
  if (recent >= LINK_PER_INVITATION_10_MIN || today >= LINK_PER_INVITATION_DAY) return json(req, { error: "rate_limited" }, 429);
  await rateRecord("invite_link", ipHash, rowHash);
  const token = await signInviteToken(SERVICE_ROLE, inv.id, inv.organization_id, email);
  const mail = renderInviteLink(String(inv.first_name || ""), org.name, org.access_status === "verified", `${ACCOUNT_SITE}/join/${token}`, fmtDay(inv.expires_at));
  if (!(await sendMail(email, mail))) return json(req, { error: "send_failed" }, 502);
  return json(req, { ok: true, email: maskEmail(email) });
}

// ─── Handler ─────────────────────────────────────────────────────────────────
const ACTIONS: Record<string, (req: Request, body: Json) => Promise<Response>> = {
  preview: actionPreview,
  accept: actionAccept,
  send_link: actionSendLink,
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
    return await handler(req, body);
  } catch (e) {
    if (e instanceof HttpError) return json(req, { error: e.code, ...e.extra }, e.status);
    console.error("accept-invite: error in", action, e instanceof Error ? e.message : JSON.stringify(e));
    return json(req, { error: "server" }, 500);
  }
});
