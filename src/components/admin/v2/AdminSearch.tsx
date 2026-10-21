import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Building2, CalendarDays, FileText, Loader2, Search, User, X, type LucideIcon } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { fold, searchWords } from '@/lib/searchSuggestions';
import { cn } from '@/lib/utils';
import { ActionCue } from '@/components/home/dashboard/DashboardKit';
import { INBOX_PATHS } from './inboxApi';

/**
 * The admin's one search (admin refonte, 21 Oct 2026): type a name, get the companies, people,
 * events and articles it matches, and open one with a click or the keyboard (↑ ↓ Enter, Esc).
 * The admin shell places it in the admin header. Read-only queries with the staff's own rights;
 * moderators, whose screens open only articles, search articles only. Companies, events and
 * articles are matched without accents (the *_search columns, public.smc_fold), people on their
 * first name, last name and e-mail. Every result says where it leads.
 */

type Group = 'companies' | 'people' | 'events' | 'articles';

export interface SearchHit {
  key: string;
  group: Group;
  title: string;
  meta: string;
  to: string;
  /** Searched again on our side with the folded words (all must be in it). */
  hay: string;
}

const GROUP_ICON: Record<Group, LucideIcon> = { companies: Building2, people: User, events: CalendarDays, articles: FileText };
const PER_GROUP = 5;

