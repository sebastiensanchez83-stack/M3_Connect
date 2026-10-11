import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import type { RegKind, RegMode, RegStatus, TimelineStep } from '@/lib/registration';
import { cn } from '@/lib/utils';
import { longDate } from './RegistrationUI';

/**
 * Where a registration stands, as a short list of steps from "Received" to the
 * event: what is done (ticked, with its date), what is happening now (gold
 * ring) and what comes next (grey). The dated steps are the registration
 * function's own timeline, so the list says only what really happened; the
 * current status adds the step in progress and the event closes the list.
 */

interface Step {
  key: string;
  label: string;
  at?: string | null;
  state: 'done' | 'current' | 'next' | 'stopped';
  note?: string;
}

const STOPPED: RegStatus[] = ['rejected', 'cancelled', 'declined'];

export function StatusTimeline({
  status,
  mode,
  kind,
  timeline,
  eventStart,
  sla,
  locale,
}: {
  status: RegStatus;
  mode: RegMode | undefined;
  kind: RegKind | undefined;
  timeline: { step: TimelineStep; at: string }[];
  eventStart?: string | null;
  sla: string;
  locale: string;
}) {
  const { t } = useTranslation();
  const reviewed = mode !== 'instant';
  const steps: Step[] = [];

  for (const [i, item] of timeline.entries()) {
    const key = `${item.step}-${i}`;
    switch (item.step) {
      case 'received':
        steps.push({ key, label: mode === 'invitation' ? t('reg.tl.requestReceived', 'Request received') : t('reg.tl.received', 'Registration received'), at: item.at, state: 'done' });
        break;
      case 'needs_info': {
        const now = status === 'needs_info' && !timeline.slice(i + 1).some((x) => x.step === 'needs_info');
        steps.push({
          key,
          label: t('reg.tl.infoRequested', 'M3 asked for a detail'),
          at: item.at,
          state: now ? 'current' : 'done',
          note: now ? t('reg.tl.infoNote', 'Please answer below.') : undefined,
        });
        break;
      }
      case 'waitlisted': {
        const now = status === 'waitlisted';
        steps.push({
          key,
          label: t('reg.tl.waitlist', 'On the waiting list'),
          at: item.at,
          state: now ? 'current' : 'done',
          note: now ? t('reg.tl.waitlistNote', 'We e-mail you as soon as a place frees up.') : undefined,
        });
        break;
      }
      case 'confirmed':
        steps.push({ key, label: reviewed ? t('reg.tl.confirmedReviewed', 'Confirmed by M3') : t('reg.tl.confirmed', 'Confirmed'), at: item.at, state: 'done' });
        break;
      case 'not_accepted':
        steps.push({ key, label: t('reg.tl.rejected', 'Not accepted'), at: item.at, state: 'stopped' });
        break;
      case 'cancelled':
        steps.push({ key, label: t('reg.tl.cancelled', 'Cancelled'), at: item.at, state: 'stopped' });
        break;
      case 'checked_in':
        steps.push({ key, label: t('reg.tl.checkedIn', 'Checked in at the entrance'), at: item.at, state: 'done' });
        break;
      default:
        break;
    }
  }

  // The step in progress, when the timeline does not hold it already.
  const hasCurrent = steps.some((s) => s.state === 'current');
  if (!hasCurrent) {
    if (status === 'requested') {
      steps.push({ key: 'review', label: t('reg.tl.review', 'Under review by M3'), state: 'current', note: t('reg.tl.reviewNote', { sla, defaultValue: 'The M3 team replies {{sla}}.' }) });
    } else if (status === 'invited') {
      steps.push({ key: 'invited', label: t('reg.tl.invited', 'Invited: your answer is awaited'), state: 'current' });
    } else if (status === 'approved') {
      steps.push({ key: 'approved', label: t('reg.tl.approved', 'Approved, payment due'), state: 'current' });
    } else if (status === 'needs_info') {
      steps.push({ key: 'info', label: t('reg.tl.infoRequested', 'M3 asked for a detail'), state: 'current', note: t('reg.tl.infoNote', 'Please answer below.') });
    } else if (status === 'waitlisted') {
      steps.push({ key: 'waitlist', label: t('reg.tl.waitlist', 'On the waiting list'), state: 'current', note: t('reg.tl.waitlistNote', 'We e-mail you as soon as a place frees up.') });
    }
  }
  if (status === 'declined' && !steps.some((s) => s.state === 'stopped')) {
    steps.push({ key: 'declined', label: t('reg.tl.declined', 'You declined'), state: 'stopped' });
  }
  if (status === 'cancelled' && !steps.some((s) => s.state === 'stopped')) {
    steps.push({ key: 'cancelled', label: t('reg.tl.cancelled', 'Cancelled'), state: 'stopped' });
  }

  if (!STOPPED.includes(status)) {
    const went = timeline.some((x) => x.step === 'checked_in');
    steps.push({
      key: 'event',
      label: kind === 'webinar' ? t('reg.tl.webinar', 'The webinar') : t('reg.tl.event', 'The event'),
      at: eventStart,
      state: went || (eventStart && new Date(eventStart).getTime() < Date.now()) ? 'done' : 'next',
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
