import { useId } from 'react';
import { cn } from '@/lib/utils';

/**
 * A chart graticule: a fine grid with graduated edges, like the border of a
 * nautical chart. Sits behind key figures and inside the event route. Purely
 * decorative (aria-hidden); the optional edge labels are abstract degrees, not
 * a real projection.
 *
 *   <Graticule className="absolute inset-0" />                     navy lines on light
 *   <Graticule tone="white" cell={64} labels={['40°N', '30°N']} />  on navy
 */
export function Graticule({
  className,
  cell = 48,
  tone = 'navy',
  opacity,
  graduations = true,
  labels,
}: {
  className?: string;
  /** Grid spacing in px. */
  cell?: number;
  tone?: 'navy' | 'white';
  /** Line opacity; 0.07 by default (0.1 on white). */
  opacity?: number;
  /** Small tick marks along the top and left edges (every quarter cell). */
  graduations?: boolean;
  /** Optional labels along the left edge, top to bottom, one per grid line. */
  labels?: string[];
}) {
  const id = useId().replace(/:/g, '');
  const color = tone === 'white' ? '#ffffff' : 'rgb(11 38 83)';
  const lineOpacity = opacity ?? (tone === 'white' ? 0.1 : 0.07);
  const tick = cell / 4;

  return (
    <svg aria-hidden="true" className={cn('pointer-events-none', className)} width="100%" height="100%">
      <defs>
        <pattern id={`grid-${id}`} width={cell} height={cell} patternUnits="userSpaceOnUse">
          <path d={`M${cell} 0H0V${cell}`} fill="none" stroke={color} strokeOpacity={lineOpacity} strokeWidth="1" />
        </pattern>
        <pattern id={`ticks-x-${id}`} width={tick} height="10" patternUnits="userSpaceOnUse">
          <path d="M0.5 0V5" stroke={color} strokeOpacity={lineOpacity * 2.2} strokeWidth="1" />
        </pattern>
        <pattern id={`ticks-y-${id}`} width="10" height={tick} patternUnits="userSpaceOnUse">
          <path d="M0 0.5H5" stroke={color} strokeOpacity={lineOpacity * 2.2} strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#grid-${id})`} />
      {graduations && (
        <>
          <rect width="100%" height="10" fill={`url(#ticks-x-${id})`} />
          <rect width="10" height="100%" fill={`url(#ticks-y-${id})`} />
        </>
      )}
      {labels?.map((label, i) => (
        <text
          key={label}
          x="14"
          y={(i + 1) * cell - 6}
          fill={color}
          fillOpacity={Math.min(0.6, lineOpacity * 5)}
          fontSize="10"
          letterSpacing="0.06em"
        >
          {label}
        </text>
      ))}
    </svg>
  );
}
