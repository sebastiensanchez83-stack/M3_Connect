import { useRef, type ElementType, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { BathyPattern } from './BathyPattern';
import { useMotion } from './MotionProvider';
import { useInView } from './useInView';

/**
 * A navy panel whose background is revealed by a rising wave edge when it
 * scrolls into view (1.1 s), then its content fades up. The SMC answer to the
 * "panel scales in" effect: water filling the frame, not a zoom.
 *
 *   <WavePanel className="rounded-card px-6 py-12 md:px-12" bathy>
 *     <Eyebrow tone="onDark">Verified by M3</Eyebrow> …
 *   </WavePanel>
 */
export function WavePanel({
  as: Tag = 'section',
  tone = 'navy',
  bathy = false,
  bathySeed = 4,
  className,
  children,
  ...rest
}: {
  as?: ElementType;
  /** 'navy' #0b2653, 'deep' #081d40. */
  tone?: 'navy' | 'deep';
  /** Faint sounding lines over the background. */
  bathy?: boolean;
  bathySeed?: number;
  className?: string;
  children?: ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, 'children' | 'className'>) {
  const ref = useRef<HTMLElement>(null);
  const { reduced } = useMotion();
  const inView = useInView(ref, { disabled: reduced, threshold: 0.2 });
  return (
    <Tag ref={ref} className={cn('wave-panel relative isolate overflow-hidden text-white', inView && 'is-in', className)} {...rest}>
      <div
        aria-hidden="true"
        className={cn('wave-panel-bg absolute inset-0 -z-10', tone === 'deep' ? 'bg-navy-deep' : 'bg-navy')}
      >
        {bathy && <BathyPattern seed={bathySeed} className="absolute inset-0" drift />}
      </div>
      <div
        className={cn('transition-[opacity,transform] duration-700 ease-out-smc', inView ? 'opacity-100' : 'translate-y-4 opacity-0')}
        // Wait until the water has nearly reached the top (the rise takes 1.1 s), or a
        // tall panel shows its white text on the not-yet-navy background for a moment.
        style={{ transitionDelay: inView && !reduced ? '750ms' : '0ms' }}
      >
        {children}
      </div>
    </Tag>
  );
}
