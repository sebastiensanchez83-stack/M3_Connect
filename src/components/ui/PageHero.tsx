import { useRef, type CSSProperties, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, type LucideIcon } from 'lucide-react';
import { CoverImage } from '@/components/ui/CoverImage';
import type { SiteImage } from '@/lib/siteMedia';
import { cn } from '@/lib/utils';
import { BathyPattern } from '@/components/motion/BathyPattern';
import { LineReveal } from '@/components/motion/LineReveal';
import { MotionPauseToggle } from '@/components/motion/MotionPauseToggle';
import { useParallax } from '@/components/motion/useParallax';
import { useRegisterHeaderHero } from '@/components/layout/headerOverlay';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { UnderlineLink } from '@/components/brand/UnderlineLink';

/**
 * The compact banner every section page opens with, full width and square (no
 * inset, no rounded corners, no cut-out corner): a photo that settles from 1.08
 * to 1 on load and lags behind the page (parallax, up to 40 px), a marine veil,
 * faint sounding lines drifting very slowly, a breadcrumb (a back link on
 * phones), an optional eyebrow, the H1 (lines rising on load), a subtitle and
 * whatever `children` you pass (search, figures, buttons).
 *
 * The content sets the height, never the other way round. When it is the first
 * thing on the page, the full-width header overlaps it (transparent, white logo)
 * and the banner makes room for it.
 *
 * `floating` takes a small card that overlaps the banner's bottom edge (from xl,
 * right aligned): give the content below it room (about 3.5 rem of top margin).
 * With no photo the banner falls back to CoverImage's sea-toned gradient, a
 * finished look.
 *
 * The sounding lines move on their own: the banner carries the icon-only
 * site-wide pause control (WCAG 2.2.2), bottom right.
 *
 * Props are backward compatible with the October 2026 version. `wave` and
 * `belowColor` are accepted and ignored (the wave edge is gone); `breadcrumbs`,
 * `overlayHeader` and `floating` are optional.
 */

export interface Crumb {
  label: string;
  href?: string;
}

/** Section pages the automatic breadcrumb knows: path → [i18n key, English fallback]. */
const SECTION_LABELS: Record<string, [string, string]> = {
  '/directory': ['nav.directory', 'Directory'],
  '/opportunities': ['nav.opportunities', 'Opportunities'],
  '/resources': ['nav.resources', 'Resources'],
  '/events': ['nav.events', 'Events'],
  '/partners': ['nav.partners', 'Partners'],
  '/about': ['nav.about', 'About'],
  '/contact': ['footer.contact', 'Contact'],
  '/become-partner': ['nav.becomePartner', 'Join the network'],
};

