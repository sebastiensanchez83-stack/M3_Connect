// newsletter-subscribe: puts an e-mail address on the Smart Marina Connect
// Mailchimp audience, SINGLE OPT-IN (Victor, 8 Oct 2026: "Inscription directe":
// the ticked consent box is the consent). Public, no JWT (verify_jwt = false):
// the footer and home sign-up forms call it anonymously.
//
//   POST { email, consent: true, source?, website?, captcha? }
//     email     the address to subscribe (<= 254 characters)
//     consent   must be true: the form's consent box is ticked
//     source    where the form sits: footer | home | events | resources | other
//               (anything else is stored as "site"); becomes the SOURCE merge
//               field and a "site-<source>" tag in Mailchimp
//     website   honeypot: a field no person sees. Filled in => answered 200 and
//               dropped, so a robot learns nothing
//     captcha   Cloudflare Turnstile token (see "Anti-spam" below), optional
//   200 { ok: true }                 subscribed or already on the list. The same
//                                    answer either way, so the form cannot be
//                                    used to find out who is subscribed
//   400 { error: "invalid" }         bad address / no consent / address refused /
//                                    anti-spam check failed
//   429 { error: "rate_limited" }
//   500 { error: "server" }          Mailchimp or this function is not set up
//
// Single opt-in: a NEW address is created as "subscribed" at once, with the
// sign-up time and network address recorded by Mailchimp as proof of consent.
// An address that had unsubscribed (or was cleaned or archived) is subscribed
// again the same way; if Mailchimp refuses (its compliance rules can block
// re-subscribing by API), it falls back to "pending", so Mailchimp sends its
// confirmation e-mail. A "pending" address is moved to "subscribed". An address
// already subscribed keeps its status and its interests; SOURCE is filled if it
// was empty. Tags: "site-<source>" is added in every case; "smc-website" (the
// welcome trigger, see below) only when the address's interests were set here:
// new, subscribed again, or a pending address moved to subscribed.
//
// Preferences: a NEW subscription (and a re-subscription, and a pending address
// moved to subscribed) has EVERY interest of the Mailchimp group category titled
// "Email preferences" ticked (Victor: all ticked, people untick in the welcome
// e-mail's preference page). The category is looked up by title, then its
// interests, and kept in a module variable (1 hour; 5 minutes when the category
// is missing or has no interest yet, so adding the boxes in Mailchimp takes
// effect quickly). No such category, or an empty one: the address is subscribed
// without interests and the problem is logged once. If Mailchimp refuses a
// stored interest id (an interest deleted and recreated), the list is dropped
// and the call is retried once without interests. An address that is already SUBSCRIBED keeps the
// interests it has.
//
// Welcome e-mail: the tag "smc-website" is the trigger of the Mailchimp Customer
// Journey that sends it. It is added with the tag endpoint AFTER the member
// exists (a tag set in the same call that creates the member may not fire a
// "tag added" trigger). The e-mail says the person is on the list for every
// topic, so the tag is added ONLY where that is true (all interests were just
// ticked here): an address that was already subscribed, with whatever interests
// it chose, gets no welcome from typing its address in again. A member who
// already has the tag is not tagged again, so the journey runs once per contact.
//
// SMC copy (Victor, 8 Oct 2026, "Mailchimp + copie dans SMC"): once Mailchimp has
// accepted a sign-up (new, subscribed again, pending moved to subscribed, or
// already subscribed), the address is also upserted into public.newsletter_subscribers
// with the service role, for the nightly CRM pull: email (lower case), source of
// the first sign-up, first_consented_at (kept once set), last_signup_at (now),
// mailchimp_status (as seen or set: a snapshot, Mailchimp stays the source of
// truth) and the tags this call added (merged with the earlier ones). A failure
// to write the copy is logged (no address in the log) and NEVER changes the
// answer to the visitor. The table comes from the migration
// 20261008140500_newsletter_subscribers: apply it BEFORE deploying this version
// (until then the copy fails, is logged, and sign-ups still work).
//
// Anti-spam: Cloudflare Turnstile, SOFT until TURNSTILE_ENFORCE is "true" (see
// the helper below).
//
// Secrets (Supabase > Edge Functions > Secrets):
//   MAILCHIMP_API_KEY          the key, "<hex>-<datacenter>"
//   MAILCHIMP_SERVER_PREFIX    the datacenter, e.g. "us21" (defaults to the
//                              suffix of the API key)
//   MAILCHIMP_AUDIENCE_ID      the audience (list) id
//   TURNSTILE_SECRET_KEY       Cloudflare Turnstile secret (unset: no check)
//   TURNSTILE_ENFORCE          "true": a request with no token is refused
// The audience needs a text merge field with the tag SOURCE (Audience >
// Settings > Audience fields and merge tags); without it Mailchimp ignores the
// value and the "site-<source>" tag still tells where the address came from.
//
// Rate limit, like claim-code-signup: rows in guest_signup_rate_limits
// (ip_hash, created_at; RLS denies anon and authenticated), keyed by an HMAC
// of the network (IP) and of the address, never by the values themselves.
//
// Deployment notes (see the repo's Supabase deploy checklist): verify_jwt must
// be set to FALSE explicitly. This file holds no backslash-u escape on
// purpose: the MCP deploy tool doubles them.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://smartmarinaconnect.com",
  "https://www.smartmarinaconnect.com",
  "https://m3connect.netlify.app",
  "https://refonte--m3connectv2.netlify.app",
  "http://localhost:5173",
  "http://localhost:3000",
];

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const MAILCHIMP_API_KEY = Deno.env.get("MAILCHIMP_API_KEY") || "";
const MAILCHIMP_AUDIENCE_ID = Deno.env.get("MAILCHIMP_AUDIENCE_ID") || "";
const MAILCHIMP_SERVER_PREFIX =
  Deno.env.get("MAILCHIMP_SERVER_PREFIX") || MAILCHIMP_API_KEY.split("-")[1] || "";

