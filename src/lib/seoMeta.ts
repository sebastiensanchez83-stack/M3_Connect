/**
 * What a page's <head> tells search engines and share previews, worked out in
 * one place for two readers:
 *
 *  - the browser, through <Seo> (src/components/seo/Seo.tsx, react-helmet-async);
 *  - the Netlify edge functions (netlify/edge-functions/seo.ts and sitemap.ts),
 *    which write the same tags into the HTML for the robots that never run
 *    JavaScript: LinkedIn, WhatsApp, Slack, X, Facebook and friends.
 *
 * Both get the same tag list from headTags(), so the HTML a robot reads and the
 * page Google renders say the same thing. Every tag is marked data-rh="true":
 * react-helmet-async then replaces the ones the edge function wrote instead of
 * adding a second copy.
 *
 * Deno imports this file as it is: its imports are ./seoText.ts and the
 * import-free string table ../i18n/refonte-events.ts, written with their
 * extension, and nothing here may touch the DOM, React, i18next or Vite. The
 * words come from src/i18n/seo.ts, passed in as a SeoTr.
 */
import { cutAtWord, shortDateRange, withSiteSuffix, SITE_NAME, TITLE_MAX } from './seoText.ts';
// The Rendezvous' validated page text (eventDetail.rendezvousAbout), the one the page itself prints.
import { EVENTS_STRINGS } from '../i18n/refonte-events.ts';

export const SITE_URL = 'https://smartmarinaconnect.com';

/** The production site's own hostnames. Any other host is a preview (deploy preview, branch deploy, *.netlify.app, localhost). */
export const PRODUCTION_HOSTS = ['smartmarinaconnect.com', 'www.smartmarinaconnect.com'];

/** True on every host but the production site's: such a copy of the site must stay out of search engines. */
export function isPreviewHostname(hostname: string): boolean {
  return !PRODUCTION_HOSTS.includes(hostname.trim().toLowerCase());
}

/** The default share picture: the SM26 exhibition hall under a navy veil, the S and the name (public/images/og-default.jpg). */
export const DEFAULT_SHARE_IMAGE = { url: `${SITE_URL}/images/og-default.jpg`, width: 1200, height: 630 } as const;

/** The publisher logo in structured data: the square S symbol (public/icons/icon-512.png), 512 px. */
export const SITE_LOGO = `${SITE_URL}/icons/icon-512.png`;

/** Publisher of the platform and organiser of its events (legal notice: M3 Monaco SAM). Described in full in index.html. */
export const PUBLISHER = { '@type': 'Organization', '@id': `${SITE_URL}/#m3`, name: 'M3 Monaco' } as const;

// ------------------------------------------------------------------ URLs

export const orgPath = (slug: string) => `/organizations/${encodeURIComponent(slug)}`;
export const eventPath = (id: string) => `/events/${encodeURIComponent(id)}`;
export const resourcePath = (id: string) => `/resources/${encodeURIComponent(id)}`;

/** The events row of the Monaco Smart & Sustainable Marina Rendezvous, 6th edition (same id as RENDEZVOUS_2026_PATH in components/brand/m3Events.ts). */
export const RENDEZVOUS_6TH_EVENT_ID = 'f55f7b2f-96ac-4c5e-b620-358624e52240';

/** The path of that event's page: the canonical URL of its agenda (/sm26/agenda). */
export const RENDEZVOUS_6TH_PATH = eventPath(RENDEZVOUS_6TH_EVENT_ID);

/** The directory and the library are browsed by theme: ?theme= is the only query string a canonical URL keeps. */
export const themedPath = (base: '/directory' | '/resources', themeKey: string | null | undefined) =>
  (themeKey ? `${base}?theme=${encodeURIComponent(themeKey)}` : base);

/** "/about" → "https://smartmarinaconnect.com/about". Absolute http(s) URLs pass through. */
export function absoluteUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${SITE_URL}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}

/** An image field as an absolute URL, or null when it is empty or not a web address. */
function imageUrl(src: string | null | undefined): string | null {
  const value = src?.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/') && !value.startsWith('//')) return `${SITE_URL}${value}`;
  return null;
}

/** "www.example.com" → "https://www.example.com"; anything that is not a web address → null. */
function websiteUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value || /\s/.test(value)) return null;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    return url.hostname.includes('.') ? url.toString() : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ words

/** Looks up a key of the `seo` strings ("organization.title") and fills its {{fields}}. */
export type SeoTr = (key: string, vars?: Record<string, string | number>) => string;

