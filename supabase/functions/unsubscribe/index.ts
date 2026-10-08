// unsubscribe -- the "Unsubscribe" link and the List-Unsubscribe header of every
// notification e-mail (send-notification). Before this function the link opened
// /unsubscribe?email=<address>, a page that did not exist (404), and the one-click
// header pointed at that same static page, which cannot receive a POST.
//
// CONTRACT (src/pages/UnsubscribePage.tsx and send-notification are built against it)
//
//   The token (made by send-notification, checked here; the helper block below is
//   pasted byte for byte in both functions):
//     token   = base64url(payload JSON) "." base64url(HMAC-SHA-256(key, first part))
//     payload = { v: 1, u: <auth user id>, c: <notification category | "all">, iat: <unix s> }
//     key     = SHA-256("smc-unsubscribe-v1:" + SUPABASE_SERVICE_ROLE_KEY)
//   No new secret to configure. If the service-role key is ever rotated, older links
//   stop verifying: GET answers 400 { error: "invalid_token" } and the page offers
//   to sign in and use the preferences page instead. Tokens do not expire otherwise
//   (an unsubscribe link must keep working in an old e-mail).
//
//   GET ?t=<token>          -> NEVER changes anything (mail filters and link
//                              scanners open links before people do)
//     200 { ok, email (masked: "v***@gmail.com"), category, category_label,
//           category_optional, subscribed, optional: [{ key, label, subscribed }] }
//         subscribed = that category is on; for "all" or a service category: at
//         least one optional category is still on.
//     400 { error: "invalid_token" } | 404 { error: "not_found" } | 500 { error: "server" }
//     A browser navigation (Sec-Fetch-Mode: navigate, or Accept: text/html: a mail
//     client without one-click support opening the header's link) gets a 303 to
//     SITE_URL/unsubscribe?t=<token>, the page, before anything is looked up.
//
//   POST ?t=<token>, body "List-Unsubscribe=One-Click" (RFC 8058, form-encoded or
//   multipart, sent by the mailbox provider when the person clicks its own
//   "Unsubscribe" button): turns off the token's category, or every optional
//   category when the token says "all" or names a service category.
//     200 "Unsubscribed" (text) | 400 | 429 | 500
//
//   POST, JSON body from the page { t, scope: "category" | "all", resubscribe?: boolean }
//     scope "category" is only accepted for an optional category; resubscribe: true
//     turns the same categories back on ("Changed your mind? Re-subscribe").
//     200 { same shape as GET, changed: [keys] } | 400 { error: "invalid_token" |
//     "invalid" | "scope" } | 404 { error: "not_found" } | 429 { error: "rate_limited" }
//     | 500 { error: "server" }
//
// What it writes: profiles.notification_prefs, exactly like the account's
// Notifications tab (NotificationPreferencesTab.tsx): a JSON object of
// { <category>: boolean }, a missing key meaning ON, false meaning OFF. That is what
// send-notification reads (TYPE_TO_CATEGORY[type], skipped when prefs[cat] === false).
//
// Optional and service categories. send-notification has no "always sent" list of
// its own (it skips any category set to false), so the line is drawn here, from the
// preferences page: the categories it offers are optional, except
//   account   approval, rejection, organisation claim codes (the tab marks it
//             "Recommended on": the platform cannot be used without them)
//   payments  invoices, receipts, failed payments (transactional)
//   admin     staff notices and submission receipts (not on the preferences page)
// which an unsubscribe link never turns off. They stay switchable on the
// preferences page. Auth e-mails (password reset, sign-in links, invitations the
// person asked for) do not go through send-notification at all and are not
// affected. The Mailchimp newsletter has its own unsubscribe link.
//
// Abuse: the token is the only authorisation (it reaches only its own account's
// preferences). POSTs are capped at 20 per account per hour (public.email_rate_log,
// kind "unsubscribe", service role only; fails open: a missing log must not stop an
// unsubscribe). No e-mail address is ever logged.
//
// verify_jwt must be FALSE (mailbox providers and signed-out readers call it with no
// credentials). This file must not contain a literal backslash-u escape (the MCP
// deploy tool mangles them).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SITE_URL = Deno.env.get("SITE_URL") || "https://smartmarinaconnect.com";

const ALLOWED_ORIGINS = [
  "https://smartmarinaconnect.com",
  "https://www.smartmarinaconnect.com",
  "https://m3connect.netlify.app",
  "https://refonte--m3connectv2.netlify.app",
  "http://localhost:5173",
  "http://localhost:3000",
];

