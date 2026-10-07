import { useRef, type ElementType, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { BathyPattern } from '@/components/motion/BathyPattern';
import { useMotion } from '@/components/motion/MotionProvider';
import { useInView } from '@/components/motion/useInView';

/**
 * A navy rounded panel (24 px radius, 32 px from md, 8 / 12 px side margins)
 * whose background scales from .94 to 1 while it fades in (.9 s,
 * cubic-bezier(.215,.61,.355,1)) when it scrolls into view, then its content
 * rises (+220 ms). Replaces the old wave-edged panel.
 *
 *   <BgRevealPanel bathy className="py-14 md:py-20">
 *     <div className="mx-auto max-w-7xl px-4 sm:px-6"> … </div>
 *   </BgRevealPanel>
 *
 * Under reduced motion it shows its final state. Add your own padding and width.
 */
export function BgRevealPanel({
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
  /** Faint sounding lines drifting over the background. */
  bathy?: boolean;
  bathySeed?: number;
  className?: string;
  children?: ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, 'children' | 'className'>) {
  const ref = useRef<HTMLElement>(null);
  const { reduced } = useMotion();
  const inView = useInView(ref, { disabled: reduced });
  return (
    <Tag
      ref={ref}
      className={cn('bgr relative isolate mx-2 overflow-hidden rounded-[24px] text-white md:mx-3 md:rounded-[32px]', inView && 'is-in', className)}
      {...rest}
    >
      <div
        aria-hidden="true"
        className={cn('bgr-bg absolute inset-0 -z-10 overflow-hidden rounded-[inherit]', tone === 'deep' ? 'bg-navy-deep' : 'bg-navy')}
      >
        {bathy && <BathyPattern seed={bathySeed} className="absolute inset-0" drift />}
      </div>
      <div className="bgr-content">{children}</div>
    </Tag>
  );
}
