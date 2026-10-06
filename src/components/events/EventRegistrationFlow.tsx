import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, CheckCircle, Clock, AlertCircle, Ship, Eye, Users, Lock, Package, Video } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { sendNotification } from '@/lib/notifications';
import { requireFreshSession } from '@/lib/session';
import { OrgTier, isSponsorTier, TIER_LABELS } from '@/types/database';
import { AddToCalendarButtons } from '@/components/events/AddToCalendarButtons';
import type { CalendarEventInput } from '@/lib/utils';

interface EventPackage {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  max_seats: number | null;
  display_order: number;
}

interface EventRegistrationFlowProps {
  eventId: string;
  eventType?: 'webinar' | 'on_site';
  invitationOnly?: boolean;
  packages?: EventPackage[];
  onRegistrationChange?: (isRegistered: boolean, count: number) => void;
  // Event details used to build "add to calendar" links + the success popup.
  eventTitle?: string;
  eventDescription?: string | null;
  eventDateTime?: string | null;
  eventEndDateTime?: string | null;
  eventLocation?: string | null;
  eventMeetingUrl?: string | null;
}

type RegistrationStatus = 'none' | 'registered' | 'invitation_requested' | 'expo_pending' | 'expo_approved' | 'expo_invoice_sent' | 'expo_paid' | 'expo_rejected';

interface PricingConfig {
  price_cents: number;
  max_included_seats: number | null;
  additional_member_price_cents: number;
  discount_pct: number;
}

