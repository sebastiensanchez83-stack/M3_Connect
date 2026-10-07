import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RevealGroup } from '@/components/motion/Reveal';
import { useMediaQuery } from '@/components/motion/useReducedMotion';
import { useMotion } from '@/components/motion/MotionProvider';
import { ArrowDisc } from './ArrowDisc';
import { UnderlineLink } from './UnderlineLink';

/**
 * Photo cards in an accordion: from 1024 px a row 500 px tall where every card
 * is collapsed to about 220 px (photo and title) and the one under the pointer
 * or holding focus grows to about 550 px (flex-grow 1 → 2.75, .6 s,
 * cubic-bezier(.38,.005,.215,1)), its caption fading up (.45 s, +180 ms). A
 * collapsed card writes its title vertically (reading bottom to top, along its
 * left edge) under a small maritime pictogram (`icon`); an open card shows the
 * horizontal title and caption. Below 1024 px the cards stack (two columns from
 * 640 px) with their captions and horizontal titles always visible. On a touch screen the first tap opens a card, the second follows its
 * link. Under reduced motion the cards stay equal and their captions visible.
 *
 * The whole card is one link (the `cta`, stretched over the card); the round
 * arrow is its marker. The first item starts open. Under reduced motion the cards stay equal,
 * captions visible, and the vertical titles and pictograms are not shown.
 *
 *   <AccordionCards items={[{
 *     id: 'marinas', title: 'Marinas', icon: Anchor, image: PERSONA_IMAGES.marinas, dotColor: 'rgb(var(--type-marina))',
 *     caption: <ul>…</ul>, cta: { label: 'Sign up as a marina', onClick: openSignup },
 *   }, …]} />
 *
 * The cards are an exact flex layout: 4 cards is what the caption width is
 * tuned for; any count from 2 to 5 works.
 */
export interface AccordionItem {
  id: string;
  title: string;
  /** A small lucide pictogram (maritime: Anchor, LifeBuoy, Compass, Radio) shown at the top of the card while it is collapsed. */
  icon?: LucideIcon;
  image: string | null;
  /** 0 = top, 1 = bottom. */
  imageFocusY?: number;
  /** CSS colour of the small square next to the title (the organisation type colour). */
  dotColor?: string;
  /** What the card offers: a short list or a sentence. */
  caption: ReactNode;
  /** The card's single link: a page (`to`), another site (`href`) or an action (`onClick`, e.g. open the sign-up). */
  cta: { label: string; to?: string; href?: string; onClick?: () => void };
}

export function AccordionCards({ items, className, ariaLabel }: { items: AccordionItem[]; className?: string; ariaLabel?: string }) {
  const { reduced } = useMotion();
  const wide = useMediaQuery('(min-width: 1024px)');
  const [openId, setOpenId] = useState(items[0]?.id);
  // Touch: was the card already open when the finger went down? (A tap on a closed card only opens it.)
  const wasOpen = useRef(true);
  const n = items.length;
  // Width of an open card minus its padding: the caption is laid out at that width from the start.
  const style = {
    '--acc-cap-w': `calc((100cqw - ${16 * (n - 1)}px) * ${(2.75 / (2.75 + n - 1)).toFixed(4)} - 44px)`,
  } as CSSProperties;

  return (
    <RevealGroup className={cn('acc', className)} style={style} aria-label={ariaLabel} role={ariaLabel ? 'group' : undefined}>
      {items.map((item) => {
        const open = item.id === openId;
        const Icon = item.icon;
        const linkProps = { className: 'stretched-link !static mt-5', tone: 'light' as const };
        return (
          <article
            key={item.id}
            className={cn('acc-card has-ra', open && 'is-open')}
            onMouseEnter={() => !reduced && setOpenId(item.id)}
            onFocus={() => !reduced && setOpenId(item.id)}
            onPointerDown={(e) => {
              wasOpen.current = e.pointerType === 'mouse' || open;
            }}
            onClickCapture={(e) => {
              if (wide && !reduced && !wasOpen.current) {
                e.preventDefault();
                e.stopPropagation();
                setOpenId(item.id);
                wasOpen.current = true;
              }
            }}
          >
            {item.image && (
              <img
                src={item.image}
                alt=""
                loading="lazy"
                className="acc-img"
                style={{ objectPosition: `50% ${Math.round((item.imageFocusY ?? 0.5) * 100)}%` }}
              />
            )}
            <span className="acc-veil" aria-hidden="true" />
            {Icon && (
              <span className="acc-pic" aria-hidden="true">
                <Icon strokeWidth={1.75} />
              </span>
            )}
            <h3 className="acc-title flex items-start gap-2.5 text-xl font-semibold leading-[25px] tracking-[-0.01em]">
              {item.dotColor && (
                <span
                  aria-hidden="true"
                  className="mt-[7px] h-2.5 w-2.5 shrink-0 rounded-[3px] ring-[1.5px] ring-white"
                  style={{ background: item.dotColor }}
                />
              )}
              {item.title}
            </h3>
            {/* Collapsed (from 1024 px): the title again, written bottom to top. The h3 above stays the accessible heading. */}
            <span className="acc-vt" aria-hidden="true">
              {item.dotColor && <span className="acc-vt-dot" style={{ background: item.dotColor }} />}
              {item.title}
            </span>
            <div className="acc-cap text-[15px] leading-[22px] text-white/90">
              {item.caption}
              {item.cta.to ? (
                <UnderlineLink to={item.cta.to} {...linkProps}>
                  {item.cta.label}
                </UnderlineLink>
              ) : item.cta.href ? (
                <UnderlineLink href={item.cta.href} {...linkProps}>
                  {item.cta.label}
                </UnderlineLink>
              ) : (
                <UnderlineLink onClick={item.cta.onClick} {...linkProps}>
                  {item.cta.label}
                </UnderlineLink>
              )}
            </div>
            <ArrowDisc tone="photo" className="absolute bottom-4 right-4" />
          </article>
        );
      })}
    </RevealGroup>
  );
}

/** A caption as a short list with gold ticks (what the audience can do). */
export function CaptionList({ items }: { items: string[] }) {
  return (
    <ul className="grid gap-2">
      {items.map((line) => (
        <li key={line} className="flex gap-2.5">
          <Check className="mt-0.5 h-[18px] w-[18px] shrink-0 text-gold" strokeWidth={2.5} aria-hidden="true" />
          {line}
        </li>
      ))}
    </ul>
  );
}
