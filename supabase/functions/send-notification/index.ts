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
  | "partner_onboarding_welcome"
  | "profile_reminder_signup_stalled"
  | "profile_reminder_onboarding_incomplete"
  | "profile_reminder_pending_review_followup"
  | "profile_reminder_verified_but_thin";

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

  // Profile completion reminders (drip)
  profile_reminder_signup_stalled: "marketing",
  profile_reminder_onboarding_incomplete: "marketing",
  profile_reminder_pending_review_followup: "marketing",
  profile_reminder_verified_but_thin: "marketing",

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
        body: `${d.org_name ? `${d.org_name} has` : "You've"} received a new contact request from ${d.partner_name || "a member"} on Smart Marina Connect.${d.message ? `\n\nMessage: "${d.message}"` : ""}${d.team ? `\n\nYour colleagues on Smart Marina Connect received it too. Any of you can answer: the first answer is the one sent.` : ""}`,
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
    // Sent by payment-ipn (service caller) once per payment and status. The platform
    // is free (6 Oct 2026): a payment is for an event, and nobody can start a new one
    // themselves (create-payment is staff only), so no "retry" and no pricing page.
    // ?tab=registrations opens the member's events on the old and the new site alike.
    case "payment_confirmed":
      return {
        subject: "Payment confirmed — Smart Marina Connect",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Payment confirmed",
        body: `We have received your payment of ${d.amount || "the amount due"}.\n\nFor: ${d.payment_type === "event_participation" ? "Event participation" : "Payment to M3"}${d.transaction_id ? `\nReference: ${d.transaction_id}` : ""}\n\nKeep this e-mail as your proof of payment.`,
        buttonText: "See my registrations",
        buttonUrl: `${accountUrl}?tab=registrations`,
        footer: "Thank you for your payment.",
      };
    case "payment_failed":
      return {
        subject: "Payment not completed — Smart Marina Connect",
        greeting: d.first_name ? `Hello ${d.first_name},` : "Hello,",
        title: "Payment not completed",
        body: `Your payment of ${d.amount || "the amount due"} did not go through, and nothing was charged.${d.reason ? `\n\nReason: ${d.reason}` : ""}\n\nThe M3 team will contact you to settle it. You can also write to events@m3monaco.com.`,
        buttonText: "See my registrations",
        buttonUrl: `${accountUrl}?tab=registrations`,
        footer: "If you think this is a mistake, reply to this e-mail.",
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
        body: `You have been invited to join ${d.org_name || "your organization"} on Smart Marina Connect, the B2B platform for the marina industry.\n\nYour organization code is:\n\n${emCode(claimCodeForUrl || "N/A")}\n\nClick the button below to sign up — your email and code will be pre-filled automatically. You will be linked to your organization as soon as you complete signup.\n\nThis code is unique to your organization and can be reused by your team members.`,
        buttonText: "Sign Up Now",
        buttonUrl: signupUrl,
        footer: "If you weren't expecting this invitation, you can safely ignore this email.",
      };
    }

    // ── Profile-completion reminders ──
    case "profile_reminder_signup_stalled":
      return {
        subject: "Pick up where you left off — Smart Marina Connect",
        greeting: d.first_name ? `Hi ${d.first_name},` : "Hi there,",
        title: "You're 5 minutes from finishing your profile",
        body: `You signed up a few days ago but haven't completed your organization setup yet. Marinas and partners can't find you in the network until your profile is ready.\n\nIt takes about 5 minutes to fill in your organization details. We'll review and verify it within one business day.`,
        buttonText: "Finish my profile",
        buttonUrl: `${SITE_URL}/onboarding`,
        footer: "Need help? Reply to this email — we're happy to guide you.",
      };

    case "profile_reminder_onboarding_incomplete":
      return {
        subject: "Almost there — finish your Smart Marina Connect profile",
        greeting: d.first_name ? `Hi ${d.first_name},` : "Hi there,",
        title: `${d.org_name || "Your organization"} is almost ready`,
        body: `You started setting up your organization on Smart Marina Connect but haven't submitted it for review yet. Once you submit, our team verifies your profile and you gain full access to the platform: B2B marketplace, RFPs, events, and resources.\n\nA quick check of your draft will tell you what's still missing.`,
        buttonText: "Complete and submit",
        buttonUrl: `${SITE_URL}/account?tab=organization`,
        footer: "If you have any questions, just reply to this email.",
      };

    case "profile_reminder_pending_review_followup":
      return {
        subject: "Your Smart Marina Connect application — quick update",
        greeting: d.first_name ? `Hi ${d.first_name},` : "Hi there,",
        title: "We're still reviewing your profile",
        body: `Your organization profile has been pending review for a few days. Our team reviews each application manually to keep the network high-quality.\n\nIf you'd like to add more documentation, a logo, or extra context, you can edit your profile at any time and it'll help us verify you faster.`,
        buttonText: "View my profile",
        buttonUrl: `${SITE_URL}/account?tab=organization`,
        footer: "Reply to this email if you have questions about your application.",
      };

    case "profile_reminder_verified_but_thin":
      return {
        subject: "Make your profile work for you on Smart Marina Connect",
        greeting: d.first_name ? `Hi ${d.first_name},` : "Hi there,",
        title: "Your profile is ready — let's make it shine",
        body: `You're verified on Smart Marina Connect, but your public profile is a bit thin. The platform recommends adding:\n\n• A company logo and cover photo\n• A clear description of what you do\n• Your sectors of interest or service\n• At least one teammate\n\nA complete profile shows up more often in search and gets 3× more connection requests on average.`,
        buttonText: "Polish my profile",
        buttonUrl: `${SITE_URL}/account?tab=organization`,
        footer: "You can manage email reminders at any time in your account settings.",
      };

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

// ──────────────────────────────────────────────
// Who may send what (audit S9, 7 Oct 2026)
// ──────────────────────────────────────────────
//
// Three kinds of caller:
//   service  -- another edge function holding the service-role key (notify-admins,
//               send-profile-reminders, payment-ipn since 9 Oct 2026). Trusted:
//               any known type, recipient as given.
//   staff    -- a signed-in VERIFIED admin or moderator (same test as sm_is_staff()).
//               The admin consoles. Any known type, recipient as given.
//   member   -- any other signed-in account. Before this change a member could send
//               any type to any address with any text: a phishing relay on M3's
//               domain for every account holder. A member may now only trigger the
//               e-mails the app itself sends on their behalf, and the recipient is
//               always resolved here from the row that justifies the e-mail:
//                 event_registration_confirmed, rfp_submitted   -> the caller only
//                 partner_request_received   -> marina of a pending partner request
//                                               the caller created < 15 min ago, AND every
//                                               verified member of that request's
//                                               marina_organization_id (the whole company,
//                                               8 Oct 2026; see "Company fan-out" below)
//                 partner_request_accepted / _rejected -> partner of a request the
//                                               caller answered < 15 min ago: the caller is
//                                               answered_by_user_id (set by trigger) and
//                                               marina_user_id or a member of the request's
//                                               marina_organization_id
//                 join_request_received      -> owner (organizations.owner_user_id) of
//                                               the org the caller asked to join < 15 min ago
//                 join_request_approved / _rejected -> requester of a join request in
//                                               an org the caller owns, decided < 15 min ago
//                 team_invitation (< 15 min) / team_invitation_reminder -> invitee of a
//                                               pending invitation of an org the caller
//                                               owns, or that the caller sent
//               Names that appear in those e-mails (sender org, org invited to,
//               requester e-mail) are taken from the database, not from the caller.
//               The same e-mail for the same row goes out at most once per 10 minutes,
//               and a member can trigger at most 30 e-mails an hour.
//
//               Organisation-relay rule (review of 7 Oct 2026). Any signed-in account
//               can own an organisation (create_organization, or a direct INSERT) and
//               insert organization_invitations rows with ANY e-mail and ANY status. So
//               team_invitation(_reminder) and join_request_approved/_rejected could
//               still carry an attacker-chosen organisation name, in the subject, to an
//               address the attacker picks. Hence:
//                 - join_request_approved/_rejected only go to a CONFIRMED registered
//                   account with that address (a real join request always comes from
//                   one: request_org_join uses the caller's confirmed auth e-mail), and
//                   the row must have the self-request shape (invited_by_user_id null).
//                 - When the organisation is not verified by M3
//                   (organizations.access_status <> 'verified'), the subject is generic
//                   (no organisation name), the name in the body is cut to 80
//                   characters, and those e-mails are capped at 5 per organisation and
//                   50 for all unverified organisations together per 24 h (logged in
//                   email_rate_log as "org-email:<org id>"; fails CLOSED). Production
//                   had 7 invitations in total, all from verified organisations.
//                 - The sending organisation named in partner_request_received is used
//                   only if the caller belongs to it (partner_requests RLS does not
//                   check partner_organization_id), and the message is the one stored
//                   on the request row.
//               organizations.access_status is only trustworthy once self-service
//               INSERTs cannot set it: see 20261007152406_org_insert_guard.sql.
//
//               Company fan-out (8 Oct 2026). A connection request goes to the whole
//               receiving company and any member may answer it
//               (20261008200000_partner_requests_whole_company.sql). For
//               partner_request_received the e-mail goes to marina_user_id as before and
//               to every VERIFIED member of the request's marina_organization_id (the
//               ones who can answer), deduplicated by account and by address, the caller
//               left out, at most MAX_COMPANY_FANOUT people. The organisation is only used
//               when M3 has verified it (an owner can add any account to their own
//               organisation) and when marina_user_id really belongs to it (the insert
//               trigger checks it too); otherwise only marina_user_id is told, as before. Each recipient's own notification preferences apply; the content
//               (sender, message) is the same database-sourced text for all. The 10-minute
//               dedupe stays one per request row, and every extra e-mail is logged in
//               email_rate_log ("send-notification:fanout:<ref>") so it counts towards
//               the caller's 30 e-mails an hour: one request can overshoot the cap by at
//               most one company, never more.
// Every caller: unknown types are refused, every data field is capped and
// HTML-escaped before it reaches a template, the button always points at the site
// origin, and the response no longer echoes the recipient address.

