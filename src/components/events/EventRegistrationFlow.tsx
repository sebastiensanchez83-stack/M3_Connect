import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, CheckCircle, Clock, AlertCircle, Ship, Eye, Users } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { OrgTier, isSponsorTier, TIER_LABELS } from '@/types/database';

interface EventRegistrationFlowProps {
  eventId: string;
  onRegistrationChange?: (isRegistered: boolean, count: number) => void;
}

type RegistrationStatus = 'none' | 'registered' | 'expo_pending' | 'expo_approved' | 'expo_invoice_sent' | 'expo_paid' | 'expo_rejected';

interface PricingConfig {
  price_cents: number;
  max_included_seats: number | null;
  additional_member_price_cents: number;
  discount_pct: number;
}

export function EventRegistrationFlow({ eventId, onRegistrationChange }: EventRegistrationFlowProps) {
  const { user, profile, organization, isVerified } = useAuth();

  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [status, setStatus] = useState<RegistrationStatus>('none');
  const [registrationCount, setRegistrationCount] = useState(0);
  const [marinaChoiceOpen, setMarinaChoiceOpen] = useState(false);
  const [pricing, setPricing] = useState<PricingConfig | null>(null);
  const [orgRegistrationCount, setOrgRegistrationCount] = useState(0);

  const isMarina = organization?.organization_type === 'marina';
  const isPartner = organization?.organization_type === 'partner' || organization?.organization_type === 'media_partner';
  const orgTier = (organization?.tier || 'member') as OrgTier;
  const isSponsor = isSponsorTier(orgTier);

  const checkStatus = useCallback(async () => {
    if (!user || !eventId) return;
    setLoading(true);

    try {
      // Run all queries individually to avoid Promise.all misalignment
      const regRes = await supabase
        .from('event_registrations').select('id')
        .eq('event_id', eventId).eq('user_id', user.id).maybeSingle();

      const countRes = await supabase
        .from('event_registrations').select('*', { count: 'exact', head: true })
        .eq('event_id', eventId);

      setRegistrationCount(countRes.count || 0);

      // Fetch pricing for this tier
      const pricingRes = await supabase
        .from('event_pricing').select('price_cents, max_included_seats, additional_member_price_cents, discount_pct')
        .eq('event_id', eventId).eq('tier', orgTier).maybeSingle();

      if (pricingRes.data) {
        setPricing(pricingRes.data as PricingConfig);
      }

      // Org-specific queries (only if user has an org)
      if (organization?.id) {
        // Expo request check
        const expoRes = await supabase
          .from('exposition_requests').select('id, status')
          .eq('event_id', eventId).eq('organization_id', organization.id).maybeSingle();

        // Org registration count
        const orgCountRes = await supabase
          .from('event_registrations').select('*', { count: 'exact', head: true })
          .eq('event_id', eventId).eq('organization_id', organization.id);

        setOrgRegistrationCount(orgCountRes.count || 0);

        if (regRes.data) {
          setStatus('registered');
        } else if (expoRes.data) {
          const expoStatus = expoRes.data.status as string;
          const statusMap: Record<string, RegistrationStatus> = {
            pending: 'expo_pending',
            approved: 'expo_approved',
            invoice_sent: 'expo_invoice_sent',
            paid: 'expo_paid',
            rejected: 'expo_rejected',
          };
          setStatus(statusMap[expoStatus] || 'none');
        } else {
          setStatus('none');
        }
      } else {
        // No org — just check direct registration
        setStatus(regRes.data ? 'registered' : 'none');
      }
    } catch (err) {
      console.error('Error checking registration status:', err);
    }
    setLoading(false);
  }, [user, eventId, organization?.id, orgTier]);

  useEffect(() => { checkStatus(); }, [checkStatus]);

  // Simple registration (for sponsors with included seats or basic registration)
  const registerDirect = async (type: string) => {
    if (!user || !eventId) return;

    // Sponsor quota check
    if (type === 'sponsor_included' && pricing?.max_included_seats != null) {
      if (orgRegistrationCount >= pricing.max_included_seats) {
        toast({
          title: 'Included seats exhausted',
          description: `Your ${TIER_LABELS[orgTier]} package includes ${pricing.max_included_seats} seat(s). All included seats are used. Contact M3 for additional seats.`,
          variant: 'destructive',
        });
        return;
      }
    }

    setRegistering(true);
    try {
      const { error } = await supabase.from('event_registrations').insert({
        event_id: eventId,
        user_id: user.id,
        organization_id: organization?.id || null,
        registration_type: type,
        payment_status: type === 'sponsor_included' ? 'free' : 'pending_invoice',
        registered_by: user.id,
      });
      if (error) {
        toast({ title: 'Registration failed', description: error.message, variant: 'destructive' });
      } else {
        setStatus('registered');
        setRegistrationCount(c => c + 1);
        setOrgRegistrationCount(c => c + 1);
        onRegistrationChange?.(true, registrationCount + 1);
        toast({
          title: type === 'sponsor_included'
            ? 'Registered (included in your sponsorship)'
            : 'Registration request submitted',
          description: type !== 'sponsor_included'
            ? 'You will receive an invoice from M3 Monaco.'
            : undefined,
        });
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
          description: 'M3 will review your request and contact you.',
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
        toast({ title: 'Registration cancelled' });
      }
    } catch (err) {
      toast({ title: 'Error', description: 'An unexpected error occurred.', variant: 'destructive' });
    } finally {
      setRegistering(false);
    }
  };

  // Not logged in or not verified
  if (!user || !profile || !isVerified) {
    return null; // Parent component handles login/verification prompt
  }

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
        <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg" onClick={handleCancel} disabled={registering}>
          {registering && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          Cancel Registration
        </Button>
      </div>
    );
  }

  // Exposition request status
  if (status.startsWith('expo_')) {
    const expoStatusMap: Record<string, { color: string; icon: typeof Clock; label: string; desc: string }> = {
      expo_pending: { color: 'bg-yellow-50/80 border-yellow-200 text-yellow-800', icon: Clock, label: 'Exposition Request Pending', desc: 'Your request to exhibit is being reviewed by M3.' },
      expo_approved: { color: 'bg-blue-50/80 border-blue-200 text-blue-800', icon: CheckCircle, label: 'Exposition Approved', desc: 'Your request has been approved. You will receive an invoice shortly.' },
      expo_invoice_sent: { color: 'bg-indigo-50/80 border-indigo-200 text-indigo-800', icon: AlertCircle, label: 'Invoice Sent', desc: 'Please complete the payment to confirm your exhibition spot.' },
      expo_paid: { color: 'bg-green-50/80 border-green-200 text-green-800', icon: CheckCircle, label: 'Exhibition Confirmed', desc: 'Your payment has been confirmed. You are registered as an exhibitor.' },
      expo_rejected: { color: 'bg-red-50/80 border-red-200 text-red-800', icon: AlertCircle, label: 'Request Rejected', desc: 'Your exhibition request was not approved. Contact M3 for details.' },
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

  // --- Registration Flow by Profile Type ---

  // Sponsor check FIRST (even marina sponsors get sponsor benefits)
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
                Contact M3 for additional seats.
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

  // Marina (non-sponsor): choice between visitor and exhibitor
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
                    <p className="text-sm text-gray-600">Attend the event as a visitor. Invoice will be sent.</p>
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
                    <p className="text-sm text-gray-600">Request an exhibition spot (€1,400). Subject to approval.</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // Member classique or partner: register with pending invoice (discounted)
  if (isPartner && orgTier === 'member') {
    const discount = pricing?.discount_pct || 10;
    return (
      <div className="space-y-2">
        <Button onClick={() => registerDirect('member_discount')} disabled={registering} className="rounded-xl shadow-sm">
          {registering && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          Register (Member Rate)
        </Button>
        <p className="text-xs text-gray-500">{discount}% member discount applied. Invoice will be sent.</p>
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
