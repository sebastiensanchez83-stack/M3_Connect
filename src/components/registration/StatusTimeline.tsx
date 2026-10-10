import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import type { RegKind, RegMode, RegStatus } from '@/lib/registration';
import { cn } from '@/lib/utils';
import { longDate } from './RegistrationUI';

/**
 * Where a registration stands, as a short list of steps from "Received" to the
 * event: what is done (ticked, with its date), what is happening now (gold
 * ring) and what comes next (grey). Built from the registration's own dates,
 * so it says only what really happened.
 */

interface Step {
  key: string;
  label: string;
  at?: string | null;
  state: 'done' | 'current' | 'next' | 'stopped';
  note?: string;
}

export function StatusTimeline({
  status,
  mode,
  kind,
  createdAt,
  decidedAt,
  infoRequestedAt,
  cancelledAt,
  eventStart,
  sla,
  locale,
}: {
  status: RegStatus;
  mode: RegMode;
  kind: RegKind;
  createdAt?: string | null;
  decidedAt?: string | null;
  infoRequestedAt?: string | null;
  cancelledAt?: string | null;
  eventStart?: string | null;
  sla: string;
  locale: string;
}) {
  const { t } = useTranslation();
  const steps: Step[] = [];
  const reviewed = mode !== 'instant';

  steps.push({
    key: 'received',
    label: mode === 'invitation' ? t('reg.tl.requestReceived', 'Request received') : t('reg.tl.received', 'Registration received'),
    at: createdAt,
    state: 'done',
  });

  if (infoRequestedAt) {
    steps.push({
      key: 'info',
      label: t('reg.tl.infoRequested', 'M3 asked for a detail'),
      at: infoRequestedAt,
      state: status === 'needs_info' ? 'current' : 'done',
      note: status === 'needs_info' ? t('reg.tl.infoNote', 'Please answer below.') : undefined,
    });
  }

  const decided = ['confirmed', 'rejected', 'waitlisted', 'approved', 'invited'].includes(status);
  if (status === 'requested') {
    steps.push({
      key: 'review',
      label: t('reg.tl.review', 'Under review by M3'),
      state: 'current',
      note: t('reg.tl.reviewNote', { sla, defaultValue: 'The M3 team replies {{sla}}.' }),
    });
  } else if (status === 'invited') {
    steps.push({ key: 'invited', label: t('reg.tl.invited', 'Invited: your answer is awaited'), at: decidedAt, state: 'current' });
  } else if (status === 'waitlisted') {
    steps.push({ key: 'waitlist', label: t('reg.tl.waitlist', 'On the waiting list'), at: decidedAt, state: 'current', note: t('reg.tl.waitlistNote', 'We e-mail you as soon as a place frees up.') });
  } else if (status === 'approved') {
    steps.push({ key: 'approved', label: t('reg.tl.approved', 'Approved, payment due'), at: decidedAt, state: 'current' });
  } else if (status === 'confirmed') {
    steps.push({
      key: 'confirmed',
      label: reviewed ? t('reg.tl.confirmedReviewed', 'Confirmed by M3') : t('reg.tl.confirmed', 'Confirmed'),
      at: decidedAt ?? (reviewed ? null : createdAt),
      state: 'done',
    });
  } else if (status === 'rejected') {
    steps.push({ key: 'rejected', label: t('reg.tl.rejected', 'Not accepted'), at: decidedAt, state: 'stopped' });
  } else if (status === 'cancelled' || status === 'declined') {
    steps.push({
      key: 'cancelled',
      label: status === 'declined' ? t('reg.tl.declined', 'You declined') : t('reg.tl.cancelled', 'Cancelled'),
      at: cancelledAt,
      state: 'stopped',
    });
  } else if (!decided && reviewed) {
    steps.push({ key: 'review', label: t('reg.tl.review', 'Under review by M3'), state: 'next' });
  }

  if (!['rejected', 'cancelled', 'declined'].includes(status)) {
    steps.push({
      key: 'event',
      label: kind === 'webinar' ? t('reg.tl.webinar', 'The webinar') : t('reg.tl.event', 'The event'),
      at: eventStart,
      state: eventStart && new Date(eventStart).getTime() < Date.now() ? 'done' : 'next',
    });
  }

  return (
    <ol className="relative space-y-0" aria-label={t('reg.tl.label', 'Steps of your registration')}>
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        return (
          <li key={s.key} className="relative flex gap-3.5 pb-5 last:pb-0">
            {!last && <span aria-hidden="true" className={cn('absolute left-[13px] top-7 h-[calc(100%-1.75rem)] w-0.5', s.state === 'done' ? 'bg-teal' : 'bg-rule')} />}
            <span
              aria-hidden="true"
              className={cn(
                'relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full text-white',
                s.state === 'done' && 'bg-teal',
                s.state === 'current' && 'bg-white ring-4 ring-inset ring-gold',
                s.state === 'next' && 'bg-white ring-2 ring-inset ring-rule',
                s.state === 'stopped' && 'bg-meta',
              )}
            >
              {s.state === 'done' && <Check className="h-4 w-4" strokeWidth={3} />}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className={cn('text-[15px] font-semibold leading-6', s.state === 'next' ? 'text-meta' : 'text-navy')}>
                {s.label}
                <span className="sr-only">
                  {s.state === 'done' ? ` (${t('reg.tl.done', 'done')})` : s.state === 'current' ? ` (${t('reg.tl.now', 'now')})` : s.state === 'next' ? ` (${t('reg.tl.next', 'to come')})` : ''}
                </span>
              </p>
              {s.at && <p className="text-sm leading-5 text-meta">{longDate(s.at, locale)}</p>}
              {s.note && <p className="mt-0.5 text-sm leading-5 text-ink">{s.note}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
