import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CalendarDays, Loader2, LogIn, MailCheck, UserPlus, Video } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { AuthInput, AuthLabel, AuthNotice, FieldError, OrDivider } from '@/components/auth/fields';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { Turnstile, useTurnstile } from '@/components/security/Turnstile';
import { registerForEvent, registrationErrorText, type RegForm } from '@/lib/registration';
import { cn } from '@/lib/utils';
import { EMAIL_RE, ruleOf } from './IdentityBlock';
import { regLocale, whenLine } from './RegistrationUI';

/**
 * A webinar, signed out (Victor, 6 Oct 2026: "not signed in → choose to sign up
 * or not; without an account only full name, e-mail, company (optional)").
 *
 * One window with the three ways in: register without an account (first name,
 * last name, e-mail, company, the terms), sign in, or create an account. On a
 * phone it fills the screen. The answer is the same whether the address was
 * already registered or not: "check your inbox".
 */
export function QuickWebinarSheet({
  open,
  onOpenChange,
  form,
  waitlist,
  onSignIn,
  onSignUp,
  onRegistered,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: RegForm;
  /** The webinar is full: this joins the waiting list. */
  waitlist: boolean;
  onSignIn: () => void;
  onSignUp: () => void;
  onRegistered?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = regLocale(i18n.language);
  const ev = form.event;
  const companyRule = ruleOf(form.fields, 'company');
  const [v, setV] = useState({ first_name: '', last_name: '', email: '', company: '' });
  const [terms, setTerms] = useState(false);
  const [honeypot, setHoneypot] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const captcha = useTurnstile();

  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setV((cur) => ({ ...cur, [k]: e.target.value }));
    if (errors[k]) setErrors((x) => { const n = { ...x }; delete n[k]; return n; });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFailure(null);
    const need = t('reg.field.required', 'Please fill this in.');
    const errs: Record<string, string> = {};
    if (!v.first_name.trim()) errs.first_name = need;
    if (!v.last_name.trim()) errs.last_name = need;
    if (!EMAIL_RE.test(v.email.trim())) errs.email = t('reg.field.emailInvalid', 'Please enter a valid e-mail address, like name@company.com.');
    if (companyRule === 'required' && !v.company.trim()) errs.company = need;
    if (!terms) errs.terms = t('reg.confirm.termsNeeded', 'Please accept the terms to send your registration.');
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSending(true);
    const email = v.email.trim().toLowerCase();
    const res = await registerForEvent({ slug: ev.slug }, {
      first_name: v.first_name.trim(),
      last_name: v.last_name.trim(),
      email,
      ...(companyRule !== 'hidden' && v.company.trim() ? { company: v.company.trim() } : {}),
      consents: { terms: true },
      source_detail: { entry: 'event_page', ref: 'quick' },
      website: honeypot,
      captcha: captcha.token,
    });
    setSending(false);
    captcha.reset();
    if (res.ok) {
      setSentTo(email);
      onRegistered?.();
      return;
    }
    setFailure(registrationErrorText(t, res));
  };

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o && sentTo) {
      // A second registration from the same window starts from a blank form.
      setSentTo(null);
      setV({ first_name: '', last_name: '', email: '', company: '' });
      setTerms(false);
    }
  };

  const field = (k: keyof typeof v, label: string, props: { type?: string; autoComplete: string; inputMode?: 'email' | 'text' }, required = true) => (
    <div className="space-y-1.5">
      <AuthLabel htmlFor={`qw-${k}`}>
        {label}
        {required ? <span aria-hidden="true" className="text-red-700"> *</span> : <span className="font-normal text-meta"> {t('reg.field.optional', '(optional)')}</span>}
      </AuthLabel>
      <AuthInput
        id={`qw-${k}`}
        value={v[k]}
        onChange={set(k)}
        type={props.type ?? 'text'}
        autoComplete={props.autoComplete}
        inputMode={props.inputMode}
        aria-invalid={!!errors[k]}
        aria-describedby={errors[k] ? `qw-${k}-err` : undefined}
        className={cn(errors[k] && 'border-red-700')}
        maxLength={k === 'email' ? 200 : k === 'company' ? 160 : 80}
      />
      {errors[k] && <FieldError id={`qw-${k}-err`}>{errors[k]}</FieldError>}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className={cn(
          // A full-screen sheet on phones, a centred window from 640 px.
          'left-0 top-0 h-[100dvh] max-h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 gap-0 overflow-y-auto rounded-none border-0 bg-white p-0',
          'sm:left-[50%] sm:top-[50%] sm:h-auto sm:max-h-[92vh] sm:w-[calc(100%-2rem)] sm:max-w-lg sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-card sm:shadow-drawer',
        )}
      >
        <div className="px-5 pb-8 pt-6 sm:px-8">
          <Eyebrow>{waitlist ? t('reg.quick.eyebrowWaitlist', 'Waiting list') : t('reg.quick.eyebrow', 'Webinar')}</Eyebrow>
          <DialogTitle className="mt-3 pr-8 text-h3 text-navy">
            {waitlist ? t('reg.quick.titleWaitlist', 'Join the waiting list') : t('reg.quick.title', 'Register for this webinar')}
          </DialogTitle>
          <DialogDescription className="mt-2 space-y-1 text-[15px] leading-6 text-meta">
            <span className="block font-semibold text-navy [overflow-wrap:anywhere]">{ev.title}</span>
            <span className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
              {whenLine(ev.starts_at, ev.ends_at, locale, t('reg.dateTbd', 'Date to be announced'))}
            </span>
            <span className="flex items-center gap-2">
              <Video className="h-4 w-4 shrink-0" aria-hidden="true" />
              {t('reg.quick.online', 'Online: the joining link comes by e-mail')}
            </span>
          </DialogDescription>

          {sentTo ? (
            <div className="mt-6 space-y-5">
              <AuthNotice tone="success" role="status" icon={<MailCheck className="h-4 w-4" />} title={t('reg.quick.doneTitle', 'Thank you. Check your inbox')}>
                <p>{waitlist
                  ? t('reg.quick.doneWaitlist', { email: sentTo, defaultValue: 'We have sent the details to {{email}}. We will write again as soon as a place frees up.' })
                  : t('reg.quick.done', { email: sentTo, defaultValue: 'We have sent the details to {{email}}, with a calendar invitation and your personal link to manage your registration.' })}
                </p>
                <p className="text-meta">{t('reg.quick.spam', 'Nothing after 10 minutes? Look in your spam folder.')}</p>
              </AuthNotice>
              <div className="rounded-field border border-rule bg-page p-4">
                <p className="text-sm font-semibold leading-5 text-navy">{t('reg.quick.accountTitle', 'Find all your events in one place')}</p>
                <p className="mt-1 text-sm leading-5 text-meta">{t('reg.quick.accountBody', 'A free account keeps your registrations, replays and contacts together. M3 checks every new member.')}</p>
                <Button type="button" variant="outline" className="mt-3 h-10 rounded-pill border-navy/25 px-4 text-navy" onClick={() => { close(false); onSignUp(); }}>
                  <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />
                  {t('reg.quick.createAccount', 'Create my account')}
                </Button>
              </div>
              <Button type="button" variant="ctaNavy" arrow={false} className="w-full" onClick={() => close(false)}>
                {t('reg.close', 'Close')}
              </Button>
            </div>
          ) : (
            <>
              <form onSubmit={submit} noValidate className="mt-6 space-y-4">
                <p className="text-sm font-semibold leading-5 text-navy">{t('reg.quick.noAccount', 'No account needed')}</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  {field('first_name', t('reg.field.firstName', 'First name'), { autoComplete: 'given-name' })}
                  {field('last_name', t('reg.field.lastName', 'Last name'), { autoComplete: 'family-name' })}
                </div>
                {field('email', t('reg.field.email', 'E-mail'), { type: 'email', autoComplete: 'email', inputMode: 'email' })}
                {companyRule !== 'hidden' && field('company', t('reg.field.company', 'Company'), { autoComplete: 'organization' }, companyRule === 'required')}

                <label className={cn('flex cursor-pointer items-start gap-3 rounded-field border px-4 py-3 text-[15px] leading-6 text-ink', terms ? 'border-navy bg-foam' : errors.terms ? 'border-red-700' : 'border-checkbox')}>
                  <Checkbox
                    checked={terms}
                    onCheckedChange={(c) => { setTerms(c === true); if (errors.terms) setErrors((x) => { const n = { ...x }; delete n.terms; return n; }); }}
                    aria-invalid={!!errors.terms}
                    aria-describedby={errors.terms ? 'qw-terms-err' : undefined}
                    className="mt-0.5 h-5 w-5 border-checkbox"
                  />
                  <span>
                    {t('reg.confirm.termsBefore', 'I accept the')}{' '}
                    <Link to="/terms" target="_blank" className="font-semibold text-navy underline underline-offset-4">{t('reg.confirm.terms', 'terms of use')}</Link>{' '}
                    {t('reg.confirm.and', 'and the')}{' '}
                    <Link to="/privacy" target="_blank" className="font-semibold text-navy underline underline-offset-4">{t('reg.confirm.privacy', 'privacy policy')}</Link>.
                  </span>
                </label>
                {errors.terms && <FieldError id="qw-terms-err">{errors.terms}</FieldError>}

                <input type="text" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)}
                  className="absolute -left-[9999px] h-0 w-0 opacity-0" aria-hidden="true" />
                <Turnstile captcha={captcha} action="webinar-quick" />

                {failure && <AuthNotice tone="error" role="alert"><p>{failure}</p></AuthNotice>}

                <Button type="submit" variant="cta" className="w-full justify-between" disabled={sending || captcha.waiting} arrow={!sending} roll={!sending}>
                  {sending
                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />{t('reg.sending', 'Sending…')}</>
                    : waitlist ? t('reg.submit.waitlist', 'Join the waiting list') : t('reg.quick.submit', 'Register')}
                </Button>
              </form>

              <div className="mt-6 space-y-3">
                <OrDivider>{t('reg.or', 'or')}</OrDivider>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Button type="button" variant="outline" className="h-12 rounded-pill border-navy/25 text-navy" onClick={() => { close(false); onSignIn(); }}>
                    <LogIn className="mr-2 h-4 w-4" aria-hidden="true" />
                    {t('reg.signIn', 'Sign in')}
                  </Button>
                  <Button type="button" variant="outline" className="h-12 rounded-pill border-navy/25 text-navy" onClick={() => { close(false); onSignUp(); }}>
                    <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />
                    {t('reg.quick.createAccount', 'Create my account')}
                  </Button>
                </div>
                <p className="text-center text-[13px] leading-5 text-meta">
                  {t('reg.quick.signedInOneTap', 'Signed in, you register in one tap.')}
                </p>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
