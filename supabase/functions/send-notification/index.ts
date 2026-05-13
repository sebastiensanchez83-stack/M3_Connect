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
  | "event_registration_confirmed"
  | "admin_new_submission"
  | "payment_confirmed"
  | "payment_failed"
  | "membership_payment_received"
  | "team_invitation"
  | "team_invitation_reminder"
  | "rfp_approved"
  | "rfp_rejected"
  | "consultation_approved"
  | "consultation_rejected"
  | "project_rejected"
  | "project_status_updated"
  | "join_request_received"
  | "join_request_approved"
  | "join_request_rejected"
  | "user_account_approved"
  | "user_account_rejected"
  | "org_claim_code"
  | "partner_onboarding_welcome";

interface NotificationRequest {
  type: NotificationType;
  user_id?: string;
  email?: string;
  data?: Record<string, string>;
}

// ──────────────────────────────────────────────
// Notification category mapping
// Each user can opt-out of categories via profiles.notification_prefs.
// Notifications sent to anonymous emails (no user_id) skip the check —
// the recipient has no profile yet to express a preference.
// ──────────────────────────────────────────────

type NotificationCategory =
  | "b2b"
  | "submissions"
  | "recommendations"
  | "events"
  | "payments"
  | "team"
  | "account"
  | "marketing"
  | "admin";

