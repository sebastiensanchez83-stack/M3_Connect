import i18next from '@/i18n';

/**
 * Strings of the refonte's member area (dashboard, account, inbox, profile,
 * deal flow), Oct 2026. English only: the interface is English-only.
 *
 * Registered by MemberUI (imported by every member page) through
 * `registerMemberRefonteStrings()`: a deep merge that never overwrites, so a key
 * that already exists elsewhere wins, and the strings travel with the lazy page
 * chunks, not with the entry bundle.
 *
 * Vocabulary: "members" for every registered organisation, "service providers",
 * "media"; "partners" only for paying event sponsors.
 */
export const MEMBER_REFONTE_STRINGS = {
  en: {
    memberUi: {
      memberArea: 'Member area',
    },
    // Added to the existing dashboard strings (deep merge, no overwrite).
    dashboard: {
      myRequestsEmptyTitle: 'Nothing published yet',
    },
  },
} as const;

let registered = false;

/** Adds the strings above to the running i18next instance, once. */
export function registerMemberRefonteStrings(): void {
  if (registered) return;
  registered = true;
  i18next.addResourceBundle('en', 'translation', MEMBER_REFONTE_STRINGS.en, true, false);
}
