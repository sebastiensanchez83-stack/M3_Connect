/**
 * Page titles and meta descriptions, one entry per public page plus the
 * templates of the detail pages (organization, event, resource).
 *
 * Rules (design-seo study, B.1): a title is 60 characters at most — the
 * " | Smart Marina Connect" suffix is added in code (withSiteSuffix) only when
 * it still fits and the title does not already carry the name; a description
 * is 155 characters at most, and the templates are cut at a word in code
 * (cutAtWord). English first: it is the language Google indexes today.
 * Crawlers and share previews that do not run JavaScript get the same English
 * words: index.html receives seo.home at build time (vite.config.ts), and the
 * Netlify edge function (netlify/edge-functions/seo.ts) writes the title and
 * description of each public page into the HTML. Edit the words here only.
 * Keep this file free of imports: the edge function (Deno) imports it as is.
 *
 * Events: name the Rendezvous by its official name, "Monaco Smart & Sustainable
 * Marina Rendezvous", and never on its own — M3 also runs the World Yachting
 * Summit in Dubai and webinars online.
 *
 * Merged into the main bundle by src/i18n/index.ts (deep merge). No other
 * module defines a `seo` key.
 */
export const SEO_STRINGS = {
  en: {
    seo: {
      siteName: 'Smart Marina Connect',
      home: {
        title: 'Smart Marina Connect — The marina industry network',
        description: 'Free B2B network for marinas and their service providers, with industry events in Monaco, Dubai and online. Companies reviewed by M3.',
        descriptionLive: 'Free B2B network for marinas and their service providers: {{marinas}} marinas listed, {{suppliers}} providers in {{countries}} countries. Companies reviewed by M3.',
      },
      directory: {
        title: 'Marina & service provider directory',
        description: 'Directory of marinas and marina service providers. Filter by theme or country, shortlist companies and request an introduction from their page.',
        descriptionLive: 'Marina suppliers directory: {{marinas}} marinas listed and {{suppliers}} service providers in {{countries}} countries. Filter by theme or country.',
        themeTitle: '{{theme}} — marina service providers',
        themeDescription: '{{theme}}: the marinas and service providers working in this field, in the Smart Marina Connect directory.',
      },
      resources: {
        title: 'Marina industry resources, by theme',
        description: 'Articles on marina infrastructure, design, digital, energy, operations and business, sorted into 6 themes in the Smart Marina Connect library.',
        descriptionLive_one: '{{count}} article on marina infrastructure, design, digital, energy, operations and business, sorted into 6 themes.',
        descriptionLive_other: '{{count}} articles on marina infrastructure, design, digital, energy, operations and business, sorted into 6 themes.',
        themeTitle: '{{theme}} — marina resources',
        themeDescription: '{{theme}}: articles for marinas and their service providers, from the Smart Marina Connect library.',
      },
      events: {
        title: 'Marina industry events in Monaco, Dubai and online',
        description: 'The Monaco Smart & Sustainable Marina Rendezvous, the World Yachting Summit in Dubai and our webinars: industry events organised by M3 Monaco.',
      },
      partners: {
        title: 'Event partners and sponsors',
        description: 'Main Sponsor, Premium Sponsor and the other partners of the industry events M3 Monaco organises in Monaco, Dubai and online.',
      },
      sponsor: {
        title: 'Sponsor an M3 event in Monaco and Dubai',
        description: 'Sponsor the Monaco Smart & Sustainable Marina Rendezvous or the World Yachting Summit in Dubai. See what sponsors get and request the sponsorship deck.',
      },
      join: {
        title: 'Join the marina industry network',
        description: 'Marina, service provider, investor, developer or media: sign up for free. The M3 team reviews your company, then opens the features of your profile.',
      },
      opportunities: {
        title: 'Marina tenders, RFPs and projects',
        description: 'Where marinas publish their needs: tenders, expert questions and projects, open to verified companies. Sign up to read and answer them.',
      },
      about: {
        title: 'About Smart Marina Connect, by M3 Monaco',
        description: 'Smart Marina Connect is the marina industry network run by M3 Monaco, organiser of industry events in Monaco, Dubai and online.',
      },
      contact: {
        title: 'Contact the Smart Marina Connect team',
        description: 'A question about the platform, your company page or sponsoring an event? Write to the M3 Monaco team behind Smart Marina Connect.',
      },
      notFound: {
        title: 'Page not found',
      },
      // Event pages that live outside /events. /sm26 is printed on every SM26
      // badge, /sm26/vote is a QR in the event presentation, /wys26 is the
      // invitation page: their URLs never change, only these words.
      sm26: {
        title: 'Monaco Smart & Sustainable Marina Rendezvous 2026',
        description: 'The on-site page of the Monaco Smart & Sustainable Marina Rendezvous, 20–21 September 2026 at the Yacht Club de Monaco: programme and networking.',
      },
      sm26Vote: {
        title: 'Audience vote — Monaco Smart & Sustainable Marina Rendezvous',
        description: 'The audience vote of the Monaco Smart & Sustainable Marina Rendezvous 2026: one vote per prize, from your phone, no account needed.',
      },
      wys26: {
        title: 'World Yachting Summit 2026 — Request an invitation',
        description: 'The World Yachting Summit, 27 November 2026 in Dubai, organised by M3 Monaco: a conference and a gala dinner, by invitation only. Request yours here.',
      },
      // Alt text of the default share picture (public/images/og-default.jpg).
      shareImageAlt: 'Smart Marina Connect, the marina industry network by M3 Monaco',
      // Detail pages. {{name}}, {{type}}, {{place}}, {{summary}}… are filled in code.
      organization: {
        title: '{{name}} — {{type}} in {{place}}',
        titleNoPlace: '{{name}} — {{type}}',
        description: '{{name}}, {{type}} in {{place}}. {{summary}}',
        descriptionNoPlace: '{{name}}, {{type}}. {{summary}}',
        descriptionNoSummary: '{{name}}, {{type}} in {{place}}, listed in the Smart Marina Connect directory of marinas and their service providers.',
        descriptionNoSummaryNoPlace: '{{name}}, {{type}}, listed in the Smart Marina Connect directory of marinas and their service providers.',
      },
      orgTypes: {
        marina: 'marina',
        partner: 'service provider',
        media_partner: 'media',
        developer: 'marina developer',
        investor: 'investor',
        other: 'organisation',
      },
      orgTypesTitle: {
        marina: 'Marina',
        partner: 'Service provider',
        media_partner: 'Media',
        developer: 'Marina developer',
        investor: 'Investor',
        other: 'Organisation',
      },
      event: {
        description: '{{when}}, {{where}}. {{summary}}',
        descriptionNoPlace: '{{when}}. {{summary}}',
        descriptionNoSummary: '{{when}}, {{where}}. An industry event organised by M3 Monaco, on Smart Marina Connect.',
        descriptionNoSummaryNoPlace: '{{when}}. An industry event organised by M3 Monaco, on Smart Marina Connect.',
        online: 'online',
        dateTbd: 'Date to be announced',
      },
      resource: {
        descriptionNoSummary: '{{title}}: an article from the Smart Marina Connect library for marinas and their service providers.',
      },
    },
  },
  fr: {
    seo: {
      siteName: 'Smart Marina Connect',
      home: {
        title: 'Smart Marina Connect — Le réseau des ports de plaisance',
        description: 'Réseau B2B gratuit des ports de plaisance et de leurs prestataires, avec des événements à Monaco, à Dubaï et en ligne. Membres vérifiés par M3.',
        descriptionLive: 'Réseau B2B gratuit des ports de plaisance et de leurs prestataires : {{marinas}} marinas référencées, {{suppliers}} prestataires, {{countries}} pays. Membres vérifiés par M3.',
      },
      directory: {
        title: 'Annuaire des ports de plaisance et prestataires',
        description: 'Annuaire des ports de plaisance et de leurs prestataires. Filtrez par thème ou par pays, présélectionnez des entreprises et demandez une mise en relation.',
        descriptionLive: '{{marinas}} marinas référencées et {{suppliers}} prestataires dans {{countries}} pays. Filtrez par thème ou par pays, puis demandez une mise en relation.',
        themeTitle: '{{theme}} — prestataires de marinas',
        themeDescription: '{{theme}} : les marinas et les prestataires de ce domaine, dans l’annuaire Smart Marina Connect.',
      },
      resources: {
        title: 'Ressources pour les ports de plaisance, par thème',
        description: 'Articles en anglais sur les infrastructures, le design, le digital, l’énergie, l’exploitation et le business des ports de plaisance, en 6 thèmes.',
        descriptionLive_one: '{{count}} article en anglais sur les infrastructures, le design, le digital, l’énergie, l’exploitation et le business des marinas.',
        descriptionLive_other: '{{count}} articles en anglais sur les infrastructures, le design, le digital, l’énergie, l’exploitation et le business des marinas.',
        themeTitle: '{{theme}} — ressources marinas',
        themeDescription: '{{theme}} : articles pour les marinas et leurs prestataires, tirés de la bibliothèque Smart Marina Connect.',
      },
      events: {
        title: 'Événements des ports de plaisance : Monaco, Dubaï, en ligne',
        description: 'Le Monaco Smart & Sustainable Marina Rendezvous, le World Yachting Summit à Dubaï et nos webinaires : des événements organisés par M3 Monaco.',
      },
      partners: {
        title: 'Partenaires et sponsors des événements',
        description: 'Main Sponsor, Premium Sponsor et les autres partenaires des événements que M3 Monaco organise à Monaco, à Dubaï et en ligne.',
      },
      join: {
        title: 'Rejoindre le réseau des ports de plaisance',
        description: 'Marina, prestataire, investisseur, promoteur ou média : inscription gratuite. L’équipe M3 vérifie chaque entreprise, puis active les accès de votre profil.',
      },
      opportunities: {
        title: 'Appels d’offres et projets des marinas',
        description: 'L’espace où les marinas publient leurs besoins : appels d’offres, questions d’experts et projets, ouverts aux entreprises vérifiées par M3.',
      },
      about: {
        title: 'À propos de Smart Marina Connect, par M3 Monaco',
        description: 'Smart Marina Connect est le réseau des ports de plaisance animé par M3 Monaco, organisateur d’événements à Monaco, à Dubaï et en ligne.',
      },
      contact: {
        title: 'Contacter l’équipe Smart Marina Connect',
        description: 'Une question sur la plateforme, la fiche de votre entreprise ou le sponsoring d’un événement ? Écrivez à l’équipe M3 Monaco.',
      },
      notFound: {
        title: 'Page introuvable',
      },
      sm26: {
        title: 'Monaco Smart & Sustainable Marina Rendezvous 2026',
        description: 'La page sur place du Monaco Smart & Sustainable Marina Rendezvous, les 20 et 21 septembre 2026 au Yacht Club de Monaco : programme et networking.',
      },
      sm26Vote: {
        title: 'Vote du public, Monaco Smart & Sustainable Marina Rendezvous',
        description: 'Le vote du public du Monaco Smart & Sustainable Marina Rendezvous 2026 : un vote par prix, depuis votre téléphone, sans compte.',
      },
      wys26: {
        title: 'World Yachting Summit 2026 — Demander une invitation',
        description: 'Le World Yachting Summit, le 27 novembre 2026 à Dubaï, organisé par M3 Monaco : une conférence et un dîner de gala, sur invitation. Demandez la vôtre ici.',
      },
      shareImageAlt: 'Smart Marina Connect, le réseau des ports de plaisance par M3 Monaco',
      organization: {
        title: '{{name}} — {{type}}, {{place}}',
        titleNoPlace: '{{name}} — {{type}}',
        description: '{{name}}, {{type}}, {{place}}. {{summary}}',
        descriptionNoPlace: '{{name}}, {{type}}. {{summary}}',
        descriptionNoSummary: '{{name}}, {{type}}, {{place}}, dans l’annuaire Smart Marina Connect des ports de plaisance et de leurs prestataires.',
        descriptionNoSummaryNoPlace: '{{name}}, {{type}}, dans l’annuaire Smart Marina Connect des ports de plaisance et de leurs prestataires.',
      },
      orgTypes: {
        marina: 'marina',
        partner: 'prestataire',
        media_partner: 'média',
        developer: 'promoteur de marina',
        investor: 'investisseur',
        other: 'organisation',
      },
      orgTypesTitle: {
        marina: 'Marina',
        partner: 'Prestataire',
        media_partner: 'Média',
        developer: 'Promoteur de marina',
        investor: 'Investisseur',
        other: 'Organisation',
      },
      event: {
        description: '{{when}}, {{where}}. {{summary}}',
        descriptionNoPlace: '{{when}}. {{summary}}',
        descriptionNoSummary: '{{when}}, {{where}}. Un événement de la filière organisé par M3 Monaco, sur Smart Marina Connect.',
        descriptionNoSummaryNoPlace: '{{when}}. Un événement de la filière organisé par M3 Monaco, sur Smart Marina Connect.',
        online: 'en ligne',
        dateTbd: 'Date à annoncer',
      },
      resource: {
        descriptionNoSummary: '{{title}} : un article de la bibliothèque Smart Marina Connect pour les marinas et leurs prestataires.',
      },
    },
  },
} as const;
