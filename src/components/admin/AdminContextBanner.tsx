import { X, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';

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

const colorMap = {
  blue: 'bg-blue-50 border-blue-200 text-blue-800',
  amber: 'bg-amber-50 border-amber-200 text-amber-800',
  red: 'bg-red-50 border-red-200 text-red-800',
  green: 'bg-green-50 border-green-200 text-green-800',
  violet: 'bg-violet-50 border-violet-200 text-violet-800',
  pink: 'bg-pink-50 border-pink-200 text-pink-800',
};

/**
 * Context banner displayed when an admin arrives on a tab with pre-set filters.
 * Clearly tells the admin what they're looking at + one-click clear.
 */
export function AdminContextBanner({ label, count, onClear, color = 'blue' }: AdminContextBannerProps) {
  return (
    <div className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 mb-4 ${colorMap[color]}`}>
      <div className="flex items-center gap-2 text-sm font-medium">
        <Filter className="h-4 w-4 shrink-0 opacity-70" />
        <span>{label}</span>
        {count !== undefined && (
          <span className="bg-white/60 rounded-full px-2 py-0.5 text-xs font-bold">{count} result{count !== 1 ? 's' : ''}</span>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-xs hover:bg-white/60 gap-1"
        onClick={onClear}
      >
        <X className="h-3 w-3" />
        Clear filter
      </Button>
    </div>
  );
}
