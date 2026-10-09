/**
 * The 2026 edition of the Monaco Smart & Sustainable Marina Rendezvous took place on
 * 20-21 September 2026. Victor, 8 Oct 2026: "for participants, just mark that they
 * took part in Smart Marina, that's all, they can no longer modify their Smart Marina
 * registration". So the participant pages (/sm26/register, the event hub
 * SM26MyRegistrationPage, /sm26/claim) are read-only while this is true.
 *
 * This switch only shapes the pages. The server enforces the same thing on its own:
 * once sm_event.settings.edit_locks_at / roster_locks_at have passed,
 * sm_participant_edits_locked() makes the participant write policies and RPCs refuse
 * non-staff callers with "Smart Marina 2026 is over: registrations can no longer be
 * changed." (migration 20261009160000), and new registrations are refused by
 * sm_registrations_open(). The admin consoles (/admin/sm26/*) keep editing.
 */
export const SM26_EDITION_OVER = true;

/** How the pages name the edition's dates. */
export const SM26_DATES = '20–21 September 2026';
