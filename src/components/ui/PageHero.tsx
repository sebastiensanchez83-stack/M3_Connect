import { useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { CoverImage } from '@/components/ui/CoverImage';
import type { SiteImage } from '@/lib/siteMedia';
import { backgroundBelow } from '@/lib/backdropColor';
import { cn } from '@/lib/utils';
import { BathyPattern } from '@/components/motion/BathyPattern';
import { WaveEdge } from '@/components/motion/WaveEdge';
import { LineReveal } from '@/components/motion/LineReveal';
import { MotionPauseToggle } from '@/components/motion/MotionPauseToggle';
import { useRegisterHeaderHero } from '@/components/layout/headerOverlay';
import { Eyebrow } from '@/components/brand/Eyebrow';

/**
 * The header band every section page opens with: a full-bleed photo (slow
 * zoom), a navy veil over the whole band, faint sounding lines, a breadcrumb,
 * an eyebrow with the teal dot, the H1 (lines rising on load), and a gently
 * moving waterline as its bottom edge, painted in the colour of the section
 * that follows.
 *
 * The content sets the height, never the other way round — a fixed-height band
 * with absolutely placed text clipped long French titles on narrow phones. The
 * veil covers the full height (not just a bottom scrim) because the eyebrow and
 * the title sit high, over the brightest part of most stage and hall photos.
 *
 * When it is the first thing on the page, the header overlaps it (transparent,
 * white logo) and the band makes room for it.
 *
 * With no photo the band falls back to CoverImage's sea-toned gradient, which
 * is a finished look rather than a placeholder.
 *
 * The band moves on its own (slow zoom, drifting waterline): with the wave on,
 * it carries the labelled site-wide pause control (WCAG 2.2.2), bottom right
 * from md, under the content on phones, so nobody has to tab to the footer.
 *
 * Props are backward compatible with the October 2026 version; `breadcrumbs`,
 * `wave`, `belowColor` and `overlayHeader` are new and optional.
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
  wave = true,
  belowColor,
  overlayHeader = true,
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
  /** Search box, call-to-action buttons… rendered under the subtitle. */
  children?: React.ReactNode;
  align?: 'left' | 'center';
  className?: string;
  /** Match the page's own content width (e.g. max-w-5xl) so the title lines up with the sections below. */
  containerClassName?: string;
  /** Home › Section by default (from the URL); pass a trail, or false for none. */
  breadcrumbs?: Crumb[] | false;
  /** Waterline bottom edge (default on). */
  wave?: boolean;
  /** Colour the waterline melts into; read from the next section when omitted. */
  belowColor?: string;
  /** Let the header overlap the band when it opens the page (default on). */
  overlayHeader?: boolean;
}) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const ref = useRef<HTMLElement>(null);
  const overlaid = useRegisterHeaderHero(ref, overlayHeader);
  const [below, setBelow] = useState(belowColor ?? '#ffffff');
  const centered = align === 'center';

  useLayoutEffect(() => {
    if (belowColor) {
      setBelow(belowColor);
      return;
    }
    const el = ref.current;
    if (!el || !wave) return;
    const read = () => setBelow(backgroundBelow(el));
    read();
    const timer = window.setTimeout(read, 600);
    return () => window.clearTimeout(timer);
  }, [belowColor, wave, pathname]);

  let crumbs: Crumb[] | null = null;
  if (Array.isArray(breadcrumbs)) crumbs = breadcrumbs;
  else if (breadcrumbs !== false && SECTION_LABELS[pathname]) {
    const [key, fallback] = SECTION_LABELS[pathname];
    crumbs = [{ label: t('nav.home', 'Home'), href: '/' }, { label: t(key, fallback) }];
  }

  return (
    <section ref={ref} className={cn('relative isolate overflow-hidden bg-navy-deep text-white', className)}>
      <CoverImage
        src={image?.src ?? null}
        focusY={image?.focusY ?? 0.5}
        alt=""
        seed={seed}
        icon={Icon}
        aspect="fill"
        tone="sea"
        eager
        className="absolute inset-0 -z-10"
        imageClassName="ken-burns motion-loop"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(8,29,64,.9)_0%,rgba(11,38,83,.78)_45%,rgba(8,29,64,.92)_100%)]"
      />
      <BathyPattern seed={3} className="absolute inset-0 -z-10" />

      <div
        className={cn(
          'relative container mx-auto px-4',
          overlaid ? 'pt-24 sm:pt-28' : 'pt-10 sm:pt-14',
          wave ? 'pb-16 sm:pb-20' : 'pb-12 sm:pb-16',
          containerClassName,
        )}
      >
        <div className={cn('max-w-2xl', centered && 'mx-auto text-center')}>
          {crumbs && (
            <nav aria-label={t('brand.breadcrumb', 'Breadcrumb')} className="mb-4">
              <ol className={cn('flex flex-wrap items-center gap-1 text-[13px] text-white/70', centered && 'justify-center')}>
                {crumbs.map((c, i) => {
                  const last = i === crumbs!.length - 1;
                  return (
                    <li key={`${c.label}-${i}`} className="flex items-center gap-1">
                      {c.href && !last ? (
                        <Link to={c.href} className="focus-ring rounded-sm underline-offset-2 hover:text-white hover:underline">
                          {c.label}
                        </Link>
                      ) : (
                        <span aria-current={last ? 'page' : undefined} className={cn(last && 'text-white/90')}>
                          {c.label}
                        </span>
                      )}
                      {!last && <ChevronRight className="h-3.5 w-3.5 text-white/45" aria-hidden="true" />}
                    </li>
                  );
                })}
              </ol>
            </nav>
          )}
          {eyebrow && (
            <Eyebrow tone="onDark" className={cn(centered && 'justify-center')}>
              {eyebrow}
            </Eyebrow>
          )}
          <LineReveal
            as="h1"
            trigger="mount"
            delay={120}
            className="mt-3 text-h1-sm text-white sm:text-h1 [text-wrap:balance]"
          >
            {title}
          </LineReveal>
          {subtitle && (
            <p className={cn('enter-up mt-3 max-w-xl text-body text-white/85 sm:text-body-lg', centered && 'mx-auto')} style={{ '--enter-delay': '0.35s' } as React.CSSProperties}>
              {subtitle}
            </p>
          )}
          {children && (
            <div className="enter-up mt-6" style={{ '--enter-delay': '0.5s' } as React.CSSProperties}>
              {children}
            </div>
          )}
          {wave && <MotionPauseToggle withLabel className={cn('mt-6 md:hidden', centered && 'mx-auto')} />}
        </div>
      </div>

      {wave && <MotionPauseToggle withLabel className="absolute bottom-14 right-6 z-10 hidden md:inline-flex" />}
      {wave && <WaveEdge color={below} className="absolute inset-x-0 -bottom-px h-10 sm:h-14" />}
    </section>
  );
}
