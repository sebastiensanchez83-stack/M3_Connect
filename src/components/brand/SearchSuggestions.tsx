import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { CalendarDays, FileText, Loader2, Search, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LogoTile, useOrgTypeLabel } from './OrgCard';
import { WYS26_PATH, isWys26Event, wys26Upcoming } from '@/components/events/WysInvitationCard';
import { THEMES, themeForSector, getTheme } from '@/lib/themes';
import { displayCase } from '@/lib/displayCase';
import { englishCountryName } from '@/lib/countryNames';
import {
  PER_GROUP, cacheKey, cachedSuggestions, fetchSuggestions, fold, matchRank, searchWords,
  type SuggestGroup, type SuggestResults, type SuggestScope,
} from '@/lib/searchSuggestions';

/**
 * The suggestions under the search pill (SearchField `suggest`): grouped
 * (companies, articles, events and webinars, themes and sectors), the typed
 * letters in bold, and a last line "See all results for 'x'" that does what
 * Enter does. Asked from 2 characters, 200 ms after the last keystroke; a slower
 * answer to an older search is dropped (aborted, and its sequence number no
 * longer the latest).
 *
 * The list is drawn in a portal, fixed under the pill (or above it when the
 * screen has more room there), so the heroes' and the directory toolbar's
 * clipping never cuts it. SearchField owns the combobox (focus stays in the
 * field; the options are pointed at with aria-activedescendant).
 */

export interface SuggestOption {
  id: string;
  group: SuggestGroup | 'all';
  label: string;
  sub?: string;
  /** Where the option leads; none for "See all results" (the field's own submit). */
  href?: string;
  visual: { kind: 'logo'; src: string | null; name: string; type: string | null } | { kind: 'icon'; icon: LucideIcon };
}

export interface SuggestSection {
  group: SuggestGroup;
  title: string;
  options: SuggestOption[];
}

const WYS_DATE = '2026-11-27T10:00:00+04:00';

/* ─── Data ───────────────────────────────────────────────────────── */

/**
 * The sections for `query`. `enabled` is false while the field is not in use:
 * nothing is asked then. `loading` is true while an answer for the current
 * letters is on its way (the previous sections stay on screen meanwhile).
 */
