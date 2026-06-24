// SM26 registration drafts: save a half-finished registration keyed by a random
// token and email the registrant a resume link; load it back on return. Public
// (no account needed) — the token is the secret. Drafts live in
// sm_registration_draft, separate from real registrations.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://smartmarinaconnect.com",
  "https://m3connect.netlify.app",
  "http://localhost:5173",
  "http://localhost:3000",
];
const NETLIFY_SUBDOMAIN = /^https:\/\/[a-z0-9-]+--m3connect\.netlify\.app$/;
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

async function sendResumeEmail(email: string, firstName: string, link: string) {
  if (!RESEND_API_KEY) { console.error("RESEND_API_KEY not set"); return; }
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
<p style="margin:24px 0 0;color:#9ca3af;font-size:13px;">If you didn't start a registration, you can ignore this email.</p>
</td></tr></table></td></tr></table></body></html>`.trim();
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: SENDER_EMAIL, to: [email], subject: "Continue your Smart Marina Rendezvous 2026 registration", html }),
  });
  if (!res.ok) console.error("resend draft email error", res.status, await res.text());
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(req, { error: "Invalid JSON" }, 400); }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });
  const action = body.action;

  if (action === "load") {
    const token = typeof body.token === "string" ? body.token : "";
    if (!token) return json(req, { error: "Missing token" }, 400);
    const { data } = await admin.from("sm_registration_draft").select("data, email").eq("token", token).maybeSingle();
    if (!data) return json(req, { error: "not_found" }, 404);
    const d = data as { data: unknown; email: string };
    return json(req, { data: d.data, email: d.email });
  }

  if (action === "save") {
    const email = (typeof body.email === "string" ? body.email : "").trim().toLowerCase();
    if (!email || !email.includes("@")) return json(req, { error: "A valid email is required to save" }, 400);
    const payload = (body.data ?? {}) as Record<string, unknown>;
    const origin = typeof body.origin === "string" ? body.origin : "";

    const { data: ev } = await admin.from("sm_event").select("id").eq("slug", "sm26").maybeSingle();
    if (!ev) return json(req, { error: "Event not available" }, 400);
    const eventId = (ev as { id: string }).id;

    const { data: existing } = await admin.from("sm_registration_draft")
      .select("token").eq("event_id", eventId).eq("email", email).maybeSingle();
    let token = (existing as { token?: string } | null)?.token;
    if (token) {
      await admin.from("sm_registration_draft").update({ data: payload, updated_at: new Date().toISOString() }).eq("token", token);
    } else {
      token = crypto.randomUUID();
      const { error } = await admin.from("sm_registration_draft").insert({ token, event_id: eventId, email, data: payload });
      if (error) { console.error("draft insert failed", error); return json(req, { error: "Could not save" }, 500); }
    }

    const base = isAllowedOrigin(origin) ? origin : "https://smartmarinaconnect.com";
    const link = `${base}/sm26/register?draft=${token}`;
    const reg = (payload.form ?? {}) as Record<string, unknown>;
    const firstName = typeof reg.first_name === "string" ? reg.first_name : "";
    try { await sendResumeEmail(email, firstName, link); } catch (e) { console.error("resume email failed", e); }
    return json(req, { ok: true });
  }

  return json(req, { error: "Unknown action" }, 400);
});
