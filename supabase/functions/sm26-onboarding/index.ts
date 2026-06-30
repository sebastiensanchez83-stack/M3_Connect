// SM26 onboarding invites: email every registration that has NO account yet a
// link to create their account and claim their registration (/sm26/claim?code=).
// Staff-triggered from the admin Overview; repeatable (re-targets only the people
// still not on the platform, since they drop off once user_id is set). A one-off
// test mode sends a single preview to the caller.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SENDER_EMAIL = Deno.env.get("SENDER_EMAIL") || "Smart Marina Connect <noreply@smartmarinaconnect.com>";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SITE_URL = Deno.env.get("SITE_URL") || "https://smartmarinaconnect.com";

const ALLOWED_ORIGINS = [
  "https://smartmarinaconnect.com", "https://m3connect.netlify.app",
  "http://localhost:5173", "http://localhost:3000",
];
const NETLIFY_SUBDOMAIN = /^https:\/\/[a-z0-9-]+--m3connect\.netlify\.app$/;
const isAllowedOrigin = (o: string) => ALLOWED_ORIGINS.includes(o) || NETLIFY_SUBDOMAIN.test(o);
const cors = (req: Request) => {
  const o = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(o) ? o : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
};
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(req) } });

const EVENT = "Smart & Sustainable Marina Rendezvous 2026";
const WHEN = "20–21 September 2026, Yacht Club de Monaco";

async function sendOnboarding(email: string, firstName: string, code: string): Promise<boolean> {
  if (!RESEND_API_KEY) { console.error("no RESEND_API_KEY"); return false; }
  const link = `${SITE_URL}/sm26/claim?code=${encodeURIComponent(code)}`;
  const hi = `<p>Dear ${firstName || "participant"},</p>`;
  const btn = `<p><a href="${link}" style="background:#0b2653;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600">Create my account &amp; access my registration</a></p>`;
  const html =
    `${hi}<p>Your registration for the <strong>${EVENT}</strong> (${WHEN}) is set up and waiting for you.</p>` +
    `<p>Create your Smart Marina Connect account to access your space — complete your details, follow the programme, book workshops, and more.</p>` +
    btn +
    `<p style="font-size:13px;color:#64748b;line-height:1.5">Signing up links your registration automatically. If you're asked for it, your claim code is <strong>${code}</strong>.</p>` +
    `<p style="color:#64748b;font-size:12px">Smart Marina Connect · M3 Monaco</p>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: SENDER_EMAIL, to: [email], subject: `Your ${EVENT} space is ready — create your account`, html }),
  });
  if (!res.ok) { console.error("onboarding send failed", res.status, await res.text()); return false; }
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const body = await req.json().catch(() => ({})) as { test_email?: string; registration_id?: string };
  const testEmail = typeof body.test_email === "string" ? body.test_email.trim() : "";

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Staff only.
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "");
  if (!token) return json(req, { error: "Unauthorized" }, 401);
  const { data: u } = await admin.auth.getUser(token);
  const uid = u?.user?.id;
  if (!uid) return json(req, { error: "Unauthorized" }, 401);
  const { data: prof } = await admin.from("profiles").select("persona, access_status").eq("user_id", uid).maybeSingle();
  const p = prof as { persona?: string; access_status?: string } | null;
  if (!p || !["admin", "moderator"].includes(p.persona || "") || p.access_status !== "verified") {
    return json(req, { error: "Forbidden" }, 403);
  }

  const { data: ev } = await admin.from("sm_event").select("id").eq("slug", "sm26").maybeSingle();
  if (!ev) return json(req, { error: "Event not found" }, 404);
  const eventId = (ev as { id: string }).id;

  if (testEmail) {
    const ok = await sendOnboarding(testEmail, "there", "SM26-TESTCODE");
    return json(req, { ok, test: true });
  }

  // Single targeted invite, triggered from one registration's profile in admin.
  const regId = typeof body.registration_id === "string" ? body.registration_id.trim() : "";
  if (regId) {
    const { data: one } = await admin.from("sm_registration")
      .select("email, first_name, claim_code, status, user_id")
      .eq("id", regId).eq("event_id", eventId).maybeSingle();
    const r = one as { email?: string | null; first_name?: string | null; claim_code?: string | null; status?: string; user_id?: string | null } | null;
    if (!r) return json(req, { error: "Registration not found" }, 404);
    if (r.user_id) return json(req, { error: "This person already has an account." }, 400);
    if (["declined", "cancelled"].includes(r.status || "")) return json(req, { error: "This registration is declined or cancelled." }, 400);
    if (!r.email || !r.claim_code) return json(req, { error: "No email or claim code on file." }, 400);
    const ok = await sendOnboarding(r.email, r.first_name || "there", r.claim_code);
    return json(req, { ok, sent: ok ? 1 : 0 });
  }

  // Registrations with no account yet — the people not on the platform.
  const { data: regs } = await admin.from("sm_registration")
    .select("email, first_name, claim_code, status")
    .eq("event_id", eventId)
    .is("user_id", null)
    .not("email", "is", null)
    .not("claim_code", "is", null);
  const list = (regs || []) as { email: string | null; first_name: string | null; claim_code: string | null; status: string }[];

  let n = 0;
  for (const r of list) {
    if (!r.email || !r.claim_code || ["declined", "cancelled"].includes(r.status)) continue;
    const ok = await sendOnboarding(r.email, r.first_name || "there", r.claim_code);
    if (ok) n++;
  }
  return json(req, { ok: true, sent: n });
});