export function useSuggestionSections({
  query,
  groups,
  scope,
  enabled,
}: {
  query: string;
  groups: readonly SuggestGroup[];
  scope: SuggestScope;
  enabled: boolean;
}): { sections: SuggestSection[]; loading: boolean; settled: boolean; ready: boolean } {
  const { t } = useTranslation();
  const typeLabel = useOrgTypeLabel();
  const q = query.trim();
  const ready = enabled && groups.length > 0 && q.length >= 2;
  const groupsKey = groups.join(',');
  const key = ready ? cacheKey(q, groups, scope) : '';
  const [state, setState] = useState<{ key: string; q: string; results: SuggestResults | null; failed: boolean }>({
    key: '',
    q: '',
    results: null,
    failed: false,
  });
  const seq = useRef(0);

  useEffect(() => {
    if (!ready) return;
    const hit = cachedSuggestions(key);
    if (hit) {
      seq.current += 1;
      setState({ key, q, results: hit, failed: false });
      return;
    }
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      const id = ++seq.current;
      fetchSuggestions(q, groups, scope, ctrl.signal).then(
        (results) => {
          if (id !== seq.current || ctrl.signal.aborted) return;
          setState({ key, q, results, failed: false });
        },
        () => {
          if (id !== seq.current || ctrl.signal.aborted) return;
          setState((s) => ({ ...s, key, q, failed: true }));
        },
      );
    }, 200);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
    // groups is read through groupsKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key, groupsKey, scope]);

  const results = state.results;
  const shownQ = state.q;
  const sections = useMemo<SuggestSection[]>(() => {
    if (!ready) return [];
    const date = (iso: string | null, timeZone?: string) => {
      if (!iso) return '';
      try {
        return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone }).format(new Date(iso));
      } catch {
        return '';
      }
    };
    // Themes are local: they follow every letter at once. The rest follows the last answer.
    const words = searchWords(q);
    const hasAll = (text: string) => {
      const f = fold(text);
      return words.length > 0 && words.every((w) => f.includes(w));
    };
    const out: SuggestSection[] = [];
    // An answer to fewer letters still on screen while the next one is on its way: what no longer matches goes at once.
    const stale = searchWords(shownQ).join(' ') !== words.join(' ');
    const keep = (label: string) => !stale || hasAll(label);

    for (const g of groups) {
      if (g === 'companies' && results) {
        const options: SuggestOption[] = results.companies.filter((o) => keep(o.name)).map((o) => {
          const name = displayCase(o.name) || o.name;
          return {
            id: `company-${o.id}`,
            group: 'companies',
            label: name,
            sub: [o.organization_type ? typeLabel(o.organization_type) : '', englishCountryName(o.country || o.headquarters_country)].filter(Boolean).join(' · '),
            href: `/organizations/${o.slug}`,
            visual: { kind: 'logo', src: o.logo_url, name, type: o.organization_type },
          };
        });
        if (options.length) out.push({ group: g, title: t('brand.suggest.companies', 'Companies'), options });
      }

      if (g === 'articles' && results) {
        const kind = (type: string | null) =>
          ({ replay: t('brand.news.replay', 'Replay'), guide: t('brand.news.guide', 'Guide'), whitepaper: t('brand.news.whitepaper', 'White paper') } as Record<string, string>)[(type ?? '').toLowerCase()]
          ?? t('brand.news.article', 'Article');
        const options: SuggestOption[] = results.articles.filter((r) => keep(r.title)).map((r) => ({
          id: `article-${r.id}`,
          group: 'articles',
          label: r.title,
          sub: [kind(r.type), date(r.published_at)].filter(Boolean).join(' · '),
          href: `/resources/${r.id}`,
          visual: { kind: 'icon', icon: FileText },
        }));
        if (options.length) out.push({ group: g, title: t('brand.suggest.articles', 'Articles'), options });
      }

      if (g === 'events' && results) {
        type Ev = SuggestOption & { at: number };
        const now = Date.now();
        const wysOption = (): Ev => ({
          id: 'event-wys26',
          group: 'events',
          at: Date.parse(WYS_DATE),
          label: t('brand.events.wys.title', 'World Yachting Summit'),
          sub: [t('brand.news.event', 'Event'), t('brand.events.wys.place', 'Dubai'), date(WYS_DATE, 'Asia/Dubai'), t('brand.board.statusInvitation', 'By invitation')].join(' · '),
          href: WYS26_PATH,
          visual: { kind: 'icon', icon: CalendarDays },
        });
        const evs: Ev[] = [];
        for (const e of results.events) {
          if (!keep(e.title)) continue;
          if (isWys26Event(e.title)) {
            if (!evs.some((x) => x.id === 'event-wys26')) evs.push(wysOption());
            continue;
          }
          const webinar = (e.event_type ?? '').toLowerCase() === 'webinar';
          evs.push({
            id: `event-${e.id}`,
            group: 'events',
            at: Date.parse(e.date_time),
            label: e.title,
            sub: [webinar ? t('brand.news.webinar', 'Webinar') : t('brand.news.event', 'Event'), date(e.date_time)].filter(Boolean).join(' · '),
            href: `/events/${e.id}`,
            visual: { kind: 'icon', icon: CalendarDays },
          });
        }
        // The Summit has no listed row (one page, /wys26): it answers to its name, "WYS" and "Dubai".
        if (wys26Upcoming(now) && !evs.some((x) => x.id === 'event-wys26') && hasAll('World Yachting Summit 2026 WYS Dubai')) evs.push(wysOption());
        evs.sort((a, b) => {
          const ua = a.at >= now ? 0 : 1;
          const ub = b.at >= now ? 0 : 1;
          return ua - ub || (ua === 0 ? a.at - b.at : b.at - a.at);
        });
        const options = evs.slice(0, PER_GROUP).map(({ at: _at, ...o }) => o);
        if (options.length) out.push({ group: g, title: t('brand.suggest.events', 'Events and webinars'), options });
      }

      if (g === 'themes') {
        const options: (SuggestOption & { r: number })[] = [];
        for (const th of THEMES) {
          const label = t(th.labelKey, th.fallback);
          if (hasAll(label)) {
            options.push({
              id: `theme-${th.key}`,
              group: 'themes',
              r: matchRank(label, q),
              label,
              sub: t('brand.suggest.themeSub', 'Theme · companies in the directory'),
              href: `/directory?theme=${th.key}`,
              visual: { kind: 'icon', icon: th.icon },
            });
          }
        }
        for (const s of results?.sectors ?? []) {
          const label = t(`sectorNames.${s.slug}`, s.label);
          const key = themeForSector(s.slug);
          const theme = getTheme(key);
          if (!theme || !(hasAll(label) || hasAll(s.label))) continue;
          options.push({
            id: `sector-${s.slug}`,
            group: 'themes',
            // The themes (the six doors) come before the finer sectors.
            r: 10 + matchRank(label, q),
            label,
            sub: t('brand.suggest.sectorSub', { theme: t(theme.labelKey, theme.fallback), defaultValue: 'Sector · in {{theme}}' }),
            // The directory opens the theme with this one sector selected (DirectoryPage reads ?theme=&sector=).
            href: `/directory?theme=${theme.key}&sector=${encodeURIComponent(s.slug)}`,
            visual: { kind: 'icon', icon: theme.icon },
          });
        }
        options.sort((a, b) => a.r - b.r);
        const list = options.slice(0, PER_GROUP).map(({ r: _r, ...o }) => o);
        if (list.length) out.push({ group: g, title: t('brand.suggest.themes', 'Themes and sectors'), options: list });
      }
    }
    return out;
    // typeLabel only reads `t`; shownQ marks a new answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, q, results, shownQ, groupsKey, t]);

  const settled = ready && state.key === key && (state.results !== null || state.failed);
  return { sections, loading: ready && !settled, settled, ready };
}

