import { X, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AdminContextBannerProps {
  /** Human-readable label for the active filter, e.g. "Pending users" */
  label: string;
  /** Total count of matching items */
  count?: number;
  /** Callback to clear all filters */
  onClear: () => void;
  /** Optional accent color */
  color?: 'blue' | 'amber' | 'red' | 'green' | 'violet' | 'pink';
}

// Refonte tokens: teal on foam for a plain filter, amber / red / green for a
// state that needs attention or is settled. Violet and pink are not part of the
// palette any more and fall back to the plain filter look.
const colorMap = {
  blue: 'border-teal/25 bg-foam text-navy',
  amber: 'border-amber-200 bg-amber-50 text-amber-950',
  red: 'border-red-200 bg-red-50 text-red-950',
  green: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  violet: 'border-teal/25 bg-foam text-navy',
  pink: 'border-teal/25 bg-foam text-navy',
};

/**
 * Context banner displayed when an admin arrives on a list with pre-set filters (from a
 * dashboard figure, a link). It says in plain words that the list is filtered and what by,
 * and its button, a pill that looks pressable at rest, shows everything again. On a phone
 * the button goes under the sentence.
 */
export function AdminContextBanner({ label, count, onClear, color = 'blue' }: AdminContextBannerProps) {
  return (
    <div role="status" className={cn('mb-4 flex flex-col gap-2.5 rounded-card border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3', colorMap[color])}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[14px] leading-5">
        <Filter className="h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
        <span className="font-semibold">Showing only:</span>
        <span className="[overflow-wrap:anywhere]">{label}</span>
        {count !== undefined && (
          <span className="rounded-pill bg-white/80 px-2 py-0.5 text-[12px] font-semibold tabular-nums">{count} result{count !== 1 ? 's' : ''}</span>
        )}
      </div>
      <button
        type="button"
        onClick={onClear}
        className="inline-flex min-h-10 shrink-0 items-center gap-1.5 self-start rounded-pill border border-navy/55 bg-white px-4 text-[14px] font-semibold text-navy transition-colors hover:border-navy hover:bg-chip focus:outline-none focus-visible:shadow-focus sm:self-auto"
      >
        <X className="h-4 w-4" aria-hidden="true" />
        Show everything
      </button>
    </div>
  );
}
