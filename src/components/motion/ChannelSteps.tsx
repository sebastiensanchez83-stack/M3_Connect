import { useRef, type ComponentType, type CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import { useMotion } from './MotionProvider';
import { useEntrance } from './useInView';

/**
 * Numbered steps: outlined circles (2 px navy border, white fill, navy number)
 * joined by a teal dashed line. When the list arrives from below the fold each
 * circle pops in (300 ms, 60 ms apart) and the dashed segment after it draws
 * itself towards the next one. Already on screen when it mounts, or under
 * reduced motion, it is simply there (design audit, 8 Oct 2026).
 * Horizontal from lg up, vertical (line on the left) below. An ordered list,
 * so assistive tech reads "1 of 4".
 *
 *   <ChannelSteps steps={[{ title: 'Create your account', body: '…' }, …]} />
 *
 * (The CSS keeps its original `chenal` class names; see smc-motion.css.)
 */
export interface ChannelStep {
  title: string;
  body?: string;
  /** A Lucide icon (anything that takes a className). */
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
  const phase = useEntrance(ref, reduced);
  const dark = tone === 'dark';
  const dash = dark ? 'border-white/45' : 'border-teal';

  return (
    <div ref={ref} className={cn('chenal relative', phase === 'armed' && 'is-armed', phase === 'in' && 'is-entering', className)}>
      <ol className="relative grid gap-8 lg:grid-flow-col lg:auto-cols-fr lg:gap-6">
        {steps.map((step, i) => {
          const Icon = step.icon;
          const last = i === steps.length - 1;
          // The segment after this step starts as its circle pops in and ends where the next one begins.
          const segment = { transitionDelay: `${(0.1 + i * 0.06).toFixed(2)}s` } as CSSProperties;
          return (
            <li key={step.title} className="relative flex gap-4 lg:flex-col lg:gap-5" style={{ '--i': i } as CSSProperties}>
              {!last && (
                <>
                  <span aria-hidden="true" style={segment} className={cn('chenal-line-v absolute -bottom-8 left-[19px] top-[44px] w-0 border-l-2 border-dashed lg:hidden', dash)} />
                  <span aria-hidden="true" style={segment} className={cn('chenal-line-h absolute -right-6 left-[48px] top-[19px] hidden h-0 border-t-2 border-dashed lg:block', dash)} />
                </>
              )}
              <span
                aria-hidden="true"
                className={cn(
                  'chenal-buoy relative z-10 grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 text-base font-bold leading-none tabular',
                  dark ? 'border-white bg-navy text-white' : 'border-navy bg-white text-navy',
                )}
              >
                {i + 1}
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
