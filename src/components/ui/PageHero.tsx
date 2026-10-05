import type { LucideIcon } from 'lucide-react';
import { CoverImage } from '@/components/ui/CoverImage';
import type { SiteImage } from '@/lib/siteMedia';
import { cn } from '@/lib/utils';

/**
 * The header band every section page opens with: a photo behind, a navy wash
 * over the whole band, and the content in normal flow on top.
 *
 * The content sets the height, never the other way round — a fixed-height band
 * with absolutely placed text clipped long French titles on narrow phones. The
 * wash covers the full height (not just a bottom scrim) because the eyebrow and
 * the title sit high, over the brightest part of most stage and hall photos.
 *
 * With no photo the band falls back to CoverImage's sea-toned gradient, which
 * is a finished look rather than a placeholder.
 */
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
}: {
  image: SiteImage | null;
  /** Stable per page: picks the fallback gradient. */
  seed: string;
  icon: LucideIcon;
  /** Small pill above the title. */
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** Search box, call-to-action buttons… rendered under the subtitle. */
  children?: React.ReactNode;
  align?: 'left' | 'center';
  className?: string;
  /** Match the page's own content width (e.g. max-w-5xl) so the title lines up with the sections below. */
  containerClassName?: string;
}) {
  const centered = align === 'center';
  return (
    <section className={cn('relative overflow-hidden text-white', className)}>
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
      />
      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-[#0b2653]/95 via-[#0b2653]/80 to-[#0b2653]/60" />
      <div className={cn('relative container mx-auto px-4 py-12 sm:py-16', containerClassName)}>
        <div className={cn('max-w-2xl', centered && 'mx-auto text-center')}>
          {eyebrow && (
            <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-medium backdrop-blur-sm">
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {eyebrow}
            </span>
          )}
          <h1 className="mt-3 text-3xl font-bold tracking-tight drop-shadow-sm sm:text-4xl">{title}</h1>
          {subtitle && <p className={cn('mt-2 max-w-xl text-white/85', centered && 'mx-auto')}>{subtitle}</p>}
          {children && <div className="mt-5">{children}</div>}
        </div>
      </div>
    </section>
  );
}