const KNOWN_TYPES = new Set<string>(Object.keys(TYPE_TO_CATEGORY));
const SITE_ORIGIN = (() => {
  try { return new URL(SITE_URL).origin; } catch { return "https://smartmarinaconnect.com"; }
})();
const MAX_FIELD_CHARS = 2000;
const MAX_FIELDS = 25;
const MEMBER_WINDOW_MS = 15 * 60 * 1000;
const MEMBER_DUPLICATE_MS = 10 * 60 * 1000;
const MEMBER_HOURLY_CAP = 30;
const UNVERIFIED_ORG_DAILY_CAP = 5;
const UNVERIFIED_ORGS_GLOBAL_DAILY_CAP = 50;
const ORG_NAME_CHARS = 120;
const UNVERIFIED_ORG_NAME_CHARS = 80;
const PERSON_NAME_CHARS = 120;
const MESSAGE_CHARS = 1000;
/** Most colleagues one connection request is e-mailed to (largest company on 8 Oct 2026: 6 members). */
const MAX_COMPANY_FANOUT = 25;

// deno-lint-ignore no-explicit-any
type Db = any;

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

/** Keep plain string-ish fields only, strip control characters, cap length. */
function sanitizeData(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (n >= MAX_FIELDS) break;
    if (!/^[a-z_]{1,40}$/.test(k)) continue;
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") continue;
    // deno-lint-ignore no-control-regex
    out[k] = String(v).replace(/(?![\t\n\r])\p{Cc}/gu, "").slice(0, MAX_FIELD_CHARS);
    n++;
  }
  return out;
}

/** A name read from the database: one line, no control characters, capped. */
function cleanName(s: string | null | undefined, max: number): string {
  // deno-lint-ignore no-control-regex
  return (s || "").replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
}

/** Free text read from the database (a request message): line breaks kept, capped. */
function cleanText(s: string | null | undefined, max: number): string {
  // deno-lint-ignore no-control-regex
  return (s || "").replace(/(?![\t\n\r])\p{Cc}/gu, "").trim().slice(0, max);
}

function escapeData(d: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(d)) out[k] = escapeHtml(v);
  return out;
}

/** Any button link is re-based onto the site origin (path + query kept). */
function toSiteUrl(raw: string): string {
  try {
    const u = new URL(raw, SITE_ORIGIN);
    if (u.protocol !== "https:" && u.protocol !== "http:") return `${SITE_ORIGIN}/`;
    return `${SITE_ORIGIN}${u.pathname}${u.search}${u.hash}`;
  } catch {
    return `${SITE_ORIGIN}/`;
  }
}

function isEmail(s: string): boolean {
  return s.length <= 254 && /^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[^\s@<>()",;:\\]+$/.test(s);
}

function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Recipient {
  recipientEmail: string;
  recipientUserId: string | null;
  firstName: string;
  prefs: Record<string, boolean> | null;
}

async function recipientForUser(db: Db, userId: string): Promise<Recipient | null> {
  const { data: profile } = await db
    .from("profiles")
    .select("first_name, email, notification_prefs")
    .eq("user_id", userId)
    .maybeSingle();
  if (profile?.email) {
    return {
      recipientEmail: profile.email,
      recipientUserId: userId,
      firstName: profile.first_name || "",
      prefs: (profile.notification_prefs as Record<string, boolean> | null) || null,
    };
  }
  const { data: authData } = await db.auth.admin.getUserById(userId);
  const user = authData?.user;
  if (!user?.email) return null;
  return {
    recipientEmail: user.email,
    recipientUserId: userId,
    firstName: profile?.first_name || user.user_metadata?.first_name || "",
    prefs: null,
  };
}

interface Member {
  id: string;
  email: string;
  fullName: string;
  /** Names the caller may legitimately sign with: own name, e-mail local part, own orgs. */
  names: string[];
  /** Organisations the caller belongs to (any role). */
  orgIds: string[];
}

async function loadMember(db: Db, id: string, email: string): Promise<Member> {
  const { data: prof } = await db.from("profiles").select("first_name, last_name").eq("user_id", id).maybeSingle();
  const first = cleanName(prof?.first_name, PERSON_NAME_CHARS);
  const fullName = cleanName([prof?.first_name, prof?.last_name].filter(Boolean).join(" "), PERSON_NAME_CHARS);
  const names: string[] = [];
  if (fullName) names.push(fullName);
  if (first) names.push(first);
  if (email) names.push(email.split("@")[0]);
  const { data: mems } = await db
    .from("organization_members")
    .select("organization_id, organization:organizations(name)")
    .eq("user_id", id);
  const orgIds: string[] = [];
  for (const m of (mems || []) as { organization_id?: string; organization: { name?: string } | { name?: string }[] | null }[]) {
    if (m.organization_id && UUID_RE.test(m.organization_id)) orgIds.push(m.organization_id);
    const orgs = Array.isArray(m.organization) ? m.organization : m.organization ? [m.organization] : [];
    for (const o of orgs) {
      const n = cleanName(o?.name, ORG_NAME_CHARS);
      if (n) names.push(n);
    }
  }
  return { id, email, fullName, names, orgIds };
}

/** Caller-supplied display name, kept only if it is one of the caller's own names. */
function pickName(supplied: string | undefined, allowed: string[], fallback: string): string {
  const s = (supplied || "").trim().toLowerCase();
  if (!s) return fallback;
  const hit = allowed.find((a) => a.trim().toLowerCase() === s);
  return hit || fallback;
}

async function ownedOrgIds(db: Db, userId: string): Promise<string[]> {
  const { data } = await db
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId)
    .eq("role", "owner");
  return ((data || []) as { organization_id: string }[]).map((r) => r.organization_id).filter((x) => UUID_RE.test(x));
}

interface OrgInfo {
  name: string;
  verified: boolean;
}

/** Organisation name (cleaned; shorter when M3 has not verified the organisation). */
async function orgInfo(db: Db, orgId: string | null | undefined): Promise<OrgInfo> {
  if (!orgId) return { name: "", verified: false };
  const { data } = await db.from("organizations").select("name, access_status").eq("id", orgId).maybeSingle();
  const verified = data?.access_status === "verified";
  return { name: cleanName(data?.name, verified ? ORG_NAME_CHARS : UNVERIFIED_ORG_NAME_CHARS), verified };
}