export function EventRegistrationFlow({
  eventId,
  eventType = 'on_site',
  invitationOnly = false,
  packages = [],
  onRegistrationChange,
  eventTitle,
  eventDescription,
  eventDateTime,
  eventEndDateTime,
  eventLocation,
  eventMeetingUrl,
}: EventRegistrationFlowProps) {
  const { t, i18n } = useTranslation();
  const { user, profile, organization, isVerified } = useAuth();
  // Primitives only — auth-js hands a new user object on every tab refocus.
  const userId = user?.id;
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-GB';

  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [status, setStatus] = useState<RegistrationStatus>('none');
  const [registrationCount, setRegistrationCount] = useState(0);
  const [marinaChoiceOpen, setMarinaChoiceOpen] = useState(false);
  const [packageSelectOpen, setPackageSelectOpen] = useState(false);
  const [pricing, setPricing] = useState<PricingConfig | null>(null);
  const [orgRegistrationCount, setOrgRegistrationCount] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Event payload used for the "add to calendar" buttons and the success popup.
  const calendarEvent: CalendarEventInput = {
    title: eventTitle || 'Smart Marina Connect Event',
    description: eventDescription ?? null,
    date_time: eventDateTime || '',
    end_date_time: eventEndDateTime ?? null,
    location: eventLocation ?? null,
    url: eventMeetingUrl ?? null,
  };
  const hasSchedule = !!calendarEvent.date_time;

  const formatEventWhen = (iso: string) =>
    new Date(iso).toLocaleString(locale, {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

  const formatPrice = (cents: number) => {
    if (cents === 0) return t('eventsPage.free', 'Free');
    return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(cents / 100);
  };

  // Marina-like personas (marina, developer, investor) get the same event
  // registration treatment as marina — they're interest-side attendees,
  // not exhibitors.
  const isMarina = organization?.organization_type === 'marina'
    || organization?.organization_type === 'developer'
    || organization?.organization_type === 'investor';
  const isPartner = organization?.organization_type === 'partner' || organization?.organization_type === 'media_partner';
  const orgTier = (organization?.tier || 'member') as OrgTier;
  const isSponsor = isSponsorTier(orgTier);
  const hasPackages = packages.length > 0 && eventType === 'on_site';

  const checkStatus = useCallback(async () => {
    if (!userId || !eventId) return;
    setLoading(true);

    try {
      const regRes = await supabase
        .from('event_registrations').select('id, registration_type, payment_status')
        .eq('event_id', eventId).eq('user_id', userId).maybeSingle();

      const countRes = await supabase
        .from('event_registrations').select('id', { count: 'exact' })
        .eq('event_id', eventId);

      setRegistrationCount(countRes.count || 0);

      // Fetch pricing for this tier
      const pricingRes = await supabase
        .from('event_pricing').select('price_cents, max_included_seats, additional_member_price_cents, discount_pct')
        .eq('event_id', eventId).eq('tier', orgTier).maybeSingle();

      if (pricingRes.data) {
        setPricing(pricingRes.data as PricingConfig);
      }

      if (organization?.id) {
        const expoRes = await supabase
          .from('exposition_requests').select('id, status')
          .eq('event_id', eventId).eq('organization_id', organization.id).maybeSingle();

        const orgCountRes = await supabase
          .from('event_registrations').select('id', { count: 'exact' })
          .eq('event_id', eventId).eq('organization_id', organization.id);

        setOrgRegistrationCount(orgCountRes.count || 0);

        if (regRes.data) {
          // Check if it was an invitation request
          if (regRes.data.payment_status === 'pending_approval' && invitationOnly) {
            setStatus('invitation_requested');
          } else {
            setStatus('registered');
          }
        } else if (expoRes.data) {
          const expoStatus = expoRes.data.status as string;
          const statusMap: Record<string, RegistrationStatus> = {
            pending: 'expo_pending', approved: 'expo_approved',
            invoice_sent: 'expo_invoice_sent', paid: 'expo_paid', rejected: 'expo_rejected',
          };
          setStatus(statusMap[expoStatus] || 'none');
        } else {
          setStatus('none');
        }
      } else {
        if (regRes.data) {
          if (regRes.data.payment_status === 'pending_approval' && invitationOnly) {
            setStatus('invitation_requested');
          } else {
            setStatus('registered');
          }
        } else {
          setStatus('none');
        }
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error('Error checking registration status:', err);
    }
    setLoading(false);
  }, [userId, eventId, organization?.id, orgTier, invitationOnly]);

  useEffect(() => { checkStatus(); }, [checkStatus]);

  // Simple registration
  const registerDirect = async (type: string, packageId?: string) => {
    if (!user || !eventId) return;

    // Sponsor quota check
    if (type === 'sponsor_included' && pricing?.max_included_seats != null) {
      if (orgRegistrationCount >= pricing.max_included_seats) {
        toast({
          title: t('eventsShared.registrationFlow.seatsExhausted', 'Included seats exhausted'),
          description: t('eventsShared.registrationFlow.seatsExhaustedDesc', {
            count: pricing.max_included_seats,
            tier: TIER_LABELS[orgTier],
            defaultValue_one: 'Your {{tier}} package includes {{count}} seat. All included seats are used. Contact Smart Marina Connect for additional seats.',
            defaultValue_other: 'Your {{tier}} package includes {{count}} seats. All included seats are used. Contact Smart Marina Connect for additional seats.',
          }),
          variant: 'destructive',
        });
        return;
      }
    }

    const uid = await requireFreshSession();
    if (!uid) return;

    setRegistering(true);
    try {
      // Work out whether this registration actually costs anything. Free
      // registrations (sponsor-included, free webinars, free on-site events)
      // are confirmed immediately rather than left "pending approval", which
      // only makes sense for paid events that an admin still has to invoice.
      const pkg = packageId ? packages.find(p => p.id === packageId) : undefined;
      const costCents = type === 'sponsor_included'
        ? 0
        : pkg
          ? pkg.price_cents
          : (pricing?.price_cents ?? 0);
      const isFree = costCents === 0;
      const insertData: Record<string, any> = {
        event_id: eventId,
        user_id: user.id,
        organization_id: organization?.id || null,
        registration_type: type,
        payment_status: isFree ? 'free' : 'pending_approval',
        registered_by: user.id,
      };
      if (packageId) {
        insertData.package_id = packageId;
      }

      const { error } = await supabase.from('event_registrations').insert(insertData);
      if (error) {
        // Server text is English; French users get a translated message, developers the detail.
        if (import.meta.env.DEV) console.error('Event registration failed:', error);
        toast({
          title: t('eventsPage.registrationFailed', 'Registration failed'),
          description: error.code === '23505' ? t('eventsPage.alreadyRegistered', 'Already registered') : t('eventsPage.unexpectedError', 'An unexpected error occurred.'),
          variant: 'destructive',
        });
      } else {
        if (isFree) {
          sendNotification({ type: 'event_registration_confirmed', userId: user.id, data: { event_title: eventTitle || eventId } });
        }
        const resolvedStatus: RegistrationStatus = invitationOnly && !isFree ? 'invitation_requested' : 'registered';
        setStatus(resolvedStatus);
        setRegistrationCount(c => c + 1);
        setOrgRegistrationCount(c => c + 1);
        onRegistrationChange?.(true, registrationCount + 1);

        if (resolvedStatus === 'registered' && hasSchedule) {
          // Confirmed registration with a known date — show the success popup
          // with calendar buttons instead of a transient toast.
          setConfirmOpen(true);
        } else {
          toast({
            title: invitationOnly
              ? t('eventsShared.registrationFlow.invitationRequested', 'Invitation requested')
              : isFree
                ? t('eventsShared.registrationFlow.registeredIncluded', 'Registered (included in your sponsorship)')
                : t('eventsShared.registrationFlow.registrationSubmitted', 'Registration submitted'),
            description: invitationOnly
              ? t('eventsShared.registrationFlow.invitationRequestedDesc', 'Your invitation request has been sent. You will be notified once approved.')
              : !isFree
                ? t('eventsShared.registrationFlow.registrationSubmittedDesc', 'Your registration has been submitted. You will be notified when payment is due.')
                : undefined,
          });
        }
      }
    } catch (err) {
      toast({ title: t('eventsPage.registrationFailed', 'Registration failed'), description: t('eventsPage.unexpectedError', 'An unexpected error occurred.'), variant: 'destructive' });
    } finally {
      setRegistering(false);
    }
  };

  // Cancel registration
  const handleCancel = async () => {
    if (!user || !eventId) return;
    const uid = await requireFreshSession();
    if (!uid) return;
    setRegistering(true);
    try {
      const { error } = await supabase.from('event_registrations').delete().eq('event_id', eventId).eq('user_id', user.id);
      if (error) {
        if (import.meta.env.DEV) console.error('Event registration cancel failed:', error);
        toast({ title: t('eventsShared.registrationFlow.error', 'Error'), description: t('eventsPage.unexpectedError', 'An unexpected error occurred.'), variant: 'destructive' });
      } else {
        setStatus('none');
        setRegistrationCount(c => Math.max(0, c - 1));
        setOrgRegistrationCount(c => Math.max(0, c - 1));
        onRegistrationChange?.(false, Math.max(0, registrationCount - 1));
        toast({
          title: invitationOnly
            ? t('eventsShared.registrationFlow.invitationRequestCancelled', 'Invitation request cancelled')
            : t('eventsPage.cancelled', 'Registration cancelled'),
        });
      }
    } catch (err) {
      toast({ title: t('eventsShared.registrationFlow.error', 'Error'), description: t('eventsPage.unexpectedError', 'An unexpected error occurred.'), variant: 'destructive' });
    } finally {
      setRegistering(false);
    }
  };

  // Not logged in or not verified
  if (!user || !profile || !isVerified) return null;

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">{t('eventsShared.registrationFlow.checking', 'Checking registration...')}</span>
      </div>
    );
  }

  // Already registered
  if (status === 'registered') {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2.5 text-green-700 bg-green-50/80 backdrop-blur-sm border border-green-200 rounded-xl px-4 py-3 shadow-sm">
          <CheckCircle className="h-5 w-5" />
          <span className="font-medium">{t('eventsShared.registrationFlow.registeredBanner', 'You are registered for this event')}</span>
        </div>

        {eventType === 'webinar' && eventMeetingUrl && (
          <Button asChild className="w-full bg-violet-600 hover:bg-violet-700 rounded-lg">
            <a href={eventMeetingUrl} target="_blank" rel="noopener noreferrer">
              <Video className="h-4 w-4 mr-2" />
              {t('eventsPage.joinWebinar', 'Join the webinar')}
            </a>
          </Button>
        )}

        {hasSchedule && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{t('eventsPage.addToCalendarShort', 'Add to calendar')}</p>
            <AddToCalendarButtons event={calendarEvent} />
          </div>
        )}

        <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg" onClick={handleCancel} disabled={registering}>
          {registering && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          {t('eventsPage.cancelMine', 'Cancel my registration')}
        </Button>

        {/* Success popup shown immediately after registering */}
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent className="max-w-md rounded-2xl">
            <DialogHeader>
              <div className="mx-auto mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                <CheckCircle className="h-7 w-7 text-green-600" />
              </div>
              <DialogTitle className="text-center">{t('eventsPage.youreRegistered', "You're registered")}</DialogTitle>
              <DialogDescription className="text-center">
                {eventTitle
                  ? <>{t('eventsShared.registrationFlow.confirmedFor', "You're confirmed for")} <span className="font-medium text-gray-700">{eventTitle}</span>.</>
                  : t('eventsShared.registrationFlow.confirmedGeneric', 'Your registration is confirmed.')}
                {' '}{t('eventsShared.registrationFlow.calendarNudge', "Add it to your calendar so you don't miss it.")}
              </DialogDescription>
            </DialogHeader>

            {hasSchedule && (
              <div className="flex items-center justify-center gap-2 text-sm text-gray-600">
                <Clock className="h-4 w-4 text-primary" />
                <span>{formatEventWhen(calendarEvent.date_time)}</span>
              </div>
            )}

            {eventType === 'webinar' && eventMeetingUrl && (
              <Button asChild className="w-full bg-violet-600 hover:bg-violet-700 rounded-xl">
                <a href={eventMeetingUrl} target="_blank" rel="noopener noreferrer">
                  <Video className="h-4 w-4 mr-2" />
                  {t('eventsPage.joinWebinar', 'Join the webinar')}
                </a>
              </Button>
            )}

            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide text-center">{t('eventsPage.addToCalendarShort', 'Add to calendar')}</p>
              <AddToCalendarButtons event={calendarEvent} />
            </div>

            <Button variant="ghost" className="w-full" onClick={() => setConfirmOpen(false)}>
              {t('eventsShared.registrationFlow.done', 'Done')}
            </Button>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // Invitation requested (pending)
  if (status === 'invitation_requested') {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2.5 text-purple-700 bg-purple-50/80 backdrop-blur-sm border border-purple-200 rounded-xl px-4 py-3 shadow-sm">
          <Clock className="h-5 w-5 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">{t('eventsShared.registrationFlow.invitationRequested', 'Invitation requested')}</p>
            <p className="text-sm mt-0.5 opacity-80">{t('eventsShared.registrationFlow.invitationPendingDesc', 'Your request is being reviewed. You will be notified once approved.')}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg" onClick={handleCancel} disabled={registering}>
          {registering && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          {t('eventsShared.registrationFlow.cancelRequest', 'Cancel request')}
        </Button>
      </div>
    );
  }

  // Exposition request status
  if (status.startsWith('expo_')) {
    const expoStatusMap: Record<string, { color: string; icon: typeof Clock; label: string; desc: string }> = {
      expo_pending: { color: 'bg-yellow-50/80 border-yellow-200 text-yellow-800', icon: Clock, label: t('eventsShared.registrationFlow.expo.pending', 'Exposition Request Pending'), desc: t('eventsShared.registrationFlow.expo.pendingDesc', 'Your request to exhibit is being reviewed.') },
      expo_approved: { color: 'bg-blue-50/80 border-blue-200 text-blue-800', icon: CheckCircle, label: t('eventsShared.registrationFlow.expo.approved', 'Exposition Approved'), desc: t('eventsShared.registrationFlow.expo.approvedDesc', 'Your request has been approved. You will receive an invoice shortly.') },
      expo_invoice_sent: { color: 'bg-indigo-50/80 border-indigo-200 text-indigo-800', icon: AlertCircle, label: t('eventsShared.registrationFlow.expo.invoiceSent', 'Invoice Sent'), desc: t('eventsShared.registrationFlow.expo.invoiceSentDesc', 'Please complete the payment to confirm your exhibition spot.') },
      expo_paid: { color: 'bg-green-50/80 border-green-200 text-green-800', icon: CheckCircle, label: t('eventsShared.registrationFlow.expo.paid', 'Exhibition Confirmed'), desc: t('eventsShared.registrationFlow.expo.paidDesc', 'Your payment has been confirmed. You are registered as an exhibitor.') },
      expo_rejected: { color: 'bg-red-50/80 border-red-200 text-red-800', icon: AlertCircle, label: t('eventsShared.registrationFlow.expo.rejected', 'Request Rejected'), desc: t('eventsShared.registrationFlow.expo.rejectedDesc', 'Your exhibition request was not approved. Contact Smart Marina Connect for details.') },
    };
    const info = expoStatusMap[status];
    if (info) {
      const Icon = info.icon;
      return (
        <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 shadow-sm backdrop-blur-sm ${info.color}`}>
          <Icon className="h-5 w-5 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">{info.label}</p>
            <p className="text-sm mt-0.5 opacity-80">{info.desc}</p>
          </div>
        </div>
      );
    }
  }

  // --- Invitation-only flow ---
  if (invitationOnly) {
    // Sponsors can still auto-register for invitation-only events
    if (isSponsor) {
      const maxSeats = pricing?.max_included_seats;
      const quotaReached = maxSeats != null && orgRegistrationCount >= maxSeats;
      if (!quotaReached) {
        return (
          <div className="space-y-3">
            <Button onClick={() => registerDirect('sponsor_included')} disabled={registering} className="rounded-xl shadow-sm w-full">
              {registering && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t('eventsShared.registrationFlow.registerIncluded', { tier: TIER_LABELS[orgTier], defaultValue: 'Register (Included in {{tier}})' })}
            </Button>
            <p className="text-xs text-gray-500">
              {t('eventsShared.registrationFlow.sponsorInvitationNote', 'Your sponsorship includes access to invitation-only events.')}
            </p>
          </div>
        );
      }
    }

    return (
      <div className="space-y-3">
        <Button
          onClick={() => registerDirect('invitation_request')}
          disabled={registering}
          variant="outline"
          className="w-full rounded-xl shadow-sm border-purple-200 text-purple-700 hover:bg-purple-50"
        >
          {registering && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          <Lock className="h-4 w-4 mr-2" />
          {t('eventsPage.requestInvitation', 'Request an invitation')}
        </Button>
        <p className="text-xs text-gray-500">
          {t('eventsShared.registrationFlow.invitationRequiredNote', 'This event requires an invitation. Submit a request and you will be notified once approved.')}
        </p>
      </div>
    );
  }

  // --- Package selection flow (on-site with packages) ---
  if (hasPackages && !isSponsor) {
    return (
      <>
        <Button onClick={() => setPackageSelectOpen(true)} disabled={registering} className="w-full rounded-xl shadow-sm">
          {registering && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          <Package className="h-4 w-4 mr-2" />
          {t('eventsShared.registrationFlow.choosePackage', 'Choose a package')}
        </Button>

        <Dialog open={packageSelectOpen} onOpenChange={setPackageSelectOpen}>
          <DialogContent className="max-w-md rounded-2xl">
            <DialogHeader>
              <DialogTitle>{t('eventsShared.registrationFlow.selectPackageTitle', 'Select a registration package')}</DialogTitle>
              <DialogDescription>{t('eventsShared.registrationFlow.selectPackageDesc', 'Choose your preferred registration package for this event.')}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 mt-2">
              {packages.map(pkg => (
                <Card
                  key={pkg.id}
                  className="cursor-pointer hover:border-primary hover:shadow-md transition-all duration-200 rounded-xl"
                  onClick={() => {
                    setPackageSelectOpen(false);
                    registerDirect(isMarina ? 'marina_package' : 'package', pkg.id);
                  }}
                >
                  <CardContent className="flex items-center gap-4 p-4">
                    <div className="bg-primary/10 rounded-xl p-3">
                      <Package className="h-6 w-6 text-primary" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold">{pkg.name}</h3>
                      {pkg.description && (
                        <p className="text-sm text-gray-600">{pkg.description}</p>
                      )}
                      {pkg.max_seats != null && (
                        <p className="text-xs text-gray-400">{t('eventsPage.seatsAvailable', { count: pkg.max_seats, defaultValue_one: '{{count}} seat available', defaultValue_other: '{{count}} seats available' })}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <span className="text-lg font-bold text-primary">{formatPrice(pkg.price_cents)}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // --- Standard registration flows (no packages) ---

  // Sponsor check FIRST
  if (isSponsor) {
    const maxSeats = pricing?.max_included_seats;
    const quotaReached = maxSeats != null && orgRegistrationCount >= maxSeats;

    return (
      <div className="space-y-3">
        {quotaReached ? (
          <div className="flex items-start gap-3 rounded-xl border px-4 py-3 bg-amber-50/80 border-amber-200 text-amber-800 shadow-sm backdrop-blur-sm">
            <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">{t('eventsShared.registrationFlow.seatsExhausted', 'Included seats exhausted')}</p>
              <p className="text-sm mt-0.5 opacity-80">
                {t('eventsShared.registrationFlow.seatsExhaustedDesc', {
                  count: maxSeats,
                  tier: TIER_LABELS[orgTier],
                  defaultValue_one: 'Your {{tier}} package includes {{count}} seat. All included seats are used. Contact Smart Marina Connect for additional seats.',
                  defaultValue_other: 'Your {{tier}} package includes {{count}} seats. All included seats are used. Contact Smart Marina Connect for additional seats.',
                })}
              </p>
            </div>
          </div>
        ) : (
          <>
            <Button onClick={() => registerDirect('sponsor_included')} disabled={registering} className="rounded-xl shadow-sm">
              {registering && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t('eventsShared.registrationFlow.registerIncluded', { tier: TIER_LABELS[orgTier], defaultValue: 'Register (Included in {{tier}})' })}
            </Button>
            <p className="text-xs text-gray-500">
              {t('eventsShared.registrationFlow.sponsorAccessNote', 'Your sponsorship includes event access.')}
              {maxSeats != null && (
                <span className="ml-1">
                  <Users className="h-3 w-3 inline mr-0.5" />
                  {t('eventsShared.registrationFlow.seatsUsed', { used: orgRegistrationCount, max: maxSeats, defaultValue: '{{used}} / {{max}} seats used' })}
                </span>
              )}
            </p>
          </>
        )}
      </div>
    );
  }

  // Marina (non-sponsor, no packages): register as a visitor. Exhibitor/booth
  // requests are no longer self-service — exhibition is arranged directly with
  // the M3 team, so we register straight through rather than offering a choice.
  if (isMarina) {
    return (
      <Button onClick={() => registerDirect('visitor')} disabled={registering} className="w-full sm:w-auto rounded-xl shadow-sm">
        {registering && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
        {t('eventsShared.registrationFlow.registerForEvent', 'Register for this event')}
      </Button>
    );
  }

  // Member with discount — only for events that actually have a cost.
  // Free events (most webinars, and free on-site events) fall through to the
  // plain "Register for this Event" button below, so we never show misleading
  // "member rate / payment to follow" wording when there is nothing to pay.
  const isPaidEvent = (pricing?.price_cents ?? 0) > 0;
  if (isPartner && orgTier === 'member' && isPaidEvent) {
    const discount = pricing?.discount_pct || 10;
    return (
      <div className="space-y-2">
        <Button onClick={() => registerDirect('member_discount')} disabled={registering} className="rounded-xl shadow-sm">
          {registering && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          {t('eventsShared.registrationFlow.registerMemberRate', 'Register (member rate)')}
        </Button>
        <p className="text-xs text-gray-500">{t('eventsShared.registrationFlow.memberDiscountNote', { discount, defaultValue: '{{discount}}% member discount. Subject to approval — payment details will follow.' })}</p>
      </div>
    );
  }

  // Default: basic registration
  return (
    <Button onClick={() => registerDirect('visitor')} disabled={registering} className="rounded-xl shadow-sm">
      {registering && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
      {t('eventsShared.registrationFlow.registerForEvent', 'Register for this event')}
    </Button>
  );
}
