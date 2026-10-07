import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, type LucideIcon } from 'lucide-react';
import { BackLink, FOCUS, MemberHeader, StatusPill, type PillTone } from '@/components/member/MemberUI';
import { Eyebrow } from '@/components/brand/Eyebrow';
import {
  FULFILMENT_STATUS_META,
  type SpAgreementStatus,
  type SpFulfilmentStatus,
  type SpProgram,
  type SpSponsorStatus,
} from '@/lib/sponsorship';
import { cn } from '@/lib/utils';

/**
 * Shared presentation of the sponsorship area (the sponsor portal, the
 * fulfilment hub and the agreement screen), in the language of the member
 * screens: marine band, white 16 px cards with a hairline, caps eyebrows, pill
 * labels and 40 px pill controls. Presentation only: nothing here reads or
 * writes data.
 */

/** What the three programmes are called on screen (the data keys stay as they are). */
export const PROGRAM_NAMES: Record<SpProgram, string> = {
  SMC: 'Smart Marina Connect',
  SMART_MARINA_EVENT: 'Monaco Smart & Sustainable Marina Rendezvous',
  WYS: 'World Yachting Summit',
};

/* ------------------------------------------------------------------ pills */

const FULFILMENT_TONE: Record<SpFulfilmentStatus, PillTone> = {
  TODO: 'neutral',
  REQUESTED_FROM_SPONSOR: 'warning',
  AWAITING_REVIEW: 'info',
  DELIVERED: 'success',
  REJECTED: 'danger',
};
const SPONSOR_TONE: Record<SpSponsorStatus, PillTone> = { active: 'success', pending: 'warning', expired: 'neutral' };
const AGREEMENT_TONE: Record<SpAgreementStatus, PillTone> = { draft: 'neutral', active: 'success', expired: 'neutral', renewed: 'info' };

export function FulfilmentPill({ status, className }: { status: SpFulfilmentStatus; className?: string }) {
  return <StatusPill tone={FULFILMENT_TONE[status]} className={className}>{FULFILMENT_STATUS_META[status].label}</StatusPill>;
}
export function SponsorStatusPill({ status }: { status: SpSponsorStatus }) {
  return <StatusPill tone={SPONSOR_TONE[status]} className="capitalize">{status}</StatusPill>;
}
export function AgreementStatusPill({ status }: { status: SpAgreementStatus }) {
  return <StatusPill tone={AGREEMENT_TONE[status]} className="capitalize">{status}</StatusPill>;
}

/* ------------------------------------------------------------------ bits */

/** "12 Jan 2026"; ISO dates are read as local days so they never slip by one. */
export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const dt = new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00` : d);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Delivery progress: navy, teal once everything is delivered. */
export function ProgressBar({ pct, label, className }: { pct: number; label: string; className?: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={cn('h-2 overflow-hidden rounded-pill bg-chip', className)}
    >
      <div
        className={cn('h-full rounded-pill transition-[width] duration-500 motion-reduce:transition-none', pct === 100 ? 'bg-teal' : 'bg-navy')}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** A caption over a form control (the shadcn Label is 14 px medium; this is the quieter 13 px of dense forms). */
export const FIELD_LABEL = 'text-[13px] font-medium leading-5 text-meta';
/** Text inputs and selects of this area: 12 px radius, like the filters of the deal flow. */
export const FIELD = 'rounded-field';
/** A small round icon button (40 px touch target): review, edit, remove. */
export const ICON_BTN = 'h-10 w-10 shrink-0 rounded-pill p-0';

/* ------------------------------------------------------------------ frame */

/**
 * One frame for every screen of the area. With `band` (the /sponsorship page
 * and the account tab's page header) the screen opens with the marine band
 * and its content sits in the 7xl column; without it (the admin workspace,
 * which brings its own shell) a quiet heading opens a column that fills the
 * space it is given.
 */
export function SponsorshipFrame({
  band,
  icon,
  eyebrow,
  title,
  meta,
  actions,
  back,
  narrow = false,
  children,
}: {
  band: boolean;
  icon: LucideIcon;
  eyebrow?: string;
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
  back?: { to: string; label: string };
  /** Without a band: a reading column instead of the wide one. */
  narrow?: boolean;
  children: ReactNode;
}) {
  if (band) {
    return (
      <>
        <MemberHeader
          image={null}
          seed="sponsorship"
          icon={icon}
          eyebrow={eyebrow}
          title={title}
          actions={actions}
          back={back ? <BackLink to={back.to}>{back.label}</BackLink> : undefined}
        >
          {meta}
        </MemberHeader>
        <div className="mx-auto w-full max-w-7xl px-4 pb-20 pt-8 sm:px-6 md:pt-10">{children}</div>
      </>
    );
  }
  return (
    <div className={cn('mx-auto w-full pb-10', narrow ? 'max-w-3xl' : 'max-w-5xl')}>
      {back && (
        <Link to={back.to} className={cn('uline uline--plain mb-5 !text-[14px] !font-normal', FOCUS)}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span className="uline-t">{back.label}</span>
        </Link>
      )}
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
          <h1 className={cn('text-h2-sm text-navy [overflow-wrap:anywhere] md:text-h2', eyebrow && 'mt-2')}>{title}</h1>
          {meta && <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-[15px] leading-6 text-meta">{meta}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>}
      </header>
      {children}
    </div>
  );
}
