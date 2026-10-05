import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A toggle in a filter bar. 40 px tall — a comfortable thumb target without
 * towering over the bar — and aria-pressed, so assistive tech announces it as
 * on/off rather than as a plain button.
 *
 * An optional `count` sits after the label in a tone that keeps AA contrast in
 * both states (the old opacity-60 count did not).
 */
export function FilterChip({
  active,
  onClick,
  icon: Icon,
  count,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  icon?: LucideIcon;
  count?: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-sm font-medium transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
        active ? 'bg-primary text-white shadow-sm' : 'bg-gray-100 text-gray-700 hover:bg-gray-200',
        className,
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
      {children}
      {count !== undefined && (
        <span className={cn('tabular-nums', active ? 'text-white/80' : 'text-gray-500')}>{count}</span>
      )}
    </button>
  );
}

/**
 * The bar that holds FilterChips. Phones scroll it sideways (scrollbar hidden);
 * from md up it wraps, so nothing ever hides off-screen. Pass `sticky` when it
 * should stay under the 64 px navbar while the list scrolls.
 */
export function FilterBar({
  sticky = false,
  children,
  className,
}: {
  sticky?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'border-y border-gray-200 bg-white/95 backdrop-blur',
        sticky && 'sticky top-16 z-30',
        className,
      )}
    >
      <div className="no-scrollbar container mx-auto flex items-center gap-2 overflow-x-auto px-4 py-2.5 md:flex-wrap md:overflow-visible">
        {children}
      </div>
    </section>
  );
}