const RATE_TABLE = "guest_signup_rate_limits";
const MAX_PER_NETWORK_PER_HOUR = 10;
const MAX_PER_ADDRESS_PER_DAY = 3;

// The SMC copy of the sign-ups (read by the CRM) and the longest the visitor
// waits for it: past that the copy is abandoned (logged) and the answer goes out.
const SUBSCRIBERS_TABLE = "newsletter_subscribers";
const SUBSCRIBERS_WRITE_TIMEOUT_MS = 4000;

const SOURCES = new Set(["footer", "home", "events", "resources", "other"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The Mailchimp group category whose interests are all ticked for a new
// subscriber (compared in lower case, trimmed), and the common tag a Customer
// Journey can trigger on.
const PREFERENCES_CATEGORY_TITLE = "email preferences";
const WELCOME_TAG = "smc-website";
const INTERESTS_TTL_MS = 3_600_000;
const INTERESTS_MISSING_TTL_MS = 300_000;

// ─── Anti-spam: Cloudflare Turnstile ─────────────────────────────────────────
// SOFT until TURNSTILE_ENFORCE is "true": a token that is present is always
// checked (present and invalid => refused), but a request with no token still
// goes through, because the pages that are live may not send one yet.
// TURNSTILE_SECRET_KEY unset => the check is skipped
// (logged once). Cloudflare unreachable, or a secret it does not accept => the
// request goes through (logged): our setup is at fault, not the visitor.
// The same helper is inlined in contact-submit and guest-list.
const TURNSTILE_SECRET = Deno.env.get("TURNSTILE_SECRET_KEY") || "";
const TURNSTILE_ENFORCE = (Deno.env.get("TURNSTILE_ENFORCE") || "").trim().toLowerCase() === "true";
const TURNSTILE_SETUP_ERRORS = new Set(["missing-input-secret", "invalid-input-secret", "bad-request", "internal-error"]);
let turnstileSkipLogged = false;

/** true: the request may go on. false: answer with the "invalid" error and say nothing more. Never throws. */
async function turnstileAllows(token: unknown, ip: string | null): Promise<boolean> {
  if (!TURNSTILE_SECRET) {
    if (!turnstileSkipLogged) {
      turnstileSkipLogged = true;
      console.warn("newsletter-subscribe: TURNSTILE_SECRET_KEY is not set, the Turnstile check is skipped");
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
      console.error("newsletter-subscribe: Turnstile siteverify could not judge the token", res.status, codes.join(","));
      return true;
    }
    // Refused by Cloudflare (expired, reused or forged token): say why in the
    // log, never in the answer.
    console.warn("newsletter-subscribe: Turnstile refused the token", codes.join(",") || "no code");
    return false;
  } catch (err) {
    console.error("newsletter-subscribe: Turnstile siteverify unreachable", err instanceof Error ? err.name : "error");
    return true;
  }
}

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function reply(req: Request, status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders(req) },
  });
}

