import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, ChevronDown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CardShell } from '@/components/brand/CardShell';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { BTN_OUTLINE, ROW_FOCUS } from '@/components/member/MemberUI';
import { useMotion } from '@/components/motion/MotionProvider';
import { scrollTopUnderBars } from '@/lib/scrollTarget';
import { cn } from '@/lib/utils';

/**
 * The pieces of the home dashboard: a block's summary card, the button that
 * opens its editor in place, the full-width region that editor opens in, and
 * the compact rows the cards list things with.
 *
 * No entrance animation anywhere: the dashboard is the reason a member comes
 * back, it shows at once and fully opaque. Only an editor that opens expands
 * (.5 s, the grid-rows trick); its region clips while it grows and stops
 * clipping as soon as it is open, because the organisation editor's section bar
 * is sticky and a clipping ancestor would stop it sticking.
 */

function panelDomId(key: string) {
  return `home-panel-${key}`;
}

/** One block's summary: icon tile, title, one line, what it holds, its actions. */
export function DashCard({
  icon: Icon,
  title,
  titleId,
  desc,
  badge,
  active = false,
  footer,
  className,
  children,
}: {
  icon: LucideIcon;
  title: string;
  titleId: string;
  desc?: string;
  /** A small count or state on the right of the title. */
  badge?: ReactNode;
  /** Its editor is open below the row. */
  active?: boolean;
  footer?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <CardShell
      as="article"
      className={cn('h-full transition-shadow duration-300', active && 'shadow-[inset_0_0_0_2px_rgb(11_38_83)]', className)}
    >
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start gap-3">
          <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-field', active ? 'bg-navy text-white' : 'bg-chip text-navy')}>
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h4 id={titleId} className="text-card-title text-navy [overflow-wrap:anywhere]">{title}</h4>
            {desc && <p className="mt-0.5 text-[13px] leading-[18px] text-meta">{desc}</p>}
          </div>
          {badge}
        </div>
        {children && <div className="mt-4 flex-1 text-[14px] leading-5 text-ink">{children}</div>}
        {footer && <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-rule pt-4">{footer}</div>}
      </div>
    </CardShell>
  );
}

/** The button that opens (or closes) a block's editor in place: aria-expanded, aria-controls. */
export const PanelToggle = forwardRef<HTMLButtonElement, {
  panelKey: string;
  open: boolean;
  label: string;
  /** Names the block for screen readers ("Edit — My profile"). */
  context: string;
  onToggle: () => void;
}>(function PanelToggle({ panelKey, open, label, context, onToggle }, ref) {
  const { t } = useTranslation();
  return (
    <Button
      ref={ref}
      type="button"
      variant="outline"
      size="sm"
      aria-expanded={open}
      aria-controls={panelDomId(panelKey)}
      aria-label={`${open ? t('memberHome.close', 'Close') : label} — ${context}`}
      onClick={onToggle}
      className={cn(BTN_OUTLINE, 'gap-1.5', open && 'border-navy bg-navy text-white hover:bg-navy/90 hover:text-white')}
    >
      {open ? t('memberHome.close', 'Close') : label}
      <ChevronDown className={cn('h-4 w-4 transition-transform duration-300', open && 'rotate-180')} aria-hidden="true" />
    </Button>
  );
});

/** A count on a card: navy pill, read out with its meaning. */
export function CountBadge({ value, label }: { value: number; label: string }) {
  if (value <= 0) return null;
  return (
    <span className="grid h-6 min-w-6 shrink-0 place-items-center rounded-pill bg-navy px-2 text-[12px] font-semibold leading-none tabular-nums text-white">
      <span aria-hidden="true">{value}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** A compact row inside a card: a link, or a button that opens something in place. */
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

/** A link at the bottom of a card (gold line on hover, small arrow). */
export function CardLink({ to, children, external = false }: { to: string; children: ReactNode; external?: boolean }) {
  const cls = 'uline !text-[14px] !leading-5';
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

/** A group of blocks: a caps title, the cards, and the editor of one of them when it is open. */
export function DashGroup({
  id,
  title,
  cardCount,
  children,
  panel,
}: {
  id: string;
  title: string;
  cardCount: number;
  children: ReactNode;
  panel?: ReactNode;
}) {
  const cols = cardCount >= 4 ? 'sm:grid-cols-2 xl:grid-cols-4' : cardCount === 3 ? 'sm:grid-cols-2 xl:grid-cols-3' : 'sm:grid-cols-2';
  return (
    <section aria-labelledby={`${id}-title`} className="scroll-mt-24">
      <Eyebrow as="h3" className="mb-4">
        <span id={`${id}-title`}>{title}</span>
      </Eyebrow>
      <div className={cn('grid grid-cols-1 gap-4', cols)}>{children}</div>
      {panel}
    </section>
  );
}

/**
 * The editor of a block, open in place under its group's cards: a header (the
 * block's name, what it is for, a close button) over the real editor. It
 * expands smoothly, comes into view under the sticky header and takes the
 * focus (its title); `onClose` hands the focus back to the card.
 *
 * `layoutReady`: the dashboard above it has its final height. A block opened
 * from the address on page load waits for it before scrolling, or it would
 * land where the cards' skeletons used to be.
 */
export function PanelRegion({
  panelKey,
  eyebrow,
  title,
  desc,
  actions,
  layoutReady,
  onClose,
  children,
}: {
  panelKey: string;
  eyebrow: string;
  title: string;
  desc?: string;
  actions?: ReactNode;
  layoutReady: boolean;
  onClose: () => void;
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
        'grid transition-[grid-template-rows,opacity,margin] duration-500 ease-out-smc motion-reduce:transition-none',
        expanded ? 'mt-5 grid-rows-[1fr] opacity-100' : 'mt-0 grid-rows-[0fr] opacity-0',
      )}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && e.propertyName === 'grid-template-rows') setSettled(true);
      }}
    >
      <div className={cn('min-h-0', !settled && 'overflow-hidden')}>
        <div className="rounded-[20px] border border-rule bg-chip/60 p-4 sm:p-6">
          <header className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <Eyebrow>{eyebrow}</Eyebrow>
              <h3 ref={headingRef} id={titleId} tabIndex={-1} className="mt-2 text-h2-sm text-navy focus:outline-none [overflow-wrap:anywhere]">
                {title}
              </h3>
              {desc && <p className="mt-1 max-w-2xl text-[15px] leading-6 text-meta">{desc}</p>}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {actions}
              <Button type="button" variant="outline" size="sm" onClick={onClose} className={cn(BTN_OUTLINE, 'gap-1.5')}>
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
