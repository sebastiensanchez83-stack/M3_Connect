// Account status e-mail (approved / rejected / suspended) sent to one member.
//
// Caller (checked 7 Oct 2026): src/components/admin/AdminUsers.tsx
// sendStatusNotification(), right after the admin has written the new
// access_status (and rejection_reason) on the member's profile. The browser
// session JWT is sent by supabase.functions.invoke; the extra
// x-caller-user-id header it adds is ignored (kept in CORS so the preflight passes).
//
// Security (audit S9, 7 Oct 2026): this function used to be public -- anyone
// could e-mail any member a fake "account rejected" with free text (member ids
// are readable from public team lists). Now:
//   - caller must be a signed-in VERIFIED admin or moderator (sm_is_staff()
//     test), or the service role;
//   - the recipient is resolved here from user_id;
//   - the requested status must be the member's CURRENT access_status, so the
//     e-mail can only confirm a decision already recorded;
//   - the rejection reason comes from profiles.rejection_reason (caller text
//     only as a fallback), capped; every interpolated value is HTML-escaped.
// verify_jwt stays false: the function authenticates its caller itself.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SENDER_EMAIL = Deno.env.get("SENDER_EMAIL") || "Smart Marina Connect <noreply@smartmarinaconnect.com>";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SITE_URL = Deno.env.get("SITE_URL") || "https://smartmarinaconnect.com";

const ALLOWED_ORIGINS = [
  "https://smartmarinaconnect.com",
  "https://m3connect.netlify.app",
  "http://localhost:5173",
  "http://localhost:3000",
];

const STATUSES = new Set(["verified", "rejected", "suspended"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REASON_CHARS = 2000;

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-caller-user-id",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function sameSecret(a: string, b: string): boolean {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cleanText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  // deno-lint-ignore no-control-regex
  return v.replace(/(?!\n)\p{Cc}/gu, "").trim().slice(0, max);
}

Deno.serve(async (req: Request) => {
  const headers = { "Content-Type": "application/json", ...corsHeaders(req) };
  const reply = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers });

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  try {
    if (!RESEND_API_KEY) return reply({ error: "RESEND_API_KEY not configured" }, 500);
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return reply({ error: "Server not configured" }, 500);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── Caller: service role, or a verified admin / moderator. ──
    const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!bearer) return reply({ error: "Unauthorized" }, 401);
    if (!sameSecret(bearer, SUPABASE_SERVICE_ROLE_KEY)) {
      const { data: callerData } = await supabase.auth.getUser(bearer);
      const caller = callerData?.user;
      if (!caller?.id) return reply({ error: "Unauthorized" }, 401);
      const { data: cp } = await supabase
        .from("profiles")
        .select("persona, access_status")
        .eq("user_id", caller.id)
        .maybeSingle();
      const isStaff = !!cp && ["admin", "moderator"].includes(cp.persona || "") && cp.access_status === "verified";
      if (!isStaff) return reply({ error: "Forbidden" }, 403);
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const user_id = typeof body?.user_id === "string" ? body.user_id.trim() : "";
    const status = typeof body?.status === "string" ? body.status : "";
    if (!user_id || !status) return reply({ error: "user_id and status are required" }, 400);
    if (!UUID_RE.test(user_id)) return reply({ error: "Invalid user_id" }, 400);
    if (!STATUSES.has(status)) return reply({ error: "Invalid status" }, 400);

    const { data: profile } = await supabase
      .from("profiles")
      .select("first_name, email, access_status, rejection_reason")
      .eq("user_id", user_id)
      .maybeSingle();
    if (!profile) return reply({ error: "User not found" }, 404);

    // The e-mail may only confirm the status already recorded on the profile.
    if (profile.access_status !== status) {
      return reply({ error: "Status does not match the member's current status" }, 409);
    }

    let email: string = profile.email || "";
    let firstName: string = profile.first_name || "";
    if (!email) {
      const { data: authData } = await supabase.auth.admin.getUserById(user_id);
      const user = authData?.user;
      if (!user?.email) return reply({ error: "User email not found" }, 404);
      email = user.email;
      firstName = firstName || (user.user_metadata?.first_name as string | undefined) || "";
    }

    const reason = status === "rejected"
      ? cleanText(profile.rejection_reason, MAX_REASON_CHARS) || cleanText(body?.reason, MAX_REASON_CHARS)
      : "";

    return await sendNotification(email, cleanText(firstName, 100), status, reason, headers);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error in send-status-notification:", message);
    return reply({ error: "Internal error" }, 500);
  }
});

