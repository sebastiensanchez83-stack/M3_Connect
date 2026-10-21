import type { ReactNode } from 'react';
import { TIER_LABELS, type OrgTier } from '@/types/database';
import { cn } from '@/lib/utils';
import { AdminStatusPill } from './AdminUI';

/**
 * Small pieces shared by the older Members and Settings screens once they moved to the
 * refonte admin style (Oct 2026): the words for account and company types, the sponsor
 * plan pill, a labelled form field and the "sentence + button" line of an action panel.
 * Vocabulary (Victor): "Partner" only for paying sponsors; a company of type `partner`
 * is a "Service provider", and everyone else is a member.
 */

/** profiles.persona, in plain words. */
export const PERSONA_LABEL: Record<string, string> = {
  marina: 'Marina',
  partner: 'Service provider',
  media_partner: 'Media',
  developer: 'Developer',
  investor: 'Investor',
  individual: 'Individual',
  admin: 'M3 admin',
  moderator: 'M3 moderator',
};

/** organizations.organization_type, in plain words. */
export const ORG_TYPE_LABEL: Record<string, string> = {
  marina: 'Marina',
  partner: 'Service provider',
  media_partner: 'Media',
  investor: 'Investor',
  developer: 'Developer',
  individual: 'Individual',
};

export function personaLabel(p: string | null | undefined): string {
  if (!p) return '—';
  return PERSONA_LABEL[p] ?? p;
}

export function orgTypeLabel(t: string | null | undefined): string {
  if (!t) return '—';
  return ORG_TYPE_LABEL[t] ?? t;
}

export function tierLabel(tier: string | null | undefined): string {
  if (!tier) return '—';
  return TIER_LABELS[tier as OrgTier] ?? tier;
}

/** The sponsor plan: "Member" (free, not listed as a sponsor) in grey, a paying plan in teal. */
export function TierPill({ tier, className }: { tier: string | null | undefined; className?: string }) {
  if (!tier) return <span className="text-meta/60">—</span>;
  const paying = tier !== 'member';
  return (
    <AdminStatusPill tone={paying ? 'info' : 'neutral'} title={paying ? 'Paying sponsor plan' : 'Free membership, not listed as a sponsor'} className={className}>
      {tierLabel(tier)}
    </AdminStatusPill>
  );
}

/** "21 Oct 2026". */
export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** A form field: its label above, the control, then one plain line of help under it. */
export function FormField({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-[13px] font-semibold leading-5 text-navy">{label}</label>
      {children}
      {hint && <div className="text-[13px] leading-[18px] text-meta">{hint}</div>}
    </div>
  );
}

/** One thing that can be done in a panel: what it does, in a sentence, and its button (stacked on a phone). */
export function ActionLine({ text, children, divided = false }: { text: ReactNode; children: ReactNode; divided?: boolean }) {
  return (
    <div className={cn('flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4', divided && 'border-t border-rule pt-4')}>
      <div className="min-w-0 text-[14px] leading-5 text-ink">{text}</div>
      <div className="flex shrink-0 flex-wrap gap-2">{children}</div>
    </div>
  );
}

/** The class of a text field or a select trigger in these screens: white, 44 px on a phone, 40 px from md. */
export const FIELD = 'h-11 bg-white md:h-10';
