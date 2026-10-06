// Signup via a valid organization claim code.
//
// SECURITY HISTORY -- read before changing how the account is created below.
// This function used to pass email_confirm:true, on the stated assumption that
// "the user already proved ownership of the email by clicking the invitation
// link sent to that address". No token was ever passed or checked, and the
// endpoint is public (verify_jwt=false), so anyone holding a claim code could
// create a PRE-CONFIRMED account under someone else's address with a password of
// their choosing. Claim codes were readable by anonymous visitors at the time,
// so the code was not a secret either.
//
// v9 then created the account with createUser({ email_confirm:false }) on the
// belief that "GoTrue sends its own confirmation mail". It does not: the admin
// API never sends mail, so those accounts could never be confirmed and the
// client's sign-in failed with "Email not confirmed".
//
// Now generateLink({ type:'signup' }) creates the unconfirmed account and hands
// back its confirmation token in one call, and this function e-mails the link
// itself (Resend, the same way sm26-attendee-invite / sponsor-invite do). The
// account is inert until the real mailbox owner clicks it. None of this depends
// on the dashboard's "Confirm email" setting: an account created through the
// admin API is never auto-confirmed, so the behaviour is the same before and
// after that setting is switched on.
//
// The password is never the caller's. Whoever fills in the form is not proven to
// own the address, and a password they chose would keep working after the real
// owner clicks the link -- a pre-account takeover. The account is created with a
// random password nobody knows (any `password` in the request is ignored; older
// clients still send one), and the mailbox owner chooses theirs on /welcome,
// which makes that step mandatory for every type=signup link.
//
// The organisation waits for the mailbox owner too. This function used to run
// claim_organization_for_user as soon as the account existed: anyone holding a
// code could make any address -- one nobody reads -- the OWNER of an
// organisation that had none, with a verified profile, and the real manager
// could then only join as a collaborator. Nothing is claimed here any more. The
// confirmation link ends on /onboarding?code=<code>, where OnboardingPage claims
// the organisation with claim_organization as the confirmed, signed-in person
// (and under that RPC's attempt limit).
//
// Codes are short and human-readable (GROUP-CITY style), and this public endpoint says
// whether one is valid. Failed codes are therefore limited per network, as are
// new accounts (each one is an e-mail from our domain to an address the caller
// picks); see RATE_TABLE.
//
// A second submit for the same address only re-sends the link, and only for an
// unconfirmed account this function made for this same organisation. Any other
// existing account -- confirmed, or someone's own pending sign-up -- is refused
// with "already exists" and left untouched: no metadata rewrite, no new token
// (which would kill the link GoTrue already mailed them).

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://smartmarinaconnect.com",
  "https://m3connect.netlify.app",
  "http://localhost:5173",
  "http://localhost:3000",
];

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SITE_URL = Deno.env.get("SITE_URL") || "https://smartmarinaconnect.com";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const SENDER_EMAIL = Deno.env.get("SENDER_EMAIL") || "Smart Marina Connect <noreply@smartmarinaconnect.com>";

// Personas a visitor may pick on the signup form. The metadata becomes the
// profile row (handle_new_user casts it to persona_enum), so a crafted request
// must not be able to plant 'admin' or 'moderator' there -- anything else falls
// back to the organisation's type.
const SELF_SERVE_PERSONAS = new Set(["marina", "partner", "media_partner", "developer", "investor"]);

// Minimum gap between two confirmation e-mails to the same unconfirmed address
// (GoTrue's own resend window is 60 s too). Stops the retry path from being used
// to flood a mailbox.
const RESEND_COOLDOWN_MS = 60_000;

// Per network (IP), per rolling hour. Without the first limit this endpoint is
// an oracle that walks around claim_organization's own attempt limit (10 failed
// codes per account per hour). The second caps how many addresses one network
// can make us e-mail. Once a network has 10 failed codes, every call from it is
// refused until the oldest is an hour old, a valid code included, as in
// claim_organization.
// Rows go to guest_signup_rate_limits (ip_hash, created_at; RLS denies anon and
// authenticated), shared with guest-webinar-register. This function's keys are
// HMACs with their own prefix (rateKey), so they never match that function's
// rows and cannot be turned back into an address.
const RATE_TABLE = "guest_signup_rate_limits";
const MAX_FAILED_CODES_PER_HOUR = 10;
const MAX_NEW_ACCOUNTS_PER_HOUR = 10;

