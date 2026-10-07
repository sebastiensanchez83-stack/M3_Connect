// newsletter-subscribe: puts an e-mail address on the Smart Marina Connect
// Mailchimp audience, with DOUBLE OPT-IN. Public, no JWT (verify_jwt = false):
// the footer and home sign-up forms call it anonymously.
//
//   POST { email, consent: true, source?, website? }
//     email     the address to subscribe (<= 254 characters)
//     consent   must be true: the form's consent box is ticked
//     source    where the form sits: footer | home | events | resources | other
//               (anything else is stored as "site"); becomes the SOURCE merge
//               field and a "site-<source>" tag in Mailchimp
//     website   honeypot: a field no person sees. Filled in => answered 200 and
//               dropped, so a robot learns nothing
//   200 { ok: true }                 subscribed or already on the list. The same
//                                    answer either way, so the form cannot be
//                                    used to find out who is subscribed
//   400 { error: "invalid" }         bad address / no consent / address refused
//   429 { error: "rate_limited" }
//   500 { error: "server" }          Mailchimp or this function is not set up
//
// Double opt-in: a NEW address is created with status "pending", so Mailchimp
// e-mails the confirmation link and the address only becomes "subscribed" when
// its owner clicks it. An address that had unsubscribed (or was cleaned or
// archived) is set back to "pending" the same way, because the person has just
// ticked the consent box again. An address that is already subscribed or
// pending is left exactly as it is.
//
// Secrets (Supabase > Edge Functions > Secrets):
//   MAILCHIMP_API_KEY          the key, "<hex>-<datacenter>"
//   MAILCHIMP_SERVER_PREFIX    the datacenter, e.g. "us21" (defaults to the
//                              suffix of the API key)
//   MAILCHIMP_AUDIENCE_ID      the audience (list) id
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

const SOURCES = new Set(["footer", "home", "events", "resources", "other"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  let json: { status?: number | string; title?: string; detail?: string } = {};
  try { json = await res.json(); } catch { /* an empty body */ }
  return { status: res.status, json };
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
    const found = await mailchimp("GET", `${member}?fields=status`);

    if (found.status === 200) {
      const status = String(found.json.status);
      // Already on the list (or waiting for the confirmation e-mail): untouched.
      if (status === "subscribed" || status === "pending") return reply(req, 200, { ok: true });
    } else if (found.status !== 404) {
      console.error("newsletter-subscribe: member lookup failed", found.status, found.json.title);
      return reply(req, 500, { error: "server" });
    }

    // New, or unsubscribed / cleaned / archived and consenting again: PENDING,
    // so Mailchimp sends the confirmation e-mail (double opt-in).
    const saved = await mailchimp("PUT", member, {
      email_address: email,
      status_if_new: "pending",
      status: "pending",
      merge_fields: { SOURCE: source },
      tags: [`site-${source}`],
    });
    if (saved.status === 200) return reply(req, 200, { ok: true });
    if (saved.status === 400 && saved.json.title === "Invalid Resource") return reply(req, 400, { error: "invalid" });
    console.error("newsletter-subscribe: member save failed", saved.status, saved.json.title, saved.json.detail);
    return reply(req, 500, { error: "server" });
  } catch (err) {
    console.error("newsletter-subscribe: Mailchimp call failed", err instanceof Error ? err.message : String(err));
    return reply(req, 500, { error: "server" });
  }
});