async function sendNotification(
  email: string,
  firstName: string,
  status: string,
  reason: string,
  headers: Record<string, string>,
): Promise<Response> {
  // firstName and reason are member/admin-entered text: escaped before they reach HTML.
  const greeting = firstName ? `Hello ${escapeHtml(firstName)},` : "Hello,";
  const loginUrl = `${SITE_URL}/`;

  let subject: string;
  let title: string;
  let body: string;
  let buttonText: string;
  const buttonUrl: string = loginUrl;
  let footer: string;

  switch (status) {
    case "verified":
      subject = "Your Smart Marina Connect account has been approved!";
      title = "Account Approved";
      body = "Great news! Your Smart Marina Connect account has been reviewed and approved. You now have full access to the platform. Log in to explore resources, events, and connect with the marina industry network.";
      buttonText = "Log In to Smart Marina Connect";
      footer = "Welcome aboard! If you have any questions, don't hesitate to contact our support team.";
      break;
    case "rejected":
      subject = "Update on your Smart Marina Connect application";
      title = "Application Update";
      body = `We've reviewed your Smart Marina Connect application and unfortunately it has not been approved at this time.${reason ? `\n\nReason: ${escapeHtml(reason)}` : ""}\n\nYou can update your profile and resubmit your application for another review.`;
      buttonText = "Update My Profile";
      footer = "If you believe this was a mistake or have questions, please contact our support team.";
      break;
    case "suspended":
      subject = "Your Smart Marina Connect account has been suspended";
      title = "Account Suspended";
      body = "Your Smart Marina Connect account has been temporarily suspended. During this time, you will not be able to access platform features.";
      buttonText = "Contact Support";
      footer = "If you believe this was done in error, please contact our support team for clarification.";
      break;
    default:
      return new Response(JSON.stringify({ error: "Invalid status" }), { status: 400, headers });
  }

  const html = buildEmail({ greeting, title, body, buttonText, buttonUrl, footer });

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: SENDER_EMAIL,
      to: [email],
      subject,
      html,
    }),
  });

  const resBody = await res.text();
  if (!res.ok) {
    console.error("Resend API error:", res.status, resBody);
    return new Response(JSON.stringify({ error: "Email provider error" }), { status: 502, headers });
  }

  console.log("Status notification sent, status:", status);
  return new Response(JSON.stringify({ success: true }), { status: 200, headers });
}

interface EmailTemplateProps {
  greeting: string;
  title: string;
  body: string;
  buttonText: string;
  buttonUrl: string;
  footer: string;
}

function buildEmail({ greeting, title, body, buttonText, buttonUrl, footer }: EmailTemplateProps): string {
  const htmlBody = body.replace(/\n/g, "<br>");
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f5f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f5f7; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">
          <tr>
            <td style="background-color: #0c4a6e; padding: 32px 40px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">Smart Marina Connect</h1>
              <p style="margin: 6px 0 0; color: #93c5fd; font-size: 13px; font-weight: 400;">The B2B platform for the marina industry</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 8px; color: #374151; font-size: 16px; line-height: 1.5;">${greeting}</p>
              <h2 style="margin: 0 0 16px; color: #111827; font-size: 20px; font-weight: 600;">${title}</h2>
              <p style="margin: 0 0 32px; color: #4b5563; font-size: 15px; line-height: 1.6;">${htmlBody}</p>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 0 auto;">
                <tr>
                  <td style="background-color: #0c4a6e; border-radius: 8px;">
                    <a href="${buttonUrl}" target="_blank" style="display: inline-block; padding: 14px 32px; color: #ffffff; font-size: 15px; font-weight: 600; text-decoration: none; letter-spacing: 0.3px;">${buttonText}</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 32px 0 0; color: #9ca3af; font-size: 13px; line-height: 1.5;">${footer}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 40px; background-color: #f9fafb; border-top: 1px solid #e5e7eb; text-align: center;">
              <p style="margin: 0; color: #9ca3af; font-size: 12px;">&copy; ${new Date().getFullYear()} Smart Marina Connect</p>
              <p style="margin: 4px 0 0; color: #9ca3af; font-size: 12px;">The B2B platform for the marina industry</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}
