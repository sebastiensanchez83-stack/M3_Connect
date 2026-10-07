/**
 * Strings added by the refonte of the content and static pages (Oct 2026):
 * the resource library and its article page, About, Contact, Join the network,
 * the legal pages and the 404. English only: the interface has no French for
 * these.
 *
 * Merged by src/i18n/index.ts (deep, no overwrite): a key that already exists in
 * pages.ts, home.ts or the main file wins. Most wording is reused from those
 * (resources.*, resourceDetail.*, about.*, contact.*, join.*, homePage.profiles.*);
 * only what the new layouts add lives here.
 *
 * Vocabulary: "members" for every registered organisation, "partners" only for
 * paying event sponsors.
 */
export const CONTENT_STRINGS = {
  en: {
    contentPages: {
      library: {
        toolbarLabel: 'Filter the library',
        themeSelected: '(selected)',
        loading: 'Loading the library…',
        noMatchHint: 'Try another word, or remove a filter.',
        joinEyebrow: 'Free for every member',
        joinTitle: 'Public articles are open to everyone. Join to read the rest.',
        joinBody: 'Member-only articles open once the M3 team has checked your company. Membership is free.',
        askLine: 'Suggest an article or a webinar: write to the M3 team.',
      },
      article: {
        published: 'Published',
        linkCopied: 'Link copied',
        tags: 'Tags',
        backToLibrary: 'Browse the whole library',
      },
      about: {
        missionEyebrow: 'Our mission',
        platformEyebrow: 'The platform',
        networkEyebrow: 'The network',
        teamEyebrow: 'The team',
        figuresLabel: 'The network in figures',
      },
      contact: {
        eyebrow: 'Contact',
        required: 'Fields marked * are required.',
        formEyebrow: 'Write to us',
      },
      join: {
        eyebrow: 'Free for every member',
        jumpLabel: 'Go to a profile',
        investorDeveloperTitle: 'Investors & developers',
        whyEyebrow: 'The network',
        stepsEyebrow: 'Getting started',
        faqEyebrow: 'Questions',
        readyEyebrow: 'Ready?',
        marinaPill: 'Marinas',
        providerPill: 'Service providers',
        investorPill: 'Investors & developers',
        mediaPill: 'Media',
      },
      notFound: {
        eyebrow: 'Error 404',
        browseDirectory: 'Browse the directory',
        searchLabel: 'Search the directory',
      },
      legal: {
        eyebrow: 'Legal',
        onThisPage: 'On this page',
        otherDocs: 'Other legal documents',
        privacy: 'Privacy Policy',
        terms: 'Terms of Use',
        cookies: 'Cookie Policy',
        notice: 'Legal Notice',
        commercial: 'Commercial Terms',
      },
    },
  },
  fr: {},
} as const;
