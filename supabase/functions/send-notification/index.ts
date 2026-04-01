import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SENDER_EMAIL = Deno.env.get("SENDER_EMAIL") || "M3 Connect <noreply@m3monaco.com>";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SITE_URL = Deno.env.get("SITE_URL") || "https://connect.m3monaco.com";

const ALLOWED_ORIGINS = [
  "https://connect.m3monaco.com",
  "https://m3connect.netlify.app",
  "http://localhost:5173",
  "http://localhost:3000",
];

function getCorsOrigin(req: Request): string {
  const origin = req.headers.get("origin") || "";
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

function corsHeaders(req: Request) {
  return {
    "Access-Control-Allow-Origin": getCorsOrigin(req),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

// ──────────────────────────────────────────────
// Notification types and their email templates
// ──────────────────────────────────────────────

type NotificationType =
  | "webinar_accepted"
  | "webinar_rejected"
  | "webinar_moderator_approved"
  | "rfp_submitted"
  | "rfp_closed"
  | "consultation_submitted"
  | "consultation_closed"
  | "exposition_approved"
  | "exposition_invoice_sent"
  | "exposition_paid"
  | "exposition_rejected"
  | "sponsorship_invoice_sent"
  | "sponsorship_paid"
  | "sponsorship_approved"
  | "sponsorship_rejected"
  | "partner_request_received"
  | "partner_request_accepted"
  | "partner_request_rejected"
  | "reference_confirmed"
  | "reference_rejected"
  | "bypass_approved"
  | "bypass_rejected"
  | "event_registration_confirmed"
  | "admin_new_submission"
  | "payment_confirmed"
  | "payment_failed"
  | "membership_payment_received";

interface NotificationRequest {
  type: NotificationType;
  user_id?: string;
  email?: string;
  data?: Record<string, string>;
}

interface EmailContent {
  subject: string;
  greeting: string;
  title: string;
  body: string;
  buttonText: string;
  buttonUrl: string;
  footer: string;
}

function getEmailContent(type: NotificationType, data: Record<string, string>): EmailContent {
  const d = data;
  const accountUrl = `${SITE_URL}/account`;
  const adminUrl = `${SITE_URL}/admin`;
  const loginUrl = `${SITE_URL}/`;

  switch (type) {
    // ── Webinar notifications ──
    case "webinar_accepted":
      return {
        subject: "Your webinar proposal has been accepted!",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Webinar Proposal Accepted",
        body: `Great news! Your webinar proposal "${d.title || "your proposal"}" has been approved. Our team will be in touch with scheduling details soon.`,
        buttonText: "View My Account",
        buttonUrl: accountUrl,
        footer: "Thank you for contributing to the M3 Connect community.",
      };
    case "webinar_rejected":
      return {
        subject: "Update on your webinar proposal — M3 Connect",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Webinar Proposal Update",
        body: `We've reviewed your webinar proposal "${d.title || "your proposal"}" and unfortunately it has not been selected at this time.${d.reason ? `\n\nFeedback: ${d.reason}` : ""}\n\nYou're welcome to submit new proposals in the future.`,
        buttonText: "View My Account",
        buttonUrl: accountUrl,
        footer: "Thank you for your interest in contributing to M3 Connect.",
      };
    case "webinar_moderator_approved":
      return {
        subject: "Webinar proposal pre-approved — pending admin review",
        greeting: "Hello Admin,",
        title: "Webinar Pre-Approved by Moderator",
        body: `A moderator has pre-approved the webinar proposal "${d.title || "N/A"}" submitted by ${d.submitter || "a member"}.${d.moderator_notes ? `\n\nModerator notes: ${d.moderator_notes}` : ""}\n\nPlease review and give final approval.`,
        buttonText: "Review in Admin Panel",
        buttonUrl: `${adminUrl}?tab=webinars`,
        footer: "This requires your final approval before proceeding.",
      };

    // ── RFP notifications ──
    case "rfp_submitted":
      return {
        subject: "New RFP submitted on M3 Connect",
        greeting: "Hello Admin,",
        title: "New RFP Submission",
        body: `A new RFP "${d.title || "N/A"}" has been submitted by ${d.marina_name || "a marina"}.${d.deadline ? `\n\nDeadline: ${d.deadline}` : ""}`,
        buttonText: "Review RFPs",
        buttonUrl: `${adminUrl}?tab=rfps`,
        footer: "Please review this submission at your earliest convenience.",
      };
    case "rfp_closed":
      return {
        subject: `RFP "${d.title || "N/A"}" has been closed`,
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "RFP Closed",
        body: `The RFP "${d.title || "your RFP"}" has been closed by an administrator. No further bids will be accepted.`,
        buttonText: "View My Account",
        buttonUrl: accountUrl,
        footer: "If you have questions, please contact our support team.",
      };

    // ── Consultation notifications ──
    case "consultation_submitted":
      return {
        subject: "New consultation request on M3 Connect",
        greeting: "Hello Admin,",
        title: "New Consultation Request",
        body: `A new consultation "${d.title || "N/A"}" has been submitted by ${d.marina_name || "a marina"}.`,
        buttonText: "Review Consultations",
        buttonUrl: `${adminUrl}?tab=consultations`,
        footer: "Please review this request at your earliest convenience.",
      };
    case "consultation_closed":
      return {
        subject: `Consultation "${d.title || "N/A"}" has been closed`,
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Consultation Closed",
        body: `Your consultation "${d.title || "your consultation"}" has been closed by an administrator.`,
        buttonText: "View My Account",
        buttonUrl: accountUrl,
        footer: "If you have questions, please contact our support team.",
      };

    // ── Exposition notifications ──
    case "exposition_approved":
      return {
        subject: "Your exposition request has been approved — M3 Connect",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Exposition Request Approved",
        body: `Your exposition request for "${d.event_title || "the event"}" has been approved. An invoice will be sent to you shortly.`,
        buttonText: "View My Account",
        buttonUrl: accountUrl,
        footer: "Thank you for your participation!",
      };
    case "exposition_invoice_sent":
      return {
        subject: "Invoice for your exposition — M3 Connect",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Exposition Invoice Sent",
        body: `An invoice${d.invoice_ref ? ` (ref: ${d.invoice_ref})` : ""} has been sent for your exposition at "${d.event_title || "the event"}".${d.amount ? ` Amount due: ${d.amount}.` : ""}\n\nPlease process payment at your earliest convenience.`,
        buttonText: "View My Account",
        buttonUrl: accountUrl,
        footer: "Contact us if you have questions about the invoice.",
      };
    case "exposition_paid":
      return {
        subject: "Payment confirmed — exposition registration complete",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Payment Confirmed",
        body: `Your payment for the exposition at "${d.event_title || "the event"}" has been confirmed. You are now registered as an exhibitor.`,
        buttonText: "View My Events",
        buttonUrl: accountUrl,
        footer: "We look forward to seeing you at the event!",
      };
    case "exposition_rejected":
      return {
        subject: "Update on your exposition request — M3 Connect",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Exposition Request Update",
        body: `We've reviewed your exposition request for "${d.event_title || "the event"}" and unfortunately it has not been approved at this time.${d.reason ? `\n\nReason: ${d.reason}` : ""}`,
        buttonText: "View My Account",
        buttonUrl: accountUrl,
        footer: "If you have questions, please contact our support team.",
      };

    // ── Sponsorship notifications ──
    case "sponsorship_invoice_sent":
      return {
        subject: "Invoice for your sponsorship upgrade — M3 Connect",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Sponsorship Invoice Sent",
        body: `An invoice${d.invoice_ref ? ` (ref: ${d.invoice_ref})` : ""} has been prepared for your sponsorship upgrade to ${d.requested_tier || "the requested tier"}.${d.amount ? ` Amount due: ${d.amount}.` : ""}`,
        buttonText: "View My Account",
        buttonUrl: accountUrl,
        footer: "Please process payment at your earliest convenience.",
      };
    case "sponsorship_paid":
      return {
        subject: "Sponsorship payment confirmed — M3 Connect",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Payment Confirmed",
        body: `Your sponsorship payment has been confirmed. Your tier upgrade to ${d.requested_tier || "the requested tier"} is pending final approval.`,
        buttonText: "View My Account",
        buttonUrl: accountUrl,
        footer: "Thank you for your support of M3 Connect!",
      };
    case "sponsorship_approved":
      return {
        subject: "Sponsorship tier upgraded — M3 Connect",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Sponsorship Tier Upgraded",
        body: `Great news! Your organization has been upgraded to ${d.requested_tier || "the new tier"}!\n\nHere's what you now have access to:\n• Enhanced visibility on the M3 Connect marketplace\n• Increased seat allocation for team members\n• Priority listing in partner directories\n• Sponsor badge displayed on your organization profile\n• Access to exclusive sponsor networking events\n\nAll members of your organization have been notified of this upgrade.`,
        buttonText: "Explore New Features",
        buttonUrl: accountUrl,
        footer: "Thank you for being a valued sponsor of M3 Connect!",
      };
    case "sponsorship_rejected":
      return {
        subject: "Update on your sponsorship request — M3 Connect",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Sponsorship Request Update",
        body: `Your sponsorship request has not been approved at this time.${d.reason ? `\n\nReason: ${d.reason}` : ""}`,
        buttonText: "View My Account",
        buttonUrl: accountUrl,
        footer: "If you have questions, please contact our support team.",
      };

    // ── Partner B2B request notifications ──
    case "partner_request_received":
      return {
        subject: "New partner contact request — M3 Connect",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "New Contact Request",
        body: `You've received a new contact request from ${d.partner_name || "a partner"} on M3 Connect.${d.message ? `\n\nMessage: "${d.message}"` : ""}`,
        buttonText: "View Request",
        buttonUrl: accountUrl,
        footer: "Log in to your account to respond.",
      };
    case "partner_request_accepted":
      return {
        subject: "Your contact request has been accepted — M3 Connect",
        greeting: d.first_name ? `Dear ${d.first_name},` : "Dear Partner,",
        title: "",
        body: `We are pleased to inform you that ${d.marina_name || "the recipient"} has accepted your contact request on M3 Connect.\n\nYou can now exchange directly with them to discuss collaboration opportunities. We encourage you to reach out promptly to make the most of this new connection.\n\nIf you have any questions or need assistance, please don't hesitate to contact us.`,
        buttonText: "View My Connections",
        buttonUrl: accountUrl,
        footer: "Best regards,\nThe M3 Connect Team",
      };
    case "partner_request_rejected":
      return {
        subject: "Update on your contact request — M3 Connect",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Contact Request Update",
        body: `${d.marina_name || "The marina"} has declined your contact request at this time.`,
        buttonText: "Browse Other Marinas",
        buttonUrl: loginUrl,
        footer: "Don't worry, there are many other opportunities on M3 Connect!",
      };

    // ── Reference / bypass notifications ──
    case "reference_confirmed":
      return {
        subject: "A reference has been confirmed for your organization!",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Reference Confirmed",
        body: `Great news! A marina has confirmed a reference for your organization.${d.confirmed_count ? ` You now have ${d.confirmed_count} confirmed reference(s).` : ""}${d.required ? ` (${d.required} required for approval.)` : ""}`,
        buttonText: "View References",
        buttonUrl: accountUrl,
        footer: "Keep going! References help build trust in the marina community.",
      };
    case "reference_rejected":
      return {
        subject: "Reference update — M3 Connect",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Reference Not Confirmed",
        body: `A marina contact has declined to confirm a reference for your organization. You may submit additional references to meet the requirement.`,
        buttonText: "Manage References",
        buttonUrl: accountUrl,
        footer: "If you believe this is an error, please contact our support team.",
      };
    case "bypass_approved":
      return {
        subject: "Reference bypass approved — M3 Connect",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Reference Bypass Approved",
        body: `Your request to bypass the reference requirement has been approved. Your account can now proceed to full verification.${d.admin_notes ? `\n\nAdmin notes: ${d.admin_notes}` : ""}`,
        buttonText: "View My Account",
        buttonUrl: accountUrl,
        footer: "Welcome to M3 Connect!",
      };
    case "bypass_rejected":
      return {
        subject: "Reference bypass request update — M3 Connect",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Bypass Request Declined",
        body: `Your request to bypass the reference requirement has been declined.${d.admin_notes ? `\n\nFeedback: ${d.admin_notes}` : ""}\n\nPlease submit marina references to proceed with your application.`,
        buttonText: "Submit References",
        buttonUrl: accountUrl,
        footer: "If you have questions, please contact our support team.",
      };

    // ── Event registration ──
    case "event_registration_confirmed":
      return {
        subject: `Registration confirmed — ${d.event_title || "M3 Connect Event"}`,
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Registration Confirmed",
        body: `You are now registered for "${d.event_title || "the event"}".${d.event_date ? `\n\nDate: ${d.event_date}` : ""}${d.event_location ? `\nLocation: ${d.event_location}` : ""}`,
        buttonText: "View My Events",
        buttonUrl: accountUrl,
        footer: "We look forward to seeing you there!",
      };

    // ── Payment notifications ──
    case "payment_confirmed":
      return {
        subject: "Payment confirmed — M3 Connect",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Payment Confirmed",
        body: `Your payment of ${d.amount || "the specified amount"} has been successfully processed.\n\nPayment type: ${d.payment_type === "membership" ? "Membership Fee" : d.payment_type === "additional_seats" ? "Additional Seats" : d.payment_type === "event_participation" ? "Event Participation" : d.payment_type || "N/A"}\nTransaction ID: ${d.transaction_id || "N/A"}\n\nA confirmation receipt has been recorded in your account.`,
        buttonText: "View My Account",
        buttonUrl: accountUrl,
        footer: "Thank you for your payment!",
      };
    case "payment_failed":
      return {
        subject: "Payment issue — M3 Connect",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Payment Not Completed",
        body: `We were unable to process your payment of ${d.amount || "the specified amount"}.${d.reason ? `\n\nReason: ${d.reason}` : ""}\n\nPlease try again or use a different payment method.`,
        buttonText: "Retry Payment",
        buttonUrl: accountUrl,
        footer: "If the issue persists, please contact our support team.",
      };
    case "membership_payment_received":
      return {
        subject: "New membership payment received — M3 Connect",
        greeting: "Hello Admin,",
        title: "Membership Payment Received",
        body: `A membership payment of ${d.amount || "€500"} has been received from ${d.submitter || "a member"}.\n\nOrganization: ${d.org_name || "N/A"}\nTransaction ID: ${d.transaction_id || "N/A"}`,
        buttonText: "Review in Admin Panel",
        buttonUrl: adminUrl,
        footer: "The organization status has been updated automatically.",
      };

    // ── Generic admin alert ──
    case "admin_new_submission":
      return {
        subject: `New ${d.submission_type || "submission"} on M3 Connect`,
        greeting: "Hello Admin,",
        title: `New ${d.submission_type || "Submission"}`,
        body: `A new ${d.submission_type || "submission"} has been received from ${d.submitter || "a member"}.${d.details ? `\n\n${d.details}` : ""}`,
        buttonText: "Review in Admin Panel",
        buttonUrl: adminUrl,
        footer: "Please review at your earliest convenience.",
      };

    default:
      return {
        subject: "M3 Connect Notification",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Notification",
        body: d.message || "You have a new notification on M3 Connect.",
        buttonText: "View M3 Connect",
        buttonUrl: loginUrl,
        footer: "If you have questions, please contact our support team.",
      };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }

  const headers = { "Content-Type": "application/json", ...corsHeaders(req) };

  try {
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), { status: 500, headers });
    }

    const body: NotificationRequest = await req.json();
    const { type, user_id, email: directEmail, data: notifData } = body;

    if (!type) {
      return new Response(JSON.stringify({ error: "type is required" }), { status: 400, headers });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Resolve recipient email
    let recipientEmail = directEmail || "";
    let firstName = notifData?.first_name || "";

    if (!recipientEmail && user_id) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("first_name, last_name, email")
        .eq("user_id", user_id)
        .maybeSingle();

      if (profile?.email) {
        recipientEmail = profile.email;
        firstName = firstName || profile.first_name || "";
      } else {
        const { data: { user } } = await supabase.auth.admin.getUserById(user_id);
        if (user?.email) {
          recipientEmail = user.email;
          firstName = firstName || user.user_metadata?.first_name || "";
        }
      }
    }

    if (!recipientEmail) {
      return new Response(JSON.stringify({ error: "Could not resolve recipient email" }), { status: 400, headers });
    }

    // Merge firstName into data for template
    const templateData = { ...notifData, first_name: firstName || notifData?.first_name || "" };
    const content = getEmailContent(type, templateData);

    // Use plain email style for partner_request_accepted (looks like a normal business email)
    const isPlainStyle = type === "partner_request_accepted";
    const html = isPlainStyle ? buildPlainEmail(content) : buildEmail(content);

    // Build email payload — add CC for partner_request_accepted
    const emailPayload: Record<string, unknown> = {
      from: SENDER_EMAIL,
      to: [recipientEmail],
      subject: content.subject,
      html,
    };
    if (type === "partner_request_accepted") {
      emailPayload.cc = ["victor@m3monaco.com"];
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(emailPayload),
    });

    const resBody = await res.text();
    if (!res.ok) {
      console.error("Resend API error:", res.status, resBody);
      return new Response(JSON.stringify({ error: `Resend error: ${resBody}` }), { status: 500, headers });
    }

    console.log(`Notification [${type}] sent to ${recipientEmail}`);
    return new Response(JSON.stringify({ success: true, type, to: recipientEmail }), { status: 200, headers });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error in send-notification:", message);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers });
  }
});

