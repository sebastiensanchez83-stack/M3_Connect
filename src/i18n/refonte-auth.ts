// The configured instance (not the bare 'i18next' default): these strings are
// registered while the entry bundle loads, and a bare instance has no
// addResourceBundle until init() has run.
import i18n from '@/i18n';

/**
 * Strings of the refonte's sign-in, sign-up, invitation, welcome, password and
 * onboarding screens (Oct 2026). English only: the interface is English-only.
 * The screens' own texts (labels, errors, toasts) stay in the `auth`,
 * `joinInvite`, `welcome`, `resetPassword` and `onboarding` objects of
 * src/i18n/index.ts; this file only adds what the new layout needs.
 *
 * Registered by the components themselves through `registerAuthRefonteStrings()`
 * (deep merge, no overwrite: a key that already exists elsewhere wins), the way
 * src/i18n/refonte-org.ts is: no shared setup file has to change.
 *
 * Vocabulary: "members" for every registered organisation, "service providers",
 * "media"; "partners" only for paying event sponsors.
 */
export const AUTH_REFONTE_STRINGS = {
  en: {
    authRefonte: {
      shell: {
        brand: 'Smart Marina Connect',
        lead: "Marinas publish their needs, service providers answer them, and everyone meets at M3's events.",
        pointsLabel: 'What the network offers',
        points: {
          network: 'Marinas, service providers and media in one network',
          free: 'Free for every member',
          events: "Meet at M3's events in Monaco, Dubai and online",
        },
      },
      field: {
        showPassword: 'Show password',
        hidePassword: 'Hide password',
      },
      steps: {
        label: 'Your progress',
        profile: 'Your profile',
        organization: 'Your organisation',
        review: 'Review by M3',
        current: 'current step',
        done: 'done',
      },
      join: {
        eyebrow: 'Invitation',
      },
      gate: {
        title: 'Access restricted',
        eyebrow: 'Members area',
      },
      loading: 'Loading',
    },
  },
  fr: {},
} as const;

let registered = false;

/** Adds the strings above to the running i18next instance, once. */
export function registerAuthRefonteStrings(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle('en', 'translation', AUTH_REFONTE_STRINGS.en, true, false);
}
