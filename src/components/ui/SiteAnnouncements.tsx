import { useState, useEffect, useId } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { X, Megaphone } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { UnderlineLink } from '@/components/brand/UnderlineLink';

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
        .contains('placements', [placement])
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

/**
 * Slim announcement strip above the navbar, homepage only: a navy-deep band (the
 * home hero is navy, so the strip reads as its top edge), a gold mark, the title
 * as a light underline link (gold line on hover) and a quiet close button.
 */
export function AnnouncementBar() {
  const { pathname } = useLocation();
  const follow = useFollow();
  const [hidden, setHidden] = useState(false);
  const ann = useAnnouncement('announcement_top', pathname === '/');
  if (pathname !== '/' || !ann || hidden) return null;
  return (
    <div className="bg-navy-deep text-white">
      <div className="mx-auto flex min-h-10 max-w-7xl items-center gap-3 px-4 py-1.5 sm:px-6">
        <Megaphone className="h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
        <UnderlineLink
          tone="light"
          onClick={() => follow(ann)}
          className="min-w-0 !text-[14px] !leading-5 [&_.uline-t]:min-w-0"
        >
          <span className="block truncate">{ann.title}</span>
        </UnderlineLink>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => { dismiss(ann.id); setHidden(true); }}
          className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-pill text-white/75 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_rgb(var(--navy-deep)),0_0_0_4px_#fff]"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/**
 * Site-wide announcement popup (skips admin / welcome / auth-ish pages): the
 * kit's floating panel, a white 16 px card with the drawer shadow over a navy
 * veil, the banner picture, an eyebrow, the title and one rolling gold button.
 */
export function AnnouncementPopup() {
  const { pathname } = useLocation();
  const follow = useFollow();
  const titleId = useId();
  const [hidden, setHidden] = useState(false);
  const [visible, setVisible] = useState(false);
  // /sm26 is the page behind the badge QR: nothing should cover it on arrival.
  const skip = pathname.startsWith('/admin') || pathname.startsWith('/welcome') || pathname.startsWith('/reset-password') || pathname.startsWith('/sm26/connect')
    || pathname.startsWith('/sm26/vote') || pathname.toLowerCase().replace(/\/+$/, '') === '/sm26';
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
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-navy-deep/[.45] p-4 backdrop-blur-[6px]" onClick={close}>
      <div
        role="dialog"
        aria-labelledby={titleId}
        className="relative w-full max-w-md overflow-hidden rounded-card bg-white text-ink shadow-drawer"
        onClick={e => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={close}
          className="absolute right-3 top-3 z-10 grid h-10 w-10 place-items-center rounded-pill bg-white text-navy ring-1 ring-inset ring-rule transition-colors hover:bg-chip focus-visible:outline-none focus-visible:shadow-focus"
        >
          <X className="h-[18px] w-[18px]" aria-hidden="true" />
        </button>
        {ann.image_url && (
          <button
            type="button"
            onClick={() => { follow(ann); close(); }}
            className="block w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <img src={ann.image_url} alt={ann.title} className="h-auto w-full" />
          </button>
        )}
        {/* Without a picture the close button sits over the text: keep the words clear of it. */}
        <div className={ann.image_url ? 'p-6' : 'p-6 pr-16'}>
          <Eyebrow>Announcement</Eyebrow>
          <p id={titleId} className="mt-2 text-card-title text-navy">{ann.title}</p>
          <Button variant="cta" className="mt-5 w-full justify-between" onClick={() => { follow(ann); close(); }}>
            Discover
          </Button>
        </div>
      </div>
    </div>
  );
}
