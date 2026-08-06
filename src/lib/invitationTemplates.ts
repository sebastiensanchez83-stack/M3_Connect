// Copy for the official invitation letters, in French and English.
//
// Two letter types, taken from M3's own reference documents:
//   authorities — ministries, public authorities, tourism offices. Speaks to a
//                 country and its delegation, and offers a speaking slot.
//   general     — companies, CEOs and everyone else. Shorter, no delegation.
//
// The wording is deliberately GENERIC: no sentence names a particular guest.
// Anything specific to one recipient (a previous visit, a bilateral
// partnership) is added by the admin as an extra paragraph.
//
// These are DEFAULTS. The admin screen drops them into editable boxes, so any
// letter can be adjusted without touching this file.
//
// **double asterisks** mark a bold run — invitationPdf renders them.

export type Lang = 'fr' | 'en';
export type Register = 'excellency' | 'minister' | 'standard';
export type LetterType = 'authorities' | 'general';

export interface EventFacts {
  name: string;
  venue: string | null;
  startDate: string | null;   // YYYY-MM-DD
  endDate: string | null;
  editionLabel: string | null; // as stored on the event, e.g. "6th"
}

export const LETTER_TYPES: { key: LetterType; fr: string; en: string; hint_fr: string; hint_en: string }[] = [
  {
    key: 'authorities', fr: 'Autorités publiques / Ministère', en: 'Public authorities / Ministry',
    hint_fr: "Parle du pays et de sa délégation, et propose une prise de parole.",
    hint_en: 'Addresses the country and its delegation, and offers a speaking slot.',
  },
  {
    key: 'general', fr: 'Général (entreprises, dirigeants…)', en: 'General (companies, CEOs…)',
    hint_fr: 'Version courte, sans délégation ni prise de parole.',
    hint_en: 'Shorter version, no delegation and no speaking slot.',
  },
];

export const REGISTERS: { key: Register; fr: string; en: string }[] = [
  { key: 'excellency', fr: 'Excellence (ambassadeur, chef de délégation)', en: 'Excellency (ambassador, head of delegation)' },
  { key: 'minister', fr: 'Ministre', en: 'Minister' },
  { key: 'standard', fr: 'Standard (office du tourisme, entreprise)', en: 'Standard (tourism office, company)' },
];

/** "6th" -> "6e" (fr) / "6th" (en). Falls back to the stored label. */
export function editionOrdinal(lang: Lang, label: string | null): string {
  const n = parseInt(String(label || '').replace(/[^0-9]/g, ''), 10);
  if (!n) return label || '';
  if (lang === 'fr') return n === 1 ? '1re' : `${n}e`;
  const rest = n % 100;
  const suffix = rest >= 11 && rest <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
  return `${n}${suffix}`;
}

/** "dimanche 20 et lundi 21 septembre 2026" / "Sunday 20 and Monday 21 September 2026". */
export function eventDatesLong(lang: Lang, startDate: string | null, endDate: string | null): string {
  if (!startDate) return '';
  const locale = lang === 'fr' ? 'fr-FR' : 'en-GB';
  const at = (d: string) => new Date(`${d}T12:00:00Z`);
  const s = at(startDate);
  const e = endDate ? at(endDate) : s;
  const part = (d: Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...o }).format(d);
  const weekday = (d: Date) => part(d, { weekday: 'long' });
  const day = (d: Date) => part(d, { day: 'numeric' });
  const monthYear = (d: Date) => part(d, { month: 'long', year: 'numeric' });
  const and = lang === 'fr' ? 'et' : 'and';
  if (s.getTime() === e.getTime()) return `${weekday(s)} ${day(s)} ${monthYear(s)}`;
  const sameMonth = s.getUTCMonth() === e.getUTCMonth() && s.getUTCFullYear() === e.getUTCFullYear();
  if (sameMonth) return `${weekday(s)} ${day(s)} ${and} ${weekday(e)} ${day(e)} ${monthYear(e)}`;
  return `${weekday(s)} ${day(s)} ${monthYear(s)} ${and} ${weekday(e)} ${day(e)} ${monthYear(e)}`;
}

/** Compact form for the authorities letter: "20-21 September 2026". */
export function eventDatesShort(lang: Lang, startDate: string | null, endDate: string | null): string {
  if (!startDate) return '';
  const locale = lang === 'fr' ? 'fr-FR' : 'en-GB';
  const at = (d: string) => new Date(`${d}T12:00:00Z`);
  const s = at(startDate);
  const e = endDate ? at(endDate) : s;
  const f = (d: Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...o }).format(d);
  if (s.getTime() === e.getTime()) return `${f(s, { day: 'numeric' })} ${f(s, { month: 'long', year: 'numeric' })}`;
  return `${f(s, { day: 'numeric' })}-${f(e, { day: 'numeric' })} ${f(e, { month: 'long', year: 'numeric' })}`;
}