/** A SeoTr over a plain strings object (SEO_STRINGS.en.seo), for code without i18next: the edge functions. */
export function makeSeoTr(strings: unknown): SeoTr {
  return (key, vars = {}) => {
    let node: unknown = strings;
    for (const part of key.split('.')) {
      node = node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined;
    }
    if (typeof node !== 'string') return '';
    return node.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, name: string) => (name in vars ? String(vars[name]) : ''));
  };
}

// ------------------------------------------------------------------ the tags

export type JsonLd = Record<string, unknown>;

export interface PageMeta {
  /** The final title, suffix included when it fits (withSiteSuffix). */
  title: string;
  description?: string;
  /**
   * The page's own path, with the one query string that matters (?theme=):
   * it becomes the canonical URL and og:url. Null or absent on pages that
   * have no canonical of their own (not found, private).
   */
  path?: string | null;
  /** The record's own picture (cover, thumbnail); the default share picture when absent. */
  image?: string | null;
  imageAlt?: string;
  type?: 'website' | 'article';
  noindex?: boolean;
  jsonLd?: JsonLd | null;
}

export interface HeadTag {
  tag: 'meta' | 'link' | 'script';
  attrs: Record<string, string>;
  /** Text of a <script> (JSON-LD), already safe to put between <script> tags. */
  body?: string;
}

/** JSON for a <script type="application/ld+json">: "<" escaped so no text can close the script early. */
export function jsonLdText(data: JsonLd): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/**
 * The tags after <title>, in order. `defaultImageAlt` describes the default
 * share picture (seo.shareImageAlt); a record's own picture is described by
 * the page title.
 */
