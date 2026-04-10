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
  const [inlineError, setInlineError] = useState<string | null>(null);

  const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setInlineError(null);
    if (!firstName.trim() || !lastName.trim() || !validEmail(email)) {
      setInlineError('Please fill in all required fields with a valid email.');
      toast({ title: 'Please fill in all required fields with a valid email', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      // Route through the guest-webinar-register edge function, which:
      //  - enforces per-IP + per-email rate limits
      //  - validates the event is an eligible public webinar
      //  - inserts the registration using the service role
      //  - sends a confirmation email with an .ics calendar attachment
      const { data, error } = await supabase.functions.invoke('guest-webinar-register', {
        body: {
          event_id: eventId,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          email: email.trim().toLowerCase(),
          company: company.trim() || null,
        },
      });

      if (error) {
        // Try to parse the structured error returned by the edge function
        // (supabase-js wraps 4xx/5xx into FunctionsHttpError)
        let code: string | undefined;
        let message = error.message || 'Signup failed';
        try {
          const ctx = (error as unknown as { context?: Response }).context;
          if (ctx && typeof ctx.json === 'function') {
            const payload = await ctx.json();
            if (payload?.error) message = payload.error;
            if (payload?.code) code = payload.code;
          }
        } catch {
          // ignore parse errors, fall back to generic message
        }

        if (code === 'DUPLICATE') {
          const msg = 'This email is already signed up for this webinar.';
          setInlineError(msg);
          toast({ title: 'Already registered', description: msg, variant: 'destructive' });
        } else if (code === 'RATE_LIMIT_IP' || code === 'RATE_LIMIT_EMAIL') {
          setInlineError(message);
          toast({ title: 'Too many attempts', description: message, variant: 'destructive' });
        } else {
          setInlineError(message);
          toast({ title: 'Signup failed', description: message, variant: 'destructive' });
        }
        return;
      }

      if (data && (data as { error?: string }).error) {
        const msg = String((data as { error?: string }).error);
        setInlineError(msg);
        toast({ title: 'Signup failed', description: msg, variant: 'destructive' });
        return;
      }

      setDone(true);
      onRegistered?.();
      toast({
        title: "You're signed up!",
        description: 'Check your email for webinar details and the calendar invite.',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
      setInlineError(message);
      toast({ title: 'Signup failed', description: message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };
  // eventTitle is kept in props for future use (passed to edge function for templates).
  void eventTitle;

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

      {inlineError && (
        <div role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {inlineError}
        </div>
      )}

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