const MAX_BODY_BYTES = 8 * 1024;
const RATE_KIND = "unsubscribe";
const MAX_POSTS_PER_HOUR = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The titles of NotificationPreferencesTab.tsx, so the page and the e-mail speak
// the same language as the account's preferences.
const CATEGORY_LABELS: Record<string, string> = {
  b2b: "B2B connections",
  submissions: "Your submissions",
  recommendations: "Marina recommendations",
  events: "Events",
  payments: "Payments & invoices",
  team: "Team & invitations",
  account: "Account lifecycle",
  marketing: "Invitations & welcome",
  admin: "Admin notices",
};

/** Turned off by "Unsubscribe from all optional e-mails" (see the header). */
const OPTIONAL_CATEGORIES = ["b2b", "submissions", "recommendations", "events", "team", "marketing"];
const isOptional = (c: string) => OPTIONAL_CATEGORIES.includes(c);

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

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders(req) },
  });
}

function text(req: Request, status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...corsHeaders(req) },
  });
}

/** The request body as text, or null when it is larger than `max` bytes or not UTF-8. */
async function readBody(req: Request, max: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") || "0");
  if (!Number.isFinite(declared) || declared > max) return null;
  if (!req.body) return "";
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

/** "v***@gmail.com": enough for the reader to recognise the address, not enough to give it away. */
function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  const local = email.slice(0, at);
  const first = Array.from(local)[0] || "";
  return `${first}***${email.slice(at)}`;
}

// deno-lint-ignore no-explicit-any
type Db = any;

interface Account {
  email: string;
  prefs: Record<string, unknown>;
}

async function loadAccount(db: Db, userId: string): Promise<Account | null> {
  const { data: profile, error } = await db
    .from("profiles")
    .select("email, notification_prefs")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`profiles: ${error.code || ""} ${error.message || ""}`.trim());
  if (!profile) return null;
  const prefs = profile.notification_prefs && typeof profile.notification_prefs === "object" && !Array.isArray(profile.notification_prefs)
    ? (profile.notification_prefs as Record<string, unknown>)
    : {};
  let email = typeof profile.email === "string" ? profile.email : "";
  if (!email) {
    const { data: authData } = await db.auth.admin.getUserById(userId);
    email = authData?.user?.email || "";
  }
  return { email, prefs };
}

/** On unless explicitly false: the rule of the preferences tab and of send-notification. */
const isOn = (prefs: Record<string, unknown>, key: string) => prefs[key] !== false;

function state(category: string, account: Account) {
  const optional = OPTIONAL_CATEGORIES.map((key) => ({ key, label: CATEGORY_LABELS[key], subscribed: isOn(account.prefs, key) }));
  const categoryOptional = isOptional(category);
  return {
    ok: true,
    email: account.email ? maskEmail(account.email) : "",
    category,
    category_label: category === "all" ? "All optional e-mails" : CATEGORY_LABELS[category] || "Notifications",
    category_optional: categoryOptional,
    subscribed: categoryOptional ? isOn(account.prefs, category) : optional.some((o) => o.subscribed),
    optional,
  };
}

/** false when this account already made too many changes this hour. Fails open. */
async function underRateLimit(db: Db, userId: string): Promise<boolean> {
  try {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error } = await db
      .from("email_rate_log")
      .select("id", { count: "exact", head: true })
      .eq("actor_id", userId)
      .eq("kind", RATE_KIND)
      .gte("created_at", since);
    if (error) throw error;
    if ((count || 0) >= MAX_POSTS_PER_HOUR) return false;
    const { error: insErr } = await db.from("email_rate_log").insert({ actor_id: userId, kind: RATE_KIND });
    if (insErr) throw insErr;
  } catch (e) {
    console.error("unsubscribe: rate log unavailable, continuing:", (e as { message?: string })?.message || String(e));
  }
  return true;
}

/** Sets `keys` to `on` in notification_prefs, keeping every other key as it is. */
async function writePrefs(db: Db, userId: string, account: Account, keys: string[], on: boolean): Promise<string[]> {
  const next: Record<string, unknown> = { ...account.prefs };
  const changed: string[] = [];
  for (const k of keys) {
    if (isOn(account.prefs, k) !== on) changed.push(k);
    next[k] = on;
  }
  const { error } = await db.from("profiles").update({ notification_prefs: next }).eq("user_id", userId);
  if (error) throw new Error(`profiles update: ${error.code || ""} ${error.message || ""}`.trim());
  account.prefs = next;
  return changed;
}

