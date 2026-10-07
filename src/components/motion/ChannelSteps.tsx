import { useRef, type ComponentType, type CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import { useMotion } from './MotionProvider';
import { useInView } from './useInView';

/**
 * "Chenal": numbered steps as channel buoys joined by a dashed leading line
 * that draws itself when the list scrolls into view, then each buoy pops in.
 * Horizontal from lg up, vertical (line on the left) below. An ordered list,
 * so assistive tech reads "1 of 4".
 *
 *   <ChannelSteps steps={[{ title: 'Create your account', body: '…' }, …]} />
 */
export interface ChannelStep {
  title: string;
  body?: string;
  /** A Lucide icon or one of the harbour pictograms (anything that takes a className). */
  icon?: ComponentType<{ className?: string }>;
}

export function ChannelSteps({
  steps,
  tone = 'light',
  className,
}: {
  steps: ChannelStep[];
  /** 'light' on white/foam, 'dark' on navy. */
  tone?: 'light' | 'dark';
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { reduced } = useMotion();
  const inView = useInView(ref, { disabled: reduced, threshold: 0.25 });
  const dark = tone === 'dark';
  const dash = dark ? 'rgba(255,255,255,.45)' : 'rgb(11 38 83 / .35)';

  return (
    <div ref={ref} className={cn('chenal relative', inView && 'is-in', className)}>
      {/* Leading line: vertical on phones, horizontal through the buoys from lg. */}
      <span
        aria-hidden="true"
        className="chenal-line-v absolute bottom-6 left-[21px] top-6 w-0 border-l-2 border-dashed lg:hidden"
        style={{ borderColor: dash }}
      />
      <span
        aria-hidden="true"
        className="chenal-line-h absolute left-[22px] top-[21px] hidden h-0 border-t-2 border-dashed lg:block"
        // From the first buoy's centre to the last one's: n equal columns, 24 px gaps.
        style={{ borderColor: dash, right: `calc((100% - ${(steps.length - 1) * 24}px) / ${steps.length} - 22px)` }}
      />
      <ol className="relative grid gap-8 lg:grid-flow-col lg:auto-cols-fr lg:gap-6">
        {steps.map((step, i) => {
          const Icon = step.icon;
          return (
            <li key={step.title} className="relative flex gap-4 lg:flex-col lg:gap-5" style={{ '--i': i } as CSSProperties}>
              <span
                aria-hidden="true"
                className={cn(
                  'chenal-buoy relative z-10 grid h-11 w-11 shrink-0 place-items-center rounded-full text-base font-semibold tabular ring-4',
                  dark ? 'bg-white text-navy ring-navy' : 'bg-navy text-white ring-white',
                )}
              >
                {i + 1}
                {/* Topmark: the small cone on a channel buoy. */}
                <svg viewBox="0 0 12 8" className={cn('absolute -top-2.5 h-2 w-3', dark ? 'text-white' : 'text-navy')}>
                  <path d="M6 0 12 8H0Z" fill="currentColor" />
                </svg>
              </span>
              <div className="min-w-0 pt-1.5 lg:pt-0">
                <h3 className={cn('flex items-center gap-2 text-card-title', dark ? 'text-white' : 'text-navy')}>
                  {Icon && <Icon className={cn('h-5 w-5 shrink-0', dark ? 'text-white/80' : 'text-teal')} aria-hidden="true" />}
                  {step.title}
                </h3>
                {step.body && <p className={cn('mt-1.5 text-body', dark ? 'text-white/80' : 'text-meta')}>{step.body}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
