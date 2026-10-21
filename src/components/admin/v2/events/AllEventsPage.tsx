import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CalendarDays, FlaskConical, MapPin, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ActionCue } from '@/components/home/dashboard/DashboardKit';
import type { EventRegistrationCount } from '@/components/admin/events/registrationCounts';
import { regSourceText } from '@/components/admin/events/registrationCounts';
import { cn } from '@/lib/utils';
import {
  AdminEmpty, AdminFilterBar, AdminLoading, AdminPageHeader, AdminSectionLabel, AdminTableCard, ADMIN_BTN, ADMIN_BTN_PRIMARY,
} from '../../AdminUI';
import { Note } from '../MembersKit';
import { EventBadges } from './EventPageKit';
import {
  countWords, eventPhase, loadEventDirectory, loadSummaryCounts, shortDate, shortTime, sortEvents, SYSTEM_LABEL, type EventSummary,
} from './eventsApi';

/**
 * Events > All events (/admin/events), Victor 21 Oct 2026: EVERY event of the three systems in
 * one list (webinars and on-site events of the new and the old editor, guest lists, fairs), with
 * the real registration counts. Upcoming first, then past. Test events only with "Show test
 * events". One action per row: "Open the event", its page with the same tabs for every event.
 * Filters live in the address (?q=&type=&state=&tests=1). Desktop: a table; phone: cards.
 */

