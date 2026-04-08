import { useState, useEffect, useRef } from 'react';
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
}

export function AdBanner({ placement, className = '' }: AdBannerProps) {
  const [banner, setBanner] = useState<AdBannerData | null>(null);
  const impressionTracked = useRef(false);

  useEffect(() => {
    const fetchBanner = async () => {
      const { data, error } = await supabase
        .from('ad_banners')
        .select('id, title, image_url, target_url')
        .eq('placement', placement)
        .eq('is_active', true)
        .or('start_date.is.null,start_date.lte.now()')
        .or('end_date.is.null,end_date.gte.now()');

      if (error || !data || data.length === 0) return;

      // Pick a random banner from the results
      const randomBanner = data[Math.floor(Math.random() * data.length)] as AdBannerData;
      setBanner(randomBanner);
    };

    fetchBanner();
  }, [placement]);

  // Track impression once banner is loaded
  useEffect(() => {
    if (!banner || impressionTracked.current) return;
    impressionTracked.current = true;
    supabase.rpc('increment_banner_impressions', { banner_id: banner.id }).then(() => {});
  }, [banner]);

  const handleClick = () => {
    if (!banner) return;
    supabase.rpc('increment_banner_clicks', { banner_id: banner.id }).then(() => {});
  };

  if (!banner) return null;

  return (
    <div className={`relative rounded-xl overflow-hidden shadow-sm ${className}`}>
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
          className="w-full h-auto object-cover rounded-xl"
        />
      </a>
      <span className="absolute top-2 right-2 bg-black/50 text-white text-[10px] font-medium px-2 py-0.5 rounded-full backdrop-blur-sm">
        Sponsored
      </span>
    </div>
  );
}
