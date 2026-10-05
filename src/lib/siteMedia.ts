/**
 * The platform's own photography and video — page headers and the teaser, as
 * opposed to media that belongs to a record (a resource's thumbnail, an
 * organization's banner).
 *
 * Photos are web-sized copies (1800 px, or 660 px for tiles) of the SM26 event
 * photos in Dropbox, Communication/Photos platform, by the photographers mesi
 * and Liam. They are not pre-cropped: `focusY` (0 = top, 1 = bottom) tells
 * CoverImage where the subject is, because the same file fills a 6:1 desktop
 * band and a near-square phone header. A null `src` is a deliberate look, not a
 * gap: CoverImage draws a brand gradient instead.
 *
 * Theme pictures live on each theme in src/lib/themes.ts.
 */
export interface SiteImage {
  src: string | null;
  focusY: number;
}

export const SITE_IMAGES: Record<'homeHero' | 'resourcesHero' | 'eventsHero' | 'directoryHero', SiteImage> = {
  /** Overhead view of the packed exhibition hall at the Yacht Club de Monaco. */
  homeHero: { src: '/images/site/home-hero.jpg', focusY: 0.6 },
  /**
   * A panel on stage in front of the audience. Pre-cropped to the lower half:
   * the stage screen above it shows the four speakers' portraits and full
   * names, which no object-position can keep out of a phone-sized header.
   */
  resourcesHero: { src: '/images/site/resources-hero.jpg', focusY: 0.3 },
  /** Full room, speaker at the lectern. */
  eventsHero: { src: '/images/site/events-hero.jpg', focusY: 0.5 },
  /** Conversations between exhibitor stands. */
  directoryHero: { src: '/images/site/directory-hero.jpg', focusY: 0.2 },
};

/**
 * The 1 min 43 platform teaser (Communication/Video in Dropbox), re-encoded for
 * the web: H.264 1080p at ~3 Mbps, 38.6 MB, index moved to the front so playback
 * starts on the first bytes.
 *
 * It is far too large for the Netlify deploy (10 MB per file recommended), so it
 * lives in the public Supabase Storage bucket `site-media`. The player checks the
 * file exists before showing itself, so the homepage never offers a play button
 * that fails — upload or replace the file and it appears on its own.
 */
export const TEASER = {
  src: 'https://djjbgzasuomhyfvtlidi.supabase.co/storage/v1/object/public/site-media/teaser/smart-marina-connect-teaser.mp4',
  /** Frame at 41 s: the ecosystem wheel — every stakeholder around the platform. */
  poster: '/images/site/teaser-poster.jpg',
  duration: '1:43',
  durationIso: 'PT1M43S',
};
