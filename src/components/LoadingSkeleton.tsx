import type { FC } from 'react';

/* ────────────────────────────────────────────────────────────
   LoadingSkeleton — reusable loading placeholder component.

   Variants:
     "page"  — full-section centred spinner (replaces full-page loading states)
     "card"  — single card placeholder with shimmer
     "list"  — vertical list of shimmer rows
     "inline" — compact inline spinner for card-content level loading

   Usage:
     <LoadingSkeleton variant="page" />
     <LoadingSkeleton variant="card" count={3} />
     <LoadingSkeleton variant="list" count={5} />
     <LoadingSkeleton variant="inline" />
   ──────────────────────────────────────────────────────────── */

interface LoadingSkeletonProps {
  /** Visual style of the placeholder. Default: "page". */
  variant?: 'page' | 'card' | 'list' | 'inline';
  /** How many skeleton items to render (only relevant for "card" and "list"). Default: 3. */
  count?: number;
  /** Optional extra Tailwind classes on the wrapper. */
  className?: string;
}

/* Shared shimmer bar */
const Shimmer: FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`animate-pulse rounded bg-gray-200 ${className}`} />
);

/* ── Page variant ──────────────────────────────────────────── */
const PageSkeleton: FC = () => (
  <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
    {/* Animated spinner ring */}
    <div className="h-10 w-10 rounded-full border-4 border-gray-200 border-t-[#1e3a5f] animate-spin" />
    <p className="text-sm text-gray-400">Loading...</p>
  </div>
);

/* ── Card variant ──────────────────────────────────────────── */
const CardSkeleton: FC<{ count: number }> = ({ count }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
    {Array.from({ length: count }).map((_, i) => (
      <div
        key={i}
        className="rounded-lg border border-gray-200 bg-white p-5 space-y-4"
      >
        {/* Thumbnail placeholder */}
        <Shimmer className="h-36 w-full rounded-md" />
        {/* Title */}
        <Shimmer className="h-5 w-3/4" />
        {/* Subtitle */}
        <Shimmer className="h-4 w-1/2" />
        {/* Body lines */}
        <div className="space-y-2">
          <Shimmer className="h-3 w-full" />
          <Shimmer className="h-3 w-5/6" />
        </div>
      </div>
    ))}
  </div>
);

/* ── List variant ──────────────────────────────────────────── */
const ListSkeleton: FC<{ count: number }> = ({ count }) => (
  <div className="space-y-4">
    {Array.from({ length: count }).map((_, i) => (
      <div
        key={i}
        className="flex items-center gap-4 rounded-lg border border-gray-200 bg-white p-4"
      >
        {/* Avatar / icon placeholder */}
        <Shimmer className="h-10 w-10 rounded-full shrink-0" />
        {/* Text lines */}
        <div className="flex-1 space-y-2">
          <Shimmer className="h-4 w-2/5" />
          <Shimmer className="h-3 w-3/5" />
        </div>
        {/* Action placeholder */}
        <Shimmer className="h-8 w-20 rounded-md shrink-0" />
      </div>
    ))}
  </div>
);

/* ── Inline variant (for card-content sections) ───────────── */
const InlineSkeleton: FC = () => (
  <div className="flex items-center justify-center py-8 gap-3">
    <div className="h-5 w-5 rounded-full border-2 border-gray-200 border-t-[#1e3a5f] animate-spin" />
    <span className="text-sm text-gray-400">Loading...</span>
  </div>
);

/* ── Main component ────────────────────────────────────────── */
export const LoadingSkeleton: FC<LoadingSkeletonProps> = ({
  variant = 'page',
  count = 3,
  className = '',
}) => {
  const wrapperClass = className ? className : '';

  switch (variant) {
    case 'page':
      return (
        <div className={wrapperClass}>
          <PageSkeleton />
        </div>
      );
    case 'card':
      return (
        <div className={wrapperClass}>
          <CardSkeleton count={count} />
        </div>
      );
    case 'list':
      return (
        <div className={wrapperClass}>
          <ListSkeleton count={count} />
        </div>
      );
    case 'inline':
      return (
        <div className={wrapperClass}>
          <InlineSkeleton />
        </div>
      );
    default:
      return (
        <div className={wrapperClass}>
          <PageSkeleton />
        </div>
      );
  }
};
