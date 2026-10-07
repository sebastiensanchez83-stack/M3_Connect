import i18next from '@/i18n';

/**
 * Copy of the static pages rewritten in the October 2026 refonte: About,
 * Contact and Join the network. English only: the interface has no French for
 * these pages.
 *
 * Every key lives under `staticPages`, a namespace nothing else defines, so the
 * deep merge (no overwrite) cannot be shadowed by the older about.*, contact.*
 * and join.* strings. Those older keys stay where they are for what the pages
 * still reuse (the rights lists in homePage.profiles.*, the sign-up button
 * labels in join.*.cta, the form's validation and toast messages).
 *
 * Registered by the three pages themselves (registerCopyStrings), like the
 * directory's strings, so the main i18n file is not touched.
 *
 * Facts only: nothing here that the site cannot back up today. The M3 team
 * reviews each company before marking it as verified, and says so once or twice
 * per page; the full promise (every person checked, an event registration that
 * also creates your account) waits for the unified registration. The sign-up
 * review delay (24 to 48 business hours) is the one the Join page and the
 * pending-account banners state. Also true: the platform is free, the
 * Rendezvous' 6th edition had more than 250 participants and its 7th edition
 * returns in 2027, the World Yachting Summit is on 27 November 2026 by
 * invitation. Vocabulary: "members" for every registered organisation;
 * "partners" would mean paying event sponsors, so it is not used.
 */
