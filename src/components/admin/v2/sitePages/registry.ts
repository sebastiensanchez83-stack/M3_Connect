import type { ComponentType } from 'react';
import i18n from '@/i18n';
import { registerCopyStrings } from '@/i18n/refonte-copy';
import { registerFlowsStrings } from '@/i18n/refonte-flows';

/**
 * The pages of Admin > Site pages, and what can be changed on each.
 *
 * Text fields are the pages' own t() keys: the field shows the code's text
 * (t(key, { postProcess: [] }) skips the published one) and a published field
 * becomes the 'text:<key>' block the page reads (src/lib/siteContent/store.ts).
 * A section lists keys, or a prefix whose every string is a field (in the order
 * of the string file). Kept in the code, on purpose: page titles and meta
 * descriptions (seo.*, read by the edge function too), form labels and error
 * messages, and the words the e-mails use.
 */

registerCopyStrings();
registerFlowsStrings();

export type EditorKind = 'text' | 'home' | 'help' | 'legal';

export interface TextField {
  /** The i18n key (the block is 'text:' + key). */
  key: string;
  label: string;
  /** The code's text. */
  code: string;
  long: boolean;
  hint?: string;
}

export interface TextSection {
  title: string;
  fields: TextField[];
}

interface SectionSpec {
  title: string;
  /** Explicit keys, in this order ([key, fallback] when the code has an inline default only). */
  keys?: (string | [string, string])[];
  /** Every string under this key. */
  prefix?: string;
  /** Last segments to leave out of a prefix. */
  exclude?: string[];
}

export interface SitePageDef {
  id: string;
  group: 'pages' | 'help' | 'legal';
  name: string;
  /** Where it is on the site. */
  path: string;
  /** One line on the list. */
  description: string;
  editor: EditorKind;
  sections?: SectionSpec[];
  /** Legal pages: the block and the page component (its body is the starting text). */
  legal?: { key: string; load: () => Promise<ComponentType> };
}

