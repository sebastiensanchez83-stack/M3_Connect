import type { CSSProperties, ElementType, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, type LucideIcon } from 'lucide-react';
import { CoverImage } from '@/components/ui/CoverImage';
import type { SiteImage } from '@/lib/siteMedia';
import { BathyPattern } from '@/components/motion/BathyPattern';
import { CardShell } from '@/components/brand/CardShell';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { registerMemberRefonteStrings } from '@/i18n/refonte-member';
import { cn } from '@/lib/utils';

registerMemberRefonteStrings();

/**
 * The refonte's working-screen kit: what the dashboard, the account area, the
 * inbox, profiles and the deal flow share. It speaks the language of Home and
 * Directory (marine band, white 16 px cards with a hairline, caps eyebrows with
 * the teal dot, gold underline and small arrow on hover, pill controls) in a
 * quieter, denser register: no photo cards, no reveal on every block, nothing
 * that moves on its own.
 *
 *   MemberHeader   full-width compact marine band: greeting / title, meta, actions
 *   MemberPanel    CardShell with an Eyebrow title and one link on the right
 *   MemberRow      a link row for lists inside a panel (icon tile, title, hint, small arrow)
 *   MemberEmpty    short, helpful empty state (icon in a chip, one sentence, one action)
 *   MemberBanner   status banner (info, warning, danger)
 *   StatusPill     small state label (success / warning / danger / neutral / info)
 *   SectionHeading Eyebrow (+ optional section number) over an H2 and an intro
 *   RowSkeleton / BlockSkeleton   loading placeholders
 *
 * Gold stays the colour of the main action only (the rolling `cta` buttons);
 * dense controls use the shadcn buttons with BTN / BTN_OUTLINE (pill, 40 px).
 */

/** Dense shadcn buttons: pill, 40 px (the touch-target floor of the member area). */
export const BTN = 'h-10 rounded-pill px-4';
export const BTN_OUTLINE = 'h-10 rounded-pill border-navy/25 bg-white px-4 text-navy hover:border-navy hover:bg-chip hover:text-navy';

/** A row link inside a card: the card clips, so the focus ring sits inside. */
export const ROW_FOCUS = 'focus:outline-none focus-visible:[box-shadow:inset_0_0_0_2px_#0b2653]';
/** Focus ring for a free-standing control (double ring: visible on white and navy). */
export const FOCUS = 'focus:outline-none focus-visible:shadow-focus';

/* ------------------------------------------------------------------ header */

export function MemberHeader({
  image,
  seed,
  icon,
  eyebrow,
  title,
  leading,
  actions,
  children,
  back,
  className,
}: {
  /** A photo behind the marine veil (the organisation's cover, an SM26 photo); null draws the sea-toned gradient. */
  image?: SiteImage | null;
  seed: string;
  icon: LucideIcon;
  eyebrow?: string;
  title: string;
  /** Logo or avatar, before the title. */
  leading?: ReactNode;
  /** Buttons on the right (wraps under the title on phones). */
  actions?: ReactNode;
  /** Meta line under the title: organisation, status pill. */
  children?: ReactNode;
  /** A back link above the title (a `<BackLink>`). */
  back?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('relative isolate overflow-hidden bg-navy text-white', className)}>
      <div aria-hidden="true" className="absolute inset-0 -z-30">
        <CoverImage
          src={image?.src ?? null}
          focusY={image?.focusY ?? 0.5}
          alt=""
          seed={seed}
          icon={icon}
          aspect="fill"
          tone="sea"
          eager
          className="absolute inset-0"
        />
      </div>
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-20 bg-[linear-gradient(180deg,rgba(8,29,64,.92)_0%,rgba(11,38,83,.84)_100%)] lg:bg-[linear-gradient(90deg,rgba(11,38,83,.95),rgba(11,38,83,.7))]"
      />
      <BathyPattern seed={3} className="absolute inset-y-0 left-0 -z-10 w-full min-[1200px]:w-[60%]" />
      <div className="relative z-10 mx-auto w-full max-w-7xl px-4 py-7 sm:px-6 md:py-9">
        {back && <div className="mb-5">{back}</div>}
        <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-5">
        <div className="flex w-full min-w-0 items-center gap-4 md:w-auto md:flex-1 md:gap-5">
          {leading}
          <div className="min-w-0">
            {eyebrow && <Eyebrow tone="onDark">{eyebrow}</Eyebrow>}
            <h1 className={cn('enter-up text-h2-sm text-white [overflow-wrap:anywhere] md:text-h2', eyebrow && 'mt-2')} style={{ '--enter-delay': '0.05s' } as CSSProperties}>{title}</h1>
            {children && <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[15px] leading-6 text-white/85">{children}</div>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>}
        </div>
      </div>
    </section>
  );
}

