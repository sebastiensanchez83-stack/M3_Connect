/**
 * The 2026 edition of the Monaco Smart & Sustainable Marina Rendezvous took place on
 * 20-21 September 2026. Victor, 8 Oct 2026: "for participants, just mark that they
 * took part in Smart Marina, that's all, they can no longer modify their Smart Marina
 * registration". So the participant pages (/sm26/register, the event hub
 * SM26MyRegistrationPage, /sm26/claim) are read-only while this is true.
 *
 * A client-side switch only: the admin consoles (/admin/sm26/*) keep editing
 * registrations, and the server still accepts participant writes (the RLS policies
 * and RPCs listed in the 8 Oct 2026 report); new registrations are refused server-side
 * by sm_registrations_open().
 */
export const SM26_EDITION_OVER = true;

/** How the pages name the edition's dates. */
export const SM26_DATES = '20–21 September 2026';
