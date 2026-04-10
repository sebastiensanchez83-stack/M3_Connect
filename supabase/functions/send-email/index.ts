import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const HOOK_SECRET = Deno.env.get("SEND_EMAIL_HOOK_SECRET");
const SENDER_EMAIL = Deno.env.get("SENDER_EMAIL") || "Smart Marina Connect <noreply@smartmarinaconnect.com>";

interface EmailPayload {
  user: {
    email: string;
    user_metadata?: {
      first_name?: string;
      last_name?: string;
    };
  };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: string;
    site_url: string;
    token_new?: string;
    token_hash_new?: string;
  };
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: { message: "Method not allowed" } }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!RESEND_API_KEY) {
      console.error("FATAL: RESEND_API_KEY environment variable is not set");
      return new Response(JSON.stringify({ error: { http_code: 500, message: "RESEND_API_KEY not configured" } }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!HOOK_SECRET) {
      console.error("FATAL: SEND_EMAIL_HOOK_SECRET environment variable is not set");
      return new Response(JSON.stringify({ error: { http_code: 500, message: "SEND_EMAIL_HOOK_SECRET not configured" } }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const payload = await req.text();
    const headers = Object.fromEntries(req.headers);

    const wh = new Webhook(HOOK_SECRET.replace("v1,whsec_", ""));

    let data: EmailPayload;
    try {
      data = wh.verify(payload, headers) as EmailPayload;
    } catch (err) {
      console.error("Webhook verification failed:", err);
      return new Response(JSON.stringify({ error: { http_code: 401, message: "Invalid signature" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { user, email_data } = data;
    const { token_hash, redirect_to, email_action_type, site_url } = email_data;

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const redirectTarget = redirect_to || site_url;
    const confirmUrl = `${supabaseUrl}/auth/v1/verify?token=${token_hash}&type=${email_action_type}&redirect_to=${encodeURIComponent(redirectTarget)}`;

    const firstName = user.user_metadata?.first_name || "";
    const greeting = firstName ? `Hello ${firstName},` : "Hello,";

    let subject: string;
    let html: string;

    switch (email_action_type) {
      case "signup":
        subject = "Confirm your Smart Marina Connect account";
        html = buildEmail({
          greeting,
          title: "Welcome to Smart Marina Connect!",
          body: "Thank you for creating your account. Please confirm your email address by clicking the button below.",
          buttonText: "Confirm Email",
          buttonUrl: confirmUrl,
          footer: "If you did not create an account, you can safely ignore this email.",
        });
        break;
      case "recovery":
        subject = "Reset your Smart Marina Connect password";
        html = buildEmail({
          greeting,
          title: "Password Reset Request",
          body: "We received a request to reset your password. Click the button below to choose a new password.",
          buttonText: "Reset Password",
          buttonUrl: confirmUrl,
          footer: "If you did not request a password reset, you can safely ignore this email. This link will expire in 24 hours.",
        });
        break;
      case "email_change":
        subject = "Confirm your new email address — Smart Marina Connect";
        html = buildEmail({
          greeting,
          title: "Email Change Confirmation",
          body: "You requested to change your email address. Please confirm this change by clicking the button below.",
          buttonText: "Confirm Email Change",
          buttonUrl: confirmUrl,
          footer: "If you did not request this change, please contact support immediately.",
        });
        break;
      case "magiclink":
        subject = "Your Smart Marina Connect login link";
        html = buildEmail({
          greeting,
          title: "Login Link",
          body: "Click the button below to log in to your Smart Marina Connect account.",
          buttonText: "Log In",
          buttonUrl: confirmUrl,
          footer: "If you did not request this login link, you can safely ignore this email.",
        });
        break;
      case "invite":
        subject = "You're invited to Smart Marina Connect";
        html = buildEmail({
          greeting: "Hello,",
          title: "You've Been Invited!",
          body: "You have been invited to join Smart Marina Connect, the B2B platform for the marina industry. Click the button below to accept your invitation and set up your account.",
          buttonText: "Accept Invitation",
          buttonUrl: confirmUrl,
          footer: "If you were not expecting this invitation, you can safely ignore this email.",
        });
        break;
      default:
        subject = "Smart Marina Connect — Action Required";
        html = buildEmail({
          greeting,
          title: "Action Required",
          body: "Please click the button below to complete your action.",
          buttonText: "Continue",
          buttonUrl: confirmUrl,
          footer: "If you did not initiate this action, you can safely ignore this email.",
        });
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: SENDER_EMAIL,
        to: [user.email],
        subject,
        html,
      }),
    });

    const resBody = await res.text();

    if (!res.ok) {
      console.error("Resend API error:", res.status, resBody);
      return new Response(
        JSON.stringify({ error: { http_code: 500, message: `Resend API error: ${res.status} - ${resBody}` } }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    let result;
    try {
      result = JSON.parse(resBody);
    } catch {
      result = { raw: resBody };
    }

    console.log("Email sent successfully:", result.id || result.raw, "to:", user.email, "type:", email_action_type);

    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : "";
    console.error("UNHANDLED ERROR in send-email hook:", message, "\nStack:", stack);
    return new Response(
      JSON.stringify({ error: { http_code: 500, message } }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// ---- Email template builder ----

interface EmailTemplateProps {
  greeting: string;
  title: string;
  body: string;
  buttonText: string;
  buttonUrl: string;
  footer: string;
}

function buildEmail({ greeting, title, body, buttonText, buttonUrl, footer }: EmailTemplateProps): string {
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
          <!-- Header -->
          <tr>
            <td style="background-color: #0c4a6e; padding: 32px 40px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">Smart Marina Connect</h1>
              <p style="margin: 6px 0 0; color: #93c5fd; font-size: 13px; font-weight: 400;">The B2B platform for the marina industry</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 8px; color: #374151; font-size: 16px; line-height: 1.5;">${greeting}</p>
              <h2 style="margin: 0 0 16px; color: #111827; font-size: 20px; font-weight: 600;">${title}</h2>
              <p style="margin: 0 0 32px; color: #4b5563; font-size: 15px; line-height: 1.6;">${body}</p>
              <!-- Button -->
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
          <!-- Footer -->
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