function clientIp(req: Request): string | null {
  const ip = req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "";
  return ip || null;
}

// HMAC-SHA-256 under the service-role key: a rate-limit key that is not the IP
// or the address, and cannot be turned back into one.
async function rateKey(kind: "network" | "address", subject: string | null): Promise<string | null> {
  if (!subject || !SERVICE_ROLE_KEY) return null;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(SERVICE_ROLE_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`newsletter-subscribe:${kind}:${subject}`));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Takes one of this key's slots in the window. The row is written first and
// counted after, so concurrent calls see each other's rows. Returns true when
// the call may go on. Fails OPEN if the table cannot be used: a broken limiter
// must not stop sign-ups (Mailchimp has limits of its own).
async function takeSlot(admin: SupabaseClient, key: string | null, max: number, windowMs: number): Promise<boolean> {
  if (!key) return true;
  const { data, error } = await admin.from(RATE_TABLE).insert({ ip_hash: key }).select("id").single();
  if (error || !data) { console.error("rate limit insert failed", error?.message); return true; }
  const id = (data as { id: number }).id;
  const { count, error: countError } = await admin
    .from(RATE_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", key)
    .gte("created_at", new Date(Date.now() - windowMs).toISOString());
  if (countError) { console.error("rate limit count failed", countError.message); return true; }
  if ((count ?? 0) > max) {
    await admin.from(RATE_TABLE).delete().eq("id", id);
    return false;
  }
  // This key's rows older than a day are no longer used.
  await admin.from(RATE_TABLE).delete().eq("ip_hash", key).lt("created_at", new Date(Date.now() - 86_400_000).toISOString());
  return true;
}

// MD5 of a string, hex. Mailchimp names a list member by the MD5 of the
// lowercase address; WebCrypto has no MD5, so it is computed here (RFC 1321).
function md5(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const len = bytes.length;
  const words: number[] = [];
  for (let i = 0; i < len; i++) words[i >> 2] = (words[i >> 2] || 0) | (bytes[i] << ((i % 4) * 8));
  words[len >> 2] = (words[len >> 2] || 0) | (0x80 << ((len % 4) * 8));
  const total = (((len + 8) >> 6) + 1) * 16;
  for (let i = 0; i < total; i++) words[i] = words[i] || 0;
  words[total - 2] = (len * 8) >>> 0;
  words[total - 1] = Math.floor((len * 8) / 4294967296);

  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const K: number[] = [];
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
  const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let off = 0; off < total; off += 16) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const tmp = d;
      d = c;
      c = b;
      b = (b + rotl((a + f + K[i] + words[off + g]) | 0, S[(i >> 4) * 4 + (i % 4)])) | 0;
      a = tmp;
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
  }
  const hex = (n: number) => Array.from({ length: 4 }, (_, i) => ((n >>> (i * 8)) & 255).toString(16).padStart(2, "0")).join("");
  return hex(a0) + hex(b0) + hex(c0) + hex(d0);
}