export const SITE_PAGES: SitePageDef[] = [
  {
    id: 'home',
    group: 'pages',
    name: 'Home page',
    path: '/',
    description: 'The top of the home page: title, text, photo or video, and the event in the card.',
    editor: 'home',
    sections: [{
      title: 'Text at the top (visitors who are not signed in)',
      keys: [
        ['homePage.hero.eyebrow', 'Smart Marina Connect · by M3 Monaco'],
        ['home.heroTitle', 'Marinas and the companies that serve them, in one network'],
        ['home.heroSubtitle', "Marinas publish their needs, service providers answer them, and everyone meets at M3's events in Monaco, Dubai and online."],
        ['home.joinNowFree', 'Sign up'],
        ['home.exploreDirectory', 'Explore the directory'],
        ['home.trustFree', 'Free for every member'],
        ['home.trustVerified', 'Open to marinas, service providers, investors and media'],
        ['home.trustEvents', 'By M3 Monaco, organiser of the Monaco Smart & Sustainable Marina Rendezvous and the World Yachting Summit'],
      ],
    }],
  },
  {
    id: 'about',
    group: 'pages',
    name: 'About',
    path: '/about',
    description: 'Who runs the network, what it offers, how M3 checks companies.',
    editor: 'text',
    sections: [
      { title: 'Top of the page', keys: ['about.eyebrow', 'about.title', 'staticPages.about.hero.subtitle', 'about.ctaSignup', 'about.ctaContact'] },
      { title: 'Why it exists', prefix: 'staticPages.about.why' },
      { title: 'The platform', prefix: 'staticPages.about.platform' },
      { title: 'Who it is for', prefix: 'staticPages.about.profiles' },
      { title: 'How we check', prefix: 'staticPages.about.check' },
      { title: 'Where we meet', prefix: 'staticPages.about.events' },
      { title: 'The team', prefix: 'staticPages.about.team' },
    ],
  },
  {
    id: 'join',
    group: 'pages',
    name: 'Join the network',
    path: '/join',
    description: 'The page for new members: profiles, steps, questions.',
    editor: 'text',
    sections: [
      { title: 'Top of the page', keys: ['contentPages.join.eyebrow', 'join.heroTitle', 'staticPages.join.heroSubtitle'] },
      { title: 'Marinas', prefix: 'staticPages.join.marina' },
      { title: 'Service providers', prefix: 'staticPages.join.provider' },
      { title: 'Investors and developers', prefix: 'staticPages.join.investorDeveloper' },
      { title: 'Media', prefix: 'staticPages.join.media' },
      { title: 'How it works', prefix: 'staticPages.join.steps' },
      { title: 'Why join', prefix: 'staticPages.join.why' },
      { title: 'Questions', prefix: 'staticPages.join.faq' },
      { title: 'End of the page', prefix: 'staticPages.join.ready' },
    ],
  },
  {
    id: 'sponsor',
    group: 'pages',
    name: 'Sponsor an event',
    path: '/sponsor',
    description: 'Why sponsor, the events, the tiers, the deck request.',
    editor: 'text',
    sections: [
      { title: 'Top of the page', prefix: 'flows.sponsor.hero' },
      { title: 'Why sponsor', prefix: 'flows.sponsor.why' },
      { title: 'The events', prefix: 'flows.sponsor.events' },
      { title: 'Visibility by tier', prefix: 'flows.sponsor.tiers', exclude: ['listLabel'] },
      { title: 'Where sponsors appear', prefix: 'flows.sponsor.where' },
      { title: 'Current sponsors', prefix: 'flows.sponsor.current', exclude: ['label'] },
      {
        title: 'Deck request',
        keys: ['flows.sponsor.deck.eyebrow', 'flows.sponsor.deck.title', 'flows.sponsor.deck.intro',
          'flows.sponsor.deck.successTitle', 'flows.sponsor.deck.successBody', 'flows.sponsor.contactLine'],
      },
    ],
  },
  {
    id: 'contact',
    group: 'pages',
    name: 'Contact',
    path: '/contact',
    description: 'The contact page: introduction, form texts, what the team helps with.',
    editor: 'text',
    sections: [
      { title: 'Top of the page', keys: ['contentPages.contact.eyebrow', 'contact.title', 'staticPages.contact.subtitle'] },
      {
        title: 'The form',
        keys: ['staticPages.contact.formEyebrow', 'staticPages.contact.formTitle', 'staticPages.contact.formIntro',
          'staticPages.contact.messagePlaceholder', 'staticPages.contact.thankYouTitle', 'staticPages.contact.thankYouDesc'],
      },
      {
        title: 'Beside the form',
        keys: ['staticPages.contact.helpTitle', 'staticPages.contact.help1', 'staticPages.contact.help2',
          'staticPages.contact.help3', 'staticPages.contact.help4', 'contact.emailNote', 'contact.addressTitle', 'contact.principality'],
      },
    ],
  },
  {
    id: 'help',
    group: 'help',
    name: 'Help centre',
    path: '/help',
    description: 'Questions and answers: change them, hide one, or add your own.',
    editor: 'help',
  },
  {
    id: 'privacy',
    group: 'legal',
    name: 'Privacy policy',
    path: '/privacy',
    description: 'How M3 processes personal data.',
    editor: 'legal',
    legal: { key: 'legal.privacy', load: () => import('@/pages/PrivacyPage').then((m) => m.PrivacyPage) },
  },
  {
    id: 'terms',
    group: 'legal',
    name: 'Terms of use',
    path: '/terms',
    description: 'The rules for using the platform.',
    editor: 'legal',
    legal: { key: 'legal.terms', load: () => import('@/pages/TermsPage').then((m) => m.TermsPage) },
  },
  {
    id: 'cookies',
    group: 'legal',
    name: 'Cookie policy',
    path: '/cookies',
    description: 'The cookies and trackers the site uses.',
    editor: 'legal',
    legal: { key: 'legal.cookies', load: () => import('@/pages/CookiePolicyPage').then((m) => m.CookiePolicyPage) },
  },
  {
    id: 'notice',
    group: 'legal',
    name: 'Legal notice',
    path: '/mentions-legales',
    description: 'Publisher, hosting, applicable law.',
    editor: 'legal',
    legal: { key: 'legal.notice', load: () => import('@/pages/MentionsLegalesPage').then((m) => m.MentionsLegalesPage) },
  },
  {
    id: 'commercial',
    group: 'legal',
    name: 'Commercial terms',
    path: '/conditions-commerciales',
    description: 'Terms of the paid offers and sponsorships.',
    editor: 'legal',
    legal: { key: 'legal.commercial', load: () => import('@/pages/ConditionsCommercialesPage').then((m) => m.ConditionsCommercialesPage) },
  },
];

