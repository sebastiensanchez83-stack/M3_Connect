import { useEffect, useRef } from 'react';

/**
 * A thin gold reading-progress line (2 px, #d7a647) under the floating header
 * bar, growing from the left with how far the page has been read (scaleX, one
 * requestAnimationFrame per burst of scroll, one passive listener). Decorative
 * (aria-hidden). It has no transition: it simply follows the scroll, so under
 * reduced motion and while motion is paused it shows the same progress, static.
 *
 * Rendered by the Navbar inside the bar itself (so it tucks away with it) and
 * not on working screens where the header is pinned (PINNED_HEADER_ROUTES).
 */
export function ReadingProgress({ className }: { className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let frame = 0;
    let last = -1;
    const compute = () => {
      frame = 0;
      const el = ref.current;
      if (!el) return;
      const doc = document.documentElement;
      const travel = doc.scrollHeight - window.innerHeight;
      const p = travel > 0 ? Math.min(1, Math.max(0, window.scrollY / travel)) : 0;
      if (Math.abs(p - last) < 0.001) return;
      last = p;
      el.style.transform = `scaleX(${p.toFixed(4)})`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(compute);
    };
    compute();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    // The page grows as its content loads: keep the ratio honest.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    ro?.observe(document.body);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      ro?.disconnect();
    };
  }, []);

  return (
    <span aria-hidden="true" className={className ?? 'pointer-events-none absolute inset-x-4 top-full mt-[3px] block h-0.5 print:hidden'}>
      <span ref={ref} className="block h-full origin-left rounded-full bg-[#d7a647]" style={{ transform: 'scaleX(0)' }} />
    </span>
  );
}
