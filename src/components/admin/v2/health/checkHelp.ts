/**
 * Plain-English help for every check of the site monitor (admin refonte, Site health page).
 * One entry per check id of ops_health_checks() (39 on 21 Oct 2026) plus the three web probes
 * and report.unavailable, which only the automatic run (the ops-health edge function) records.
 *
 *   title  what the check watches, in a few words a non-technical person understands;
 *   todo   the first move when it is orange or red (staff-facing, one line);
 *   link   where that move happens in the admin, when it happens there.
 *
 * Source of the rules: docs/operations/health-monitor.md ("The checks"). A check id the site
 * does not know yet (a new check added later) still shows, with its id as title and a generic
 * "what to do"; nothing breaks.
 */

export interface CheckHelp {
  title: string;
  todo: string;
  /** adminOnly: the screen is for admins (moderators do not see the pill). */
  link?: { to: string; label: string; adminOnly?: boolean };
}

/** The WYS guest list (the monitor watches platform_settings.ops_health.wys_slug, wys26 today). */
const WYS_GUEST_LIST = '/admin/guest-list/wys26';
const TECH = 'Tell the technical contact.';

export const CHECK_HELP: Record<string, CheckHelp> = {
  // Scheduled jobs (pg_cron)
  'cron.failed_runs': { title: 'Scheduled jobs that failed', todo: `A nightly or hourly job stopped with an error. ${TECH}` },
  'cron.stale_jobs': { title: 'Scheduled jobs running on time', todo: `A job did not run when expected: it was switched off or keeps failing. ${TECH}` },
  'cron.slow_runs': { title: 'Slow or stuck scheduled jobs', todo: 'Usually a slow moment that passes. If it stays orange for a day, tell the technical contact.' },
  'cron.dormant_sm26': { title: 'Old SM26 reminder jobs', todo: 'SM26 reminder jobs are still planned. Ask Victor whether to switch them off.' },
  'cron.history_size': { title: 'Size of the job history', todo: `The job history is getting large. ${TECH} They can clear old rows.` },

  // Scheduled calls (pg_net to the site's functions)
  'calls.vault_secrets': { title: 'Keys of the scheduled calls', todo: `A secret key is missing: every scheduled e-mail and reminder is silently skipped. ${TECH} Urgent.` },
  'calls.http_errors': { title: 'Scheduled calls answered with an error', todo: `A scheduled call to the site's functions failed. ${TECH}` },
  'calls.missing_answers': { title: 'Reminder runs without an answer', todo: 'A reminder run got no answer. If it repeats, tell the technical contact.' },
  'calls.answer_errors': { title: 'Errors reported inside answers', todo: `A function answered but reported a problem inside. ${TECH}` },
  'calls.queue_backlog': { title: 'Calls waiting in the queue', todo: 'Calls are piling up. If the number keeps growing for an hour, tell the technical contact.' },
  'calls.reminder_volume': { title: 'Number of profile reminders sent', todo: `Too many profile reminders in 24 hours: members may feel spammed. ${TECH}` },

  // Registrations and accounts
  'reg.provisioning': { title: 'Account set-up after a registration', todo: `Accounts that should be set up after a registration are waiting or failed. ${TECH}` },
  'reg.confirmed_without_job': { title: 'Confirmed guests without an account set-up', todo: `A confirmed guest did not get their account set-up started. ${TECH}` },
  'reg.outbox': { title: 'Notifications waiting to be sent', todo: `Notifications are stuck before sending. ${TECH}` },

  // Payments
  'pay.emails': { title: 'E-mails after a payment', todo: 'Someone paid but did not get their payment e-mail. Send it by hand, and tell the technical contact.' },
  'pay.ipn_review': { title: 'Payments flagged by the bank', todo: 'Check the amount in the bank back office (M3 also got an e-mail about it).' },
  'pay.stale_pending': { title: 'Payments pending for over a day', todo: 'A payment was started and never finished. Usually abandoned; check it in the bank back office if in doubt.' },

  // WYS guest list (urgent from 20 to 28 Nov)
  'wys.pass_missing': { title: 'QR entry pass e-mails', todo: 'A confirmed guest has no QR e-mail. Open the guest list and resend their entry pass (envelope icon on their row).', link: { to: WYS_GUEST_LIST, label: 'Open the WYS guest list', adminOnly: true } },
  'wys.emails_missing': { title: 'Guest-list e-mails', todo: 'An invitation, answer or staff notice did not leave. Resend it from the guest list, the same day.', link: { to: WYS_GUEST_LIST, label: 'Open the WYS guest list', adminOnly: true } },
  'wys.event': { title: 'The WYS event settings', todo: 'Someone changed the WYS event. Do not change it back yourself: call the technical contact now.' },
  'wys.guests_integrity': { title: 'WYS guest list consistency', todo: 'Something is wrong in the guest rows (QR codes or statuses). Do not edit them: call the technical contact now.' },
  'wys.capacity': { title: 'WYS seats left', todo: 'The guest list is full. Decide whether to accept more people than planned.', link: { to: WYS_GUEST_LIST, label: 'Open the WYS guest list', adminOnly: true } },
  'wys.door': { title: 'WYS door check-in', todo: 'The door check-in may not work. Call the technical contact now.' },

  // Unexpected changes
  'drift.function_pins': { title: 'Protected database functions', todo: 'A protected function changed. If nobody planned it, tell the technical contact today.' },
  'drift.freeze': { title: 'Changes during the WYS freeze', todo: 'A database change was made during the 20-28 Nov freeze. Check with the technical contact that it was planned.' },
  'drift.sm26_archive': { title: 'SM26 archive unchanged', todo: 'The SM26 records changed (new invoices are allowed). If nobody planned it, tell the technical contact.' },

  // Security
  'security.open_functions': { title: 'Internal functions closed to the public', todo: `Some internal functions can be run from outside. ${TECH}` },

  // Database
  'db.connections': { title: 'Database connections in use', todo: 'The database is close to its connection limit. If it stays red, tell the technical contact.' },
  'db.long_running': { title: 'Long database queries', todo: 'A query has been running for a long time. If it stays orange for an hour, tell the technical contact.' },
  'db.replication_slots': { title: 'Database disk use (replication)', todo: `Something left behind is filling the database disk. ${TECH}` },
  'db.wraparound': { title: 'Database maintenance', todo: `The database needs maintenance soon. ${TECH}` },
  'db.size': { title: 'Database size', todo: 'The database is getting big. Plan more disk space with the technical contact.' },

  // Stored files
  'storage.event_media': { title: 'Event files kept safe', todo: 'Event files were deleted, and this folder has no backup. If nobody planned it, tell the technical contact today.' },

  // E-mails
  'email.automatic_volume': { title: 'Automatic e-mails per person', todo: 'Someone got more than 5 automatic e-mails in 24 hours. Look who in the e-mail log.', link: { to: '/admin/email-log', label: 'Open the e-mail log', adminOnly: true } },

  // Other
  'other.contact_inbox': { title: 'Contact form messages delivered', todo: 'A contact message was saved but not e-mailed to M3. Read it in the Inbox.', link: { to: '/admin/inbox#contact-messages', label: 'Open the Inbox' } },
  'other.pulse_snapshot': { title: 'Daily figures of the Market tab', todo: 'The daily figures were not updated this morning. If it lasts two days, tell the technical contact.' },
  'other.crm_outbox': { title: 'Sending to the CRM', todo: 'Some updates did not reach the CRM. Not urgent; tell the technical contact.' },
  'other.digest_log': { title: 'Friday digest e-mail', todo: `The Friday digest is stuck while sending. ${TECH}` },
  'other.invitation_expiry': { title: 'Team invitations expiring', todo: `Old team invitations are not expiring: the job that closes them is not running. ${TECH}` },

  // Website (checked only by the automatic run)
  'web.site': { title: 'The website opens', todo: 'The site may be down or broken. Call the technical contact now.' },
  'web.rss': { title: 'News feed for M3 Monaco', todo: 'The news feed that feeds the M3 Monaco website fell back. Tell the technical contact.' },
  'web.auth': { title: 'Signing in works', todo: 'Members may not be able to sign in. Call the technical contact now.' },
  'report.unavailable': { title: 'The monitor could read the database', todo: 'The automatic check itself failed. Call the technical contact now.' },
};

