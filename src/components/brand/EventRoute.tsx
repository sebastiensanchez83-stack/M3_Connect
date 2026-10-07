import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMotion } from '@/components/motion/MotionProvider';
import { useScrollProgress } from '@/components/motion/useScrollProgress';
import { useInView } from '@/components/motion/useInView';
import { BathyPattern } from '@/components/motion/BathyPattern';
import { Graticule } from '@/components/motion/Graticule';
import { RevealGroup } from '@/components/motion/Reveal';
import { WaveEdge } from '@/components/motion/WaveEdge';
import { buttonVariants } from '@/components/ui/button';
import { Eyebrow } from './Eyebrow';

/**
 * Route Monaco → Dubai → online: the M3 events as one voyage.
 *
 * Desktop (lg+): a pinned section (outer ≈ 260 vh, sticky inner panel). On an
 * abstract nautical chart (unlabelled graticule and sounding lines, not a real
 * map: no degree labels that the stops' true coordinates would contradict) a
 * small boat sails the dashed route as the page scrolls, drawing the route
 * behind it (SVG getPointAtLength, one rAF-throttled scroll listener, no React
 * render per frame). Each time it reaches a stop, that event's card slides in.
 * Each leg gets the same share of the scroll whatever its length (Monaco →
 * Dubai over 5–40 % of the pin, Dubai → online over 40–72 %), then all three
 * cards stay together for the last stretch. The boat moors just short of the
 * last stop, so its wake never crosses the stop's label.
 *
 * Phones and tablets: a vertical route, top to bottom, no pinning; the dashed
 * line draws itself and the cards are stacked along it.
 *
 * Reduced motion: no pinning, the whole route drawn, every card shown. A card
 * that receives keyboard focus before the boat reaches it shows itself.
 */
export interface RouteStop {
  id: string;
  /** Place name on the chart: "Monaco", "Dubai", "Online". */
  place: string;
  /** Shown under the place on the chart. */
  coords?: string;
  kicker: string;
  title: string;
  lines: string[];
  cta?: { label: string; href: string };
}

/** Chart coordinates (viewBox 640 × 440) of the three stops, in route order. */
const POINTS: [number, number][] = [
  [78, 132],
  [462, 328],
  [580, 92],
];
const ROUTE = 'M78 132 C 160 70, 236 226, 316 252 S 418 360, 462 328 C 528 286, 556 196, 580 92';
/** Scroll progress (0–1 of the pinned stretch) at which the boat reaches each stop. */
const LEG_AT = [0.05, 0.4, 0.72];
/** The boat stops this far (path units) before the last stop. */
const MOOR_SHORT = 26;

