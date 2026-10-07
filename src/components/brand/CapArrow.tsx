import { cn } from '@/lib/utils';

/**
 * "Cap": a small compass rose that follows the words of a link ("Read",
 * "View profile", a signpost…). Four short cardinal ticks, no ring and no disc:
 * it is a chart mark, not a round arrow button. The needle is a lozenge whose
 * pointing half is filled and whose tail is outlined; at rest it points
 * north-east, and when its card (any `group` ancestor) is hovered or holds
 * keyboard focus it swings to east with a slight overshoot (0.6 s), while a
 * narrow radar wedge sweeps once under it (0.8 s). Outside a group, add
 * `cap-hover` to the element that should trigger it.
 *
 * Always inline, after text or in a meta row; never alone in a card corner and
 * never over a photo. Decorative (aria-hidden): the link carries the words.
 */
export function CapArrow({
  className,
  size = 'md',
  tone = 'light',
}: {
  className?: string;
  /** sm 18 px, md 22 px, lg 28 px. */
  size?: 'sm' | 'md' | 'lg';
  /** 'light' navy on light backgrounds; 'dark' white on navy ('photo' is kept as an alias of 'dark'). */
  tone?: 'light' | 'dark' | 'photo';
}) {
  const box = size === 'sm' ? 'h-[18px] w-[18px]' : size === 'lg' ? 'h-7 w-7' : 'h-[22px] w-[22px]';
  const onDark = tone !== 'light';
  return (
    <span aria-hidden="true" className={cn('cap', box, onDark ? 'text-white' : 'text-navy', className)}>
      {/* The four cardinal ticks. */}
      <svg viewBox="0 0 24 24" className="h-full w-full" fill="none" stroke="currentColor" strokeLinecap="round">
        <path d="M12 1.5v3M22.5 12h-3M12 22.5v-3M1.5 12h3" strokeOpacity="0.55" strokeWidth="1.5" />
      </svg>
      {/* The radar wedge: a 50° sector that turns with the needle and fades. */}
      <svg viewBox="0 0 24 24" className="cap-sweep h-full w-full">
        <path d="M12 12 L21 12 A9 9 0 0 0 17.79 5.11 Z" fill={onDark ? '#7fc8d4' : 'rgb(31 122 140)'} fillOpacity="0.7" />
      </svg>
      {/* The needle points east; turned -45° (north-east) at rest. */}
      <svg viewBox="0 0 24 24" className="cap-needle h-full w-full">
        <path d="M12 8.6 20.5 12 12 15.4Z" fill="currentColor" />
        <path d="M12 8.6 3.5 12 12 15.4Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="1.3" fill={onDark ? 'rgb(8 29 64)' : '#ffffff'} />
      </svg>
    </span>
  );
}
