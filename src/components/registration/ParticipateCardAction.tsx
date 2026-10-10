import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Hourglass, Loader2, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import {
  isActiveStatus, registerForEvent, registrationErrorText, statusLabel,
  type OpenRegistration, type Participation,
} from '@/lib/registration';
import { cn } from '@/lib/utils';

/**
 * The one action of an event card on /events for an event of the unified
 * registration (the compact form of ParticipateBlock), from two lists read once
 * for the whole page: the events taking registrations (as anyone sees them) and
 * the member's own registrations. Signed in, a webinar open to all takes a seat
 * in one tap ("Save my seat"); when the event asks for more, the tap opens its
 * form instead. Everything else leads to the event page, where the block says
 * the rest.
 */
export function ParticipateCardAction({
  reg,
  mine,
  signedIn,
  verified,
  onNavy = false,
  onRegistered,
}: {
  reg: OpenRegistration;
  mine: Participation | null;
  signedIn: boolean;
  /** The member is validated by M3 (members-only events). */
  verified: boolean;
  /** On the marine "next event" panel. */
  onNavy?: boolean;
  onRegistered?: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const size = onNavy ? 'default' : 'sm';
  const main = onNavy ? 'ctaOnDark' : 'ctaNavy';
  const second = onNavy ? 'ctaLight' : 'ctaOutline';
  const quiet = cn('inline-flex min-h-11 items-center gap-1.5 text-sm', onNavy ? 'text-white/85' : 'text-meta');
  const detail = reg.event_id ? `/events/${reg.event_id}` : `/register/${reg.slug}`;
  const form = `/register/${reg.slug}?from=event`;

  if (mine && isActiveStatus(mine.status)) {
    const confirmed = mine.status_display === 'confirmed';
    return (
      <Button asChild size={size} variant={second}>
        <Link to={detail}>
          {confirmed && <CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden="true" />}
          {confirmed ? t('eventsPage.viewRegistration', 'View my registration') : statusLabel(t, mine.status_display)}
        </Link>
      </Button>
    );
  }

  const state = reg.state === 'members_only' && signedIn && verified ? 'open' : reg.state;

  if (state === 'open' || state === 'waitlist') {
    const waitlist = state === 'waitlist';
    const label = waitlist ? t('reg.submit.waitlist', 'Join the waiting list')
      : reg.registration_mode === 'invitation' ? t('eventsPage.requestInvitation', 'Request an invitation')
        : signedIn && reg.kind === 'webinar' ? t('reg.block.saveSeat', 'Save my seat') : t('events.register', 'Register');

    // Signed in, a webinar: one tap. Anything to fill in, and the form opens.
    if (signedIn && reg.kind === 'webinar' && reg.registration_mode !== 'invitation' && reg.event_id) {
      const tap = async () => {
        setBusy(true);
        const res = await registerForEvent({ event_id: reg.event_id! }, { source_detail: { entry: 'event_page', ref: 'events_list' } });
        setBusy(false);
        if (res.ok) {
          toast({
            title: waitlist ? t('reg.toast.waitlisted', 'You are on the waiting list. We sent you an e-mail.')
              : reg.registration_mode === 'review' ? t('reg.toast.received', 'Registration received. The M3 team will reply by e-mail.')
                : t('reg.toast.registered', "You're registered. We sent you the details by e-mail."),
          });
          onRegistered?.();
          return;
        }
        if (['missing_fields', 'invalid_answers', 'ticket_required', 'unknown_ticket'].includes(res.error ?? '')) {
          navigate(form);
          return;
        }
        toast({ title: t('eventsPage.registrationFailed', 'Registration failed'), description: registrationErrorText(t, res), variant: 'destructive' });
      };
      return (
        <Button size={size} variant={main} disabled={busy} onClick={() => void tap()} arrow={!busy} roll={!busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          {waitlist && !busy && <Hourglass className="mr-1.5 h-4 w-4" aria-hidden="true" />}
          {label}
        </Button>
      );
    }
    return (
      <Button asChild size={size} variant={main}>
        <Link to={detail}>{label}</Link>
      </Button>
    );
  }

  switch (state) {
    case 'members_only':
      return <span className={quiet}><Lock className="h-4 w-4" aria-hidden="true" />{t('eventsPage.access.members', 'Members only')}</span>;
    case 'full':
      return <span className={quiet}>{t('eventsPage.fullTitle', 'Fully booked')}</span>;
    case 'invitation_only':
      return <span className={quiet}><Lock className="h-4 w-4" aria-hidden="true" />{t('eventsPage.invitationOnly', 'By invitation')}</span>;
    case 'not_yet_open':
      return (
        <Button asChild size={size} variant={second}>
          <Link to={detail}>{t('reg.card.opensSoon', 'Registration opens soon')}</Link>
        </Button>
      );
    case 'closed':
      return <span className={quiet}>{t('reg.block.closedTitle', 'Registration closed')}</span>;
    default:
      return (
        <Button asChild size={size} variant={second}>
          <Link to={detail}>{t('eventsPage.seeDetails', 'See details')}</Link>
        </Button>
      );
  }
}
