import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useOnScreen } from '@/components/motion/useInView';

interface AdBannerData {
  id: string;
  title: string;
  image_url: string;
  target_url: string;
}

interface AdBannerProps {
  placement: string;
  className?: string;
  /** Rotation interval in seconds (0 = no rotation). Default: 8 */
  rotateInterval?: number;
}

/**
 * The slot keeps one fixed shape whatever the creative (the usual 1232 × 185
 * leaderboard; other sizes are fitted inside it on a white ground), so a
 * rotation never changes the height of the page and nothing below it jumps.
 *
 * On phones a leaderboard is only ~54 px tall, and the "Sponsored" label used
 * to cover a third of it (design audit, 8 Oct 2026: "tiny on mobile"). Below
 * 640 px the picture keeps the whole width and a caption strip under it carries
 * the label and the advertiser's name, so the slot reads as one card of ~90 px.
 */
const SLOT_RATIO = '1232 / 185';
/** The phone caption strip under the picture (its height is held while loading too). */
const CAPTION = 'flex h-8 items-center gap-2 border-t border-black/5 px-3 text-[12px] leading-4 text-meta sm:hidden';

/** The active banners of a placement, once read: later mounts (another page, a back navigation) know at once, so there is nothing to wait for. */
const loaded = new Map<string, AdBannerData[]>();
const inflight = new Map<string, Promise<AdBannerData[] | null>>();

const shuffled = (list: AdBannerData[]) => [...list].sort(() => Math.random() - 0.5);

/** Reads the active banners for a placement. Null when the read failed (nothing is remembered, the next mount tries again). */
function loadBanners(placement: string): Promise<AdBannerData[] | null> {
  const known = loaded.get(placement);
  if (known) return Promise.resolve(known);
  const running = inflight.get(placement);
  if (running) return running;
  const request = (async () => {
    // Fetch all active banners for this placement
    // Date filtering: banner is valid if (no start_date OR start_date <= now) AND (no end_date OR end_date >= now)
    // We handle date filtering client-side to avoid PostgREST .or() chaining issues
    // One advert can run on several pages, so placements is a set and we ask
    // "does it contain this page" (PostgREST `cs.` / array @>). NOTE: .eq() or
    // .in() against a text[] column return zero rows SILENTLY, and this
    // component fails closed (returns null) — so a wrong operator here makes
    // every banner vanish site-wide with a clean console.
    const { data, error } = await supabase
      .from('ad_banners')
      .select('id, title, image_url, target_url, start_date, end_date')
      .contains('placements', [placement])
      .eq('is_active', true);
    if (error || !data) return null;

    // Filter by date range client-side
    const now = new Date().toISOString();
    const valid = (data as (AdBannerData & { start_date: string | null; end_date: string | null })[]).filter((b) => {
      const startOk = !b.start_date || b.start_date <= now;
      const endOk = !b.end_date || b.end_date >= now;
      return startOk && endOk;
    });
    loaded.set(placement, valid);
    return valid;
  })().catch(() => null).finally(() => inflight.delete(placement));
  inflight.set(placement, request);
  return request;
}

/**
 * While the banners load, the slot's place is held by an empty card of the same
 * shape and margins: the page below it does not move when the banner arrives
 * (layout shift on /events/:id, /resources/:id, /directory). If the placement
 * turns out to have no banner, the place closes.
 */
export function AdBanner({ placement, className = '', rotateInterval = 8 }: AdBannerProps) {
  const [banners, setBanners] = useState<AdBannerData[] | null>(() => {
    const known = loaded.get(placement);
    return known ? shuffled(known) : null;
  });

  useEffect(() => {
    let alive = true;
    const known = loaded.get(placement);
    setBanners(known ? shuffled(known) : null);
    loadBanners(placement).then((list) => {
      // Shuffle for fair distribution. A failed read shows nothing (fails closed).
      if (alive) setBanners(list ? shuffled(list) : []);
    });
    return () => { alive = false; };
  }, [placement]);

  if (banners === null) {
    return (
      <div aria-hidden="true" className={`rounded-xl bg-white shadow-sm ring-1 ring-inset ring-black/5 ${className}`}>
        <div style={{ aspectRatio: SLOT_RATIO }} />
        <div className={CAPTION} />
      </div>
    );
  }
  if (banners.length === 0) return null;
  return <AdSlot banners={banners} className={className} rotateInterval={rotateInterval} />;
}

/** The visible slot: mounted once there is something to show, so it can watch itself on screen. */
function AdSlot({ banners, className, rotateInterval }: { banners: AdBannerData[]; className: string; rotateInterval: number }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  // Rotate only while the slot is on screen and the tab is shown.
  const onScreen = useOnScreen(ref);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [fade, setFade] = useState(true);
  const trackedImpressions = useRef<Set<string>>(new Set());

  const banner = banners[currentIndex] || banners[0];

  // Track impression when current banner changes
  useEffect(() => {
    if (!banner || trackedImpressions.current.has(banner.id)) return;
    trackedImpressions.current.add(banner.id);
    supabase.rpc('increment_banner_impressions', { banner_id: banner.id }).then(() => {});
  }, [banner]);

  // Auto-rotate banners
  const rotate = useCallback(() => {
    if (banners.length <= 1) return;
    setFade(false);
    setTimeout(() => {
      setCurrentIndex((prev) => (prev + 1) % banners.length);
      setFade(true);
    }, 300);
  }, [banners.length]);

  useEffect(() => {
    if (rotateInterval <= 0 || banners.length <= 1 || !onScreen) return;
    const timer = setInterval(rotate, rotateInterval * 1000);
    return () => clearInterval(timer);
  }, [rotate, rotateInterval, banners.length, onScreen]);

  const handleClick = () => {
    supabase.rpc('increment_banner_clicks', { banner_id: banner.id }).then(() => {});
  };

  const sponsored = t('sharedUi.adBanner.sponsored', 'Sponsored');
  return (
    <div
      ref={ref}
      className={`relative overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-inset ring-black/5 ${className}`}
    >
      <a
        href={banner.target_url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleClick}
        className={`block w-full transition-opacity duration-300 ${fade ? 'opacity-100' : 'opacity-0'}`}
      >
        <span className="block w-full" style={{ aspectRatio: SLOT_RATIO }}>
          <img
            src={banner.image_url}
            alt={banner.title}
            className="h-full w-full rounded-xl object-contain max-sm:rounded-b-none"
          />
        </span>
        {/* Phones: the label and the advertiser under the picture, never over it. */}
        <span className={CAPTION}>
          <span className="shrink-0 font-semibold uppercase tracking-[0.06em]">{sponsored}</span>
          <span aria-hidden="true">·</span>
          {/* The picture's alt text already names the advertiser for screen readers. */}
          <span aria-hidden="true" className="min-w-0 truncate font-medium text-navy">{banner.title}</span>
          <ExternalLink className="ml-auto h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        </span>
      </a>
      <span className="absolute right-2 top-2 hidden rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm sm:inline">
        {sponsored}
      </span>
    </div>
  );
}
