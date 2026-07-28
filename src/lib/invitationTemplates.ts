// Copy for the official invitation letters (ambassadors, ministers,
// institutional guests), in French and English.
//
// The templates are DEFAULTS, not a fixed script: the admin screen drops them
// into editable paragraph boxes, because a real invitation is mostly standard
// wording plus one or two paragraphs specific to that guest (a previous visit,
// a bilateral partnership). Switching language re-fills the untouched ones.
//
// **double asterisks** mark a bold run — invitationPdf renders them.

export type Lang = 'fr' | 'en';
export type Register = 'excellency' | 'minister' | 'standard';

export interface EventFacts {
  name: string;
  venue: string | null;
  startDate: string | null;   // YYYY-MM-DD
  endDate: string | null;
  editionLabel: string | null; // as stored on the event, e.g. "6th"
}

export const REGISTERS: { key: Register; fr: string; en: string }[] = [
  { key: 'excellency', fr: 'Excellence (ambassadeur, chef de délégation)', en: 'Excellency (ambassador, head of delegation)' },
  { key: 'minister', fr: 'Ministre', en: 'Minister' },
  { key: 'standard', fr: 'Standard (institutionnel, entreprise)', en: 'Standard (institutional, corporate)' },
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

/** Long date for the "Monaco, on ..." line. */
export function letterDateLong(lang: Lang, iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'en-GB',
    { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}

interface RegisterCopy { salutation: string; presence: string; closeWord: string }
const REGISTER_COPY: Record<Register, Record<Lang, RegisterCopy>> = {
  excellency: {
    fr: { salutation: 'Excellence,', presence: 'de solliciter la haute présence de Votre Excellence', closeWord: 'Excellence' },
    en: { salutation: 'Your Excellency,', presence: 'to request the high presence of Your Excellency', closeWord: 'Your Excellency' },
  },
  minister: {
    fr: { salutation: 'Monsieur le Ministre,', presence: 'de solliciter la haute présence de Votre Excellence', closeWord: 'Monsieur le Ministre' },
    en: { salutation: 'Dear Minister,', presence: 'to request the high presence of Your Excellency', closeWord: 'Minister' },
  },
  standard: {
    fr: { salutation: 'Madame, Monsieur,', presence: 'de solliciter votre présence', closeWord: 'Madame, Monsieur' },
    en: { salutation: 'Dear Sir or Madam,', presence: 'to invite you', closeWord: 'Sir or Madam' },
  },
};

export const salutationFor = (lang: Lang, r: Register) => REGISTER_COPY[r][lang].salutation;

export function subjectFor(lang: Lang, ev: EventFacts): string {
  const ord = editionOrdinal(lang, ev.editionLabel);
  return lang === 'fr'
    ? `Invitation à la ${ord} édition du Monaco Smart & Sustainable Marina Rendezvous`
    : `Invitation to the ${ord} edition of the Monaco Smart & Sustainable Marina Rendezvous`;
}

export function complimentaryCloseFor(lang: Lang, r: Register): string {
  const w = REGISTER_COPY[r][lang].closeWord;
  return lang === 'fr'
    ? `Nous vous prions d'agréer, ${w}, l'expression de notre très haute considération et de notre profond respect.`
    : `Please accept, ${w}, the assurance of our highest consideration and our deepest respect.`;
}

export interface BodyOptions {
  rsvpDeadline?: string | null;  // YYYY-MM-DD
  rsvpEmail?: string;
}

/** The standard body, in order. Custom paragraphs are added by the admin. */
export function bodyParagraphs(lang: Lang, r: Register, ev: EventFacts, opt: BodyOptions = {}): string[] {
  const ord = editionOrdinal(lang, ev.editionLabel);
  const dates = eventDatesLong(lang, ev.startDate, ev.endDate);
  const venue = ev.venue || 'Yacht Club de Monaco';
  const presence = REGISTER_COPY[r][lang].presence;
  const email = opt.rsvpEmail || 'info@m3monaco.com';
  const deadline = opt.rsvpDeadline ? letterDateLong(lang, opt.rsvpDeadline) : '';

  if (lang === 'fr') {
    return [
      `M3 Monaco a l'honneur ${presence} à la ${ord} édition du **Monaco Smart & Sustainable Marina Rendezvous**, qui se tiendra les **${dates}** au prestigieux **${venue}**.`,

      `Inscrit dans le cadre de l'initiative « **Monaco, Capital of Advanced Yachting** », cet événement international réunit près de **250 décideurs et acteurs majeurs** des secteurs du yachting, des marinas, du tourisme, de l'investissement et de l'innovation, afin de favoriser les échanges autour du développement de destinations nautiques intelligentes et durables.`,

      `Votre présence constituerait une occasion privilégiée de renforcer les échanges avec les acteurs internationaux réunis à Monaco. Soutenu par la **Fondation Prince Albert II de Monaco**, le Rendezvous accueillera également les **Monaco Smart & Sustainable Marina Awards**, récompensant les initiatives les plus remarquables en matière de durabilité et d'innovation maritime.`,

      `Nous serions heureux de pouvoir échanger avec votre Cabinet afin de convenir des modalités de votre participation et restons à votre entière disposition pour toute information complémentaire.${deadline ? ` Nous vous saurions gré de bien vouloir confirmer votre présence avant le **${deadline}** à l'adresse suivante : ${email}.` : ` Merci de bien vouloir confirmer votre présence à l'adresse suivante : ${email}.`}`,

      `Nous espérons avoir l'honneur de vous accueillir à Monaco et de poursuivre, à travers cette rencontre internationale, le dialogue engagé autour des valeurs communes de durabilité, d'innovation et de coopération qui façonnent l'avenir du tourisme, des marinas et des destinations côtières.`,
    ];
  }
  return [
    `M3 Monaco has the honour ${presence} at the ${ord} edition of the **Monaco Smart & Sustainable Marina Rendezvous**, which will be held on **${dates}** at the prestigious **${venue}**.`,

    `Part of the « **Monaco, Capital of Advanced Yachting** » initiative, this international event brings together close to **250 decision-makers and leading figures** from the yachting, marina, tourism, investment and innovation sectors, to encourage dialogue on the development of smart and sustainable nautical destinations.`,

    `Your presence would be a valuable opportunity to strengthen exchanges with the international community gathered in Monaco. Supported by the **Prince Albert II of Monaco Foundation**, the Rendezvous will also host the **Monaco Smart & Sustainable Marina Awards**, recognising the most remarkable initiatives in maritime sustainability and innovation.`,

    `We would be glad to liaise with your Office to agree the arrangements for your participation, and remain entirely at your disposal for any further information.${deadline ? ` We would be grateful if you could confirm your attendance before **${deadline}** at the following address: ${email}.` : ` Please confirm your attendance at the following address: ${email}.`}`,

    `We hope to have the honour of welcoming you to Monaco and of continuing, through this international gathering, the dialogue around the shared values of sustainability, innovation and cooperation that shape the future of tourism, marinas and coastal destinations.`,
  ];
}

/** Where a bespoke paragraph is usually inserted (after the context paragraph). */
export const CUSTOM_INSERT_INDEX = 2;

export const SENDER_DEFAULT = ['M3 S.A.M.', 'Monte Carlo Palace', '3/7 Boulevard des Moulins', '98 000 Monaco'];
export const SIGNATORY_DEFAULT = { name: 'Avv. José Marco Casellini', title: 'CEO', org: 'M3 S.A.M.' };
export const FOOTER_DEFAULT =
  'M3 S.A.M. — Monte Carlo Palace, 3/7 Boulevard des Moulins — 98 000 Monaco';
