import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle, Loader2, Mail, Video } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

interface LightweightWebinarSignupProps {
  eventId: string;
  eventTitle: string;
  onRegistered?: () => void;
}

/**
 * Lightweight webinar signup — allows anonymous guests to register for
 * public webinars with just first name, last name, email (and optional company).
 * No account creation required. Data is stored in event_registrations with
 * user_id = null and guest_* fields populated.
 *
 * RLS policy "Anonymous guests can register for public webinars" enforces
 * that this can only succeed for published, public, non-invitation-only webinars.
 */
export function LightweightWebinarSignup({ eventId, eventTitle, onRegistered }: LightweightWebinarSignupProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !validEmail(email)) {
      toast({ title: 'Please fill in all required fields with a valid email', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.from('event_registrations').insert({
        event_id: eventId,
        user_id: null,
        guest_first_name: firstName.trim(),
        guest_last_name: lastName.trim(),
        guest_email: email.trim().toLowerCase(),
        guest_company: company.trim() || null,
        registration_type: 'guest',
        payment_status: 'free',
      });
      if (error) {
        if (error.code === '23505') {
          toast({
            title: 'Already registered',
            description: 'This email is already signed up for this webinar.',
            variant: 'destructive',
          });
        } else {
          toast({ title: 'Signup failed', description: error.message, variant: 'destructive' });
        }
        return;
      }

      // Send confirmation email via edge function (best effort — don't block on failure)
      try {
        await supabase.functions.invoke('send-notification', {
          body: {
            type: 'guest_webinar_confirmation',
            guest_email: email.trim().toLowerCase(),
            guest_first_name: firstName.trim(),
            event_title: eventTitle,
          },
        });
      } catch {
        // Non-fatal — registration still succeeded
      }

      setDone(true);
      onRegistered?.();
      toast({
        title: 'You\'re signed up!',
        description: 'Check your email for webinar details.',
      });
    } catch (err) {
      toast({ title: 'Signup failed', description: 'An unexpected error occurred.', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2.5 text-green-700 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
          <CheckCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-sm">You're registered for this webinar</p>
            <p className="text-xs text-green-600 mt-0.5">We sent webinar details to {email}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-gray-600 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 mb-1">
        <Video className="h-4 w-4 text-blue-600 shrink-0" />
        <span>Quick signup — no account needed for public webinars</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="lws-fname" className="text-xs">First name *</Label>
          <Input
            id="lws-fname"
            value={firstName}
            onChange={e => setFirstName(e.target.value)}
            placeholder="John"
            required
            disabled={submitting}
            className="h-9"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="lws-lname" className="text-xs">Last name *</Label>
          <Input
            id="lws-lname"
            value={lastName}
            onChange={e => setLastName(e.target.value)}
            placeholder="Doe"
            required
            disabled={submitting}
            className="h-9"
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="lws-email" className="text-xs">Email *</Label>
        <Input
          id="lws-email"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@company.com"
          required
          disabled={submitting}
          className="h-9"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="lws-company" className="text-xs">Company (optional)</Label>
        <Input
          id="lws-company"
          value={company}
          onChange={e => setCompany(e.target.value)}
          placeholder="Your organization"
          disabled={submitting}
          className="h-9"
        />
      </div>

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Signing you up...
          </>
        ) : (
          <>
            <Mail className="h-4 w-4 mr-2" />
            Register for Webinar
          </>
        )}
      </Button>

      <p className="text-[11px] text-gray-400 text-center leading-relaxed">
        By registering, you agree to receive webinar-related emails from Smart Marina Connect.
        For full access to the platform, <span className="text-primary">create an account</span>.
      </p>
    </form>
  );
}
