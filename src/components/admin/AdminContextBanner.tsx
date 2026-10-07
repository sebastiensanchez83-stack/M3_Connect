import { X, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
 * Context banner displayed when an admin arrives on a tab with pre-set filters.
 * Clearly tells the admin what they're looking at + one-click clear.
 */
export function AdminContextBanner({ label, count, onClear, color = 'blue' }: AdminContextBannerProps) {
  return (
    <div className={cn('mb-4 flex items-center justify-between gap-3 rounded-card border px-4 py-2', colorMap[color])}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[14px] font-medium leading-5">
        <Filter className="h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
        <span className="[overflow-wrap:anywhere]">{label}</span>
        {count !== undefined && (
          <span className="rounded-pill bg-white/70 px-2 py-0.5 text-[12px] font-semibold tabular-nums">{count} result{count !== 1 ? 's' : ''}</span>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 shrink-0 gap-1 rounded-pill px-3 text-[13px] hover:bg-white/70"
        onClick={onClear}
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
        Clear filter
      </Button>
    </div>
  );
}
