import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
      const msg = t('eventsShared.webinarSignup.fillRequired', 'Please fill in all required fields with a valid e-mail.');
      setInlineError(msg);
      toast({ title: msg, variant: 'destructive' });
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
        let status: number | undefined;
        // Raw server / supabase-js text is English-only: kept for dev logs, never shown.
        let serverMessage = error.message;
        try {
          const ctx = (error as unknown as { context?: Response }).context;
          if (ctx && typeof ctx.status === 'number') status = ctx.status;
          if (ctx && typeof ctx.json === 'function') {
            const payload = await ctx.json();
            if (payload?.error) serverMessage = payload.error;
            if (payload?.code) code = payload.code;
          }
        } catch {
          // ignore parse errors, fall back to generic message
        }
        if (import.meta.env.DEV) console.error('Guest webinar signup failed:', status, code, serverMessage);

        if (code === 'DUPLICATE') {
          const msg = t('eventsShared.webinarSignup.duplicate', 'This e-mail is already signed up for this webinar.');
          setInlineError(msg);
          toast({ title: t('eventsPage.alreadyRegistered', 'Already registered'), description: msg, variant: 'destructive' });
        } else if (code === 'RATE_LIMIT_IP' || code === 'RATE_LIMIT_EMAIL') {
          // The edge function's own wording, translated client-side per code.
          const msg = code === 'RATE_LIMIT_IP'
            ? t('eventsShared.webinarSignup.rateLimitIp', 'Too many signups from this network. Please try again later.')
            : t('eventsShared.webinarSignup.rateLimitEmail', 'This e-mail has reached the signup limit. Please try again later.');
          setInlineError(msg);
          toast({ title: t('eventsShared.webinarSignup.tooManyAttempts', 'Too many attempts'), description: msg, variant: 'destructive' });
        } else {
          // Other edge-function errors carry no code: translate by HTTP status.
          // No status (network / relay failure) falls through to the generic message.
          const msg = status === 404
            ? t('eventsPage.notFound', 'Event not found')
            : status === 403
              ? t('eventsShared.webinarSignup.notOpen', 'This event is not open for guest signup.')
              : status === 400
                ? t('eventsShared.webinarSignup.fillRequired', 'Please fill in all required fields with a valid e-mail.')
                : t('eventsPage.unexpectedError', 'An unexpected error occurred.');
          setInlineError(msg);
          toast({ title: t('eventsPage.registrationFailed', 'Registration failed'), description: msg, variant: 'destructive' });
        }
        return;
      }

      if (data && (data as { error?: string }).error) {
        if (import.meta.env.DEV) console.error('Guest webinar signup failed:', (data as { error?: string }).error);
        const msg = t('eventsPage.unexpectedError', 'An unexpected error occurred.');
        setInlineError(msg);
        toast({ title: t('eventsPage.registrationFailed', 'Registration failed'), description: msg, variant: 'destructive' });
        return;
      }

      setDone(true);
      onRegistered?.();
      toast({
        title: t('eventsShared.webinarSignup.successTitle', "You're signed up!"),
        description: t('eventsShared.webinarSignup.successDesc', 'Check your e-mail for webinar details and the calendar invite.'),
      });
    } catch (err) {
      if (import.meta.env.DEV) console.error('Guest webinar signup failed:', err);
      const message = t('eventsPage.unexpectedError', 'An unexpected error occurred.');
      setInlineError(message);
      toast({ title: t('eventsPage.registrationFailed', 'Registration failed'), description: message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };
  // eventTitle is kept in props for future use (passed to edge function for templates).
  void eventTitle;

  if (done) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2.5 rounded-field bg-foam px-4 py-3 text-navy">
          <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-teal" />
          <div>
            <p className="font-medium text-sm">{t('eventsShared.webinarSignup.registeredBanner', "You're registered for this webinar")}</p>
            <p className="mt-0.5 text-xs text-meta">{t('eventsShared.webinarSignup.sentTo', { email, defaultValue: 'We sent webinar details to {{email}}' })}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="mb-1 flex items-center gap-2 rounded-field bg-foam px-3 py-2 text-xs text-navy">
        <Video className="h-4 w-4 shrink-0 text-teal" />
        <span>{t('eventsShared.webinarSignup.quickSignup', 'Quick signup — no account needed for public webinars')}</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="lws-fname" className="text-xs">{t('auth.firstName', 'First Name')} *</Label>
          <Input
            id="lws-fname"
            value={firstName}
            onChange={e => setFirstName(e.target.value)}
            placeholder={t('auth.firstNamePlaceholder', 'John')}
            required
            disabled={submitting}
            className="h-9"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="lws-lname" className="text-xs">{t('auth.lastName', 'Last Name')} *</Label>
          <Input
            id="lws-lname"
            value={lastName}
            onChange={e => setLastName(e.target.value)}
            placeholder={t('auth.lastNamePlaceholder', 'Doe')}
            required
            disabled={submitting}
            className="h-9"
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="lws-email" className="text-xs">{t('auth.email', 'E-mail')} *</Label>
        <Input
          id="lws-email"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder={t('eventsShared.webinarSignup.emailPlaceholder', 'you@company.com')}
          required
          disabled={submitting}
          className="h-9"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="lws-company" className="text-xs">{t('eventsShared.webinarSignup.company', 'Company (optional)')}</Label>
        <Input
          id="lws-company"
          value={company}
          onChange={e => setCompany(e.target.value)}
          placeholder={t('eventsShared.webinarSignup.companyPlaceholder', 'Your organisation')}
          disabled={submitting}
          className="h-9"
        />
      </div>

      {inlineError && (
        <div role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {inlineError}
        </div>
      )}

      <Button type="submit" variant="cta" className="w-full justify-between" disabled={submitting}>
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            {t('eventsShared.webinarSignup.submitting', 'Signing you up...')}
          </>
        ) : (
          <>
            <Mail className="h-4 w-4 mr-2" />
            {t('eventsPage.registerWebinar', 'Register for this webinar')}
          </>
        )}
      </Button>

      <p className="text-center text-[11px] leading-relaxed text-meta">
        {t('eventsShared.webinarSignup.consent', 'By registering, you agree to receive webinar-related e-mails from Smart Marina Connect.')}
        {' '}{t('eventsShared.webinarSignup.fullAccess', 'For full access to the platform,')}{' '}
        <span className="text-primary">{t('eventsShared.webinarSignup.createAccount', 'create an account')}</span>.
      </p>
    </form>
  );
}
