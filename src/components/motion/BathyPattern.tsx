import { useMemo } from 'react';
import { cn } from '@/lib/utils';

/**
 * Sounding lines: the depth contours of a nautical chart, drawn as nested
 * irregular rings around two "shoals". An SMC motif (not a Solar Impulse one),
 * used very faintly on navy panels, the footer and pages without a photo.
 *
 * Deterministic: the same `seed` always draws the same chart, so a panel looks
 * identical across reloads. Decorative only (aria-hidden). With `drift`, the
 * whole drawing slides very slowly (60 s, alternate), paused by the global
 * motion control and absent under reduced motion.
 *
 *   <BathyPattern className="absolute inset-0" />                       white, 7 %
 *   <BathyPattern tone="navy" opacity={0.08} drift seed={3} />
 */

/** Small seeded PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Closed Catmull-Rom spline through the points, as cubic Béziers. */
function closedPath(points: [number, number][]): string {
  const n = points.length;
  const f = (v: number) => v.toFixed(1);
  let d = `M${f(points[0][0])} ${f(points[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d}Z`;
}

function contourSet(cx: number, cy: number, rings: number, baseR: number, gap: number, rand: () => number): string[] {
  // One shape for the whole set (same harmonics), scaled per ring: rings never cross.
  const harmonics = [2, 3, 5].map((k) => ({ k, amp: 0.05 + rand() * 0.09, phase: rand() * Math.PI * 2 }));
  const stretch = 0.75 + rand() * 0.5;
  const tilt = rand() * Math.PI;
  const out: string[] = [];
  for (let r = 0; r < rings; r++) {
    const radius = baseR + r * gap * (1 + r * 0.04);
    const pts: [number, number][] = [];
    const N = 40;
    for (let i = 0; i < N; i++) {
      const th = (i / N) * Math.PI * 2;
      let m = 1;
      // Outer rings wobble a little more, like real contours.
      for (const h of harmonics) m += h.amp * (1 + r * 0.06) * Math.sin(h.k * th + h.phase + r * 0.05);
      const x0 = Math.cos(th) * radius * m * stretch;
      const y0 = Math.sin(th) * radius * m;
      pts.push([cx + x0 * Math.cos(tilt) - y0 * Math.sin(tilt), cy + x0 * Math.sin(tilt) + y0 * Math.cos(tilt)]);
    }
    out.push(closedPath(pts));
  }
  return out;
}

export function BathyPattern({
  className,
  seed = 1,
  rings = 9,
  tone = 'white',
  opacity,
  drift = false,
  driftReverse = false,
  strokeWidth = 1,
}: {
  className?: string;
  seed?: number;
  /** Rings per shoal. */
  rings?: number;
  /** 'white' on navy and photos, 'navy' on light backgrounds. */
  tone?: 'white' | 'navy' | 'teal';
  /** Stroke opacity; defaults to 0.07 (white) or 0.08 (navy/teal). */
  opacity?: number;
  /** Very slow drift (60 s). */
  drift?: boolean;
  /** The same, mirrored and in the other direction (70 s): lay it over a `drift` one. */
  driftReverse?: boolean;
  strokeWidth?: number;
}) {
  const paths = useMemo(() => {
    const rand = rng(seed * 9973 + 17);
    const a = contourSet(180 + rand() * 120, 160 + rand() * 120, rings, 26, 30, rand);
    const b = contourSet(560 + rand() * 140, 380 + rand() * 120, Math.max(3, rings - 2), 22, 34, rand);
    return [...a, ...b];
  }, [seed, rings]);

  const stroke = tone === 'white' ? '#ffffff' : tone === 'teal' ? 'rgb(31 122 140)' : 'rgb(11 38 83)';
  const strokeOpacity = opacity ?? (tone === 'white' ? 0.07 : 0.08);

  return (
    <div aria-hidden="true" className={cn('pointer-events-none overflow-hidden', className)}>
      <svg
        viewBox="0 0 800 600"
        preserveAspectRatio="xMidYMid slice"
        className={cn('h-full w-full', drift && 'bathy-drift motion-loop', driftReverse && 'bathy-drift-b motion-loop')}
        fill="none"
        stroke={stroke}
        strokeOpacity={strokeOpacity}
        strokeWidth={strokeWidth}
      >
        {paths.map((d, i) => (
          <path key={i} d={d} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
    </div>
  );
}
