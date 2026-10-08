import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import { StatusPill, type PillTone } from '@/components/member/MemberUI';
import { humanize } from './format';

/**
 * Building blocks shared by the member area's editors (profile, events,
 * requests), moved unchanged from the old AccountPage.
 */

/** A label and its value in a definition list. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] font-medium leading-5 text-meta">{label}</dt>
      <dd className="mt-0.5 break-words text-[15px] font-semibold leading-6 text-navy">{children}</dd>
    </div>
  );
}

/** One request in a list (project, RFP, consultation, webinar proposal). */
export function ItemRow({
  icon: Icon,
  title,
  description,
  meta,
  rejection,
  aside,
  footer,
}: {
  icon: LucideIcon;
  title: string;
  description?: string | null;
  meta: (string | null | undefined)[];
  rejection?: string | null;
  aside?: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  const metaLine = meta.filter(Boolean).join(' · ');
  return (
    <li className="p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-field bg-chip text-navy">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-navy [overflow-wrap:anywhere]">{title}</p>
            {rejection && (
              <p className="mt-1 text-sm text-red-700">
                <span className="font-medium">{t('accountArea.common.reason', 'Reason:')}</span> {rejection}
              </p>
            )}
            {description && <p className="mt-1 line-clamp-2 text-sm text-meta">{description}</p>}
            {metaLine && <p className="mt-1 text-xs text-meta">{metaLine}</p>}
          </div>
        </div>
        {aside && <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{aside}</div>}
      </div>
      {footer && <div className="mt-3 space-y-3 sm:pl-[52px]">{footer}</div>}
    </li>
  );
}

export function WebinarStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const map: Record<string, { label: string; tone: PillTone }> = {
    submitted: { label: t('accountArea.status.submitted', 'Submitted'), tone: 'warning' },
    under_review: { label: t('accountArea.status.under_review', 'Under review'), tone: 'info' },
    accepted: { label: t('accountArea.status.accepted', 'Accepted'), tone: 'success' },
    rejected: { label: t('accountArea.status.rejected', 'Rejected'), tone: 'danger' },
  };
  const s = map[status] ?? { label: status, tone: 'neutral' as PillTone };
  return <StatusPill tone={s.tone}>{s.label}</StatusPill>;
}

export function SubmissionStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const map: Record<string, { label: string; tone: PillTone }> = {
    new: { label: t('accountArea.status.new', 'New'), tone: 'neutral' },
    submitted: { label: t('accountArea.status.submitted', 'Submitted'), tone: 'warning' },
    pending: { label: t('accountArea.status.pending', 'Pending'), tone: 'warning' },
    under_review: { label: t('accountArea.status.under_review', 'Under review'), tone: 'info' },
    in_progress: { label: t('accountArea.status.in_progress', 'In progress'), tone: 'info' },
    accepted: { label: t('accountArea.status.accepted', 'Accepted'), tone: 'success' },
    approved: { label: t('accountArea.status.approved', 'Approved'), tone: 'success' },
    completed: { label: t('accountArea.status.completed', 'Completed'), tone: 'success' },
    active: { label: t('accountArea.status.active', 'Active'), tone: 'success' },
    open: { label: t('accountArea.status.open', 'Open'), tone: 'success' },
    rejected: { label: t('accountArea.status.rejected', 'Rejected'), tone: 'danger' },
    closed: { label: t('accountArea.status.closed', 'Closed'), tone: 'neutral' },
    cancelled: { label: t('accountArea.status.cancelled', 'Cancelled'), tone: 'neutral' },
  };
  const s = map[status] ?? { label: humanize(status), tone: 'neutral' as PillTone };
  return <StatusPill tone={s.tone}>{s.label}</StatusPill>;
}
