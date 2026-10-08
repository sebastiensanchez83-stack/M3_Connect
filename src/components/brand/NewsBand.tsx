import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useMotion } from '@/components/motion/MotionProvider';

/**
 * The news band: a thin strip (48 px, 56 px from md; white, navy text 15–16 px)
 * right under the home hero, scrolling continuously at normal size. Each item is
 * a link (a live figure, an upcoming event, the newest members, the latest
 * article), separated from the next by a small gold dot.
 *
 *  - The list is repeated until it fills the band and the track slides by exactly
 *    one copy (45 px/s), so the loop is seamless. The extra copies are aria-hidden
 *    and out of the tab order: assistive technology reads the list once.
 *  - It pauses while the pointer rests on it and while keyboard focus is inside
 *    (a link that was scrolled off screen by the browser to show focus goes back
 *    when focus leaves).
 *  - Under reduced motion and under the global pause it is static: one copy,
 *    wrapped over as many lines as it needs.
 *
 * Items are plain data: `lead` is the small gold-text word or number in front
 * ("D-51", "180"), `text` the rest. It renders nothing without items.
 *
 *   <NewsBand items={[{ id: 'wys', lead: 'D-51', text: 'World Yachting Summit · Dubai · By invitation', href: '/wys26' }]} />
 */
export interface NewsItem {
  id: string;
  /** Short lead in gold text: a figure, a countdown, "New member". */
  lead?: string;
  text: string;
  /** A page of this site. */
  href: string;
}

const SPEED = 45; // px per second

function NewsLink({ item, hidden }: { item: NewsItem; hidden?: boolean }) {
  return (
    <Link
      to={item.href}
      tabIndex={hidden ? -1 : undefined}
      title={item.lead ? `${item.lead} ${item.text}` : item.text}
      className="uline uline--plain min-h-11 !text-[15px] !font-medium !leading-6 whitespace-nowrap md:!text-[16px]"
    >
      <span className="uline-t">
        {item.lead && <span className="mr-1.5 font-semibold text-gold-text">{item.lead}</span>}
        {item.text}
      </span>
    </Link>
  );
}

const Dot = () => <span aria-hidden="true" className="mx-5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold md:mx-6" />;

export function NewsBand({ items, className }: { items: NewsItem[]; className?: string }) {
  const { t } = useTranslation();
  const { still } = useMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const unitRef = useRef<HTMLUListElement>(null);
  const [unit, setUnit] = useState(0);
  const [copies, setCopies] = useState(2);

  // How wide one copy is, and how many copies fill the band: measured again when the band or the fonts change.
  useLayoutEffect(() => {
    if (still) return;
    const root = rootRef.current;
    const first = unitRef.current;
    if (!root || !first) return;
    const measure = () => {
      const w = first.getBoundingClientRect().width;
      if (w <= 0) return;
      setUnit((u) => (Math.abs(u - w) < 0.5 ? u : w));
      const need = Math.max(2, Math.ceil(root.clientWidth / w) + 1);
      setCopies((c) => (c === need ? c : need));
    };
    measure();
    document.fonts?.ready.then(measure).catch(() => {});
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    ro.observe(first);
    return () => ro.disconnect();
  }, [still, items]);

  if (!items.length) return null;
  const label = t('brand.news.label', 'News and figures');

  if (still) {
    return (
      <section aria-label={label} className={cn('news border-b border-rule bg-white text-navy', className)}>
        <ul className="mx-auto flex min-h-12 max-w-7xl flex-wrap items-center gap-y-1 px-4 py-2 sm:px-6 md:min-h-14">
          {items.map((item, i) => (
            <li key={item.id} className="flex items-center">
              <NewsLink item={item} />
              {i < items.length - 1 && <Dot />}
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section
      aria-label={label}
      className={cn('news border-b border-rule bg-white text-navy', className)}
      // A link the browser scrolled into view (keyboard focus) goes back to its place when focus leaves.
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          const vp = e.currentTarget.querySelector<HTMLElement>('.news-viewport');
          if (vp) vp.scrollLeft = 0;
        }
      }}
    >
      <div ref={rootRef} className="news-viewport h-12 md:h-14">
        <div
          className="news-track h-full"
          style={
            unit > 0
              ? ({ '--news-unit': `${unit}px`, '--news-duration': `${Math.max(12, unit / SPEED).toFixed(1)}s` } as React.CSSProperties)
              : { animation: 'none' }
          }
        >
          {Array.from({ length: copies }, (_, k) => (
            <ul
              key={k}
              ref={k === 0 ? unitRef : undefined}
              aria-hidden={k > 0 ? true : undefined}
              className="flex shrink-0 items-center"
            >
              {items.map((item) => (
                <Fragment key={item.id}>
                  <li className="flex items-center">
                    <NewsLink item={item} hidden={k > 0} />
                  </li>
                  <li aria-hidden="true" className="flex items-center">
                    <Dot />
                  </li>
                </Fragment>
              ))}
            </ul>
          ))}
        </div>
      </div>
    </section>
  );
}