// The account's password until the mailbox owner sets theirs on /welcome: 40
// characters from a 64-symbol alphabet (240 random bits; 256 is a multiple of 64,
// so `& 63` is unbiased). The fixed "aA1!" tail only satisfies whatever
// character-class policy the project enforces; the secret is the random part.
// 44 ASCII bytes stays under bcrypt's 72-byte limit.
const PASSWORD_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function unguessablePassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(40));
  let out = "";
  for (const b of bytes) out += PASSWORD_ALPHABET[b & 63];
  return `${out}aA1!`;
}

const ALREADY_EXISTS = "An account with this email already exists. Please log in instead.";
const SEND_FAILED = "We could not send the confirmation e-mail. Please try again in a minute, or contact us.";
const TOO_SOON =
  "A confirmation e-mail was requested for this address less than a minute ago. Check your inbox (and spam folder), or try again in a minute.";
const RATE_LIMITED = "Too many attempts from this network. Please try again later.";

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

// Copied from send-email (keep the two in step). The names are whatever the
// caller typed, and this endpoint is public: they go out from our domain to an
// address the caller picks, and to the admins. So a name is kept to what a name
// looks like -- one line, at most 60 characters, letters and the punctuation
// names use. Anything else (a URL, an address, digits, markup) drops it, and
// the plain greeting is used.
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

// The caller's IP as the platform reports it (the same headers as
// guest-webinar-register and sm_vote_ip_hash), or null.
function clientIp(req: Request): string | null {
  const ip = req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "";
  return ip || null;
}

// HMAC-SHA-256 of the IP (or, for resend_addr, the e-mail address) under a
// server secret: never the value itself.
async function rateKey(
  kind: "failed_code" | "new_account" | "resend" | "resend_addr",
  subject: string | null,
): Promise<string | null> {
  if (!subject) return null;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(SERVICE_ROLE_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`claim-code-signup:${kind}:${subject}`));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Re-sends e-mail an address that already has a pending claim account. They are
// capped too, or one valid code would let anyone mail that address every minute
// from our domain: per network per hour, and per address per day.
const MAX_RESENDS_PER_HOUR = 10;
const MAX_RESENDS_PER_ADDRESS_PER_DAY = 3;

type AdminClient = SupabaseClient;