/**
 * The CONFIRMED account whose sign-in address is `email`, or null. profiles.email
 * only narrows the search; the auth record decides (a profile e-mail is
 * self-editable, the auth e-mail and its confirmation are not).
 */
async function confirmedUserByEmail(db: Db, email: string): Promise<string | null> {
  const e = email.trim();
  if (!isEmail(e)) return null;
  const { data: rows } = await db
    .from("profiles")
    .select("user_id")
    .in("email", Array.from(new Set([e, e.toLowerCase()])))
    .limit(5);
  for (const row of (rows || []) as { user_id: string }[]) {
    if (!row.user_id || !UUID_RE.test(row.user_id)) continue;
    const { data: authData } = await db.auth.admin.getUserById(row.user_id);
    const u = authData?.user;
    if (u && sameEmail(u.email, e) && (u.email_confirmed_at || u.confirmed_at)) return row.user_id;
  }
  return null;
}

const GENERIC_ORG_SUBJECT: Partial<Record<NotificationType, string>> = {
  team_invitation: "You've been invited to join a team on Smart Marina Connect",
  team_invitation_reminder: "Reminder: your invitation to join a team on Smart Marina Connect",
  join_request_approved: "Your join request was approved on Smart Marina Connect",
  join_request_rejected: "Update on your join request on Smart Marina Connect",
};

/**
 * The colleagues of a connection request's recipient who get the e-mail too: the
 * VERIFIED members of the receiving organisation (the ones RLS lets answer), the
 * recipient and the caller left out, one per address, oldest members first, capped.
 * Empty when the recipient does not belong to that organisation.
 */
async function companyRecipients(db: Db, orgId: string | null | undefined, recipientId: string, callerId: string): Promise<Recipient[]> {
  if (!orgId || !UUID_RE.test(orgId)) return [];
  const { data: members } = await db
    .from("organization_members")
    .select("user_id, joined_at")
    .eq("organization_id", orgId)
    .order("joined_at", { ascending: true })
    .limit(200);
  const ids = ((members || []) as { user_id: string }[]).map((m) => m.user_id).filter((id) => UUID_RE.test(id));
  if (!ids.includes(recipientId)) {
    const { data: org } = await db.from("organizations").select("owner_user_id").eq("id", orgId).maybeSingle();
    if (org?.owner_user_id !== recipientId) return [];
  }
  const others = ids.filter((id) => id !== recipientId && id !== callerId);
  if (!others.length) return [];
  const { data: profiles } = await db
    .from("profiles")
    .select("user_id, first_name, email, notification_prefs")
    .in("user_id", others)
    .eq("access_status", "verified");
  const byId = new Map(((profiles || []) as { user_id: string; first_name: string | null; email: string | null; notification_prefs: unknown }[])
    .map((p) => [p.user_id, p]));
  const out: Recipient[] = [];
  for (const id of others) {
    const p = byId.get(id);
    if (!p?.email || !isEmail(p.email.trim())) continue;
    out.push({
      recipientEmail: p.email.trim(),
      recipientUserId: id,
      firstName: p.first_name || "",
      prefs: (p.notification_prefs as Record<string, boolean> | null) || null,
    });
    if (out.length >= MAX_COMPANY_FANOUT) break;
  }
  return out;
}

interface MemberGrant extends Recipient {
  data: Record<string, string>;
  ref: string;
  /** More people who get the same e-mail (partner_request_received: the recipient's colleagues). */
  also?: Recipient[];
  /** Set when the e-mail names an organisation M3 has not verified: capped per org. */
  unverifiedOrgId?: string;
  /** Replaces the template subject (no organisation name for unverified orgs). */
  subject?: string;
}

/** Extra fields of a grant for an e-mail that names organisation `orgId`. */
function orgFields(type: string, orgId: string, org: OrgInfo): Pick<MemberGrant, "unverifiedOrgId" | "subject"> {
  if (org.verified) return {};
  return { unverifiedOrgId: orgId, subject: GENERIC_ORG_SUBJECT[type as NotificationType] };
}

/**
 * Resolve the recipient of a member-triggered e-mail from the database row that
 * justifies it. Returns null when no such row exists (the send is refused).
 */