// ── Email template builder (consistent M3 branding) ──

function buildEmail(content: EmailContent): string {
  const htmlBody = content.body.replace(/\n/g, "<br>");
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${content.title}</title></head>
<body style="margin:0;padding:0;background-color:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f4f5f7;padding:40px 20px;">
<tr><td align="center">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
<tr><td style="background-color:#0c4a6e;padding:32px 40px;text-align:center;">
<h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">M3 Connect</h1>
<p style="margin:6px 0 0;color:#93c5fd;font-size:13px;font-weight:400;">The B2B platform for the marina industry</p>
</td></tr>
<tr><td style="padding:40px;">
<p style="margin:0 0 8px;color:#374151;font-size:16px;line-height:1.5;">${content.greeting}</p>
<h2 style="margin:0 0 16px;color:#111827;font-size:20px;font-weight:600;">${content.title}</h2>
<p style="margin:0 0 32px;color:#4b5563;font-size:15px;line-height:1.6;">${htmlBody}</p>
<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto;">
<tr><td style="background-color:#0c4a6e;border-radius:8px;">
<a href="${content.buttonUrl}" target="_blank" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;letter-spacing:0.3px;">${content.buttonText}</a>
</td></tr></table>
<p style="margin:32px 0 0;color:#9ca3af;font-size:13px;line-height:1.5;">${content.footer}</p>
</td></tr>
<tr><td style="padding:24px 40px;background-color:#f9fafb;border-top:1px solid #e5e7eb;text-align:center;">
<p style="margin:0;color:#9ca3af;font-size:12px;">&copy; ${new Date().getFullYear()} Monaco Marina Management &mdash; M3 Connect</p>
<p style="margin:4px 0 0;color:#9ca3af;font-size:12px;">The B2B platform for the marina industry</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

// ── Plain business email template (no big header/banner — looks like a normal email) ──

function buildPlainEmail(content: EmailContent): string {
  const htmlBody = content.body.replace(/\n/g, "<br>");
  const htmlFooter = content.footer.replace(/\n/g, "<br>");
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${content.subject}</title></head>
<body style="margin:0;padding:0;background-color:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f9fafb;padding:30px 20px;">
<tr><td align="center">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
<tr><td style="padding:36px 40px;">
<p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">${content.greeting}</p>
<p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.7;">${htmlBody}</p>
<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0;">
<tr><td style="background-color:#0c4a6e;border-radius:6px;">
<a href="${content.buttonUrl}" target="_blank" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">${content.buttonText}</a>
</td></tr></table>
<p style="margin:24px 0 0;color:#6b7280;font-size:14px;line-height:1.6;">${htmlFooter}</p>
</td></tr>
<tr><td style="padding:16px 40px;border-top:1px solid #f3f4f6;">
<p style="margin:0;color:#9ca3af;font-size:11px;">Monaco Marina Management — M3 Connect | <a href="${SITE_URL}" style="color:#6b7280;text-decoration:underline;">connect.m3monaco.com</a></p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}