const TYPE_TO_CATEGORY: Record<NotificationType, NotificationCategory> = {
  // B2B partner connections
  partner_request_received: "b2b",
  partner_request_accepted: "b2b",
  partner_request_rejected: "b2b",

  // Marina/Developer submissions — admin updates on the user's own posts
  rfp_submitted: "admin",
  rfp_approved: "submissions",
  rfp_rejected: "submissions",
  rfp_closed: "submissions",
  consultation_submitted: "admin",
  consultation_approved: "submissions",
  consultation_rejected: "submissions",
  consultation_closed: "submissions",
  project_rejected: "submissions",
  project_status_updated: "submissions",
  webinar_accepted: "submissions",
  webinar_rejected: "submissions",
  webinar_moderator_approved: "admin",

  // Marina recommendations (optional feature)
  reference_confirmed: "recommendations",
  reference_rejected: "recommendations",

  // Events & expositions
  event_registration_confirmed: "events",
  exposition_approved: "events",
  exposition_rejected: "events",
  exposition_invoice_sent: "payments",
  exposition_paid: "payments",

  // Sponsorship & generic payments
  sponsorship_invoice_sent: "payments",
  sponsorship_paid: "payments",
  sponsorship_approved: "payments",
  sponsorship_rejected: "payments",
  payment_confirmed: "payments",
  payment_failed: "payments",
  membership_payment_received: "admin",

  // Team & invitations
  team_invitation: "team",
  team_invitation_reminder: "team",
  join_request_received: "team",
  join_request_approved: "team",
  join_request_rejected: "team",

  // Account lifecycle
  user_account_approved: "account",
  user_account_rejected: "account",
  org_claim_code: "account",
  partner_onboarding_welcome: "marketing",

  // Admin-internal
  admin_new_submission: "admin",
};

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
        buttonText: "View My Webinars",
        buttonUrl: `${accountUrl}?tab=webinars`,
        footer: "Thank you for contributing to the Smart Marina Connect community.",
      };
    case "webinar_rejected":
      return {
        subject: "Update on your webinar proposal — Smart Marina Connect",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Webinar Proposal Update",
        body: `We've reviewed your webinar proposal "${d.title || "your proposal"}" and unfortunately it has not been selected at this time.${d.reason ? `\n\nFeedback: ${d.reason}` : ""}\n\nYou're welcome to submit new proposals in the future.`,
        buttonText: "View My Webinars",
        buttonUrl: `${accountUrl}?tab=webinars`,
        footer: "Thank you for your interest in contributing to Smart Marina Connect.",
      };
    case "webinar_moderator_approved":
      return {
        subject: "Webinar proposal pre-approved — pending admin review",
        greeting: "Hello Admin,",
        title: "Webinar Pre-Approved by Moderator",
        body: `A moderator has pre-approved the webinar proposal "${d.title || "N/A"}" submitted by ${d.submitter || "a member"}.${d.moderator_notes ? `\n\nModerator notes: ${d.moderator_notes}` : ""}\n\nPlease review and give final approval.`,
        buttonText: "Review in Admin Panel",
        buttonUrl: `${adminUrl}/webinars`,
        footer: "This requires your final approval before proceeding.",
      };

    // ── RFP notifications ──
    case "rfp_submitted":
      return {
        subject: "New RFP submitted on Smart Marina Connect",
        greeting: "Hello Admin,",
        title: "New RFP Submission",
        body: `A new RFP "${d.title || "N/A"}" has been submitted by ${d.marina_name || "a marina"}.${d.deadline ? `\n\nDeadline: ${d.deadline}` : ""}`,
        buttonText: "Review RFPs",
        buttonUrl: `${adminUrl}/rfps`,
        footer: "Please review this submission at your earliest convenience.",
      };
    case "rfp_closed":
      return {
        subject: `RFP "${d.title || "N/A"}" has been closed`,
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "RFP Closed",
        body: `The RFP "${d.title || "your RFP"}" has been closed by an administrator. No further bids will be accepted.`,
        buttonText: "View My RFPs",
        buttonUrl: `${accountUrl}?tab=rfps`,
        footer: "If you have questions, please contact our support team.",
      };

    // ── Consultation notifications ──
    case "consultation_submitted":
      return {
        subject: "New consultation request on Smart Marina Connect",
        greeting: "Hello Admin,",
        title: "New Consultation Request",
        body: `A new consultation "${d.title || "N/A"}" has been submitted by ${d.marina_name || "a marina"}.`,
        buttonText: "Review Consultations",
        buttonUrl: `${adminUrl}/consultations`,
        footer: "Please review this request at your earliest convenience.",
      };
    case "consultation_closed":
      return {
        subject: `Consultation "${d.title || "N/A"}" has been closed`,
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Consultation Closed",
        body: `Your consultation "${d.title || "your consultation"}" has been closed by an administrator.`,
        buttonText: "View My Consultations",
        buttonUrl: `${accountUrl}?tab=consultations`,
        footer: "If you have questions, please contact our support team.",
      };

    // ── Exposition notifications ──
    case "exposition_approved":
      return {
        subject: "Your exposition request has been approved — Smart Marina Connect",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Exposition Request Approved",
        body: `Your exposition request for "${d.event_title || "the event"}" has been approved. An invoice will be sent to you shortly.`,
        buttonText: "View My Registrations",
        buttonUrl: `${accountUrl}?tab=registrations`,
        footer: "Thank you for your participation!",
      };
    case "exposition_invoice_sent":
      return {
        subject: "Invoice for your exposition — Smart Marina Connect",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Exposition Invoice Sent",
        body: `An invoice${d.invoice_ref ? ` (ref: ${d.invoice_ref})` : ""} has been sent for your exposition at "${d.event_title || "the event"}".${d.amount ? ` Amount due: ${d.amount}.` : ""}\n\nPlease process payment at your earliest convenience.`,
        buttonText: "View Pricing & Payments",
        buttonUrl: `${accountUrl}?tab=pricing`,
        footer: "Contact us if you have questions about the invoice.",
      };
    case "exposition_paid":
      return {
        subject: "Payment confirmed — exposition registration complete",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Payment Confirmed",
        body: `Your payment for the exposition at "${d.event_title || "the event"}" has been confirmed. You are now registered as an exhibitor.`,
        buttonText: "View My Registrations",
        buttonUrl: `${accountUrl}?tab=registrations`,
        footer: "We look forward to seeing you at the event!",
      };
    case "exposition_rejected":
      return {
        subject: "Update on your exposition request — Smart Marina Connect",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Exposition Request Update",
        body: `We've reviewed your exposition request for "${d.event_title || "the event"}" and unfortunately it has not been approved at this time.${d.reason ? `\n\nReason: ${d.reason}` : ""}`,
        buttonText: "View My Registrations",
        buttonUrl: `${accountUrl}?tab=registrations`,
        footer: "If you have questions, please contact our support team.",
      };

    // ── Sponsorship notifications ──
    case "sponsorship_invoice_sent":
      return {
        subject: "Invoice for your sponsorship upgrade — Smart Marina Connect",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Sponsorship Invoice Sent",
        body: `An invoice${d.invoice_ref ? ` (ref: ${d.invoice_ref})` : ""} has been prepared for your sponsorship upgrade to ${d.requested_tier || "the requested tier"}.${d.amount ? ` Amount due: ${d.amount}.` : ""}`,
        buttonText: "View Pricing & Payments",
        buttonUrl: `${accountUrl}?tab=pricing`,
        footer: "Please process payment at your earliest convenience.",
      };
    case "sponsorship_paid":
      return {
        subject: "Sponsorship payment confirmed — Smart Marina Connect",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Payment Confirmed",
        body: `Your sponsorship payment has been confirmed. Your tier upgrade to ${d.requested_tier || "the requested tier"} is pending final approval.`,
        buttonText: "View Pricing & Payments",
        buttonUrl: `${accountUrl}?tab=pricing`,
        footer: "Thank you for your support of Smart Marina Connect!",
      };
    case "sponsorship_approved":
      return {
        subject: "Sponsorship tier upgraded — Smart Marina Connect",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Sponsorship Tier Upgraded",
        body: `Great news! Your organization has been upgraded to ${d.requested_tier || "the new tier"}!\n\nHere's what you now have access to:\n• Enhanced visibility on the Smart Marina Connect marketplace\n• Increased seat allocation for team members\n• Priority listing in partner directories\n• Sponsor badge displayed on your organization profile\n• Access to exclusive sponsor networking events\n\nAll members of your organization have been notified of this upgrade.`,
        buttonText: "View My Organization",
        buttonUrl: `${accountUrl}?tab=organization`,
        footer: "Thank you for being a valued sponsor of Smart Marina Connect!",
      };
    case "sponsorship_rejected":
      return {
        subject: "Update on your sponsorship request — Smart Marina Connect",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Sponsorship Request Update",
        body: `Your sponsorship request has not been approved at this time.${d.reason ? `\n\nReason: ${d.reason}` : ""}`,
        buttonText: "View Pricing & Payments",
        buttonUrl: `${accountUrl}?tab=pricing`,
        footer: "If you have questions, please contact our support team.",
      };

    // ── Partner B2B request notifications ──
    case "partner_request_received":
      return {
        subject: "New partner contact request — Smart Marina Connect",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "New Contact Request",
        body: `You've received a new contact request from ${d.partner_name || "a partner"} on Smart Marina Connect.${d.message ? `\n\nMessage: "${d.message}"` : ""}`,
        buttonText: "View B2B Requests",
        buttonUrl: `${accountUrl}?tab=b2b-requests`,
        footer: "Log in to your account to respond.",
      };
    case "partner_request_accepted":
      return {
        subject: "Introduction — Smart Marina Connect",
        greeting: "Dear all,",
        title: "",
        body: `We are pleased to introduce ${d.first_name || "the requesting party"} and ${d.acceptor_name || d.marina_name || "the accepting party"}.\n\n${d.acceptor_name || d.marina_name || "The recipient"} has accepted the contact request on Smart Marina Connect. We encourage you both to connect directly to discuss collaboration opportunities.\n\nWe wish you a productive exchange and remain at your disposal should you need any assistance.`,
        buttonText: "View B2B Requests",
        buttonUrl: `${accountUrl}?tab=b2b-requests`,
        footer: "Best regards,\nThe Smart Marina Connect Team",
      };
    case "partner_request_rejected":
      return {
        subject: "Update on your contact request — Smart Marina Connect",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Contact Request Update",
        body: `${d.marina_name || "The marina"} has declined your contact request at this time.`,
        buttonText: "View B2B Requests",
        buttonUrl: `${accountUrl}?tab=b2b-requests`,
        footer: "Don't worry, there are many other opportunities on Smart Marina Connect!",
      };

    // ── Marina recommendation notifications (optional feature) ──
    case "reference_confirmed":
      return {
        subject: "A marina has recommended your organization!",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Recommendation Confirmed",
        body: `Great news! A marina has confirmed a recommendation for your organization.${d.confirmed_count ? ` You now have ${d.confirmed_count} confirmed recommendation(s).` : ""}\n\nIt will appear on your public profile in the "Recommended by" section.`,
        buttonText: "View Recommendations",
        buttonUrl: `${accountUrl}?tab=references`,
        footer: "Recommendations help build trust in the marina community.",
      };
    case "reference_rejected":
      return {
        subject: "Recommendation update — Smart Marina Connect",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Recommendation Not Confirmed",
        body: `A marina contact has declined to confirm a recommendation for your organization. This won't affect your account status — recommendations are an optional feature.`,
        buttonText: "Manage Recommendations",
        buttonUrl: `${accountUrl}?tab=references`,
        footer: "If you believe this is an error, please contact our support team.",
      };

    // ── Event registration ──
    case "event_registration_confirmed":
      return {
        subject: `Registration confirmed — ${d.event_title || "Smart Marina Connect Event"}`,
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Registration Confirmed",
        body: `You are now registered for "${d.event_title || "the event"}".${d.event_date ? `\n\nDate: ${d.event_date}` : ""}${d.event_location ? `\nLocation: ${d.event_location}` : ""}`,
        buttonText: "View My Registrations",
        buttonUrl: `${accountUrl}?tab=registrations`,
        footer: "We look forward to seeing you there!",
      };

    // ── Payment notifications ──
    case "payment_confirmed":
      return {
        subject: "Payment confirmed — Smart Marina Connect",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Payment Confirmed",
        body: `Your payment of ${d.amount || "the specified amount"} has been successfully processed.\n\nPayment type: ${d.payment_type === "membership" ? "Membership Fee" : d.payment_type === "additional_seats" ? "Additional Seats" : d.payment_type === "event_participation" ? "Event Participation" : d.payment_type || "N/A"}\nTransaction ID: ${d.transaction_id || "N/A"}\n\nA confirmation receipt has been recorded in your account.`,
        buttonText: "View Pricing & Payments",
        buttonUrl: `${accountUrl}?tab=pricing`,
        footer: "Thank you for your payment!",
      };
    case "payment_failed":
      return {
        subject: "Payment issue — Smart Marina Connect",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Payment Not Completed",
        body: `We were unable to process your payment of ${d.amount || "the specified amount"}.${d.reason ? `\n\nReason: ${d.reason}` : ""}\n\nPlease try again or use a different payment method.`,
        buttonText: "Retry Payment",
        buttonUrl: `${accountUrl}?tab=pricing`,
        footer: "If the issue persists, please contact our support team.",
      };
    case "membership_payment_received":
      return {
        subject: "New membership payment received — Smart Marina Connect",
        greeting: "Hello Admin,",
        title: "Membership Payment Received",
        body: `A membership payment of ${d.amount || "€500"} has been received from ${d.submitter || "a member"}.\n\nOrganization: ${d.org_name || "N/A"}\nTransaction ID: ${d.transaction_id || "N/A"}`,
        buttonText: "Review Sponsorships",
        buttonUrl: `${adminUrl}/sponsorships`,
        footer: "The organization status has been updated automatically.",
      };

    // ── Team invitation ──
    case "team_invitation":
      return {
        subject: `You've been invited to join ${d.org_name || "an organization"} on Smart Marina Connect`,
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Team Invitation",
        body: `${d.org_name || "An organization"} has invited you to join their team on Smart Marina Connect, the B2B platform for the marina industry.\n\nTo accept this invitation, simply create an account using this email address. You will be automatically linked to the organization once you sign up.`,
        buttonText: "Sign Up Now",
        buttonUrl: d.signup_url || SITE_URL,
        footer: "If you weren't expecting this invitation, you can safely ignore this email.",
      };
    case "team_invitation_reminder":
      return {
        subject: `Reminder: Join ${d.org_name || "your team"} on Smart Marina Connect`,
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Invitation Reminder",
        body: `This is a friendly reminder that ${d.org_name || "an organization"} has invited you to join their team on Smart Marina Connect.\n\nSign up using this email address to accept the invitation and get started.`,
        buttonText: "Sign Up Now",
        buttonUrl: d.signup_url || SITE_URL,
        footer: "If you've already signed up, you can log in to access your account.",
      };

    // ── Submission status notifications ──
    case "rfp_approved":
      return {
        subject: `Your RFP has been approved — Smart Marina Connect`,
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "RFP Approved",
        body: `Your RFP "${d.title || "your submission"}" has been approved and is now visible on the marketplace.`,
        buttonText: "View My RFPs",
        buttonUrl: `${accountUrl}?tab=rfps`,
        footer: "Partners can now see and respond to your RFP.",
      };
    case "rfp_rejected":
      return {
        subject: `Update on your RFP — Smart Marina Connect`,
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "RFP Not Approved",
        body: `Your RFP "${d.title || "your submission"}" has not been approved.${d.reason ? `\n\nReason: ${d.reason}` : ""}\n\nYou can edit and resubmit it from your account.`,
        buttonText: "View My RFPs",
        buttonUrl: `${accountUrl}?tab=rfps`,
        footer: "If you have questions, please contact our support team.",
      };
    case "consultation_approved":
      return {
        subject: `Your consultation has been approved — Smart Marina Connect`,
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Consultation Approved",
        body: `Your consultation "${d.title || "your submission"}" has been approved and is now visible on the marketplace.`,
        buttonText: "View My Consultations",
        buttonUrl: `${accountUrl}?tab=consultations`,
        footer: "Partners can now see and respond to your consultation.",
      };
    case "consultation_rejected":
      return {
        subject: `Update on your consultation — Smart Marina Connect`,
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Consultation Not Approved",
        body: `Your consultation "${d.title || "your submission"}" has not been approved.${d.reason ? `\n\nReason: ${d.reason}` : ""}\n\nYou can edit and resubmit it from your account.`,
        buttonText: "View My Consultations",
        buttonUrl: `${accountUrl}?tab=consultations`,
        footer: "If you have questions, please contact our support team.",
      };
    case "project_rejected":
      return {
        subject: `Update on your project — Smart Marina Connect`,
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Project Not Approved",
        body: `Your project "${d.title || "your submission"}" has not been approved.${d.reason ? `\n\nReason: ${d.reason}` : ""}`,
        buttonText: "View My Projects",
        buttonUrl: `${accountUrl}?tab=projects`,
        footer: "If you have questions, please contact our support team.",
      };
    case "project_status_updated":
      return {
        subject: `Project status updated — Smart Marina Connect`,
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Project Status Updated",
        body: d.details || `Your project "${d.title || "your submission"}" status has been updated.`,
        buttonText: "View My Projects",
        buttonUrl: `${accountUrl}?tab=projects`,
        footer: "Log in to your account to see the full details.",
      };

    // ── Join request received (sent to org owner) ──
    case "join_request_received":
      return {
        subject: `New join request for ${d.org_name || "your organization"} on Smart Marina Connect`,
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "New Join Request",
        body: `${d.requester_name || "Someone"} (${d.requester_email || ""}) has requested to join ${d.org_name || "your organization"} on Smart Marina Connect.\n\nTheir email domain matches your organization. You can approve or reject this request from your organization settings.`,
        buttonText: "Review Request",
        buttonUrl: `${SITE_URL}/account?tab=organization`,
        footer: "You are receiving this email because you are the owner of this organization on Smart Marina Connect.",
      };

    // ── Join request approved (sent to requester) ──
    case "join_request_approved":
      return {
        subject: `You've been approved to join ${d.org_name || "an organization"} on Smart Marina Connect`,
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Join Request Approved!",
        body: `Great news! Your request to join ${d.org_name || "the organization"} on Smart Marina Connect has been approved.\n\nYou now have access to the organization's resources and can collaborate with your team. Log in to get started.`,
        buttonText: "View My Organization",
        buttonUrl: `${accountUrl}?tab=organization`,
        footer: "Welcome to the team! If you have any questions, contact your organization administrator.",
      };

    // ── Join request rejected (sent to requester) ──
    case "join_request_rejected":
      return {
        subject: `Update on your join request for ${d.org_name || "an organization"}`,
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Join Request Update",
        body: `Your request to join ${d.org_name || "the organization"} on Smart Marina Connect was not approved.\n\nYou can still create your own organization profile and continue using the platform independently.`,
        buttonText: "Go to My Account",
        buttonUrl: `${SITE_URL}/account`,
        footer: "If you believe this was a mistake, please contact the organization directly.",
      };

    // ── User account approved by admin ──
    case "user_account_approved":
      return {
        subject: "Your Smart Marina Connect account has been approved",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Account Approved",
        body: `Good news! Your Smart Marina Connect account has been verified and approved by our team. You now have full access to the platform${d.org_name ? ` on behalf of ${d.org_name}` : ""}.\n\nYou can now connect with marinas, partners, events, and resources.`,
        buttonText: "Go to My Account",
        buttonUrl: accountUrl,
        footer: "Welcome aboard! If you have any questions, please reach out to our support team.",
      };

    // ── User account rejected by admin ──
    case "user_account_rejected":
      return {
        subject: "Update on your Smart Marina Connect application",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Account Application Update",
        body: `Thank you for your interest in Smart Marina Connect. After reviewing your application, we are unable to approve your account at this time.${d.reason ? `\n\nReason provided by our team:\n${d.reason}` : ""}\n\nIf you believe this decision was made in error or if you would like to provide additional information, you are welcome to contact us.`,
        buttonText: "Contact Support",
        buttonUrl: `${SITE_URL}/contact`,
        footer: "We appreciate your interest in the Smart Marina Connect community.",
      };

    // ── Partner onboarding welcome (sent by admin to invite a partner) ──
    case "partner_onboarding_welcome":
      return {
        subject: "Welcome to Smart Marina Connect — Get started in 3 steps",
        greeting: d.first_name ? `Hi ${d.first_name},` : "Hi there,",
        title: "Welcome to Smart Marina Connect",
        body: `Smart Marina Connect is the B2B platform connecting marinas with trusted industry partners.\n\nHere's how to get your company onboarded in 3 quick steps:\n\n<strong>1. Create your account</strong>\nSign up at smartmarinaconnect.com and fill in your company information (name, website, country, sectors you serve, and a short description). This takes about 5 minutes.\n\n<strong>2. Get verified</strong>\nOnce your profile is complete, our team reviews and verifies it — usually within one business day. You'll get an email as soon as you're approved.\n\n<strong>3. Strengthen your profile (optional)</strong>\nFrom your account → Recommendations tab, invite marinas you've worked with to publicly endorse your work. Confirmed recommendations appear on your public profile and help marinas trust your services — but they're entirely optional.\n\n<strong>Once verified, you get full access:</strong> the B2B marketplace, RFPs from marinas, event registrations, and more.\n\n<strong>Good to know:</strong>\n• Your progress is saved automatically — come back anytime\n• You can invite teammates once your account is active\n• Need help? Just reply to this email, we're happy to guide you`,
        buttonText: "Get Started",
        buttonUrl: `${SITE_URL}/?signup=true${d.email ? `&email=${encodeURIComponent(d.email)}` : ""}`,
        footer: "Looking forward to having you on the platform.",
      };

    // ── Organization claim code (sent by admin to marina manager) ──
    case "org_claim_code": {
      const recipientEmailForUrl = d.email || d.recipient_email || "";
      const claimCodeForUrl = d.claim_code || "";
      const signupUrl = `${SITE_URL}/?signup=true${recipientEmailForUrl ? `&email=${encodeURIComponent(recipientEmailForUrl)}` : ""}${claimCodeForUrl ? `&code=${encodeURIComponent(claimCodeForUrl)}` : ""}`;
      return {
        subject: `Your organization code for ${d.org_name || "Smart Marina Connect"}`,
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Join Your Organization on Smart Marina Connect",
        body: `You have been invited to join ${d.org_name || "your organization"} on Smart Marina Connect, the B2B platform for the marina industry.\n\nYour organization code is:\n\n<strong style="font-size:24px;letter-spacing:2px;color:#0c4a6e;">${claimCodeForUrl || "N/A"}</strong>\n\nClick the button below to sign up — your email and code will be pre-filled automatically. You will be linked to your organization as soon as you complete signup.\n\nThis code is unique to your organization and can be reused by your team members.`,
        buttonText: "Sign Up Now",
        buttonUrl: signupUrl,
        footer: "If you weren't expecting this invitation, you can safely ignore this email.",
      };
    }

    // ── Generic admin alert ──
    case "admin_new_submission":
      return {
        subject: `New ${d.submission_type || "submission"} on Smart Marina Connect`,
        greeting: "Hello Admin,",
        title: `New ${d.submission_type || "Submission"}`,
        body: `A new ${d.submission_type || "submission"} has been received from ${d.submitter || "a member"}.${d.details ? `\n\n${d.details}` : ""}`,
        buttonText: "Review in Admin Panel",
        buttonUrl: adminUrl,
        footer: "Please review at your earliest convenience.",
      };

    default:
      return {
        subject: "Smart Marina Connect Notification",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Notification",
        body: d.message || "You have a new notification on Smart Marina Connect.",
        buttonText: "View Smart Marina Connect",
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

    // Resolve recipient email + notification preferences
    let recipientEmail = directEmail || "";
    let firstName = notifData?.first_name || "";
    let userPrefs: Record<string, boolean> | null = null;

    if (user_id) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("first_name, last_name, email, notification_prefs")
        .eq("user_id", user_id)
        .maybeSingle();

      if (profile?.email) {
        if (!recipientEmail) recipientEmail = profile.email;
        firstName = firstName || profile.first_name || "";
        userPrefs = (profile.notification_prefs as Record<string, boolean> | null) || null;
      } else if (!recipientEmail) {
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

    // Per-user opt-out check.
    // Only applies when the recipient has a profile (user_id provided).
    // Anonymous sends (team invitations to non-users, claim codes, etc.) bypass
    // the check — they have no profile to express a preference yet.
    const category = TYPE_TO_CATEGORY[type];
    if (userPrefs && category && userPrefs[category] === false) {
      console.log(`Notification [${type}] (${category}) skipped — user ${user_id} opted out`);
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: "user_opted_out", category }),
        { status: 200, headers },
      );
    }

    // Merge firstName into data for template
    const templateData = { ...notifData, first_name: firstName || notifData?.first_name || "" };
    const content = getEmailContent(type, templateData);

    // Use plain email style for partner_request_accepted (looks like a normal business email)
    const isPlainStyle = type === "partner_request_accepted";
    const html = isPlainStyle ? buildPlainEmail(content) : buildEmail(content);

    // Build email payload (with anti-spam improvements)
    const unsubscribeUrl = `${SITE_URL}/unsubscribe?email=${encodeURIComponent(recipientEmail)}`;
    const emailPayload: Record<string, unknown> = {
      from: SENDER_EMAIL,
      to: [recipientEmail],
      reply_to: "contact@smartmarinaconnect.com",
      subject: content.subject,
      html,
      text: buildPlainText(content, unsubscribeUrl),
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>, <mailto:unsubscribe@smartmarinaconnect.com>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        "X-Entity-Ref-ID": `${type}-${Date.now()}`,
      },
    };
    // For B2B acceptance: send to BOTH parties (requester + acceptor) with victor in CC as introduction
    if (type === "partner_request_accepted") {
      const acceptorEmail = notifData?.acceptor_email || "";
      const recipients = [recipientEmail];
      if (acceptorEmail && acceptorEmail !== recipientEmail) {
        recipients.push(acceptorEmail);
      }
      emailPayload.to = recipients;
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

// ── Plain text version (required for good deliverability, prevents spam) ──

function buildPlainText(content: EmailContent, unsubscribeUrl: string): string {
  // Strip HTML from body for plain text
  const plainBody = content.body.replace(/<[^>]*>/g, "").replace(/\n/g, "\n");
  return `${content.greeting}

${content.title}

${plainBody}

${content.buttonText}: ${content.buttonUrl}

---
${content.footer}

Smart Marina Connect — The B2B platform for the marina industry
${SITE_URL}

To unsubscribe from these notifications: ${unsubscribeUrl}
`;
}

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
<h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">Smart Marina Connect</h1>
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
<p style="margin:0;color:#9ca3af;font-size:12px;">&copy; ${new Date().getFullYear()} Smart Marina Connect</p>
<p style="margin:4px 0 0;color:#9ca3af;font-size:12px;">The B2B platform for the marina industry</p>
<p style="margin:12px 0 0;color:#9ca3af;font-size:11px;">You received this email because you have an account on Smart Marina Connect.<br><a href="${SITE_URL}/account?tab=notifications" style="color:#6b7280;text-decoration:underline;">Manage preferences</a> &nbsp;&middot;&nbsp; <a href="${SITE_URL}/unsubscribe" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a> &nbsp;&middot;&nbsp; <a href="${SITE_URL}/contact" style="color:#6b7280;text-decoration:underline;">Contact</a></p>
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
<p style="margin:0;color:#9ca3af;font-size:11px;">Smart Marina Connect | <a href="${SITE_URL}" style="color:#6b7280;text-decoration:underline;">smartmarinaconnect.com</a> | <a href="${SITE_URL}/unsubscribe" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a></p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}
