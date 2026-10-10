import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle, ArrowLeft, CalendarDays, CheckCircle2, Clock, CreditCard, Hourglass, Mail, MapPin, MessageSquare, Ticket, Video, XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/member/MemberUI';
import { CoverImage } from '@/components/ui/CoverImage';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { useRegisterHeaderHero } from '@/components/layout/headerOverlay';
import {
  displayOf, paymentLabel, statusLabel, statusTone,
  type PaymentDisplay, type StatusDisplay,
} from '@/lib/registration';
import { cn } from '@/lib/utils';

/**
 * Small pieces shared by the registration screens (the event page's block, the
 * register page, the status page, My events): the status and payment pills in
 * the one vocabulary, the date line, and the inline "Are you sure?" that
 * replaces the browser's confirm box for the actions that cannot be undone.
 */

const STATUS_ICON: Record<StatusDisplay, LucideIcon> = {
  under_review: Clock,
  needs_info: MessageSquare,
  waitlisted: Hourglass,
  invited: Mail,
  payment_due: CreditCard,
  confirmed: CheckCircle2,
  not_accepted: XCircle,
  declined: XCircle,
  cancelled: XCircle,
  event_ended: CheckCircle2,
};

/** The status of a registration, in words, from its display value or its raw status. */
export function RegStatusPill({ display, status, className }: { display?: StatusDisplay | null; status?: string | null; className?: string }) {
  const { t } = useTranslation();
  const d = display ?? displayOf(status);
  if (!d) return null;
  return (
    <StatusPill tone={statusTone(d)} icon={STATUS_ICON[d] ?? Ticket} className={className}>
      {statusLabel(t, d)}
    </StatusPill>
  );
}

/** The payment badge; nothing when no payment is involved. */
export function PaymentPill({ payment, className }: { payment?: PaymentDisplay | null; className?: string }) {
  const { t } = useTranslation();
  const label = paymentLabel(t, payment);
  if (!label) return null;
  const tone = payment === 'paid' || payment === 'waived' ? 'success' : payment === 'refunded' ? 'neutral' : 'warning';
  return <StatusPill tone={tone} icon={payment === 'due' ? AlertCircle : CreditCard} className={className}>{label}</StatusPill>;
}

/** The interface's locale for dates (the site is English; a French browser keeps its own formats elsewhere). */
export function regLocale(lang: string | undefined): string {
  return lang?.startsWith('fr') ? 'fr-FR' : 'en-GB';
}

/** A time zone the browser knows (an unknown name would throw), else undefined: the browser's own. */
function knownZone(zone: string | null | undefined): string | undefined {
  if (!zone) return undefined;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
    return zone;
  } catch {
    return undefined;
  }
}

/**
 * "Wed 13 May 2026 · 15:00 – 16:00 CEST", "Sun 20 Sept 2026 – Mon 21 Sept 2026",
 * or the words for an unknown date. An end at midnight is exclusive (a one-day
 * event stored as 00:00 → 00:00 the next day reads as one day).
 *
 * `timeZone` (an on-site event's own zone): the hours of the place, with the
 * zone's name, whatever the reader's browser. Without it (webinars), the
 * reader's own hours.
 */
export function whenLine(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
  locale: string,
  tbd: string,
  allDay?: boolean,
  timeZone?: string | null,
): string {
  if (!startIso) return tbd;
  const zone = knownZone(timeZone);
  const inZone = zone ? { timeZone: zone } : {};
  const start = new Date(startIso);
  let end = endIso ? new Date(endIso) : null;
  const hm = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...inZone });
  if (end && hm(end) === '00:00' && end.getTime() > start.getTime()) end = new Date(end.getTime() - 1);
  const day = (d: Date) => d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', ...inZone });
  const time = (d: Date, withZone = false) => d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', ...inZone, ...(withZone ? { timeZoneName: 'short' as const } : {}) });
  if (end && day(end) !== day(start)) return `${day(start)} – ${day(end)}`;
  if (allDay) return day(start);
  return end ? `${day(start)} · ${time(start)} – ${time(end, true)}` : `${day(start)} · ${time(start, true)}`;
}

/** The zone to show an event's hours in: its own for an on-site event, the reader's for a webinar. */
export function eventZone(ev: { kind?: string | null; timezone?: string | null } | null | undefined): string | null {
  return ev && ev.kind === 'onsite' ? ev.timezone ?? null : null;
}

/** A long date: "Wednesday 13 May 2026". */
export function longDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * A button that asks once more, in place, before an action that cannot be
 * undone (cancel a registration, decline an invitation): "Are you sure?" with
 * the two answers as plain buttons. No browser dialog, nothing hidden behind it.
 */
