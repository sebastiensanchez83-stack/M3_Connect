import type { SiteImage } from '@/lib/siteMedia';

/** The shapes of the 'json' and 'rich' blocks, shared by the pages and the admin editor. */

export type FeaturedEvent = 'all' | 'wys26' | 'webinars' | 'rendezvous';

/** 'home.hero': the frame of the home page's hero, and its floating event card. */
export interface HomeHeroBlock {
  media?: 'photo' | 'video';
  /** A site photo (/images/site/...) or an uploaded one (https://...). */
  photo?: string;
  /** 0 = top, 1 = bottom: where the subject is (SiteImage.focusY). */
  focusY?: number;
  /** A short silent loop (MP4). Plays from tablet width up; the photo is its poster. */
  video?: string;
  featured?: FeaturedEvent;
}

/** 'legal.<doc>': a legal page's body, and its "Version of ..." line. */
export interface LegalBlock {
  html: string;
  version?: string;
}

/** 'help.custom': questions of the help centre M3 hid, and the ones M3 added. */
export interface HelpAddedItem {
  /** 'm3-...': the /help#anchor of the question. */
  id: string;
  /** The help section it is listed in (helpContent.ts section id). */
  section: string;
  q: string;
  /** Paragraphs. */
  a: string[];
  linkLabel?: string;
  linkTo?: string;
}

export interface HelpCustomBlock {
  hidden?: string[];
  added?: HelpAddedItem[];
}

/** Only our own files (/images/...) and https addresses go into an src. */
export function safeMediaUrl(url: unknown): string | null {
  return typeof url === 'string' && /^(https:\/\/[^\s"'<>]+|\/(?!\/)[^\s"'<>]*)$/.test(url.trim()) ? url.trim() : null;
}

/** A link of an added help question: a page of the site, an answer (#id) or https. */
export function safeHelpLink(to: unknown): string | null {
  return typeof to === 'string' && /^(\/(?!\/)|#|https:\/\/|mailto:)[^\s"'<>]*$/.test(to.trim()) ? to.trim() : null;
}

/** The hero's photo and loop, the block first, then the code's photo. */
export function homeHeroMedia(block: HomeHeroBlock | null, fallback: SiteImage): { image: SiteImage; loopSrc?: string } {
  const photo = safeMediaUrl(block?.photo);
  const focusY = typeof block?.focusY === 'number' && block.focusY >= 0 && block.focusY <= 1 ? block.focusY : 0.5;
  const image = photo ? { src: photo, focusY } : fallback;
  const video = block?.media === 'video' ? safeMediaUrl(block.video) : null;
  return video ? { image, loopSrc: video } : { image };
}

/** The event card's items: one event alone when M3 chose it (and it is still on), else all of them. */
export function pickFeatured<T extends { id: string }>(items: T[], featured: FeaturedEvent | undefined): T[] {
  if (!featured || featured === 'all') return items;
  const one = items.filter((i) => i.id === featured);
  return one.length ? one : items;
}
