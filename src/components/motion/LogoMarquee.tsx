import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useMotion } from './MotionProvider';

/**
 * Sponsor logos drifting sideways, grouped by tier (Main Sponsor, Premium
 * Partner…; names stay in English). Pauses on hover and keyboard focus, and
 * with the global motion pause; under reduced motion the logos wrap as a static
 * wall instead.
 *
 * The track holds the list twice and slides by half its width, so the loop is
 * seamless; each copy is at least as wide as the band. The second copy is
 * aria-hidden and out of the tab order: assistive tech reads the list once.
 *
 * Two looks: 'chips' (default: a tier chip, then bare greyscale logos) and
 * 'tiles' (the v2 home page: a tier label with a gold rule, then every logo on
 * a white tile of the same size, 168 × 100 px, 200 × 112 px from md, in
 * colour; the tile's border and shadow answer the pointer).
 *
 * Logos only: partners are paying event sponsors (never "members").
 */
export interface MarqueeLogo {
  name: string;
  src?: string | null;
  href?: string;
}
export interface MarqueeGroup {
  /** Tier name as shown (English everywhere, e.g. "Main Sponsor"). */
  tier: string;
  logos: MarqueeLogo[];
}

type Look = 'chips' | 'tiles';

function LogoLink({ logo, hidden, className, children }: { logo: MarqueeLogo; hidden: boolean; className: string; children: ReactNode }) {
  if (logo.href && logo.href.startsWith('/')) {
    // A page of this site: client-side navigation, no full reload.
    return (
      <Link to={logo.href} tabIndex={hidden ? -1 : undefined} className={className}>
        {children}
      </Link>
    );
  }
  if (logo.href) {
    return (
      <a
        href={logo.href}
        target={/^https?:/.test(logo.href) ? '_blank' : undefined}
        rel={/^https?:/.test(logo.href) ? 'noopener noreferrer' : undefined}
        tabIndex={hidden ? -1 : undefined}
        className={className}
      >
        {children}
      </a>
    );
  }
  return <span className={className}>{children}</span>;
}

function Group({ group, hidden, wrap = false, look }: { group: MarqueeGroup; hidden: boolean; wrap?: boolean; look: Look }) {
  if (look === 'tiles') {
    return (
      <li className={cn('flex items-stretch gap-3', wrap ? 'min-w-0 flex-wrap' : 'shrink-0 pr-3')}>
        <span className="flex h-[100px] shrink-0 flex-col justify-center border-l-2 border-gold py-0 pl-4 pr-[18px] md:h-28">
          <span className="whitespace-nowrap text-[12px] font-medium uppercase leading-4 tracking-[0.06em] text-navy">{group.tier}</span>
        </span>
        <ul className={cn('flex items-stretch gap-3', wrap && 'flex-wrap')}>
          {group.logos.map((logo) => (
            <li key={logo.name} className="shrink-0">
              <LogoLink
                logo={logo}
                hidden={hidden}
                className="focus-ring grid h-[100px] w-[168px] place-items-center rounded-[12px] border border-rule bg-white px-5 transition-[border-color,box-shadow] [transition-duration:400ms] hover:border-[#c9d1de] hover:shadow-hover md:h-28 md:w-[200px]"
              >
                {logo.src ? (
                  <img src={logo.src} alt={hidden ? '' : logo.name} loading="lazy" className="max-h-[56px] w-auto max-w-full object-contain md:max-h-16" />
                ) : (
                  <span className="line-clamp-2 text-center text-[15px] font-semibold leading-5 text-navy">{logo.name}</span>
                )}
              </LogoLink>
            </li>
          ))}
        </ul>
      </li>
    );
  }
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
          return (
            <li key={logo.name} className="shrink-0">
              <LogoLink
                logo={logo}
                hidden={hidden}
                className={cn(
                  'block rounded-field opacity-80 grayscale transition',
                  logo.href && 'focus-ring hover:opacity-100 hover:grayscale-0',
                )}
              >
                {content}
              </LogoLink>
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
  look = 'chips',
  className,
}: {
  groups: MarqueeGroup[];
  /** Pixels per second. */
  speed?: number;
  /** Accessible name of the band, e.g. "Event partners". */
  label: string;
  /** Show the static wall even when motion is on (e.g. too few logos to drift). */
  still?: boolean;
  look?: Look;
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
        <ul className={cn('flex flex-wrap', look === 'tiles' ? 'gap-x-3 gap-y-6' : 'items-center gap-x-10 gap-y-6')}>
          {visible.map((g) => <Group key={g.tier} group={g} hidden={false} wrap look={look} />)}
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
          {visible.map((g) => <Group key={g.tier} group={g} hidden={false} look={look} />)}
        </ul>
        <ul aria-hidden="true" className="flex min-w-[100vw] shrink-0 items-center">
          {visible.map((g) => <Group key={g.tier} group={g} hidden look={look} />)}
        </ul>
      </div>
    </section>
  );
}
