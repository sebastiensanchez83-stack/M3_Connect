// SM26 transactional emails on key transitions (confirmed / paid / e-catalogue
// published). Staff-only: the caller must be an admin/moderator. Isolated from
// the platform's main send-notification function. Fire-and-forget from the admin
// UI — failures never block the admin action.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SENDER_EMAIL = Deno.env.get("SENDER_EMAIL") || "Smart Marina Connect <noreply@smartmarinaconnect.com>";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SITE_URL = Deno.env.get("SITE_URL") || "https://smartmarinaconnect.com";

const ALLOWED_ORIGINS = [
  "https://smartmarinaconnect.com",
  "https://m3connect.netlify.app",
  "http://localhost:5173",
  "http://localhost:3000",
];
const cors = (req: Request) => ({
  "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(req.headers.get("origin") || "") ? req.headers.get("origin")! : ALLOWED_ORIGINS[0],
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(req) } });

const EVENT = "Smart & Sustainable Marina Rendezvous 2026";

function content(kind: string, name: string): { subject: string; html: string } | null {
  const hi = `<p>Dear ${name || "participant"},</p>`;
  const foot = `<p style="color:#64748b;font-size:13px">Smart Marina Connect · Monaco Marina Management</p>`;
  const btn = (href: string, label: string) =>
    `<p><a href="${href}" style="background:#0b2653;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">${label}</a></p>`;
  switch (kind) {
    case "confirmed":
      return { subject: `You're confirmed — ${EVENT}`,
        html: `${hi}<p>Good news — your registration for the <strong>${EVENT}</strong> (20–21 September 2026, Yacht Club de Monaco) is <strong>confirmed</strong>.</p>${btn(`${SITE_URL}/sm26/me`, "View your participation")}${foot}` };
    case "paid":
      return { subject: `Payment received — ${EVENT}`,
        html: `${hi}<p>We've recorded your payment for the <strong>${EVENT}</strong>. Your participation is now complete — thank you.</p>${btn(`${SITE_URL}/sm26/me`, "View your participation")}${foot}` };
    case "ecat_published":
      return { subject: `Your e-catalogue page is live — ${EVENT}`,
        html: `${hi}<p>Your catalogue page for the <strong>${EVENT}</strong> is now published.</p>${btn(`${SITE_URL}/sm26/me`, "View your page")}${foot}` };
    default:
      return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  try {
    const token = (req.headers.get("authorization") || "").replace("Bearer ", "");
    if (!token) return json(req, { error: "Unauthorized" }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Caller must be staff (admin / moderator, verified).
    const { data: userData } = await admin.auth.getUser(token);
    const uid = userData?.user?.id;
    if (!uid) return json(req, { error: "Unauthorized" }, 401);
    const { data: prof } = await admin.from("profiles").select("persona, access_status").eq("user_id", uid).maybeSingle();
    const p = prof as { persona?: string; access_status?: string } | null;
    if (!p || !["admin", "moderator"].includes(p.persona || "") || p.access_status !== "verified") {
      return json(req, { error: "Forbidden" }, 403);
    }

    const { registration_id, kind } = await req.json().catch(() => ({}));
    if (!registration_id || !kind) return json(req, { error: "Missing registration_id or kind" }, 400);

    const { data: reg } = await admin.from("sm_registration").select("email, first_name").eq("id", registration_id).maybeSingle();
    const r = reg as { email?: string; first_name?: string } | null;
    if (!r?.email) return json(req, { ok: true, skipped: "no email" });

    const c = content(kind, r.first_name || "");
    if (!c) return json(req, { error: "Unknown kind" }, 400);
    if (!RESEND_API_KEY) return json(req, { ok: true, skipped: "no RESEND_API_KEY" });

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: SENDER_EMAIL, to: r.email, subject: c.subject, html: c.html }),
    });
    if (!resp.ok) { console.error("resend failed", await resp.text()); return json(req, { error: "Email send failed" }, 502); }
    return json(req, { ok: true });
  } catch (e) {
    console.error("sm26-email error", e);
    return json(req, { error: "Email could not be sent" }, 500);
  }
});
