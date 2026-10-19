import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Undo2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * "Undo" for the one-click decisions of the review queue (Validate as participant, Approve,
 * Mark as seen…): the decision is held for a few seconds before it goes to the server, so a
 * wrong click or key costs nothing. Nothing is sent and nobody is e-mailed while it waits.
 *
 * - The card leaves the list at once (`hidden`), and comes back if the call fails or on Undo.
 * - Leaving the page (another admin screen) sends what is waiting straight away; closing or
 *   reloading the tab first asks the browser's "Leave site?" question, so a decision is never
 *   lost without a word. A lost one would only leave its card in the list: nothing half-done.
 * - Decisions taken in a window (a reason, a company to choose) are sent at once instead:
 *   the window was the confirmation.
 */

export const UNDO_DELAY_MS = 6000;

interface Waiting {
  key: string;
  label: string;
  deadline: number;
}

interface Entry {
  timer: ReturnType<typeof setTimeout>;
  run: () => Promise<void>;
}

export function useDeferredActions() {
  const [waiting, setWaiting] = useState<Waiting[]>([]);
  /** Sent, answer not back yet: the card stays hidden until the list is read again. */
  const [inFlight, setInFlight] = useState<Set<string>>(() => new Set());
  const entries = useRef(new Map<string, Entry>());
  const mounted = useRef(true);

  const fire = useCallback((key: string) => {
    const e = entries.current.get(key);
    if (!e) return;
    clearTimeout(e.timer);
    entries.current.delete(key);
    if (mounted.current) {
      setWaiting(w => w.filter(x => x.key !== key));
      setInFlight(s => new Set(s).add(key));
    }
    void e.run().finally(() => {
      if (mounted.current) setInFlight(s => { const n = new Set(s); n.delete(key); return n; });
    });
  }, []);

  /** Holds `run` for a few seconds under `label` ("Validated Jane Doe as a participant"). */
  const schedule = useCallback((key: string, label: string, run: () => Promise<void>) => {
    if (entries.current.has(key)) return;
    const timer = setTimeout(() => fire(key), UNDO_DELAY_MS);
    entries.current.set(key, { timer, run });
    setWaiting(w => [...w, { key, label, deadline: Date.now() + UNDO_DELAY_MS }]);
  }, [fire]);

  /** Cancels a waiting decision. False when it already left. */
  const undo = useCallback((key: string): boolean => {
    const e = entries.current.get(key);
    if (!e) return false;
    clearTimeout(e.timer);
    entries.current.delete(key);
    setWaiting(w => w.filter(x => x.key !== key));
    return true;
  }, []);

  /** The most recent waiting decision (the U key). */
  const undoLast = useCallback((): boolean => {
    const keys = [...entries.current.keys()];
    const last = keys[keys.length - 1];
    return last ? undo(last) : false;
  }, [undo]);

  // Leaving the screen sends what waits; closing the tab asks first.
  useEffect(() => {
    mounted.current = true;
    const map = entries.current;
    return () => {
      mounted.current = false;
      for (const [key, e] of map) {
        clearTimeout(e.timer);
        map.delete(key);
        void e.run();
      }
    };
  }, []);

  useEffect(() => {
    if (!waiting.length) return;
    const onBeforeUnload = (ev: BeforeUnloadEvent) => {
      ev.preventDefault();
      // Older browsers need a value to show the question.
      ev.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [waiting.length]);

  const hidden = useCallback((key: string) => entries.current.has(key) || inFlight.has(key), [inFlight]);

  return { waiting, schedule, undo, undoLast, sendNow: fire, hidden, inFlightCount: inFlight.size };
}

/** The bar at the bottom of the screen: what is about to be sent, each with its Undo. */
export function UndoBar({ waiting, onUndo, onSendNow }: {
  waiting: Waiting[];
  onUndo: (key: string) => void;
  onSendNow: (key: string) => void;
}) {
  const { t } = useTranslation();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!waiting.length) return;
    const id = setInterval(() => tick(n => n + 1), 500);
    return () => clearInterval(id);
  }, [waiting.length]);

  return (
    <div
      aria-live="polite"
      className={cn(
        'pointer-events-none fixed inset-x-2 bottom-2 z-40 flex flex-col items-stretch gap-2',
        // Centred on wider screens: toasts use the bottom-right corner there.
        'sm:inset-x-auto sm:bottom-5 sm:left-1/2 sm:w-[420px] sm:-translate-x-1/2',
      )}
    >
      {waiting.map(w => {
        const left = Math.max(0, Math.ceil((w.deadline - Date.now()) / 1000));
        return (
          <div
            key={w.key}
            role="status"
            className="pointer-events-auto flex items-center gap-3 rounded-card border border-navy/20 bg-navy px-4 py-3 text-white shadow-drawer"
          >
            <p className="min-w-0 flex-1 text-[14px] leading-5 [overflow-wrap:anywhere]">
              {w.label}
              <span className="block text-[12px] leading-4 text-white/70">
                {t('adminReview.v2.undo.sendsIn', { count: left, defaultValue_one: 'Sent in {{count}} second', defaultValue_other: 'Sent in {{count}} seconds' })}
                {' · '}
                <button type="button" onClick={() => onSendNow(w.key)} className="underline decoration-white/40 underline-offset-2 hover:decoration-white focus:outline-none focus-visible:shadow-focus">
                  {t('adminReview.v2.undo.sendNow', 'Send now')}
                </button>
              </span>
            </p>
            <button
              type="button"
              onClick={() => onUndo(w.key)}
              className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-pill bg-gold px-4 text-[14px] font-semibold text-navy transition-colors hover:bg-gold-hover focus:outline-none focus-visible:shadow-focus"
            >
              <Undo2 className="h-4 w-4" aria-hidden="true" />
              {t('adminReview.v2.undo.button', 'Undo')}
            </button>
          </div>
        );
      })}
    </div>
  );
}
