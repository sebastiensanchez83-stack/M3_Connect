import type { ElementType, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, RefreshCw, Search, type LucideIcon } from 'lucide-react';
import { Counter } from '@/components/motion/Counter';
import { Input } from '@/components/ui/input';
import { registerAdminRefonteStrings } from '@/i18n/refonte-admin';
import { cn } from '@/lib/utils';

registerAdminRefonteStrings();

/**
 * The refonte's administration kit. Calm and dense: it speaks the language of
 * the member area (white 16 px cards with a hairline, marine headings, caps
 * eyebrows, pill controls, gold for the ONE main action of a screen with navy
 * text) and none of the marketing motion: nothing here moves on its own.
 *
 *   AdminPageHeader    title, count, one-line description, actions (gold primary on the right)
 *   AdminDetailHeader  sticky bar of a detail screen: back link, title, badges, Save / Delete
 *   AdminPanel         a card with a title row (details, forms, side blocks)
 *   AdminTableCard     the card around a <table> (the admin skin styles the table itself)
 *   AdminFilterBar     search + selects on one line, wrapping on phones
 *   AdminKpiCard       a figure with its label (Counter when it is a plain number)
 *   AdminSectionLabel  caps label over a group of cards
 *   AdminStatusPill    state label in the token colours; `statusTone` maps the usual statuses
 *   AdminSegmented     two or three views of the same list (Published / Drafts)
 *   AdminEmpty / AdminLoading
 *
 * Legacy markup of the ~30 sections is lifted by src/styles/admin-skin.css
 * (headings, cards, tables) so most screens improve without being rewritten.
 * Presentation only: the kit takes callbacks and children, it never fetches.
 */

/* ------------------------------------------------------------------ buttons */

/** The ONE main action of a screen: gold, navy text (use on a shadcn Button, size sm). */
export const ADMIN_BTN_PRIMARY = 'h-10 rounded-pill bg-gold px-4 font-semibold text-navy hover:bg-gold-hover';
/** Every other action in a header or a bar. */
export const ADMIN_BTN = 'h-10 rounded-pill border-navy/25 bg-white px-4 text-navy hover:border-navy hover:bg-chip hover:text-navy';
/** Destructive secondary action (Delete). */
export const ADMIN_BTN_DANGER = 'h-10 rounded-pill border-red-200 bg-white px-4 text-red-700 hover:border-red-300 hover:bg-red-50 hover:text-red-800';

const FOCUS = 'focus:outline-none focus-visible:shadow-focus';

/* ------------------------------------------------------------------ headers */

