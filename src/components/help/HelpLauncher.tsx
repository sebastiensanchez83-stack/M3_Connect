import { Component, Suspense, lazy, useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ExternalLink, HelpCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { useMediaQuery } from '@/components/motion/useReducedMotion';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { helpPlaceFor, setHelpButtonHidden, useHelpButtonHidden, type HelpPlace, type HelpReader } from './helpPlaces';

/**
 * The floating Help button (Victor, 10 Oct 2026: "the help centre must be
 * more visible"). Mounted once, in App.tsx, after the footer.
 *
 *   - Only on the pages where people get stuck (helpPlaceFor in helpPlaces.ts:
 *     the member home and its panels, sign-up and onboarding, publishing a
 *     need, messages, /opportunities, an event's page). Nowhere else.
 *   - Bottom LEFT, so it never covers the message alerts, which come in at the
 *     bottom right. A navy pill "? Help": 48 px tall from 640 px with a small
 *     cross next to it; on phones a compact 44 px pill alone (the cross is in
 *     its panel, "Hide the Help button").
 *   - It keeps clear of whatever is stuck to the bottom of the screen: the
 *     cookie banner and the pages' own bottom bars (the event page on phones)
 *     are measured and the button sits above them. The footer's last row gets
 *     room below the button. On a phone it steps aside while a field is being
 *     typed in (the keyboard is up and the screen is short).
 *   - It never sits on a page's main action. RULE FOR OTHER LANES: put
 *     `data-help-avoid` on anything people must be able to press near the
 *     bottom left of the screen (a message box, a bar of buttons, an alert);
 *     while such an element is under the button, the button steps aside.
 *     On the messages pages the message box (a <textarea> of the page and its
 *     <form>) counts even without the attribute.
 *   - It opens a small non-modal dialog above it: "How can we help?", a search
 *     through the help centre, the three questions of this page, whose answers
 *     open right there in the panel, "Open the help centre" and "Write to the
 *     team". Focus goes into it; Esc, the close button, a press elsewhere, Tab
 *     out of it or another page closes it (Esc and the close button hand the
 *     focus back to the button).
 *   - The cross hides it for good in this browser (localStorage,
 *     helpPlaces.ts). A short note then takes its place, "The Help button is
 *     hidden. Undo", with a link to the switch that brings it back on /help
 *     (/help#help-button). Help stays in the footer, the menu under the
 *     member's name and the dashboard's "Need help?" card.
 *   - On a page with a form (sign-up, publishing a need, messages), the links
 *     that leave the page open in a new tab: nothing typed is lost. The answers
 *     themselves open in the panel, so reading one never leaves the page.
 *   - An error inside never takes the page down with it (SilentBoundary).
 *
 * The panel's words (the whole help centre, for the search) load the first
 * time it is needed, and a moment after the button shows. A failed load never
 * reloads the page (a form would be lost): the panel then keeps its links.
 */

const loadPanel = () => import('./HelpLauncherPanel');
const HelpLauncherPanel = lazy(() => loadPanel().then((m) => ({ default: m.HelpLauncherPanel })));
const prefetchPanel = () => {
  loadPanel().catch(() => { /* the panel says so when it is opened */ });
};

/** How long "The Help button is hidden. Undo" stays (not counting while it is pointed at or focused). */
const NOTICE_MS = 10000;

export function HelpLauncher() {
  return (
    <SilentBoundary>
      <HelpLauncherGate />
    </SilentBoundary>
  );
}

function HelpLauncherGate() {
  const { pathname, search } = useLocation();
  const { user, profile, organization, hasOrganization, isVerified, isModerator, loading } = useAuth();
  const hidden = useHelpButtonHidden();
  // Just hidden with the cross: the "Undo" note, and whether it takes the focus (it was on the button).
  const [notice, setNotice] = useState<{ takeFocus: boolean } | null>(null);
  // "Undo" pressed: the button takes the focus back when it shows again.
  const [focusButton, setFocusButton] = useState(false);

  // Shown again from elsewhere (/help, another tab): no note left over.
  useEffect(() => {
    if (!hidden) setNotice(null);
  }, [hidden]);

  const onHidden = useCallback((takeFocus: boolean) => setNotice({ takeFocus }), []);
  const onNoticeDone = useCallback(() => setNotice(null), []);
  const onFocused = useCallback(() => setFocusButton(false), []);

  // Wait for the account before deciding (a signed-in home must not flash the visitor's version).
  if (loading || (user && !profile)) return null;

  const reader: HelpReader = {
    signedIn: !!user,
    draft: profile?.onboarding_status === 'draft',
    pending: profile?.access_status === 'pending',
    rejected: profile?.access_status === 'rejected',
    hasOrganization,
    orgVerified: organization?.access_status === 'verified',
    verified: isVerified,
    persona: (profile?.persona as string | undefined) ?? null,
    staff: isModerator,
  };
  const place = helpPlaceFor(pathname, search, reader);

  if (hidden) {
    if (!notice) return null;
    return (
      <HiddenNotice
        takeFocus={notice.takeFocus}
        onUndo={(hadFocus) => {
          setNotice(null);
          // The button comes back on this page: the focus goes to it; elsewhere to the page.
          if (hadFocus) {
            if (place) setFocusButton(true);
            else focusMainContent();
          }
          setHelpButtonHidden(false);
        }}
        onDone={onNoticeDone}
      />
    );
  }
  if (!place) return null;
  return <Launcher place={place} member={!!user} focusOnShow={focusButton} onFocused={onFocused} onHidden={onHidden} />;
}

/* ------------------------------------------------------------ the button and its panel */

function Launcher({
  place,
  member,
  focusOnShow,
  onFocused,
  onHidden,
}: {
  place: HelpPlace;
  member: boolean;
  focusOnShow: boolean;
  onFocused: () => void;
  onHidden: (takeFocus: boolean) => void;
}) {
  const { t } = useTranslation();
  const { pathname, search } = useLocation();
  const wide = useMediaQuery('(min-width: 640px)');
  const [open, setOpen] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const panelId = `${uid}-help-panel`;
  const titleId = `${uid}-help-title`;
  const { offset, bottom } = useLauncherSpot(wide);
  const buttonH = wide ? 48 : 44;
  const typing = usePhoneTyping(rootRef);
  // The button's corner of the screen: the pill (and its cross from 640 px), with a little air;
  // on phones 34 px more for the iPhone's home bar (the button sits above it).
  const covered = useCoveredSpot(place.key === 'messages', offset + buttonH + 8 + (wide ? 0 : 34), wide ? 184 : 112);
  // Away while a field of the page is typed in on a phone, or while it would sit on something to press;
  // never while it is open or has the focus.
  const floating = !typing && (!covered || open || focusWithin);

  const close = useCallback((returnFocus: boolean) => {
    // The button takes the focus before the panel goes, so it is never dropped on the page.
    if (returnFocus) btnRef.current?.focus();
    setOpen(false);
  }, []);

  // Another page (or another panel of the home page): closed.
  useEffect(() => setOpen(false), [pathname, search]);

  // The panel's words, a moment after the button shows (not on the first paint).
  useEffect(() => {
    const id = window.setTimeout(prefetchPanel, 2500);
    return () => window.clearTimeout(id);
  }, []);

  // Back after "Undo": the focus on the button again.
  useEffect(() => {
    if (!focusOnShow) return;
    if (btnRef.current) btnRef.current.focus({ preventScroll: true });
    else focusMainContent();
    onFocused();
  }, [focusOnShow, onFocused]);

  // Open: focus into the panel; a press elsewhere or Esc closes it.
  useEffect(() => {
    if (!open) return;
    // The panel itself, unless its search already took the focus (its effect runs first).
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
    const onDown = (e: PointerEvent) => {
      if (rootRef.current?.contains(e.target as Node | null)) return;
      close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      close(true);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  const hide = () => {
    // The button and its cross are about to go: the focus moves to the note's "Undo", not dropped on <body>.
    const hadFocus = !!rootRef.current?.contains(document.activeElement);
    setOpen(false);
    onHidden(hadFocus);
    setHelpButtonHidden(true);
  };

  const footerRoom = offset + buttonH + 16;
  // Never taller than the screen above the button, under the site header.
  const maxHeight = `calc(100dvh - ${offset + buttonH + 8 + 88}px)`;
  const keep = !!place.keepPage;
  const newTab = keep ? { target: '_blank', rel: 'noopener' } : {};

  return (
    <>
      {/*
        The footer's last row (copyright, pause control) stays readable below the button.
        Kept while the button steps aside, so the page never changes height under the reader.
        !important: smc-motion.css gives that row 6rem under a page's bottom bar with a
        stronger selector, and the button then sits above that bar (footerRoom counts it).
      */}
      <style>{`.footer-last-row{padding-bottom:${footerRoom}px !important}`}</style>
      {floating && (
        <div
          ref={rootRef}
          data-help-launcher=""
          data-help-place={place.key}
          className="fixed left-4 z-[45] flex flex-col items-start gap-2 print:hidden sm:left-6"
          style={{ bottom }}
          // Keyboard focus only: a tap leaves the focus on the button on some phones, and must not pin it there.
          onFocus={(e) => setFocusWithin(isFocusVisible(e.target))}
          // Tab out of the panel (to the page): it closes, the focus goes where it was going.
          onBlur={(e) => {
            const next = e.relatedTarget as Node | null;
            if (next && rootRef.current?.contains(next)) return;
            setFocusWithin(false);
            if (open && next) close(false);
          }}
        >
          {open && (
            <div
              ref={panelRef}
              id={panelId}
              role="dialog"
              aria-modal="false"
              aria-labelledby={titleId}
              tabIndex={-1}
              className={cn(
                'w-[min(23.5rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-card border border-rule bg-white p-4 text-left text-ink shadow-drawer outline-none sm:p-5',
                'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-200',
              )}
              style={{ maxHeight }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 pt-1">
                  <p className="text-meta-caps">{t('helpButton.eyebrow', 'Help')}</p>
                  <h2 id={titleId} className="mt-1 text-card-title text-navy">{t('helpButton.title', 'How can we help?')}</h2>
                </div>
                <button
                  type="button"
                  onClick={() => close(true)}
                  aria-label={t('helpButton.close', 'Close help')}
                  className="-mr-1.5 -mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-meta transition-colors hover:bg-chip hover:text-navy focus-visible:shadow-focus focus-visible:outline-none"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>

              <PanelBoundary>
                <Suspense fallback={<PanelSkeleton />}>
                  <HelpLauncherPanel place={place} panelRef={panelRef} member={member} />
                </Suspense>
              </PanelBoundary>

              {/* The help centre, then a person at M3. */}
              <div className="mt-4 flex flex-col items-start gap-1 border-t border-rule pt-4">
                <Button asChild variant="ctaNavy" size="sm" arrow={false} className="w-full justify-center">
                  <Link to="/help" {...newTab}>
                    {t('helpButton.openCentre', 'Open the help centre')}
                    {keep && <NewTabMark />}
                  </Link>
                </Button>
                <UnderlineLink to="/contact" {...newTab} external={keep} arrow={!keep} className="mt-1 min-h-11 !text-[15px]">
                  {t('helpButton.write', 'Write to the team')}
                  {keep && <ExternalLink className="ml-1 inline h-3.5 w-3.5 -translate-y-px" aria-hidden="true" />}
                </UnderlineLink>
                <p className="text-[14px] leading-5 text-meta">
                  {t('helpButton.orEmail', 'Or e-mail')}{' '}
                  <a href="mailto:events@m3monaco.com" className="font-medium text-navy underline decoration-navy/30 underline-offset-2 hover:decoration-gold">events@m3monaco.com</a>
                </p>
                <button
                  type="button"
                  onClick={hide}
                  aria-describedby={`${uid}-hide-hint`}
                  className="focus-ring -ml-1 mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-field px-1 text-[14px] font-medium text-meta transition-colors hover:text-navy"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                  {t('helpButton.hide', 'Hide the Help button')}
                </button>
                <p id={`${uid}-hide-hint`} className="sr-only">
                  {t('helpButton.hideHint', 'You can bring it back at the end of the help centre page.')}
                </p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              ref={btnRef}
              type="button"
              aria-label={t('helpButton.label', 'Help with this page')}
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-controls={open ? panelId : undefined}
              onClick={() => (open ? close(false) : setOpen(true))}
              onPointerEnter={prefetchPanel}
              onFocus={prefetchPanel}
              className={cn(
                // Phones: a compact pill (about 84 x 44 px). From 640 px: 48 px tall, a little wider.
                'inline-flex h-11 items-center gap-1.5 rounded-pill border-2 pl-2 pr-3.5 text-[15px] font-semibold shadow-drawer transition-colors duration-200 sm:h-12 sm:gap-2 sm:pl-3 sm:pr-5 sm:text-[16px]',
                'focus-visible:shadow-focus focus-visible:outline-none',
                open ? 'border-navy bg-white text-navy' : 'border-navy bg-navy text-white hover:border-gold hover:bg-gold hover:text-navy',
              )}
            >
              <HelpCircle className={cn('h-5 w-5 shrink-0 sm:h-6 sm:w-6', open ? 'text-navy' : 'text-gold')} strokeWidth={2.25} aria-hidden="true" />
              {t('helpButton.text', 'Help')}
            </button>
            {/* From 640 px the cross sits next to the button; on phones it is in the panel (a smaller corner to cover). */}
            {wide && !open && (
              <button
                type="button"
                onClick={hide}
                aria-label={t('helpButton.hide', 'Hide the Help button')}
                title={t('helpButton.hide', 'Hide the Help button')}
                // 32 px to look at, 44 px to touch.
                className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full border border-rule bg-white text-meta shadow-hover transition-colors before:absolute before:-inset-1.5 before:content-[''] hover:border-navy/40 hover:text-navy focus-visible:shadow-focus focus-visible:outline-none"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------ "hidden, Undo" */

/**
 * Where the button was, for a moment after the cross: "The Help button is
 * hidden" with "Undo" under the finger, and the way back for later (the switch
 * at the end of /help). Not a toast: the site shows one toast at a time (it
 * would push out a message alert), and on phones toasts come in at the top of
 * the screen, far from the finger that pressed the cross.
 */
function HiddenNotice({ takeFocus, onUndo, onDone }: { takeFocus: boolean; onUndo: (hadFocus: boolean) => void; onDone: () => void }) {
  const { t } = useTranslation();
  const wide = useMediaQuery('(min-width: 640px)');
  const { bottom } = useLauncherSpot(wide);
  const rootRef = useRef<HTMLDivElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const textId = useId();
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (takeFocus) undoRef.current?.focus({ preventScroll: true });
    // Only when it shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // It goes after NOTICE_MS, not counting while the pointer is on it or the keyboard is in it.
  useEffect(() => {
    let left = NOTICE_MS;
    const id = window.setInterval(() => {
      const el = rootRef.current;
      if (el && isHeld(el)) return;
      left -= 250;
      if (left > 0) return;
      window.clearInterval(id);
      if (el?.contains(document.activeElement)) focusMainContent();
      done.current();
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div
      ref={rootRef}
      data-help-launcher=""
      data-help-notice=""
      className="fixed left-4 z-[45] w-max max-w-[calc(100vw-2rem)] rounded-card bg-navy px-4 py-2.5 text-white shadow-drawer print:hidden sm:left-6 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200"
      style={{ bottom }}
    >
      <div className="flex items-center gap-3">
        <p id={textId} role="status" className="text-[15px] font-semibold leading-5">
          {t('helpButton.hiddenTitle', 'The Help button is hidden.')}
        </p>
        <button
          ref={undoRef}
          type="button"
          aria-describedby={textId}
          onClick={() => onUndo(!!rootRef.current?.contains(document.activeElement))}
          className="inline-flex h-11 shrink-0 items-center rounded-pill bg-white px-4 text-[15px] font-semibold text-navy transition-colors hover:bg-gold focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t('helpButton.undo', 'Undo')}
        </button>
      </div>
      <Link
        to="/help#help-button"
        className="inline-flex min-h-11 items-center text-[14px] leading-5 text-white/85 underline decoration-white/40 underline-offset-2 hover:text-white hover:decoration-gold focus-visible:shadow-focus focus-visible:outline-none"
      >
        {t('helpButton.bringBack', 'Bring it back later from the help centre')}
      </Link>
    </div>
  );
}

function isHeld(el: HTMLElement): boolean {
  try {
    return el.matches(':hover') || !!el.querySelector(':focus-visible');
  } catch {
    // An old browser without :focus-visible.
    return el.matches(':hover');
  }
}

/** The element has the focus from the keyboard (not from a press). */
function isFocusVisible(el: EventTarget | null): boolean {
  if (!(el instanceof Element)) return false;
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
}

/**
 * The focus to the page's main content (App.tsx: <main id="main-content">),
 * without scrolling and without a ring around the whole page; both are undone
 * when the focus moves on.
 */
function focusMainContent() {
  const main = document.getElementById('main-content');
  if (!main) return;
  const hadTabIndex = main.hasAttribute('tabindex');
  if (!hadTabIndex) main.setAttribute('tabindex', '-1');
  main.style.outline = 'none';
  main.addEventListener('blur', () => {
    if (!hadTabIndex) main.removeAttribute('tabindex');
    main.style.outline = '';
  }, { once: true });
  main.focus({ preventScroll: true });
}

function NewTabMark() {
  const { t } = useTranslation();
  return (
    <>
      <ExternalLink className="ml-2 h-4 w-4" aria-hidden="true" />
      <span className="sr-only"> {t('helpButton.newTab', '(opens in a new tab)')}</span>
    </>
  );
}

function PanelSkeleton() {
  return (
    <div className="mt-4 space-y-3" aria-hidden="true">
      <div className="h-12 rounded-pill bg-chip motion-safe:animate-pulse" />
      <div className="h-4 w-2/3 rounded bg-chip motion-safe:animate-pulse" />
      <div className="h-4 w-5/6 rounded bg-chip motion-safe:animate-pulse" />
      <div className="h-4 w-3/4 rounded bg-chip motion-safe:animate-pulse" />
    </div>
  );
}

/** The panel's questions could not load (a deploy since the page opened, no network): its links still work. */
class PanelBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return <PanelFailed />;
    return this.props.children;
  }
}

function PanelFailed() {
  const { t } = useTranslation();
  return (
    <p className="mt-3 text-[15px] leading-[22px] text-meta">
      {t('helpButton.failed', 'The questions did not load. The help centre below has every answer.')}
    </p>
  );
}

/**
 * The Help button is optional: if it ever breaks, it disappears and the page
 * stays (App.tsx mounts it outside the pages' ErrorBoundary).
 */
class SilentBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('Help button hidden after an error', error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/* ------------------------------------------------------------ keeping clear */

/** Where the button (or its "hidden" note) sits: px from the bottom, and the CSS value. */
function useLauncherSpot(wide: boolean): { offset: number; bottom: string } {
  const clearance = useBottomClearance();
  // Above the cookie banner or a page's bottom bar; else 16 px (phones) or 24 px from the bottom.
  const base = wide ? 24 : 16;
  if (clearance > 0) return { offset: clearance + 12, bottom: `${clearance + 12}px` };
  return { offset: base, bottom: `calc(${base}px + env(safe-area-inset-bottom, 0px))` };
}

/** Bars stuck to the bottom of the screen: the cookie banner, a page's own bottom bar. */
const BAR = '[data-cookie-banner], .fixed.inset-x-0.bottom-0';

/** A node added or removed that is, or holds, one of `selector`. */
function holds(node: Node, selector: string): boolean {
  if (!(node instanceof Element)) return false;
  try {
    return node.matches(selector) || !!node.querySelector(selector);
  } catch {
    return false;
  }
}

/** A MutationObserver on the page that calls `onChange` only when one of `selector` comes or goes. */
function watchFor(selector: string, onChange: () => void): MutationObserver {
  const mo = new MutationObserver((records) => {
    for (let i = 0; i < records.length; i += 1) {
      const { addedNodes, removedNodes } = records[i];
      for (let j = 0; j < addedNodes.length; j += 1) {
        if (holds(addedNodes[j], selector)) return onChange();
      }
      for (let j = 0; j < removedNodes.length; j += 1) {
        if (holds(removedNodes[j], selector)) return onChange();
      }
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
  return mo;
}

/**
 * How much of the bottom of the screen is taken by something stuck there: the
 * cookie banner, or a page's own bottom bar (`fixed inset-x-0 bottom-0`, the
 * event page on phones). Measured again when such a bar comes or goes, when it
 * finishes sliding in, and on resize; nothing else on the page triggers it.
 */
function useBottomClearance(): number {
  const [clearance, setClearance] = useState(0);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const vh = window.innerHeight;
      let top = vh;
      document.querySelectorAll<HTMLElement>(BAR).forEach((el) => {
        if (el.closest('[data-help-launcher]')) return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        // Stuck to the bottom, and a bar rather than a full-screen layer.
        if (r.bottom < vh - 2 || r.top < vh * 0.5) return;
        top = Math.min(top, r.top);
      });
      const next = Math.max(0, Math.round(vh - top));
      setClearance((c) => (c === next ? c : next));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    // A bar's own slide-in or fade, not every animation of the page.
    const onEnd = (e: Event) => {
      const el = e.target;
      if (el instanceof Element && el.matches(BAR)) schedule();
    };
    schedule();
    const mo = watchFor(BAR, schedule);
    window.addEventListener('resize', schedule, { passive: true });
    document.addEventListener('animationend', onEnd, true);
    document.addEventListener('transitionend', onEnd, true);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      mo.disconnect();
      window.removeEventListener('resize', schedule);
      document.removeEventListener('animationend', onEnd, true);
      document.removeEventListener('transitionend', onEnd, true);
    };
  }, []);
  return clearance;
}

/** What the button must never sit on (see the rule in the header). */
const AVOID = '[data-help-avoid]';
/** On the messages pages: the message box, even before the messages lane marks it. */
const AVOID_MESSAGES = `${AVOID}, #main-content textarea`;

/**
 * Whether something people press is in the button's corner of the screen (the
 * bottom `height` px, the left `width` px): an element marked data-help-avoid,
 * or on the messages pages the message box (its <form>). An IntersectionObserver
 * follows them as the page scrolls; the list is read again when one comes or goes.
 */
function useCoveredSpot(messages: boolean, height: number, width: number): boolean {
  const [covered, setCovered] = useState(false);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const selector = messages ? AVOID_MESSAGES : AVOID;
    const inSpot = new Map<Element, boolean>();
    let io: IntersectionObserver | null = null;
    let frame = 0;
    const build = () => {
      frame = 0;
      io?.disconnect();
      inSpot.clear();
      const targets = new Set<Element>();
      document.querySelectorAll(selector).forEach((el) => {
        const target = el.tagName === 'TEXTAREA' && !el.matches(AVOID) ? el.closest('form') ?? el : el;
        if (!target.closest('[data-help-launcher]')) targets.add(target);
      });
      if (targets.size === 0) {
        setCovered(false);
        return;
      }
      // The root: the screen cut down to the button's corner.
      const top = Math.max(0, Math.round(window.innerHeight - height));
      const right = Math.max(0, Math.round(document.documentElement.clientWidth - width));
      io = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => inSpot.set(e.target, e.isIntersecting && e.intersectionRect.width > 0 && e.intersectionRect.height > 0));
          let any = false;
          inSpot.forEach((v) => { any = any || v; });
          setCovered(any);
        },
        { rootMargin: `-${top}px -${right}px 0px 0px` },
      );
      targets.forEach((el) => io!.observe(el));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(build);
    };
    schedule();
    const mo = watchFor(selector, schedule);
    window.addEventListener('resize', schedule, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      io?.disconnect();
      mo.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [messages, height, width]);
  return covered;
}

const NOT_TYPED = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit']);

/** On a phone, a field of the page (not of the help panel) has the focus: the keyboard is up. */
function usePhoneTyping(rootRef: RefObject<HTMLElement>): boolean {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const phone = window.matchMedia('(max-width: 767px)');
    let timer = 0;
    const check = () => {
      const el = document.activeElement as HTMLElement | null;
      const field = !!el && (
        el.isContentEditable
        || el.tagName === 'TEXTAREA'
        || el.tagName === 'SELECT'
        || (el.tagName === 'INPUT' && !NOT_TYPED.has((el as HTMLInputElement).type))
      );
      setTyping(phone.matches && field && !rootRef.current?.contains(el) && !el?.closest('[data-help-launcher]'));
    };
    const later = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(check, 0);
    };
    document.addEventListener('focusin', later);
    document.addEventListener('focusout', later);
    phone.addEventListener?.('change', check);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('focusin', later);
      document.removeEventListener('focusout', later);
      phone.removeEventListener?.('change', check);
    };
  }, [rootRef]);
  return typing;
}
