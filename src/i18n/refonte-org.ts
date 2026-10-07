// The configured instance (not the bare 'i18next' default): registerOrgRefonteStrings()
// runs at module scope of eagerly imported pages, before init() may have run.
import i18next from '@/i18n';

/**
 * Strings of the refonte's organisation profile, partners, opportunities and
 * submission pages (Oct 2026). English only: the interface is English-only.
 *
 * Registered by the pages themselves through `registerOrgRefonteStrings()` (deep
 * merge, no overwrite: a key that already exists elsewhere wins), the way
 * src/i18n/directory.ts is: the strings travel with the lazy page chunks, not
 * with the entry bundle, and no shared setup file has to change.
 *
 * Vocabulary: "members" for every registered organisation, "service providers",
 * "media"; "partners" only for paying event sponsors (tier names stay in English).
 */
export const ORG_REFONTE_STRINGS = {
  en: {
    orgPage: {
      crumbsLabel: 'Breadcrumb',
      claim: {
        eyebrow: 'Listed by M3',
        titleMarina: 'Is this your marina? Claim this page',
        titleOther: 'Is this your company? Claim this page',
        bodyMarina: 'The M3 team listed {{name}} before it had an account. Claim the page to complete it and keep it up to date: the M3 team checks every request before handing the page over.',
        bodyOther: 'The M3 team listed {{name}} before it had an account. Claim the page to complete it and keep it up to date: the M3 team checks every request before handing it over.',
        cta: 'Claim this page',
        question: 'Ask a question',
        mailSubject: 'Claim the page of {{name}} on Smart Marina Connect',
        mailBody: 'Organisation: {{name}}\nMy name and role:\nPhone:\n',
      },
      similar: {
        eyebrow: 'Keep exploring',
        titleMarina: 'Other marinas',
        titlePartner: 'Other service providers',
        titleInvestor: 'Other investors',
        titleDeveloper: 'Other developers',
        titleMedia: 'Other media',
        titleOther: 'Similar organisations',
        label: 'Similar organisations',
        all: 'See them all in the directory',
      },
      related: {
        eyebrow: 'Reading',
        title: 'Related articles',
        all: 'All resources',
      },
      contact: {
        title: 'Questions about this page?',
        line: 'Something to correct on this page, or a question about the network? Write to the team.',
      },
    },
    partnersRefonte: {
      sponsorsEyebrow: 'Event sponsors',
      closing: {
        eyebrow: 'Sponsorship',
        title: 'Sponsor an M3 event',
        mediaLink: 'Are you a media outlet?',
      },
      contactLine: 'Sponsorship is handled directly by the M3 team.',
      emptyHint: 'Sponsors appear here, grouped by tier, as soon as they have a logo and a profile.',
    },
    oppRefonte: {
      toolbarLabel: 'Filter the opportunities',
      kindsLabel: 'Kind of opportunity',
      lock: {
        eyebrow: 'Members only',
        kindsLabel: 'What opportunities contain',
      },
      empty: {
        eyebrow: 'Nothing here yet',
      },
      listLabel: 'Open opportunities',
    },
    submitShell: {
      eyebrowOpportunities: 'Opportunities',
      eyebrowWebinars: 'Webinars',
    },
  },
} as const;

let registered = false;

/** Adds the strings above to the running i18next instance, once. */
export function registerOrgRefonteStrings(): void {
  if (registered) return;
  registered = true;
  i18next.addResourceBundle('en', 'translation', ORG_REFONTE_STRINGS.en, true, false);
}