export function AdminPageHeader({
  title,
  count,
  description,
  actions,
  meta,
  className,
}: {
  title: ReactNode;
  /** A figure next to the title (the list's size). */
  count?: number;
  /** One line under the title: what this screen is for. */
  description?: ReactNode;
  /** Buttons on the right (wrap under the title on phones). */
  actions?: ReactNode;
  /** Pills or a sentence under the description (verified • pending…). */
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-[24px] font-semibold leading-[30px] tracking-[-0.015em] text-navy [overflow-wrap:anywhere]">{title}</h1>
          {count !== undefined && (
            <span className="rounded-pill bg-chip px-2.5 py-0.5 text-[13px] font-semibold leading-5 tabular-nums text-navy">{count}</span>
          )}
        </div>
        {description && <p className="mt-1.5 max-w-2xl text-[14px] leading-5 text-meta">{description}</p>}
        {meta && <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] leading-5 text-meta">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * The header of a detail screen. It sticks under the site header, so Save and
 * Delete stay in reach on a long form.
 */
export function AdminDetailHeader({
  back,
  title,
  leading,
  badges,
  subtitle,
  actions,
  className,
}: {
  back: { to: string; label: ReactNode };
  title: ReactNode;
  /** Logo or avatar before the title. */
  leading?: ReactNode;
  /** Status pills after the title. */
  badges?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('sticky top-16 z-20 -mx-2 mb-6 border-b border-rule bg-page/95 px-2 pb-3 pt-1 backdrop-blur', className)}>
      <Link
        to={back.to}
        className={cn('inline-flex items-center gap-1.5 rounded-pill py-1 pr-2 text-[14px] leading-5 text-meta transition-colors hover:text-navy', FOCUS)}
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {back.label}
      </Link>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 items-center gap-3.5">
          {leading}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h1 className="text-[22px] font-semibold leading-7 tracking-[-0.015em] text-navy [overflow-wrap:anywhere]">{title}</h1>
              {badges}
            </div>
            {subtitle && <p className="mt-0.5 text-[13px] leading-5 text-meta">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ panels */

export function AdminPanel({
  title,
  description,
  icon: Icon,
  actions,
  as: Tag = 'section',
  padded = true,
  className,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  actions?: ReactNode;
  as?: ElementType;
  /** false for a list or a table that runs edge to edge. */
  padded?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag className={cn('overflow-hidden rounded-card border border-rule bg-white', className)}>
      {title && (
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-rule px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold leading-5 text-navy">
              {Icon && <Icon className="h-4 w-4 shrink-0 text-teal" aria-hidden="true" />}
              <span className="min-w-0 [overflow-wrap:anywhere]">{title}</span>
            </h2>
            {description && <p className="mt-0.5 text-[13px] leading-[18px] text-meta">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn(padded && 'p-5')}>{children}</div>
    </Tag>
  );
}

/** The card around a <table>; the admin skin gives the table its sticky caps header and row hover. */
export function AdminTableCard({ children, footer, className }: { children: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-card border border-rule bg-white', className)}>
      <div className="admin-table-scroll">{children}</div>
      {footer && <div className="border-t border-rule bg-white px-4 py-3 text-[13px] leading-5 text-meta">{footer}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ filters */

/**
 * The line above a list: a search field and the selects that filter it. Select
 * triggers passed as children are brought to the same 40 px pill height.
 */
export function AdminFilterBar({
  search,
  onSearchChange,
  searchPlaceholder,
  searchLabel,
  children,
  trailing,
  className,
}: {
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  searchLabel?: string;
  children?: ReactNode;
  /** Pushed to the right (a refresh button, a result count). */
  trailing?: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        'mb-4 flex flex-wrap items-center gap-2.5',
        '[&_[role=combobox]]:h-10 [&_[role=combobox]]:rounded-pill [&_[role=combobox]]:bg-white [&_[role=combobox]]:px-4',
        className,
      )}
    >
      {onSearchChange && (
        <label className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <span className="sr-only">{searchLabel ?? searchPlaceholder ?? t('common.search', 'Search')}</span>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-meta" aria-hidden="true" />
          <Input
            type="search"
            value={search ?? ''}
            onChange={e => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-10 rounded-pill bg-white pl-10 md:h-10"
          />
        </label>
      )}
      {children}
      {trailing && <div className="ml-auto flex items-center gap-2">{trailing}</div>}
    </div>
  );
}

/** Two or three views of one list: Published / Drafts. */
export function AdminSegmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: ReactNode; badge?: number }[];
  label: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn('inline-flex rounded-pill border border-rule bg-white p-1', className)}>
      {options.map(o => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-pill px-3.5 text-[13px] font-semibold transition-colors',
              FOCUS,
              active ? 'bg-navy text-white' : 'text-meta hover:bg-chip hover:text-navy',
            )}
          >
            {o.label}
            {!!o.badge && (
              <span className={cn('rounded-pill px-1.5 text-[11px] font-bold leading-4', active ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-900')}>{o.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ pills */

export type AdminTone = 'success' | 'warning' | 'danger' | 'neutral' | 'info' | 'navy';

const PILL: Record<AdminTone, string> = {
  success: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-900 ring-amber-200',
  danger: 'bg-red-50 text-red-800 ring-red-200',
  neutral: 'bg-chip text-meta ring-rule',
  info: 'bg-foam text-teal-text ring-teal/25',
  navy: 'bg-navy text-white ring-navy',
};

export function AdminStatusPill({
  tone = 'neutral',
  icon: Icon,
  children,
  title,
  className,
}: {
  tone?: AdminTone;
  icon?: LucideIcon;
  children: ReactNode;
  /** Longer explanation on hover (the pill's text stays short). */
  title?: string;
  className?: string;
}) {
  return (
    <span title={title} className={cn('inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-pill px-2.5 py-0.5 text-[12px] font-semibold leading-5 ring-1 ring-inset', PILL[tone], className)}>
      {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, AdminTone> = {
  // done, healthy
  verified: 'success', approved: 'success', paid: 'success', completed: 'success', published: 'success',
  active: 'success', signed: 'success', confirmed: 'success', accepted: 'success', free: 'success',
  // waiting for someone at M3
  pending: 'warning', submitted: 'warning', new: 'warning', draft: 'warning', pending_approval: 'warning',
  review_1: 'warning', review_2: 'warning', in_review: 'warning', in_progress: 'warning', open: 'warning',
  // moving along
  qualified: 'info', in_discussion: 'info', contacted: 'info', scheduled: 'info', invoiced: 'info',
  // stopped
  rejected: 'danger', declined: 'danger', failed: 'danger', cancelled: 'danger', canceled: 'danger', refunded: 'danger',
  suspended: 'neutral', closed: 'neutral', archived: 'neutral', past: 'neutral', expired: 'neutral',
};

/** The tone of a status string as the database spells it (pending_approval, in_discussion…). */
export function statusTone(status: string | null | undefined): AdminTone {
  if (!status) return 'neutral';
  return STATUS_TONE[status.toLowerCase().replace(/[\s-]+/g, '_')] ?? 'neutral';
}

/** "pending_approval" -> "Pending approval". */
export function statusLabel(status: string | null | undefined): string {
  if (!status) return '—';
  const s = status.replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A status string as a pill, tone and label derived from the value. */
export function AdminStatus({ status, label, className }: { status: string | null | undefined; label?: ReactNode; className?: string }) {
  return (
    <AdminStatusPill tone={statusTone(status)} className={className}>
      {label ?? statusLabel(status)}
    </AdminStatusPill>
  );
}

/* ------------------------------------------------------------------ figures */

export function AdminSectionLabel({ icon: Icon, children, className, actions }: { icon?: LucideIcon; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <div className={cn('mb-3 flex items-center justify-between gap-3', className)}>
      <h2 className="text-meta-caps flex items-center gap-1.5">
        {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
        {children}
      </h2>
      {actions}
    </div>
  );
}

type KpiTone = 'default' | 'attention' | 'danger';

const KPI_TILE: Record<KpiTone, string> = {
  default: 'bg-chip text-navy',
  attention: 'bg-gold/25 text-navy',
  danger: 'bg-red-50 text-red-700',
};

/**
 * One figure with its label. A plain number counts up once (Counter); anything
 * else (a currency string) is shown as given. Clickable when `to` or `onClick`
 * is set: hairline darkens and the card lifts its shadow, nothing else.
 */
export function AdminKpiCard({
  label,
  value,
  icon: Icon,
  tone = 'default',
  badge,
  hint,
  to,
  onClick,
  selected,
  className,
}: {
  label: ReactNode;
  value: number | string | null | undefined;
  icon?: LucideIcon;
  tone?: KpiTone;
  /** A small pill top right: growth, "3 new". */
  badge?: ReactNode;
  hint?: ReactNode;
  to?: string;
  onClick?: () => void;
  /** A toggle that is on (a filter): navy hairline. */
  selected?: boolean;
  className?: string;
}) {
  const interactive = !!(to || onClick);
  const body = (
    <>
      {(Icon || badge) && (
        <div className="flex items-start justify-between gap-2">
          {Icon ? (
            <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', KPI_TILE[tone])}>
              <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
          ) : <span />}
          {badge}
        </div>
      )}
      <p className={cn('text-[28px] font-semibold leading-8 tabular-nums tracking-[-0.01em] text-navy', (Icon || badge) && 'mt-3')}>
        {typeof value === 'number' ? <Counter value={value} duration={700} /> : value ?? '—'}
      </p>
      <p className="mt-1 text-[13px] leading-[18px] text-meta">{label}</p>
      {hint && <p className="mt-0.5 text-[12px] leading-4 text-meta/80">{hint}</p>}
    </>
  );
  const cls = cn(
    'block w-full rounded-card border bg-white p-4 text-left',
    selected ? 'border-navy ring-1 ring-navy/20' : 'border-rule',
    interactive && cn('transition-[box-shadow,border-color] duration-200 hover:border-navy/25 hover:shadow-hover motion-reduce:transition-none', FOCUS),
    className,
  );
  if (to) return <Link to={to} className={cls}>{body}</Link>;
  if (onClick) return <button type="button" onClick={onClick} aria-pressed={selected} className={cls}>{body}</button>;
  return <div className={cls}>{body}</div>;
}

/* ------------------------------------------------------------------ states */

export function AdminEmpty({
  icon: Icon,
  title,
  body,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('px-5 py-12 text-center', className)}>
      {Icon && (
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-pill bg-chip text-navy">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      )}
      <p className={cn('text-[15px] font-semibold leading-6 text-navy', Icon && 'mt-3')}>{title}</p>
      {body && <p className="mx-auto mt-1 max-w-md text-[14px] leading-5 text-meta">{body}</p>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function AdminLoading({ label, className }: { label?: string; className?: string }) {
  const { t } = useTranslation();
  return (
    <div role="status" className={cn('flex h-64 flex-col items-center justify-center gap-3 text-meta', className)}>
      <RefreshCw className="h-6 w-6 animate-spin text-navy motion-reduce:animate-none" aria-hidden="true" />
      <span className="text-[13px]">{label ?? t('adminUi.loading')}</span>
    </div>
  );
}
