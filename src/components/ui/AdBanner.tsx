import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

interface AdBannerData {
  id: string;
  title: string;
  image_url: string;
  target_url: string;
}

interface AdBannerProps {
  placement: string;
  className?: string;
  /** Rotation interval in seconds (0 = no rotation). Default: 30 */
  rotateInterval?: number;
}

export function AdBanner({ placement, className = '', rotateInterval = 30 }: AdBannerProps) {
  const [banners, setBanners] = useState<AdBannerData[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [fade, setFade] = useState(true);
  const trackedImpressions = useRef<Set<string>>(new Set());

  // Fetch all active banners for this placement
  useEffect(() => {
    const fetchBanners = async () => {
      // Fetch all active banners for this placement
      // Date filtering: banner is valid if (no start_date OR start_date <= now) AND (no end_date OR end_date >= now)
      // We handle date filtering client-side to avoid PostgREST .or() chaining issues
      const { data, error } = await supabase
        .from('ad_banners')
        .select('id, title, image_url, target_url, start_date, end_date')
        .eq('placement', placement)
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
      setCurrentIndex(0);
    };

    fetchBanners();
  }, [placement]);

  // Track impression when current banner changes
  const banner = banners[currentIndex] || null;

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
    if (rotateInterval <= 0 || banners.length <= 1) return;
    const timer = setInterval(rotate, rotateInterval * 1000);
    return () => clearInterval(timer);
  }, [rotate, rotateInterval, banners.length]);

  const handleClick = () => {
    if (!banner) return;
    supabase.rpc('increment_banner_clicks', { banner_id: banner.id }).then(() => {});
  };

  if (!banner) return null;

  return (
    <div className={`relative rounded-xl overflow-hidden shadow-sm max-h-[120px] sm:max-h-[160px] transition-opacity duration-300 ${fade ? 'opacity-100' : 'opacity-0'} ${className}`}>
      <a
        href={banner.target_url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleClick}
        className="block"
      >
        <img
          src={banner.image_url}
          alt={banner.title}
          className="w-full h-full object-cover rounded-xl"
        />
      </a>
      <span className="absolute top-2 right-2 bg-black/50 text-white text-[10px] font-medium px-2 py-0.5 rounded-full backdrop-blur-sm">
        Sponsored
      </span>
    </div>
  );
}