// Takes one of this key's slots for the rolling hour. The row is written first
// and counted after, so concurrent calls see each other's rows and a burst
// cannot slip in between a count and an insert. Returns:
//  - the row id: the slot is taken (releaseSlot gives it back);
//  - "full": `max` slots were already taken; nothing is kept;
//  - null: no IP, or the table failed. Fails open: a broken limiter must not
//    lock invited managers out.
async function takeSlot(
  admin: AdminClient,
  key: string | null,
  max: number,
  windowMs = 3_600_000,
): Promise<number | "full" | null> {
  if (!key) return null;
  const { data, error } = await admin.from(RATE_TABLE).insert({ ip_hash: key }).select("id").single();
  if (error || !data) { console.error("rate limit insert failed", error); return null; }
  const id = (data as { id: number }).id;
  const { count, error: countError } = await admin
    .from(RATE_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", key)
    .gte("created_at", new Date(Date.now() - windowMs).toISOString());
  if (countError) { console.error("rate limit count failed", countError); return id; }
  if ((count ?? 0) > max) {
    await releaseSlot(admin, id);
    return "full";
  }
  // This key's rows older than a day are no longer used.
  await admin
    .from(RATE_TABLE)
    .delete()
    .eq("ip_hash", key)
    .lt("created_at", new Date(Date.now() - 86_400_000).toISOString());
  return id;
}

async function releaseSlot(admin: AdminClient, id: number | null) {
  if (id === null) return;
  const { error } = await admin.from(RATE_TABLE).delete().eq("id", id);
  if (error) console.error("rate limit release failed", error);
}

type Lang = "en" | "fr";

// Each value that reaches these templates is already HTML-escaped.
const COPY: Record<Lang, {
  subject: string;
  hello: (name: string) => string;
  title: string;
  body: (org: string) => string;
  button: string;
  fallback: string;
  ignore: string;
}> = {
  en: {
    subject: "Confirm your Smart Marina Connect account",
    hello: (name) => (name ? `Hello ${name},` : "Hello,"),
    title: "Confirm your e-mail address",
    body: (org) =>
      `A Smart Marina Connect account was requested with this e-mail address to join <strong>${org}</strong>. Confirm your address to activate it &mdash; you will then choose your password.`,
    button: "Confirm my e-mail address",
    fallback: "If the button does not work, copy this link into your browser:",
    ignore: "If you did not request this account, you can safely ignore this e-mail: the account stays inactive until this link is used.",
  },
  fr: {
    subject: "Confirmez votre compte Smart Marina Connect",
    hello: (name) => (name ? `Bonjour ${name},` : "Bonjour,"),
    title: "Confirmez votre adresse e-mail",
    body: (org) =>
      `Un compte Smart Marina Connect a &eacute;t&eacute; demand&eacute; avec cette adresse e-mail pour rejoindre <strong>${org}</strong>. Confirmez votre adresse pour l&rsquo;activer &mdash; vous choisirez ensuite votre mot de passe.`,
    button: "Confirmer mon adresse e-mail",
    fallback: "Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur&nbsp;:",
    ignore: "Si vous n&rsquo;&ecirc;tes pas &agrave; l&rsquo;origine de cette demande, ignorez simplement cet e-mail&nbsp;: le compte reste inactif tant que ce lien n&rsquo;est pas utilis&eacute;.",
  },
};

async function sendConfirmationEmail(email: string, lang: Lang, firstName: string, orgName: string, link: string): Promise<boolean> {
  if (!RESEND_API_KEY) { console.error("RESEND_API_KEY not set"); return false; }
  const c = COPY[lang];
  // The name is whatever the caller typed and goes to whatever address they
  // typed: only something that looks like a name, escaped on top of that.
  const name = esc(displayName(firstName));
  const href = esc(link);
  const html = `
<!DOCTYPE html><html lang="${lang}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f5f7;padding:40px 20px;"><tr><td align="center">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06);">
<tr><td style="background:#0b2653;padding:32px 40px;text-align:center;">
<h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">Smart Marina Connect</h1></td></tr>
<tr><td style="padding:40px;">
<p style="margin:0 0 8px;color:#374151;font-size:16px;">${c.hello(name)}</p>
<h2 style="margin:0 0 16px;color:#111827;font-size:20px;font-weight:600;">${c.title}</h2>
<p style="margin:0 0 28px;color:#4b5563;font-size:15px;line-height:1.6;">${c.body(esc(orgName))}</p>
<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto;"><tr><td style="background:#0b2653;border-radius:8px;">
<a href="${href}" target="_blank" style="display:inline-block;padding:14px 32px;color:#fff;font-size:15px;font-weight:600;text-decoration:none;">${c.button}</a>
</td></tr></table>
<p style="margin:28px 0 4px;color:#6b7280;font-size:13px;line-height:1.5;">${c.fallback}</p>
<p style="margin:0;font-size:12px;line-height:1.5;word-break:break-all;"><a href="${href}" target="_blank" style="color:#0b2653;">${href}</a></p>
<p style="margin:28px 0 0;color:#9ca3af;font-size:13px;line-height:1.5;">${c.ignore}</p>
</td></tr>
<tr><td style="padding:24px 40px;background:#f9fafb;border-top:1px solid #e5e7eb;text-align:center;">
<p style="margin:0;color:#9ca3af;font-size:12px;">Smart Marina Connect &middot; M3 Monaco</p></td></tr>
</table></td></tr></table></body></html>`.trim();
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: SENDER_EMAIL, to: [email], subject: c.subject, html }),
    });
    if (!res.ok) { console.error("Resend error", res.status, await res.text()); return false; }
    return true;
  } catch (e) {
    console.error("confirmation email failed", e);
    return false;
  }
}

// Fire-and-forget admin notification (fans out to every admin via notify-admins)
// send-notification puts submitter and details into the HTML unescaped, and the
// names and the address come from an anonymous caller: names pass displayName,
// the rest is escaped here.
async function notifyAdminsOfSignup(data: { email: string; first_name?: string; last_name?: string; org_name?: string; claim_code?: string; resend?: boolean; emailed?: boolean }) {
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return;
    const email = esc(data.email);
    const fullName = [displayName(data.first_name), displayName(data.last_name)].filter(Boolean).join(" ") || email;
    const details = [
      `Email: ${email}`,
      `Signup method: Claim code (${esc(data.claim_code || "unknown")})${data.resend ? " -- confirmation e-mail re-requested" : ""}`,
      data.org_name ? `Organization: ${esc(data.org_name)} (they join it only once they have confirmed their address)` : "",
      data.emailed
        ? "Confirmation e-mail: sent (the account is inactive until they click it)"
        : "Confirmation e-mail: FAILED -- they cannot log in until their address is confirmed",
    ].filter(Boolean).join("\n");
    await fetch(`${SUPABASE_URL}/functions/v1/notify-admins`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "apikey": SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({
        submission_type: "new user signup",
        submitter: fullName,
        details,
        include_contact_inbox: true,
      }),
    });
  } catch {
    // Swallow any errors -- notifications must never block signup
  }
}

