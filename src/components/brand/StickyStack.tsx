import { Children, useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useMotion } from '@/components/motion/MotionProvider';
import { useMediaQuery } from '@/components/motion/useReducedMotion';
import { subscribeScroll } from '@/components/motion/scrollLoop';
import { useParallax } from '@/components/motion/useParallax';

/**
 * Large photo cards (about 70 % of the screen height) that pile up as the page
 * scrolls: each card sticks near the top (14 px lower than the one before it)
 * and the next one slides over it; the covered card shrinks to .94 and darkens
 * (a dark veil from 0 to 60 %), both tied to the scroll. A gap of 12 vh between
 * cards leaves time to read before the next one covers.
 *
 * Each direct child of <StickyStack> becomes one card (navy, 24 px radius, white
 * text): give it a <StickyStackMedia> (photo with parallax and a navy veil) and
 * a <StickyStackBody>. The stack falls back to plain stacked cards (no sticking,
 * no scaling) under reduced motion and on screens shorter than 560 px, and a
 * card taller than the screen sticks by its bottom so its buttons stay reachable.
 *
 *   <StickyStack>
 *     <article aria-labelledby="e1"> <StickyStackMedia image={…} /> <StickyStackBody> … </StickyStackBody> </article>
 *     …
 *   </StickyStack>
 */
export function StickyStack({ children, className }: { children: ReactNode; className?: string }) {
  const { reduced } = useMotion();
  const short = useMediaQuery('(max-height: 559px)');
  const flat = reduced || short;
  const cards = Children.toArray(children);
  const count = cards.length;
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || flat) return;
    const cardEls = Array.from(root.querySelectorAll<HTMLElement>(':scope > .stk-card'));
    const inners = cardEls.map((c) => c.querySelector<HTMLElement>(':scope > .stk-inner'));
    const shades = cardEls.map((c) => c.querySelector<HTMLElement>(':scope > .stk-inner > .stk-shade'));
    let tops: number[] = [];
    const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

    const measure = () => {
      const vh = window.innerHeight;
      tops = cardEls.map((c, i) => {
        c.style.top = '';
        let t = parseFloat(getComputedStyle(c).top) || 0;
        // A card taller than the screen sticks by its bottom, or its buttons would never show.
        if (i < cardEls.length - 1) {
          const fit = Math.floor(vh - c.offsetHeight);
          if (fit < t) {
            t = fit;
            c.style.top = `${t}px`;
          }
        }
        return t;
      });
    };
    const update = () => {
      const vh = window.innerHeight;
      for (let i = 0; i < cardEls.length - 1; i++) {
        const inner = inners[i];
        const shade = shades[i];
        if (!inner || !shade) continue;
        const nextTop = cardEls[i + 1].getBoundingClientRect().top;
        const p = clamp((vh - nextTop) / Math.max(1, vh - tops[i + 1]), 0, 1);
        inner.style.transform = p > 0 ? `scale(${(1 - 0.06 * p).toFixed(4)})` : '';
        shade.style.opacity = (0.6 * p).toFixed(3);
      }
    };

    measure();
    const unsubscribe = subscribeScroll(update);
    let timer = 0;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        measure();
        update();
      }, 150);
    };
    window.addEventListener('resize', onResize);
    // Fonts and images change the cards' heights.
    document.fonts?.ready.then(() => {
      measure();
      update();
    }).catch(() => {});
    return () => {
      unsubscribe();
      window.removeEventListener('resize', onResize);
      window.clearTimeout(timer);
      cardEls.forEach((c, i) => {
        c.style.top = '';
        const inner = inners[i];
        const shade = shades[i];
        if (inner) inner.style.transform = '';
        if (shade) shade.style.opacity = '0';
      });
    };
  }, [flat, count]);

  return (
    <div ref={rootRef} className={cn('stk', flat && 'is-flat', className)}>
      {cards.map((child, i) => (
        <div key={i} className="stk-card" style={{ '--i': i } as CSSProperties}>
          <div className="stk-inner">
            {child}
            <div className="stk-shade" aria-hidden="true" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The card's photo (parallax, up to 40 px) under a navy veil. Place it first inside the card. */
export function StickyStackMedia({
  image,
  focusY = 0.5,
  className,
}: {
  image: string | null;
  /** 0 = top, 1 = bottom. */
  focusY?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useParallax(ref, { max: 40 });
  return (
    <>
      <div aria-hidden="true" className={cn('stk-media', className)}>
        <div ref={ref} className="stk-px">
          {image && <img src={image} alt="" loading="lazy" style={{ objectPosition: `50% ${Math.round(focusY * 100)}%` }} />}
        </div>
      </div>
      <div aria-hidden="true" className="stk-veil" />
    </>
  );
}

/** The card's content area: padding 18 px (phones) / 32 × 36 px, content spread top to bottom. */
export function StickyStackBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('relative flex flex-1 flex-col justify-between gap-7 p-[18px] md:px-9 md:py-8', className)}>{children}</div>
  );
}
