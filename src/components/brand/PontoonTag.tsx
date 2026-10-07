import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, ChevronDown, Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMotion } from '@/components/motion/MotionProvider';
import { useOnScreen } from '@/components/motion/useInView';

/**
 * "Étiquette de ponton": the hero's M3-events tag, shaped so it can only be a
 * harbour tag. A navy berth plate with chamfered top corners and a thin brass
 * rule, a punched eyelet (brass ring, the picture shows through the hole) and
 * a rope running up to a horn cleat that sits on the waterline. It hangs a
 * little askew (-2°), swings once (±1.5°, damped pendulum) when the page opens
 * and again on hover, and turns over (vertical flip) to the next M3 event
 * every 6 s. A berth counter ("1/3"), a next button and a pause button sit
 * under the plate.
 *
 * WaterlineHero places it so the cleat rests on its living waterline (from md
 * up). On phones it sits in the flow under the hero text and draws its own
 * short crest under the cleat (`crest`).
 *
 * The cycle pauses on hover and keyboard focus, with its own pause button,
 * with the global motion pause, off screen and in a background tab, and never
 * starts under reduced motion. Only the visible item is focusable; the region
 * is not live, so screen readers are not interrupted by the cycle.
 */
export interface PontoonTagItem {
  id: string;
  /** Small line above the title: place · date. */
  kicker: string;
  title: string;
  meta?: string;
  href: string;
  /** Call-to-action words, e.g. "Request an invitation". */
  cta?: string;
}

/** Chamfered top corners: the silhouette of a tag, not of a card. */
const PLATE_SHAPE = 'polygon(22px 0, calc(100% - 22px) 0, 100% 22px, 100% 100%, 0 100%, 0 22px)';
/** The eyelet's hole, punched through the plate (centre 50 % / 21 px, radius 7 px). */
const EYELET_HOLE = 'radial-gradient(circle 7px at 50% 21px, transparent 6.5px, #000 7.5px)';