/* ─── Highlight ──────────────────────────────────────────────────── */

/** The label with every typed word in bold (accents and case ignored). */
export function Highlight({ text, query }: { text: string; query: string }) {
  const words = searchWords(query).filter((w) => w.length > 0);
  if (!words.length) return <>{text}</>;
  const chars = Array.from(text);
  const folded = chars.map((c) => fold(c));
  const starts: number[] = [];
  let joined = '';
  for (const f of folded) {
    starts.push(joined.length);
    joined += f;
  }
  const marked = new Array<boolean>(chars.length).fill(false);
  const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);
  for (const w of words) {
    // Where the word starts a word of the label ("mar" in "Smart marina": "marina" only, not "smart");
    // when it never does, its first appearance.
    const all: number[] = [];
    for (let from = 0; ; ) {
      const at = joined.indexOf(w, from);
      if (at < 0) break;
      all.push(at);
      from = at + w.length;
    }
    const atStart = all.filter((at) => !isWordChar(joined[at - 1]));
    for (const at of atStart.length ? atStart : all.slice(0, 1)) {
      const end = at + w.length;
      for (let i = 0; i < chars.length; i++) {
        const s = starts[i];
        const e = s + folded[i].length;
        if (e > at && s < end) marked[i] = true;
      }
    }
  }
  const parts: ReactNode[] = [];
  let i = 0;
  while (i < chars.length) {
    const on = marked[i];
    let j = i;
    while (j < chars.length && marked[j] === on) j++;
    const piece = chars.slice(i, j).join('');
    parts.push(on ? <mark key={i} className="bg-transparent font-semibold text-navy">{piece}</mark> : <span key={i}>{piece}</span>);
    i = j;
  }
  return <>{parts}</>;
}

/* ─── Popup ──────────────────────────────────────────────────────── */

type Placement = { left: number; width: number; top?: number; bottom?: number; maxHeight: number };

/** Fixed coordinates under (or over) the anchor, followed on scroll, resize and the phone keyboard. */
function useAnchoredPlacement(anchorRef: RefObject<HTMLElement>, open: boolean): Placement | null {
  const [place, setPlace] = useState<Placement | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vv = window.visualViewport;
      const viewBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      // The field has scrolled out of sight: the list waits for it to come back.
      if (r.bottom < 0 || r.top > viewBottom) {
        setPlace(null);
        return;
      }
      const vw = document.documentElement.clientWidth;
      const width = Math.min(Math.max(r.width, 320), vw - 16);
      const left = Math.min(Math.max(8, r.left), vw - 8 - width);
      const below = viewBottom - r.bottom - 16;
      const above = r.top - 16;
      const next: Placement =
        below < 240 && above > below
          ? { left, width, bottom: window.innerHeight - r.top + 8, maxHeight: Math.min(above - 8, 520) }
          : { left, width, top: r.bottom + 8, maxHeight: Math.min(Math.max(below - 8, 168), 520) };
      setPlace((p) =>
        p && p.left === next.left && p.width === next.width && p.top === next.top && p.bottom === next.bottom && p.maxHeight === next.maxHeight ? p : next,
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true, capture: true });
    window.addEventListener('resize', schedule, { passive: true });
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
    };
  }, [open, anchorRef]);
  return place;
}