export function sitePage(id: string | undefined): SitePageDef | undefined {
  return SITE_PAGES.find((p) => p.id === id);
}

/* ─── The code's text and the field labels ───────────────────────── */

/** The code's text for an i18n key: the string files (or the inline default), never the published text. */
export function codeText(key: string, fallback = ''): string {
  const value = i18n.t(key, { postProcess: [], defaultValue: fallback });
  return typeof value === 'string' ? value : fallback;
}

const WORDS: Record<string, string> = {
  eyebrow: 'Small line above the title',
  kicker: 'Small line above the title',
  title: 'Title',
  heroTitle: 'Title',
  subtitle: 'Text under the title',
  heroSubtitle: 'Text under the title',
  intro: 'Introduction',
  who: 'Who it is for',
  body: 'Text',
  desc: 'Text',
  link: 'Link',
  note: 'Note',
  all: 'Link to all',
  online: 'Line about online events',
  ctaSignup: 'Button: sign up',
  ctaContact: 'Button: contact',
  ctaDeck: 'Button: deck',
  ctaSponsors: 'Button: sponsors',
  joinNowFree: 'Button: sign up',
  exploreDirectory: 'Button: directory',
  trustFree: 'Line with a tick 1',
  trustVerified: 'Line with a tick 2',
  trustEvents: 'Line with a tick 3',
  partnersLink: 'Link to the Partners page',
  successTitle: 'After sending: title',
  successBody: 'After sending: text',
  thankYouTitle: 'After sending: title',
  thankYouDesc: 'After sending: text',
  messagePlaceholder: 'Example text in the message box',
  formEyebrow: 'Small line above the form title',
  formTitle: 'Form title',
  formIntro: 'Form introduction',
  helpTitle: 'Title of the list',
  contactLine: 'Line about the team',
  emailNote: 'Line under the e-mail address',
  addressTitle: 'Address title',
  principality: 'Address',
};

const NUMBERED: Record<string, string> = { p: 'Paragraph', q: 'Question', a: 'Answer', help: 'Line', body: 'Text' };
const PART: Record<string, string> = { Title: 'title', Body: 'text', Desc: 'text', DescLive: 'text with the live figure' };

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** "p1" → "Paragraph 1", "step2Title" → "Step 2: title", "main_sponsor" → "Main sponsor". */
export function humanKey(seg: string): string {
  if (WORDS[seg]) return WORDS[seg];
  let m = seg.match(/^(p|q|a|help|body)(\d+)$/);
  if (m) return `${NUMBERED[m[1]]} ${m[2]}`;
  m = seg.match(/^(step|b)(\d+)(Title|Body|Desc|DescLive)$/);
  if (m) return `${m[1] === 'step' ? 'Step' : 'Point'} ${m[2]}: ${PART[m[3]]}`;
  return cap(seg.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
}

function field(key: string, label: string, code: string): TextField {
  return {
    key,
    label,
    code,
    long: code.length > 70,
    hint: code.includes('{{') ? 'Keep the words between {{ }} as they are: the site puts the live figure there.' : undefined,
  };
}

/** The fields of a text page, from its sections. Keys the code does not have are left out. */
export function buildTextSections(page: SitePageDef): TextSection[] {
  return (page.sections ?? []).map((spec) => {
    const fields: TextField[] = [];
    for (const entry of spec.keys ?? []) {
      const [key, fallback] = Array.isArray(entry) ? entry : [entry, ''];
      const code = codeText(key, fallback);
      if (code) fields.push(field(key, humanKey(key.split('.').pop() ?? key), code));
    }
    if (spec.prefix) {
      const tree = i18n.getResource('en', 'translation', spec.prefix) as unknown;
      const walk = (node: unknown, path: string[]) => {
        if (typeof node === 'string') {
          const last = path[path.length - 1];
          if (spec.exclude?.includes(last)) return;
          const key = [spec.prefix, ...path].join('.');
          const label = path.length > 1
            ? `${path.slice(0, -1).filter((p) => p !== 'reasons').map(humanKey).join(' · ')} · ${humanKey(last).toLowerCase()}`
            : humanKey(last);
          fields.push(field(key, cap(label), codeText(key, node)));
        } else if (node && typeof node === 'object') {
          for (const [k, v] of Object.entries(node as Record<string, unknown>)) walk(v, [...path, k]);
        }
      };
      walk(tree, []);
    }
    return { title: spec.title, fields };
  }).filter((s) => s.fields.length > 0);
}