function StopCard({ stop, tone }: { stop: RouteStop; tone: 'chart' | 'list' }) {
  return (
    <article
      className={cn(
        'rounded-card p-4 ring-1 ring-inset ring-white/15 xl:p-5',
        tone === 'chart' ? 'bg-white/[0.07] backdrop-blur-sm' : 'bg-white/[0.06]',
      )}
    >
      <p className="font-signage text-[13px] font-semibold uppercase tracking-[0.12em] text-[#9fd6df]">{stop.kicker}</p>
      <h3 className="mt-1.5 text-card-title text-white">{stop.title}</h3>
      <ul className="mt-2 space-y-1 text-sm text-white/80">
        {stop.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {stop.cta && (
        <Link to={stop.cta.href} className={cn(buttonVariants({ variant: 'tideLight', size: 'sm' }), 'mt-3')}>
          {stop.cta.label}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      )}
    </article>
  );
}

function OnlineGlyph({ x, y }: { x: number; y: number }) {
  // Antenna and orbit: "online" without a globe or a map.
  return (
    <g transform={`translate(${x} ${y})`} stroke="#ffffff" fill="none" strokeLinecap="round">
      <ellipse rx="17" ry="6.5" transform="rotate(-22)" strokeOpacity="0.55" strokeWidth="1.2" />
      <circle cx="13" cy="-9" r="2" fill="#ffffff" stroke="none" />
      <path d="M0 -7V-20M-5 -15a7 7 0 0 1 10 0M-9 -19a12 12 0 0 1 18 0" strokeWidth="1.5" strokeOpacity="0.85" />
    </g>
  );
}

export function EventRoute({
  stops,
  eyebrow,
  title,
  intro,
  className,
  headingId,
  above,
}: {
  /** Exactly three, in route order (Monaco, Dubai, online): see eventRouteStops() in m3Events.ts. */
  stops: RouteStop[];
  eyebrow?: string;
  title: string;
  intro?: string;
  className?: string;
  headingId?: string;
  /** Background colour of the section above: the route then opens on a waterline rising out of it. */
  above?: string;
}) {
  const { reduced } = useMotion();
  const uid = useId().replace(/:/g, '');
  const outerRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const maskPathRef = useRef<SVGPathElement>(null);
  const boatRef = useRef<SVGGElement>(null);
  const geometry = useRef<{ total: number; stopLens: number[] } | null>(null);
  const [reached, setReached] = useState(reduced ? stops.length : 1);
  const listRef = useRef<HTMLDivElement>(null);
  const listInView = useInView(listRef, { disabled: reduced, threshold: 0.1 });

  // Path length and where each stop sits along it.
  useEffect(() => {
    const path = pathRef.current;
    if (!path) return;
    const total = path.getTotalLength();
    const stopLens = POINTS.map(([sx, sy], i) => {
      if (i === 0) return 0;
      if (i === POINTS.length - 1) return total;
      let best = 0;
      let bestD = Infinity;
      for (let s = 0; s <= 400; s++) {
        const l = (s / 400) * total;
        const pt = path.getPointAtLength(l);
        const d = (pt.x - sx) ** 2 + (pt.y - sy) ** 2;
        if (d < bestD) {
          bestD = d;
          best = l;
        }
      }
      return best;
    });
    geometry.current = { total, stopLens };
    if (maskPathRef.current) {
      maskPathRef.current.style.strokeDasharray = `${total}`;
      maskPathRef.current.style.strokeDashoffset = reduced ? '0' : `${total}`;
    }
  }, [reduced]);

  const onProgress = useCallback(
    (progress: number) => {
      const g = geometry.current;
      const path = pathRef.current;
      if (!g || !path) return;
      // Piecewise: each leg gets the same share of the scroll, whatever its length.
      let route = 0;
      if (progress >= LEG_AT[2]) route = g.total;
      else if (progress > LEG_AT[0]) {
        const leg = progress < LEG_AT[1] ? 0 : 1;
        const t = (progress - LEG_AT[leg]) / (LEG_AT[leg + 1] - LEG_AT[leg]);
        const from = g.stopLens[leg];
        const to = g.stopLens[leg + 1];
        // Ease in and out of each stop.
        route = from + (to - from) * (t * t * (3 - 2 * t));
      }
      const len = Math.min(route, g.total - MOOR_SHORT);
      const pt = path.getPointAtLength(len);
      const ahead = path.getPointAtLength(Math.min(g.total, len + 2));
      const behind = path.getPointAtLength(Math.max(0, len - 2));
      const angle = (Math.atan2(ahead.y - behind.y, ahead.x - behind.x) * 180) / Math.PI;
      boatRef.current?.setAttribute('transform', `translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)}) rotate(${angle.toFixed(1)})`);
      if (maskPathRef.current) maskPathRef.current.style.strokeDashoffset = `${g.total - route}`;
      const n = g.stopLens.filter((l) => route >= l - 6).length;
      setReached((prev) => (prev === n ? prev : n));
    },
    [],
  );

  useScrollProgress(outerRef, onProgress, { enabled: !reduced });

  useEffect(() => {
    if (reduced) setReached(stops.length);
  }, [reduced, stops.length]);

  const heading = (light: boolean): ReactNode => (
    <div className="max-w-2xl">
      {eyebrow && <Eyebrow tone="onDark">{eyebrow}</Eyebrow>}
      <h2 id={light ? headingId : undefined} className="mt-3 text-h2-sm text-white md:text-h2">{title}</h2>
      {intro && <p className="mt-3 text-body text-white/80 md:text-body-lg">{intro}</p>}
    </div>
  );

  const pinned = !reduced;

  return (
    <section aria-labelledby={headingId} className={cn('relative isolate overflow-clip bg-navy-deep text-white', className)}>
      {above && <WaveEdge color="rgb(8 29 64)" className="-mb-px h-12 md:h-16" style={{ backgroundColor: above }} />}
      {/* ── Desktop: the chart ── */}
      <div ref={outerRef} className="relative hidden lg:block" style={{ height: pinned ? '260vh' : undefined }}>
        <div className={cn('flex items-center overflow-hidden', pinned ? 'sticky top-0 h-screen' : 'py-24')}>
          <BathyPattern seed={7} className="absolute inset-0" drift />
          {/* Heading and chart on the left, the cards on the right: the whole panel
              fits a 768 px-high laptop screen (the chart shrinks with the height). */}
          <div className="relative mx-auto grid w-full max-w-7xl grid-cols-12 items-center gap-10 px-6 pt-14">
            <div className="col-span-7">
              {heading(true)}
              <div className="relative mt-6">
                <div
                  className="relative overflow-hidden rounded-card ring-1 ring-inset ring-white/10"
                  style={pinned ? { maxWidth: 'min(100%, calc((100vh - 330px) * 1.4545))' } : undefined}
                >
                  {/* Abstract chart: graduations only, no degree labels. */}
                  <Graticule tone="white" cell={44} className="absolute inset-0 h-full w-full" />
                  <svg viewBox="0 0 640 440" className="relative block h-auto w-full" role="img" aria-label={stops.map((s) => s.place).join(' → ')}>
                    <defs>
                      <mask id={`route-${uid}`} maskUnits="userSpaceOnUse" x="0" y="0" width="640" height="440">
                        <path ref={maskPathRef} d={ROUTE} stroke="#ffffff" strokeWidth="12" fill="none" />
                      </mask>
                    </defs>
                    {/* The planned route, faint; the sailed part, drawn behind the boat. */}
                    <path d={ROUTE} fill="none" stroke="#ffffff" strokeOpacity="0.22" strokeWidth="2" strokeDasharray="1 9" strokeLinecap="round" />
                    <path ref={pathRef} d={ROUTE} fill="none" stroke="#ffffff" strokeWidth="2.5" strokeDasharray="10 8" strokeLinecap="round" mask={`url(#route-${uid})`} />
                    {POINTS.map(([x, y], i) => {
                      const stop = stops[i];
                      if (!stop) return null;
                      const on = i < reached;
                      const labelBelow = i !== 2;
                      return (
                        <g key={stop.id}>
                          {on && pinned && <circle cx={x} cy={y} r="7" fill="#ffffff" fillOpacity="0.35" className="route-pulse" />}
                          {i === 2 ? (
                            <OnlineGlyph x={x} y={y} />
                          ) : (
                            <circle cx={x} cy={y} r="6" fill={on ? '#ffffff' : 'rgb(8 29 64)'} stroke="#ffffff" strokeWidth="2" style={{ transition: 'fill .4s' }} />
                          )}
                          <text x={x} y={labelBelow ? y + 28 : y + 30} textAnchor="middle" fill="#ffffff" fontSize="14" fontWeight="600">
                            {stop.place}
                          </text>
                          {stop.coords && (
                            <text x={x} y={labelBelow ? y + 44 : y + 46} textAnchor="middle" fill="#ffffff" fillOpacity="0.6" fontSize="10" letterSpacing="0.06em">
                              {stop.coords}
                            </text>
                          )}
                        </g>
                      );
                    })}
                    {/* The boat, pointing east; positioned and turned by the scroll handler. */}
                    <g ref={boatRef} transform={`translate(${POINTS[0][0]} ${POINTS[0][1]})`} style={{ display: pinned ? undefined : 'none' }}>
                      <path d="M-22 1h-8M-22 5h-12" stroke="#ffffff" strokeOpacity="0.45" strokeWidth="1.5" strokeLinecap="round" />
                      <path d="M-14 -1h24l6 -5h-6l-3 -4h-11l-3 4h-7z" fill="#ffffff" transform="translate(0 4)" />
                      <path d="M-12 3h22" stroke="rgb(8 29 64)" strokeWidth="1" />
                    </g>
                  </svg>
                </div>
              </div>
            </div>
            <ol className="col-span-5 space-y-3">
              {stops.map((stop, i) => (
                <li key={stop.id} className={cn('route-card', (i < reached || !pinned) && 'is-on')}>
                  <StopCard stop={stop} tone="chart" />
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      {/* ── Phones and tablets: a vertical route ── */}
      <div className="relative px-4 py-16 sm:px-6 lg:hidden">
        <BathyPattern seed={7} className="absolute inset-0" />
        <div className="relative mx-auto max-w-2xl">
          {heading(false)}
          <div ref={listRef} className={cn('chenal relative mt-10', listInView && 'is-in')}>
            <span aria-hidden="true" className="chenal-line-v absolute bottom-4 left-[15px] top-4 w-0 border-l-2 border-dashed border-white/40" />
            <RevealGroup as="ol" className="relative space-y-8">
              {stops.map((stop, i) => (
                <li key={stop.id} className="relative pl-12">
                  <span aria-hidden="true" className="absolute left-0 top-1 grid h-8 w-8 place-items-center rounded-full bg-navy-deep ring-2 ring-white">
                    <span className="text-xs font-semibold tabular">{i + 1}</span>
                  </span>
                  <p className="text-sm font-semibold text-white">
                    {stop.place}
                    {stop.coords && <span className="ml-2 text-xs font-normal text-white/60">{stop.coords}</span>}
                  </p>
                  <div className="mt-3">
                    <StopCard stop={stop} tone="list" />
                  </div>
                </li>
              ))}
            </RevealGroup>
          </div>
        </div>
      </div>
    </section>
  );
}
