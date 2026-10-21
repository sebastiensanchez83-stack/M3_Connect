import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { LucideIcon } from 'lucide-react';
import {
  Anchor, Building2, Calendar, CheckCircle2, ClipboardList, Flag, Inbox, Link2, Info, Mail, Plus, RefreshCw,
  TrendingUp, UserCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { ActionCue, CardLink } from '@/components/home/dashboard/DashboardKit';
import { AdminLoading, AdminPageHeader, AdminPanel, AdminSectionLabel, AdminStatusPill, ADMIN_BTN, ADMIN_BTN_PRIMARY } from '../AdminUI';
import { useReviewCount } from '../reviewQueueCount';
import { regSourceText } from '../events/registrationCounts';
import {
  SITE_HEALTH_PATH, loadContent, loadFigures, loadHealthLine, loadQueue, loadUpcomingEvents,
  type ContentItem, type Figure, type HealthLine, type QueueItem, type QueueKey, type UpcomingEvent,
} from './homeData';
import { formatAgo, formatWhen } from '../v2/inboxApi';
import { MarketTab } from './MarketTab';

/**
 * The admin home (/admin), Victor's proposal of 21 Oct 2026: first what waits for an action,
 * each with its count and a pill that says where it leads; then the week's figures, TRUE and
 * with their source (on hover, and written out under them for phones); the next events with
 * their real registrations (every registration system); the content. A second tab, Market,
 * holds what was Industry Pulse.
 *
 * Everything that can be pressed carries the dashboard's pill (ActionCue / CardLink) at rest;
 * figures that cannot be pressed have none. Moderators see the queue and the content they can
 * act on, never the figures or the money.
 */

const QUEUE_ICON: Record<QueueKey, LucideIcon> = {
  accounts: UserCheck,
  companies: Building2,
  event_requests: Mail,
  reports: Flag,
  contact: Inbox,
  needs: Anchor,
  leads: Link2,
};

type Tab = 'today' | 'market';

function QueueCard({ item }: { item: QueueItem }) {
  const Icon = QUEUE_ICON[item.kind];
  const inner = (
    <>
      <span className="flex min-w-0 flex-1 items-start gap-4">
        <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-gold text-navy">
          <Icon className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] font-semibold leading-6 text-navy [overflow-wrap:anywhere]">{item.title}</span>
          <span className="mt-0.5 block text-[14px] leading-5 text-meta">{item.line}</span>
        </span>
      </span>
      {item.to && <ActionCue className="ml-[60px] self-start sm:ml-0 sm:self-auto">{item.cue}</ActionCue>}
    </>
  );
  const cls = 'flex flex-col gap-3 rounded-card border bg-white p-4 sm:flex-row sm:items-center sm:gap-5';
  if (!item.to) return <li className={cn(cls, 'border-rule')} title={item.source}>{inner}</li>;
  return (
    <li>
      <Link
        to={item.to}
        title={item.source}
        className={cn(cls, 'group border-gold/70 transition-[box-shadow,border-color] duration-200 hover:border-navy/40 hover:shadow-hover focus:outline-none focus-visible:shadow-focus motion-reduce:transition-none')}
      >
        {inner}
      </Link>
    </li>
  );
}

function FigureCard({ f }: { f: Figure }) {
  return (
    <div title={f.source} className="rounded-card border border-rule bg-white p-4">
      <p className="text-[26px] font-semibold leading-8 tabular-nums tracking-[-0.01em] text-navy">{f.value ?? '—'}</p>
      <p className="mt-1 text-[14px] font-semibold leading-5 text-navy">{f.label}</p>
      {f.hint && <p className="mt-0.5 text-[12px] leading-4 text-meta">{f.hint}</p>}
    </div>
  );
}

/**
 * "Site health: 42 of 42 checks fine ->" under the greeting: what the monitor's last automatic
 * run found, as a pill that opens Site health. Orange when a check is worth a look or the
 * monitor looks stopped, red when one fails. Left out when the runs cannot be read.
 */
function HealthLineLink({ h }: { h: HealthLine }) {
  const { t } = useTranslation();
  const tone = h.fail ? 'bg-red-600' : h.warn || h.late ? 'bg-amber-500' : 'bg-teal';
  const text = h.late
    ? t('adminHome.health.late', 'Site health: the monitor last ran {{ago}}', { ago: formatAgo(h.runAt) })
    : h.fail
      ? t('adminHome.health.fail', { count: h.fail, defaultValue_one: 'Site health: {{count}} check failing', defaultValue_other: 'Site health: {{count}} checks failing' })
      : h.warn
        ? t('adminHome.health.warn', { count: h.warn, n: h.total, defaultValue_one: 'Site health: {{count}} of {{n}} checks worth a look', defaultValue_other: 'Site health: {{count}} of {{n}} checks worth a look' })
        : t('adminHome.health.ok', 'Site health: {{ok}} of {{n}} checks fine', { ok: h.ok, n: h.total });
  return (
    <Link
      to={SITE_HEALTH_PATH}
      title={t('adminHome.health.title', 'Last automatic check: {{when}}', { when: formatWhen(h.runAt) })}
      className="group inline-flex max-w-full rounded-pill focus:outline-none focus-visible:shadow-focus"
    >
      <ActionCue size="sm">
        <span aria-hidden="true" className={cn('mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle', tone)} />
        {text}
      </ActionCue>
    </Link>
  );
}

