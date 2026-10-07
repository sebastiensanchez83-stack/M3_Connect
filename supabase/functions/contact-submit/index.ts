// contact-submit -- the public contact form of smartmarinaconnect.com (/contact).
//
// Why (hotfix, 7 Oct 2026): the page inserted into public.contact_submissions, a
// table that did not exist, then opened the visitor's mail client and said
// "thank you" anyway, so messages were lost. Now every message is stored
// (migration 20261007211549_contact_submissions, service role only) and e-mailed
// to events@m3monaco.com, and the page shows its thank-you only on { ok: true },
// which is returned only once Resend has accepted the e-mail to the inbox.
//
// CONTRACT (other pages are built against it: keep it exactly)
//   POST JSON (Content-Type: application/json, as supabase-js invoke and any JSON
//   fetch send it; anything else -> 400, so a third-party page cannot post here
//   without a CORS preflight, which the origin allowlist refuses) {
//     name:     string, 1-120 characters
//     email:    string, a valid address, at most 254 characters
//     company?: string, at most 160
//     subject:  "general" | "partnership" | "support" | "media" | "other"
//     message:  string, 10-5000 characters
//     source?:  string, the page path, at most 200
//     website?: string, honeypot: must be empty
//   }
//   -> 200 { ok: true } | 400 { error: "invalid" } | 429 { error: "rate_limited" }
//      | 500 { error: "server" }
//   Lengths are characters (code points) after trimming. Unknown keys are ignored.
//   A string holding a lone UTF-16 surrogate is invalid (400): Postgres would
//   refuse it at insert time.
//   Honeypot filled -> 200 { ok: true }, nothing stored or sent.
//   Rate limits (rolling hour, counted on the stored rows): 5 per network (hashed
//   IP), 3 per e-mail address.
//   The row is stored first. If the insert fails -> 500. If the e-mail to the inbox
//   fails, the row is kept (emailed_at stays null, the error is logged) and the
//   answer is 500 as well: nobody reads the table day to day, so the visitor must
//   not be told the message went out. The page then shows its error box with
//   events@m3monaco.com. A retry stores a second row and counts toward the
//   3-per-address limit (accepted).
//   Errors never echo what the caller sent.
//
// verify_jwt must be FALSE (anonymous visitors). This file must not contain a
// literal backslash-u escape (the MCP deploy tool mangles them): control
// characters are matched with Unicode property classes and the u flag.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const SENDER_EMAIL = Deno.env.get("SENDER_EMAIL") || "Smart Marina Connect <noreply@smartmarinaconnect.com>";

const INBOX = "events@m3monaco.com";
const TABLE = "contact_submissions";

const MAX_BODY_BYTES = 16 * 1024;
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_IP_PER_HOUR = 5;
const MAX_PER_EMAIL_PER_HOUR = 3;
const RESEND_TIMEOUT_MS = 10_000;

// The values of SUBJECT_OPTIONS in src/pages/ContactPage.tsx -> label in the e-mail.
const SUBJECT_LABELS = new Map<string, string>([
  ["general", "General Inquiry"],
  ["partnership", "Partnership"],
  ["support", "Support"],
  ["media", "Media"],
  ["other", "Other"],
]);

const ALLOWED_ORIGINS = [
  "https://smartmarinaconnect.com",
  "https://m3connect.netlify.app",
  "http://localhost:5173",
  "http://localhost:3000",
];

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

// ─── Input ────────────────────────────────────────────────────────────────────

