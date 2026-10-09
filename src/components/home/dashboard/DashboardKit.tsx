import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, CheckCircle2, ChevronDown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BTN_OUTLINE, ROW_FOCUS } from '@/components/member/MemberUI';
import { useMotion } from '@/components/motion/MotionProvider';
import { scrollTopUnderBars } from '@/lib/scrollTarget';
import { cn } from '@/lib/utils';

/**
 * The pieces of the home dashboard (Victor's feedback, 9 Oct 2026: "it must be
 * really simple"): a few big tiles, each ONE button with an icon, a title and
 * one plain line saying where things stand; the panel a tile opens in place,
 * right under its row; the compact rows and links used inside.
 *
 * No entrance animation anywhere: the dashboard is the reason a member comes
 * back, it shows at once and fully opaque. Only a panel that opens expands
 * (.5 s, the grid-rows trick); its region clips while it grows and stops
 * clipping as soon as it is open, because the full company editor inside has a
 * sticky section bar and a clipping ancestor would stop it sticking.
 */

export function panelDomId(key: string) {
  return `home-panel-${key}`;
}

/** How a tile's line reads: something waits for an answer, something is missing, all is well, or plain. */
export type TileTone = 'action' | 'missing' | 'done' | 'plain';

/**
 * One tile: a big button (or a link, for a tile that leads to its own page)
 * with an icon, a title, an optional count and one line of status. It says
 * whether its panel is open (aria-expanded) and, while it is, which region it
 * controls (the region only exists then).
 */
export const Tile = forwardRef<HTMLButtonElement, {
  panelKey: string;
  icon: LucideIcon;
  title: string;
  /** A number after the title ("My team 4"), read out with its meaning. */
  count?: { value: number; label: string } | null;
  status: ReactNode;
  tone?: TileTone;
  open?: boolean;
  /** A tile that leads to another page instead of opening a panel. */
  to?: string;
  onClick?: () => void;
}>(function Tile({ panelKey, icon: Icon, title, count, status, tone = 'plain', open = false, to, onClick }, ref) {
  const inner = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          'grid h-12 w-12 shrink-0 place-items-center rounded-field transition-colors duration-300',
          open ? 'bg-navy text-white' : tone === 'action' ? 'bg-gold/25 text-navy' : 'bg-chip text-navy',
        )}
      >
        <Icon className="h-6 w-6" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-[18px] font-semibold leading-6 text-navy [overflow-wrap:anywhere]">
            <span className="card-ul">{title}</span>
          </span>
          {count && count.value > 0 && (
            <span className="grid h-6 min-w-6 shrink-0 place-items-center rounded-pill bg-navy px-2 text-[13px] font-semibold leading-none tabular-nums text-white">
              <span aria-hidden="true">{count.value}</span>
              <span className="sr-only">{count.label}</span>
            </span>
          )}
        </span>
        <span
          className={cn(
            'mt-1 flex items-start gap-1.5 text-[15px] leading-[22px]',
            tone === 'action' ? 'font-semibold text-navy' : tone === 'missing' ? 'text-amber-900' : 'text-meta',
          )}
        >
          {tone === 'done' && <CheckCircle2 className="mt-[3px] h-4 w-4 shrink-0 text-teal" aria-hidden="true" />}
          {tone === 'missing' && <span aria-hidden="true" className="mt-[7px] h-2 w-2 shrink-0 rounded-full bg-amber-500" />}
          {tone === 'action' && <span aria-hidden="true" className="mt-[7px] h-2 w-2 shrink-0 rounded-full bg-gold" />}
          <span className="min-w-0">{status}</span>
        </span>
      </span>
      {to ? (
        <ArrowRight className="card-arrow !ml-0 mt-1 shrink-0" strokeWidth={2.25} aria-hidden="true" />
      ) : (
        <ChevronDown
          aria-hidden="true"
          className={cn('mt-1 h-5 w-5 shrink-0 text-meta transition-transform duration-300 motion-reduce:transition-none', open && 'rotate-180 text-navy')}
        />
      )}
    </>
  );
  const cls = cn(
    'group flex min-h-[112px] w-full items-start gap-4 rounded-card border bg-white p-5 text-left transition-[box-shadow,border-color] duration-300',
    'hover:border-navy/40 hover:shadow-hover focus:outline-none focus-visible:shadow-focus',
    open ? 'border-navy shadow-[inset_0_0_0_1px_rgb(11_38_83)]' : 'border-rule',
  );
  if (to) return <Link to={to} className={cls}>{inner}</Link>;
  return (
    <button
      ref={ref}
      type="button"
      aria-expanded={open}
      aria-controls={open ? panelDomId(panelKey) : undefined}
      onClick={onClick}
      className={cls}
    >
      {inner}
    </button>
  );
});

