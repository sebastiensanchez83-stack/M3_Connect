import { useCallback, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ExternalLink, type LucideIcon } from 'lucide-react';
import { ActionCue } from '@/components/home/dashboard/DashboardKit';
import { cn } from '@/lib/utils';
import { AdminKpiCard, AdminPanel, AdminStatusPill } from '../../AdminUI';
import { Note } from '../MembersKit';
import { eventPhase, SYSTEM_HINT, SYSTEM_LABEL, type EventSummary } from './eventsApi';

/**
 * The pieces every event page shares (core, old system, guest list, fair), so each event
 * shows the SAME tabs in the same order and the same "press here" pills (Victor, 21 Oct 2026:
 * people who struggle with technology must see what can be pressed and where it leads).
 */

export type EventTab =
  | 'overview' | 'registrations' | 'checkin' | 'invitations' | 'emails' | 'payments' | 'modules' | 'statistics' | 'settings';

/** The tabs of every event, in Victor's order; Settings last (what was the editor's Basics, How to register…). */
export const EVENT_TABS: EventTab[] = ['overview', 'registrations', 'checkin', 'invitations', 'emails', 'payments', 'modules', 'statistics', 'settings'];

export const TAB_LABEL: Record<EventTab, string> = {
  overview: 'Overview',
  registrations: 'Registrations',
  checkin: 'Check-in',
  invitations: 'Invitations',
  emails: 'E-mails',
  payments: 'Payments',
  modules: 'Modules',
  statistics: 'Statistics',
  settings: 'Settings',
};

/** ?tab= of a page that only shows the event tabs (guest list, fair, old system). */
export function useEventTab(available: EventTab[]): [EventTab, (t: EventTab) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab') as EventTab | null;
  const tab: EventTab = raw && available.includes(raw) ? raw : available[0];
  const set = useCallback((next: EventTab) => setParams(prev => {
    const p = new URLSearchParams(prev);
    if (next === available[0]) p.delete('tab'); else p.set('tab', next);
    return p;
  }, { replace: true }), [setParams, available]);
  return [tab, set];
}

/**
 * The tabs of an event: pills that WRAP on a phone (no sideways scrolling), each saying what it
 * opens, with a count or a dot when something there needs a look.
 */
