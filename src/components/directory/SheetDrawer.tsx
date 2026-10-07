import { useLayoutEffect, useRef, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The v2 drawer of the directory (Filters, the visitor's shortlist), on the
 * Radix dialog: focus is trapped, Esc and the veil close it, and focus goes back
 * to the button that opened it.
 *
 *  - A floating white panel, 12 px from the edges, 16 px radius, 432 px wide
 *    (400 px with width="sm"); it slides in from the right in .6 s with
 *    cubic-bezier(.38,.005,.215,1) over a veil that blurs the page (6 px) and
 *    fades in over the same time. Below 640 px it is a sheet rising from the
 *    bottom, a handle at its top, the same durations.
 *  - Header with the title, an optional action (e.g. "Clear all") and a round
 *    close button that fills navy while its cross turns a quarter; a scrolling
 *    body; an optional sticky footer.
 *  - Children marked `drawer-group` (with --i: 0, 1, 2…) rise one after the
 *    other once it has opened (.5 s, 45 ms apart, after 180 ms).
 *  - Reduced motion: no slide, no fade (the CSS is in src/styles/directory.css).
 *
 *   <SheetDrawer open={open} onOpenChange={setOpen} title="Filters" footer={…}>…</SheetDrawer>
 */
export function SheetDrawer({
  open,
  onOpenChange,
  title,
  description,
  headerAction,
  footer,
  closeLabel,
  width = 'md',
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** Visually hidden description for screen readers (Radix aria-describedby). */
  description?: string;
  /** Next to the title, e.g. a "Clear all" link. */
  headerAction?: ReactNode;
  /** Sticky bottom bar, e.g. the "Done · 42 organizations" button. */
  footer?: ReactNode;
  closeLabel?: string;
  /** md 432 px, sm 400 px. */
  width?: 'sm' | 'md';
  children: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  // The drawer is opened from page state, not a Dialog.Trigger, and Radix only
  // knows how to give focus back to its own trigger: remember what had focus
  // when it opened (before Radix moves it inside) and return there.
  const returnTo = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open) returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [open]);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dir-sheet-veil fixed inset-0 z-[60] bg-navy-deep/[.45] backdrop-blur-[6px]" />
        <DialogPrimitive.Content
          // Without a description Radix wants an explicit "none".
          {...(description ? {} : { 'aria-describedby': undefined })}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const el = returnTo.current;
            // Another dialog opened from inside (e.g. "Sign in") keeps the focus.
            if (document.querySelector('[role="dialog"][data-state="open"]')) return;
            if (el && el.isConnected) el.focus({ preventScroll: true });
          }}
          className={cn(
            'dir-sheet fixed z-[61] flex flex-col overflow-hidden bg-white text-ink shadow-drawer outline-none',
            // Phones: a sheet rising from the bottom. From sm: a floating panel on the right.
            'inset-x-0 bottom-0 top-3 rounded-t-[16px]',
            'sm:inset-x-auto sm:bottom-3 sm:right-3 sm:top-3 sm:max-w-[calc(100%-24px)] sm:rounded-[16px]',
            width === 'sm' ? 'sm:w-[416px]' : 'sm:w-[432px]',
            className,
          )}
        >
          <span aria-hidden="true" className="absolute left-1/2 top-[7px] z-[2] -ml-5 h-1 w-10 rounded-pill bg-[#c3cad6] sm:hidden" />
          <div className="flex h-16 shrink-0 items-center gap-2 border-b border-rule bg-white pl-5 pr-3">
            <DialogPrimitive.Title className="text-[20px] font-bold leading-7 text-navy">{title}</DialogPrimitive.Title>
            {description && <DialogPrimitive.Description className="sr-only">{description}</DialogPrimitive.Description>}
            <div className="ml-auto flex items-center gap-1">
              {headerAction}
              <DialogPrimitive.Close
                aria-label={closeLabel ?? t('brand.drawer.close', 'Close')}
                className="dir-sheet-close text-navy focus-visible:shadow-focus focus-visible:outline-none"
              >
                <X className="h-[22px] w-[22px]" aria-hidden="true" />
              </DialogPrimitive.Close>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5">{children}</div>
          {footer && (
            <div className="shrink-0 border-t border-rule bg-white px-5 py-4 pb-[max(16px,env(safe-area-inset-bottom))]">{footer}</div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
