import { OrgTier, TIER_LABELS, TIER_COLORS, isSponsorTier } from '@/types/database';

interface SponsorBadgeProps {
  tier: OrgTier;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function SponsorBadge({ tier, size = 'md', className = '' }: SponsorBadgeProps) {
  // Only render for sponsor tiers (not 'member')
  if (!isSponsorTier(tier)) return null;

  const colors = TIER_COLORS[tier];
  const label = TIER_LABELS[tier];

  const sizeClasses = {
    sm: 'text-[10px] px-1.5 py-0.5',
    md: 'text-xs px-2 py-0.5',
    lg: 'text-sm px-3 py-1',
  };

  return (
    <span
      className={`inline-flex items-center gap-1 font-semibold rounded-full border ${colors.bg} ${colors.text} ${colors.border} ${sizeClasses[size]} ${className}`}
    >
      <svg className={size === 'sm' ? 'w-2.5 h-2.5' : size === 'lg' ? 'w-4 h-4' : 'w-3 h-3'} viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 1l2.1 4.3 4.7.7-3.4 3.3.8 4.7L8 11.8 3.8 14l.8-4.7L1.2 6l4.7-.7L8 1z" />
      </svg>
      {label}
    </span>
  );
}