/** RFC 8058: the body of a one-click POST, form-encoded or multipart. */
function isOneClickBody(body: string, contentType: string): boolean {
  if (contentType.includes("application/x-www-form-urlencoded")) {
    try {
      return new URLSearchParams(body).get("List-Unsubscribe") === "One-Click";
    } catch {
      return false;
    }
  }
  if (contentType.includes("multipart/form-data")) {
    return /name="?List-Unsubscribe"?[^\n]*\n\r?\n?One-Click/i.test(body.replace(/\r\n/g, "\n"));
  }
  return body.trim() === "List-Unsubscribe=One-Click";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "GET" && req.method !== "POST") return json(req, 405, { error: "method" });

  try {
    const url = new URL(req.url);
    // A mail client without one-click support opens the header's link in a browser:
    // send the person to the page (which then reads this same GET as JSON). No
    // lookup, no write.
    if (req.method === "GET") {
      const navigating = req.headers.get("sec-fetch-mode") === "navigate" || (req.headers.get("accept") || "").includes("text/html");
      if (navigating) {
        const t = (url.searchParams.get("t") || "").slice(0, 600);
        return new Response(null, {
          status: 303,
          headers: { Location: `${SITE_URL}/unsubscribe${t ? `?t=${encodeURIComponent(t)}` : ""}`, "Cache-Control": "no-store" },
        });
      }
    }
    const contentType = (req.headers.get("content-type") || "").toLowerCase();
    const isJson = req.method === "POST" && contentType.includes("application/json");

    let body: string | null = "";
    if (req.method === "POST") {
      body = await readBody(req, MAX_BODY_BYTES);
      if (body === null) return isJson ? json(req, 400, { error: "invalid" }) : text(req, 400, "Bad request");
    }

    let input: Record<string, unknown> = {};
    if (isJson) {
      try {
        const parsed = JSON.parse(body || "null");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json(req, 400, { error: "invalid" });
        input = parsed as Record<string, unknown>;
      } catch {
        return json(req, 400, { error: "invalid" });
      }
    }

    const token = (typeof input.t === "string" ? input.t : "") || url.searchParams.get("t") || "";
    const claim = await verifyUnsubToken(SUPABASE_SERVICE_ROLE_KEY, token);
    if (!claim || !UUID_RE.test(claim.userId)) {
      return req.method === "POST" && !isJson ? text(req, 400, "This link is not valid") : json(req, 400, { error: "invalid_token" });
    }
    const category = claim.category === "all" || CATEGORY_LABELS[claim.category] ? claim.category : "all";

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const account = await loadAccount(db, claim.userId);

    // ── GET: the state only. Never a write. ──
    if (req.method === "GET") {
      if (!account) return json(req, 404, { error: "not_found" });
      return json(req, 200, state(category, account));
    }

    // ── POST, one click from the mailbox provider ──
    if (!isJson) {
      if (!isOneClickBody(body || "", contentType)) return text(req, 400, "Bad request");
      // The account is gone: nothing left to send to, and the provider must not retry.
      if (!account) return text(req, 200, "Unsubscribed");
      if (!(await underRateLimit(db, claim.userId))) return text(req, 429, "Too many requests");
      const keys = isOptional(category) ? [category] : OPTIONAL_CATEGORIES;
      await writePrefs(db, claim.userId, account, keys, false);
      console.log(`unsubscribe: one-click, user ${claim.userId}, ${isOptional(category) ? category : "all optional"}`);
      return text(req, 200, "Unsubscribed");
    }

    // ── POST, from the page ──
    const scope = input.scope;
    if (scope !== "category" && scope !== "all") return json(req, 400, { error: "invalid" });
    if (scope === "category" && !isOptional(category)) return json(req, 400, { error: "scope" });
    if (input.resubscribe !== undefined && typeof input.resubscribe !== "boolean") return json(req, 400, { error: "invalid" });
    if (!account) return json(req, 404, { error: "not_found" });
    if (!(await underRateLimit(db, claim.userId))) return json(req, 429, { error: "rate_limited" });

    const on = input.resubscribe === true;
    const keys = scope === "category" ? [category] : OPTIONAL_CATEGORIES;
    const changed = await writePrefs(db, claim.userId, account, keys, on);
    console.log(`unsubscribe: page, user ${claim.userId}, ${scope === "category" ? category : "all optional"} ${on ? "on" : "off"}`);
    return json(req, 200, { ...state(category, account), changed });
  } catch (e) {
    console.error("unsubscribe: error:", (e as { message?: string })?.message || String(e));
    return json(req, 500, { error: "server" });
  }
});
