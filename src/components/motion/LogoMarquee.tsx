import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useMotion } from './MotionProvider';

/**
 * Sponsor logos drifting sideways, grouped by tier (Platinum, Gold…, names stay
 * in English). Pauses on hover and keyboard focus, and with the global motion
 * pause; under reduced motion the logos wrap as a static wall instead.
 *
 * The track holds the list twice and slides by half its width, so the loop is
 * seamless; each copy is at least as wide as the band. The second copy is
 * aria-hidden and out of the tab order: assistive tech reads the list once.
 *
 * Logos only: partners are paying event sponsors (never "members").
 */
export interface MarqueeLogo {
  name: string;
  src?: string | null;
  href?: string;
}
export interface MarqueeGroup {
  /** Tier name as shown (English everywhere, e.g. "Platinum"). */
  tier: string;
  logos: MarqueeLogo[];
}

function Group({ group, hidden, wrap = false }: { group: MarqueeGroup; hidden: boolean; wrap?: boolean }) {
  return (
    <li className={cn('flex items-center gap-6 md:gap-10', wrap ? 'min-w-0 flex-wrap' : 'shrink-0 pr-10 md:pr-14')}>
      <span className="text-meta-caps shrink-0 rounded-pill bg-chip px-3 py-1 text-navy">{group.tier}</span>
      <ul className={cn('flex items-center gap-6 md:gap-10', wrap && 'flex-wrap')}>
        {group.logos.map((logo) => {
          const content = logo.src ? (
            <img src={logo.src} alt={hidden ? '' : logo.name} loading="lazy" className="h-10 w-auto max-w-[140px] object-contain md:h-12" />
          ) : (
            <span className="whitespace-nowrap text-base font-semibold text-navy/80">{logo.name}</span>
          );
          const linkClass = 'focus-ring block rounded-field opacity-80 grayscale transition hover:opacity-100 hover:grayscale-0';
          return (
            <li key={logo.name} className="shrink-0">
              {logo.href && logo.href.startsWith('/') ? (
                // A page of this site: client-side navigation, no full reload.
                <Link to={logo.href} tabIndex={hidden ? -1 : undefined} className={linkClass}>
                  {content}
                </Link>
              ) : logo.href ? (
                <a
                  href={logo.href}
                  target={/^https?:/.test(logo.href) ? '_blank' : undefined}
                  rel={/^https?:/.test(logo.href) ? 'noopener noreferrer' : undefined}
                  tabIndex={hidden ? -1 : undefined}
                  className={linkClass}
                >
                  {content}
                </a>
              ) : (
                <span className="block opacity-80 grayscale">{content}</span>
              )}
            </li>
          );
        })}
      </ul>
    </li>
  );
}

export function LogoMarquee({
  groups,
  speed = 40,
  label,
  still = false,
  className,
}: {
  groups: MarqueeGroup[];
  /** Pixels per second. */
  speed?: number;
  /** Accessible name of the band, e.g. "Event partners". */
  label: string;
  /** Show the static wall even when motion is on (e.g. too few logos to drift). */
  still?: boolean;
  className?: string;
}) {
  const { reduced: reducedMotion } = useMotion();
  const reduced = reducedMotion || still;
  const copyRef = useRef<HTMLUListElement>(null);
  const [duration, setDuration] = useState(40);

  useLayoutEffect(() => {
    const el = copyRef.current;
    if (!el || reduced) return;
    const update = () => setDuration(Math.max(12, el.scrollWidth / speed));
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [speed, reduced, groups]);

  const visible = groups.filter((g) => g.logos.length > 0);
  if (visible.length === 0) return null;

  if (reduced) {
    return (
      <section aria-label={label} className={className}>
        <ul className="flex flex-wrap items-center gap-x-10 gap-y-6">
          {visible.map((g) => <Group key={g.tier} group={g} hidden={false} wrap />)}
        </ul>
      </section>
    );
  }

  return (
    <section
      aria-label={label}
      className={cn('logo-marquee relative overflow-hidden', className)}
      style={{
        WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent)',
        maskImage: 'linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent)',
      }}
    >
      <div
        className="logo-marquee-track flex w-max motion-loop"
        style={{ '--marquee-duration': `${duration}s` } as CSSProperties}
      >
        <ul ref={copyRef} className="flex min-w-[100vw] shrink-0 items-center">
          {visible.map((g) => <Group key={g.tier} group={g} hidden={false} />)}
        </ul>
        <ul aria-hidden="true" className="flex min-w-[100vw] shrink-0 items-center">
          {visible.map((g) => <Group key={g.tier} group={g} hidden />)}
        </ul>
      </div>
    </section>
  );
}
