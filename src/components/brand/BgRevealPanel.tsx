import { useRef, type ElementType, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { BathyPattern } from '@/components/motion/BathyPattern';
import { useMotion } from '@/components/motion/MotionProvider';
import { useEntrance } from '@/components/motion/useInView';

/**
 * A navy rounded panel (24 px radius, 32 px from md, 8 / 12 px side margins).
 * When it arrives from below the fold its background, fully navy from the
 * start, settles from .97 to 1 (300 ms, cubic-bezier(.215,.61,.355,1)) while
 * its content rises (+60 ms). The design audit of 8 Oct 2026 found the old
 * version (a .9 s fade of the whole background) "almost invisible" while it
 * played: the navy is never faded any more. Replaces the old wave-edged panel.
 *
 *   <BgRevealPanel bathy className="py-14 md:py-20">
 *     <div className="mx-auto max-w-7xl px-4 sm:px-6"> … </div>
 *   </BgRevealPanel>
 *
 * Already on screen when it mounts, or under reduced motion, it shows its final
 * state at once. Add your own padding and width.
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
  const phase = useEntrance(ref, reduced);
  return (
    <Tag
      ref={ref}
      className={cn(
        'bgr relative isolate mx-2 overflow-hidden rounded-[24px] text-white md:mx-3 md:rounded-[32px]',
        phase === 'armed' && 'is-armed',
        phase === 'in' && 'is-entering',
        className,
      )}
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