export const COPY_STRINGS = {
  en: {
    staticPages: {
      about: {
        hero: {
          subtitle:
            'One free network for marinas and the companies that serve them. It is run by M3 Monaco, the team behind the Monaco Smart & Sustainable Marina Rendezvous and the World Yachting Summit in Dubai.',
        },
        why: {
          eyebrow: 'Why it exists',
          title: 'Marinas need the right service providers. Service providers need to know what marinas need.',
          body1:
            'Smart Marina Connect puts both sides in one network. Marinas publish their tenders, projects and questions for experts. Service providers read them, answer them and request introductions.',
          body2:
            'The network is free. The same companies and people then meet at M3 events, in Monaco, in Dubai and online.',
        },
        platform: {
          eyebrow: 'The platform',
          title: 'What you find on the platform',
          directory: {
            title: 'Directory',
            desc: 'Marinas, service providers, investors and media, each with a company page. Search by name, theme or country.',
          },
          opportunities: {
            title: 'Opportunities',
            desc: 'Marinas publish tenders, expert questions and projects. Service providers read them, answer them and request introductions.',
          },
          resources: {
            title: 'Resources',
            desc: 'Articles, guides and replays in six themes: infrastructure, design, digital, energy, operations and business. Public articles are open to everyone.',
          },
        },
        profiles: {
          eyebrow: 'Who it is for',
          title: 'What members can do, by profile',
          intro:
            'Each profile opens different features once your company is verified. Every profile below can request introductions and propose a webinar.',
          marinas: {
            title: 'Marinas',
            who: 'Marina operators and managers, recreational ports and nautical facilities.',
          },
          providers: {
            title: 'Service providers',
            who: 'Technology providers, consultants and service companies that work for marinas.',
          },
          investors: {
            title: 'Investors & developers',
            who: 'Funds, family offices, strategic investors and marina developers.',
          },
          media: {
            title: 'Media',
            who: 'Journalists and publications covering marinas, yachting and the maritime sector.',
          },
        },
        check: {
          eyebrow: 'How we check',
          title: 'Companies are reviewed by the M3 team',
          intro: 'Membership is free. Access is not automatic: it opens once your company has been reviewed.',
          company: {
            title: 'Each company',
            desc: "The M3 team reviews each company's details before marking it as verified.",
          },
          person: {
            title: 'Help to get set up',
            desc: 'The M3 team helps you set up your company page and answers your questions.',
          },
          access: {
            title: 'Then access opens',
            desc: 'You get an e-mail when your company is verified, usually within 24 to 48 business hours. The features of your profile then open.',
          },
        },
        events: {
          eyebrow: 'Where we meet',
          title: 'Meet in Monaco, in Dubai and online',
          intro: 'New events and webinars are announced on the platform first, and replays stay in the library.',
          wys: 'Dubai, 27 November 2026. A conference and a gala dinner organised by M3 Monaco, by invitation only.',
          webinars: 'Live sessions with marina operators and service providers, and every replay afterwards.',
          rendezvous:
            'The international meeting on the future of marinas, ports and the yachting industry. The 6th edition brought together more than 250 participants. The 7th edition returns in 2027.',
        },
        team: {
          eyebrow: 'The team',
          title: 'M3 Monaco',
          p1: 'Smart Marina Connect is run by M3 Monaco, also known as Monaco Marina Management, based in the Principality of Monaco.',
          p2: "The team brings together marina management professionals and event organisers. They know the sector's challenges first-hand, and they answer every message.",
        },
      },
      contact: {
        subtitle:
          'Write to the M3 team about the platform, your company page, event sponsorship or press accreditation. We read every message.',
        formEyebrow: 'Your message',
        formTitle: 'Send a message to the M3 team',
        formIntro:
          'Say who you are and what you need. If it is about an event or a company page, name it, so we can answer faster.',
        messagePlaceholder: 'What do you need? Name the event or the company if it is about one.',
        thankYouTitle: 'Thank you',
        thankYouDesc: 'The M3 team will read your message and reply, usually within 24 to 48 hours.',
        helpTitle: 'What we can help with',
        help1: 'Questions about the platform and your company page',
        help2: 'Sponsoring one of our events',
        help3: 'Press accreditation and media requests',
        help4: 'Help signing in or setting up your account',
      },
      join: {
        heroSubtitle:
          'Choose your profile: marina, service provider, investor, developer or media. Signing up is free, and each profile opens different features.',
        marina: {
          title: 'Publish what you need. Service providers answer.',
          intro:
            'For marina operators and managers, recreational ports and nautical facilities. Describe a need in a few lines, and service providers can answer.',
        },
        provider: {
          title: 'Show your company to marinas. Answer what they publish.',
          intro:
            'For technology providers, consultants and service companies that work for marinas. Your company page goes in the directory marinas use.',
        },
        investorDeveloper: {
          title: 'Follow the projects marinas publish. Publish yours.',
          investors: 'For funds, family offices and strategic investors looking at the marina sector.',
          developers: 'For marina developers, real-estate groups and builders working on the next marinas.',
        },
        media: {
          title: 'Follow the sector. Ask about press accreditation for our events.',
          intro: 'For journalists and publications covering marinas, yachting and the maritime sector.',
        },
        steps: {
          title: 'How it works',
          intro: 'Four steps, all free.',
          step1Title: 'Sign up',
          step1Body: 'Pick your profile and create your account. It takes a few minutes.',
          step2Title: 'Describe your company',
          step2Body: "Add your company's details, or join your company if it is already listed.",
          step3Title: 'M3 reviews',
          step3Body:
            'The M3 team reviews your company and marks it as verified. You get an e-mail when it is done, usually within 24 to 48 business hours.',
          step4Title: 'Use the network',
          step4Body: 'The features of your profile open: directory, opportunities, events and resources.',
        },
        why: {
          title: 'Why join Smart Marina Connect',
          b1Title: 'An international network',
          b1Desc: 'Marinas and service providers from different countries.',
          b1DescLive: 'Marinas and service providers in {{countries}} countries.',
          b2Title: 'Meet at M3 events',
          b2Desc: 'Marinas and service providers meet at M3 events, in Monaco, in Dubai and online.',
          b3Title: 'Knowledge you can use',
          b3Desc: 'Articles, guides and replays in six themes, and the needs marinas publish.',
          b4Title: 'A team to write to',
          b4Desc: 'The M3 team helps you set up your company page and answers your questions.',
        },
        faq: {
          title: 'Questions before you sign up',
          subtitle: 'Short answers. For anything else, write to the team.',
          q1: 'Does it cost anything?',
          a1: 'No. Membership is free for every profile. Only some event tickets and event sponsorship are paid.',
          q2: 'Who can join?',
          a2: 'Marinas and ports, service providers, investors, developers and media covering the maritime sector. Each profile opens different features.',
          q3: 'What happens after I sign up?',
          a3: 'You describe your company. The M3 team reviews it, usually within 24 to 48 business hours, and sends you an e-mail. The features of your profile then open.',
          q4: 'What can I read before my account is verified?',
          a4: 'Public articles are open to everyone. Member-only and marina-only content opens once your account is verified.',
          q5: 'My company is already listed. Can I join it?',
          a5: 'Yes. When you describe your company, you can join it if it is already listed.',
          q6: 'Can I sponsor an event?',
          a6: 'Event sponsorship is handled by the M3 team. Use the contact form and choose "Event sponsorship" as the subject.',
          q7: 'How do I reach the team?',
          a7: 'Use the contact form, or write to events@m3monaco.com.',
        },
        ready: {
          title: 'Ready to join?',
          subtitle: 'Sign up for free and describe your company in a few minutes.',
        },
      },
    },
  },
  fr: {},
} as const;

let registered = false;

/**
 * Adds the strings above to the translation bundle (deep merge, no overwrite).
 * Called at module load by the pages that use them; safe to call twice.
 */
export function registerCopyStrings() {
  if (registered) return;
  registered = true;
  for (const lng of ['en', 'fr'] as const) {
    i18next.addResourceBundle(lng, 'translation', COPY_STRINGS[lng], true, false);
  }
}
