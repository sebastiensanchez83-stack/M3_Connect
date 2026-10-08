import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/**
 * Cloudflare Turnstile, the anti-spam check on the public forms (newsletter,
 * contact, claim, sponsorship deck, sign-up, /wys26 request). It replaces a
 * "tick the box" puzzle: managed mode, appearance "interaction-only", so a
 * person sees nothing unless Cloudflare needs one click to be sure.
 *
 * Off by default: with no VITE_TURNSTILE_SITE_KEY (a public key, set in the
 * Netlify environment) nothing is rendered, no script is loaded and no token is
 * sent, so every form behaves exactly as before. The server side is SOFT until
 * TURNSTILE_ENFORCE=true (see supabase/functions/*): a form that sends no token
 * still goes through.
 *
 * Use:
 *   const captcha = useTurnstile();
 *   <Turnstile captcha={captcha} action="contact" />
 *   <Button disabled={sending || captcha.waiting}>…</Button>
 *   …submit({ …, captcha: captcha.token });  captcha.reset();   // a token is single-use
 *
 * `waiting` is true only while the widget is on the page and has neither
 * produced a token nor failed: a blocked script or an unsupported browser
 * never locks a form.
 */

const SITE_KEY: string = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim() || '';
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** True when a site key is configured: the widget is rendered and tokens are sent. */
export const turnstileActive = SITE_KEY.length > 0;

interface TurnstileApi {
  render: (container: HTMLElement, options: Record<string, unknown>) => string | undefined;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

// One script tag for the whole app, however many widgets there are.
let loader: Promise<TurnstileApi> | null = null;
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loader) return loader;
  loader = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile unavailable')));
    script.onerror = () => {
      // Blocked or offline: forget it, so the next reset tries again.
      loader = null;
      script.remove();
      reject(new Error('turnstile blocked'));
    };
    document.head.appendChild(script);
  });
  return loader;
}

export interface TurnstileControl {
  /** A site key is configured, so the widget is rendered and tokens are sent. */
  active: boolean;
  /** The current token, or null (none yet, expired, or already used). */
  token: string | null;
  /** The check could not run (blocked script, error, unsupported browser): never wait for it. */
  failed: boolean;
  /** The form should hold its submit button: the widget is active and still working. */
  waiting: boolean;
  /** Bumped by reset(); the widget starts again when it changes. */
  resetKey: number;
  /** Throw the token away and run the check again. Call after every submit: a token works once. */
  reset: () => void;
  setToken: (token: string | null) => void;
  setFailed: (failed: boolean) => void;
}

export function useTurnstile(): TurnstileControl {
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const reset = useCallback(() => {
    setToken(null);
    setResetKey((k) => k + 1);
  }, []);
  return useMemo(
    () => ({
      active: turnstileActive,
      token,
      failed,
      waiting: turnstileActive && !token && !failed,
      resetKey,
      reset,
      setToken,
      setFailed,
    }),
    [token, failed, resetKey, reset],
  );
}

export function Turnstile({
  captcha,
  action,
  tone = 'light',
  className,
}: {
  captcha: TurnstileControl;
  /** A short label for Cloudflare's analytics, e.g. "contact" (letters, digits, "-" and "_"). */
  action?: string;
  /** The page behind the widget: only the colour of the one line shown when the check cannot load. */
  tone?: 'light' | 'dark';
  className?: string;
}) {
  const { t } = useTranslation();
  const boxRef = useRef<HTMLDivElement>(null);
  // A challenge that needs a click is shown; otherwise the box takes no room.
  const [interactive, setInteractive] = useState(false);
  const { resetKey, setToken, setFailed } = captcha;

  useEffect(() => {
    if (!turnstileActive) return;
    let cancelled = false;
    let widgetId: string | undefined;
    setToken(null);
    setFailed(false);
    setInteractive(false);

    // Never hold a form for good: if Cloudflare has not answered within 10 s
    // (slow network, an embedded or privacy browser), stop waiting. A token that
    // arrives later is still used; until TURNSTILE_ENFORCE the server accepts
    // a form without one, and after it the visitor gets a clear error instead
    // of a button that never wakes up.
    let slowTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      if (!cancelled) setFailed(true);
    }, 10_000);
    const clearSlow = () => { if (slowTimer !== undefined) { clearTimeout(slowTimer); slowTimer = undefined; } };

    loadTurnstile()
      .then((api) => {
        const box = boxRef.current;
        if (cancelled || !box) return;
        widgetId = api.render(box, {
          sitekey: SITE_KEY,
          action: action && /^[A-Za-z0-9_-]{1,32}$/.test(action) ? action : undefined,
          theme: 'light',
          language: 'en', // the site is English-only: do not follow the browser language
          size: 'flexible',
          appearance: 'interaction-only',
          retry: 'auto',
          'refresh-expired': 'auto',
          callback: (token: string) => {
            if (cancelled) return;
            clearSlow();
            setFailed(false);
            setToken(token);
          },
          'expired-callback': () => { if (!cancelled) setToken(null); },
          'timeout-callback': () => { if (!cancelled) setToken(null); },
          'error-callback': () => {
            if (cancelled) return;
            setToken(null);
            setFailed(true);
          },
          'unsupported-callback': () => { if (!cancelled) setFailed(true); },
          // A visible challenge is the person's turn to act: no time limit then.
          'before-interactive-callback': () => { if (!cancelled) { clearSlow(); setInteractive(true); } },
          'after-interactive-callback': () => { if (!cancelled) setInteractive(false); },
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      clearSlow();
      if (widgetId !== undefined) {
        try { window.turnstile?.remove(widgetId); } catch { /* already gone */ }
      }
    };
    // A new widget per reset: tokens are single-use. action never changes for a given form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  if (!turnstileActive) return null;

  return (
    <>
      {/* In the page flow only while Cloudflare asks for a click. !mt-0: no gap in a space-y parent. */}
      <div
        ref={boxRef}
        className={cn(interactive ? 'mt-4' : '!mt-0 h-0 overflow-hidden', className)}
      />
      {captcha.failed && (
        <p role="status" className={cn('mt-3 text-[13px] leading-5', tone === 'dark' ? 'text-white/80' : 'text-meta')}>
          {t(
            'security.turnstile.unavailable',
            'The security check could not run. You can still send the form; if it fails, reload the page or turn off your content blocker.',
          )}
        </p>
      )}
    </>
  );
}