export function ConfirmInline({
  label,
  question,
  confirmLabel,
  keepLabel,
  onConfirm,
  busy,
  icon: Icon,
  className,
  buttonClassName,
  tone = 'danger',
}: {
  label: string;
  question: string;
  confirmLabel: string;
  keepLabel: string;
  onConfirm: () => void;
  busy?: boolean;
  icon?: LucideIcon;
  className?: string;
  /** Only for the first button (not the question). */
  buttonClassName?: string;
  tone?: 'danger' | 'neutral';
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button
        type="button"
        variant="ghost"
        className={cn(
          'h-11 w-full rounded-pill',
          tone === 'danger' ? 'text-red-700 hover:bg-red-50 hover:text-red-800' : 'text-navy hover:bg-chip',
          className,
          buttonClassName,
        )}
        onClick={() => setAsking(true)}
        disabled={busy}
      >
        {Icon && <Icon className="mr-2 h-4 w-4" aria-hidden="true" />}
        {label}
      </Button>
    );
  }
  return (
    <div role="group" aria-label={question} className={cn('rounded-field border border-rule bg-page p-3.5', className)}>
      <p className="text-sm font-semibold leading-5 text-navy">{question}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          className={cn('h-11 rounded-pill px-4', tone === 'danger' ? 'bg-red-700 text-white hover:bg-red-800' : 'bg-navy text-white hover:bg-navy/90')}
          onClick={() => { onConfirm(); setAsking(false); }}
          disabled={busy}
        >
          {confirmLabel}
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-11 rounded-pill border-navy/25 px-4 text-navy" onClick={() => setAsking(false)} disabled={busy}>
          {keepLabel}
        </Button>
      </div>
    </div>
  );
}

/** A quiet line with an icon: what happens next, where to find something. */
export function NoteLine({ icon: Icon, children, className }: { icon: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <p className={cn('flex gap-2.5 text-sm leading-[22px] text-ink', className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-teal" aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** Company types in words, as the platform says them (partner = "Service provider"). */
export function companyTypeLabel(t: TFunction, type: string): string {
  switch (type) {
    case 'marina': return t('reg.orgType.marina', 'Marina');
    case 'partner': return t('reg.orgType.partner', 'Service provider');
    case 'investor': return t('reg.orgType.investor', 'Investor');
    case 'developer': return t('reg.orgType.developer', 'Developer');
    case 'media_partner': return t('reg.orgType.media', 'Media');
    default: return type;
  }
}

/**
 * The event, in a compact marine band at the top of the register and status
 * pages: a back link, a caps line, the title, when and where. The site header
 * overlaps it when it is the first thing on the page (headerOverlay).
 */
export function EventBand({
  back,
  eyebrow,
  title,
  when,
  where,
  webinar,
  image,
  seed,
}: {
  back?: { to: string; label: string } | null;
  eyebrow: string;
  title: string;
  when?: string | null;
  where?: string | null;
  webinar: boolean;
  image?: string | null;
  seed: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const overlaid = useRegisterHeaderHero(ref);
  const KindIcon = webinar ? Video : CalendarDays;
  return (
    <section ref={ref} className="relative isolate overflow-hidden bg-navy text-white">
      <div aria-hidden="true" className="absolute inset-0 -z-20">
        <CoverImage src={image ?? null} alt="" seed={seed} icon={KindIcon} aspect="fill" tone="sea" eager className="absolute inset-0" />
      </div>
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(8,29,64,.9)_0%,rgba(11,38,83,.86)_100%)]" />
      <div className={cn('mx-auto w-full max-w-5xl px-4 pb-16 sm:px-6', overlaid ? 'pt-[92px] md:pt-[104px]' : 'pt-8')}>
        {back && (
          <Link to={back.to} className="uline uline--light uline--plain !text-[14px] !font-normal">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span className="uline-t">{back.label}</span>
          </Link>
        )}
        <Eyebrow tone="onDark" className={back ? 'mt-5' : undefined}>{eyebrow}</Eyebrow>
        <h1 className="mt-2 text-h2-sm text-white [overflow-wrap:anywhere] md:text-h2">{title}</h1>
        {(when || where) && (
          <div className="mt-3 flex flex-col gap-1.5 text-[15px] leading-6 text-white/85 sm:flex-row sm:flex-wrap sm:gap-x-6">
            {when && <span className="flex items-center gap-2"><CalendarDays className="h-4 w-4 shrink-0 text-gold" aria-hidden="true" />{when}</span>}
            {where && (
              <span className="flex items-center gap-2">
                {webinar ? <Video className="h-4 w-4 shrink-0 text-gold" aria-hidden="true" /> : <MapPin className="h-4 w-4 shrink-0 text-gold" aria-hidden="true" />}
                {where}
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
