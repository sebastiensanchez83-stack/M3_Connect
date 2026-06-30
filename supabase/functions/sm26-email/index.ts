// SM26 transactional emails. Each "kind" has its own access rule:
//  - staff kinds (confirmed/paid/ecat_published/info_requested/declined/payment_reminder): admin/moderator only
//  - owner kinds (registration_received/admin_new_registration/admin_info_completed): the registrant (or staff)
//  - partner-or-staff (ecat_review): a yacht_club event partner or staff (the designer)
// Fire-and-forget from the UI; failures never block the action.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SENDER_EMAIL = Deno.env.get("SENDER_EMAIL") || "Smart Marina Connect <noreply@smartmarinaconnect.com>";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SITE_URL = Deno.env.get("SITE_URL") || "https://smartmarinaconnect.com";
const ADMIN_EMAIL = Deno.env.get("SM26_ADMIN_EMAIL") || "events@m3monaco.com";

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

const STAFF_KINDS = new Set(["confirmed", "paid", "ecat_published", "info_requested", "declined", "payment_reminder"]);
const OWNER_KINDS = new Set(["registration_received", "admin_new_registration", "admin_info_completed"]);
const PARTNER_KINDS = new Set(["ecat_review"]);

interface Reg { email?: string; first_name?: string; last_name?: string; company_name?: string; user_id?: string; role?: string }
interface Pay { amount_cents?: number | null; currency?: string | null; invoice_ref?: string | null; note?: string | null }

