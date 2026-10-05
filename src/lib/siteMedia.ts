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

export const SITE_IMAGES: Record<
  | 'homeHero' | 'resourcesHero' | 'eventsHero' | 'directoryHero'
  | 'opportunitiesHero' | 'partnersHero' | 'joinHero' | 'aboutHero' | 'contactHero' | 'dashboardBand',
  SiteImage
> = {
  /** An exhibitor demoing on a tablet to visitors: suppliers answering needs. */
  opportunitiesHero: { src: '/images/site/opportunities-hero.jpg', focusY: 0.45 },
  /** The SM26 award trophies — no faces. */
  partnersHero: { src: '/images/site/partners-hero.jpg', focusY: 0.5 },
  /** A conversation at an exhibitor stand by the window: the network, in person. */
  joinHero: { src: '/images/site/join-hero.jpg', focusY: 0.4 },
  /** The SM26 community group photo under the event's own screen. */
  aboutHero: { src: '/images/site/about-hero.jpg', focusY: 0.55 },
  /** A round-table workshop: people talking things through. */
  contactHero: { src: '/images/site/contact-hero.jpg', focusY: 0.55 },
  /**
   * Behind the dashboard greeting when the member's organization has no banner
   * of its own (most of them): berth sensors on a stand, no faces.
   */
  dashboardBand: { src: '/images/site/dashboard-band.jpg', focusY: 0.65 },
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

/**
 * One picture per audience, for "why join" style cards. 3:2, 900 px.
 * There is no photo of a working marina in the SM26 set; the seabed-friendly
 * mooring demo is the closest honest picture of marina infrastructure.
 */
export const PERSONA_IMAGES = {
  marinas: '/images/site/persona-marinas.jpg',
  suppliers: '/images/site/persona-suppliers.jpg',
  media: '/images/site/persona-media.jpg',
} as const;

/**
 * Moments from Smart & Sustainable Marina Rendezvous 2026 (20–21 Sept, Yacht
 * Club de Monaco), for a "relive the event" strip. 3:2, 900 px. Alt text is
 * translated under siteMedia.moments.<key>.
 */
export const SM26_MOMENTS: { key: string; src: string; altFallback: string }[] = [
  { key: 'community', src: '/images/site/moment-community.jpg', altFallback: 'The SM26 community gathered under the event screen' },
  { key: 'workshop', src: '/images/site/moment-workshop.jpg', altFallback: 'A round-table workshop under the Workshops banner' },
  { key: 'sensors', src: '/images/site/moment-sensors.jpg', altFallback: 'Berth occupancy sensors showing free and occupied' },
  { key: 'seabedModel', src: '/images/site/moment-seabed-model.jpg', altFallback: 'An architectural model of an underwater garden' },
  { key: 'aquarium', src: '/images/site/moment-aquarium.jpg', altFallback: 'A floating-structure mooring demo in an aquarium' },
  { key: 'trophies', src: '/images/site/moment-trophies.jpg', altFallback: 'The SM26 award trophies' },
];