export function PageHero({
  image,
  seed,
  icon: Icon,
  eyebrow,
  title,
  subtitle,
  children,
  align = 'left',
  className,
  containerClassName,
  breadcrumbs,
  overlayHeader = true,
  floating,
}: {
  image: SiteImage | null;
  /** Stable per page: picks the fallback gradient. */
  seed: string;
  /** Watermarked into the fallback gradient when there is no photo. */
  icon: LucideIcon;
  /** Small line above the title (teal dot + caps). */
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** Search box, figures, call-to-action buttons… rendered under the subtitle. */
  children?: ReactNode;
  align?: 'left' | 'center';
  className?: string;
  /** Match the page's own content width (e.g. max-w-5xl) so the title lines up with the sections below. */
  containerClassName?: string;
  /** Home › Section by default (from the URL); pass a trail, or false for none. */
  breadcrumbs?: Crumb[] | false;
  /** Let the header overlap the card when it opens the page (default on). */
  overlayHeader?: boolean;
  /** A small card overlapping the banner's bottom edge, right aligned, from xl (no cut-out). */
  floating?: ReactNode;
  /** @deprecated The wave edge is gone; ignored. */
  wave?: boolean;
  /** @deprecated The wave edge is gone; ignored. */
  belowColor?: string;
}) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const ref = useRef<HTMLElement>(null);
  const mediaRef = useRef<HTMLDivElement>(null);
  const overlaid = useRegisterHeaderHero(ref, overlayHeader);
  const centered = align === 'center';
  useParallax(mediaRef, { mode: 'page', max: 40 });

  let crumbs: Crumb[] | null = null;
  if (Array.isArray(breadcrumbs)) crumbs = breadcrumbs;
  else if (breadcrumbs !== false && SECTION_LABELS[pathname]) {
    const [key, fallback] = SECTION_LABELS[pathname];
    crumbs = [{ label: t('nav.home', 'Home'), href: '/' }, { label: t(key, fallback) }];
  }
  // Phones: one link back to the parent instead of the whole trail.
  const parent = crumbs && crumbs.length > 1 ? crumbs[crumbs.length - 2] : null;

  return (
    <div className="relative">
    <section ref={ref} className={cn('relative isolate overflow-hidden bg-navy text-white', className)}>
      <div ref={mediaRef} aria-hidden="true" className="hero-media-layer absolute inset-x-0 -top-10 bottom-0 -z-30">
        <CoverImage
          src={image?.src ?? null}
          focusY={image?.focusY ?? 0.5}
          alt=""
          seed={seed}
          icon={Icon}
          aspect="fill"
          tone="sea"
          eager
          className="absolute inset-0"
          imageClassName="hero-settle"
        />
      </div>
      {/* The veil covers the whole card: the eyebrow and the title sit high, over the brightest part of most hall photos. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-20 bg-[linear-gradient(180deg,rgba(8,29,64,.9)_0%,rgba(11,38,83,.8)_100%)] lg:bg-[linear-gradient(90deg,rgba(11,38,83,.94),rgba(11,38,83,.66))]"
      />
      <BathyPattern seed={3} drift className="absolute inset-y-0 left-0 -z-10 w-full min-[1200px]:w-[60%]" />

      <div
        className={cn(
          'relative z-10 mx-auto w-full max-w-7xl px-4 sm:px-6',
          overlaid ? 'pt-[88px] md:pt-[104px]' : 'pt-10 sm:pt-14',
          // Phones: room under the content for the 44 px pause control (bottom 16 px), so it never covers the last words of a long subtitle.
          'pb-[68px] md:pb-[52px] xl:pb-16',
          containerClassName,
        )}
      >
        <div className={cn('max-w-[820px]', centered && 'mx-auto text-center')}>
          {crumbs && (
            <>
              <nav aria-label={t('brand.breadcrumb', 'Breadcrumb')} className="hidden text-[14px] leading-5 text-white/80 md:block">
                <ol className={cn('flex flex-wrap items-center gap-2', centered && 'justify-center')}>
                  {crumbs.map((c, i) => {
                    const last = i === crumbs!.length - 1;
                    return (
                      <li key={`${c.label}-${i}`} className="flex items-center gap-2">
                        {c.href && !last ? (
                          <UnderlineLink to={c.href} tone="light" plain arrow={false} className="!text-[14px] !font-normal">
                            {c.label}
                          </UnderlineLink>
                        ) : (
                          <span aria-current={last ? 'page' : undefined} className={cn(last && 'text-white')}>
                            {c.label}
                          </span>
                        )}
                        {!last && <span aria-hidden="true">/</span>}
                      </li>
                    );
                  })}
                </ol>
              </nav>
              {parent?.href && (
                // A wrapper hides it from md up: the .uline class sets its own display.
                <div className="md:hidden">
                  <Link to={parent.href} className="uline uline--light uline--plain !text-[14px] !font-normal">
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    <span className="uline-t">{parent.label}</span>
                  </Link>
                </div>
              )}
            </>
          )}
          {eyebrow && (
            <Eyebrow tone="onDark" className={cn(crumbs && 'mt-4', centered && 'justify-center')}>
              {eyebrow}
            </Eyebrow>
          )}
          <LineReveal
            as="h1"
            trigger="mount"
            delay={120}
            className={cn('text-h1-sm text-white sm:text-h1 [text-wrap:balance]', crumbs || eyebrow ? 'mt-4' : '')}
          >
            {title}
          </LineReveal>
          {subtitle && (
            <p
              className={cn('enter-up mt-4 max-w-[640px] text-body text-white/85 md:text-[18px] md:leading-7', centered && 'mx-auto')}
              style={{ '--enter-delay': '0.35s' } as CSSProperties}
            >
              {subtitle}
            </p>
          )}
          {children && (
            <div className="enter-up mt-6 md:mt-7" style={{ '--enter-delay': '0.5s' } as CSSProperties}>
              {children}
            </div>
          )}
        </div>
      </div>

      <MotionPauseToggle className={cn('absolute bottom-4 right-4 z-[4] md:bottom-6 md:right-6', floating ? 'xl:right-[440px]' : '')} />
    </section>
    {floating && (
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 hidden translate-y-1/2 xl:block">
        <div className="mx-auto flex max-w-7xl justify-end px-6">
          <div className="pointer-events-auto">{floating}</div>
        </div>
      </div>
    )}
    </div>
  );
}