async function mailchimp(method: string, path: string, body?: Record<string, unknown>) {
  const res = await fetch(`https://${MAILCHIMP_SERVER_PREFIX}.api.mailchimp.com/3.0${path}`, {
    method,
    headers: {
      "Authorization": `Basic ${btoa(`m3:${MAILCHIMP_API_KEY}`)}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: MailchimpJson = {};
  try { json = await res.json(); } catch { /* an empty body */ }
  return { status: res.status, json };
}

type MailchimpJson = {
  status?: number | string;
  title?: string;
  detail?: string;
  merge_fields?: { SOURCE?: string };
  categories?: { id: string; title?: string }[];
  interests?: { id: string }[];
};

// The interest ids of the "Email preferences" category, remembered between calls
// of a warm instance. Failures are not remembered (the next call tries again).
let interestsCache: { ids: string[]; at: number; ttl: number } | null = null;
let missingCategoryLogged = false;
let emptyCategoryLogged = false;

// Every interest of the category set to true, or null when there is none to set
// (no such category, or Mailchimp could not be asked): the person is then
// subscribed without interests. Never throws.
async function preferenceInterests(): Promise<Record<string, boolean> | null> {
  if (!interestsCache || Date.now() - interestsCache.at > interestsCache.ttl) {
    try {
      const base = `/lists/${encodeURIComponent(MAILCHIMP_AUDIENCE_ID)}/interest-categories`;
      const categories = await mailchimp("GET", `${base}?count=100`);
      if (categories.status !== 200) throw new Error(`interest categories ${categories.status}`);
      const category = (categories.json.categories || []).find(
        (c) => (c.title || "").trim().toLowerCase() === PREFERENCES_CATEGORY_TITLE,
      );
      if (!category) {
        if (!missingCategoryLogged) {
          missingCategoryLogged = true;
          console.error('newsletter-subscribe: no interest category titled "Email preferences" in the audience, subscribing without interests');
        }
        interestsCache = { ids: [], at: Date.now(), ttl: INTERESTS_MISSING_TTL_MS };
      } else {
        const interests = await mailchimp("GET", `${base}/${encodeURIComponent(category.id)}/interests?count=100`);
        if (interests.status !== 200) throw new Error(`interests ${interests.status}`);
        const ids = (interests.json.interests || []).map((i) => i.id);
        if (ids.length === 0 && !emptyCategoryLogged) {
          emptyCategoryLogged = true;
          console.error('newsletter-subscribe: the "Email preferences" category has no interest yet, subscribing without interests');
        }
        // An empty list is looked up again soon: the boxes may still be being added.
        interestsCache = { ids, at: Date.now(), ttl: ids.length === 0 ? INTERESTS_MISSING_TTL_MS : INTERESTS_TTL_MS };
      }
    } catch (err) {
      console.error("newsletter-subscribe: could not read the interests", err instanceof Error ? err.message : String(err));
    }
  }
  if (!interestsCache || interestsCache.ids.length === 0) return null;
  return Object.fromEntries(interestsCache.ids.map((id) => [id, true]));
}

// Adds the tags to an existing member: "site-<source>" always, the welcome
// trigger only when `welcome` is true (the person's interests were just set to
// all ticked). A failure is logged only: the person is already on the list.
// Returns the names of the tags Mailchimp accepted (none after a failure), for
// the SMC copy.
async function tagMember(member: string, source: string, welcome: boolean): Promise<string[]> {
  const names = [...(welcome ? [WELCOME_TAG] : []), `site-${source}`];
  const tagged = await mailchimp("POST", `${member}/tags`, {
    tags: names.map((name) => ({ name, status: "active" })),
  });
  if (tagged.status !== 204 && tagged.status !== 200) {
    console.error("newsletter-subscribe: tag failed", tagged.status, tagged.json.title);
    return [];
  }
  return names;
}

// Writes the SMC copy of a sign-up Mailchimp has just accepted (see "SMC copy"
// in the header). Reads the row first so that the first source, the first consent
// time and the tags already recorded are kept; if that read fails nothing is
// written (an upsert without it would reset first_consented_at). Never throws,
// never changes the visitor's answer, logs no address.
async function recordSubscriber(email: string, source: string, mailchimpStatus: string | null, tags: string[]): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set");
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const write = async () => {
      const read = await admin
        .from(SUBSCRIBERS_TABLE)
        .select("source, first_consented_at, tags")
        .eq("email", email)
        .maybeSingle();
      if (read.error) throw new Error(`read: ${read.error.message}`);
      const known = read.data as { source: string | null; first_consented_at: string | null; tags: string[] | null } | null;
      const now = new Date().toISOString();
      const saved = await admin.from(SUBSCRIBERS_TABLE).upsert({
        email,
        source: known?.source || source,
        first_consented_at: known?.first_consented_at || now,
        last_signup_at: now,
        mailchimp_status: mailchimpStatus,
        tags: Array.from(new Set([...(known?.tags ?? []), ...tags])),
        updated_at: now,
      }, { onConflict: "email" });
      if (saved.error) throw new Error(`upsert: ${saved.error.message}`);
    };
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timed out")), SUBSCRIBERS_WRITE_TIMEOUT_MS);
    });
    await Promise.race([write(), timeout]);
  } catch (err) {
    console.error("newsletter-subscribe: could not write the SMC copy of the sign-up", err instanceof Error ? err.message : String(err));
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return reply(req, 405, { error: "invalid" });

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return reply(req, 400, { error: "invalid" });
  }

  // Honeypot: a robot filled the hidden field. Say it worked, do nothing.
  if (typeof payload.website === "string" && payload.website.trim() !== "") {
    return reply(req, 200, { ok: true });
  }

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) return reply(req, 400, { error: "invalid" });
  if (payload.consent !== true) return reply(req, 400, { error: "invalid" });
  const source = typeof payload.source === "string" && SOURCES.has(payload.source) ? payload.source : "site";

  if (!MAILCHIMP_API_KEY || !MAILCHIMP_AUDIENCE_ID || !MAILCHIMP_SERVER_PREFIX) {
    console.error("newsletter-subscribe: MAILCHIMP_API_KEY, MAILCHIMP_SERVER_PREFIX or MAILCHIMP_AUDIENCE_ID is not set");
    return reply(req, 500, { error: "server" });
  }

  // Anti-spam (Turnstile). After the cheap checks above, so a form refused for
  // another reason does not use up the visitor's single-use token. Soft until
  // TURNSTILE_ENFORCE is "true". Nothing about the reason is sent back.
  if (!(await turnstileAllows(payload.captcha, clientIp(req)))) return reply(req, 400, { error: "invalid" });

  // Rate limit: per network per hour, per address per day.
  if (SUPABASE_URL && SERVICE_ROLE_KEY) {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const networkAllowed = await takeSlot(admin, await rateKey("network", clientIp(req)), MAX_PER_NETWORK_PER_HOUR, 3_600_000);
    if (!networkAllowed) return reply(req, 429, { error: "rate_limited" });
    const addressAllowed = await takeSlot(admin, await rateKey("address", email), MAX_PER_ADDRESS_PER_DAY, 86_400_000);
    if (!addressAllowed) return reply(req, 429, { error: "rate_limited" });
  }

  try {
    const member = `/lists/${encodeURIComponent(MAILCHIMP_AUDIENCE_ID)}/members/${md5(email)}`;
    const found = await mailchimp("GET", `${member}?fields=status,merge_fields.SOURCE`);

    if (found.status === 200) {
      const status = String(found.json.status);
      // Already on the list, or still waiting for a confirmation e-mail: a
      // pending address is moved to subscribed (the box was ticked again) with
      // every preference ticked and the "smc-website" welcome tag added; the
      // "site-<source>" tag is added in both cases, and SOURCE is filled if it was
      // empty. An address that is already subscribed keeps the interests it has
      // and gets no welcome tag (the welcome e-mail promises every topic).
      // A failure here is logged only: the person is already on the list.
      let welcome = false;
      if (status === "pending") {
        const interests = await preferenceInterests();
        let confirmed = await mailchimp("PATCH", member, { status: "subscribed", ...(interests ? { interests } : {}) });
        if (confirmed.status === 400 && interests) {
          // A stored interest id Mailchimp no longer knows: forget the list, go on without.
          interestsCache = null;
          confirmed = await mailchimp("PATCH", member, { status: "subscribed" });
        }
        if (confirmed.status === 200) welcome = true;
        else console.error("newsletter-subscribe: pending to subscribed failed", confirmed.status, confirmed.json.title);
      }
      if (status === "subscribed" || status === "pending") {
        const added = await tagMember(member, source, welcome);
        if (!found.json.merge_fields?.SOURCE) {
          const patched = await mailchimp("PATCH", member, { merge_fields: { SOURCE: source } });
          if (patched.status !== 200) console.error("newsletter-subscribe: source update failed", patched.status, patched.json.title);
        }
        // SMC copy: "subscribed" also when a pending address was just moved there.
        await recordSubscriber(email, source, welcome ? "subscribed" : status, added);
        return reply(req, 200, { ok: true });
      }
    } else if (found.status !== 404) {
      console.error("newsletter-subscribe: member lookup failed", found.status, found.json.title);
      return reply(req, 500, { error: "server" });
    }

    // New, or unsubscribed / cleaned / archived and consenting again: SUBSCRIBED
    // at once (single opt-in), with the sign-up time and network as proof, and
    // every preference ticked. The tags are added once the member exists (see
    // the header).
    const interests = await preferenceInterests();
    const baseFields = {
      email_address: email,
      merge_fields: { SOURCE: source },
      timestamp_signup: new Date().toISOString(),
      ...(clientIp(req) ? { ip_signup: clientIp(req) } : {}),
    };
    const save = async (withInterests: boolean) => {
      const fields = withInterests && interests ? { ...baseFields, interests } : baseFields;
      let res = await mailchimp("PUT", member, { ...fields, status_if_new: "subscribed", status: "subscribed" });
      if (res.status === 400 && res.json.title === "Member In Compliance State") {
        // Mailchimp will not re-subscribe this address by API: ask the person to
        // confirm by e-mail instead.
        res = await mailchimp("PUT", member, { ...fields, status_if_new: "pending", status: "pending" });
      }
      return res;
    };
    let saved = await save(true);
    if (saved.status === 400 && saved.json.title === "Invalid Resource" && interests) {
      // Either the address or a stored interest id is refused (an interest deleted
      // and recreated in Mailchimp). Forget the stored list and try once without
      // interests: a bad address is refused again and still answers "invalid".
      interestsCache = null;
      saved = await save(false);
    }
    if (saved.status === 200) {
      const added = await tagMember(member, source, true);
      // SMC copy: the status Mailchimp answered ("subscribed", or "pending" after
      // the compliance fallback).
      await recordSubscriber(email, source, typeof saved.json.status === "string" ? saved.json.status : null, added);
      return reply(req, 200, { ok: true });
    }
    if (saved.status === 400 && saved.json.title === "Invalid Resource") {
      // Mailchimp refused the address (looks fake, recently on too many lists,
      // permanently deleted before...). Log its reason with the address masked.
      const why = typeof saved.json.detail === "string" ? saved.json.detail.split(email).join("<email>").slice(0, 300) : "";
      console.warn("newsletter-subscribe: Mailchimp refused the address", why);
      return reply(req, 400, { error: "invalid" });
    }
    console.error("newsletter-subscribe: member save failed", saved.status, saved.json.title, saved.json.detail);
    return reply(req, 500, { error: "server" });
  } catch (err) {
    console.error("newsletter-subscribe: Mailchimp call failed", err instanceof Error ? err.message : String(err));
    return reply(req, 500, { error: "server" });
  }
});
