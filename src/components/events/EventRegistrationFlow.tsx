import { useState, useEffect, useCallback } from 'react';
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

const formatPrice = (cents: number) => {
  if (cents === 0) return 'Free';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR' }).format(cents / 100);
};

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
  const { user, profile, organization, isVerified } = useAuth();

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
    new Date(iso).toLocaleString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

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
    if (!user || !eventId) return;
    setLoading(true);

    try {
      const regRes = await supabase
        .from('event_registrations').select('id, registration_type, payment_status')
        .eq('event_id', eventId).eq('user_id', user.id).maybeSingle();

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
  }, [user, eventId, organization?.id, orgTier, invitationOnly]);

  useEffect(() => { checkStatus(); }, [checkStatus]);

  // Simple registration
  const registerDirect = async (type: string, packageId?: string) => {
    if (!user || !eventId) return;

    // Sponsor quota check
    if (type === 'sponsor_included' && pricing?.max_included_seats != null) {
      if (orgRegistrationCount >= pricing.max_included_seats) {
        toast({
          title: 'Included seats exhausted',
          description: `Your ${TIER_LABELS[orgTier]} package includes ${pricing.max_included_seats} seat(s). All included seats are used. Contact Smart Marina Connect for additional seats.`,
          variant: 'destructive',
        });
        return;
      }
    }

    setRegistering(true);
    try {
      const isFree = type === 'sponsor_included';
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
        toast({ title: 'Registration failed', description: error.message, variant: 'destructive' });
      } else {
        if (isFree) {
          sendNotification({ type: 'event_registration_confirmed', userId: user.id, data: { event_title: eventId } });
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
              ? 'Invitation requested'
              : isFree
                ? 'Registered (included in your sponsorship)'
                : 'Registration submitted',
            description: invitationOnly
              ? 'Your invitation request has been sent. You will be notified once approved.'
              : !isFree
                ? 'Your registration has been submitted. You will be notified when payment is due.'
                : undefined,
          });
        }
      }
    } catch (err) {
      toast({ title: 'Registration failed', description: 'An unexpected error occurred.', variant: 'destructive' });
    } finally {
      setRegistering(false);
    }
  };

  // Submit exposition request (exhibitor marina)
  const submitExpositionRequest = async () => {
    if (!user || !eventId || !organization?.id) return;
    setRegistering(true);
    try {
      const { error } = await supabase.from('exposition_requests').insert({
        organization_id: organization.id,
        event_id: eventId,
        requested_by: user.id,
      });
      if (error) {
        if (error.code === '23505') {
          toast({ title: 'Already requested', description: 'An exposition request already exists for this event.', variant: 'destructive' });
        } else {
          toast({ title: 'Request failed', description: error.message, variant: 'destructive' });
        }
      } else {
        setStatus('expo_pending');
        toast({
          title: 'Exposition request submitted',
          description: 'Smart Marina Connect will review your request and contact you.',
        });
      }
    } catch (err) {
      toast({ title: 'Request failed', description: 'An unexpected error occurred.', variant: 'destructive' });
    } finally {
      setRegistering(false);
    }
  };

  // Cancel registration
  const handleCancel = async () => {
    if (!user || !eventId) return;
    setRegistering(true);
    try {
      const { error } = await supabase.from('event_registrations').delete().eq('event_id', eventId).eq('user_id', user.id);
      if (error) {
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
      } else {
        setStatus('none');
        setRegistrationCount(c => Math.max(0, c - 1));
        setOrgRegistrationCount(c => Math.max(0, c - 1));
        onRegistrationChange?.(false, Math.max(0, registrationCount - 1));
        toast({ title: invitationOnly ? 'Invitation request cancelled' : 'Registration cancelled' });
      }
    } catch (err) {
      toast({ title: 'Error', description: 'An unexpected error occurred.', variant: 'destructive' });
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
        <span className="text-sm">Checking registration...</span>
      </div>
    );
  }

  // Already registered
  if (status === 'registered') {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2.5 text-green-700 bg-green-50/80 backdrop-blur-sm border border-green-200 rounded-xl px-4 py-3 shadow-sm">
          <CheckCircle className="h-5 w-5" />
          <span className="font-medium">You are registered for this event</span>
        </div>

        {eventType === 'webinar' && eventMeetingUrl && (
          <Button asChild className="w-full bg-violet-600 hover:bg-violet-700 rounded-lg">
            <a href={eventMeetingUrl} target="_blank" rel="noopener noreferrer">
              <Video className="h-4 w-4 mr-2" />
              Join the webinar
            </a>
          </Button>
        )}

        {hasSchedule && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Add to calendar</p>
            <AddToCalendarButtons event={calendarEvent} />
          </div>
        )}

        <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg" onClick={handleCancel} disabled={registering}>
          {registering && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          Cancel Registration
        </Button>

        {/* Success popup shown immediately after registering */}
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent className="max-w-md rounded-2xl">
            <DialogHeader>
              <div className="mx-auto mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                <CheckCircle className="h-7 w-7 text-green-600" />
              </div>
              <DialogTitle className="text-center">You're registered!</DialogTitle>
              <DialogDescription className="text-center">
                {eventTitle
                  ? <>You're confirmed for <span className="font-medium text-gray-700">{eventTitle}</span>.</>
                  : 'Your registration is confirmed.'}
                {' '}Add it to your calendar so you don't miss it.
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
                  Join the webinar
                </a>
              </Button>
            )}

            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide text-center">Add to calendar</p>
              <AddToCalendarButtons event={calendarEvent} />
            </div>

            <Button variant="ghost" className="w-full" onClick={() => setConfirmOpen(false)}>
              Done
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
            <p className="font-semibold">Invitation Requested</p>
            <p className="text-sm mt-0.5 opacity-80">Your request is being reviewed. You will be notified once approved.</p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg" onClick={handleCancel} disabled={registering}>
          {registering && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          Cancel Request
        </Button>
      </div>
    );
  }

  // Exposition request status
  if (status.startsWith('expo_')) {
    const expoStatusMap: Record<string, { color: string; icon: typeof Clock; label: string; desc: string }> = {
      expo_pending: { color: 'bg-yellow-50/80 border-yellow-200 text-yellow-800', icon: Clock, label: 'Exposition Request Pending', desc: 'Your request to exhibit is being reviewed.' },
      expo_approved: { color: 'bg-blue-50/80 border-blue-200 text-blue-800', icon: CheckCircle, label: 'Exposition Approved', desc: 'Your request has been approved. You will receive an invoice shortly.' },
      expo_invoice_sent: { color: 'bg-indigo-50/80 border-indigo-200 text-indigo-800', icon: AlertCircle, label: 'Invoice Sent', desc: 'Please complete the payment to confirm your exhibition spot.' },
      expo_paid: { color: 'bg-green-50/80 border-green-200 text-green-800', icon: CheckCircle, label: 'Exhibition Confirmed', desc: 'Your payment has been confirmed. You are registered as an exhibitor.' },
      expo_rejected: { color: 'bg-red-50/80 border-red-200 text-red-800', icon: AlertCircle, label: 'Request Rejected', desc: 'Your exhibition request was not approved. Contact Smart Marina Connect for details.' },
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
              Register (Included in {TIER_LABELS[orgTier]})
            </Button>
            <p className="text-xs text-gray-500">
              Your sponsorship includes access to invitation-only events.
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
          Request Invitation
        </Button>
        <p className="text-xs text-gray-500">
          This event requires an invitation. Submit a request and you will be notified once approved.
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
          Choose a Package
        </Button>

        <Dialog open={packageSelectOpen} onOpenChange={setPackageSelectOpen}>
          <DialogContent className="max-w-md rounded-2xl">
            <DialogHeader>
              <DialogTitle>Select a Registration Package</DialogTitle>
              <DialogDescription>Choose your preferred registration package for this event.</DialogDescription>
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
                        <p className="text-xs text-gray-400">{pkg.max_seats} seats available</p>
                      )}
                    </div>
                    <div className="text-right">
                      <span className="text-lg font-bold text-primary">{formatPrice(pkg.price_cents)}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}

              {/* Also offer marina-specific options if applicable */}
              {isMarina && (
                <Card
                  className="cursor-pointer hover:border-primary hover:shadow-md transition-all duration-200 rounded-xl"
                  onClick={() => {
                    setPackageSelectOpen(false);
                    submitExpositionRequest();
                  }}
                >
                  <CardContent className="flex items-center gap-4 p-4">
                    <div className="bg-amber-100 rounded-xl p-3">
                      <Ship className="h-6 w-6 text-amber-700" />
                    </div>
                    <div>
                      <h3 className="font-semibold">Exhibitor</h3>
                      <p className="text-sm text-gray-600">Request an exhibition spot. Subject to approval.</p>
                    </div>
                  </CardContent>
                </Card>
              )}
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
              <p className="font-semibold">Included seats exhausted</p>
              <p className="text-sm mt-0.5 opacity-80">
                All {maxSeats} included seat(s) for your {TIER_LABELS[orgTier]} package are used.
                Contact Smart Marina Connect for additional seats.
              </p>
            </div>
          </div>
        ) : (
          <>
            <Button onClick={() => registerDirect('sponsor_included')} disabled={registering} className="rounded-xl shadow-sm">
              {registering && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Register (Included in {TIER_LABELS[orgTier]})
            </Button>
            <p className="text-xs text-gray-500">
              Your sponsorship includes event access.
              {maxSeats != null && (
                <span className="ml-1">
                  <Users className="h-3 w-3 inline mr-0.5" />
                  {orgRegistrationCount} / {maxSeats} seats used
                </span>
              )}
            </p>
          </>
        )}
      </div>
    );
  }

  // Marina (non-sponsor, no packages): choice between visitor and exhibitor
  if (isMarina) {
    return (
      <>
        <Button onClick={() => setMarinaChoiceOpen(true)} disabled={registering} className="w-full sm:w-auto rounded-xl shadow-sm">
          {registering && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          Register for this Event
        </Button>

        <Dialog open={marinaChoiceOpen} onOpenChange={setMarinaChoiceOpen}>
          <DialogContent className="max-w-md rounded-2xl">
            <DialogHeader>
              <DialogTitle>How would you like to participate?</DialogTitle>
              <DialogDescription>Choose your participation type for this event.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 mt-2">
              <Card className="cursor-pointer hover:border-primary hover:shadow-md transition-all duration-200 rounded-xl" onClick={() => { setMarinaChoiceOpen(false); registerDirect('visitor'); }}>
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="bg-blue-100 rounded-xl p-3">
                    <Eye className="h-6 w-6 text-blue-700" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Visitor</h3>
                    <p className="text-sm text-gray-600">Attend the event as a visitor. Subject to approval.</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="cursor-pointer hover:border-primary hover:shadow-md transition-all duration-200 rounded-xl" onClick={() => { setMarinaChoiceOpen(false); submitExpositionRequest(); }}>
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="bg-amber-100 rounded-xl p-3">
                    <Ship className="h-6 w-6 text-amber-700" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Exhibitor</h3>
                    <p className="text-sm text-gray-600">Request an exhibition spot. Subject to approval.</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // Member with discount
  if (isPartner && orgTier === 'member') {
    const discount = pricing?.discount_pct || 10;
    return (
      <div className="space-y-2">
        <Button onClick={() => registerDirect('member_discount')} disabled={registering} className="rounded-xl shadow-sm">
          {registering && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          Register (Member Rate)
        </Button>
        <p className="text-xs text-gray-500">{discount}% member discount. Subject to approval — payment details will follow.</p>
      </div>
    );
  }

  // Default: basic registration
  return (
    <Button onClick={() => registerDirect('visitor')} disabled={registering} className="rounded-xl shadow-sm">
      {registering && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
      Register for this Event
    </Button>
  );
}
