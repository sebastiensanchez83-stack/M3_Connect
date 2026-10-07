import { useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from 'react';
import type { SiteImage } from '@/lib/siteMedia';
import { gradientForSeed } from '@/components/ui/CoverImage';
import { cn } from '@/lib/utils';
import { useMotion } from '@/components/motion/MotionProvider';
import { useMediaQuery } from '@/components/motion/useReducedMotion';
import { useOnScreen } from '@/components/motion/useInView';
import { useParallax } from '@/components/motion/useParallax';
import { BathyPattern } from '@/components/motion/BathyPattern';
import { MotionPauseToggle } from '@/components/motion/MotionPauseToggle';
import { useRegisterHeaderHero } from '@/components/layout/headerOverlay';

/**
 * The home hero, split in two on a marine (#0b2653) background:
 *
 *  - left: your content (eyebrow, H1 as <LineReveal trigger="mount">, text,
 *    search, buttons, trust line), each block rising in turn with <HeroIn>;
 *    faint sounding lines drift very slowly behind it;
 *  - right: a large rounded frame (24 px radius) with the photo: it breathes
 *    very slowly (1 → 1.06 over 24 s) and lags behind the page as it scrolls
 *    (parallax, up to 40 px), optionally with a short loop video over it
 *    (`loopSrc`);
 *  - the `card` (an <EventCard>) floats over the frame's bottom left edge: it
 *    hangs 32 px into the gap from lg up; on phones everything stacks (text,
 *    frame, card overlapping the frame's lower edge);
 *  - the site-wide pause control, top right of the frame.
 *
 * No cut-out corner anywhere. The header overlaps the section (transparent,
 * white text) until the page is scrolled, then turns white (see Navbar).
 *
 * `loopSrc`: a short compressed loop (6–10 s, no on-screen text, MP4/WebM).
 * Never the 40 MB platform teaser. It loads only once the hero is on screen
 * from md up (not on a data-saving connection) and does not play under reduced
 * motion or while paused; the photo stays underneath.
 *
 *   <SplitHero image={SITE_IMAGES.homeHero} card={<EventCard items={featuredEventItems(t)} />} labelledBy="home-title">
 *     <HeroIn><Eyebrow tone="onDark">…</Eyebrow></HeroIn>
 *     <LineReveal as="h1" id="home-title" trigger="mount" …>…</LineReveal>
 *     <HeroIn delay={260}>…</HeroIn>
 *   </SplitHero>
 */

/** fetchpriority is valid HTML but not in React 18's types yet: passed through a spread. */
const HIGH_PRIORITY = { fetchpriority: 'high' } as Record<string, string>;

/** A hero block that rises into place on load (24 px, .9 s); `delay` in ms. */
export function HeroIn({
  as: Tag = 'div',
  delay = 0,
  className,
  style,
  children,
  ...rest
}: {
  as?: ElementType;
  delay?: number;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, 'className' | 'style' | 'children'>) {
  return (
    <Tag className={cn('enter-up', className)} style={{ '--enter-delay': `${(120 + delay) / 1000}s`, ...style } as CSSProperties} {...rest}>
      {children}
    </Tag>
  );
}

export function SplitHero({
  image,
  loopSrc,
  loopPoster,
  seed = 'split-hero',
  children,
  card,
  className,
  contentClassName,
  showMotionToggle = true,
  bathySeed = 2,
  id,
  labelledBy,
}: {
  image: SiteImage | null;
  /** Optional short background loop (never the 40 MB teaser). */
  loopSrc?: string;
  loopPoster?: string;
  /** Picks the fallback gradient when there is no photo. */
  seed?: string;
  /** The left column. */
  children: ReactNode;
  /** An <EventCard>: floats over the frame's bottom left edge. */
  card?: ReactNode;
  className?: string;
  /** Classes for the left column. */
  contentClassName?: string;
  /** The site-wide pause control, top right of the frame (default on). */
  showMotionToggle?: boolean;
  bathySeed?: number;
  id?: string;
  labelledBy?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const mediaRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { still, reduced } = useMotion();
  useRegisterHeaderHero(ref);
  useParallax(mediaRef, { mode: 'page', max: 40 });

  // The loop plays only from md up, on a normal connection, while the hero is on screen.
  const wide = useMediaQuery('(min-width: 768px)');
  const saveData = typeof navigator !== 'undefined' && (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
  const heroOnScreen = useOnScreen(ref, !loopSrc);
  const [playing, setPlaying] = useState(false);
  const wantVideo = !!loopSrc && wide && !saveData && !reduced;
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (wantVideo && heroOnScreen && !still) {
      v.preload = 'auto';
      const p = v.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } else if (!v.paused) {
      v.pause();
    }
  }, [wantVideo, heroOnScreen, still]);

  const gradient = gradientForSeed(seed, 'sea');
  const focus = `50% ${Math.round((image?.focusY ?? 0.4) * 100)}%`;

  return (
    <section
      ref={ref}
      id={id}
      aria-labelledby={labelledBy}
      className={cn('relative isolate flex flex-col justify-center overflow-hidden bg-navy text-white lg:min-h-[min(100svh,860px)]', className)}
    >
      <BathyPattern seed={bathySeed} drift className="absolute inset-0 -z-10" />

      <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 pb-14 pt-[92px] sm:px-6 md:pt-[104px] lg:grid-cols-12 lg:items-stretch lg:gap-10 lg:pb-[76px] lg:pt-[116px] xl:gap-14">
        <div className={cn('flex min-w-0 flex-col justify-center lg:col-span-6', contentClassName)}>{children}</div>

        <div className="relative min-w-0 lg:col-span-6 lg:min-h-[540px]">
          {/* The frame: 24 px radius, the photo breathing and lagging behind the page. */}
          <div className="relative h-[300px] overflow-hidden rounded-[24px] bg-navy-deep sm:h-[380px] lg:absolute lg:inset-0 lg:h-auto">
            <div ref={mediaRef} aria-hidden="true" className="hero-media-layer absolute inset-x-0 -top-10 bottom-0">
              <div className="hero-breathe absolute inset-0">
                {image?.src ? (
                  <img
                    src={image.src}
                    alt=""
                    className="hero-settle absolute inset-0 h-full w-full max-w-none object-cover"
                    style={{ objectPosition: focus }}
                    {...HIGH_PRIORITY}
                  />
                ) : (
                  <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${gradient.from}, ${gradient.to})` }} />
                )}
                {wantVideo && (
                  <video
                    ref={videoRef}
                    className={cn('hero-video absolute inset-0 h-full w-full max-w-none object-cover', playing && 'is-playing')}
                    style={{ objectPosition: focus }}
                    src={loopSrc}
                    poster={loopPoster}
                    muted
                    loop
                    playsInline
                    preload="none"
                    tabIndex={-1}
                    onPlaying={() => setPlaying(true)}
                  />
                )}
              </div>
            </div>
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-[linear-gradient(180deg,rgba(11,38,83,.18)_0%,rgba(11,38,83,0)_35%,rgba(11,38,83,.38)_100%)]"
            />
            {showMotionToggle && <MotionPauseToggle className="absolute right-4 top-4 z-[4]" />}
          </div>

          {/* The card: overlaps the frame's lower edge on phones, hangs over its bottom left corner from lg. */}
          {card && (
            <div className="relative z-10 -mt-14 px-3 sm:px-5 lg:absolute lg:-bottom-9 lg:-left-8 lg:mt-0 lg:w-[388px] lg:px-0">{card}</div>
          )}
        </div>
      </div>
    </section>
  );
}
