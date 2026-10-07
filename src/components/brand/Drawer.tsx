import { useLayoutEffect, useRef, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { WaveEdge } from '@/components/motion/WaveEdge';
import '@/styles/smc-drawer.css';

/**
 * One drawer for the secondary things (filters, the visitor's shortlist…), on
 * the Radix dialog: focus is trapped, Esc and the veil close it, and focus
 * returns to the button that opened it.
 *
 *  - From 640 px: a panel docked flush to the right edge of the screen, full
 *    height, whose leading edge is a waterline (a vertical wave), sliding in
 *    (0.3 s). Below: a bottom sheet whose top edge is the same waterline.
 *    The veil is a plain navy tint (no blur).
 *  - Header with the title, an optional action (e.g. "Clear all") and a round
 *    close button; a scrolling body; an optional sticky footer.
 *  - Children marked `drawer-group` (with --i: 0, 1, 2…) fade up one after the
 *    other once it has opened (src/styles/smc-drawer.css).
 *  - Reduced motion: no slide, no fade.
 *
 *   <Drawer open={open} onOpenChange={setOpen} title="Filters" footer={…}>…</Drawer>
 */
export function Drawer({
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
  /** Sticky bottom bar, e.g. the "Show 42 organizations" button. */
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
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-[60] bg-navy-deep/40 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:!animate-none"
        />
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
            // The shadow follows the waterline edge (a box-shadow would draw a straight one).
            'smc-drawer fixed z-[61] flex flex-col bg-white text-ink outline-none duration-300 [filter:drop-shadow(0_0_28px_rgba(11,38,83,.24))]',
            // Phones: bottom sheet under a waterline. From sm: docked flush to the right edge.
            'inset-x-0 bottom-0 top-6',
            'sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:max-w-[calc(100%-32px)]',
            width === 'sm' ? 'sm:w-[400px]' : 'sm:w-[432px]',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
            'max-sm:data-[state=open]:slide-in-from-bottom max-sm:data-[state=closed]:slide-out-to-bottom',
            'sm:data-[state=open]:slide-in-from-right sm:data-[state=closed]:slide-out-to-right',
            'motion-reduce:!animate-none',
            className,
          )}
        >
          {/* The leading edge: a waterline across the top of the sheet, down the side of the panel. */}
          <WaveEdge color="#ffffff" animated={false} className="absolute inset-x-0 -top-3 h-3.5 sm:hidden" />
          <svg aria-hidden="true" viewBox="0 0 14 120" preserveAspectRatio="none" className="pointer-events-none absolute -left-3 top-0 hidden h-full w-3.5 sm:block">
            <path d="M14 0H7Q1 7.5 7 15T7 30T7 45T7 60T7 75T7 90T7 105T7 120H14Z" fill="#ffffff" />
          </svg>
          <span aria-hidden="true" className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-pill bg-rule sm:hidden" />
          <div className="flex h-16 shrink-0 items-center gap-2 border-b border-rule pl-5 pr-3">
            <DialogPrimitive.Title className="text-h3 text-navy">{title}</DialogPrimitive.Title>
            {description && <DialogPrimitive.Description className="sr-only">{description}</DialogPrimitive.Description>}
            <div className="ml-auto flex items-center gap-1">
              {headerAction}
              <DialogPrimitive.Close
                aria-label={closeLabel ?? t('brand.drawer.close', 'Close')}
                className="group grid h-11 w-11 place-items-center rounded-pill text-navy transition-colors hover:bg-chip focus-visible:shadow-focus focus-visible:outline-none"
              >
                <X className="h-5 w-5 transition-transform duration-500 ease-swing group-hover:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
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