async function authorizeMemberSend(
  db: Db,
  m: Member,
  type: string,
  userId: string,
  email: string,
  data: Record<string, string>,
): Promise<MemberGrant | null> {
  const since = new Date(Date.now() - MEMBER_WINDOW_MS).toISOString();
  const selfName = m.fullName || m.email.split("@")[0] || "A member";

  switch (type) {
    case "event_registration_confirmed": {
      // Confirmation to the caller themself (EventRegistrationFlow). Everything in
      // the e-mail comes from the database, never from caller text, and it goes to
      // the caller's SIGN-IN address (m.email, from auth.getUser), never to
      // profiles.email, which its owner can edit to any address.
      if (userId && userId !== m.id) return null;
      const eventId = data.event_id || "";
      if (!UUID_RE.test(eventId) || !m.email) return null;
      const { data: reg } = await db
        .from("event_registrations")
        .select("id, event:events(title, date_time, location)")
        .eq("user_id", m.id)
        .eq("event_id", eventId)
        // Only a seat that is actually confirmed: never an invitation request
        // still waiting for staff (the client only asks for free registrations).
        .eq("payment_status", "free")
        .neq("registration_type", "invitation_request")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!reg) return null;
      const ev = (Array.isArray(reg.event) ? reg.event[0] : reg.event) as
        { title?: string | null; date_time?: string | null; location?: string | null } | null;
      const r = await recipientForUser(db, m.id);
      if (!r) return null;
      const when = ev?.date_time ? `${new Date(ev.date_time).toISOString().slice(0, 16).replace("T", " ")} UTC` : "";
      return {
        ...r,
        recipientEmail: m.email,
        data: {
          event_title: cleanName(ev?.title, 200),
          event_date: when,
          event_location: cleanName(ev?.location, 200),
        },
        ref: `${type}:${reg.id}`,
      };
    }

    case "rfp_submitted":
      // That template is the admin one ("Hello Admin"); admins are told through
      // notify-admins. Members never send it.
      return null;

    case "partner_request_received": {
      // OrganizationPublicPage, OpportunitiesPage, DealFlowPage (and the old
      // UserProfilePage). userId is the request's marina_user_id, as before; the
      // e-mail also goes to the verified members of its marina_organization_id.
      if (!UUID_RE.test(userId)) return null;
      const { data: row } = await db
        .from("partner_requests")
        .select("id, partner_organization_id, marina_organization_id, message")
        .eq("partner_user_id", m.id)
        .eq("marina_user_id", userId)
        .eq("status", "pending")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!row) return null;
      const r = await recipientForUser(db, userId);
      if (!r) return null;
      // partner_requests RLS does not check partner_organization_id: name that
      // organisation only if the caller really belongs to it.
      const fromOrg = row.partner_organization_id && m.orgIds.includes(row.partner_organization_id)
        ? (await orgInfo(db, row.partner_organization_id)).name
        : "";
      const out: Record<string, string> = { ...data, partner_name: fromOrg || pickName(data.partner_name, m.names, selfName) };
      // The message is the one stored on the request (what the marina sees in the app).
      const message = cleanText(row.message, MESSAGE_CHARS);
      if (message) out.message = message;
      else delete out.message;
      // The receiving company, from the database. Only an organisation M3 has verified
      // is named and fanned out to: an owner can add ANY account to their organisation
      // (org_members_insert only checks is_org_owner), so a self-made one could
      // otherwise turn one request into e-mails to people it picked.
      const toOrgInfo = row.marina_organization_id ? await orgInfo(db, row.marina_organization_id) : null;
      const toOrg = toOrgInfo?.verified ? toOrgInfo.name : "";
      if (toOrg) out.org_name = toOrg;
      else delete out.org_name;
      const also = toOrgInfo?.verified ? await companyRecipients(db, row.marina_organization_id, userId, m.id) : [];
      if (also.length) out.team = "yes";
      else delete out.team;
      return { ...r, data: out, ref: `${type}:${row.id}`, also };
    }

    case "partner_request_accepted":
    case "partner_request_rejected": {
      // InboxTab: someone in the receiving company answers a request; the requester is
      // told. The answer is the caller's own: answered_by_user_id is written by the
      // partner_requests trigger from auth.uid(), never by the client.
      if (!UUID_RE.test(userId)) return null;
      const status = type === "partner_request_accepted" ? "accepted" : "rejected";
      const { data: rows } = await db
        .from("partner_requests")
        .select("id, marina_user_id, marina_organization_id")
        .eq("answered_by_user_id", m.id)
        .eq("partner_user_id", userId)
        .eq("status", status)
        .gte("answered_at", since)
        .order("answered_at", { ascending: false })
        .limit(5);
      const row = ((rows || []) as { id: string; marina_user_id: string; marina_organization_id: string | null }[])
        .find((x) => x.marina_user_id === m.id || (!!x.marina_organization_id && m.orgIds.includes(x.marina_organization_id)));
      if (!row) return null;
      const r = await recipientForUser(db, userId);
      if (!r) return null;
      // The answering company, from the database when the caller belongs to it.
      const byOrg = row.marina_organization_id && m.orgIds.includes(row.marina_organization_id)
        ? (await orgInfo(db, row.marina_organization_id)).name
        : "";
      const out: Record<string, string> = { ...data, marina_name: byOrg || pickName(data.marina_name, m.names, selfName) };
      if (status === "accepted") {
        // The second "To" of the introduction is always the caller's own sign-in address.
        out.acceptor_email = m.email;
        out.acceptor_name = pickName(data.acceptor_name, m.names, out.marina_name);
      } else {
        delete out.acceptor_email;
      }
      return { ...r, data: out, ref: `${type}:${row.id}` };
    }

    case "join_request_received": {
      // OnboardingPage: the caller just asked to join; the org owner is told.
      // An owner can INSERT organization_members rows for ANY user with role 'owner'
      // (org_members_insert only checks is_org_owner), so membership alone would let
      // an attacker make any registered user the "owner" of their organisation. The
      // recipient must also be organizations.owner_user_id, which RLS and
      // guard_org_sensitive_columns keep out of reach (114/114 owner rows match it).
      if (!UUID_RE.test(userId)) return null;
      const { data: realOwned } = await db.from("organizations").select("id").eq("owner_user_id", userId);
      const realOwnedIds = new Set(((realOwned || []) as { id: string }[]).map((o) => o.id));
      const ownerOf = new Set((await ownedOrgIds(db, userId)).filter((id) => realOwnedIds.has(id)));
      if (!ownerOf.size) return null;
      const { data: rows } = await db
        .from("organization_invitations")
        .select("id, organization_id, email")
        .eq("status", "join_requested")
        .in("organization_id", Array.from(ownerOf))
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(200);
      const inv = ((rows || []) as { id: string; organization_id: string; email: string }[])
        .find((x) => sameEmail(x.email, m.email));
      if (!inv) return null;
      const r = await recipientForUser(db, userId);
      if (!r) return null;
      return {
        ...r,
        data: {
          ...data,
          // The recipient's own organisation (owner_user_id checked above).
          org_name: (await orgInfo(db, inv.organization_id)).name || "your organization",
          requester_email: m.email,
          requester_name: pickName(data.requester_name, m.names, selfName),
        },
        ref: `${type}:${inv.id}`,
      };
    }

    case "join_request_approved":
    case "join_request_rejected": {
      // OrganizationTab: the owner decided (approve_join_request / reject_join_request);
      // the requester is told. An owner can INSERT an invitation row with any e-mail
      // and any status, so the row alone proves nothing: a real join request has
      // invited_by_user_id null (request_org_join) and comes from a CONFIRMED account
      // with that sign-in address, which is the only recipient accepted here.
      if (!email) return null;
      const owned = await ownedOrgIds(db, m.id);
      if (!owned.length) return null;
      const status = type === "join_request_approved" ? "accepted" : "rejected";
      const { data: rows } = await db
        .from("organization_invitations")
        .select("id, organization_id, email, first_name, invited_by_user_id")
        .in("organization_id", owned)
        .eq("status", status)
        .gte("updated_at", since)
        .order("updated_at", { ascending: false })
        .limit(200);
      const inv = ((rows || []) as { id: string; organization_id: string; email: string; invited_by_user_id: string | null }[])
        .find((x) => sameEmail(x.email, email) && !x.invited_by_user_id);
      if (!inv) return null;
      const requesterId = await confirmedUserByEmail(db, inv.email);
      if (!requesterId) return null;
      const r = await recipientForUser(db, requesterId);
      if (!r) return null;
      const org = await orgInfo(db, inv.organization_id);
      return {
        ...r,
        data: { ...data, org_name: org.name || "the organization" },
        ref: `${type}:${inv.id}`,
        ...orgFields(type, inv.organization_id, org),
      };
    }

    case "team_invitation":
    case "team_invitation_reminder": {
      // OrganizationTab (invite + resend), InboxTab (resend): pending invitation of an
      // org the caller owns, or that the caller sent. The invitee usually has no
      // account yet, so the address cannot be checked: an organisation M3 has not
      // verified gets a generic subject and a per-organisation cap (see the header).
      if (!email) return null;
      const owned = await ownedOrgIds(db, m.id);
      let q = db
        .from("organization_invitations")
        .select("id, organization_id, email, first_name, created_at")
        .eq("status", "pending");
      q = owned.length
        ? q.or(`invited_by_user_id.eq.${m.id},organization_id.in.(${owned.join(",")})`)
        : q.eq("invited_by_user_id", m.id);
      if (type === "team_invitation") q = q.gte("created_at", since);
      const { data: rows } = await q.order("created_at", { ascending: false }).limit(500);
      const inv = ((rows || []) as { id: string; organization_id: string; email: string; first_name: string | null }[])
        .find((x) => sameEmail(x.email, email));
      if (!inv) return null;
      const org = await orgInfo(db, inv.organization_id);
      return {
        recipientEmail: inv.email,
        recipientUserId: null,
        firstName: cleanName(inv.first_name, PERSON_NAME_CHARS),
        prefs: null,
        data: { ...data, org_name: org.name || "An organization" },
        ref: `${type}:${inv.id}`,
        ...orgFields(type, inv.organization_id, org),
      };
    }

    default:
      return null;
  }
}

/**
 * Per-member throttle, logged in public.email_rate_log (service role only).
 * Fails open if the log table is unavailable: a missing table must not stop
 * legitimate e-mails, the relationship checks above still apply.
 */
async function memberThrottle(db: Db, actorId: string, key: string): Promise<"ok" | "duplicate" | "limited"> {
  try {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: countErr } = await db
      .from("email_rate_log")
      .select("id", { count: "exact", head: true })
      .eq("actor_id", actorId)
      .like("kind", "send-notification:%")
      .gte("created_at", hourAgo);
    if (countErr) throw countErr;
    if ((count || 0) >= MEMBER_HOURLY_CAP) return "limited";

    const dupSince = new Date(Date.now() - MEMBER_DUPLICATE_MS).toISOString();
    const kind = `send-notification:${key}`.slice(0, 300);
    const { data: dup, error: dupErr } = await db
      .from("email_rate_log")
      .select("id")
      .eq("actor_id", actorId)
      .eq("kind", kind)
      .gte("created_at", dupSince)
      .limit(1);
    if (dupErr) throw dupErr;
    if (dup && dup.length) return "duplicate";

    const { error: insErr } = await db.from("email_rate_log").insert({ actor_id: actorId, kind });
    if (insErr) throw insErr;
  } catch (e) {
    console.error("send-notification: rate log unavailable, continuing:", (e as { message?: string })?.message || String(e));
  }
  return "ok";
}

/**
 * Cap on e-mails that name an organisation M3 has not verified: 5 per organisation
 * and 50 for all of them together per 24 h, whoever triggers them (accounts and
 * organisations are free to create, so a per-account cap alone does not bound the
 * relay). Fails CLOSED: without the log there is no bound, and production has never
 * sent such an e-mail (all 7 invitations so far came from verified organisations).
 */