/** A count on a list or a header: navy pill, read out with its meaning. */
export function CountBadge({ value, label }: { value: number; label: string }) {
  if (value <= 0) return null;
  return (
    <span className="grid h-6 min-w-6 shrink-0 place-items-center rounded-pill bg-navy px-2 text-[12px] font-semibold leading-none tabular-nums text-white">
      <span aria-hidden="true">{value}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** A compact row inside a list: a link, or a button that opens something in place. */
export function MiniRow({
  icon: Icon,
  title,
  meta,
  aside,
  to,
  onClick,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  meta?: ReactNode;
  aside?: ReactNode;
  to?: string;
  onClick?: () => void;
}) {
  const inner = (
    <>
      {Icon && (
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-field bg-chip text-navy">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold leading-5 text-navy"><span className="card-ul">{title}</span></span>
        {meta && <span className="block truncate text-[12px] leading-4 text-meta">{meta}</span>}
      </span>
      {aside}
    </>
  );
  const cls = cn('group -mx-2 flex min-h-11 w-[calc(100%+1rem)] items-center gap-3 rounded-field px-2 py-1.5 text-left transition-colors hover:bg-page', ROW_FOCUS);
  if (to) return <li><Link to={to} className={cls}>{inner}</Link></li>;
  if (onClick) return <li><button type="button" onClick={onClick} className={cls}>{inner}</button></li>;
  return <li className="-mx-2 flex min-h-11 items-center gap-3 px-2 py-1.5">{inner}</li>;
}

/** A link at the bottom of a block (gold line on hover, small arrow), 44 px tall to tap. */
export function CardLink({ to, children, external = false }: { to: string; children: ReactNode; external?: boolean }) {
  const cls = 'uline min-h-11 !text-[15px] !leading-5';
  const inner = (
    <>
      <span className="uline-t">{children}</span>
      <ArrowRight className="uline-a" strokeWidth={2.25} aria-hidden="true" />
    </>
  );
  return external
    ? <a href={to} className={cls}>{inner}</a>
    : <Link to={to} className={cls}>{inner}</Link>;
}

/**
 * The panel of a tile, open in place under the tile's row: a header (the
 * tile's name, what it is for, a close button) over its content. It expands
 * smoothly, comes into view under the sticky header and takes the focus (its
 * title); `onClose` hands the focus back to the tile.
 *
 * `layoutReady`: the dashboard above it has its final height. A panel opened
 * from the address on page load waits for it before scrolling, or it would
 * land where the tiles' skeletons used to be.
 */
export function PanelRegion({
  panelKey,
  title,
  desc,
  actions,
  layoutReady,
  onClose,
  className,
  children,
}: {
  panelKey: string;
  title: string;
  desc?: string;
  actions?: ReactNode;
  layoutReady: boolean;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { reduced } = useMotion();
  const ref = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [expanded, setExpanded] = useState(reduced);
  const [settled, setSettled] = useState(reduced);
  const scrolled = useRef(false);
  const titleId = `${panelDomId(panelKey)}-title`;

  // Expand on the frame after mount; stop clipping once open (the transition's end, or a timer if it never fires).
  useEffect(() => {
    if (reduced) {
      setExpanded(true);
      setSettled(true);
      return;
    }
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setExpanded(true));
    });
    const timer = window.setTimeout(() => setSettled(true), 650);
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
      window.clearTimeout(timer);
    };
  }, [reduced]);

  // Into view under the header, once, as soon as the layout above is final.
  useEffect(() => {
    if (!layoutReady || scrolled.current) return;
    const el = ref.current;
    if (!el) return;
    scrolled.current = true;
    window.scrollTo({ top: scrollTopUnderBars(el, 0, 16), behavior: reduced ? 'auto' : 'smooth' });
    headingRef.current?.focus({ preventScroll: true });
  }, [layoutReady, reduced]);

  return (
    <section
      ref={ref}
      id={panelDomId(panelKey)}
      aria-labelledby={titleId}
      className={cn(
        'grid transition-[grid-template-rows,opacity] duration-500 ease-out-smc motion-reduce:transition-none',
        expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        className,
      )}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && e.propertyName === 'grid-template-rows') setSettled(true);
      }}
    >
      <div className={cn('min-h-0', !settled && 'overflow-hidden')}>
        <div className="rounded-[20px] border border-rule bg-chip/60 p-4 sm:p-6">
          <header className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h3 ref={headingRef} id={titleId} tabIndex={-1} className="text-h2-sm text-navy focus:outline-none [overflow-wrap:anywhere]">
                {title}
              </h3>
              {desc && <p className="mt-1 max-w-2xl text-[16px] leading-6 text-meta">{desc}</p>}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2">
              {actions}
              <Button type="button" variant="outline" size="sm" onClick={onClose} className={cn(BTN_OUTLINE, 'h-11 gap-1.5')}>
                <X className="h-4 w-4" aria-hidden="true" />
                {t('memberHome.close', 'Close')}
                <span className="sr-only"> {title}</span>
              </Button>
            </div>
          </header>
          {children}
        </div>
      </div>
    </section>
  );
}
