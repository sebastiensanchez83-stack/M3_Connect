import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * One card that says where an account stands (the dashboard's status card, spec
 * regspec-en.md §6 /dashboard): a round icon, a small label, a title, a sentence
 * or two, and the actions. Presentation only: the dashboard decides the words.
 *
 *   <StatusCard tone="pending" icon={Clock} eyebrow="Your account" title="M3 is reviewing your account">
 *     The M3 team checks each new account…
 *   </StatusCard>
 *
 * Tones: `pending` (amber), `ok` (teal), `info` (navy), `stop` (red: not accepted,
 * suspended). Actions stack under the words on phones and sit on the right from
 * 640 px.
 */
export type StatusTone = 'pending' | 'ok' | 'info' | 'stop';

const BOX: Record<StatusTone, string> = {
  pending: 'border-amber-300 bg-amber-50/70',
  ok: 'border-teal/30 bg-foam/70',
  info: 'border-rule bg-white',
  stop: 'border-red-300 bg-red-50/70',
};

const DISC: Record<StatusTone, string> = {
  pending: 'bg-amber-100 text-amber-800',
  ok: 'bg-white text-teal-text',
  info: 'bg-chip text-navy',
  stop: 'bg-white text-red-700',
};

export function StatusCard({
  tone,
  icon: Icon,
  eyebrow,
  title,
  children,
  actions,
  className,
  id,
}: {
  tone: StatusTone;
  icon: LucideIcon;
  eyebrow?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      aria-label={typeof eyebrow === 'string' ? eyebrow : undefined}
      className={cn('flex flex-col gap-4 rounded-card border p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5', BOX[tone], className)}
    >
      <div className="flex min-w-0 items-start gap-3.5">
        <span aria-hidden="true" className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-full', DISC[tone])}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 text-[15px] leading-6 text-ink">
          {eyebrow && <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-meta">{eyebrow}</p>}
          <p className="font-semibold text-navy [overflow-wrap:anywhere]">{title}</p>
          {children && <div className="mt-1 space-y-1.5 text-ink/90">{children}</div>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-col gap-2 sm:items-end sm:pl-4">{actions}</div>}
    </section>
  );
}
