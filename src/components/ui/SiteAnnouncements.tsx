import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { X, Megaphone, ArrowRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';

// Site announcements (events, webinars…) driven by ad_banners rows with the
// 'announcement_top' / 'announcement_popup' placements — managed from
// Admin → Ad banners like any other banner, with the same date window,
// activation and click/impression tracking. Dismissals persist per banner id.

interface Announcement { id: string; title: string; image_url: string; target_url: string }

const DISMISS_PREFIX = 'smc_ann_dismissed_';
const dismissed = (id: string) => { try { return localStorage.getItem(DISMISS_PREFIX + id) === '1'; } catch { return false; } };
const dismiss = (id: string) => { try { localStorage.setItem(DISMISS_PREFIX + id, '1'); } catch { /* ignore */ } };

function useAnnouncement(placement: string, enabled: boolean): Announcement | null {
  const [ann, setAnn] = useState<Announcement | null>(null);
  useEffect(() => {
    if (!enabled) { setAnn(null); return; }
    let active = true;
    (async () => {
      const { data } = await supabase
        .from('ad_banners')
        .select('id, title, image_url, target_url, start_date, end_date')
        .eq('placement', placement)
        .eq('is_active', true);
      if (!active || !data) return;
      const now = new Date().toISOString();
      const valid = (data as (Announcement & { start_date: string | null; end_date: string | null })[])
        .filter(b => (!b.start_date || b.start_date <= now) && (!b.end_date || b.end_date >= now) && !dismissed(b.id));
      if (valid.length === 0) return;
      setAnn(valid[0]);
      supabase.rpc('increment_banner_impressions', { banner_id: valid[0].id }).then(() => {});
    })();
    return () => { active = false; };
  }, [placement, enabled]);
  return ann;
}

function useFollow() {
  const navigate = useNavigate();
  return (a: Announcement) => {
    supabase.rpc('increment_banner_clicks', { banner_id: a.id }).then(() => {});
    if (a.target_url.startsWith('/')) navigate(a.target_url);
    else window.open(a.target_url, '_blank', 'noopener');
  };
}

/** Slim announcement strip above the navbar — homepage only. */
export function AnnouncementBar() {
  const { pathname } = useLocation();
  const follow = useFollow();
  const [hidden, setHidden] = useState(false);
  const ann = useAnnouncement('announcement_top', pathname === '/');
  if (pathname !== '/' || !ann || hidden) return null;
  return (
    <div className="bg-gradient-to-r from-[#0b2653] to-[#143a6b] text-white text-sm">
      <div className="container mx-auto px-4 py-2 flex items-center gap-2.5">
        <Megaphone className="h-4 w-4 text-sky-300 shrink-0" />
        <button type="button" onClick={() => follow(ann)} className="flex items-center gap-1.5 min-w-0 text-left hover:underline underline-offset-2">
          <span className="truncate">{ann.title}</span>
          <ArrowRight className="h-3.5 w-3.5 shrink-0" />
        </button>
        <button type="button" aria-label="Dismiss" className="ml-auto text-white/60 hover:text-white shrink-0"
          onClick={() => { dismiss(ann.id); setHidden(true); }}>
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** Site-wide announcement popup (skips admin / welcome / auth-ish pages). */
export function AnnouncementPopup() {
  const { pathname } = useLocation();
  const follow = useFollow();
  const [hidden, setHidden] = useState(false);
  const [visible, setVisible] = useState(false);
  const skip = pathname.startsWith('/admin') || pathname.startsWith('/welcome') || pathname.startsWith('/reset-password') || pathname.startsWith('/sm26/connect');
  const ann = useAnnouncement('announcement_popup', !skip);

  // Small delay so the popup doesn't compete with the page paint.
  useEffect(() => {
    if (!ann) return;
    const t = setTimeout(() => setVisible(true), 1200);
    return () => clearTimeout(t);
  }, [ann]);

  if (skip || !ann || hidden || !visible) return null;
  const close = () => { dismiss(ann.id); setHidden(true); };
  return (
    <div className="fixed inset-0 z-[120] bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4" onClick={close}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden relative" onClick={e => e.stopPropagation()}>
        <button type="button" aria-label="Close" onClick={close}
          className="absolute top-2.5 right-2.5 z-10 bg-white/90 rounded-full p-1.5 text-gray-500 hover:text-gray-900 shadow-sm">
          <X className="h-4 w-4" />
        </button>
        {ann.image_url && (
          <button type="button" onClick={() => { follow(ann); close(); }} className="block w-full">
            <img src={ann.image_url} alt={ann.title} className="w-full h-auto" />
          </button>
        )}
        <div className="p-5 space-y-3">
          <div className="font-semibold text-gray-900 leading-snug">{ann.title}</div>
          <Button className="w-full gap-1.5" onClick={() => { follow(ann); close(); }}>
            Discover <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
