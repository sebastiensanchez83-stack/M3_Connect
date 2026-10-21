/**
 * The words of the e-mail a requester gets when M3 changes the status of their marina request
 * (Admin > Marina requests). The admin page shows them BEFORE the change ("What they will
 * receive"); the e-mail itself is written by send-notification (type market_request_status),
 * which carries a copy of this function. tests/market-email.test.mjs renders every case with
 * both copies and fails when they differ: change both together.
 *
 * Pure (no import), English only, short and plain. Partner leads never get one (no account).
 */

export interface MarketRequestWords {
  subject: string;
  greeting: string;
  title: string;
  body: string;
  buttonText: string;
  /** /account?tab=<tab>: the requester's "My requests" on the site. */
  tab: string;
  footer: string;
}

// ---- market request e-mail words v1 (two identical copies: admin/v2/market/marketEmail.ts and send-notification)
export function marketRequestWords(kind: string, status: string, title: string, message: string, firstName: string): MarketRequestWords | null {
  const what = kind === "consultation" ? "consultation" : kind === "project" ? "marina project" : "request for proposals";
  const tab = kind === "consultation" ? "consultations" : kind === "project" ? "projects" : "rfps";
  const named = title ? ` "${title}"` : "";
  const note = message ? `\n\nMessage from the M3 team:\n${message}` : "";
  const base = {
    greeting: firstName ? `Hello ${firstName},` : "Hello,",
    buttonText: "See my requests",
    tab,
    footer: "You receive this e-mail because you published this request on Smart Marina Connect.",
  };
  if (status === "approved") {
    return {
      ...base,
      subject: `Your ${what} is published`,
      title: "Your request is published",
      body: `Good news: your ${what}${named} is now published on the Smart Marina Connect marketplace. Partners can see it and contact you.${note}`,
    };
  }
  if (status === "rejected") {
    const again = kind === "project" ? "" : "You can change it and send it again from your account. ";
    return {
      ...base,
      subject: `Your ${what} was not published`,
      title: "Your request was not published",
      body: `We have read your ${what}${named} and cannot publish it as it is.${message ? `\n\nReason: ${message}` : ""}\n\n${again}If you have a question, simply reply to this e-mail.`,
    };
  }
  if (status === "closed") {
    return {
      ...base,
      subject: `Your ${what} is closed`,
      title: "Your request is closed",
      body: `Your ${what}${named} is now closed. It no longer shows on the marketplace, and partners can no longer answer it.${note}`,
    };
  }
  if (status === "completed") {
    return {
      ...base,
      subject: `Your ${what} is completed`,
      title: "Your project is completed",
      body: `Your ${what}${named} is now marked as completed on Smart Marina Connect. Thank you for sharing it with the network.${note}`,
    };
  }
  return null;
}
// ---- end market request e-mail words ----

/** The statuses whose change e-mails the requester (as market_request_mails in the database). */
export function statusSendsEmail(kind: string, status: string): boolean {
  if (kind === 'rfp' || kind === 'consultation') return status === 'approved' || status === 'rejected' || status === 'closed';
  if (kind === 'project') return status === 'approved' || status === 'rejected' || status === 'completed';
  return false;
}