Deno.serve(async (req: Request) => {
  const startedAt = Date.now();
  const headers = { "Content-Type": "application/json", ...corsHeaders(req) };
  const reply = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers });

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }

  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return reply({ error: "Server not configured" }, 500);
    }

    // `password` is deliberately not read (see the note at the top): older
    // clients still send one, and it must not reach the account.
    const body = await req.json();
    const { persona, claim_code } = body;
    const firstName = typeof body.first_name === "string" ? body.first_name.trim() : "";
    const lastName = typeof body.last_name === "string" ? body.last_name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    // Every platform e-mail is in English (Victor, 6 Oct 2026). The FR copy stays
    // for a later change of mind; body.lang is accepted but not used.
    const lang: Lang = "en";

    if (!email || !claim_code) {
      return reply({ error: "Email and claim_code are required" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const ip = clientIp(req);
    const failedCodeKey = await rateKey("failed_code", ip);

    // 0. Every lookup takes a failed-code slot, given back below if the code is
    //    valid. Once the hour's slots are used, refuse before the lookup, so the
    //    answer says nothing about this code.
    const codeSlot = await takeSlot(admin, failedCodeKey, MAX_FAILED_CODES_PER_HOUR);
    if (codeSlot === "full") {
      return reply({ error: RATE_LIMITED, code: "rate_limited" }, 429);
    }

    // 1. Validate the claim code matches a real organization. Stored codes are
    //    always upper-case letters, digits and dashes (admin_set_org_claim_code
    //    normalises them), so anything else is invalid without a lookup, and the
    //    lookup is an EXACT match: a pattern (ilike, where PostgREST reads '*' as
    //    '%') would let 'ACI-*' probe many codes for the price of one slot.
    const normalizedCode = String(claim_code).trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9-]{1,63}$/.test(normalizedCode)) {
      // The slot stays taken, as for any failed code.
      return reply({ error: "Invalid organization code. Please use the normal signup process.", code: "invalid_code" }, 400);
    }
    const { data: org, error: orgError } = await admin
      .from("organizations")
      .select("id, name, organization_type")
      .eq("claim_code", normalizedCode)
      .maybeSingle();

    if (orgError) {
      // Not "invalid": the client would drop a code that may be fine.
      console.error("claim code lookup failed", orgError);
      await releaseSlot(admin, codeSlot);
      return reply({ error: "Could not check this code. Please try again in a minute." }, 500);
    }
    if (!org) {
      // The slot stays taken: one failed code for this network.
      return reply({ error: "Invalid organization code. Please use the normal signup process.", code: "invalid_code" }, 400);
    }
    await releaseSlot(admin, codeSlot);

    // 2. Is there already an account for this address? This replaces a
    //    listUsers({ perPage: 1000 }) scan that silently missed every user past
    //    the first thousand. handle_new_user copies the auth email (GoTrue stores
    //    it lowercased) into profiles, so an exact match on the lowercased input
    //    finds it. generateLink in step 3 stays the authoritative check for a
    //    CONFIRMED account either way.
    //    An UNCONFIRMED one is a retry (lost or failed e-mail) ONLY when this
    //    function made it for this org: app_metadata.claim_org_id (set in step 4;
    //    a caller cannot set app_metadata), or, for an account made before the
    //    claim waited for confirmation, the membership granted back then. It gets
    //    a fresh link, never a second account. Anything else unconfirmed is
    //    somebody's own pending sign-up (with "Confirm email" ON every normal
    //    sign-up waits like that) and is refused like a confirmed one. A retry
    //    changes nothing on the account: GoTrue keeps the first (random)
    //    password, step 3 sends no metadata and step 4 is skipped -- this caller
    //    is no more proven than the first one.
    //    profiles.email is editable by its owner, so a profile row is only a lead:
    //    the account counts only if its SIGN-IN address is the one typed (otherwise
    //    anyone could set their profile e-mail to a target's address and block
    //    every claim-code sign-up for it).
    const { data: priors, error: priorErr } = await admin
      .from("profiles")
      .select("user_id")
      .eq("email", email)
      .limit(100);
    // Fail closed if the cap is reached: decoy profiles (owners can set their own
    // profile e-mail) must not be able to hide the real account past the cap.
    if (priorErr || (priors?.length ?? 0) >= 100) {
      console.error("profile lookup failed or capped", priorErr);
      return reply({ error: "Could not check this e-mail address. Please try again in a minute." }, 500);
    }
    let existing: Awaited<ReturnType<typeof admin.auth.admin.getUserById>>["data"]["user"] | null = null;
    for (const p of priors ?? []) {
      const { data: found, error: findErr } = await admin.auth.admin.getUserById(p.user_id);
      if (!found?.user && findErr && findErr.status !== 404) {
        // Fail closed: without knowing the account, step 3 could rewrite it.
        console.error("getUserById failed", findErr);
        return reply({ error: "Could not check this e-mail address. Please try again in a minute." }, 500);
      }
      if (found?.user && (found.user.email || "").toLowerCase() === email) {
        existing = found.user;
        break;
      }
    }
    let resend: { userId: string; firstName: string; lastName: string } | null = null;
    {
      if (existing?.email_confirmed_at) {
        return reply({ error: ALREADY_EXISTS, code: "already_exists" }, 400);
      }
      if (existing) {
        let ours = (existing.app_metadata as Record<string, unknown> | undefined)?.claim_org_id === org.id;
        if (!ours) {
          const { data: member } = await admin
            .from("organization_members")
            .select("user_id")
            .eq("user_id", existing.id)
            .eq("organization_id", org.id)
            .maybeSingle();
          ours = !!member;
        }
        if (!ours) {
          return reply({ error: ALREADY_EXISTS, code: "already_exists" }, 400);
        }
        const sentAt = existing.confirmation_sent_at ? Date.parse(existing.confirmation_sent_at) : 0;
        if (Date.now() - sentAt < RESEND_COOLDOWN_MS) {
          return reply({ error: TOO_SOON, code: "too_soon", needs_confirmation: true }, 429);
        }
        const meta = existing.user_metadata || {};
        resend = {
          userId: existing.id,
          firstName: String(meta.first_name || ""),
          lastName: String(meta.last_name || ""),
        };
      }
    }

    // A new account means an e-mail to an address the caller picked: capped per
    // network. The slot is given back if no account comes out of step 3. A retry
    // re-sends to the same address: capped per network and per address (on top of
    // its 60 s cooldown); those slots are kept once taken.
    if (resend) {
      const perNetwork = await takeSlot(admin, await rateKey("resend", ip), MAX_RESENDS_PER_HOUR);
      if (perNetwork === "full") {
        return reply({ error: RATE_LIMITED, code: "rate_limited" }, 429);
      }
      const perAddress = await takeSlot(
        admin,
        await rateKey("resend_addr", email),
        MAX_RESENDS_PER_ADDRESS_PER_DAY,
        86_400_000,
      );
      if (perAddress === "full") {
        return reply({ error: RATE_LIMITED, code: "rate_limited" }, 429);
      }
    }
    const accountSlot = resend
      ? null
      : await takeSlot(admin, await rateKey("new_account", ip), MAX_NEW_ACCOUNTS_PER_HOUR);
    if (accountSlot === "full") {
      return reply({ error: RATE_LIMITED, code: "rate_limited" }, 429);
    }

    // 3. Create the user UNCONFIRMED and mint its confirmation token in one call.
    //    The password is a random one nobody knows (see the note at the top);
    //    the person chooses theirs on /welcome after clicking the link.
    //    For an existing unconfirmed user GoTrue issues a new token, ignores the
    //    password and merges options.data into its metadata -- hence no data on a
    //    retry. It refuses a confirmed one with email_exists, mapped to the
    //    message the client matches on: keep "already exists" in it.
    //    `lang` is stored with the account so the send-email hook writes later
    //    auth e-mails (GoTrue resends, password recovery) in the same language.
    //    After the link: /welcome (password step), then /onboarding with the
    //    code, which claims the organisation for the confirmed person.
    const afterConfirm = `/onboarding?code=${encodeURIComponent(normalizedCode)}`;
    const safePersona = SELF_SERVE_PERSONAS.has(persona) ? persona : (org.organization_type || "marina");
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: "signup",
      email,
      password: unguessablePassword(),
      options: {
        ...(resend ? {} : {
          data: {
            first_name: firstName,
            last_name: lastName,
            persona: safePersona,
            lang,
          },
        }),
        redirectTo: `${SITE_URL}/welcome?next=${encodeURIComponent(afterConfirm)}`,
      },
    });

    if (linkError || !link?.user) {
      await releaseSlot(admin, accountSlot);
      const code = (linkError as { code?: string } | null)?.code;
      const message = linkError?.message || "";
      if (code === "email_exists" || code === "user_already_exists" || /already (been )?registered|already exists/i.test(message)) {
        return reply({ error: ALREADY_EXISTS, code: "already_exists" }, 400);
      }
      return reply({ error: message || "Failed to create account" }, 400);
    }
    const user = link.user;

    // Step 2 should have caught every existing account. Should its lookup ever
    // miss one, GoTrue has just handed back a user that predates this request
    // (a minute of slack for clock skew): refuse it like any other existing
    // address and do nothing more to it.
    const preExisting = resend
      ? user.id !== resend.userId
      : Date.parse(user.created_at) < startedAt - 60_000;
    if (preExisting) {
      console.error("generateLink returned an account step 2 did not find", user.id);
      await releaseSlot(admin, accountSlot);
      return reply({ error: ALREADY_EXISTS, code: "already_exists" }, 400);
    }

    // 4. A new account (its slot stays taken): mark it as made by this function
    //    for this organisation, which is how step 2 recognises a retry.
    //    app_metadata only, which leaves the confirmation token alone (a
    //    password change would not). No membership here (see the top).
    if (!resend) {
      const { error: markErr } = await admin.auth.admin.updateUserById(user.id, { app_metadata: { claim_org_id: org.id } });
      // The link below still works; only a later "resend" would be refused.
      if (markErr) console.error("could not mark the claim-code account", user.id, markErr);
    }

    // 5. E-mail the confirmation link. Not GoTrue's action_link: that
    //    /auth/v1/verify URL comes back with an implicit-grant #access_token,
    //    which our PKCE client rejects ("Not a valid PKCE flow url"), so the
    //    person would land logged out; and mail scanners that pre-fetch links
    //    would spend it -- confirming the account -- before the owner clicks.
    //    /welcome redeems a token_hash itself with verifyOtp (the same link the
    //    send-email hook builds for /welcome), which works on any device, and a
    //    scanner running no JavaScript spends nothing. `next` then takes them to
    //    onboarding with the code. The link is only ever e-mailed, never
    //    returned to the caller.
    const props = link.properties as { hashed_token?: string; action_link?: string } | undefined;
    let confirmUrl = props?.action_link || "";
    if (props?.hashed_token) {
      const target = new URL("/welcome", SITE_URL);
      target.searchParams.set("token_hash", props.hashed_token);
      target.searchParams.set("type", "signup");
      target.searchParams.set("next", afterConfirm);
      confirmUrl = target.toString();
    }
    //    On a retry the greeting uses the name stored with the account, not the
    //    one this caller typed.
    const greetName = resend ? resend.firstName : firstName;
    const emailed = confirmUrl ? await sendConfirmationEmail(email, lang, greetName, org.name, confirmUrl) : false;

    // 6. Notify all admins of a new signup (fire-and-forget), incl. the outcome.
    //    A re-request is only worth a notification when the e-mail failed again.
    if (!resend || !emailed) {
      notifyAdminsOfSignup({
        email,
        first_name: resend ? resend.firstName : firstName,
        last_name: resend ? resend.lastName : lastName,
        org_name: org.name,
        claim_code: normalizedCode,
        resend: !!resend,
        emailed,
      });
    }

    // The account exists either way; a later submit with the same address takes
    // the retry branch in step 2 and sends a fresh link. Nothing about the
    // account or the organisation goes back: this caller is not proven to be
    // the person the account is for.
    if (!emailed) {
      return reply({ error: SEND_FAILED, code: "email_send_failed", needs_confirmation: true }, 502);
    }
    return reply({
      success: true,
      needs_confirmation: true,
      email_confirmation_required: true,
      resent: !!resend,
    }, 200);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return reply({ error: message }, 500);
  }
});
