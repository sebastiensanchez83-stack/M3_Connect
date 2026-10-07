import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

/**
 * A waterline: one or more wave layers filled down to the bottom of the band,
 * each drifting sideways on its own period. It replaces a straight edge where a
 * hero meets the page (WaterlineHero, PageHero) and where the footer rises
 * (HorizonEdge).
 *
 * Each layer is an SVG twice as wide as the band, holding two identical tiles,
 * translated by -50 % in a loop: a seamless drift on the compositor (transform
 * only). Static under reduced motion, frozen by the global pause.
 *
 *   <WaveEdge color="#f6f7f9" className="absolute inset-x-0 -bottom-px h-12" />
 */
export interface WaveLayer {
  /** Fill colour (any CSS colour). */
  color: string;
  opacity?: number;
  /** Quadratic control offset in viewBox units (the band is 100 units tall); the crest rises half of it. */
  amp?: number;
  /** Half-waves per tile: an even number keeps the tile seamless. */
  halfWaves?: number;
  /** Where the wave's middle sits, 0 (top) → 100 (bottom). */
  baseline?: number;
  /** Seconds for one tile to pass. */
  period?: number;
  reverse?: boolean;
  /** Horizontal phase shift in tile fractions (0–1), so two layers do not line up. */
  phase?: number;
}

const TILE = 1440;

/** The fill-below path for one tile pair (2 × TILE wide, 100 tall). */
export function wavePath({ amp = 10, halfWaves = 4, baseline = 50, phase = 0 }: Pick<WaveLayer, 'amp' | 'halfWaves' | 'baseline' | 'phase'>): string {
  const w = TILE / halfWaves;
  const shift = (phase % 1) * TILE;
  const f = (v: number) => Math.round(v * 10) / 10;
  // Start one half-wave early so the phase shift never leaves a gap at the left edge.
  const start = -shift - w * 2;
  let d = `M${f(start)} ${baseline}`;
  const steps = Math.ceil((2 * TILE - start) / w) + 2;
  for (let i = 0; i < steps; i++) {
    const x = start + i * w;
    const dir = i % 2 === 0 ? -1 : 1;
    d += `Q${f(x + w / 2)} ${f(baseline + dir * amp)} ${f(x + w)} ${baseline}`;
  }
  return `${d}V100H${f(start)}Z`;
}

export function WaveEdge({
  color,
  layers,
  animated = true,
  className,
  style,
}: {
  /** Shortcut for the usual two layers: a soft one behind, the solid one in front. */
  color?: string;
  layers?: WaveLayer[];
  animated?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const all: WaveLayer[] =
    layers ??
    [
      { color: color ?? '#ffffff', opacity: 0.45, amp: 34, halfWaves: 6, baseline: 46, period: 11, reverse: true, phase: 0.33 },
      { color: color ?? '#ffffff', opacity: 1, amp: 26, halfWaves: 4, baseline: 62, period: 7.5 },
    ];

  return (
    <div aria-hidden="true" className={cn('pointer-events-none relative overflow-hidden', className)} style={style}>
      {all.map((layer, i) => (
        <svg
          key={i}
          viewBox={`0 0 ${TILE * 2} 100`}
          preserveAspectRatio="none"
          className={cn(
            'absolute inset-y-0 left-0 h-full w-[200%]',
            animated && (layer.reverse ? 'wave-drift-reverse' : 'wave-drift'),
            animated && 'motion-loop',
          )}
          style={{ '--wave-period': `${layer.period ?? 8}s` } as CSSProperties}
        >
          <path d={wavePath(layer)} fill={layer.color} fillOpacity={layer.opacity ?? 1} />
        </svg>
      ))}
    </div>
  );
}
