import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { helpHref } from './helpContent';

/**
 * A small "i" next to something people get stuck on: a press opens a short
 * card with a title, one or two sentences and "Learn more", which goes to the
 * answer on /help (#anchor).
 *
 *   <HelpTip title="About the review" more="verification-time">
 *     M3 checks every new account by hand…
 *   </HelpTip>
 *
 * - The button is 24 px to look at and 44 px to touch (a transparent ring
 *   around it, lifted with z-[1] so a later sibling with its own stacking
 *   context, such as an opacity-90 paragraph, cannot cover the ring), named "Help: <title>", with aria-expanded. It takes the colour
 *   of the text around it, so it reads on a white card, a yellow banner or navy
 *   (`tone="dark"` only changes the hover).
 * - The card is a non-modal dialog drawn in a portal (so no card with
 *   overflow-hidden can clip it), fixed under the button, or over it when the
 *   room below is short, and kept inside the screen. Focus moves into it on
 *   open; Esc, the close button, a press elsewhere, a scroll that takes the
 *   button off screen or another page closes it. Esc and the close button give
 *   the focus back to the button. Tab past the last link goes on to what
 *   follows the button on the page, Shift+Tab from the top comes back to it.
 * - `newTab`: "Learn more" opens /help in a new tab (forms: what was typed
 *   stays), with a small new-tab icon. Pressing it otherwise leaves the page.
 * - Under reduced motion the card appears without its short fade.
 */
export function HelpTip({
  title,
  children,
  more,
  newTab = false,
  tone = 'light',
  className,
}: {
  /** The card's title, and the button's name ("Help: About the review"). */
  title: string;
  /** One or two short sentences. */
  children: ReactNode;
  /** The question id on /help that "Learn more" opens (helpContent.ts); none: no link. */
  more?: string;
  /** "Learn more" opens in a new tab (use it on forms). */
  newTab?: boolean;
  /** 'dark' on navy: a light hover. */
  tone?: 'light' | 'dark';
  className?: string;
}) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const popId = `${uid}-help`;
  const titleId = `${uid}-help-title`;
  const bodyId = `${uid}-help-body`;

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    setPlace(null);
    if (returnFocus) btnRef.current?.focus();
  }, []);

  // Where the card goes: under the button, else over it; never out of the screen.
  const measure = useCallback(() => {
    const btn = btnRef.current;
    const pop = popRef.current;
    if (!btn || !pop) return;
    const r = btn.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    if (r.bottom < 0 || r.top > vh) {
      close(false);
      return;
    }
    const width = Math.min(320, vw - 32);
    const h = pop.offsetHeight;
    const left = Math.min(Math.max(16, r.left + r.width / 2 - width / 2), vw - 16 - width);
    const below = vh - r.bottom;
    const top = below >= h + 16 || r.top < h + 16 ? r.bottom + 8 : r.top - 8 - h;
    setPlace((p) => (p && p.top === top && p.left === left && p.width === width ? p : { top, left, width }));
  }, [close]);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
  }, [open, measure]);

  // Focus goes into the card once it is placed.
  const placed = place !== null;
  useEffect(() => {
    if (open && placed) popRef.current?.focus({ preventScroll: true });
  }, [open, placed]);

  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure(); });
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (popRef.current?.contains(target) || btnRef.current?.contains(target)) return;
      close(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(true);
      }
    };
    window.addEventListener('scroll', schedule, { passive: true, capture: true });
    window.addEventListener('resize', schedule, { passive: true });
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, measure, close]);

  // Another page: closed.
  useEffect(() => {
    setOpen(false);
    setPlace(null);
  }, [pathname]);

  const onCardKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !popRef.current) return;
    const focusables = Array.from(popRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'));
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === popRef.current || active === first)) {
      e.preventDefault();
      close(true);
    } else if (!e.shiftKey && active === last) {
      // Back on the button, then the browser's own Tab moves on to what follows it.
      close(false);
      btnRef.current?.focus();
    }
  };

  const dark = tone === 'dark';

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={t('help.tip.open', { topic: title, defaultValue: 'Help: {{topic}}' })}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? popId : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
        className={cn(
          // 24 px to look at, 44 px to touch.
          "relative z-[1] inline-grid h-6 w-6 shrink-0 place-items-center rounded-full align-middle text-current transition-colors before:absolute before:-inset-2.5 before:content-[''] focus-visible:shadow-focus focus-visible:outline-none",
          dark ? 'hover:bg-white/15' : 'hover:bg-navy/10',
          open && (dark ? 'bg-white/15' : 'bg-navy/10'),
          className,
        )}
      >
        <Info className="h-[18px] w-[18px]" strokeWidth={2.25} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            id={popId}
            role="dialog"
            aria-modal="false"
            aria-labelledby={titleId}
            aria-describedby={bodyId}
            tabIndex={-1}
            onKeyDown={onCardKeyDown}
            style={place
              ? { top: place.top, left: place.left, width: place.width }
              // First frame, before it is measured: off screen, at its final width.
              : { top: 0, left: -10000, width: Math.min(320, document.documentElement.clientWidth - 32) }}
            className={cn(
              // transition-none: duration-150 below times the fade only. Without it, every
              // property would be transitioned too, and the card would slide in from its
              // measuring place off screen (left -10000px) and trail behind on scroll.
              'fixed z-[80] rounded-card border border-rule bg-white p-4 pr-12 text-left font-normal normal-case tracking-normal text-ink shadow-drawer outline-none transition-none',
              // The short fade starts once the card is placed (not while it is measured, hidden).
              place && 'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-150',
            )}
          >
            <p id={titleId} className="text-[15px] font-semibold leading-5 text-navy">{title}</p>
            <div id={bodyId} className="mt-1.5 text-[15px] leading-[22px] text-ink">{children}</div>
            {/* "Learn more" is 44 px tall, like every other control of the card. */}
            {more && (
              newTab ? (
                // A new tab, said in words to screen readers (external) and shown by its icon.
                <UnderlineLink to={helpHref(more)} target="_blank" rel="noopener" external arrow={false} className="mt-1 min-h-11 !text-[15px]">
                  {t('help.tip.more', 'Learn more')}
                  <ExternalLink className="ml-1 inline h-3.5 w-3.5 -translate-y-px" aria-hidden="true" />
                </UnderlineLink>
              ) : (
                <UnderlineLink to={helpHref(more)} className="mt-1 min-h-11 !text-[15px]">
                  {t('help.tip.more', 'Learn more')}
                </UnderlineLink>
              )
            )}
            <button
              type="button"
              onClick={() => close(true)}
              aria-label={t('help.tip.close', 'Close')}
              // 32 px to look at, 44 px to touch.
              className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full text-meta transition-colors before:absolute before:-inset-1.5 before:content-[''] hover:bg-chip hover:text-navy focus-visible:shadow-focus focus-visible:outline-none"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