async function unverifiedOrgCapReached(db: Db, orgId: string): Promise<boolean> {
  try {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: perOrg, error: e1 } = await db
      .from("email_rate_log")
      .select("id", { count: "exact", head: true })
      .eq("kind", `org-email:${orgId}`)
      .gte("created_at", dayAgo);
    if (e1) throw e1;
    if ((perOrg || 0) >= UNVERIFIED_ORG_DAILY_CAP) return true;
    const { count: all, error: e2 } = await db
      .from("email_rate_log")
      .select("id", { count: "exact", head: true })
      .like("kind", "org-email:%")
      .gte("created_at", dayAgo);
    if (e2) throw e2;
    return (all || 0) >= UNVERIFIED_ORGS_GLOBAL_DAILY_CAP;
  } catch (e) {
    console.error("send-notification: rate log unavailable, refusing unverified-org e-mail:", (e as { message?: string })?.message || String(e));
    return true;
  }
}

/**
 * The extra e-mails of a company fan-out, logged so that they count towards the
 * caller's hourly cap (memberThrottle counts every "send-notification:%" row). They
 * use their own kind, so the per-row dedupe of memberThrottle is not affected.
 */
async function logFanOut(db: Db, actorId: string, ref: string, extra: number): Promise<void> {
  if (extra <= 0) return;
  const kind = `send-notification:fanout:${ref}`.slice(0, 300);
  const rows = Array.from({ length: Math.min(extra, MAX_COMPANY_FANOUT) }, () => ({ actor_id: actorId, kind }));
  const { error } = await db.from("email_rate_log").insert(rows);
  if (error) console.error("send-notification: could not log the company fan-out:", error.message || String(error));
}