/** The three checks only the automatic run makes (from outside: the site, the feed, sign-in). */
export const WEB_CHECK_IDS = ['web.site', 'web.rss', 'web.auth'] as const;

export function helpFor(checkId: string): CheckHelp {
  return CHECK_HELP[checkId] ?? { title: checkId, todo: 'Tell the technical contact, with the name of this check.' };
}

/** The areas, in the order they are shown: what matters most for M3's work first. */
export const AREA_ORDER: { key: string; label: string }[] = [
  { key: 'website', label: 'Website' },
  { key: 'guest list', label: 'WYS guest list' },
  { key: 'payments', label: 'Payments' },
  { key: 'e-mails', label: 'E-mails' },
  { key: 'registration', label: 'Registrations and accounts' },
  { key: 'cron', label: 'Scheduled jobs' },
  { key: 'calls', label: 'Scheduled calls' },
  { key: 'storage', label: 'Stored files' },
  { key: 'drift', label: 'Unexpected changes' },
  { key: 'security', label: 'Security' },
  { key: 'database', label: 'Database' },
  { key: 'other', label: 'Other' },
];

export function areaLabel(area: string): string {
  const hit = AREA_ORDER.find((a) => a.key === area);
  return hit ? hit.label : area.charAt(0).toUpperCase() + area.slice(1);
}

export function areaRank(area: string): number {
  const i = AREA_ORDER.findIndex((a) => a.key === area);
  return i < 0 ? AREA_ORDER.length : i;
}