function OptionVisual({ visual }: { visual: SuggestOption['visual'] }) {
  if (visual.kind === 'logo') return <LogoTile src={visual.src} name={visual.name} type={visual.type} size={36} />;
  const Icon = visual.icon;
  return (
    <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-field bg-chip text-navy">
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
}

export function SuggestionPopup({
  anchorRef,
  popupRef,
  open,
  listboxId,
  optionId,
  sections,
  seeAll,
  query,
  activeIndex,
  loading,
  settled,
  label,
  onChoose,
  onActivate,
}: {
  anchorRef: RefObject<HTMLElement>;
  popupRef: RefObject<HTMLDivElement>;
  open: boolean;
  listboxId: string;
  optionId: (index: number) => string;
  sections: SuggestSection[];
  /** The last option: "See all results for 'x'". */
  seeAll: SuggestOption;
  query: string;
  activeIndex: number;
  loading: boolean;
  settled: boolean;
  label: string;
  onChoose: (option: SuggestOption) => void;
  onActivate: (index: number) => void;
}) {
  const { t } = useTranslation();
  const place = useAnchoredPlacement(anchorRef, open);
  const listRef = useRef<HTMLDivElement>(null);

  // The option chosen with the arrow keys stays in view.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, optionId]);

  if (!open || !place || typeof document === 'undefined') return null;
  const count = sections.reduce((n, s) => n + s.options.length, 0);
  let index = -1;

  const renderOption = (o: SuggestOption, isSeeAll = false) => {
    index += 1;
    const i = index;
    const active = i === activeIndex;
    return (
      <div
        key={o.id}
        id={optionId(i)}
        role="option"
        aria-selected={active}
        // Focus stays in the field: the pointer never takes it.
        onMouseDown={(e) => e.preventDefault()}
        onMouseMove={() => {
          if (!active) onActivate(i);
        }}
        onClick={() => onChoose(o)}
        className={cn(
          'flex min-h-12 cursor-pointer items-center gap-3 rounded-field px-3 py-1.5 text-left transition-colors',
          active ? 'bg-chip' : 'hover:bg-page',
          isSeeAll && 'min-h-11',
        )}
      >
        {isSeeAll ? (
          <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-field bg-navy text-white">
            <Search className="h-4 w-4" />
          </span>
        ) : (
          <OptionVisual visual={o.visual} />
        )}
        <span className="min-w-0 flex-1">
          <span className={cn('block text-[15px] leading-5 text-ink', isSeeAll ? 'font-medium text-navy' : 'line-clamp-2')}>
            {isSeeAll ? o.label : <Highlight text={o.label} query={query} />}
          </span>
          {o.sub && <span className="mt-0.5 block truncate text-[13px] leading-[18px] text-meta">{o.sub}</span>}
        </span>
      </div>
    );
  };

  return createPortal(
    <div
      ref={popupRef}
      className="fixed z-[45] flex flex-col overflow-hidden rounded-card border border-rule bg-white text-ink shadow-drawer"
      style={{ left: place.left, width: place.width, top: place.top, bottom: place.bottom, maxHeight: place.maxHeight }}
    >
      <div ref={listRef} id={listboxId} role="listbox" aria-label={label} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
        {sections.map((s) => {
          const headingId = `${listboxId}-${s.group}`;
          return (
            <div key={s.group} role="presentation" className="pb-1">
              <span id={headingId} role="presentation" className="text-meta-caps block px-3 pb-1 pt-2.5">
                {s.title}
              </span>
              <div role="group" aria-labelledby={headingId}>
                {s.options.map((o) => renderOption(o))}
              </div>
            </div>
          );
        })}
        {count === 0 && (
          <p role="presentation" className="flex items-center gap-2 px-3 py-3 text-[14px] leading-5 text-meta">
            {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {loading
              ? t('brand.suggest.searching', 'Searching…')
              : settled
                ? t('brand.suggest.none', 'No suggestions. Try another spelling, or see all results.')
                : null}
          </p>
        )}
        <div role="presentation" className={cn(count > 0 && 'mt-1 border-t border-rule pt-1.5')}>
          {renderOption(seeAll, true)}
        </div>
      </div>
    </div>,
    document.body,
  );
}