export function EventTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  size = 'md',
}: {
  tabs: { key: T; label: string; count?: number | null; dot?: 'issue' | 'changed' | null }[];
  value: T;
  onChange: (key: T) => void;
  label: string;
  size?: 'md' | 'sm';
}) {
  return (
    <div role="tablist" aria-label={label} className={cn('flex flex-wrap gap-1.5', size === 'md' ? 'mb-6 border-b border-rule pb-3' : 'mb-5')}>
      {tabs.map(tab => {
        const active = tab.key === value;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.key)}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-pill border font-semibold transition-colors focus:outline-none focus-visible:shadow-focus',
              size === 'md' ? 'h-10 px-4 text-[14px]' : 'h-9 px-3.5 text-[13px]',
              active ? 'border-navy bg-navy text-white' : 'border-navy/30 bg-white text-navy hover:border-navy hover:bg-chip',
            )}
          >
            {tab.label}
            {typeof tab.count === 'number' && (
              <span className={cn('rounded-pill px-1.5 text-[12px] leading-5 tabular-nums', active ? 'bg-white/20 text-white' : 'bg-chip text-navy')}>{tab.count}</span>
            )}
            {tab.dot && (
              <span
                className={cn('h-2 w-2 rounded-full', tab.dot === 'issue' ? 'bg-red-600' : active ? 'bg-gold' : 'bg-gold-text')}
                role="img"
                aria-label={tab.dot === 'issue' ? 'needs a look' : 'changed, not saved yet'}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/** The status pills of an event: type, state (draft / published / past / test), system. */
export function EventBadges({ e }: { e: Pick<EventSummary, 'kind' | 'published' | 'test' | 'start' | 'end' | 'system'> }) {
  const phase = eventPhase(e);
  return (
    <>
      <AdminStatusPill tone={e.kind === 'onsite' ? 'navy' : 'neutral'}>{e.kind === 'onsite' ? 'On-site' : 'Webinar'}</AdminStatusPill>
      {e.test ? <AdminStatusPill>Test event</AdminStatusPill>
        : e.published === false ? <AdminStatusPill tone="warning">Draft</AdminStatusPill>
          : phase === 'past' ? <AdminStatusPill>Past</AdminStatusPill>
            : phase === 'current' ? <AdminStatusPill tone="info">Happening now</AdminStatusPill>
              : e.published ? <AdminStatusPill tone="success">Published</AdminStatusPill> : null}
      <AdminStatusPill tone="info" title={SYSTEM_HINT[e.system]}>{SYSTEM_LABEL[e.system]}</AdminStatusPill>
    </>
  );
}

/** A row that leads somewhere: the whole row is the control, the pill says where it goes. */
export function GoRow({
  title,
  meta,
  cue,
  to,
  href,
  onClick,
  icon: Icon,
  aside,
}: {
  title: ReactNode;
  meta?: ReactNode;
  cue: string;
  /** Another admin screen. */
  to?: string;
  /** A page outside the admin (the public page): opens in a new tab. */
  href?: string;
  /** Something on this page (another tab). */
  onClick?: () => void;
  icon?: LucideIcon;
  aside?: ReactNode;
}) {
  const inner = (
    <>
      {Icon && (
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-foam text-navy" aria-hidden="true"><Icon className="h-5 w-5" /></span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold leading-5 text-navy [overflow-wrap:anywhere]">{title}</span>
        {meta && <span className="mt-0.5 block text-[13px] leading-[18px] text-meta [overflow-wrap:anywhere]">{meta}</span>}
      </span>
      {aside && <span className="flex shrink-0 flex-wrap items-center gap-1.5">{aside}</span>}
      <ActionCue size="sm" className="self-start sm:self-center">
        {cue}
        {href && <><ExternalLink className="ml-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></>}
      </ActionCue>
    </>
  );
  const cls = 'group flex w-full flex-col gap-2 px-5 py-3.5 text-left transition-colors hover:bg-page focus:outline-none focus-visible:[box-shadow:inset_0_0_0_2px_#0b2653] sm:flex-row sm:items-center sm:gap-3';
  return (
    <li>
      {to ? <Link to={to} className={cls}>{inner}</Link>
        : href ? <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>{inner}</a>
          : <button type="button" onClick={onClick} className={cls}>{inner}</button>}
    </li>
  );
}

/** A panel of GoRows. */
export function GoPanel({ title, description, icon, children }: { title: ReactNode; description?: ReactNode; icon?: LucideIcon; children: ReactNode }) {
  return (
    <AdminPanel title={title} description={description} icon={icon} padded={false}>
      <ul className="divide-y divide-rule">{children}</ul>
    </AdminPanel>
  );
}

/** A row of figures (2 per line on a phone, 4 on a computer). */
export function Figures({ items }: { items: { label: string; value: number | string | null | undefined; hint?: string; onClick?: () => void; to?: string; tone?: 'default' | 'attention' }[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map(f => (
        <AdminKpiCard key={f.label} label={f.label} value={f.value} hint={f.hint} onClick={f.onClick} to={f.to} tone={f.tone} />
      ))}
    </div>
  );
}

/** A list of labelled numbers with a bar, largest first (no chart library, readable on a phone). */
export function Breakdown({ title, rows, empty, total }: { title: string; rows: { label: string; n: number }[]; empty?: string; total?: number }) {
  const max = Math.max(1, ...rows.map(r => r.n));
  const sum = total ?? rows.reduce((s, r) => s + r.n, 0);
  return (
    <AdminPanel title={title}>
      {rows.length === 0 ? (
        <p className="text-[14px] text-meta">{empty ?? 'Nothing to count yet.'}</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map(r => (
            <li key={r.label}>
              <div className="flex items-baseline justify-between gap-3 text-[14px] leading-5">
                <span className="min-w-0 text-ink [overflow-wrap:anywhere]">{r.label}</span>
                <span className="shrink-0 font-semibold tabular-nums text-navy">
                  {r.n}
                  {sum > 0 && <span className="ml-1.5 text-[12px] font-normal text-meta">{Math.round((r.n / sum) * 100)}%</span>}
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-chip" aria-hidden="true">
                <div className="h-full rounded-full bg-teal" style={{ width: `${Math.max(2, (r.n / max) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </AdminPanel>
  );
}

/** A plain sentence when a tab has nothing of its own, with where it is handled. */
export function TabNote({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warning' }) {
  return <Note tone={tone}>{children}</Note>;
}

/** Label / value pairs (read only). */
export function Facts({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
      {items.map(i => (
        <div key={i.label} className="min-w-0">
          <dt className="text-[12px] font-semibold uppercase tracking-[0.06em] text-meta">{i.label}</dt>
          <dd className="mt-0.5 text-[15px] leading-6 text-ink [overflow-wrap:anywhere]">{i.value || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The space between the blocks of a tab. */
export function TabBody({ children }: { children: ReactNode }) {
  return <div className="space-y-5">{children}</div>;
}
