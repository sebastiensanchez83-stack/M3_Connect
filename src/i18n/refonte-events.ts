/**
 * Strings added by the refonte of the events pages (/events and /events/:id,
 * Oct 2026): toolbar label, section eyebrows, the section nav, the Rendezvous
 * "in figures" and "on the programme" blocks, "our other events" and the
 * contact panels. English only: the interface has no French for these.
 *
 * Merged by src/i18n/index.ts (deep, no overwrite): a key that already exists in
 * pages.ts or home.ts wins. The Rendezvous figures themselves reuse the home page's
 * homePage.events.* strings, so the two pages always say the same thing.
 *
 * Vocabulary: "members" for every registered organisation, "partners" only for
 * paying event sponsors.
 */
export const EVENTS_STRINGS = {
  en: {
    eventsPage: {
      toolbarLabel: 'Filter the events',
      upcomingEyebrow: 'Programme',
      pastEyebrow: 'Archive',
      contact: {
        title: 'A question about an event?',
        line: 'Programme, registration or sponsoring: write to the M3 team.',
      },
      wys: {
        monthShort: 'Nov',
      },
    },
    eventDetail: {
      newTab: '(opens in a new tab)',
      status: {
        upcoming: 'Upcoming',
      },
      nav: {
        label: 'On this page',
        about: 'About',
        figures: 'In figures',
        programme: 'Programme',
        speakers: 'Speakers',
        practical: 'Practical info',
        packages: 'Packages',
        partners: 'Partners',
        documents: 'Documents',
        participants: 'Participants',
        sponsors: 'Sponsors',
      },
      eyebrow: {
        about: 'Presentation',
        programme: 'Agenda',
        speakers: 'On stage',
        practical: 'Getting there',
        packages: 'Registration',
        partners: 'Behind the event',
        documents: 'Download',
        participants: 'Attendees',
      },
      // The About text of the Rendezvous page. It replaces the record's own description, which
      // still carries a patronage line and unverified counts (exhibitors, startups); only
      // published facts here. Drop it, and the override in EventDetailPage, once the record is corrected.
      rendezvousAbout: 'The Monaco Smart & Sustainable Marina Rendezvous is the international meeting on the future of marinas, ports and the yachting industry, organised by M3 Monaco. The 6th edition took place on 20–21 September 2026 and brought together marina operators, industry experts, technology providers and sustainability leaders. The 7th edition returns in 2027.',
      whatsOn: {
        title: 'On the programme',
        conferences: 'Conferences',
        workshops: 'Workshops',
        exhibition: 'Exhibition',
        pitches: 'Innovation pitches',
        architects: 'Architect presentations',
        awards: 'Monaco Smart & Sustainable Marina Awards ceremony',
      },
      figures: {
        eyebrow: 'In figures',
        title: 'The Rendezvous in figures',
      },
      practical: {
        title: 'Practical information',
        access: 'Who can attend',
      },
      other: {
        eyebrow: 'Our other events',
        title: 'Meet us at our other events',
      },
      contact: {
        title: 'A question about this event?',
        line: 'Programme, registration or sponsoring: write to the M3 team.',
      },
    },
  },
  fr: {},
} as const;
