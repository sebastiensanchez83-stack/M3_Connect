import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { SiteImage } from '@/lib/siteMedia';
import { gradientForSeed } from '@/components/ui/CoverImage';
import { backgroundBelow } from '@/lib/backdropColor';
import { cn } from '@/lib/utils';
import { useMotion } from '@/components/motion/MotionProvider';
import { BathyPattern } from '@/components/motion/BathyPattern';
import { WaveEdge } from '@/components/motion/WaveEdge';
import { MotionPauseToggle } from '@/components/motion/MotionPauseToggle';
import { useRegisterHeaderHero } from '@/components/layout/headerOverlay';

/**
 * "Ligne d'eau": the home hero. Full bleed (no inset card, no cut corner).
 *
 *  - The picture is revealed from the bottom on load by a rising wave-edged
 *    curtain (1.2 s), then zooms very slowly (Ken Burns, 20 s, alternate).
 *  - Its bottom edge is a living waterline (two wave layers, 7.5 s and 11 s)
 *    painted in the colour of the section below, so the hero flows into the page.
 *  - `tag` hangs on that waterline at the bottom right: pass a <PontoonTag>.
 *    From md up its cleat rests on the wave crest and the plate hangs below
 *    the hero (about 200 px of it: leave room at the top right of the next
 *    section); on phones it sits in the flow under the hero text, and only the
 *    tag itself takes pointer events (its wrapper never covers other controls).
 *  - The site-wide pause control shows with its words ("Pause the animations"),
 *    bottom left from md, in the flow under the hero text on phones, so it is
 *    never mistaken for the tag's own pause button.
 *  - `loopSrc`: an optional short background loop. Leave it unset until a 6–10 s
 *    compressed loop WITHOUT on-screen text exists: the 40 MB platform teaser
 *    must never autoplay as a background. Not played under reduced motion or
 *    while motion is paused (the photo shows instead).
 *  - The header overlaps the hero, transparent with the white logo, until the
 *    hero has scrolled under it (see headerOverlay.ts).
 *
 *   <WaterlineHero image={SITE_IMAGES.homeHero} tag={<PontoonTag items={…} label="M3 events" />}>
 *     <Eyebrow tone="onDark">…</Eyebrow>
 *     <LineReveal as="h1" trigger="mount" className="text-display-sm md:text-display">…</LineReveal>
 *     …
 *   </WaterlineHero>
 */
/** fetchpriority is valid HTML but not in React 18's types yet: passed through a spread. */
const HIGH_PRIORITY = { fetchpriority: 'high' } as Record<string, string>;

export function WaterlineHero({
  image,
  loopSrc,
  loopPoster,
  seed = 'waterline-hero',
  children,
  tag,
  belowColor,
  className,
  contentClassName,
  showMotionToggle = true,
  enter = true,
  id,
  labelledBy,
}: {
  image: SiteImage | null;
  loopSrc?: string;
  loopPoster?: string;
  /** Picks the fallback gradient when there is no photo. */
  seed?: string;
  children: ReactNode;
  tag?: ReactNode;
  /** Colour the waterline melts into; read from the next section when omitted. */
  belowColor?: string;
  className?: string;
  /** Classes for the content container (width, alignment). */
  contentClassName?: string;
  /** The labelled site-wide pause control (bottom left from md, under the text on phones). */
  showMotionToggle?: boolean;
  /** Fade the content up once the water has risen (default on). */
  enter?: boolean;
  id?: string;
  labelledBy?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const { still } = useMotion();
  const overlaid = useRegisterHeaderHero(ref);
  const [below, setBelow] = useState(belowColor ?? '#ffffff');

  useLayoutEffect(() => {
    if (belowColor) {
      setBelow(belowColor);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const read = () => setBelow(backgroundBelow(el));
    read();
    // The next section may render after data arrives: look again shortly.
    const timer = window.setTimeout(read, 600);
    return () => window.clearTimeout(timer);
  }, [belowColor]);

  const gradient = gradientForSeed(seed, 'sea');
  const focus = `50% ${Math.round((image?.focusY ?? 0.5) * 100)}%`;

  return (
    <section
      ref={ref}
      id={id}
      aria-labelledby={labelledBy}
      className={cn('relative isolate bg-navy-deep text-white', className)}
    >
      {/* The water: photo (or loop), navy veil, faint sounding lines. Rises on load. */}
      <div aria-hidden="true" className="waterline-reveal absolute inset-0 -z-10 overflow-hidden">
        {image?.src ? (
          <img
            src={image.src}
            alt=""
            className="ken-burns motion-loop absolute inset-0 h-full w-full object-cover"
            style={{ objectPosition: focus }}
            {...HIGH_PRIORITY}
          />
        ) : (
          <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${gradient.from}, ${gradient.to})` }} />
        )}
        {loopSrc && !still && (
          <video
            className="absolute inset-0 h-full w-full object-cover"
            style={{ objectPosition: focus }}
            src={loopSrc}
            poster={loopPoster}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
          />
        )}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,29,64,.8)_0%,rgba(11,38,83,.74)_45%,rgba(8,29,64,.9)_100%)] md:bg-[linear-gradient(90deg,rgba(8,29,64,.92)_0%,rgba(11,38,83,.72)_48%,rgba(11,38,83,.35)_100%)]" />
        {/* Keeps the transparent header's white links readable over bright ceilings and skies. */}
        <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-navy-deep/75 to-transparent" />
        <BathyPattern seed={2} className="absolute inset-0" drift />
      </div>

      <div
        className={cn(
          'relative mx-auto max-w-7xl px-4 sm:px-6',
          overlaid ? 'pt-28 md:pt-36' : 'pt-16 md:pt-24',
          tag ? 'pb-8 md:pb-40' : 'pb-24 md:pb-36',
          contentClassName,
        )}
      >
        <div className={cn(enter && 'enter-up')} style={enter ? ({ '--enter-delay': '0.55s' } as React.CSSProperties) : undefined}>
          {children}
          {showMotionToggle && <MotionPauseToggle withLabel className="mt-8 md:hidden" />}
        </div>
      </div>

      {tag && (
        // Phones: in the flow, and only the tag itself takes clicks. From md: the
        // cleat (46 px under the tag's top) sits on the waterline's crest.
        <div className="pointer-events-none relative z-20 px-4 pb-24 sm:px-6 md:absolute md:bottom-0 md:right-[max(1.5rem,calc((100vw-80rem)/2+1.5rem))] md:translate-y-[calc(100%-46px)] md:p-0">
          <div className="enter-up" style={{ '--enter-delay': '0.9s' } as React.CSSProperties}>
            {tag}
          </div>
        </div>
      )}

      {showMotionToggle && (
        <MotionPauseToggle withLabel className="absolute bottom-20 left-6 z-10 hidden md:inline-flex" />
      )}

      {/* The waterline: flows into the next section's colour. */}
      <WaveEdge color={below} className="absolute inset-x-0 -bottom-px z-10 h-12 md:h-16" />
    </section>
  );
}