function DateTile({ e }: { e: EventSummary }) {
  const past = eventPhase(e) === 'past';
  if (!e.start) {
    return (
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-chip text-[11px] font-semibold text-meta" aria-hidden="true">TBD</span>
    );
  }
  const d = new Date(e.start);
  return (
    <span className={cn('flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl', past ? 'bg-chip' : 'bg-foam')} aria-hidden="true">
      <span className={cn('text-[15px] font-semibold leading-none tabular-nums', past ? 'text-meta' : 'text-navy')}>
        {new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Monaco', day: 'numeric' }).format(d)}
      </span>
      <span className={cn('mt-0.5 text-[10px] font-semibold uppercase leading-none', past ? 'text-meta' : 'text-teal-text')}>
        {new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Monaco', month: 'short' }).format(d)}
      </span>
    </span>
  );
}

function when(e: EventSummary): string {
  const date = shortDate(e);
  if (!date) return 'Date to be set';
  const time = shortTime(e);
  return time ? `${date}, ${time}` : date;
}

export function AllEventsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [list, setList] = useState<EventSummary[] | null>(null);
  const [counts, setCounts] = useState<Record<string, EventRegistrationCount>>({});
  const [countsReady, setCountsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const q = params.get('q') || '';
  const type = params.get('type') || 'all';
  const state = params.get('state') || 'all';
  const tests = params.get('tests') === '1';

  const set = (key: string, value: string) => setParams(prev => {
    const next = new URLSearchParams(prev);
    if (!value || value === 'all') next.delete(key); else next.set(key, value);
    return next;
  }, { replace: true });

  useEffect(() => {
    let alive = true;
    loadEventDirectory()
      .then(async rows => {
        if (!alive) return;
        setList(rows);
        const c = await loadSummaryCounts(rows);
        if (alive) { setCounts(c); setCountsReady(true); }
      })
      .catch((e: unknown) => {
        if (alive) { setList([]); setError(e instanceof Error ? e.message : 'The events could not be loaded.'); }
      });
    return () => { alive = false; };
  }, []);

  const testCount = (list ?? []).filter(e => e.test).length;
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (list ?? []).filter(e => {
      if (e.test && !tests) return false;
      if (needle && ![e.title, e.place, SYSTEM_LABEL[e.system]].some(v => (v ?? '').toLowerCase().includes(needle))) return false;
      if (type !== 'all' && e.kind !== type) return false;
      if (state === 'published' && e.published === false) return false;
      if (state === 'draft' && e.published !== false) return false;
      return true;
    });
  }, [list, q, type, state, tests]);
  const { upcoming, past } = useMemo(() => sortEvents(filtered), [filtered]);

  if (!list) return <AdminLoading />;

  const filtersOn = !!q || type !== 'all' || state !== 'all';
  const visibleTotal = (list ?? []).filter(e => tests || !e.test).length;

  const counted = (e: EventSummary) => {
    const c = counts[e.key];
    if (!countsReady) return <span className="text-meta">…</span>;
    return <span title={c ? regSourceText(c) : 'The figures could not be read.'}>{countWords(c)}</span>;
  };

  const section = (title: string, rows: EventSummary[]) => rows.length > 0 && (
    <section className="space-y-3" aria-label={title}>
      <AdminSectionLabel>{title} ({rows.length})</AdminSectionLabel>

      {/* Phone: one card per event */}
      <ul className="space-y-3 md:hidden">
        {rows.map(e => (
          <li key={e.key}>
            <Link to={e.href} className="group block rounded-card border border-rule bg-white p-4 focus:outline-none focus-visible:shadow-focus">
              <div className="flex items-start gap-3">
                <DateTile e={e} />
                <div className="min-w-0 flex-1">
                  <p className="text-[16px] font-semibold leading-6 text-navy [overflow-wrap:anywhere]">{e.title}</p>
                  <p className="text-[13px] leading-5 text-meta">{[when(e), e.place].filter(Boolean).join(' · ')}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5"><EventBadges e={e} /></div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <span className="text-[13px] tabular-nums text-ink">{counted(e)}</span>
                <ActionCue size="sm">{t('adminEventsV2.list.open', 'Open the event')}</ActionCue>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {/* Desktop: the table */}
      <AdminTableCard className="hidden md:block">
        <table className="w-full">
          <thead>
            <tr>
              <th className="text-left">{t('adminEventsV2.list.colEvent', 'Event')}</th>
              <th className="text-left">{t('adminEventsV2.list.colWhen', 'When')}</th>
              <th className="text-left">{t('adminEventsV2.list.colPlace', 'Place')}</th>
              <th className="text-left">{t('adminEventsV2.list.colRegs', 'Registrations')}</th>
              <th className="text-left"><span className="sr-only">{t('adminEventsV2.list.open', 'Open the event')}</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(e => (
              <tr key={e.key} className="group cursor-pointer" onClick={() => navigate(e.href)}>
                <td>
                  <div className="flex items-center gap-3">
                    <DateTile e={e} />
                    <div className="min-w-0">
                      <Link to={e.href} onClick={ev => ev.stopPropagation()} className="rounded-sm font-semibold text-navy focus:outline-none focus-visible:shadow-focus">
                        <span className="card-ul">{e.title}</span>
                      </Link>
                      <div className="mt-1 flex flex-wrap gap-1.5"><EventBadges e={e} /></div>
                    </div>
                  </div>
                </td>
                <td className="whitespace-nowrap text-sm text-ink">{when(e)}</td>
                <td className="text-sm text-ink">
                  {e.place ? (
                    <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5 shrink-0 text-meta" aria-hidden="true" />{e.place}</span>
                  ) : <span className="text-meta">{e.kind === 'webinar' ? 'Online' : '—'}</span>}
                </td>
                <td className="text-sm tabular-nums text-ink">{counted(e)}</td>
                <td className="text-right"><ActionCue size="sm" className="whitespace-nowrap">{t('adminEventsV2.list.open', 'Open the event')}</ActionCue></td>
              </tr>
            ))}
          </tbody>
        </table>
      </AdminTableCard>
    </section>
  );

  return (
    <div>
      <AdminPageHeader
        title={t('adminEventsV2.list.title', 'All events')}
        count={visibleTotal}
        description={t('adminEventsV2.list.desc', 'Every event in one list: webinars, on-site events, guest lists and fairs, with their real registrations. Press an event to open its page.')}
        actions={
          <Button asChild variant="secondary" size="sm" className={ADMIN_BTN_PRIMARY}>
            <Link to="/admin/events/new"><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />{t('adminEventsV2.list.create', 'Create an event')}</Link>
          </Button>
        }
      />

      {error && <div className="mb-4"><Note tone="warning">{t('adminEventsV2.list.error', 'The events could not be loaded: {{msg}}', { msg: error })}</Note></div>}

      <AdminFilterBar
        search={q}
        onSearchChange={v => set('q', v)}
        searchPlaceholder={t('adminEventsV2.list.search', 'Search an event or a place…')}
        trailing={(
          <>
            {filtersOn && (
              <Button type="button" variant="outline" className={ADMIN_BTN} onClick={() => setParams(tests ? { tests: '1' } : {}, { replace: true })}>
                {t('adminEventsV2.list.clear', 'Show every event')}
              </Button>
            )}
            {testCount > 0 && (
              <Button type="button" variant="outline" className={ADMIN_BTN} aria-pressed={tests} onClick={() => set('tests', tests ? '' : '1')}>
                <FlaskConical className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {tests
                  ? t('adminEventsV2.list.hideTests', 'Hide the test events')
                  : t('adminEventsV2.list.showTests', 'Show test events ({{n}})', { n: testCount })}
              </Button>
            )}
          </>
        )}
      >
        <Select value={type} onValueChange={v => set('type', v)}>
          <SelectTrigger className="w-full sm:w-44" aria-label={t('adminEventsV2.list.type', 'Type')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('adminEventsV2.list.allTypes', 'All types')}</SelectItem>
            <SelectItem value="onsite">{t('adminEventsV2.list.onsite', 'On-site events')}</SelectItem>
            <SelectItem value="webinar">{t('adminEventsV2.list.webinars', 'Webinars')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={state} onValueChange={v => set('state', v)}>
          <SelectTrigger className="w-full sm:w-56" aria-label={t('adminEventsV2.list.state', 'Status')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('adminEventsV2.list.allStates', 'Published and drafts')}</SelectItem>
            <SelectItem value="published">{t('adminEventsV2.list.published', 'Published only')}</SelectItem>
            <SelectItem value="draft">{t('adminEventsV2.list.drafts', 'Drafts only')}</SelectItem>
          </SelectContent>
        </Select>
      </AdminFilterBar>

      {filtered.length === 0 ? (
        <div className="rounded-card border border-rule bg-white">
          <AdminEmpty
            icon={CalendarDays}
            title={filtersOn ? t('adminEventsV2.list.noneMatch', 'No event matches these filters') : t('adminEventsV2.list.none', 'No event yet')}
            action={!filtersOn ? (
              <Button asChild variant="secondary" size="sm" className={ADMIN_BTN_PRIMARY}>
                <Link to="/admin/events/new"><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />{t('adminEventsV2.list.create', 'Create an event')}</Link>
              </Button>
            ) : undefined}
          />
        </div>
      ) : (
        <div className="space-y-8">
          {section(t('adminEventsV2.list.upcoming', 'Coming up and happening now'), upcoming)}
          {section(t('adminEventsV2.list.past', 'Past events'), past)}
        </div>
      )}
    </div>
  );
}
