import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { BTN_OUTLINE } from '@/components/member/MemberUI';
import { cn } from '@/lib/utils';

/**
 * "One thing at a time" (Victor, 9 Oct 2026): inside a panel the information
 * reads as simple rows (a label, what is stored, a "Change" button), and
 * "Change" opens a small window with only that field, then Save or Cancel.
 * The window says what went wrong in place; the row says "Saved" for a moment.
 *
 *   InfoList / InfoRow   the rows
 *   NotFilled            "Not filled in yet", in muted text
 *   EditDialog           the small window: a real title, one primary button
 *   ConfirmDialog        "Remove Alex from the team?" before anything that cannot be undone
 *   useSavedFlash        which row says "Saved" right now
 */

/** Buttons of the member area at the 44 px touch-target size. */
export const BTN_TOUCH = cn(BTN_OUTLINE, 'h-11 min-w-[7.5rem] px-5 text-[15px] md:h-11');

export function NotFilled({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  return <span className="font-normal text-meta">{children ?? t('dash.notFilled', 'Not filled in yet')}</span>;
}

export function InfoList({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <ul aria-label={label} className={cn('divide-y divide-rule overflow-hidden rounded-card border border-rule bg-white', className)}>
      {children}
    </ul>
  );
}

/**
 * One row: the label, the value (or "Not filled in yet"), and its action.
 * `actionLabel` is the visible word ("Change", "Manage photos"); the button is
 * read out with the row's label ("Change first name").
 */
export function InfoRow({
  id,
  label,
  value,
  hint,
  actionLabel,
  onAction,
  action,
  saved = false,
  highlight = false,
}: {
  id?: string;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  /** Anything else on the right (a switch, a link), instead of the button. */
  action?: ReactNode;
  saved?: boolean;
  /** The row an address pointed at (/?open=company&section=gallery): tinted for a moment. */
  highlight?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <li
      id={id}
      className={cn(
        'flex flex-col gap-3 px-4 py-4 transition-colors duration-700 sm:flex-row sm:items-center sm:gap-6 sm:px-5',
        highlight ? 'bg-foam' : 'bg-white',
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium leading-5 text-meta">{label}</p>
        <div className="mt-1 text-[16px] font-semibold leading-6 text-navy [overflow-wrap:anywhere]">{value}</div>
        {hint && <div className="mt-1 text-[14px] leading-5 text-meta">{hint}</div>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <span role="status" className="inline-flex">
          {saved && (
            <span className="inline-flex items-center gap-1 rounded-pill bg-emerald-50 px-2.5 py-1 text-[13px] font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200">
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              {t('dash.saved', 'Saved')}
            </span>
          )}
        </span>
        {action ?? (onAction && actionLabel ? (
          <Button
            type="button"
            variant="outline"
            onClick={onAction}
            aria-label={`${actionLabel}: ${label}`}
            className={cn(BTN_TOUCH, 'w-full sm:w-auto')}
          >
            {actionLabel}
          </Button>
        ) : null)}
      </div>
    </li>
  );
}

/** Which row says "Saved" (for 3 s after its window closed). */
export function useSavedFlash(): [string | null, (key: string) => void] {
  const [key, setKey] = useState<string | null>(null);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const flash = (k: string) => {
    setKey(k);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setKey(null), 3000);
  };
  return [key, flash];
}

/**
 * Where the focus goes back when a window closes. Radix only returns it to a
 * DialogTrigger, and these windows open from plain buttons (a row's
 * "Change", a to-do): the element focused when the window opened is kept
 * (read during the render that opens it, before the window takes the focus)
 * and focused again on close, when it is still on the page.
 */
function useReturnFocus(open: boolean, onCloseAutoFocus?: (e: Event) => void) {
  const returnTo = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current && typeof document !== 'undefined') {
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  wasOpen.current = open;
  return (e: Event) => {
    onCloseAutoFocus?.(e);
    if (e.defaultPrevented) return;
    const el = returnTo.current;
    if (el && el !== document.body && document.contains(el)) {
      e.preventDefault();
      el.focus();
    }
  };
}

/** The window's frame: rounded, a gutter on phones, scrolls inside when long, a 44 px close button. */
export const DIALOG_CLASS = cn(
  'w-[calc(100vw-2rem)] max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-card p-5 sm:p-6',
  '[&>button:last-child]:right-2 [&>button:last-child]:top-2 [&>button:last-child]:grid [&>button:last-child]:h-11',
  '[&>button:last-child]:w-11 [&>button:last-child]:place-items-center [&>button:last-child]:rounded-full',
  '[&>button:last-child]:hover:bg-chip',
);

/**
 * The small window of one change: a real title, an optional line, the field,
 * then Cancel and ONE primary button (Save by default). Enter saves; Esc and
 * Cancel close without saving. `error` shows in the window, next to the field.
 * Without `onSave` it is an information window with a single "Done".
 */
export function EditDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  onSave,
  saveLabel,
  saving = false,
  canSave = true,
  error,
  wide = false,
  quietClose = false,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  onSave?: () => void | Promise<void>;
  saveLabel?: string;
  saving?: boolean;
  canSave?: boolean;
  error?: string | null;
  /** Lists (photos, requests): a wider window. */
  wide?: boolean;
  /** Without onSave: the closing button is a plain outline one ("I will answer later"), not the gold one. */
  quietClose?: boolean;
  onCloseAutoFocus?: (e: Event) => void;
}) {
  const { t } = useTranslation();
  const descId = useId();
  const returnFocus = useReturnFocus(open, onCloseAutoFocus);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (onSave && canSave && !saving) void onSave();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent className={cn(DIALOG_CLASS, wide && 'max-w-xl')} onCloseAutoFocus={returnFocus} aria-describedby={description ? descId : undefined}>
        <DialogHeader className="pr-8 text-left">
          <DialogTitle className="text-[20px] leading-7 text-navy">{title}</DialogTitle>
          {description && <DialogDescription id={descId} className="text-[15px] leading-6 text-meta">{description}</DialogDescription>}
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5" noValidate>
          {children}
          {error && (
            <p role="alert" className="rounded-field border border-red-200 bg-red-50 px-3 py-2.5 text-[15px] leading-6 text-red-900">
              {error}
            </p>
          )}
          <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:items-center sm:justify-end">
            {onSave ? (
              <>
                <Button type="button" variant="outline" className={BTN_TOUCH} onClick={() => onOpenChange(false)} disabled={saving}>
                  {t('common.cancel', 'Cancel')}
                </Button>
                <Button type="submit" variant="cta" size="sm" arrow={false} roll={!saving} disabled={!canSave || saving} className="min-w-[7.5rem] justify-center">
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                  {saving ? t('dash.saving', 'Saving…') : saveLabel ?? t('common.save', 'Save')}
                </Button>
              </>
            ) : quietClose ? (
              <Button type="button" variant="outline" className={BTN_TOUCH} onClick={() => onOpenChange(false)}>
                {saveLabel ?? t('dash.done', 'Done')}
              </Button>
            ) : (
              <Button type="button" variant="cta" size="sm" arrow={false} className="min-w-[7.5rem] justify-center" onClick={() => onOpenChange(false)}>
                {saveLabel ?? t('dash.done', 'Done')}
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Are you sure?" before an action that cannot be undone. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const descId = useId();
  const returnFocus = useReturnFocus(open);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className={DIALOG_CLASS} onCloseAutoFocus={returnFocus} aria-describedby={body ? descId : undefined}>
        <DialogHeader className="pr-8 text-left">
          <DialogTitle className="text-[20px] leading-7 text-navy">{title}</DialogTitle>
          {body && <DialogDescription id={descId} className="text-[15px] leading-6 text-meta">{body}</DialogDescription>}
        </DialogHeader>
        <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" className={BTN_TOUCH} onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            type="button"
            disabled={busy}
            className="h-11 min-w-[7.5rem] rounded-pill bg-red-700 md:h-11 px-5 text-[15px] font-semibold text-white hover:bg-red-800"
            onClick={async () => {
              setBusy(true);
              try { await onConfirm(); } finally { setBusy(false); }
            }}
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** An error in plain words, whatever was thrown. */
export function errorText(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'object' && err && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return fallback;
}
