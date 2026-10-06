// SM26 registration drafts: save a half-finished registration keyed by a random
// token and email the registrant a resume link; load it back on return. Public
// (no account needed) — the token is the secret. Drafts live in
// sm_registration_draft, separate from real registrations.
//
// Audit S9 (two fixes):
//  * Drafts close with registrations. Both actions answer 403
//    { error, code: "registrations_closed" } unless sm_registrations_open(event)
//    is true (closed by default; refused too if the check cannot be made).
//  * A save used to hand back the EXISTING draft's token for any email typed in,
//    so anyone could save under someone else's address, keep the link, and read
//    whatever that person saved afterwards. Now a save for an email that already
//    has a draft gives that draft a NEW token, emails the new link to the address
//    only, and returns no link to the caller. Earlier links for that email stop
//    working (only the latest email's link opens it). A brand-new draft still
//    returns its link, as before, for the bounced-email case.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://smartmarinaconnect.com",
  "https://m3connect.netlify.app",
  "https://m3connectv2.netlify.app",
  "http://localhost:5173",
  "http://localhost:3000",
];
// The v2 site and its previews were missing here while every other SM26 function
// allows them, so a save from a v2 preview got another origin's CORS header back.
const NETLIFY_SUBDOMAIN = /^https:\/\/[a-z0-9-]+--m3connect(v2)?\.netlify\.app$/;
function isAllowedOrigin(o: string): boolean {
  return ALLOWED_ORIGINS.includes(o) || NETLIFY_SUBDOMAIN.test(o);
}
function cors(req: Request) {
  const o = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(o) ? o : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(req) } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SENDER_EMAIL = Deno.env.get("SENDER_EMAIL") || "Smart Marina Connect <noreply@smartmarinaconnect.com>";

// Returns whether the mail actually went. The caller used to promise the
// registrant "we've emailed you a link" no matter what happened here, so a
// silent Resend failure looked exactly like a save that never worked.
async function sendResumeEmail(email: string, firstName: string, link: string): Promise<boolean> {
  if (!RESEND_API_KEY) { console.error("RESEND_API_KEY not set"); return false; }
  const hi = firstName ? `Hello ${firstName},` : "Hello,";
  const html = `
<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:40px 20px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;">
<tr><td style="background:#0b2653;padding:28px 40px;text-align:center;"><h1 style="margin:0;color:#fff;font-size:20px;">Smart &amp; Sustainable Marina Rendezvous 2026</h1></td></tr>
<tr><td style="padding:36px 40px;">
<p style="margin:0 0 8px;color:#374151;font-size:16px;">${hi}</p>
<h2 style="margin:0 0 14px;color:#111827;font-size:19px;">Your registration is saved</h2>
<p style="margin:0 0 24px;color:#4b5563;font-size:15px;line-height:1.6;">You can finish it any time, on any device, from where you left off. Click below to continue.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr><td style="background:#0b2653;border-radius:8px;"><a href="${link}" target="_blank" style="display:inline-block;padding:13px 30px;color:#fff;font-size:15px;font-weight:600;text-decoration:none;">Continue my registration</a></td></tr></table>
<p style="margin:24px 0 0;color:#6b7280;font-size:13px;word-break:break-all;">Or paste this into your browser:<br>${link}</p>
<p style="margin:16px 0 0;color:#9ca3af;font-size:13px;">If you didn't start a registration, you can ignore this email.</p>
</td></tr></table></td></tr></table></body></html>`.trim();
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: SENDER_EMAIL, to: [email], subject: "Continue your Smart Marina Rendezvous 2026 registration", html }),
  });
  if (!res.ok) { console.error("resend draft email error", res.status, await res.text()); return false; }
  return true;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(req, { error: "Invalid JSON" }, 400); }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });
  const action = body.action;
  if (action !== "load" && action !== "save") return json(req, { error: "Unknown action" }, 400);

  const { data: ev } = await admin.from("sm_event").select("id").eq("slug", "sm26").maybeSingle();
  if (!ev) return json(req, { error: "Event not available" }, 400);
  const eventId = (ev as { id: string }).id;

  // Drafts live and die with registrations (closed by default).
  const { data: isOpen, error: openErr } = await admin.rpc("sm_registrations_open", { p_event_id: eventId });
  if (openErr) console.error("sm_registrations_open failed -- refusing", openErr);
  if (openErr || isOpen !== true) {
    return json(req, { error: "Registrations are closed", code: "registrations_closed" }, 403);
  }

  if (action === "load") {
    // trim(): a token copied out of an email arrives with whitespace often enough,
    // and an untrimmed one answers 404 — indistinguishable from an expired link.
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) return json(req, { error: "Missing token" }, 400);
    const { data } = await admin.from("sm_registration_draft").select("data, email").eq("token", token).eq("event_id", eventId).maybeSingle();
    if (!data) return json(req, { error: "not_found" }, 404);
    const d = data as { data: unknown; email: string };
    return json(req, { data: d.data, email: d.email });
  }

  if (action === "save") {
    const email = (typeof body.email === "string" ? body.email : "").trim().toLowerCase();
    if (!email || !email.includes("@")) return json(req, { error: "A valid email is required to save" }, 400);
    const payload = (body.data ?? {}) as Record<string, unknown>;
    const origin = typeof body.origin === "string" ? body.origin : "";

    // The unique index is on (event_id, lower(email)) and email is stored
    // lower-cased, so this finds the one draft for this address if there is one.
    const { data: existing } = await admin.from("sm_registration_draft")
      .select("token").eq("event_id", eventId).eq("email", email).maybeSingle();
    const oldToken = (existing as { token?: string } | null)?.token;
    // Fresh token on EVERY save: a token someone else obtained earlier stops
    // working the moment the owner saves again.
    const token = crypto.randomUUID();
    if (oldToken) {
      const { error } = await admin.from("sm_registration_draft")
        .update({ token, data: payload, updated_at: new Date().toISOString() }).eq("token", oldToken);
      if (error) { console.error("draft update failed", error); return json(req, { error: "Could not save" }, 500); }
    } else {
      const { error } = await admin.from("sm_registration_draft").insert({ token, event_id: eventId, email, data: payload });
      if (error) { console.error("draft insert failed", error); return json(req, { error: "Could not save" }, 500); }
    }

    const base = isAllowedOrigin(origin) ? origin : "https://smartmarinaconnect.com";
    const link = `${base}/sm26/register?draft=${token}`;
    const reg = (payload.form ?? {}) as Record<string, unknown>;
    const firstName = typeof reg.first_name === "string" ? reg.first_name : "";
    let emailed = false;
    try { emailed = await sendResumeEmail(email, firstName, link); } catch (e) { console.error("resume email failed", e); }
    // A brand-new draft: the link goes back to the caller too, so a registrant
    // whose email bounced still has a way to return. A draft that already existed
    // for this address may not be the caller's: its link goes to the inbox only
    // (the page then says "this browser will remember your answers").
    return json(req, { ok: true, emailed, link: oldToken ? null : link });
  }

  return json(req, { error: "Unknown action" }, 400);
});
