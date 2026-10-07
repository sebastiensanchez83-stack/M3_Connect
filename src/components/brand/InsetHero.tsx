import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from 'react';
import type { SiteImage } from '@/lib/siteMedia';
import { gradientForSeed } from '@/components/ui/CoverImage';
import { backgroundBehind } from '@/lib/backdropColor';
import { cn } from '@/lib/utils';
import { useMotion } from '@/components/motion/MotionProvider';
import { useMediaQuery } from '@/components/motion/useReducedMotion';
import { useOnScreen } from '@/components/motion/useInView';
import { useParallax } from '@/components/motion/useParallax';
import { BathyPattern } from '@/components/motion/BathyPattern';
import { MotionPauseToggle } from '@/components/motion/MotionPauseToggle';
import { useRegisterHeaderHero } from '@/components/layout/headerOverlay';
import { GiantMarquee } from './GiantMarquee';

/**
 * The home hero, as an inset rounded card (12 px from the edges, 24 px radius
 * from md up; full bleed on phones):
 *
 *  - the photo (parallax: it lags behind the page by up to 40 px), optionally
 *    a short loop video over it (`loopSrc`), a marine veil, faint sounding
 *    lines drifting very slowly;
 *  - your content (eyebrow, H1 as <LineReveal trigger="mount">, text, search,
 *    buttons), each block rising in turn with <HeroIn>;
 *  - a giant marquee running along the bottom (`marquee`, 55 px/s);
 *  - a notch card cut into the bottom left corner (`notch`, an <EventNotch>);
 *  - a pause control, bottom right, for the whole site's motion.
 *
 * The header overlaps it (transparent, white logo) until the card has scrolled
 * under it, then floats as a white bar (see Navbar).
 *
 * `loopSrc`: a short compressed loop (6–10 s, no on-screen text, MP4/WebM).
 * Never the 40 MB platform teaser. It loads only once the hero is on screen
 * from md up (not on a data-saving connection) and does not play under reduced
 * motion or while paused; the photo stays underneath.
 *
 * The notch's corner is painted in the colour found behind the hero, so the
 * cut-out matches whatever page background the hero sits on.
 *
 *   <InsetHero image={SITE_IMAGES.homeHero} marquee={['Smart', 'Sustainable', 'Connected']}
 *              notch={<EventNotch items={notchEventItems(t)} />} labelledBy="home-title">
 *     <HeroIn><Eyebrow tone="onDark">…</Eyebrow></HeroIn>
 *     <LineReveal as="h1" id="home-title" trigger="mount" …>…</LineReveal>
 *     <HeroIn delay={260}>…</HeroIn>
 *   </InsetHero>
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

export function InsetHero({
  image,
  loopSrc,
  loopPoster,
  seed = 'inset-hero',
  children,
  marquee,
  notch,
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
  children: ReactNode;
  /** Words for the giant marquee along the bottom; none = no marquee. */
  marquee?: string[];
  /** An <EventNotch> (or <HeroNotch>) for the bottom left corner. */
  notch?: ReactNode;
  className?: string;
  /** Classes for the content container (width, alignment). */
  contentClassName?: string;
  /** The site-wide pause control, bottom right (default on). */
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

  // The notch cuts the hero's corner in the page colour: read it from behind the hero.
  const [notchBg, setNotchBg] = useState<string | undefined>(undefined);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !notch) return;
    const read = () => setNotchBg(backgroundBehind(el));
    read();
    const timer = window.setTimeout(read, 600);
    return () => window.clearTimeout(timer);
  }, [notch]);

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
  const hasMarquee = !!marquee?.length;

  return (
    <section
      ref={ref}
      id={id}
      aria-labelledby={labelledBy}
      style={notchBg ? ({ '--notch-bg': notchBg } as CSSProperties) : undefined}
      className={cn(
        'relative isolate flex min-h-[640px] flex-col justify-center overflow-hidden bg-navy text-white md:mx-3 md:mt-3 md:min-h-[min(calc(100svh-52px),940px)] md:rounded-[24px]',
        className,
      )}
    >
      {/* Media: photo, loop, veil, sounding lines. */}
      <div ref={mediaRef} aria-hidden="true" className="hero-media-layer absolute inset-x-0 -top-10 bottom-0 -z-30">
        {image?.src ? (
          <img
            src={image.src}
            alt=""
            className="absolute inset-0 h-full w-full max-w-none object-cover"
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
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-20 bg-[linear-gradient(180deg,rgba(11,38,83,.82)_0%,rgba(11,38,83,.88)_55%,rgba(11,38,83,.95)_100%)] min-[1200px]:bg-[linear-gradient(90deg,rgba(11,38,83,.95)_0%,rgba(11,38,83,.86)_45%,rgba(11,38,83,.6)_100%)]"
      />
      <BathyPattern seed={bathySeed} drift className="absolute inset-y-0 left-0 -z-10 w-full min-[1200px]:w-[56%]" />

      <div
        className={cn(
          'relative z-10 mx-auto w-full max-w-7xl px-4 pt-[104px] sm:px-6 md:pt-[116px]',
          notch ? 'pb-[296px] md:pb-[256px] xl:pb-[188px]' : hasMarquee ? 'pb-[180px] md:pb-[200px]' : 'pb-16 md:pb-20',
          contentClassName,
        )}
      >
        {children}
      </div>

      {hasMarquee && (
        <div className={cn('hero-enter-fade absolute inset-x-0 z-[1] md:bottom-[10px]', notch ? 'bottom-[200px]' : 'bottom-[18px]')}>
          <GiantMarquee items={marquee!} variant="hero" speed={55} />
        </div>
      )}

      {showMotionToggle && <MotionPauseToggle className="absolute bottom-4 right-4 z-[4] md:bottom-6 md:right-6" />}

      {notch}
    </section>
  );
}