/** A small back link for a band: white, gold line on hover, arrow pointing back. */
export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="uline uline--light uline--plain !text-[14px] !font-normal">
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      <span className="uline-t">{children}</span>
    </Link>
  );
}

/* ------------------------------------------------------------------ pills */

export type PillTone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

const PILL: Record<PillTone, string> = {
  success: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-900 ring-amber-200',
  danger: 'bg-red-50 text-red-800 ring-red-200',
  neutral: 'bg-chip text-meta ring-rule',
  info: 'bg-foam text-teal-text ring-teal/25',
};

export function StatusPill({
  tone = 'neutral',
  icon: Icon,
  children,
  className,
}: {
  tone?: PillTone;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-pill px-2.5 py-0.5 text-[12px] font-semibold leading-5 ring-1 ring-inset', PILL[tone], className)}>
      {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
      {children}
    </span>
  );
}

/** The same label on a navy band: a translucent white pill, so it reads on any photo. */
export function BandPill({ tone = 'neutral', icon: Icon, children }: { tone?: 'neutral' | 'warning' | 'danger'; icon?: LucideIcon; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill px-3 py-1 text-[13px] font-semibold leading-5',
        tone === 'neutral' && 'bg-white/15 text-white ring-1 ring-inset ring-white/30',
        tone === 'warning' && 'bg-amber-100 text-amber-900',
        tone === 'danger' && 'bg-red-100 text-red-900',
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ panels */

export function MemberPanel({
  title,
  titleId,
  count,
  link,
  actions,
  as = 'section',
  className,
  children,
}: {
  title?: ReactNode;
  titleId?: string;
  count?: number;
  /** One link on the right of the title: gold line and small arrow on hover. */
  link?: { to: string; label: string };
  /** Anything else on the right (buttons); ignored when `link` is given. */
  actions?: ReactNode;
  as?: ElementType;
  className?: string;
  children: ReactNode;
}) {
  return (
    <CardShell as={as} className={className}>
      {title && (
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-rule px-5 py-4">
          <Eyebrow as="h2" className="min-w-0">
            <span id={titleId} className="min-w-0">{title}</span>
            {count !== undefined && (
              <span className="rounded-pill bg-chip px-2 py-0.5 text-[12px] font-semibold normal-case leading-4 tracking-normal tabular-nums text-navy">{count}</span>
            )}
          </Eyebrow>
          {link ? (
            <UnderlineLink to={link.to} className="!text-[14px] !leading-5">
              {link.label}
            </UnderlineLink>
          ) : actions}
        </header>
      )}
      {children}
    </CardShell>
  );
}

/**
 * A row of a panel list: icon tile, title with the gold line, hint, optional
 * aside, small arrow. A link (`to`), or a button (`onClick`) when the row opens
 * something on the same page (a block of the home dashboard).
 */
export function MemberRow({
  to,
  onClick,
  icon: Icon,
  title,
  hint,
  aside,
  urgent = false,
}: {
  to?: string;
  onClick?: () => void;
  icon: LucideIcon;
  title: ReactNode;
  hint?: ReactNode;
  aside?: ReactNode;
  /** Someone is waiting on an answer: the icon tile warms up (gold tint, navy icon). */
  urgent?: boolean;
}) {
  const cls = cn('group flex min-h-[64px] w-full items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-page', ROW_FOCUS);
  const inner = (
    <>
      <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-field text-navy', urgent ? 'bg-gold/25' : 'bg-chip')}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold leading-5 text-navy [overflow-wrap:anywhere]">
          <span className="card-ul">{title}</span>
        </span>
        {hint && <span className="mt-0.5 block text-[13px] leading-[18px] text-meta">{hint}</span>}
        {aside && <span className="mt-2 flex sm:hidden">{aside}</span>}
      </span>
      {aside && <span className="hidden shrink-0 sm:flex">{aside}</span>}
      <ArrowRight className="card-arrow !ml-0 shrink-0" strokeWidth={2.25} aria-hidden="true" />
    </>
  );
  return (
    <li>
      {to ? (
        <Link to={to} className={cls}>{inner}</Link>
      ) : (
        <button type="button" onClick={onClick} className={cls}>{inner}</button>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ states */

export function MemberEmpty({
  icon: Icon,
  title,
  body,
  action,
  tone = 'default',
  titleAs: Title = 'p',
  className,
}: {
  icon: LucideIcon;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  tone?: 'default' | 'warning';
  /** The title's element: `h1` when the empty state is the whole page (a gate screen), `p` inside a panel. */
  titleAs?: 'p' | 'h1' | 'h2';
  className?: string;
}) {
  return (
    <div className={cn('px-5 py-10 text-center', className)}>
      <span className={cn('mx-auto grid h-14 w-14 place-items-center rounded-pill', tone === 'warning' ? 'bg-amber-50 text-amber-700' : 'bg-chip text-navy')}>
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <Title className="mt-4 text-[17px] font-semibold leading-6 text-navy">{title}</Title>
      {body && <p className="mx-auto mt-1.5 max-w-md text-[15px] leading-6 text-meta">{body}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-3">{action}</div>}
    </div>
  );
}

const BANNER: Record<'info' | 'warning' | 'danger', string> = {
  info: 'border-teal/25 bg-foam text-navy',
  warning: 'border-amber-200 bg-amber-50 text-amber-950',
  danger: 'border-red-200 bg-red-50 text-red-950',
};
const BANNER_ICON: Record<'info' | 'warning' | 'danger', string> = {
  info: 'text-teal',
  warning: 'text-amber-700',
  danger: 'text-red-700',
};

export function MemberBanner({
  tone,
  icon: Icon,
  title,
  body,
  action,
  className,
}: {
  tone: 'info' | 'warning' | 'danger';
  icon: LucideIcon;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-6 flex flex-col gap-3 rounded-card border p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5', BANNER[tone], className)}>
      <div className="flex min-w-0 items-start gap-3">
        <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', BANNER_ICON[tone])} aria-hidden="true" />
        <div className="text-[15px] leading-6">
          <p className="font-semibold">{title}</p>
          {body && <p className="mt-0.5 opacity-90">{body}</p>}
        </div>
      </div>
      {action && <div className="shrink-0 sm:pl-4">{action}</div>}
    </div>
  );
}

export function RowSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className="divide-y divide-rule" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <div className="h-10 w-10 animate-pulse rounded-field bg-chip motion-reduce:animate-none" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-2/3 animate-pulse rounded bg-chip motion-reduce:animate-none" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-chip motion-reduce:animate-none" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function BlockSkeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-field bg-chip motion-reduce:animate-none', className)} />;
}

/* ------------------------------------------------------------------ headings */

/** An Eyebrow (with its optional gold section number) over an H2 and a one-line intro. */
export function SectionHeading({
  eyebrow,
  number,
  title,
  intro,
  actions,
  as: Tag = 'h2',
  titleId,
  titleRef,
  className,
}: {
  eyebrow?: string;
  number?: string;
  title: ReactNode;
  intro?: ReactNode;
  actions?: ReactNode;
  as?: ElementType;
  titleId?: string;
  titleRef?: React.Ref<HTMLHeadingElement>;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        {eyebrow && <Eyebrow number={number}>{eyebrow}</Eyebrow>}
        <Tag
          id={titleId}
          ref={titleRef}
          tabIndex={titleRef ? -1 : undefined}
          className={cn('text-h2-sm text-navy focus:outline-none md:text-h2', eyebrow && 'mt-3')}
        >
          {title}
        </Tag>
        {intro && <p className="mt-2 max-w-2xl text-body text-meta">{intro}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-3">{actions}</div>}
    </header>
  );
}
