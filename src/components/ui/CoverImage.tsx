import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The picture slot used by every card, header and tile on the platform.
 *
 * The point of this component is that a missing photo must never leave a hole.
 * Most rows in the database have no image yet, and some never will, so the
 * fallback is not an error state — it is a normal, deliberate look: a brand
 * gradient picked deterministically from a seed, with the subject's own icon
 * watermarked into it. Two cards for the same marina therefore always draw the
 * same gradient, across reloads and across pages, which is what makes a grid
 * of them read as designed rather than as broken.
 *
 * It also means photos can be dropped in later, one row at a time, with no
 * layout change: pass `src` and the gradient steps aside.
 */

/**
 * Deep-sea and gold, the brand's own family. Deliberately no rainbow: a grid of
 * these has to look curated, so every pair stays inside navy → teal → gold.
 * `from`/`to` are raw hex because these go into an inline gradient, not Tailwind.
 */
const GRADIENTS: { from: string; to: string }[] = [
  { from: '#0b2653', to: '#1c4b86' }, // brand navy
  { from: '#0f3557', to: '#2a7196' }, // harbour blue
  { from: '#10404a', to: '#2b8a86' }, // lagoon teal
  { from: '#13314f', to: '#5a7fa8' }, // horizon
  { from: '#3a2f14', to: '#9a7520' }, // dark gold
  { from: '#0b2653', to: '#8a6a2a' }, // navy to brass
  { from: '#15263a', to: '#49697f' }, // slate sea
  { from: '#0d3a3f', to: '#1f6b72' }, // deep green water
];

/** Stable 32-bit string hash — same seed always lands on the same gradient. */
function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h << 5) - h + seed.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

export function gradientForSeed(seed: string): { from: string; to: string } {
  return GRADIENTS[hashSeed(seed || 'm3') % GRADIENTS.length];
}

export type CoverAspect = 'video' | 'wide' | 'square' | 'portrait' | 'banner' | 'fill';

const ASPECT: Record<CoverAspect, string> = {
  video: 'aspect-[16/9]',
  wide: 'aspect-[3/2]',
  square: 'aspect-square',
  portrait: 'aspect-[3/4]',
  banner: 'aspect-[21/9]',
  /** Fills whatever box the parent gives it — the parent owns the height. */
  fill: 'h-full w-full',
};

interface CoverImageProps {
  /** The photo. Null, undefined or empty all mean "draw the fallback". */
  src?: string | null;
  /** Describe the subject, or pass "" when the picture is purely decorative. */
  alt: string;
  /**
   * What the gradient is derived from — an id, a slug, a name. Anything
   * stable for this subject. Changing it changes the colour, so don't pass
   * something that varies between renders.
   */
  seed: string;
  /** Watermarked into the fallback; skip it for a plain gradient. */
  icon?: LucideIcon;
  aspect?: CoverAspect;
  /** Dark scrim at the bottom, for when text is laid over the picture. */
  scrim?: boolean;
  /** Above the fold: skips lazy loading so the hero doesn't pop in. */
  eager?: boolean;
  className?: string;
  /** Extra classes on the <img>/fallback itself, e.g. `object-contain` for logos. */
  imageClassName?: string;
  children?: React.ReactNode;
}

export function CoverImage({
  src,
  alt,
  seed,
  icon: Icon,
  aspect = 'video',
  scrim = false,
  eager = false,
  className,
  imageClassName,
  children,
}: CoverImageProps) {
  // A broken URL is treated exactly like no URL: one failed load and we show
  // the gradient instead of a torn-image glyph.
  const [failed, setFailed] = useState(false);
  const showPhoto = Boolean(src) && !failed;
  const { from, to } = gradientForSeed(seed);

  return (
    <div
      className={cn(
        'relative overflow-hidden bg-primary/5',
        ASPECT[aspect],
        className,
      )}
    >
      {showPhoto ? (
        <img
          src={src as string}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onError={() => setFailed(true)}
          className={cn(
            'h-full w-full object-cover transition-transform duration-500',
            imageClassName,
          )}
        />
      ) : (
        <div
          aria-hidden={alt ? undefined : true}
          role={alt ? 'img' : undefined}
          aria-label={alt || undefined}
          className={cn('h-full w-full', imageClassName)}
          style={{ backgroundImage: `linear-gradient(135deg, ${from} 0%, ${to} 100%)` }}
        >
          {/* A faint diagonal sheen so a flat gradient still catches the eye. */}
          <div
            className="absolute inset-0 opacity-60"
            style={{
              backgroundImage:
                'linear-gradient(115deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0) 42%)',
            }}
          />
          {Icon && (
            <Icon
              aria-hidden="true"
              strokeWidth={1.25}
              className="absolute -bottom-3 -right-3 h-24 w-24 text-white/15"
            />
          )}
        </div>
      )}

      {scrim && (
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/70 via-black/25 to-transparent"
        />
      )}

      {children}
    </div>
  );
}

/**
 * A company logo, which is a different problem from a cover photo: logos must
 * not be cropped, they sit on white, and when one is missing the honest
 * fallback is the company's initials rather than a gradient.
 */
export function LogoBadge({
  src,
  name,
  size = 'md',
  className,
}: {
  src?: string | null;
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const box = size === 'sm' ? 'h-9 w-9' : size === 'lg' ? 'h-16 w-16' : 'h-12 w-12';
  const text = size === 'sm' ? 'text-[11px]' : size === 'lg' ? 'text-lg' : 'text-sm';

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={name}
        loading="lazy"
        onError={() => setFailed(true)}
        className={cn(
          box,
          'shrink-0 rounded-xl border border-gray-200/80 bg-white object-contain p-1',
          className,
        )}
      />
    );
  }

  const { from, to } = gradientForSeed(name);
  return (
    <div
      aria-label={name}
      role="img"
      className={cn(
        box,
        text,
        'shrink-0 rounded-xl flex items-center justify-center font-semibold text-white',
        className,
      )}
      style={{ backgroundImage: `linear-gradient(135deg, ${from} 0%, ${to} 100%)` }}
    >
      {initials || '—'}
    </div>
  );
}
