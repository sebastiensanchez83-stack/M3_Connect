import { forwardRef, useCallback, useLayoutEffect, useRef, type CSSProperties } from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';
import { prefersReducedMotion } from '@/components/motion/useReducedMotion';

/**
 * "Bouées": tabs on the Radix Tabs primitive (same keyboard model as
 * src/components/ui/tabs.tsx: arrow keys, Home/End, automatic activation).
 *
 *  - The labels sit on a thin mooring line (a slack rope across the row), with
 *    no track and no sliding pill: the only selected mark is a small gold buoy
 *    riding on that line directly under the active label. It slides there
 *    (0.45 s, slight overshoot) and bobs ±2 px. The active label is navy
 *    semibold, the others meta grey.
 *  - The panel arrives with a wave-edged wipe from left to right (0.6 s).
 *  - On narrow screens the row scrolls sideways; the active tab is kept in view.
 *  - Reduced motion: no slide, no bob, no wipe. The global pause stops the bob.
 *
 *   <BuoyTabs defaultValue="marinas">
 *     <BuoyTabsList aria-label="Profiles">
 *       <BuoyTabsTrigger value="marinas">Marinas</BuoyTabsTrigger> …
 *     </BuoyTabsList>
 *     <BuoyTabsContent value="marinas">…</BuoyTabsContent>
 *   </BuoyTabs>
 */
export const BuoyTabs = TabsPrimitive.Root;

function BuoyGlyph() {
  return (
    <svg viewBox="0 0 18 20" width="18" height="20" aria-hidden="true">
      <circle cx="9" cy="3" r="2.2" fill="rgb(11 38 83)" />
      <path d="M9 5v3.5" stroke="rgb(11 38 83)" strokeWidth="1.4" />
      <path d="M3.5 8.5h11l-1.6 10h-7.8z" fill="rgb(215 166 71)" stroke="rgb(11 38 83)" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M4.3 13h9.4" stroke="rgb(11 38 83)" strokeWidth="1.3" />
    </svg>
  );
}

export const BuoyTabsList = forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & { wrapperClassName?: string; tone?: 'light' | 'dark' }
>(({ className, wrapperClassName, tone = 'light', children, ...props }, forwardedRef) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      listRef.current = node;
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    },
    [forwardedRef],
  );

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const list = listRef.current;
    if (!wrap || !list) return;
    let frame = 0;

    const measure = () => {
      const active = list.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
      if (!active) return;
      wrap.style.setProperty('--buoy-x', `${list.offsetLeft + active.offsetLeft + active.offsetWidth / 2 - 9}px`);
      wrap.style.setProperty('--line-w', `${list.offsetWidth}px`);
      wrap.style.setProperty('--line-x', `${list.offsetLeft}px`);
      if (!wrap.hasAttribute('data-ready')) {
        // First placement without sliding in from the left.
        frame = requestAnimationFrame(() => wrap.setAttribute('data-ready', ''));
      }
      // Keep the active tab visible when the row scrolls sideways.
      if (wrap.scrollWidth > wrap.clientWidth) {
        const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth';
        const left = active.offsetLeft + list.offsetLeft;
        const right = left + active.offsetWidth;
        if (left < wrap.scrollLeft + 8) wrap.scrollTo({ left: Math.max(0, left - 16), behavior });
        else if (right > wrap.scrollLeft + wrap.clientWidth - 8) wrap.scrollTo({ left: right - wrap.clientWidth + 16, behavior });
      }
    };

    measure();
    const mo = new MutationObserver(measure);
    mo.observe(list, { attributes: true, subtree: true, attributeFilter: ['data-state'] });
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(list);
    }
    document.fonts?.ready.then(measure).catch(() => {});
    return () => {
      cancelAnimationFrame(frame);
      mo.disconnect();
      ro?.disconnect();
    };
  }, []);

  const dark = tone === 'dark';
  return (
    <div ref={wrapRef} className={cn('no-scrollbar relative max-w-full overflow-x-auto pb-5', wrapperClassName)}>
      <TabsPrimitive.List
        ref={setRefs}
        className={cn('relative inline-flex items-end gap-1 sm:gap-2', className)}
        data-tone={tone}
        {...props}
      >
        {children}
      </TabsPrimitive.List>
      {/* The mooring line, as long as the row of labels. */}
      <span
        aria-hidden="true"
        className={cn('mooring-line pointer-events-none absolute bottom-[9px] block', dark && 'mooring-line-dark')}
        style={{ left: 'var(--line-x, 0px)', width: 'var(--line-w, 100%)' } as CSSProperties}
      />
      {/* The buoy rides on the line, right under the active label. */}
      <span
        aria-hidden="true"
        className="buoy-marker pointer-events-none absolute bottom-0 left-0 block opacity-0 [[data-ready]>&]:opacity-100 [:not([data-ready])>&]:!transition-none"
        style={{ transform: 'translate3d(var(--buoy-x, 0px), 0, 0)' } as CSSProperties}
      >
        <span className="buoy-bob block">
          <BuoyGlyph />
        </span>
      </span>
    </div>
  );
});
BuoyTabsList.displayName = 'BuoyTabsList';

export const BuoyTabsTrigger = forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      // 44 px tall on phones (touch target), 40 px from md. Room under the words for the buoy.
      'relative inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-field px-3 pb-2 text-[15px] font-medium text-meta transition-colors duration-200 md:h-10',
      'hover:text-navy data-[state=active]:font-semibold data-[state=active]:text-navy',
      '[[data-tone=dark]_&]:text-white/70 [[data-tone=dark]_&]:hover:text-white [[data-tone=dark]_&]:data-[state=active]:text-white',
      'focus-visible:shadow-focus focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
BuoyTabsTrigger.displayName = 'BuoyTabsTrigger';

export const BuoyTabsContent = forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn('buoy-panel mt-4 rounded-card focus-visible:shadow-focus focus-visible:outline-none', className)}
    {...props}
  />
));
BuoyTabsContent.displayName = 'BuoyTabsContent';
