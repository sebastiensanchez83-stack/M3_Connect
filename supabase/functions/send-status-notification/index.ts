import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SENDER_EMAIL = Deno.env.get("SENDER_EMAIL") || "M3 Connect <noreply@m3monaco.com>";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SITE_URL = Deno.env.get("SITE_URL") || "https://m3connect.netlify.app";

interface RequestBody {
  user_id: string;
  status: "verified" | "rejected" | "suspended" | "payment_pending";
  reason?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" } });
  }

  try {
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }

    const body: RequestBody = await req.json();
    const { user_id, status, reason } = body;

    if (!user_id || !status) {
      return new Response(JSON.stringify({ error: "user_id and status are required" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: profile } = await supabase.from("profiles").select("first_name, last_name, email").eq("user_id", user_id).maybeSingle();

    if (!profile?.email) {
      const { data: { user } } = await supabase.auth.admin.getUserById(user_id);
      if (!user?.email) {
        return new Response(JSON.stringify({ error: "User email not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
      }
      const email = user.email;
      const firstName = profile?.first_name || user.user_metadata?.first_name || "";
      return await sendNotification(email, firstName, status, reason);
    }

    const firstName = profile.first_name || "";
    return await sendNotification(profile.email, firstName, status, reason);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error in send-status-notification:", message);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

async function sendNotification(email: string, firstName: string, status: string, reason?: string): Promise<Response> {
  const greeting = firstName ? `Hello ${firstName},` : "Hello,";
  const loginUrl = `${SITE_URL}/`;

  let subject: string;
  let title: string;
  let body: string;
  let buttonText: string;
  let buttonUrl: string = loginUrl;
  let footer: string;

  switch (status) {
    case "verified":
      subject = "Your M3 Connect account has been approved!";
      title = "Account Approved";
      body = "Great news! Your M3 Connect account has been reviewed and approved. You now have full access to the platform. Log in to explore resources, events, and connect with the marina industry network.";
      buttonText = "Log In to M3 Connect";
      footer = "Welcome aboard! If you have any questions, don't hesitate to contact our support team.";
      break;
    case "payment_pending":
      subject = "Your M3 Connect account is approved — Complete your membership payment";
      title = "Account Approved — Payment Required";
      body = "Great news! Your M3 Connect account has been reviewed and approved by our team.\n\nTo activate your full membership and access all platform features, please complete your annual membership fee of €500.\n\nUntil the payment is completed, you will have limited access to the platform. Once paid, you will unlock:\n\n• Full access to M3 Connect resources and events\n• B2B marketplace and partner directory\n• Connect requests and webinar proposals\n• Team collaboration with additional seats";
      buttonText = "Pay Membership Fee (€500)";
      buttonUrl = `${SITE_URL}/account?tab=organization&action=pay-membership`;
      footer = "This is a one-time annual fee for your organization's membership. If you have any questions about the payment, please contact our support team.";
      break;
    case "rejected":
      subject = "Update on your M3 Connect application";
      title = "Application Update";
      body = `We've reviewed your M3 Connect application and unfortunately it has not been approved at this time.${reason ? `\n\nReason: ${reason}` : ""}\n\nYou can update your profile and resubmit your application for another review.`;
      buttonText = "Update My Profile";
      footer = "If you believe this was a mistake or have questions, please contact our support team.";
      break;
    case "suspended":
      subject = "Your M3 Connect account has been suspended";
      title = "Account Suspended";
      body = "Your M3 Connect account has been temporarily suspended. During this time, you will not be able to access platform features.";
      buttonText = "Contact Support";
      footer = "If you believe this was done in error, please contact our support team for clarification.";
      break;
    default:
      return new Response(JSON.stringify({ error: "Invalid status" }), { status: 400, headers: { "Content-Type": "application/json" } });
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
    return new Response(JSON.stringify({ error: `Resend error: ${resBody}` }), { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  }

  console.log("Status notification sent to:", email, "status:", status);
  return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
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
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">M3 Connect</h1>
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
              <p style="margin: 0; color: #9ca3af; font-size: 12px;">&copy; ${new Date().getFullYear()} Monaco Marina Management — M3 Connect</p>
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
