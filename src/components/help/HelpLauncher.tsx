import { Component, Suspense, lazy, useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ExternalLink, HelpCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ToastAction } from '@/components/ui/toast';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { useMediaQuery } from '@/components/motion/useReducedMotion';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
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
 *     bottom right. A navy pill "? Help", 48 px tall from 640 px, 44 px on phones.
 *   - It keeps clear of whatever is stuck to the bottom of the screen: the
 *     cookie banner and the pages' own bottom bars (the event page on phones)
 *     are measured and the button sits above them. The footer's last row gets
 *     room below the button. On a phone it steps aside while a field is being
 *     typed in (the keyboard is up and the screen is short).
 *   - It opens a small non-modal dialog above it: "How can we help?", a search
 *     through the help centre, the three questions of this page, "Open the
 *     help centre" and "Write to the team". Focus goes into it; Esc, the close
 *     button, a press elsewhere, Tab out of it or another page closes it (Esc
 *     and the close button hand the focus back to the button).
 *   - The small cross next to it hides it for good in this browser
 *     (localStorage, helpPlaces.ts), with "Undo" in the message that
 *     follows. Help stays in the footer, the menu under the member's name and
 *     the dashboard's "Need help?" card, and /help has "Show the help button
 *     again".
 *   - On a page with a form (sign-up, publishing a need, messages), every link
 *     of the panel opens in a new tab: nothing typed is lost.
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

export function HelpLauncher() {
  const { pathname, search } = useLocation();
  const { user, profile, organization, hasOrganization, isVerified, loading } = useAuth();
  const hidden = useHelpButtonHidden();

  // Wait for the account before deciding (a signed-in home must not flash the visitor's version).
  if (hidden || loading || (user && !profile)) return null;

  const reader: HelpReader = {
    signedIn: !!user,
    draft: profile?.onboarding_status === 'draft',
    pending: profile?.access_status === 'pending',
    rejected: profile?.access_status === 'rejected',
    hasOrganization,
    orgVerified: organization?.access_status === 'verified',
    verified: isVerified,
  };
  const place = helpPlaceFor(pathname, search, reader);
  if (!place) return null;
  return <Launcher place={place} />;
}

/* ------------------------------------------------------------ the button and its panel */

function Launcher({ place }: { place: HelpPlace }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const wide = useMediaQuery('(min-width: 640px)');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const panelId = `${uid}-help-panel`;
  const titleId = `${uid}-help-title`;
  const clearance = useBottomClearance();
  const typing = usePhoneTyping(rootRef);

  const close = useCallback((returnFocus: boolean) => {
    // The button takes the focus before the panel goes, so it is never dropped on the page.
    if (returnFocus) btnRef.current?.focus();
    setOpen(false);
  }, []);

  // Another page: closed.
  useEffect(() => setOpen(false), [pathname]);

  // The panel's words, a moment after the button shows (not on the first paint).
  useEffect(() => {
    const id = window.setTimeout(prefetchPanel, 2500);
    return () => window.clearTimeout(id);
  }, []);

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
    setOpen(false);
    setHelpButtonHidden(true);
    toast({
      title: t('helpButton.hiddenTitle', 'The Help button is hidden'),
      description: t('helpButton.hiddenBody', 'Help stays at the bottom of every page. You can bring the button back from the help centre.'),
      action: (
        <ToastAction
          altText={t('helpButton.showAgain', 'Show the help button again')}
          onClick={() => setHelpButtonHidden(false)}
          className="h-11 rounded-pill border-navy/25 px-4 text-navy hover:border-navy hover:bg-chip"
        >
          {t('helpButton.undo', 'Undo')}
        </ToastAction>
      ),
    });
  };

  // Above the cookie banner or a page's bottom bar; else 16 px (phones) or 24 px from the bottom.
  const base = wide ? 24 : 16;
  const bottom = clearance > 0 ? `${clearance + 12}px` : `calc(${base}px + env(safe-area-inset-bottom, 0px))`;
  const buttonH = wide ? 48 : 44;
  const footerRoom = (clearance > 0 ? clearance + 12 : base) + buttonH + 16;
  // Never taller than the screen above the button, under the site header.
  const maxHeight = `calc(100dvh - ${(clearance > 0 ? clearance + 12 : base) + buttonH + 8 + 88}px)`;
  const keep = !!place.keepPage;
  const newTab = keep ? { target: '_blank', rel: 'noopener' } : {};

  if (typing) return null;

  return (
    <>
      {/* The footer's last row (copyright, pause control) stays readable below the button. */}
      <style>{`.footer-last-row{padding-bottom:${footerRoom}px}`}</style>
      <div
        ref={rootRef}
        data-help-launcher=""
        data-help-place={place.key}
        className="fixed left-4 z-[45] flex flex-col items-start gap-2 print:hidden sm:left-6"
        style={{ bottom }}
        // Tab out of the panel (to the page): it closes, the focus goes where it was going.
        onBlur={(e) => {
          const next = e.relatedTarget as Node | null;
          if (open && next && !rootRef.current?.contains(next)) close(false);
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
                <HelpLauncherPanel place={place} panelRef={panelRef} />
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
                {t('helpButton.hideHint', 'You can bring it back from the help centre.')}
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
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
              'inline-flex h-11 items-center gap-2 rounded-pill border-2 pl-2.5 pr-4 text-[15px] font-semibold shadow-drawer transition-colors duration-200 sm:h-12 sm:pl-3 sm:pr-5 sm:text-[16px]',
              'focus-visible:shadow-focus focus-visible:outline-none',
              open ? 'border-navy bg-white text-navy' : 'border-navy bg-navy text-white hover:border-gold hover:bg-gold hover:text-navy',
            )}
          >
            <HelpCircle className={cn('h-6 w-6 shrink-0', open ? 'text-navy' : 'text-gold')} strokeWidth={2.25} aria-hidden="true" />
            {t('helpButton.text', 'Help')}
          </button>
          {!open && (
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
    </>
  );
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

/* ------------------------------------------------------------ keeping clear */

/**
 * How much of the bottom of the screen is taken by something stuck there: the
 * cookie banner, or a page's own bottom bar (`fixed inset-x-0 bottom-0`, the
 * event page on phones). Measured again when the page changes, on resize and
 * when a banner finishes sliding in.
 */
function useBottomClearance(): number {
  const [clearance, setClearance] = useState(0);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const vh = window.innerHeight;
      let top = vh;
      document.querySelectorAll<HTMLElement>('[data-cookie-banner], .fixed.inset-x-0.bottom-0').forEach((el) => {
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
    schedule();
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', schedule, { passive: true });
    document.addEventListener('animationend', schedule, true);
    document.addEventListener('transitionend', schedule, true);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      mo.disconnect();
      window.removeEventListener('resize', schedule);
      document.removeEventListener('animationend', schedule, true);
      document.removeEventListener('transitionend', schedule, true);
    };
  }, []);
  return clearance;
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
      setTyping(phone.matches && field && !rootRef.current?.contains(el));
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
