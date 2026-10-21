import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Info } from 'lucide-react';
import { ActionCue } from '@/components/home/dashboard/DashboardKit';
import { cn } from '@/lib/utils';

/**
 * Small pieces shared by the Companies list, the company page and the person page.
 * "This is clickable" has ONE look (Victor, 21 Oct 2026, people who struggle with technology):
 * the dashboard's pill with a few plain words and an arrow, shown at rest, never only on hover;
 * the whole row around it is the link.
 */

/** The tabs of a page (?tab=…): a scrolling row of pills on a phone, each with its count. */
export function PageTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: { key: T; label: string; count?: number | null }[];
  value: T;
  onChange: (key: T) => void;
  label: string;
}) {
  return (
    <div className="-mx-4 mb-6 overflow-x-auto px-4 md:mx-0 md:px-0">
      <div role="tablist" aria-label={label} className="inline-flex min-w-full gap-1.5 border-b border-rule pb-2 md:min-w-0">
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
                'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-pill border px-4 text-[14px] font-semibold transition-colors focus:outline-none focus-visible:shadow-focus',
                active ? 'border-navy bg-navy text-white' : 'border-navy/30 bg-white text-navy hover:border-navy hover:bg-chip',
              )}
            >
              {tab.label}
              {typeof tab.count === 'number' && (
                <span className={cn('rounded-pill px-1.5 text-[12px] leading-5 tabular-nums', active ? 'bg-white/20 text-white' : 'bg-chip text-navy')}>{tab.count}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** One row of a list that leads somewhere: the whole row is the link, the pill says where. */
export function LinkRow({
  to,
  title,
  meta,
  aside,
  cue,
  leading,
}: {
  to: string | null;
  title: ReactNode;
  meta?: ReactNode;
  aside?: ReactNode;
  cue: string;
  leading?: ReactNode;
}) {
  const inner = (
    <>
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold leading-5 text-navy [overflow-wrap:anywhere]">{title}</span>
        {meta && <span className="mt-0.5 block text-[13px] leading-[18px] text-meta [overflow-wrap:anywhere]">{meta}</span>}
      </span>
      {aside && <span className="flex shrink-0 flex-wrap items-center gap-1.5">{aside}</span>}
      {to && <ActionCue size="sm" className="self-start sm:self-center">{cue}</ActionCue>}
    </>
  );
  const cls = 'group flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center sm:gap-3';
  if (!to) return <li className={cls}>{inner}</li>;
  return (
    <li>
      <Link to={to} className={cn(cls, 'transition-colors hover:bg-page focus:outline-none focus-visible:[box-shadow:inset_0_0_0_2px_#0b2653]')}>{inner}</Link>
    </li>
  );
}

/** A note above a list: something could not be read, or what this block is for. */
export function Note({ tone = 'info', children }: { tone?: 'info' | 'warning'; children: ReactNode }) {
  const Icon = tone === 'warning' ? AlertTriangle : Info;
  return (
    <p
      role={tone === 'warning' ? 'alert' : undefined}
      className={cn(
        'flex items-start gap-2 rounded-xl border px-4 py-3 text-[14px] leading-5',
        tone === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-rule bg-foam text-navy',
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** A label and its value, in the read-only blocks. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] font-semibold uppercase tracking-[0.06em] text-meta">{label}</dt>
      <dd className="mt-0.5 text-[15px] leading-6 text-ink [overflow-wrap:anywhere]">{children || '—'}</dd>
    </div>
  );
}
