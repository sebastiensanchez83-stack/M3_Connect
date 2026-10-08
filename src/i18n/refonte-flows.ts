// The configured instance (not the bare 'i18next' default): these strings are
// registered while a page chunk or the entry bundle loads, and a bare instance
// has no addResourceBundle until init() has run.
import i18n from '@/i18n';

/**
 * Strings of the refonte's message flows (Oct 2026): the contact form, the
 * "Claim this page" request, the sponsorship page (/sponsor) and its deck
 * request, the newsletter error, and the sign-in shown in place on a protected
 * link. English only: the interface is English-only.
 *
 * Registered by the components themselves through `registerFlowsStrings()`
 * (deep merge, no overwrite: a key that already exists elsewhere wins), the
 * way src/i18n/refonte-auth.ts is: no shared setup file has to change.
 *
 * Vocabulary: "members" for registered organisations, "service providers",
 * "partners" only for paying event sponsors. The only public e-mail address is
 * events@m3monaco.com (M3_PUBLIC_EMAIL). No price, no invented figure: the
 * only number is the one Victor confirmed ("more than 250 participants").
 */
export const FLOWS_STRINGS = {
  en: {
    flows: {
      contact: {
        company: 'Company',
        optional: 'optional',
        companyPlaceholder: 'Your organisation',
        honeypot: 'Leave this field empty',
        failure: {
          rate_limited: 'You have sent several messages in a short time. Please wait a few minutes, then try again.',
          invalid: 'Some of your details were not accepted. Check your name, e-mail address and message, then try again.',
          captcha: 'The security check did not go through. Wait a moment, then send your message again.',
          server: 'Your message could not be sent. Please try again in a moment.',
          mailLead: 'You can also write to',
        },
      },
      claim: {
        titleOrg: 'Claim the page of {{name}}',
        titleGeneric: 'Claim your marina’s page',
        intro: 'Tell us who you are. The M3 team checks every request before handing the page over, and answers by e-mail.',
        name: 'Your name',
        email: 'Work e-mail',
        role: 'Role or job title',
        orgName: 'Marina name',
        orgNamePlaceholder: 'The marina you want to claim',
        message: 'Message',
        messagePlaceholder: 'Anything that helps us check the request',
        submit: 'Send my request',
        sending: 'Sending…',
        cancel: 'Cancel',
        errorRequired: 'Please fill in your name, e-mail address and role.',
        errorEmail: 'Please enter a valid e-mail address.',
        errorOrg: 'Please tell us which marina you want to claim.',
        successTitle: 'Request sent',
        successBody: 'The M3 team will check it and answer by e-mail.',
        close: 'Close',
      },
      newsletter: {
        errorSend: 'Subscription failed — please try again later',
      },
      signIn: {
        lead: 'Sign in to open this page. You will land straight on it.',
        noAccount: 'No account yet?',
      },
      sponsor: {
        crumb: 'Sponsor an event',
        hero: {
          eyebrow: 'Sponsorship',
          title: 'Sponsor an M3 event',
          subtitle: 'Put your company in front of marinas, operators and service providers at the industry events M3 Monaco organises in Monaco, Dubai and online.',
          ctaDeck: 'Request the sponsorship deck',
          ctaSponsors: 'See current sponsors',
        },
        why: {
          eyebrow: 'Why sponsor',
          title: 'Who sponsors M3 events, and why',
          intro: 'Sponsors are companies and organisations that want the marina industry to know them: service providers, marinas, destinations and port authorities.',
          reasons: {
            people: {
              title: 'Be seen by the people who run marinas',
              body: 'Marinas, operators, service providers, investors and authorities meet at M3’s events.',
            },
            year: {
              title: 'Stay visible all year',
              body: 'Your logo and your profile stay on the platform between events: on the Partners page, in the directory and on the home page.',
            },
            team: {
              title: 'Work directly with the organising team',
              body: 'M3 Monaco organises the events and runs the platform. Sponsorship is handled directly by the M3 team.',
            },
          },
        },
        events: {
          eyebrow: 'The events',
          title: 'The events you would sponsor',
          rendezvous: {
            kicker: 'Monaco · Yacht Club de Monaco',
            title: 'Monaco Smart & Sustainable Marina Rendezvous',
            body: 'The international meeting on the future of marinas, ports and the yachting industry. The 6th edition (20–21 September 2026) brought together more than 250 participants. The 7th edition returns in 2027.',
            link: 'See the 6th edition',
          },
          wys: {
            kicker: 'Dubai · 27 November 2026',
            title: 'World Yachting Summit',
            body: 'A conference and a gala dinner in Dubai, by invitation only, organised by M3 Monaco.',
            link: 'About the Summit',
          },
          online: 'M3 also hosts webinars online for the network.',
        },
        tiers: {
          eyebrow: 'What sponsors get',
          title: 'Visibility, by tier',
          intro: 'A sponsorship buys visibility, not a certification. Sponsors are shown by tier, highest first, and the tier sets where a company stands in the list and how large its card is on the Partners page.',
          listLabel: 'Sponsorship tiers, highest first',
          main_sponsor: 'Shown first on every list, on the largest card of the Partners page.',
          premium_sponsor: 'Shown right after the Main Sponsor, on a large card.',
          premium_partner: 'Shown after the Premium Sponsor, on a large card.',
          associate_partner: 'Shown after the Premium Partner, on a standard card.',
          innovation_partner: 'Shown after the Associate Partner, on a standard card.',
          note: 'The deck sets out what each package includes at the events themselves.',
        },
        where: {
          title: 'Where your company appears',
          intro: 'A sponsor appears on these pages as soon as it has a logo and a profile.',
          event: { title: 'The event pages', body: 'The Rendezvous page shows its sponsors by tier.' },
          partners: { title: 'The Partners page', body: 'Every sponsor, grouped by tier, with a link to its profile.' },
          directory: { title: 'The directory', body: 'A strip of event partners above the listings.' },
          home: { title: 'The home page', body: 'A band of sponsor logos, grouped by tier.' },
          badge: { title: 'Your company page', body: 'A sponsor badge with the name of your tier.' },
          partnersLink: 'Open the Partners page',
        },
        current: {
          eyebrow: 'Current sponsors',
          title: 'They sponsor our events',
          intro: 'The companies that sponsor M3 events, by tier.',
          label: 'Event sponsors, by tier',
          all: 'See all on the Partners page',
        },
        deck: {
          eyebrow: 'Sponsorship deck',
          title: 'Request the sponsorship deck',
          intro: 'Tell us who you are and which events interest you. The M3 team replies with the deck by e-mail.',
          name: 'Full name',
          email: 'Work e-mail',
          company: 'Company',
          events: 'Events of interest',
          eventRendezvous: 'Monaco Smart & Sustainable Marina Rendezvous',
          eventWys: 'World Yachting Summit in Dubai',
          eventNotSure: 'Not sure yet',
          message: 'Message',
          messagePlaceholder: 'Anything the team should know',
          submit: 'Request the deck',
          sending: 'Sending…',
          required: 'Fields marked * are required.',
          errorName: 'Please enter your name',
          errorEmail: 'Please enter a valid e-mail address',
          errorCompany: 'Please enter your company',
          successTitle: 'Thank you',
          successBody: 'The M3 team will send you the sponsorship deck by e-mail.',
          again: 'Send another request',
          messageIntro: 'Sponsorship deck request.',
          messageEvents: 'Events of interest: {{events}}.',
        },
        contactLine: 'Sponsorship is handled directly by the M3 team.',
      },
    },
  },
  fr: {},
} as const;

let registered = false;

/** Adds the strings above to the running i18next instance, once. */
export function registerFlowsStrings(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle('en', 'translation', FLOWS_STRINGS.en, true, false);
}
