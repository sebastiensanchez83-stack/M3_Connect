import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import { ArrowDown, ArrowRight, CheckCircle2, ChevronDown, ChevronUp, X } from 'lucide-react';
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
 * "This is clickable" has ONE look on the whole dashboard (Victor, 21 Oct 2026:
 * many members are not at ease with technology, they must see what can be
 * pressed and where it leads): a pill with a few plain words and an icon, the
 * ActionCue below. An arrow → goes somewhere (another page, a small window, a
 * panel further down); a chevron ⌄ opens the details right here, and the pill
 * turns into "Close" ⌃ while they are open. It shows at rest, never only on
 * hover (phones have no hover); the whole card or row around it is the button,
 * so the target is large. Statuses that cannot be pressed are plain words with
 * an icon, never a pill.
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

/** Where an ActionCue leads: somewhere (arrow), further down the page, or details opening / closing here (chevron). */
export type CueIcon = 'arrow' | 'down' | 'expand' | 'collapse';

/**
 * The dashboard's one sign that something can be pressed: a pill with a few
 * words and an icon. A plain span inside the card or row that is the actual
 * button or link (its words are part of that control's name, as seen), it
 * reacts to that parent's hover and press (`group`). On white: a navy outline
 * (3.5:1, so the shape itself is seen), like the panels' "Change" buttons. On
 * navy (`dark`): the accent with navy words (7.8:1).
 */
export function ActionCue({
  children,
  icon = 'arrow',
  tone = 'light',
  size = 'md',
  className,
}: {
  children: ReactNode;
  icon?: CueIcon;
  tone?: 'light' | 'dark';
  size?: 'md' | 'sm';
  className?: string;
}) {
  const Icon = icon === 'expand' ? ChevronDown : icon === 'collapse' ? ChevronUp : icon === 'down' ? ArrowDown : ArrowRight;
  return (
    <span
      className={cn(
        'inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-pill font-semibold transition-colors duration-200 motion-reduce:transition-none',
        size === 'md' ? 'min-h-10 px-4 py-1.5 text-[15px] leading-5' : 'min-h-8 px-3 py-1 text-[14px] leading-5',
        tone === 'dark'
          ? 'bg-gold text-navy group-hover:bg-white group-active:bg-white/85'
          // navy/55: the outline reaches 3.5:1 on white (WCAG asks 3:1 for a control's edge).
          : 'border border-navy/55 bg-white text-navy group-hover:border-navy group-hover:bg-chip group-active:bg-chip',
        className,
      )}
    >
      <span className="min-w-0">{children}</span>
      <Icon
        aria-hidden="true"
        className={cn(
          'shrink-0 transition-transform duration-200 motion-reduce:transition-none',
          size === 'md' ? 'h-[18px] w-[18px]' : 'h-4 w-4',
          icon === 'arrow' && 'group-hover:translate-x-0.5',
          icon === 'down' && 'group-hover:translate-y-0.5',
        )}
        strokeWidth={2.25}
      />
    </span>
  );
}

/**
 * A tile's icon square, by meaning (never at random): navy with the accent for
 * who you are (profile, company, team), teal with white for what you take part
 * in (events, saved companies, references, press), the accent with navy for
 * conversations and business (messages, requests, deal flow, sponsorship).
 */
export type IconTone = 'navy' | 'teal' | 'accent';
const ICON_SQUARE: Record<IconTone, string> = {
  navy: 'bg-navy text-gold',
  teal: 'bg-teal text-white',
  accent: 'bg-gold text-navy',
};

/** How a tile's line reads: something waits for an answer, something is missing, all is well, or plain. */
export type TileTone = 'action' | 'missing' | 'done' | 'plain';

/**
 * One tile: a big button (or a link, for a tile that leads to its own page)
 * with its icon square, a title, an optional count, one line of status and, at
 * the bottom, what pressing it does ("Edit my profile ⌄", "Close ⌃", "See the
 * projects →"). It says whether its panel is open (aria-expanded) and, while
 * it is, which region it controls (the region only exists then).
 */
