import { useLayoutEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { NewsBand, type NewsItem } from '@/components/brand/NewsBand';
import { useOrgTypeLabel } from '@/components/brand/OrgCard';
import { WYS26_PATH, isWys26Event, wys26Upcoming } from '@/components/events/WysInvitationCard';
import { useNewsTicker, TICKER_PER_KIND, type TickerData } from '@/hooks/useNewsTicker';
import { displayCase } from '@/lib/displayCase';
import { englishCountryName } from '@/lib/countryNames';

/**
 * The site-wide news ticker (Victor, 9 Oct 2026): the latest articles, the newest
 * members and the next events and webinars sliding by in a slim navy strip
 * (NewsBand) at the very top of the page, above the header.
 *
 * Where: on every page for signed-in members, and on the home page for
 * visitors too. Never on working or one-off screens: the admin, onboarding, the
 * sign-in flows (/welcome, /reset-password), /unsubscribe, the WYS guest pass,
 * the SM26 kiosks and consoles (/sm26/… but not /sm26 itself), team invitations
 * (/join/<id>) and the reference confirmation links.
 *
 * Why above the header: it is in the normal flow, so it scrolls away with the
 * page after 36–40 px and never takes room from the reading; the header stays
 * sticky right under it. The heroes that sit under a transparent header
 * (headerOverlay.ts) are untouched: the header still floats over them, the strip
 * simply comes first, and on a navy hero it reads as its top edge (the same slot
 * as the home page's announcement strip). Under the header it would have had to
 * float over those heroes and hide their top.
 *
 * In the DOM it comes AFTER the header (App.tsx), drawn first with `order`: a
 * keyboard user meets the main navigation before a dozen news links.
 */

const HIDDEN_ON: RegExp[] = [
  /^\/admin(\/|$)/,
  /^\/onboarding(\/|$)/,
  /^\/welcome(\/|$)/,
  /^\/reset-password(\/|$)/,
  /^\/unsubscribe(\/|$)/,
  /^\/wys26\/guest(\/|$)/,
  // SM26 kiosks, consoles and token pages; the /sm26 hub itself keeps the strip.
  /^\/sm26\/./,
  // The team invitation (/join itself is the membership presentation).
  /^\/join\/./,
  /^\/reference\//,
];

/** Whether the strip belongs on this page for this visitor. */
export function tickerVisible(pathname: string, signedIn: boolean): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (HIDDEN_ON.some((re) => re.test(path))) return false;
  return path === '/' || signedIn;
}

/** A session is stored in this browser: on a first load, while auth is still reading it, a member is presumed. */
function hasStoredSession(): boolean {
  try {
    const host = new URL(import.meta.env.VITE_SUPABASE_URL || '').hostname.split('.')[0];
    return !!window.localStorage.getItem(`sb-${host}-auth-token`);
  } catch {
    return false;
  }
}

const clip = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The ticker's items: events first, then articles and members, taken in turn so the kinds alternate. */
function useTickerItems(data: TickerData | null): NewsItem[] {
  const { t } = useTranslation();
  const typeLabel = useOrgTypeLabel();
  return useMemo(() => {
    if (!data) return [];
    const date = (iso: string, timeZone?: string) => {
      try {
        return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone }).format(new Date(iso));
      } catch {
        return '';
      }
    };

    // ── Events and webinars, soonest first; the World Yachting Summit links to its own page ──
    const wysItem = (): NewsItem & { at: string } => ({
      id: 'wys26',
      at: '2026-11-27T10:00:00+04:00',
      kind: t('brand.news.event', 'Event'),
      text: [t('brand.events.wys.title', 'World Yachting Summit'), t('brand.events.wys.place', 'Dubai'), date('2026-11-27T10:00:00+04:00', 'Asia/Dubai')].join(' · '),
      href: WYS26_PATH,
    });
    const events: (NewsItem & { at: string })[] = [];
    for (const e of data.events) {
      if (isWys26Event(e.title)) {
        if (!events.some((x) => x.id === 'wys26')) events.push(wysItem());
        continue;
      }
      const webinar = (e.event_type ?? '').toLowerCase() === 'webinar';
      events.push({
        id: `event-${e.id}`,
        at: e.date_time,
        kind: webinar ? t('brand.news.webinar', 'Webinar') : t('brand.news.event', 'Event'),
        text: [clip(e.title), date(e.date_time)].filter(Boolean).join(' · '),
        href: `/events/${e.id}`,
      });
    }
    if (wys26Upcoming(Date.now()) && !events.some((x) => x.id === 'wys26')) events.push(wysItem());
    events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

    // ── Latest articles ──
    const articleKind = (type: string | null) => {
      switch ((type ?? '').toLowerCase()) {
        case 'replay':
          return t('brand.news.replay', 'Replay');
        case 'guide':
          return t('brand.news.guide', 'Guide');
        case 'whitepaper':
          return t('brand.news.whitepaper', 'White paper');
        default:
          return t('brand.news.article', 'Article');
      }
    };
    const articles: NewsItem[] = data.articles.map((r) => ({
      id: `article-${r.id}`,
      kind: articleKind(r.type),
      text: clip(r.title),
      href: `/resources/${r.id}`,
    }));

    // ── Newest members: "Name, Marina, Spain" ──
    const members: NewsItem[] = data.members.map((o) => ({
      id: `member-${o.id}`,
      kind: t('brand.news.newMember', 'New member'),
      text: [
        displayCase(o.name) || o.name,
        o.organization_type ? typeLabel(o.organization_type) : '',
        englishCountryName(o.country || o.headquarters_country),
      ].filter(Boolean).join(', '),
      href: `/organizations/${o.slug}`,
    }));

    const lists: NewsItem[][] = [
      events.slice(0, TICKER_PER_KIND).map(({ at: _at, ...item }) => item),
      articles.slice(0, TICKER_PER_KIND),
      members.slice(0, TICKER_PER_KIND),
    ];
    const out: NewsItem[] = [];
    for (let i = 0; i < TICKER_PER_KIND; i++) for (const list of lists) if (list[i]) out.push(list[i]);
    return out;
    // typeLabel is rebuilt on each render but only reads `t`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, t]);
}

export function SiteTicker() {
  const { pathname } = useLocation();
  const { user, loading: authLoading } = useAuth();
  const signedIn = user ? true : authLoading ? hasStoredSession() : false;
  const visible = tickerVisible(pathname, signedIn);
  const { data, loading } = useNewsTicker(visible, signedIn ? 'member' : 'visitor', pathname);
  const items = useTickerItems(data);
  const shown = visible && (loading || items.length > 0);

  // Heroes that fill the first screen take the strip's height off (smc-motion.css, --ticker-h).
  useLayoutEffect(() => {
    if (!shown) return;
    const root = document.documentElement;
    root.setAttribute('data-site-ticker', '');
    return () => root.removeAttribute('data-site-ticker');
  }, [shown]);

  if (!shown) return null;
  // `order-first`: drawn above the header although it follows it in the DOM (see above).
  return <NewsBand items={items} loading={loading} className="order-first" />;
}
