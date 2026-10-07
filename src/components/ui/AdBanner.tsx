import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
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
 */
const SLOT_RATIO = '1232 / 185';

export function AdBanner({ placement, className = '', rotateInterval = 8 }: AdBannerProps) {
  const [banners, setBanners] = useState<AdBannerData[]>([]);

  // Fetch all active banners for this placement
  useEffect(() => {
    const fetchBanners = async () => {
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

      if (error || !data || data.length === 0) return;

      // Filter by date range client-side
      const now = new Date().toISOString();
      const validBanners = data.filter((b) => {
        const startOk = !b.start_date || b.start_date <= now;
        const endOk = !b.end_date || b.end_date >= now;
        return startOk && endOk;
      });

      if (validBanners.length === 0) return;

      // Shuffle the array for fair distribution
      const shuffled = [...validBanners].sort(() => Math.random() - 0.5) as AdBannerData[];
      setBanners(shuffled);
    };

    fetchBanners();
  }, [placement]);

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

  return (
    <div
      ref={ref}
      className={`relative overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-inset ring-black/5 ${className}`}
      style={{ aspectRatio: SLOT_RATIO }}
    >
      <a
        href={banner.target_url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleClick}
        className={`block h-full w-full transition-opacity duration-300 ${fade ? 'opacity-100' : 'opacity-0'}`}
      >
        <img
          src={banner.image_url}
          alt={banner.title}
          className="h-full w-full rounded-xl object-contain"
        />
      </a>
      <span className="absolute top-2 right-2 bg-black/50 text-white text-[10px] font-medium px-2 py-0.5 rounded-full backdrop-blur-sm">
        {t('sharedUi.adBanner.sponsored', 'Sponsored')}
      </span>
    </div>
  );
}