export function headTags(meta: PageMeta, defaultImageAlt: string): HeadTag[] {
  const tags: HeadTag[] = [];
  const meta_ = (attrs: Record<string, string>) => tags.push({ tag: 'meta', attrs });
  const url = meta.path && !meta.noindex ? absoluteUrl(meta.path) : null;
  const ownImage = imageUrl(meta.image);
  const image = ownImage ?? DEFAULT_SHARE_IMAGE.url;
  const alt = ownImage ? (meta.imageAlt || meta.title) : defaultImageAlt;

  if (meta.description) meta_({ name: 'description', content: meta.description });
  if (meta.noindex) meta_({ name: 'robots', content: 'noindex' });
  if (url) tags.push({ tag: 'link', attrs: { rel: 'canonical', href: url } });
  meta_({ property: 'og:type', content: meta.type ?? 'website' });
  meta_({ property: 'og:title', content: meta.title });
  if (meta.description) meta_({ property: 'og:description', content: meta.description });
  if (url) meta_({ property: 'og:url', content: url });
  meta_({ property: 'og:image', content: image });
  if (!ownImage) {
    meta_({ property: 'og:image:width', content: String(DEFAULT_SHARE_IMAGE.width) });
    meta_({ property: 'og:image:height', content: String(DEFAULT_SHARE_IMAGE.height) });
  }
  if (alt) meta_({ property: 'og:image:alt', content: alt });
  meta_({ name: 'twitter:title', content: meta.title });
  if (meta.description) meta_({ name: 'twitter:description', content: meta.description });
  meta_({ name: 'twitter:image', content: image });
  if (alt) meta_({ name: 'twitter:image:alt', content: alt });
  if (meta.jsonLd) tags.push({ tag: 'script', attrs: { type: 'application/ld+json' }, body: jsonLdText(meta.jsonLd) });
  return tags;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** <title> plus the head tags as HTML, each marked data-rh="true" (the edge function's output). */
export function headHtml(meta: PageMeta, defaultImageAlt: string): string {
  const lines = [`<title>${escapeHtml(meta.title)}</title>`];
  for (const { tag, attrs, body } of headTags(meta, defaultImageAlt)) {
    const attrText = Object.entries(attrs).map(([k, v]) => ` ${k}="${escapeHtml(v)}"`).join('');
    lines.push(tag === 'script' ? `<script data-rh="true"${attrText}>${body ?? ''}</script>` : `<${tag} data-rh="true"${attrText} />`);
  }
  return lines.join('\n    ');
}

// ------------------------------------------------------------------ fixed pages

export const THEME_KEYS = ['infrastructure', 'design', 'digital', 'energy', 'operations', 'business'] as const;

/** English theme names, as themes.* in src/i18n/index.ts (the edge function has no i18next). */
export const THEME_LABELS_EN: Record<string, string> = {
  infrastructure: 'Infrastructure & construction',
  design: 'Design & architecture',
  digital: 'Digital & smart marina',
  energy: 'Energy & environment',
  operations: 'Operations & services',
  business: 'Business & legal',
};

/**
 * The fixed public pages: the seo.* key of their words, and the path their
 * canonical URL points to. Aliases (/join, /network, /marketplace) redirect
 * in the app and share their target's words and canonical.
 */
const FIXED_PAGES: Record<string, { key: string; canonical: string }> = {
  '/': { key: 'home', canonical: '/' },
  '/directory': { key: 'directory', canonical: '/directory' },
  '/network': { key: 'directory', canonical: '/directory' },
  '/marketplace': { key: 'directory', canonical: '/directory' },
  '/resources': { key: 'resources', canonical: '/resources' },
  '/events': { key: 'events', canonical: '/events' },
  '/partners': { key: 'partners', canonical: '/partners' },
  '/sponsor': { key: 'sponsor', canonical: '/sponsor' },
  '/become-partner': { key: 'join', canonical: '/become-partner' },
  '/join': { key: 'join', canonical: '/become-partner' },
  '/opportunities': { key: 'opportunities', canonical: '/opportunities' },
  '/about': { key: 'about', canonical: '/about' },
  '/contact': { key: 'contact', canonical: '/contact' },
  '/sm26': { key: 'sm26', canonical: '/sm26' },
  '/sm26/vote': { key: 'sm26Vote', canonical: '/sm26/vote' },
  '/wys26': { key: 'wys26', canonical: '/wys26' },
};

/**
 * Pages whose words are fixed English text rather than i18n keys: the legal
 * documents and the two SM26 pages that used to fall back on the home page's
 * title in search results. The page (through <Seo>) and the edge function read
 * this one table, so they cannot disagree.
 *
 *  - `canonical` is where the canonical URL points. /sm26/agenda points at the
 *    6th edition's event page: its programme is that page's archive. Never
 *    move /sm26 itself (printed on every badge).
 *  - `noindex` keeps the page out of search results and drops its canonical:
 *    /sm26/register is a form that is closed for an edition that took place.
 *
 * Titles get the " | Smart Marina Connect" suffix when it fits (withSiteSuffix);
 * descriptions stay under 155 characters.
 */
const PLAIN_PAGES: Record<string, { title: string; description: string; canonical?: string; noindex?: boolean }> = {
  '/privacy': {
    title: 'Privacy Policy',
    description: 'How M3 Monaco SAM, publisher of Smart Marina Connect, collects, uses and protects personal data, and the rights you have over yours.',
    canonical: '/privacy',
  },
  '/terms': {
    title: 'Terms of Use',
    description: 'The terms of use of Smart Marina Connect, published by M3 Monaco SAM: access and accounts, rules of use, content, intellectual property and liability.',
    canonical: '/terms',
  },
  '/cookies': {
    title: 'Cookie Policy',
    description: 'The cookies and similar technologies Smart Marina Connect may use, what they are for, how consent works and how to manage them in your browser.',
    canonical: '/cookies',
  },
  '/mentions-legales': {
    title: 'Legal Notice',
    description: 'Legal notice of Smart Marina Connect: its publisher M3 Monaco SAM, the publication director, hosting, intellectual property and applicable law.',
    canonical: '/mentions-legales',
  },
  '/conditions-commerciales': {
    title: 'Commercial Terms',
    description: 'The commercial terms of the visibility and sponsorship offers on Smart Marina Connect: contract, pricing and payment, duration, termination and refunds.',
    canonical: '/conditions-commerciales',
  },
  '/sm26/agenda': {
    title: 'Agenda — Monaco Smart & Sustainable Marina Rendezvous 2026',
    description: 'The programme of the Monaco Smart & Sustainable Marina Rendezvous, 20–21 September 2026: sessions, workshops and slides, kept here as an archive.',
    canonical: RENDEZVOUS_6TH_PATH,
  },
  '/sm26/register': {
    title: 'Register — Monaco Smart & Sustainable Marina Rendezvous 2026',
    description: 'Registration page of the Monaco Smart & Sustainable Marina Rendezvous 2026.',
    noindex: true,
  },
};

/** The head of one of the PLAIN_PAGES, or null for any other path. */
export function plainPageMeta(pathname: string): PageMeta | null {
  const page = PLAIN_PAGES[pathname];
  if (!page) return null;
  return {
    title: withSiteSuffix(page.title),
    description: page.description,
    path: page.noindex ? null : (page.canonical ?? pathname),
    noindex: page.noindex,
  };
}

/** The paths plainPageMeta() describes (the edge function's route list is built from them). */
export const PLAIN_PAGE_PATHS = Object.keys(PLAIN_PAGES);

/**
 * The head of a fixed public page, in the words of `tr` (English at the edge),
 * or null for any other path. The browser pages build the same title and
 * description from the same keys; theirs may carry live counts on top.
 */
export function fixedPageMeta(pathname: string, themeParam: string | null, tr: SeoTr): PageMeta | null {
  const plain = plainPageMeta(pathname);
  if (plain) return plain;
  const page = FIXED_PAGES[pathname];
  if (!page) return null;
  const theme = (page.key === 'directory' || page.key === 'resources') && themeParam && THEME_LABELS_EN[themeParam] ? themeParam : null;
  if (theme) {
    const vars = { theme: THEME_LABELS_EN[theme] };
    return {
      title: withSiteSuffix(tr(`${page.key}.themeTitle`, vars)),
      description: tr(`${page.key}.themeDescription`, vars),
      path: themedPath(page.canonical as '/directory' | '/resources', theme),
    };
  }
  return {
    title: withSiteSuffix(tr(`${page.key}.title`)),
    description: tr(`${page.key}.description`),
    path: page.canonical,
  };
}

/** The fixed pages listed in the sitemap. Not /sm26* and /wys26 (event utilities), nor the aliases. (/tiers is retired: a 301 to the contact form, netlify.toml.) */
export const SITEMAP_FIXED_PATHS: string[] = [
  '/',
  '/directory',
  ...THEME_KEYS.map((k) => themedPath('/directory', k)),
  '/resources',
  ...THEME_KEYS.map((k) => themedPath('/resources', k)),
  '/events',
  '/partners',
  '/sponsor',
  '/become-partner',
  '/opportunities',
  '/about',
  '/contact',
  '/privacy',
  '/terms',
  '/cookies',
  '/mentions-legales',
  '/conditions-commerciales',
];

// ------------------------------------------------------------------ organizations

/** The organization columns the head needs (all readable by an anonymous visitor). */
export interface OrgSeoInput {
  name: string;
  slug: string;
  organization_type?: string | null;
  city?: string | null;
  country?: string | null;
  headquarters_country?: string | null;
  description?: string | null;
  website?: string | null;
  logo_url?: string | null;
  banner_url?: string | null;
}

export const ORG_SEO_COLUMNS = 'name,slug,organization_type,city,country,headquarters_country,description,website,logo_url,banner_url';

const ORG_TYPE_KEYS = ['marina', 'partner', 'media_partner', 'developer', 'investor'];

/** "Name — Type in City, Country", shortened until it fits, then "Name, type in place. First words…". */
export function organizationMeta(org: OrgSeoInput, tr: SeoTr): PageMeta {
  const typeKey = org.organization_type && ORG_TYPE_KEYS.includes(org.organization_type) ? org.organization_type : 'other';
  const location = [org.city, org.country].filter(Boolean).join(', ');
  const place = location || org.headquarters_country || '';
  const titleVars = { name: org.name, type: tr(`orgTypesTitle.${typeKey}`), place };
  const title = withSiteSuffix([
    place ? tr('organization.title', titleVars) : '',
    tr('organization.titleNoPlace', titleVars),
  ].find((candidate) => candidate && candidate.length <= TITLE_MAX) ?? org.name);
  const summary = org.description ? cutAtWord(org.description, 300) : '';
  const description = cutAtWord(tr(
    `organization.description${summary ? '' : 'NoSummary'}${place ? '' : 'NoPlace'}`,
    { name: org.name, type: tr(`orgTypes.${typeKey}`), place, summary },
  ));
  const path = orgPath(org.slug);
  const pageUrl = absoluteUrl(path);
  const country = org.country || org.headquarters_country || null;
  const jsonLd: JsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: org.name,
    description: summary || description,
    url: websiteUrl(org.website) ?? pageUrl,
    logo: imageUrl(org.logo_url) ?? undefined,
    image: imageUrl(org.banner_url) ?? undefined,
    address: org.city || country
      ? { '@type': 'PostalAddress', addressLocality: org.city || undefined, addressCountry: country || undefined }
      : undefined,
    mainEntityOfPage: pageUrl,
  };
  return { title, description, path, image: org.banner_url, imageAlt: org.name, type: 'website', jsonLd };
}

// ------------------------------------------------------------------ events

export interface EventSeoInput {
  id: string;
  title: string;
  description?: string | null;
  date_time?: string | null;
  end_date_time?: string | null;
  location?: string | null;
  event_type?: string | null;
  location_details?: { venue?: string; city?: string; country?: string; address?: string } | null;
  image_url?: string | null;
}

export const EVENT_SEO_COLUMNS = 'id,title,description,date_time,end_date_time,location,event_type,location_details,image_url,published';

/**
 * The event's own name, then "when, where. Summary…" — what someone looking for the event reads first.
 *
 * The Rendezvous' database description still carries a patronage line and counts that are not
 * cleared as published figures. Its page prints the validated About text instead
 * (eventDetail.rendezvousAbout, src/i18n/refonte-events.ts), so the head, the share card and the
 * Event JSON-LD use that same text: the page and the edge function that writes the head into the
 * HTML for robots must never say two different things. Every other event keeps its own description.
 */
export function eventMeta(event: EventSeoInput, tr: SeoTr, locale: string): PageMeta {
  const isWebinar = event.event_type === 'webinar';
  const details = event.location_details ?? {};
  const venueLine = isWebinar ? null : (details.venue || event.location);
  const title = withSiteSuffix(event.title);
  const when = event.date_time ? shortDateRange(event.date_time, event.end_date_time, locale) : tr('event.dateTbd');
  const where = isWebinar ? tr('event.online') : (venueLine || details.city || event.location || '');
  const text = event.id === RENDEZVOUS_6TH_EVENT_ID ? EVENTS_STRINGS.en.eventDetail.rendezvousAbout : event.description;
  const summary = text ? cutAtWord(text, 400) : '';
  const description = cutAtWord(tr(`event.description${summary ? '' : 'NoSummary'}${where ? '' : 'NoPlace'}`, { when, where, summary }));
  const path = eventPath(event.id);
  const pageUrl = absoluteUrl(path);

  let jsonLd: JsonLd | null = null;
  if (event.date_time) {
    const placeName = details.venue || event.location || details.city || undefined;
    const address = details.address || details.city || details.country
      ? { '@type': 'PostalAddress', streetAddress: details.address || undefined, addressLocality: details.city || undefined, addressCountry: details.country || undefined }
      : placeName;
    jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: event.title,
      // The 155-character meta description, not the record's long text: editorial
      // copy further down an event's description stays out of structured data.
      description,
      url: pageUrl,
      startDate: event.date_time,
      endDate: event.end_date_time || undefined,
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: isWebinar ? 'https://schema.org/OnlineEventAttendanceMode' : 'https://schema.org/OfflineEventAttendanceMode',
      location: isWebinar
        ? { '@type': 'VirtualLocation', url: pageUrl }
        : placeName || address ? { '@type': 'Place', name: placeName, address } : undefined,
      image: [imageUrl(event.image_url) ?? DEFAULT_SHARE_IMAGE.url],
      organizer: PUBLISHER,
    };
  }
  return { title, description, path, image: event.image_url, imageAlt: event.title, type: 'website', jsonLd };
}