/** Long date for the "Monaco, ..." line. */
export function letterDateLong(lang: Lang, iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'en-GB',
    { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}

interface RegisterCopy { salutation: string; honour: string; closeWord: string }
const REGISTER_COPY: Record<Register, Record<Lang, RegisterCopy>> = {
  excellency: {
    fr: { salutation: 'Excellence,', honour: "nous avons l'honneur", closeWord: 'Excellence' },
    en: { salutation: 'Your Excellency,', honour: 'we have the honour', closeWord: 'Your Excellency' },
  },
  minister: {
    fr: { salutation: 'Monsieur le Ministre,', honour: "nous avons l'honneur", closeWord: 'Monsieur le Ministre' },
    en: { salutation: 'Dear Minister,', honour: 'we have the honour', closeWord: 'Minister' },
  },
  standard: {
    fr: { salutation: 'Madame, Monsieur,', honour: 'nous avons le plaisir', closeWord: 'Madame, Monsieur' },
    en: { salutation: 'Dear Sir or Madam,', honour: 'it is our pleasure', closeWord: 'Sir or Madam' },
  },
};

export const salutationFor = (lang: Lang, r: Register) => REGISTER_COPY[r][lang].salutation;

/**
 * The form of address inside a salutation, reusable in the complimentary close.
 * "Excellence," -> "Excellence"; "Dear Minister," -> "Minister". The two must
 * agree: a letter that opens "Monsieur le Ministre," cannot close on
 * "Excellence".
 */
export function salutationWord(lang: Lang, salutation: string): string {
  let s = salutation.trim().replace(/[,:;.\s]+$/, '');
  if (lang === 'en') s = s.replace(/^dear\s+/i, '');
  return s;
}

export function subjectFor(lang: Lang, type: LetterType, ev: EventFacts): string {
  const ord = editionOrdinal(lang, ev.editionLabel);
  if (type === 'authorities') {
    return lang === 'fr'
      ? `Invitation officielle : ${ord} édition du Monaco Smart & Sustainable Marina Rendezvous`
      : `Official Invitation: ${ord} Edition of the Monaco Smart & Sustainable Marina Rendezvous`;
  }
  return lang === 'fr'
    ? `Invitation à la ${ord} édition du Monaco Smart & Sustainable Marina Rendezvous`
    : `Invitation to the ${ord} Edition of the Monaco Smart & Sustainable Marina Rendezvous`;
}

/** `word` overrides the register's default, so an edited salutation carries through. */
export function complimentaryCloseFor(lang: Lang, type: LetterType, r: Register, word?: string): string {
  const w = word?.trim() || REGISTER_COPY[r][lang].closeWord;
  // The authorities letter closes on "highest consideration"; the general one
  // adds "and respect" — both taken from M3's reference documents.
  const tail = type === 'authorities'
    ? (lang === 'fr' ? "l'expression de notre très haute considération." : 'the assurances of our highest consideration.')
    : (lang === 'fr' ? "l'expression de notre très haute considération et de notre profond respect." : 'the assurances of our highest consideration and respect.');
  return lang === 'fr' ? `Nous vous prions d'agréer, ${w}, ${tail}` : `Please accept, ${w}, ${tail}`;
}

/** The line above the signature. Empty in French, where the close already does it. */
export function signOffFor(lang: Lang, type: LetterType): string {
  return lang === 'en' && type === 'general' ? 'Yours sincerely,' : '';
}

export interface BodyOptions {
  rsvpDeadline?: string | null;  // YYYY-MM-DD
  rsvpEmail?: string;
  /** Used by the authorities letter: "a delegation from …". */
  country?: string;
}

/** The standard body for a letter type, in order. */
export function bodyParagraphs(lang: Lang, type: LetterType, r: Register, ev: EventFacts, opt: BodyOptions = {}): string[] {
  const ord = editionOrdinal(lang, ev.editionLabel);
  const venue = ev.venue || 'Yacht Club de Monaco';
  const honour = REGISTER_COPY[r][lang].honour;
  const email = opt.rsvpEmail || 'info@m3monaco.com';
  const deadline = opt.rsvpDeadline ? letterDateLong(lang, opt.rsvpDeadline) : '';
  // Left as a visible placeholder when unset, so nobody sends a letter with a
  // blank where the country should be.
  const country = opt.country?.trim() || (lang === 'fr' ? '« le pays »' : '« country »');

  if (type === 'authorities') {
    const dates = eventDatesShort(lang, ev.startDate, ev.endDate);
    if (lang === 'fr') {
      return [
        `Au nom de **M3 Monaco**, ${honour} de vous inviter à participer au **Monaco Smart & Sustainable Marina Rendezvous**, qui se tiendra les **${dates}** au ${venue}.`,

        `Inscrit dans le cadre de l'initiative « **Monaco, Capital of Advanced Yachting** », le Rendezvous est une plateforme internationale de premier plan réunissant près de **250 décideurs internationaux** (autorités, représentants de destinations, opérateurs de marinas, investisseurs, promoteurs, architectes, fournisseurs de technologies et acteurs majeurs du secteur) afin de façonner l'avenir des marinas intelligentes et durables et des destinations littorales.`,

        // "représentant X" rather than "de X": French elision before a country
        // name is irregular (de la France, du Maroc, d'Égypte), and the admin
        // types the name freely. This phrasing is correct whatever they type.
        `Nous serions particulièrement honorés d'accueillir une délégation représentant **${country}**, comprenant des représentants de ses secteurs du tourisme, des marinas, des ports et du littoral. Le Rendezvous offre une occasion unique de mettre en valeur la destination, de renforcer sa visibilité internationale, de promouvoir ses ambitions maritimes et touristiques, de découvrir l'écosystème mondial des marinas et du yachting, d'échanger avec les principaux acteurs et investisseurs du secteur et d'explorer de nouvelles opportunités de partenariat et de développement durable.`,

        `Soutenu par la **Fondation Prince Albert II de Monaco**, l'événement accueille également les **Monaco Smart & Sustainable Marina Awards**, qui récompensent les innovations les plus remarquables en matière de conception, de technologie et de performance environnementale des marinas.`,

        `Si vous le souhaitez, nous serions ravis de vous offrir l'opportunité de vous adresser au public international et de présenter la vision, les projets phares et les priorités stratégiques de votre pays. Nous serions également heureux d'échanger sur le format le plus approprié pour votre participation et celle de votre délégation, y compris l'implication des acteurs du tourisme et des marinas concernés.`,

        `Nous espérons sincèrement avoir le privilège de vous accueillir, ainsi que votre délégation, à Monaco, afin de partager les valeurs promues par la Principauté et de célébrer ensemble les initiatives qui façonnent l'avenir du tourisme, des marinas et des destinations littorales.`,
      ];
    }
    return [
      `On behalf of **M3 Monaco**, ${honour} to invite you to participate in the **Monaco Smart & Sustainable Marina Rendezvous**, taking place on **${dates}** at the ${venue}.`,

      `As part of the « **Monaco, Capital of Advanced Yachting** » initiative, the Rendezvous is a leading international platform bringing together nearly **250 international decision-makers**, including authorities, destination representatives, marina operators, investors, developers, architects, technology providers and industry leaders, to shape the future of smart and sustainable marinas and waterfront destinations.`,

      `We would be particularly honoured to welcome a delegation from **${country}**, including representatives from its tourism, marina, port and waterfront sectors. The Rendezvous offers a unique opportunity to showcase the destination, strengthen its international visibility, promote its maritime and tourism ambitions, discover the global marina and yachting ecosystem, engage with leading industry stakeholders and investors, and explore new opportunities for partnerships and sustainable development.`,

      `Supported by the **Prince Albert II of Monaco Foundation**, the event also features the **Monaco Smart & Sustainable Marina Awards**, recognising outstanding innovations in marina design, technology and environmental performance.`,

      // "your country's" rather than "<Country>'s": robust for names that
      // already carry an article, such as "the United Arab Emirates".
      `Should you wish, we would be delighted to offer you the opportunity to address the international audience and present your country's vision, flagship projects and strategic priorities. We would also be pleased to discuss the most appropriate format for your participation and that of your delegation, including the involvement of relevant tourism and marina stakeholders.`,

      `We sincerely hope to have the privilege of welcoming you and your delegation to Monaco, to share the values promoted by the Principality and celebrate together the initiatives shaping the future of tourism, marinas and waterfront destinations.`,
    ];
  }

  // ---- general -------------------------------------------------------------
  const dates = eventDatesLong(lang, ev.startDate, ev.endDate);
  if (lang === 'fr') {
    return [
      `M3 Monaco a l'honneur de vous inviter à la ${ord} édition du **Monaco Smart & Sustainable Marina Rendezvous**, qui se tiendra les **${dates}** au prestigieux **${venue}**.`,

      `Cette initiative internationale, organisée par M3 Monaco, s'inscrit dans la démarche plus large « **Monaco, Capital of Advanced Yachting** ». Placé sous le Haut Patronage de S.A.S. le Prince Albert II de Monaco et soutenu par la **Fondation Prince Albert II**, l'événement réunit près de **250 acteurs clés** des écosystèmes de la marina, du yachting, du tourisme et de l'innovation.`,

      `Ce rendez-vous annuel présentera à nouveau les **Monaco Smart & Sustainable Marina Awards**, qui distinguent les réalisations les plus remarquables en matière de durabilité et d'innovation parmi les start-ups, les scale-ups, les marinas et les agences d'architecture. L'événement favorise le dialogue autour de la finance durable, du développement touristique et des stratégies littorales respectueuses de l'environnement.`,

      `Nous serions très honorés de votre présence lors du Rendezvous, afin de partager ensemble les valeurs promues par la Principauté de Monaco et l'ensemble des innovations qui préparent un avenir plus vert pour le secteur du tourisme.`,

      deadline
        ? `Nous vous saurions gré de bien vouloir confirmer votre présence avant le **${deadline}** à l'adresse ${email}.`
        : `Merci de bien vouloir confirmer votre présence à l'adresse ${email}.`,
    ];
  }
  return [
    `M3 Monaco is honoured to invite you to the ${ord} Edition of the **Monaco Smart & Sustainable Marina Rendezvous**, taking place on **${dates}** at the prestigious **${venue}**.`,

    `This international initiative, organised by M3 Monaco, is part of the broader « **Monaco, Capital of Advanced Yachting** » approach. Held under the High Patronage of H.S.H. Prince Albert II of Monaco, and supported by the **Prince Albert II Foundation**, the event brings together nearly **250 key stakeholders** from the marina, yachting, tourism and innovation ecosystem.`,

    `This annual gathering will once again present the **Monaco Smart & Sustainable Marina Awards**, recognising outstanding achievements in sustainability and innovation across start-ups, scale-ups, marinas and architectural practices. The event fosters dialogue on sustainable finance, tourism development and environmentally responsible coastal strategies.`,

    `We would be greatly honoured by your presence during the Rendezvous, to share together the values promoted by the Principality of Monaco and all the innovations promoting a greener future in the tourism sector.`,

    deadline
      ? `Kindly confirm your attendance by **${deadline}** at ${email}.`
      : `Kindly confirm your attendance at ${email}.`,
  ];
}

/** Placeholder address block, so the shape of the letter is obvious. */
export function addressPlaceholder(lang: Lang, type: LetterType): string {
  // Postal lines only. The name, title, organisation and country come from
  // their own fields and are placed above/below this block when the letter is
  // drawn, so repeating them here would print each one twice.
  if (type === 'authorities') {
    return lang === 'fr' ? 'Adresse\nCode postal, Ville' : 'Address\nZip Code, City';
  }
  return lang === 'fr' ? 'Adresse postale\nCode postal, Ville' : 'Postal Address\nZip Code, City';
}

export const SENDER_DEFAULT = ['M3 S.A.M.', 'Monte Carlo Palace', '3/7 Boulevard des Moulins', '98 000 Monaco'];
export const SIGNATORY_DEFAULT = { name: 'Avv. José Marco Casellini', title: 'CEO', org: 'M3 S.A.M.' };
// Identifiers read off the company stamp on M3's own letters.
export const FOOTER_DEFAULT =
  'M3 S.A.M. · Monte Carlo Palace, 3/7 Boulevard des Moulins, 98000 Monaco · info@m3monaco.com · NIS : 6820 B 19807 · RCI : 18 S 07927';

/**
 * Artwork shipped with the app, so a letter looks right with nothing to set up.
 * Only the public marketing assets live here: the CEO's signature and the
 * company stamp are deliberately NOT bundled, because everything under public/
 * is downloadable by anyone who guesses the URL. Those two are uploaded once
 * into private storage instead.
 */
export const BUNDLED_ASSETS = {
  banner: '/letterhead/sm26-banner.png',
  logo: '/letterhead/m3-logo.png',
  // Partner-logo strip. Served from public/ rather than storage because the
  // downloadable programme is built in a participant's browser, where the
  // admin letterhead uploads are not readable. Absent is handled gracefully:
  // the document simply renders without it.
  footer: '/letterhead/sm26-footer.png',
};