async function logUnverifiedOrgEmail(db: Db, actorId: string, orgId: string): Promise<void> {
  const { error } = await db.from("email_rate_log").insert({ actor_id: actorId, kind: `org-email:${orgId}` });
  if (error) console.error("send-notification: could not log unverified-org e-mail:", error.message || String(error));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }

  const headers = { "Content-Type": "application/json", ...corsHeaders(req) };
  const reply = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers });

  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  try {
    // AUTHORIZATION. verify_jwt stays false: the anon key is itself a valid JWT and
    // ships in the browser bundle, so the gateway check would prove nothing. The
    // caller is the service role, or a real signed-in user resolved by GoTrue.
    const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!bearer) return reply({ error: "Unauthorized" }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let callerKind: "service" | "staff" | "member" = "service";
    let member: Member | null = null;
    if (!sameSecret(bearer, SUPABASE_SERVICE_ROLE_KEY)) {
      const { data: caller } = await supabase.auth.getUser(bearer);
      const u = caller?.user;
      if (!u?.id) return reply({ error: "Unauthorized" }, 401);
      const { data: cp } = await supabase
        .from("profiles")
        .select("persona, access_status")
        .eq("user_id", u.id)
        .maybeSingle();
      const isStaff = !!cp && ["admin", "moderator"].includes(cp.persona || "") && cp.access_status === "verified";
      callerKind = isStaff ? "staff" : "member";
      if (!isStaff) member = await loadMember(supabase, u.id, u.email || "");
    }

    if (!RESEND_API_KEY) return reply({ error: "RESEND_API_KEY not configured" }, 500);

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return reply({ error: "Invalid JSON body" }, 400);

    const type = typeof body.type === "string" ? body.type : "";
    if (!type) return reply({ error: "type is required" }, 400);
    if (!KNOWN_TYPES.has(type)) return reply({ error: "Unknown notification type" }, 400);
    const ntype = type as NotificationType;

    const user_id = typeof body.user_id === "string" ? body.user_id.trim() : "";
    const directEmail = typeof body.email === "string" ? body.email.trim() : "";
    const notifData = sanitizeData(body.data);

    // Resolve recipient email + notification preferences
    let recipientEmail = "";
    let firstName = "";
    let userPrefs: Record<string, boolean> | null = null;
    let recipientUserId: string | null = null;
    // The e-mail goes to that account's own address (not to another address the
    // caller gave): only then may it carry a personal unsubscribe link.
    let toAccountAddress = false;
    let data: Record<string, string> = notifData;
    let subjectOverride = "";
    let fanOut: Recipient[] = [];
    let fanOutRef = "";

    if (member) {
      const grant = await authorizeMemberSend(supabase, member, type, user_id, directEmail, notifData);
      if (!grant) return reply({ error: "This notification is not allowed for this recipient" }, 403);
      if (grant.unverifiedOrgId && (await unverifiedOrgCapReached(supabase, grant.unverifiedOrgId))) {
        return reply({ error: "Too many e-mails for this organization today, try again tomorrow" }, 429);
      }
      const verdict = await memberThrottle(supabase, member.id, grant.ref);
      if (verdict === "limited") return reply({ error: "Too many notifications, try again later" }, 429);
      if (verdict === "duplicate") return reply({ success: true, skipped: true, reason: "duplicate" }, 200);
      if (grant.unverifiedOrgId) await logUnverifiedOrgEmail(supabase, member.id, grant.unverifiedOrgId);
      subjectOverride = grant.subject || "";
      recipientEmail = grant.recipientEmail;
      recipientUserId = grant.recipientUserId;
      toAccountAddress = !!grant.recipientUserId; // resolved from that account's own row
      firstName = grant.firstName; // always the recipient's own name, never the caller's
      userPrefs = grant.prefs;
      data = { ...grant.data };
      delete data.first_name;
      fanOut = grant.also || [];
      fanOutRef = grant.ref;
    } else {
      // service / staff: recipient as given (unchanged behaviour), first_name from
      // the caller's data or the recipient profile.
      recipientEmail = directEmail;
      firstName = notifData.first_name || "";
      if (user_id) {
        if (!UUID_RE.test(user_id)) return reply({ error: "Invalid user_id" }, 400);
        const r = await recipientForUser(supabase, user_id);
        if (r) {
          if (!recipientEmail) recipientEmail = r.recipientEmail;
          toAccountAddress = sameEmail(recipientEmail, r.recipientEmail);
          firstName = firstName || r.firstName;
          userPrefs = r.prefs;
          recipientUserId = user_id;
        }
      }
    }

    if (!recipientEmail || !isEmail(recipientEmail)) {
      return reply({ error: "Could not resolve recipient email" }, 400);
    }

    // Everyone who gets this e-mail: the recipient, plus, for partner_request_received,
    // the colleagues companyRecipients() found (each with their own name, address and
    // preferences; one per address).
    const targets: Recipient[] = [{ recipientEmail, recipientUserId, firstName, prefs: userPrefs }];
    for (const extra of fanOut) {
      if (targets.some((x) => sameEmail(x.recipientEmail, extra.recipientEmail) || (!!extra.recipientUserId && x.recipientUserId === extra.recipientUserId))) continue;
      targets.push(extra);
    }

    // Per-user opt-out check.
    // Only applies when the recipient has a profile (user_id provided).
    // Anonymous sends (team invitations to non-users, claim codes, etc.) bypass
    // the check — they have no profile to express a preference yet.
    const category = TYPE_TO_CATEGORY[ntype];
    let sent = 0;
    let optedOut = 0;
    let providerError = false;
    for (const target of targets) {
      if (target.prefs && category && target.prefs[category] === false) {
        console.log(`Notification [${type}] (${category}) skipped — user ${target.recipientUserId} opted out`);
        optedOut++;
        continue;
      }

      // Two renderings of the same template: raw data for the subject and the plain
      // text part, HTML-escaped data for the HTML part (see renderNotification). The
      // button link is re-based onto the site origin whatever the template or the
      // caller put there. The greeting is always the recipient's own first name.
      const rawData: Record<string, string> = {
        ...data,
        first_name: target === targets[0] ? (firstName || data.first_name || "") : target.firstName,
      };

      // Unsubscribe. A personal signed link (see the token block) only when the e-mail
      // goes to one registered account, at its own address, alone: the introduction
      // (partner_request_accepted) goes to both parties with M3 in copy, so it gets
      // the plain page, which asks the reader to sign in. Colleagues added by the
      // company fan-out are resolved from their own account rows, so they get their
      // own link. The footer link opens the page; the List-Unsubscribe header points at
      // the function itself, which takes the RFC 8058 one-click POST (a static page cannot).
      const ownAddress = target === targets[0] ? toAccountAddress : !!target.recipientUserId;
      const personalUnsubscribe = !!target.recipientUserId && ownAddress && ntype !== "partner_request_accepted" && !!SUPABASE_SERVICE_ROLE_KEY && !!SUPABASE_URL;
      let unsubscribeUrl = `${SITE_URL}/unsubscribe`;
      let unsubscribeHeaders: Record<string, string> = {
        "List-Unsubscribe": `<${unsubscribeUrl}>, <mailto:unsubscribe@smartmarinaconnect.com>`,
      };
      if (personalUnsubscribe && target.recipientUserId) {
        try {
          const unsubToken = await signUnsubToken(SUPABASE_SERVICE_ROLE_KEY, target.recipientUserId, category || "all");
          unsubscribeUrl = `${SITE_URL}/unsubscribe?t=${unsubToken}`;
          unsubscribeHeaders = {
            "List-Unsubscribe": `<${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/unsubscribe?t=${unsubToken}>, <mailto:unsubscribe@smartmarinaconnect.com>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          };
        } catch (e) {
          console.error("send-notification: unsubscribe token failed:", (e as { message?: string })?.message || String(e));
        }
      }

      // Build email payload (with anti-spam improvements)
      const { subject, html, text } = renderNotification(ntype, rawData, subjectOverride, unsubscribeUrl);
      const emailPayload: Record<string, unknown> = {
        from: SENDER_EMAIL,
        to: [target.recipientEmail],
        reply_to: EM.contact,
        subject,
        html,
        text,
        headers: {
          ...unsubscribeHeaders,
          "X-Entity-Ref-ID": `${type}-${Date.now()}`,
        },
      };
      // For B2B acceptance: send to BOTH parties (requester + acceptor) with victor in CC as introduction.
      // For a member caller, acceptor_email was forced to the caller's own sign-in address above.
      // (Never fanned out: only partner_request_received has more than one target.)
      if (ntype === "partner_request_accepted") {
        const acceptorEmail = (data.acceptor_email || "").trim();
        const recipients = [target.recipientEmail];
        if (acceptorEmail && isEmail(acceptorEmail) && !sameEmail(acceptorEmail, target.recipientEmail)) {
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
        providerError = true;
        continue;
      }
      sent++;
      console.log(`Notification [${type}] sent by ${callerKind} to ${target.recipientUserId || "address"}`);
    }

    // Every e-mail beyond the first counts towards the caller's hourly cap (see the header).
    if (member && sent > 1) await logFanOut(supabase, member.id, fanOutRef, sent - 1);

    if (sent === 0 && providerError) return reply({ error: "Email provider error" }, 502);
    if (sent === 0 && optedOut > 0) {
      return reply({ success: true, skipped: true, reason: "user_opted_out", category }, 200);
    }
    return reply(targets.length > 1 ? { success: true, type, sent } : { success: true, type }, 200);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error in send-notification:", message);
    return reply({ error: "Internal error" }, 500);
  }
});

// Unsubscribe link of every notification: a signed token for the recipient account and
// the notification category, read by the "unsubscribe" function (supabase/functions/
// unsubscribe/index.ts, which documents the contract) and by the /unsubscribe page.
// ---- SMC unsubscribe token v1 (keep identical in send-notification and unsubscribe) ----
// token = base64url(payload JSON) + "." + base64url(HMAC-SHA-256(key, first part)),
// payload = { v: 1, u: <user id>, c: <notification category or "all">, iat: <unix s> },
// key = SHA-256("smc-unsubscribe-v1:" + service-role key): no extra secret to set. A
// token made under an older service-role key no longer verifies (the page then
// offers the preferences page after signing in).
const UNSUB_KEY_PREFIX = "smc-unsubscribe-v1:";
let unsubKeyCache: { secret: string; key: Promise<CryptoKey> } | null = null;

function unsubKey(secret: string): Promise<CryptoKey> {
  if (!unsubKeyCache || unsubKeyCache.secret !== secret) {
    const key = crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(UNSUB_KEY_PREFIX + secret))
      .then((raw) => crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]));
    unsubKeyCache = { secret, key };
  }
  return unsubKeyCache.key;
}

function unsubB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unsubUnB64(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** A signed unsubscribe token for one account and one category ("all" for every optional one). */
async function signUnsubToken(secret: string, userId: string, category: string): Promise<string> {
  const body = unsubB64(new TextEncoder().encode(JSON.stringify({ v: 1, u: userId, c: category, iat: Math.floor(Date.now() / 1000) })));
  const sig = await crypto.subtle.sign("HMAC", await unsubKey(secret), new TextEncoder().encode(body));
  return `${body}.${unsubB64(new Uint8Array(sig))}`;
}

/** The token's account and category, or null when it is malformed or not signed with the current key. */
async function verifyUnsubToken(secret: string, token: unknown): Promise<{ userId: string; category: string; issuedAt: number } | null> {
  if (!secret || typeof token !== "string" || token.length > 600) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const sig = unsubUnB64(parts[1]);
  const raw = unsubUnB64(parts[0]);
  if (!sig || sig.length !== 32 || !raw) return null;
  const valid = await crypto.subtle.verify("HMAC", await unsubKey(secret), sig, new TextEncoder().encode(parts[0]));
  if (!valid) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(raw));
    if (!p || p.v !== 1 || typeof p.u !== "string" || typeof p.c !== "string" || typeof p.iat !== "number") return null;
    if (!/^[a-z0-9_]{1,40}$/.test(p.c)) return null;
    return { userId: p.u, category: p.c, issuedAt: p.iat };
  } catch {
    return null;
  }
}
// ---- end SMC unsubscribe token ----

// ── E-mail rendering ──
//
// Every notification uses the shared SMC layout (refonte look, same frame as the Mailchimp
// welcome e-mail). The templates above keep producing text; the layout block below turns it
// into HTML: blank line = paragraph, "• " = bullet, "Reason:"/"Message:" = note box,
// trailing "Date:"/"Location:"/"Transaction ID:" lines = info table (see emTextToHtml).

// ---- SMC e-mail layout v1 (keep identical in every function) ----
// Shared look of every Smart Marina Connect service e-mail: the refonte design, the same
// frame as the Mailchimp welcome e-mail (navy band, 4 px gold rule, white 600 px card on a
// pale page, gold pill button, teal eyebrow, light footer). Pure functions: no import, no
// Deno API, no network. Reference copy: docs/email-layout.ts. Rules: docs/email-design.md.
//
// CONTRACT. Every string passed as HTML (title, eyebrow, greeting, bodyHtml, labels, urls,
// notes) must ALREADY be HTML-safe: escape whatever a user or a database row wrote with
// emEsc() first. Only trusted template markup (<strong>, <br>, entities) may stay raw.
// emText() works on plain, unescaped text.
const EM = {
  brand: "Smart Marina Connect",
  byline: "by M3 Monaco",
  site: "https://smartmarinaconnect.com",
  logo: "https://smartmarinaconnect.com/logo-white.png",
  contact: "events@m3monaco.com",
  navy: "#0b2653",
  gold: "#d7a647",
  teal: "#1f7a8c",
  ink: "#1f2937",
  muted: "#5b6475",
  line: "#e3e7ee",
  page: "#eef2f8",
  soft: "#f6f7f9",
  white: "#ffffff",
  font: "Arial, Helvetica, sans-serif",
  mono: "'Courier New', Courier, monospace",
};

function emEsc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function emStripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "");
}

/** A body paragraph (HTML-safe content). */
function emP(html: string, gap = 16): string {
  return `<p style="margin:0 0 ${gap}px;font-family:${EM.font};font-size:16px;line-height:25px;color:${EM.ink};">${html}</p>`;
}

/** The gold pill button. `label` and `url` are HTML-safe. */
function emButton(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="${EM.gold}" style="border-radius:999px;background-color:${EM.gold};"><a href="${url}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${EM.font};font-size:16px;line-height:20px;font-weight:bold;color:${EM.navy};text-decoration:none;border-radius:999px;">${label} &rarr;</a></td></tr></table>`;
}

/** A bold underlined text link (secondary action). */
function emLink(label: string, url: string): string {
  return `<a href="${url}" target="_blank" style="color:${EM.navy};font-weight:bold;text-decoration:underline;">${label}</a>`;
}

/** Label / value rows. Labels render as small teal capitals; both sides are HTML-safe. */
function emInfoTable(rows: Array<[string, string]>): string {
  if (!rows.length) return "";
  const last = rows.length - 1;
  const tr = rows
    .map(([k, v], i) => {
      const edge = `border-top:1px solid ${EM.line};${i === last ? `border-bottom:1px solid ${EM.line};` : ""}`;
      return `<tr><td valign="top" width="36%" style="padding:11px 12px 11px 0;${edge}font-family:${EM.font};font-size:12px;line-height:20px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${EM.teal};">${k}</td><td valign="top" style="padding:11px 0;${edge}font-family:${EM.font};font-size:15px;line-height:20px;color:${EM.ink};word-break:break-word;">${v}</td></tr>`;
    })
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:2px 0 18px;">${tr}</table>`;
}

/** A highlighted quote or reason: pale box, gold left rule, optional small-caps label. */
function emNote(html: string, label?: string): string {
  const head = label
    ? `<span style="display:block;margin:0 0 4px;font-size:12px;line-height:16px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${EM.teal};">${label}</span>`
    : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:2px 0 18px;"><tr><td bgcolor="${EM.soft}" style="background-color:${EM.soft};border-left:4px solid ${EM.gold};padding:14px 18px;font-family:${EM.font};font-size:15px;line-height:23px;color:${EM.ink};">${head}${html}</td></tr></table>`;
}

/** A code to read or type (verification code, organization code). `code` is HTML-safe. */
function emCode(code: string): string {
  return `<span style="display:inline-block;padding:12px 22px;background-color:${EM.soft};border:1px solid ${EM.line};border-radius:10px;font-family:${EM.mono};font-size:26px;line-height:32px;font-weight:bold;letter-spacing:5px;color:${EM.navy};">${code}</span>`;
}

function emBullets(items: string[]): string {
  const rows = items
    .map(
      (it) =>
        `<tr><td valign="top" width="18" style="padding:0 0 6px;font-family:${EM.font};font-size:16px;line-height:25px;font-weight:bold;color:${EM.teal};">&bull;</td><td valign="top" style="padding:0 0 6px;font-family:${EM.font};font-size:16px;line-height:25px;color:${EM.ink};">${it}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;">${rows}</table>`;
}

// Turns an HTML-safe text body into paragraphs. Blank line = new paragraph, line break =
// <br>. Three conventions are recognised (everything else stays a plain paragraph):
//   "• item" lines                         -> bullet list
//   "Reason: ..." / "Feedback: ..." / "Message: ..." / "Moderator notes: ..." paragraph
//                                          -> note box
//   trailing "Date:" / "Location:" / "Payment type:" / "Transaction ID:" /
//   "Organization:" / "Deadline:" lines    -> info table
const EM_NOTE_RE = /^(Reason provided by our team|Reason|Feedback|Moderator notes|Message):[ \t]*/;
const EM_ROW_RE = /^(Date|Location|Payment type|Transaction ID|Organization|Deadline):[ \t]*(.*)$/;
const EM_BULLET_RE = /^•[ \t]+(.*)$/;

function emBlock(block: string): string {
  const note = block.match(EM_NOTE_RE);
  if (note) {
    const rest = block.slice(note[0].length).replace(/^\n+/, "").trim().replace(/\n/g, "<br>");
    return emNote(rest, note[1]);
  }
  const lines = block.split("\n");
  const rows: Array<[string, string]> = [];
  while (lines.length) {
    const m = lines[lines.length - 1].match(EM_ROW_RE);
    if (!m) break;
    rows.unshift([m[1], m[2]]);
    lines.pop();
  }
  const out: string[] = [];
  let run: string[] = [];
  let bullets: string[] = [];
  const flushRun = (beforeBullets: boolean) => {
    if (run.length) out.push(emP(run.join("<br>"), beforeBullets ? 8 : 16));
    run = [];
  };
  const flushBullets = () => {
    if (bullets.length) out.push(emBullets(bullets));
    bullets = [];
  };
  for (const line of lines) {
    const b = line.match(EM_BULLET_RE);
    if (b) {
      flushRun(true);
      bullets.push(b[1]);
    } else {
      flushBullets();
      run.push(line);
    }
  }
  flushRun(false);
  flushBullets();
  if (rows.length) out.push(emInfoTable(rows));
  return out.join("\n");
}

function emTextToHtml(safe: string): string {
  const text = safe
    .replace(/\r\n?/g, "\n")
    .replace(/<strong>/g, `<strong style="color:${EM.navy};">`)
    .trim();
  if (!text) return "";
  return text
    .split(/\n\s*\n/)
    .map(emBlock)
    .filter(Boolean)
    .join("\n");
}

interface EmailLayoutInput {
  /** <title> of the page. */
  pageTitle?: string;
  /** Inbox preview line, hidden in the body. */
  preheader?: string;
  /** Small teal capitals above the title. */
  eyebrow?: string;
  /** Main heading; empty = none (introductions). */
  title?: string;
  /** "Hello Alex," */
  greeting?: string;
  /** Body, built with emP / emTextToHtml / emInfoTable / emNote / emCode. */
  bodyHtml: string;
  /** Gold pill button; showUrl prints the link under it for clients that block buttons. */
  cta?: { label: string; url: string; showUrl?: boolean };
  /** Text link under the button. */
  secondary?: { label: string; url: string };
  /** Closing lines in body size ("Best regards, ..."). */
  signoff?: string;
  /** Small muted line under the content ("If you did not ask for this, ..."). */
  footerNote?: string;
  /** Footer: why the recipient gets this e-mail. */
  reason?: string;
  /** Footer: extra small links (preferences...). */
  footerLinks?: Array<{ label: string; url: string }>;
  lang?: string;
}

function emailLayout(o: EmailLayoutInput): string {
  const f = EM.font;
  const preheader = o.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${EM.page};opacity:0;">${o.preheader}${"&zwnj;&nbsp;".repeat(40)}</div>`
    : "";
  const eyebrow = o.eyebrow
    ? `<p style="margin:0 0 10px;font-family:${f};font-size:12px;line-height:16px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${EM.teal};">${o.eyebrow}</p>`
    : "";
  const title = o.title
    ? `<h1 class="h1" style="margin:0 0 18px;font-family:${f};font-size:26px;line-height:32px;font-weight:bold;color:${EM.navy};">${o.title}</h1>`
    : "";
  const greeting = o.greeting ? emP(o.greeting) : "";
  const showUrl = o.cta?.showUrl
    ? `<p style="margin:14px 0 0;font-family:${f};font-size:13px;line-height:19px;color:${EM.muted};word-break:break-all;">If the button does not work, copy this link into your browser:<br><a href="${o.cta.url}" style="color:${EM.muted};text-decoration:underline;">${o.cta.url}</a></p>`
    : "";
  const secondary = o.secondary
    ? `<p style="margin:16px 0 0;font-family:${f};font-size:15px;line-height:22px;">${emLink(o.secondary.label, o.secondary.url)}</p>`
    : "";
  const cta = o.cta
    ? `<tr><td class="px" align="left" style="padding:8px 40px 8px;">${emButton(o.cta.label, o.cta.url)}${showUrl}${secondary}</td></tr>`
    : o.secondary
      ? `<tr><td class="px" align="left" style="padding:0 40px 8px;">${secondary}</td></tr>`
      : "";
  const signoff = o.signoff
    ? `<tr><td class="px" style="padding:18px 40px 0;font-family:${f};font-size:16px;line-height:25px;color:${EM.ink};">${o.signoff}</td></tr>`
    : "";
  const note = o.footerNote
    ? `<tr><td class="px" style="padding:22px 40px 32px;"><div style="border-top:1px solid ${EM.line};padding-top:16px;font-family:${f};font-size:14px;line-height:21px;color:${EM.muted};">${o.footerNote}</div></td></tr>`
    : `<tr><td style="height:28px;line-height:28px;font-size:0;">&nbsp;</td></tr>`;
  const reason = o.reason ? `<p style="margin:10px 0 0;">${o.reason}</p>` : "";
  const links = o.footerLinks && o.footerLinks.length
    ? `<p style="margin:10px 0 0;">${o.footerLinks
        .map((l) => `<a href="${l.url}" style="color:${EM.muted};text-decoration:underline;">${l.label}</a>`)
        .join(" &nbsp;&middot;&nbsp; ")}</p>`
    : "";
  return `<!DOCTYPE html>
<html lang="${o.lang || "en"}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${o.pageTitle || o.title || EM.brand}</title>
<style>
  :root { color-scheme: light; supported-color-schemes: light; }
  body { margin: 0; padding: 0; background: ${EM.page}; }
  a { color: ${EM.navy}; }
  @media only screen and (max-width: 620px) {
    .container { width: 100% !important; }
    .px { padding-left: 24px !important; padding-right: 24px !important; }
    .h1 { font-size: 23px !important; line-height: 29px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${EM.page};" bgcolor="${EM.page}">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${EM.page}" style="background-color:${EM.page};">
<tr><td align="center" style="padding:32px 12px;">
<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${EM.white}" style="width:100%;max-width:600px;background-color:${EM.white};border-radius:16px;overflow:hidden;">
<tr><td class="px" bgcolor="${EM.navy}" style="background-color:${EM.navy};padding:24px 40px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle" style="padding-right:12px;"><img src="${EM.logo}" width="22" alt="" style="display:block;width:22px;height:auto;border:0;"></td>
<td valign="middle" style="font-family:${f};font-size:18px;line-height:24px;font-weight:bold;color:${EM.white};letter-spacing:0.2px;">${EM.brand}</td>
</tr></table>
</td></tr>
<tr><td bgcolor="${EM.gold}" style="height:4px;line-height:4px;font-size:0;background-color:${EM.gold};">&nbsp;</td></tr>
<tr><td class="px" style="padding:34px 40px 6px;">
${eyebrow}${title}${greeting}
${o.bodyHtml}
</td></tr>
${cta}
${signoff}
${note}
<tr><td class="px" bgcolor="${EM.soft}" style="background-color:${EM.soft};padding:22px 40px;font-family:${f};font-size:12px;line-height:18px;color:${EM.muted};">
<p style="margin:0 0 6px;font-weight:bold;">${EM.brand} &middot; ${EM.byline}</p>
<p style="margin:0 0 6px;">Questions? <a href="mailto:${EM.contact}" style="color:${EM.muted};text-decoration:underline;">${EM.contact}</a></p>
<p style="margin:0;"><a href="${EM.site}" style="color:${EM.muted};text-decoration:underline;">smartmarinaconnect.com</a></p>
${reason}${links}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** Plain-text alternative of an e-mail. Every field is plain, unescaped text without markup (strip tags with emStripTags first). */
function emText(o: {
  title?: string;
  greeting?: string;
  body: string;
  cta?: { label: string; url: string };
  secondary?: { label: string; url: string };
  signoff?: string;
  footerNote?: string;
  reason?: string;
  links?: Array<{ label: string; url: string }>;
}): string {
  const out: string[] = [];
  if (o.title) out.push(o.title, "");
  if (o.greeting) out.push(o.greeting, "");
  const body = o.body.trim();
  if (body) out.push(body, "");
  if (o.cta) out.push(`${o.cta.label}: ${o.cta.url}`, "");
  if (o.secondary) out.push(`${o.secondary.label}: ${o.secondary.url}`, "");
  if (o.signoff) out.push(o.signoff.trim(), "");
  out.push("---");
  if (o.footerNote) out.push(o.footerNote.trim(), "");
  out.push(`${EM.brand} · ${EM.byline}`, `Questions? ${EM.contact}`, EM.site);
  if (o.reason) out.push("", o.reason);
  if (o.links) for (const l of o.links) out.push(`${l.label}: ${l.url}`);
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
// ---- end SMC e-mail layout ----

// Small capitals above the title, from the notification category unless overridden.
const CATEGORY_EYEBROW: Record<NotificationCategory, string> = {
  b2b: "B2B network",
  submissions: "Your submission",
  recommendations: "Recommendations",
  events: "Events",
  payments: "Payments",
  team: "Your team",
  account: "Your account",
  marketing: "Getting started",
  admin: "Admin",
};

const TYPE_EYEBROW: Partial<Record<NotificationType, string>> = {
  partner_request_accepted: "Introduction",
  partner_onboarding_welcome: "Welcome",
  org_claim_code: "Your organization",
  profile_reminder_signup_stalled: "Your profile",
  profile_reminder_onboarding_incomplete: "Your profile",
  profile_reminder_pending_review_followup: "Your profile",
  profile_reminder_verified_but_thin: "Your profile",
};

// Plain text version (required for good deliverability, prevents spam).
function buildPlainText(content: EmailContent, unsubscribeUrl: string, intro: boolean): string {
  return emText({
    title: content.title,
    greeting: content.greeting,
    body: emStripTags(content.body),
    cta: { label: content.buttonText, url: content.buttonUrl },
    ...(intro ? { signoff: content.footer } : { footerNote: content.footer }),
    reason: "You received this e-mail because you have an account on Smart Marina Connect.",
    links: [{ label: "To unsubscribe from these notifications", url: unsubscribeUrl }],
  });
}

// `content` is the HTML-escaped rendering of the template.
function buildEmail(content: EmailContent, eyebrow: string, preheader: string, intro: boolean, unsubscribeUrl: string): string {
  const closing = content.footer.replace(/\n/g, "<br>");
  return emailLayout({
    pageTitle: content.subject,
    preheader,
    eyebrow: escapeHtml(eyebrow),
    title: content.title,
    greeting: content.greeting,
    bodyHtml: emTextToHtml(content.body),
    cta: { label: content.buttonText, url: content.buttonUrl },
    // The introduction e-mail ends with a signature, the others with a small note.
    ...(intro ? { signoff: closing } : { footerNote: closing }),
    reason: "You received this e-mail because you have an account on Smart Marina Connect.",
    footerLinks: [
      { label: "Manage preferences", url: escapeHtml(`${SITE_URL}/account?tab=notifications`) },
      { label: "Unsubscribe", url: escapeHtml(unsubscribeUrl) },
      { label: "Contact", url: escapeHtml(`${SITE_URL}/contact`) },
    ],
  });
}

/** Subject, HTML and plain-text parts of one notification. Pure: no I/O. */
function renderNotification(
  ntype: NotificationType,
  rawData: Record<string, string>,
  subjectOverride: string,
  unsubscribeUrl: string,
): { subject: string; html: string; text: string } {
  const textContent = getEmailContent(ntype, rawData);
  const htmlContent = getEmailContent(ntype, escapeData(rawData));
  const buttonUrl = toSiteUrl(textContent.buttonUrl);
  textContent.buttonUrl = buttonUrl;
  htmlContent.buttonUrl = escapeHtml(buttonUrl);
  if (subjectOverride) textContent.subject = subjectOverride;
  const subject = textContent.subject.replace(/[\r\n]+/g, " ").slice(0, 200);
  htmlContent.subject = escapeHtml(subject);

  // partner_request_accepted is the introduction of two parties: no title, signed.
  const intro = ntype === "partner_request_accepted";
  const eyebrow = TYPE_EYEBROW[ntype] || CATEGORY_EYEBROW[TYPE_TO_CATEGORY[ntype]] || "";
  const preheader = escapeHtml(emStripTags(textContent.body).replace(/\s+/g, " ").trim().slice(0, 140));
  return {
    subject,
    html: buildEmail(htmlContent, eyebrow, preheader, intro, unsubscribeUrl),
    text: buildPlainText(textContent, unsubscribeUrl, intro),
  };
}