// ------------------------------------------------------------------ resources

export interface ResourceSeoInput {
  id: string;
  title: string;
  summary?: string | null;
  thumbnail_url?: string | null;
  language?: string | null;
  published_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export const RESOURCE_SEO_COLUMNS = 'id,title,summary,thumbnail_url,language,published_at,created_at,updated_at';

export function resourceMeta(resource: ResourceSeoInput, tr: SeoTr): PageMeta {
  const title = withSiteSuffix(resource.title);
  const description = resource.summary
    ? cutAtWord(resource.summary)
    : cutAtWord(tr('resource.descriptionNoSummary', { title: resource.title }));
  const path = resourcePath(resource.id);
  const pageUrl = absoluteUrl(path);
  const published = resource.published_at || resource.created_at || undefined;
  const jsonLd: JsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: cutAtWord(resource.title, 110),
    description,
    image: [imageUrl(resource.thumbnail_url) ?? DEFAULT_SHARE_IMAGE.url],
    datePublished: published,
    dateModified: resource.updated_at || published,
    inLanguage: resource.language ? resource.language.toLowerCase() : undefined,
    author: { '@type': 'Organization', name: SITE_NAME, url: `${SITE_URL}/` },
    publisher: { '@type': 'Organization', name: SITE_NAME, url: `${SITE_URL}/`, logo: { '@type': 'ImageObject', url: SITE_LOGO } },
    mainEntityOfPage: pageUrl,
  };
  return { title, description, path, image: resource.thumbnail_url, imageAlt: resource.title, type: 'article', jsonLd };
}