/** The request body as text, or null when it is larger than `max` bytes or not UTF-8. */
async function readBody(req: Request, max: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") || "0");
  if (!Number.isFinite(declared) || declared > max) return null;
  if (!req.body) return null;
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

/** Length in characters (code points), as Postgres char_length counts them. */
const len = (s: string) => Array.from(s).length;

/** One line: invisible format characters removed, control and separator characters
 *  become spaces, runs of white space collapse. */
function oneLine(s: string): string {
  return s
    .replace(/\p{Cf}+/gu, "")
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Free text: line breaks and tabs kept (CRLF -> LF), other control characters and
 *  invisible format characters (bidi overrides...) removed, except the joiners
 *  emoji sequences use. */
function multiLine(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[\p{Zl}\p{Zp}]/gu, "\n")
    .replace(/(?![\n\t])\p{Cc}/gu, "")
    .replace(/(?!\p{Join_Control})\p{Cf}/gu, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

// The local part leaves out ? & = % (legal in RFC 5322, never typed by real
// visitors): in a mailto: URL they add headers, so "a?bcc=x%40evil.com&y=@ex.com"
// would BCC a stranger if a mail client turned the address into a link.
const EMAIL_RE =
  /^[A-Za-z0-9.!#$'*+\/^_`{|}~-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+(?:[A-Za-z]{2,63}|xn--[A-Za-z0-9-]{1,59})$/;

function isEmail(s: string): boolean {
  if (s.length > 254 || !EMAIL_RE.test(s)) return false;
  const local = s.slice(0, s.indexOf("@"));
  return !local.startsWith(".") && !local.endsWith(".") && !local.includes("..");
}

type Submission = {
  name: string;
  email: string;
  company: string | null;
  subject: string;
  message: string;
  source: string | null;
};

const isOptionalString = (v: unknown) => v === undefined || v === null || typeof v === "string";

/** A lone UTF-16 surrogate (JSON.parse makes one from an unpaired escape). With the
 *  u flag a well-formed pair is one code point, so only lone halves match Cs.
 *  Postgres refuses them (22P02), so they must be a 400 here, not a failed insert. */
const hasLoneSurrogate = (v: unknown) => typeof v === "string" && /\p{Cs}/u.test(v);

/** The cleaned submission, or null when anything breaks the contract. */
function validate(body: Record<string, unknown>): Submission | null {
  const { name, email, company, subject, message, source } = body;
  if (typeof name !== "string" || typeof email !== "string") return null;
  if (typeof subject !== "string" || typeof message !== "string") return null;
  if (!isOptionalString(company) || !isOptionalString(source)) return null;
  if ([name, email, company, subject, message, source].some(hasLoneSurrogate)) return null;

  const cleanName = oneLine(name);
  if (len(cleanName) < 1 || len(cleanName) > 120) return null;

  const cleanEmail = email.trim().toLowerCase();
  if (!isEmail(cleanEmail)) return null;

  const cleanSubject = subject.trim();
  if (!SUBJECT_LABELS.has(cleanSubject)) return null;

  const cleanCompany = typeof company === "string" ? oneLine(company) : "";
  if (len(cleanCompany) > 160) return null;

  const cleanMessage = multiLine(message);
  if (len(cleanMessage) < 10 || len(cleanMessage) > 5000) return null;

  const cleanSource = typeof source === "string" ? oneLine(source) : "";
  if (len(cleanSource) > 200) return null;

  return {
    name: cleanName,
    email: cleanEmail,
    company: cleanCompany || null,
    subject: cleanSubject,
    message: cleanMessage,
    source: cleanSource || null,
  };
}

/** Honeypot: people never see the field, so any value means a bot. */
function honeypotFilled(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v !== "string") return true;
  return v.trim() !== "";
}

// ─── Rate limit ───────────────────────────────────────────────────────────────

// The caller's IP as the platform reports it (same headers as claim-code-signup
// and guest-webinar-register), or null.
function clientIp(req: Request): string | null {
  const ip = req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "";
  return ip || null;
}

// HMAC-SHA-256 of the IP under a server secret, with this function's own prefix:
// never the IP itself, and it cannot be matched against other functions' keys.
async function ipHash(ip: string | null): Promise<string | null> {
  if (!ip) return null;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(SERVICE_ROLE_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`contact-submit:ip:${ip}`));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Rows with this value in the rolling window, or null if the count failed (fail open). */
async function countRecent(db: SupabaseClient, column: "ip_hash" | "email", value: string): Promise<number | null> {
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const { count, error } = await db
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq(column, value)
    .gte("created_at", since);
  if (error) {
    console.error(`contact-submit: rate count (${column}) failed:`, error.code, error.message);
    return null;
  }
  return count ?? 0;
}

// ─── E-mail to the inbox ──────────────────────────────────────────────────────

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

function utcStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** Sends the one e-mail to the inbox. true when Resend accepted it. Never throws. */
async function sendToInbox(s: Submission, id: string, createdAt: string): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.error("contact-submit: RESEND_API_KEY is not set; submission", id, "stored, not e-mailed");
    return false;
  }
  const label = SUBJECT_LABELS.get(s.subject) || s.subject;
  const replyTo = isEmail(s.email) ? s.email : null;
  const subjectLine = `[Smart Marina Connect] ${label} — ${s.name}`;
  const received = utcStamp(createdAt);

  // The address is plain escaped text, never a mailto: link (a crafted local part
  // could add headers such as bcc to the link); reply_to handles answering.
  const rows: [string, string][] = [
    ["Name", esc(s.name)],
    ["E-mail", esc(s.email)],
    ["Company", s.company ? esc(s.company) : "<span style=\"color:#94a3b8\">not given</span>"],
    ["Subject", esc(label)],
    ["Page", s.source ? esc(s.source) : "<span style=\"color:#94a3b8\">not given</span>"],
    ["Received", esc(received)],
    ["Submission ID", `<code>${esc(id)}</code>`],
  ];
  const tableRows = rows
    .map(([k, v]) =>
      `<tr><td style="padding:6px 16px 6px 0;color:#64748b;vertical-align:top;white-space:nowrap">${k}</td>` +
      `<td style="padding:6px 0;color:#0f172a;vertical-align:top">${v}</td></tr>`
    )
    .join("");
  const messageHtml = esc(s.message).replace(/\n/g, "<br>");

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">
<div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:24px">
<p style="margin:0 0 16px;font-size:16px;font-weight:bold;color:#0f172a">New message from the Smart Marina Connect contact form</p>
<table role="presentation" style="border-collapse:collapse;margin:0 0 16px">${tableRows}</table>
<div style="border-top:1px solid #e2e8f0;padding-top:16px;color:#0f172a">${messageHtml}</div>
<p style="margin:24px 0 0;font-size:12px;color:#64748b">${
    replyTo ? "Reply to this e-mail to answer the sender directly. " : ""
  }Stored in the platform as contact_submissions ${esc(id)}.</p>
</div></body></html>`;

  const text = [
    "New message from the Smart Marina Connect contact form",
    "",
    `Name: ${s.name}`,
    `E-mail: ${s.email}`,
    `Company: ${s.company || "not given"}`,
    `Subject: ${label}`,
    `Page: ${s.source || "not given"}`,
    `Received: ${received}`,
    `Submission ID: ${id}`,
    "",
    s.message,
    "",
    replyTo ? "Reply to this e-mail to answer the sender directly." : "",
  ].join("\n").trim();

  const payload: Record<string, unknown> = {
    from: SENDER_EMAIL,
    to: [INBOX],
    subject: subjectLine,
    html,
    text,
  };
  if (replyTo) payload.reply_to = replyTo;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("contact-submit: Resend error for submission", id, res.status, detail.slice(0, 300));
      return false;
    }
    await res.body?.cancel().catch(() => {});
    return true;
  } catch (e) {
    console.error("contact-submit: Resend request failed for submission", id, e instanceof Error ? e.name : "error");
    return false;
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const headers = { ...corsHeaders(req), "Content-Type": "application/json", "Cache-Control": "no-store" };
  const reply = (body: Record<string, unknown>, status: number) =>
    new Response(JSON.stringify(body), { status, headers });

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return reply({ error: "invalid" }, 405);

  // JSON only. A text/plain (or form) POST is a CORS "simple request": a browser
  // sends it from any site with no preflight, so the origin allowlist would never
  // apply. Requiring application/json forces the preflight.
  const contentType = (req.headers.get("content-type") || "").trim().toLowerCase();
  if (!contentType.startsWith("application/json")) return reply({ error: "invalid" }, 400);

  // Set once Resend has accepted the e-mail: the only point after which the
  // visitor may be told the message went out.
  let emailed = false;
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      console.error("contact-submit: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
      return reply({ error: "server" }, 500);
    }

    const raw = await readBody(req, MAX_BODY_BYTES);
    if (raw === null) return reply({ error: "invalid" }, 400);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return reply({ error: "invalid" }, 400);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return reply({ error: "invalid" }, 400);
    const body = parsed as Record<string, unknown>;

    // A bot filled the hidden field: same answer as a success, nothing kept or sent.
    if (honeypotFilled(body.website)) return reply({ ok: true }, 200);

    const submission = validate(body);
    if (!submission) return reply({ error: "invalid" }, 400);

    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const ipKey = await ipHash(clientIp(req));
    const userAgent = Array.from(oneLine(req.headers.get("user-agent") || "")).slice(0, 500).join("") || null;

    // 1. Store. Written before the rate-limit count, so concurrent calls see each
    //    other's rows and a burst cannot slip in between a count and an insert.
    const { data: row, error: insertError } = await db
      .from(TABLE)
      .insert({
        name: submission.name,
        email: submission.email,
        company: submission.company,
        subject: submission.subject,
        message: submission.message,
        source: submission.source,
        ip_hash: ipKey,
        user_agent: userAgent,
      })
      .select("id, created_at")
      .single();
    if (insertError || !row) {
      console.error("contact-submit: insert failed:", insertError?.code, insertError?.message);
      return reply({ error: "server" }, 500);
    }
    const { id, created_at: createdAt } = row as { id: string; created_at: string };

    // 2. Rate limit (this row included). Over the limit: the row is withdrawn and
    //    nothing is sent. A failed count lets the message through (fails open).
    const [ipCount, emailCount] = await Promise.all([
      ipKey ? countRecent(db, "ip_hash", ipKey) : Promise.resolve(null),
      countRecent(db, "email", submission.email),
    ]);
    if ((ipCount ?? 0) > MAX_PER_IP_PER_HOUR || (emailCount ?? 0) > MAX_PER_EMAIL_PER_HOUR) {
      const { error: deleteError } = await db.from(TABLE).delete().eq("id", id);
      if (deleteError) {
        console.error("contact-submit: could not withdraw over-limit submission", id, deleteError.code, deleteError.message);
        await db.from(TABLE).update({ status: "spam" }).eq("id", id);
      }
      console.warn("contact-submit: rate limited", (ipCount ?? 0) > MAX_PER_IP_PER_HOUR ? "(network)" : "(address)");
      return reply({ error: "rate_limited" }, 429);
    }

    // 3. E-mail the inbox. On failure the row is kept (emailed_at null) but the
    //    visitor gets 500 and the page's error box: the table alone is not read.
    emailed = await sendToInbox(submission, id, createdAt);
    if (!emailed) {
      console.error("contact-submit: stored", id, "-- e-mail FAILED, visitor told it was not sent (row kept in contact_submissions)");
      return reply({ error: "server" }, 500);
    }
    const { error: markError } = await db.from(TABLE).update({ emailed_at: new Date().toISOString() }).eq("id", id);
    if (markError) console.error("contact-submit: could not set emailed_at on", id, markError.code, markError.message);
    console.log("contact-submit: stored", id, "and e-mailed");
    return reply({ ok: true }, 200);
  } catch (err) {
    console.error("contact-submit: unexpected error:", err instanceof Error ? err.message : String(err));
    // Only once the inbox has the e-mail may the visitor be told it went out.
    return emailed ? reply({ ok: true }, 200) : reply({ error: "server" }, 500);
  }
});