export const Tile = forwardRef<HTMLButtonElement, {
  panelKey: string;
  icon: LucideIcon;
  iconTone?: IconTone;
  title: string;
  /** A number after the title ("My team 4"), read out with its meaning. */
  count?: { value: number; label: string } | null;
  status: ReactNode;
  tone?: TileTone;
  /** What pressing it does, in a few plain words ("Edit my profile"). */
  action: string;
  open?: boolean;
  /** A tile that leads to another page instead of opening a panel. */
  to?: string;
  onClick?: () => void;
}>(function Tile({ panelKey, icon: Icon, iconTone = 'navy', title, count, status, tone = 'plain', action, open = false, to, onClick }, ref) {
  const { t } = useTranslation();
  const inner = (
    <>
      <span className="flex w-full items-start gap-4">
        <span aria-hidden="true" className={cn('grid h-12 w-12 shrink-0 place-items-center rounded-[14px]', ICON_SQUARE[iconTone])}>
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
            {tone === 'action' && <span aria-hidden="true" className="mt-[7px] h-2 w-2 shrink-0 rounded-full bg-gold-text" />}
            <span className="min-w-0">{status}</span>
          </span>
        </span>
      </span>
      {/* What pressing it does: always shown, the same pill as everywhere on the dashboard. */}
      <span className="mt-auto flex w-full pt-4">
        <ActionCue icon={to ? 'arrow' : open ? 'collapse' : 'expand'}>
          {open ? t('memberHome.close', 'Close') : action}
          {!to && <span className="sr-only"> {open ? t('dash.cue.closesSr', '(hides the details)') : t('dash.cue.opensSr', '(shows the details below)')}</span>}
        </ActionCue>
      </span>
    </>
  );
  const cls = cn(
    'group flex h-full min-h-[148px] w-full cursor-pointer flex-col items-start rounded-card border bg-white p-5 text-left shadow-[0_1px_2px_rgba(11,38,83,0.06)]',
    'transition-[box-shadow,border-color,background-color] duration-300 motion-reduce:transition-none',
    'hover:border-navy/40 hover:shadow-hover active:bg-page focus:outline-none focus-visible:shadow-focus',
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
  cue,
  to,
  onClick,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  meta?: ReactNode;
  aside?: ReactNode;
  /** What pressing the row does ("View"): the small pill at its end, for a row that is a link or a button. */
  cue?: string;
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
      {cue && (to || onClick) && <ActionCue size="sm">{cue}</ActionCue>}
    </>
  );
  const cls = cn('group -mx-2 flex min-h-11 w-[calc(100%+1rem)] items-center gap-3 rounded-field px-2 py-1.5 text-left transition-colors hover:bg-page', ROW_FOCUS);
  if (to) return <li><Link to={to} className={cls}>{inner}</Link></li>;
  if (onClick) return <li><button type="button" onClick={onClick} className={cls}>{inner}</button></li>;
  return <li className="-mx-2 flex min-h-11 items-center gap-3 px-2 py-1.5">{inner}</li>;
}

/** CardLink's and CardButton's look: ActionCue's pill as a free-standing control, 44 px tall to tap. */
const CARD_PILL = cn(
  'group inline-flex min-h-11 max-w-full shrink-0 cursor-pointer items-center gap-1.5 rounded-pill border border-navy/55 bg-white px-4 py-1 text-left text-[15px] font-semibold leading-5 text-navy',
  'transition-colors duration-200 hover:border-navy hover:bg-chip active:bg-chip motion-reduce:transition-none focus:outline-none focus-visible:shadow-focus',
);

function CardPillInner({ children, icon = 'arrow' }: { children: ReactNode; icon?: 'arrow' | 'expand' }) {
  const Icon = icon === 'expand' ? ChevronDown : ArrowRight;
  return (
    <>
      <span className="min-w-0">{children}</span>
      <Icon
        className={cn('h-[18px] w-[18px] shrink-0 transition-transform duration-200 motion-reduce:transition-none', icon === 'arrow' && 'group-hover:translate-x-0.5')}
        strokeWidth={2.25}
        aria-hidden="true"
      />
    </>
  );
}

/**
 * A link at the top or bottom of a block ("All events", "View my company
 * page"): the dashboard's pill with its arrow (ActionCue's look, as a real
 * link), 44 px tall to tap.
 */
export function CardLink({ to, children, external = false, className }: { to: string; children: ReactNode; external?: boolean; className?: string }) {
  const inner = <CardPillInner>{children}</CardPillInner>;
  return external
    ? <a href={to} className={cn(CARD_PILL, className)}>{inner}</a>
    : <Link to={to} className={cn(CARD_PILL, className)}>{inner}</Link>;
}

/**
 * The same pill for something on this page ("Complete your profile" opens My
 * profile further down, "See my events"): a button, so a member learns one
 * look for "press here", whatever it does. `icon="expand"`: a form opens right
 * here, under it (the chevron, as on the tiles).
 */
export function CardButton({ onClick, children, icon = 'arrow', className }: { onClick: () => void; children: ReactNode; icon?: 'arrow' | 'expand'; className?: string }) {
  return (
    <button type="button" onClick={onClick} className={cn(CARD_PILL, className)}>
      <CardPillInner icon={icon}>{children}</CardPillInner>
    </button>
  );
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
