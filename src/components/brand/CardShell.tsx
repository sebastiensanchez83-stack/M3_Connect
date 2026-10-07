import type { ElementType, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * One card grammar for every list (directory, resources, events, home):
 * white, 16 px radius, a hairline border, no shadow at rest. Interactive cards
 * lift 4 px with a soft shadow on hover / keyboard focus (.8 s), their picture
 * zooms to 1.05 (`CardMedia`), the gold line under their title grows from the left
 * and the small arrow after it slides 4 px (`StretchedLink`). No round arrow disc:
 * that stays inside the rolling CTA buttons.
 *
 * The whole card is one link through `StretchedLink` (its ::after covers the
 * card); other links inside stay clickable when given `relative z-10`.
 *
 *   <CardShell interactive typeColor="provider">
 *     <CardMedia><img …/></CardMedia>
 *     <StretchedLink to="/…">Title</StretchedLink>
 *   </CardShell>
 */
export type OrgTypeTone = 'marina' | 'provider' | 'investor' | 'media';

export function CardShell({
  as: Tag = 'article',
  interactive = false,
  typeColor: _typeColor,
  tone = 'light',
  className,
  children,
}: {
  as?: ElementType;
  /** Hover lift + `group` / `has-ra`: the triggers of the picture zoom and of the title line and arrow. */
  interactive?: boolean;
  /**
   * Kept for compatibility, draws nothing: the organisation type is shown by
   * the cover and its coloured bar (OrgCover in OrgCard.tsx), not by the shell.
   */
  typeColor?: OrgTypeTone | null;
  /** 'light' white card; 'navy' card on light pages; 'glass' on navy panels. */
  tone?: 'light' | 'navy' | 'glass';
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag
      className={cn(
        'card-shell relative flex flex-col overflow-hidden rounded-card',
        tone === 'light' && 'border border-rule bg-white text-ink',
        tone === 'navy' && 'bg-navy text-white',
        tone === 'glass' && 'bg-white/[0.07] text-white ring-1 ring-inset ring-white/15',
        interactive && 'card-lift group has-ra',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/** Picture slot that zooms to 1.04 when its card is hovered. */
export function CardMedia({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('card-media relative', className)}>{children}</div>;
}

/**
 * The card's main link: its click area covers the whole card. Its words carry the
 * hover cue: a gold line grows under them from the left and, unless `arrow={false}`,
 * a small arrow after them slides 4 px (`tone="light"`: a gold arrow on a navy card).
 */
export function StretchedLink({
  to,
  className,
  children,
  ariaLabel,
  arrow = true,
  tone = 'dark',
}: {
  to: string;
  className?: string;
  children: ReactNode;
  ariaLabel?: string;
  /** The small arrow after the title (default on). */
  arrow?: boolean;
  tone?: 'dark' | 'light';
}) {
  const external = /^https?:\/\//.test(to);
  const cls = cn('stretched-link focus-visible:outline-none', className);
  const inner = (
    <>
      <span className="card-ul">{children}</span>
      {arrow && <ArrowRight className={cn('card-arrow', tone === 'light' && 'card-arrow--light')} strokeWidth={2.25} aria-hidden="true" />}
    </>
  );
  if (external) {
    return (
      <a href={to} target="_blank" rel="noopener noreferrer" className={cls} aria-label={ariaLabel}>
        {inner}
      </a>
    );
  }
  return (
    <Link to={to} className={cls} aria-label={ariaLabel}>
      {inner}
    </Link>
  );
}
