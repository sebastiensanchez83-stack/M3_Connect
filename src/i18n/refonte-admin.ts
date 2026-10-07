import i18next from '@/i18n';

/**
 * Strings of the refonte's Administration area (/admin/*, except the frozen
 * SM26 consoles), Oct 2026. English only: the interface is English-only.
 *
 * Registered by AdminUI (imported by every restyled admin screen) through
 * `registerAdminRefonteStrings()`: a deep merge that never overwrites, so a key
 * that already exists elsewhere wins, and the strings travel with the lazy admin
 * chunks, not with the entry bundle.
 *
 * Vocabulary: "members" for every registered organisation, "service providers",
 * "media"; "partners" only for paying event sponsors.
 */
export const ADMIN_REFONTE_STRINGS = {
  en: {
    adminUi: {
      openMenu: 'Open the admin menu',
      closeMenu: 'Close the admin menu',
      menu: 'Admin menu',
      adminArea: 'Administration',
      moderatorArea: 'Moderation',
      back: 'Back',
      loading: 'Loading…',
      refresh: 'Refresh',
      noResults: 'No results match these filters.',
      clearFilters: 'Clear filters',
      pages: {
        users: 'Review sign-ups, set access and account types, and open a member to see everything about them.',
        organizations: 'Every registered organisation: access status, type, plan and the people who belong to it.',
        events: 'The Rendezvous, the World Yachting Summit and webinars. Open one to edit its programme, pricing and registrations.',
        resources: 'Articles, guides and replays in the library, and the drafts waiting for review.',
        dashboard: 'What needs a decision today, and how the network is growing.',
        moderatorDashboard: 'What is waiting for your review.',
      },
    },
  },
} as const;

let registered = false;

/** Adds the strings above to the running i18next instance, once. */
export function registerAdminRefonteStrings(): void {
  if (registered) return;
  registered = true;
  i18next.addResourceBundle('en', 'translation', ADMIN_REFONTE_STRINGS.en, true, false);
}