function content(kind: string, r: Reg, pay?: Pay | null): { subject: string; html: string; to: string } | null {
  const name = `${r.first_name || ""} ${r.last_name || ""}`.trim();
  const hi = `<p>Dear ${r.first_name || "participant"},</p>`;
  const foot = `<p style="color:#64748b;font-size:13px">Smart Marina Connect · M3 Monaco</p>`;
  const btn = (href: string, label: string) =>
    `<p><a href="${href}" style="background:#0b2653;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">${label}</a></p>`;
  const me = `${SITE_URL}/sm26/me`;
  const to = r.email || "";
  switch (kind) {
    case "registration_received":
      return { to, subject: `Registration received — ${EVENT}`,
        html: `${hi}<p>Thanks for registering for the <strong>${EVENT}</strong> (${WHEN}). We've received your registration — M3 will review and confirm your participation (and send any invoice) shortly. You can review or complete your details any time.</p>${btn(me, "View your participation")}${foot}` };
    case "info_requested":
      return { to, subject: `A few details needed — ${EVENT}`,
        html: `${hi}<p>To complete your registration for the <strong>${EVENT}</strong>, M3 needs a few more details from you. Open your participation page to see exactly what's needed and provide it there.</p>${btn(me, "Complete my details")}${foot}` };
    case "declined":
      return { to, subject: `Update on your ${EVENT} registration`,
        html: `${hi}<p>Thank you for your interest in the <strong>${EVENT}</strong>. After review, we're not able to confirm your participation for this edition. If you have any questions, please contact <a href="mailto:${ADMIN_EMAIL}">${ADMIN_EMAIL}</a>.</p>${foot}` };
    case "ecat_review":
      return { to, subject: `Your e-catalogue page is ready to review — ${EVENT}`,
        html: `${hi}<p>Your designed e-catalogue page for the <strong>${EVENT}</strong> is ready. Please review it and either approve it or request changes from your participation page.</p>${btn(me, "Review my page")}${foot}` };
    case "confirmed":
      return { to, subject: `You're confirmed — ${EVENT}`,
        html: `${hi}<p>Good news — your registration for the <strong>${EVENT}</strong> (${WHEN}) is <strong>confirmed</strong>.</p>${btn(me, "View your participation")}${foot}` };
    case "paid":
      return { to, subject: `Payment received — ${EVENT}`,
        html: `${hi}<p>We've recorded your payment for the <strong>${EVENT}</strong>. Your participation is now complete — thank you.</p>${btn(me, "View your participation")}${foot}` };
    case "ecat_published":
      return { to, subject: `Your e-catalogue page is live — ${EVENT}`,
        html: `${hi}<p>Your catalogue page for the <strong>${EVENT}</strong> is now published.</p>${btn(me, "View your page")}${foot}` };
    case "payment_reminder": {
      const cur = pay?.currency || "EUR";
      const amount = pay?.amount_cents != null ? `${(pay.amount_cents / 100).toFixed(2)} ${cur}` : null;
      const detail = amount
        ? `<p>Amount outstanding: <strong>${amount}</strong> (VAT excl.)${pay?.invoice_ref ? `<br>Invoice reference: <strong>${pay.invoice_ref}</strong>` : ""}</p>`
        : "";
      const note = pay?.note ? `<p>${pay.note}</p>` : "";
      return { to, subject: `Payment reminder — ${EVENT}`,
        html: `${hi}<p>This is a friendly reminder that we're still awaiting payment for your participation in the <strong>${EVENT}</strong> (${WHEN}).</p>${detail}${note}<p>Please arrange payment at your earliest convenience. If you've already paid, thank you — please disregard this message. For any question, contact <a href="mailto:${ADMIN_EMAIL}">${ADMIN_EMAIL}</a>.</p>${btn(me, "View your participation")}${foot}` };
    }
    case "admin_new_registration":
      return { to: ADMIN_EMAIL, subject: `New registration — ${name || r.email || "participant"}${r.company_name ? ` (${r.company_name})` : ""}`,
        html: `<p>A new registration came in for the <strong>${EVENT}</strong>:</p><p><strong>${name || "—"}</strong>${r.company_name ? ` — ${r.company_name}` : ""}${r.role ? `<br>Role: ${r.role}` : ""}<br>${r.email || ""}</p>${btn(`${SITE_URL}/admin/sm26`, "Open the registrations console")}${foot}` };
    case "admin_info_completed":
      return { to: ADMIN_EMAIL, subject: `Details updated — ${name || r.email || "participant"}${r.company_name ? ` (${r.company_name})` : ""}`,
        html: `<p><strong>${name || "A participant"}</strong>${r.company_name ? ` — ${r.company_name}` : ""} has updated their registration for the <strong>${EVENT}</strong> in response to an information request. Please review.</p>${btn(`${SITE_URL}/admin/sm26`, "Open the registrations console")}${foot}` };
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
    const { data: userData } = await admin.auth.getUser(token);
    const uid = userData?.user?.id;
    if (!uid) return json(req, { error: "Unauthorized" }, 401);

    const { registration_id, kind } = await req.json().catch(() => ({}));
    if (!registration_id || !kind) return json(req, { error: "Missing registration_id or kind" }, 400);

    const { data: prof } = await admin.from("profiles").select("persona, access_status").eq("user_id", uid).maybeSingle();
    const p = prof as { persona?: string; access_status?: string } | null;
    const isStaff = !!p && ["admin", "moderator"].includes(p.persona || "") && p.access_status === "verified";

    const { data: regRow } = await admin.from("sm_registration").select("email, first_name, last_name, company_name, user_id, event_id").eq("id", registration_id).maybeSingle();
    const reg = regRow as (Reg & { event_id?: string }) | null;
    if (!reg) return json(req, { error: "Registration not found" }, 404);

    // Access rule per kind.
    if (STAFF_KINDS.has(kind)) {
      if (!isStaff) return json(req, { error: "Forbidden" }, 403);
    } else if (OWNER_KINDS.has(kind)) {
      if (!isStaff && reg.user_id !== uid) return json(req, { error: "Forbidden" }, 403);
    } else if (PARTNER_KINDS.has(kind)) {
      let ok = isStaff;
      if (!ok && reg.event_id) {
        const { data: ep } = await admin.from("sm_event_partner").select("id").eq("user_id", uid).eq("event_id", reg.event_id).eq("kind", "yacht_club").maybeSingle();
        ok = !!ep;
      }
      if (!ok) return json(req, { error: "Forbidden" }, 403);
    } else {
      return json(req, { error: "Unknown kind" }, 400);
    }

    // For admin_new_registration, include the role for context.
    if (kind === "admin_new_registration") {
      const { data: ra } = await admin.from("sm_role_assignment").select("role").eq("registration_id", registration_id).order("created_at", { ascending: true }).limit(1).maybeSingle();
      reg.role = (ra as { role?: string } | null)?.role;
    }

    // For payment_reminder, read the saved payment so the figures are authoritative.
    let pay: Pay | null = null;
    if (kind === "payment_reminder") {
      const { data } = await admin.from("sm_payment").select("amount_cents, currency, invoice_ref, note").eq("registration_id", registration_id).maybeSingle();
      pay = data as Pay | null;
    }

    const c = content(kind, reg, pay);
    if (!c) return json(req, { error: "Unknown kind" }, 400);
    if (!c.to) return json(req, { ok: true, skipped: "no recipient" });
    if (!RESEND_API_KEY) return json(req, { ok: true, skipped: "no RESEND_API_KEY" });

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: SENDER_EMAIL, to: c.to, subject: c.subject, html: c.html }),
    });
    if (!resp.ok) { console.error("resend failed", await resp.text()); return json(req, { error: "Email send failed" }, 502); }
    return json(req, { ok: true });
  } catch (e) {
    console.error("sm26-email error", e);
    return json(req, { error: "Email could not be sent" }, 500);
  }
});