function eventCountLine(e: UpcomingEvent, t: TFunction): string {
  const c = e.counts;
  if (!c || c.registered === null) return t('adminHome.events.noCount', 'The registrations could not be counted.');
  const parts = [
    c.capacity
      ? t('adminHome.events.registeredCap', '{{n}} / {{cap}} registered', { n: c.registered, cap: c.capacity })
      : t('adminHome.events.registered', '{{n}} registered', { n: c.registered }),
  ];
  if (c.waiting) parts.push(t('adminHome.events.waiting', '{{n}} waiting for an answer', { n: c.waiting }));
  if (c.invited) parts.push(t('adminHome.events.invited', '{{n}} invited, no answer yet', { n: c.invited }));
  return parts.join(' · ');
}

function Section({ title, icon, actions, children }: { title: ReactNode; icon?: LucideIcon; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <AdminSectionLabel icon={icon} actions={actions} className="mb-0">{title}</AdminSectionLabel>
      {children}
    </section>
  );
}

export function AdminHome() {
  const { t } = useTranslation();
  const { isAdmin, profile } = useAuth();
  const { refresh: refreshReviewCount } = useReviewCount();
  const [params, setParams] = useSearchParams();
  const tab: Tab = isAdmin && params.get('tab') === 'market' ? 'market' : 'today';

  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [figures, setFigures] = useState<Figure[] | null>(null);
  const [events, setEvents] = useState<UpcomingEvent[] | null | 'error'>(null);
  const [content, setContent] = useState<ContentItem[] | null>(null);
  const [health, setHealth] = useState<HealthLine | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    await Promise.all([
      loadQueue(isAdmin).then(setQueue).catch(() => setQueue([])),
      isAdmin ? loadFigures().then(setFigures).catch(() => setFigures([])) : Promise.resolve(),
      isAdmin ? loadUpcomingEvents().then(r => setEvents(r ?? 'error')).catch(() => setEvents('error')) : Promise.resolve(),
      loadContent(isAdmin).then(setContent).catch(() => setContent([])),
      loadHealthLine().then(setHealth).catch(() => setHealth(null)),
    ]);
    setBusy(false);
  }, [isAdmin]);

  useEffect(() => { void load(); }, [load]);

  const setTab = (next: Tab) => {
    const p = new URLSearchParams(params);
    if (next === 'market') p.set('tab', 'market'); else p.delete('tab');
    setParams(p, { replace: true });
  };

  const tabBtn = (value: Tab, label: string, Icon: LucideIcon) => {
    const active = tab === value;
    return (
      <button
        type="button"
        role="tab"
        aria-selected={active}
        onClick={() => setTab(value)}
        className={cn(
          'inline-flex min-h-11 items-center gap-2 rounded-pill border px-4 text-[15px] font-semibold transition-colors focus:outline-none focus-visible:shadow-focus',
          active ? 'border-navy bg-navy text-white' : 'border-navy/55 bg-white text-navy hover:border-navy hover:bg-chip',
        )}
      >
        <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
        {label}
      </button>
    );
  };

  const first = profile?.first_name?.trim();
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="space-y-6">
      <AdminPageHeader
        className="mb-0"
        title={first ? t('adminHome.hello', 'Hello {{name}}', { name: first }) : t('adminHome.title', 'To do today')}
        description={t('adminHome.description', 'First what is waiting for M3, then the figures of the week. {{date}}.', { date: today })}
        meta={health ? <HealthLineLink h={health} /> : undefined}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={ADMIN_BTN}
              onClick={() => { refreshReviewCount(); void load(); }}
              disabled={busy}
            >
              <RefreshCw className={cn('mr-2 h-4 w-4', busy && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
              {t('adminHome.refresh', 'Refresh')}
            </Button>
            {isAdmin && (
              <Button asChild variant="secondary" size="sm" className={ADMIN_BTN_PRIMARY}>
                <Link to="/admin/events/new?type=on_site&editor=new">
                  <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {t('adminHome.createEvent', 'Create an event')}
                </Link>
              </Button>
            )}
          </>
        }
      />

      {isAdmin && (
        <div role="tablist" aria-label={t('adminHome.tabs', 'Home views')} className="flex flex-wrap gap-2">
          {tabBtn('today', t('adminHome.tabToday', 'To do today'), ClipboardList)}
          {tabBtn('market', t('adminHome.tabMarket', 'Market'), TrendingUp)}
        </div>
      )}

      {tab === 'market' ? <MarketTab /> : (
        <>
          {/* 1. What waits for an action */}
          <Section title={t('adminHome.queue', 'To do today')}>
            {queue === null ? <AdminLoading className="h-32" /> : queue.length === 0 ? (
              <div className="flex items-center gap-4 rounded-card border border-rule bg-white p-4">
                <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-foam text-teal">
                  <CheckCircle2 className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-[17px] font-semibold leading-6 text-navy">{t('adminHome.nothing', 'Nothing is waiting')}</span>
                  <span className="block text-[14px] leading-5 text-meta">{t('adminHome.nothingBody', 'Every account, request and message has been handled.')}</span>
                </span>
              </div>
            ) : (
              <ul className="space-y-2.5">{queue.map(item => <QueueCard key={item.key} item={item} />)}</ul>
            )}
          </Section>

          {/* 2. The week's figures (admins only: the money is staff-only) */}
          {isAdmin && (
            <Section title={t('adminHome.week', 'The platform this week')}>
              {figures === null ? <AdminLoading className="h-28" /> : (
                <>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                    {figures.map(f => <FigureCard key={f.key} f={f} />)}
                  </div>
                  {figures.length > 0 && (
                    <details className="group rounded-card border border-rule bg-white px-4 py-2.5 text-[13px] leading-5 text-meta">
                      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 font-semibold text-navy [&::-webkit-details-marker]:hidden">
                        <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
                        {t('adminHome.sources', 'Where these figures come from')}
                        <span className="ml-auto rounded-pill border border-navy/55 px-3 py-0.5 text-[13px] group-open:hidden">{t('adminHome.show', 'Show')}</span>
                        <span className="ml-auto hidden rounded-pill border border-navy/55 px-3 py-0.5 text-[13px] group-open:inline">{t('adminHome.hide', 'Hide')}</span>
                      </summary>
                      <ul className="mt-2 space-y-1.5 pb-1">
                        {figures.map(f => (
                          <li key={f.key}><span className="font-semibold text-navy">{f.label}: </span>{f.source}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </>
              )}
            </Section>
          )}

          <div className={cn('grid gap-5', isAdmin && 'lg:grid-cols-2')}>
            {/* 3. Next events, with their real registrations */}
            {isAdmin && (
              <AdminPanel
                icon={Calendar}
                title={t('adminHome.events', 'Upcoming events')}
                actions={<CardLink to="/admin/events">{t('adminHome.allEvents', 'All events')}</CardLink>}
                padded={false}
              >
                {events === null ? <AdminLoading className="h-32" /> : events === 'error' ? (
                  <p className="px-5 py-4 text-[14px] text-meta">{t('adminHome.events.error', 'The events could not be loaded. Press Refresh to try again.')}</p>
                ) : events.length === 0 ? (
                  <p className="px-5 py-4 text-[14px] text-meta">{t('adminHome.events.none', 'No event is planned.')}</p>
                ) : (
                  <ul className="divide-y divide-rule">
                    {events.map(e => (
                      <li key={e.id}>
                        <Link
                          to={e.counts?.manageUrl ?? `/admin/events/${e.id}`}
                          title={e.counts ? regSourceText(e.counts) : undefined}
                          className="group flex flex-col gap-2 px-5 py-3.5 transition-colors hover:bg-page focus:outline-none focus-visible:shadow-focus sm:flex-row sm:items-center sm:gap-4"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="text-[15px] font-semibold leading-5 text-navy [overflow-wrap:anywhere]">{e.title}</span>
                              {e.published === false && <AdminStatusPill tone="warning">{t('adminHome.events.draft', 'Draft')}</AdminStatusPill>}
                            </span>
                            <span className="mt-0.5 block text-[13px] leading-5 text-meta">
                              {[
                                e.date_time ? new Date(e.date_time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null,
                                e.location,
                              ].filter(Boolean).join(' · ')}
                            </span>
                            <span className="mt-0.5 block text-[14px] font-semibold leading-5 tabular-nums text-navy">{eventCountLine(e, t)}</span>
                          </span>
                          <ActionCue size="sm">{t('adminHome.events.manage', 'Manage the registrations')}</ActionCue>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </AdminPanel>
            )}

            {/* 4. Content */}
            <AdminPanel icon={ClipboardList} title={t('adminHome.content', 'Content')} padded={false}>
              {content === null ? <AdminLoading className="h-32" /> : (
                <ul className="divide-y divide-rule">
                  {content.map(c => (
                    <li key={c.key}>
                      <Link
                        to={c.to}
                        title={c.source}
                        className="group flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 transition-colors hover:bg-page focus:outline-none focus-visible:shadow-focus"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-[14px] leading-5 text-meta">{c.label}</span>
                          <span className="block text-[17px] font-semibold leading-6 tabular-nums text-navy [overflow-wrap:anywhere]">{c.value ?? '—'}</span>
                        </span>
                        <ActionCue size="sm">{c.cue}</ActionCue>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </AdminPanel>
          </div>
        </>
      )}
    </div>
  );
}
