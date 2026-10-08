/**
 * Strings of the refonte's shared brand devices and layout (Oct 2026): header,
 * footer, search, cards, featured events,
 * newsletter, motion controls. English first, French second.
 *
 * Merged into the main bundle by src/i18n/index.ts with addResourceBundle
 * (deep, no overwrite): a key that already exists there wins.
 *
 * Vocabulary: "members" for every registered organisation, "service
 * providers", "media"; "partners" only for paying event sponsors. Event names:
 * "Monaco Smart & Sustainable Marina Rendezvous" first, then "the Rendezvous".
 */
export const BRAND_STRINGS = {
  en: {
    brand: {
      motion: {
        pause: 'Pause the animations',
        play: 'Play the animations',
      },
      header: {
        openMenu: 'Open menu',
        closeMenu: 'Close menu',
        mobileNav: 'Menu',
      },
      breadcrumb: 'Breadcrumb',
      search: {
        label: 'Search the directory',
        placeholder: 'Search marinas and service providers',
        submit: 'Search',
        clear: 'Clear the search',
        ex1: 'EV chargers in the Mediterranean',
        ex2: 'Marina architect',
        ex3: 'Floating pontoons',
        ex4: 'Berth occupancy sensors',
      },
      board: {
        online: 'Online',
        statusInvitation: 'By invitation',
      },
      drawer: { close: 'Close' },
      events: {
        rendezvous: {
          title: 'Monaco Smart & Sustainable Marina Rendezvous',
          kicker: 'Monaco · 7th edition in 2027',
          meta: '6th edition: more than 250 participants',
          next: '7th edition in 2027',
          cta: 'Relive the 6th edition',
        },
        wys: {
          title: 'World Yachting Summit',
          kicker: 'Dubai · 27 November 2026',
          place: 'Dubai',
          meta: 'Conference and gala dinner, by invitation',
          body: 'Organised by M3 Monaco.',
          cta: 'Request an invitation',
        },
        webinars: {
          title: 'Webinars & replays',
          kicker: 'Online',
          meta: 'One-click registration once signed in',
          body: 'Live sessions with marina operators and service providers, and every replay afterwards.',
          cta: 'See the webinars',
        },
      },
      route: {
        monaco: 'Monaco',
        dubai: 'Dubai',
        online: 'Online',
      },
      card: {
        verified: 'Verified member',
        verifiedTitle: 'Reviewed by the M3 team',
      },
      contact: {
        label: 'Your contact at M3',
        role: 'M3 Monaco',
        office: 'M3 Monaco',
        write: 'Write to the team',
        line: 'Questions about the platform or our events? Write to me.',
      },
      footer: {
        verified: 'Free for every member.',
        free: 'Companies are reviewed by M3 before they are marked as verified.',
        newsletterTitle: 'The Smart Marina Connect newsletter',
        newsletterBody: 'New articles, dates of our events and news from the platform.',
        linkedin: 'M3 Monaco on LinkedIn (opens in a new tab)',
        instagram: 'M3 Monaco on Instagram (opens in a new tab)',
      },
      notch: {
        label: 'Featured M3 events',
        show: 'Show: {{title}}',
        wysKicker: 'Next event',
        wysMeta: 'Dubai · 27 Nov 2026 · By invitation',
        webinarsTitle: 'Webinars',
        webinarsMeta: 'One-click registration',
        rendezvousKicker: 'Monaco · 6th edition',
      },
      newsletter: {
        label: 'Newsletter: M3 events and new resources',
        placeholder: 'Your work e-mail',
        submit: 'Subscribe',
        consent: 'I agree to receive the Smart Marina Connect newsletter from M3 Monaco. I can unsubscribe at any time.',
        privacy: 'Privacy policy',
        errorEmail: 'Enter a valid e-mail address.',
        errorConsent: 'Tick the box to agree to receive the newsletter.',
        errorSend: 'That did not work. Please try again in a moment.',
        done: 'Thank you. New subscribers receive an e-mail to confirm.',
        doneMail: 'Your e-mail app has opened with the request: send it and we add you.',
        mailSubject: 'Newsletter subscription',
        mailBody: 'Please add {{email}} to the Smart Marina Connect newsletter. I agree to receive it and can unsubscribe at any time.',
      },
    },
  },
  fr: {
    brand: {
      motion: {
        pause: 'Mettre les animations en pause',
        play: 'Relancer les animations',
      },
      header: {
        openMenu: 'Ouvrir le menu',
        closeMenu: 'Fermer le menu',
        mobileNav: 'Menu',
      },
      breadcrumb: "Fil d'Ariane",
      search: {
        label: "Rechercher dans l'annuaire",
        placeholder: 'Rechercher des marinas et des prestataires',
        submit: 'Rechercher',
        clear: 'Effacer la recherche',
        ex1: 'Bornes de recharge en Méditerranée',
        ex2: 'Architecte de marina',
        ex3: 'Pontons flottants',
        ex4: "Capteurs d'occupation des postes",
      },
      board: {
        online: 'En ligne',
        statusInvitation: 'Sur invitation',
      },
      drawer: { close: 'Fermer' },
      events: {
        rendezvous: {
          title: 'Monaco Smart & Sustainable Marina Rendezvous',
          kicker: 'Monaco · 7e édition en 2027',
          meta: '6e édition : plus de 250 participants',
          next: '7e édition en 2027',
          cta: 'Revivre la 6e édition',
        },
        wys: {
          title: 'World Yachting Summit',
          kicker: 'Dubaï · 27 novembre 2026',
          place: 'Dubaï',
          meta: 'Conférence et dîner de gala, sur invitation',
          body: 'Organisé par M3 Monaco.',
          cta: 'Demander une invitation',
        },
        webinars: {
          title: 'Webinaires et replays',
          kicker: 'En ligne',
          meta: 'Inscription en un clic une fois connecté',
          body: 'Des sessions en direct avec des exploitants de marinas et des prestataires, puis chaque replay.',
          cta: 'Voir les webinaires',
        },
      },
      route: {
        monaco: 'Monaco',
        dubai: 'Dubaï',
        online: 'En ligne',
      },
      card: {
        verified: 'Membre vérifié',
        verifiedTitle: "Vérifié par l'équipe M3",
      },
      contact: {
        label: 'Votre contact chez M3',
        role: 'M3 Monaco',
        office: 'M3 Monaco',
        write: "Écrire à l'équipe",
        line: 'Une question sur la plateforme ou nos événements ? Écrivez-moi.',
      },
      footer: {
        verified: "Chaque membre vérifié par l'équipe M3.",
        free: 'La plateforme est gratuite pour tous les membres.',
        newsletterTitle: 'La lettre Smart Marina Connect',
        newsletterBody: "Nouveaux articles, dates de nos événements et nouveautés de la plateforme.",
        linkedin: 'M3 Monaco sur LinkedIn (s’ouvre dans un nouvel onglet)',
        instagram: 'M3 Monaco sur Instagram (s’ouvre dans un nouvel onglet)',
      },
      notch: {
        label: 'Événements M3 à l’affiche',
        show: 'Afficher : {{title}}',
        wysKicker: 'Prochain événement',
        wysMeta: 'Dubaï · 27 nov. 2026 · Sur invitation',
        webinarsTitle: 'Webinaires',
        webinarsMeta: 'Inscription en un clic',
        rendezvousKicker: 'Monaco · 6e édition',
      },
      newsletter: {
        label: 'Newsletter : événements M3 et nouvelles ressources',
        placeholder: 'Votre e-mail professionnel',
        submit: "S'abonner",
        consent: "J'accepte de recevoir la newsletter Smart Marina Connect de M3 Monaco. Je peux me désabonner à tout moment.",
        privacy: 'Politique de confidentialité',
        errorEmail: 'Saisissez une adresse e-mail valide.',
        errorConsent: 'Cochez la case pour accepter de recevoir la newsletter.',
        errorSend: "Cela n'a pas fonctionné. Réessayez dans un instant.",
        done: 'Merci. Vérifiez votre boîte de réception pour confirmer.',
        doneMail: "Votre messagerie s'est ouverte avec la demande : envoyez-la et nous vous ajoutons.",
        mailSubject: 'Inscription à la newsletter',
        mailBody: "Merci d'ajouter {{email}} à la newsletter Smart Marina Connect. J'accepte de la recevoir et je peux me désabonner à tout moment.",
      },
    },
  },
} as const;