/** One word for ILIKE: its own %, _ and \ are literal; * is dropped. */
const likeWord = (w: string) => w.replace(/\*/g, '').replace(/[\\%_]/g, (c) => `\\${c}`);
/** One word inside a PostgREST or(): only letters, digits and @ . - ' are kept. */
const orWord = (w: string) => w.replace(/[^\p{L}\p{N}@.\-']/gu, '');

const ORG_TYPE: Record<string, string> = {
  marina: 'Marina', partner: 'Service provider', investor: 'Investor', developer: 'Developer',
  media_partner: 'Media', individual: 'Individual',
};
const PERSONA: Record<string, string> = {
  marina: 'Marina', partner: 'Service provider', investor: 'Investor', developer: 'Developer',
  individual: 'Individual', admin: 'M3 team (admin)', moderator: 'M3 team (moderator)',
};
const STATE: Record<string, string> = { pending: 'waiting for validation', rejected: 'refused', suspended: 'suspended' };

function dateOf(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

interface OrgRow { id: string; name: string | null; organization_type: string | null; country: string | null; access_status: string | null; archived_at: string | null }
interface PersonRow { user_id: string; first_name: string | null; last_name: string | null; email: string | null; persona: string | null; access_status: string | null }
interface EventRow { id: string; title: string | null; date_time: string | null; event_type: string | null }
interface GuestListRow { slug: string; title: string | null }
interface SmEventRow { slug: string; name: string | null }
interface ArticleRow { id: string; title: string | null; type: string | null; published: boolean | null }

/** Each folded word must be in the column (AND), as ILIKE on the column's folded copy. */
function allWords<Q extends { ilike: (col: string, pattern: string) => Q }>(qb: Q, col: string, words: string[]): Q {
  return words.reduce((b, w) => b.ilike(col, `%${likeWord(w)}%`), qb);
}

async function runSearch(q: string, articlesOnly: boolean): Promise<SearchHit[]> {
  const words = searchWords(q);
  if (!words.length) return [];
  const typed = q.normalize('NFC').toLowerCase().split(/[s,;/]+/).map(orWord).filter(Boolean).slice(0, 5);
  const personOr = (w: string) => `first_name.ilike.*${w}*,last_name.ilike.*${w}*,email.ilike.*${w}*`;

  const tasks: PromiseLike<SearchHit[]>[] = [];
  if (!articlesOnly) {
    tasks.push(allWords(supabase.from('organizations').select('id, name, organization_type, country, access_status, archived_at'), 'name_search', words)
      .order('name').limit(PER_GROUP)
      .then(({ data }) => ((data ?? []) as OrgRow[]).map((o) => ({
        key: `o-${o.id}`, group: 'companies' as const, title: o.name ?? '—', to: INBOX_PATHS.company(o.id), hay: o.name ?? '',
        meta: [ORG_TYPE[o.organization_type ?? ''] ?? 'Company', o.country, o.archived_at ? 'archived' : STATE[o.access_status ?? '']].filter(Boolean).join(' · '),
      }))));

    if (typed.length) {
      const filter = typed.length === 1 ? personOr(typed[0]) : `and(${typed.map((w) => `or(${personOr(w)})`).join(',')})`;
      tasks.push(supabase.from('profiles').select('user_id, first_name, last_name, email, persona, access_status').or(filter)
        .order('last_name').limit(PER_GROUP)
        .then(({ data }) => ((data ?? []) as PersonRow[]).map((p) => ({
          key: `p-${p.user_id}`, group: 'people' as const, title: [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email || '—',
          to: INBOX_PATHS.person(p.user_id), hay: [p.first_name, p.last_name, p.email].filter(Boolean).join(' '),
          meta: [p.email, PERSONA[p.persona ?? ''], STATE[p.access_status ?? '']].filter(Boolean).join(' · '),
        }))));
    }

    tasks.push(allWords(supabase.from('events').select('id, title, date_time, event_type'), 'title_search', words)
      .order('date_time', { ascending: false }).limit(PER_GROUP)
      .then(({ data }) => ((data ?? []) as EventRow[]).map((e) => ({
        key: `e-${e.id}`, group: 'events' as const, title: e.title ?? '—', to: `/admin/events/${e.id}`, hay: e.title ?? '',
        meta: [dateOf(e.date_time), e.event_type === 'webinar' ? 'Webinar' : e.event_type === 'on_site' ? 'On site' : null].filter(Boolean).join(' · '),
      }))));

    // The two event engines with their own consoles: guest lists (WYS) and Smart Marina (a few rows, matched here).
    tasks.push(supabase.from('gl_event').select('slug, title').eq('hidden', false).limit(20)
      .then(({ data }) => ((data ?? []) as GuestListRow[]).map((g) => ({
        key: `g-${g.slug}`, group: 'events' as const, title: g.title ?? g.slug, to: `/admin/guest-list/${g.slug}`,
        hay: `${g.title ?? ''} ${g.slug}`, meta: 'Guest list',
      }))));
    tasks.push(supabase.from('sm_event').select('slug, name').limit(10)
      .then(({ data }) => ((data ?? []) as SmEventRow[]).map((e) => ({
        key: `s-${e.slug}`, group: 'events' as const, title: e.name ?? e.slug, to: '/admin/sm26', hay: `${e.name ?? ''} ${e.slug}`, meta: 'Smart Marina console',
      }))));
  }
  tasks.push(allWords(supabase.from('resources').select('id, title, type, published'), 'title_search', words)
    .order('updated_at', { ascending: false }).limit(PER_GROUP)
    .then(({ data }) => ((data ?? []) as ArticleRow[]).map((r) => ({
      key: `r-${r.id}`, group: 'articles' as const, title: r.title ?? '—', to: INBOX_PATHS.article(r.id), hay: r.title ?? '',
      meta: [r.type ? r.type.charAt(0).toUpperCase() + r.type.slice(1) : 'Article', r.published ? 'published' : 'draft'].join(' · '),
    }))));

  const settled = await Promise.allSettled(tasks);
  const hits = settled.flatMap((x) => (x.status === 'fulfilled' ? x.value : []));
  // Our side: every folded word must be in the result (also trims the short guest-list and SM lists).
  const counts: Partial<Record<Group, number>> = {};
  return hits.filter((h) => {
    const hay = fold(h.hay);
    if (!words.every((w) => hay.includes(w))) return false;
    counts[h.group] = (counts[h.group] ?? 0) + 1;
    return (counts[h.group] ?? 0) <= PER_GROUP;
  });
}

export function AdminSearch({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const listId = useId();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const query = q.trim();

  useEffect(() => {
    if (query.length < 2) { setHits([]); setBusy(false); return; }
    const mine = ++seq.current;
    setBusy(true);
    const id = window.setTimeout(() => {
      void runSearch(query, !isAdmin).then((h) => {
        if (mine !== seq.current) return;
        setHits(h);
        setActive(0);
        setBusy(false);
      });
    }, 250);
    return () => window.clearTimeout(id);
  }, [query, isAdmin]);

  // A click outside closes the list.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const groups = useMemo(() => {
    const order: Group[] = ['companies', 'people', 'events', 'articles'];
    return order.map((g) => ({ g, items: hits.filter((h) => h.group === g) })).filter((x) => x.items.length);
  }, [hits]);
  const flat = useMemo(() => groups.flatMap((x) => x.items), [groups]);

  const go = (h: SearchHit) => {
    setOpen(false);
    setQ('');
    onNavigate?.();
    navigate(h.to);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { if (open) { e.preventDefault(); setOpen(false); } else if (q) setQ(''); return; }
    if (!flat.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => (i + 1) % flat.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); setActive((i) => (i - 1 + flat.length) % flat.length); }
    else if (e.key === 'Enter' && open) { e.preventDefault(); const h = flat[active]; if (h) go(h); }
  };

  const groupLabel: Record<Group, string> = {
    companies: t('adminSearch.companies', 'Companies'),
    people: t('adminSearch.people', 'People'),
    events: t('adminSearch.events', 'Events'),
    articles: t('adminSearch.articles', 'Articles'),
  };
  const cue: Record<Group, string> = {
    companies: t('adminSearch.openCompany', 'Company page'),
    people: t('adminSearch.openPerson', 'Person\'s page'),
    events: t('adminSearch.openEvent', 'Event'),
    articles: t('adminSearch.openArticle', 'Article'),
  };
  const showList = open && query.length >= 2;
  const optId = (i: number) => `${listId}-opt-${i}`;

  return (
    <div ref={box} className={cn('relative w-full max-w-xl', className)}>
      <label className="relative block">
        <span className="sr-only">{t('adminSearch.label', 'Search the admin')}</span>
        <Search className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-navy" aria-hidden="true" />
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && flat[active] ? optId(active) : undefined}
          autoComplete="off"
          spellCheck={false}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder={isAdmin
            ? t('adminSearch.placeholder', 'Search a company, a person, an event, an article')
            : t('adminSearch.placeholderArticles', 'Search an article')}
          className="h-11 w-full rounded-pill border border-navy/40 bg-white pl-11 pr-11 text-[15px] text-ink placeholder:text-meta hover:border-navy focus:border-navy focus:outline-none focus-visible:shadow-focus [&::-webkit-search-cancel-button]:hidden"
        />
        {busy ? (
          <Loader2 className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-meta motion-reduce:animate-none" aria-hidden="true" />
        ) : q ? (
          <button
            type="button"
            onClick={() => { setQ(''); input.current?.focus(); }}
            aria-label={t('adminSearch.clear', 'Clear the search')}
            className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-pill text-meta hover:bg-chip hover:text-navy focus:outline-none focus-visible:shadow-focus"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </label>

      {showList && (
        <div className="absolute inset-x-0 top-[calc(100%+6px)] z-50 max-h-[70vh] overflow-auto rounded-card border border-rule bg-white py-2 shadow-drawer">
          <ul id={listId} role="listbox" aria-label={t('adminSearch.results', 'Results')}>
            {groups.map(({ g, items }) => (
              <li key={g} role="presentation">
                <p className="text-meta-caps px-4 pb-1 pt-2" aria-hidden="true">{groupLabel[g]}</p>
                <ul role="group" aria-label={groupLabel[g]}>
                  {items.map((h) => {
                    const i = flat.indexOf(h);
                    const Icon = GROUP_ICON[g];
                    return (
                      <li
                        key={h.key}
                        id={optId(i)}
                        role="option"
                        aria-selected={i === active}
                        onMouseEnter={() => setActive(i)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => go(h)}
                        className={cn('group mx-2 flex min-h-12 cursor-pointer items-center gap-3 rounded-field px-2 py-1.5', i === active ? 'bg-chip' : 'hover:bg-page')}
                      >
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-field bg-foam text-navy"><Icon className="h-4 w-4" aria-hidden="true" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-semibold leading-5 text-navy">{h.title}</span>
                          {h.meta && <span className="block truncate text-[12px] leading-4 text-meta">{h.meta}</span>}
                        </span>
                        <ActionCue size="sm" className="hidden sm:inline-flex">{cue[g]}</ActionCue>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
          {!busy && flat.length === 0 && (
            <p className="px-4 py-3 text-[14px] text-meta">{t('adminSearch.none', { q: query, defaultValue: 'Nothing found for "{{q}}".' })}</p>
          )}
          {flat.length > 0 && (
            <p className="hidden border-t border-rule px-4 pt-2 text-[12px] text-meta sm:block" aria-hidden="true">
              {t('adminSearch.keys', '↑ ↓ to choose, Enter to open, Esc to close')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default AdminSearch;