export function PontoonTag({
  items,
  interval = 6000,
  label,
  crest = true,
  className,
}: {
  items: PontoonTagItem[];
  interval?: number;
  /** Accessible name of the tag, e.g. "M3 events". */
  label: string;
  /** Draw a short wave under the cleat below md (where the tag is not on the hero's own waterline). */
  crest?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const { still, reduced } = useMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(rootRef, reduced);
  const [index, setIndex] = useState(0);
  const [leaving, setLeaving] = useState<number | null>(null);
  const [entering, setEntering] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [hoverPaused, setHoverPaused] = useState(false);
  const [swingOnLoad, setSwingOnLoad] = useState(true);
  const leaveTimer = useRef<number>();

  const count = items.length;
  const auto = !still && !userPaused && !hoverPaused && onScreen && count > 1;

  const indexRef = useRef(0);
  indexRef.current = index;

  const go = (next: number) => {
    if (next === indexRef.current) return;
    window.clearTimeout(leaveTimer.current);
    setIndex(next);
    // Reduced motion: no turn-over, the new item simply replaces the old one.
    if (reduced) return;
    setLeaving(indexRef.current);
    setEntering(true);
    leaveTimer.current = window.setTimeout(() => {
      setLeaving(null);
      setEntering(false);
    }, 760);
  };
  const goRef = useRef(go);
  goRef.current = go;

  useEffect(() => {
    if (!auto) return;
    const timer = window.setInterval(() => goRef.current((indexRef.current + 1) % count), interval);
    return () => window.clearInterval(timer);
  }, [auto, interval, count]);

  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);

  if (count === 0) return null;
  const safeIndex = Math.min(index, count - 1);
  const pauseLabel = userPaused ? t('brand.tag.play', 'Resume the events') : t('brand.tag.pause', 'Pause the events');
  const nextLabel = t('brand.tag.next', 'Next event');

  return (
    <div
      ref={rootRef}
      role="region"
      aria-roledescription={t('brand.tag.roledescription', 'carousel')}
      aria-label={label}
      className={cn('pontoon pointer-events-auto relative w-[288px] sm:w-[312px]', className)}
      onMouseEnter={() => setHoverPaused(true)}
      onMouseLeave={() => setHoverPaused(false)}
      onFocus={() => setHoverPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHoverPaused(false);
      }}
    >
      <div
        // The shadow follows the plate's shape (a box-shadow would be cut by its clip-path).
        className={cn('pontoon-swing [filter:drop-shadow(0_18px_26px_rgba(8,29,64,.38))]', swingOnLoad && 'is-loading')}
        onAnimationEnd={(e) => {
          if (e.animationName === 'smc-tag-swing-a') setSwingOnLoad(false);
        }}
      >
        {/* Horn cleat on the waterline, and the rope down to the eyelet. */}
        <svg aria-hidden="true" viewBox="0 0 312 50" className="relative z-10 -mb-[29px] block h-[50px] w-full overflow-visible">
          {crest && (
            <path
              className="md:hidden"
              d="M96 21 Q 112 13 128 21 T 160 21 T 192 21 T 224 21"
              fill="none"
              stroke="#ffffff"
              strokeOpacity="0.55"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          )}
          {/* Cleat: a base and two horns. */}
          <path d="M138 15 h36 a3 3 0 0 0 0 -6 h-6 l-4 -3 h-16 l-4 3 h-6 a3 3 0 0 0 0 6 z" fill="#e9e3d2" stroke="rgb(8 29 64)" strokeOpacity="0.35" strokeWidth="1" />
          <rect x="150" y="15" width="12" height="5" rx="1.5" fill="#cfc6ae" />
          {/* Rope: two twisted strands from the cleat, through the eyelet. */}
          <path d="M156 13 C 152 26, 160 34, 156 50 M156 50 c -5 1 -6 -6 0 -6" stroke="#e8dcc0" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M156 13 C 152 26, 160 34, 156 50" stroke="#b9a882" strokeWidth="3" strokeDasharray="2 3" fill="none" strokeLinecap="round" />
        </svg>

        {/* The plate. */}
        <div
          className="relative bg-navy text-white"
          style={{ clipPath: PLATE_SHAPE, WebkitMaskImage: EYELET_HOLE, maskImage: EYELET_HOLE }}
        >
          {/* Thin brass rule, inset. */}
          <span aria-hidden="true" className="pointer-events-none absolute inset-[5px] border border-[#c9a24f]/55" style={{ clipPath: 'polygon(18px 0, calc(100% - 18px) 0, 100% 18px, 100% 100%, 0 100%, 0 18px)' }} />
          {/* Eyelet: a brass ring around the punched hole. */}
          <span aria-hidden="true" className="absolute left-1/2 top-[11px] h-5 w-5 -translate-x-1/2 rounded-full border-[3px] border-[#c9a24f] shadow-[inset_0_1px_1px_rgba(0,0,0,.45)]" />

          <div className="relative h-[124px] overflow-hidden [perspective:600px]" style={{ marginTop: 34 }}>
            {items.map((item, i) => {
              const active = i === safeIndex;
              const isLeaving = i === leaving;
              return (
                <div
                  key={item.id}
                  aria-hidden={!active}
                  className={cn(
                    'pontoon-slide absolute inset-0',
                    active && entering && 'is-entering',
                    isLeaving && 'is-leaving',
                    !active && !isLeaving && 'invisible',
                  )}
                >
                  <Link
                    to={item.href}
                    tabIndex={active ? undefined : -1}
                    // Inset ring: the plate's shape clips anything drawn outside.
                    className="group mx-[7px] flex h-full flex-col justify-between px-4 pb-3 pt-1 outline-none focus-visible:shadow-[inset_0_0_0_2px_#ffffff,inset_0_0_0_4px_rgb(11_38_83)]"
                  >
                    <span>
                      <span className="block font-signage text-[12px] font-semibold uppercase tracking-[0.14em] text-[#9fd6df] [text-shadow:0_1px_0_rgba(0,0,0,.35)]">
                        {item.kicker}
                      </span>
                      <span className="mt-1 block font-signage text-[19px] font-semibold uppercase leading-[22px] tracking-[0.03em] text-white [text-shadow:0_1px_0_rgba(0,0,0,.4)]">
                        {item.title}
                      </span>
                      {item.meta && <span className="mt-1 block text-[13px] leading-[18px] text-white/80">{item.meta}</span>}
                    </span>
                    {item.cta && (
                      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-white underline-offset-4 group-hover:underline">
                        {item.cta}
                        <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-[3px]" aria-hidden="true" />
                      </span>
                    )}
                  </Link>
                </div>
              );
            })}
          </div>

          {count > 1 && (
            <div className="relative mx-[7px] mb-[7px] mt-1 flex items-center justify-between border-t border-white/15 pl-4 pr-1">
              <span aria-hidden="true" className="font-signage text-[13px] font-semibold tabular tracking-[0.14em] text-white/75">
                {safeIndex + 1}/{count}
              </span>
              <div className="flex items-center">
                <button
                  type="button"
                  onClick={() => go((safeIndex + 1) % count)}
                  aria-label={nextLabel}
                  title={nextLabel}
                  className="grid h-11 w-11 place-items-center rounded-full text-white/85 outline-none hover:bg-white/10 focus-visible:shadow-[inset_0_0_0_2px_#ffffff] md:h-9 md:w-9"
                >
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                </button>
                {!still && (
                  <button
                    type="button"
                    onClick={() => setUserPaused((p) => !p)}
                    aria-label={pauseLabel}
                    title={pauseLabel}
                    className="grid h-11 w-11 place-items-center rounded-full text-white/85 outline-none hover:bg-white/10 focus-visible:shadow-[inset_0_0_0_2px_#ffffff] md:h-9 md:w-9"
                  >
                    {userPaused ? <Play className="h-3.5 w-3.5" aria-hidden="true" /> : <Pause className="h-3.5 w-3.5" aria-hidden="true" />}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
