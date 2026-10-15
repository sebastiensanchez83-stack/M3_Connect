import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Loader2, Mail, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { AUTH_FIELD_ERROR, AuthInput, AuthLabel, AuthNotice, FieldError, FieldHint, PasswordInput } from '@/components/auth/fields';
import { CountryField, SectorChips, STICKY_ACTIONS, TypeCards, canonicalCountry } from '@/components/auth/signupParts';
import { CompanyPicker, EMPTY_CHOICE, intentOf, type CompanyChoice } from '@/components/organization/CompanyPicker';
import { Turnstile, useTurnstile } from '@/components/security/Turnstile';
import { signUpErrorMessage, isRateLimited } from '@/lib/authErrors';
import {
  EMAIL_RE, PASSWORD_MIN, isSignupType, notifyExisting, passwordProblem, sendEmailProof, signUpAccount,
  type SignupIntent, type SignupType,
} from '@/lib/accountSignup';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

/**
 * The account sign-up v2 (flag account_signup_v2; spec regspec-en.md §6
 * /signup/account; Victor 8 Oct 2026: "Sign up" opens this form directly, in the
 * sign-up window and as the /signup page).
 *
 *  Step 1, You: first name, last name, work e-mail, password (at least 10
 *  characters, show / hide), the terms.
 *  Step 2, Your profile: the six type cards; for a company type the company
 *  (CompanyPicker: pick a listed one, or create one with its website and country,
 *  or a company code); for "No company" an optional organisation; job title,
 *  country, up to five sectors.
 *  Then "Check your inbox".
 *
 * Nothing about the company is created here: the intent rides on the sign-up and
 * the database runs it once the address is proven (M3 reviews every person and
 * every company; joining a listed company goes to its owner). The answer is the
 * same whether or not the address already has an account (notify_existing e-mails
 * that account instead).
 *
 * `then` (a path on this site, e.g. /register/<slug>) is where the confirmation
 * link continues, and where "Continue" goes when the account is signed in at once
 * (Confirm email off). `initialEmail` / `initialCode` come from a claim e-mail
 * (?email=&code=).
 */

const RESEND_COOLDOWN_S = 60;

type Done =
  | { kind: 'inbox'; email: string; via: 'confirmation' | 'existing'; redirectTo: string }
  | { kind: 'signed_in'; email: string; proofSent: boolean };

export function AccountSignup({
  variant,
  initialType,
  then,
  initialEmail = '',
  initialCode = '',
  onFinished,
}: {
  variant: 'dialog' | 'page';
  initialType?: string | null;
  /** Where to continue after the account exists (a safe path). Default: the member home. */
  then?: string | null;
  initialEmail?: string;
  initialCode?: string;
  /** Signed in at once (Confirm email off) and "Continue" pressed: go to `dest`. */
  onFinished?: (dest: string) => void;
}) {
  const { t } = useTranslation();
  const captcha = useTurnstile();
  const [step, setStep] = useState<1 | 2>(1);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [terms, setTerms] = useState(false);
  // A claim code says nothing about the kind of company: the person always chooses the card.
  const [type, setType] = useState<SignupType | null>(isSignupType(initialType) ? initialType : null);
  const [choice, setChoice] = useState<CompanyChoice>(EMPTY_CHOICE);
  const [code, setCode] = useState(initialCode);
  const [affiliation, setAffiliation] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [country, setCountry] = useState('');
  const [sectors, setSectors] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  const dest = then || '/';
  const company = type !== null && type !== 'participant';

  // Each new step starts at its top (step 1 was scrolled down in a phone's window). Not on the first paint.
  const shown = useRef(false);
  useEffect(() => {
    if (!shown.current) { shown.current = true; return; }
    topRef.current?.scrollIntoView({ block: 'nearest' });
  }, [step, done]);

  const clearError = (key: string) => setErrors((e) => {
    if (!(key in e)) return e;
    const next = { ...e };
    delete next[key];
    return next;
  });

  const validateStep1 = (): boolean => {
    const e: Record<string, string> = {};
    if (!firstName.trim()) e.firstName = t('signupV2.err.firstName', 'Please enter your first name.');
    if (!lastName.trim()) e.lastName = t('signupV2.err.lastName', 'Please enter your last name.');
    if (!EMAIL_RE.test(email.trim())) e.email = t('signupV2.err.email', 'Please enter a valid e-mail address, like name@company.com.');
    const pw = passwordProblem(password);
    if (pw === 'short') e.password = t('signupV2.err.passwordShort', { min: PASSWORD_MIN, defaultValue: 'Choose a password of at least {{min}} characters.' });
    if (pw === 'long') e.password = t('signupV2.err.passwordLong', 'Password too long (max. 72 characters).');
    if (!terms) e.terms = t('auth.acceptTermsRequired', 'Please accept the Terms and Conditions to continue');
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const goStep2 = (ev: FormEvent) => {
    ev.preventDefault();
    if (validateStep1()) setStep(2);
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    const e: Record<string, string> = {};
    let intent: SignupIntent | null = { action: 'none' };
    if (!type) e.type = t('signupV2.err.type', 'Choose what describes you best.');
    else if (company) {
      intent = intentOf(choice, code);
      if (!intent) e.company = t('signupV2.err.company', 'Pick your company in the list, or create it.');
    }
    setErrors(e);
    if (Object.keys(e).length > 0 || !type || !intent) return;
    setFormError(null);
    setBusy(true);
    const out = await signUpAccount({
      email,
      password,
      firstName,
      lastName,
      type,
      jobTitle,
      country: canonicalCountry(country),
      affiliation: type === 'participant' ? affiliation : '',
      sectorIds: sectors,
      intent,
      next: dest,
      captchaToken: captcha.token,
    });
    captcha.reset(); // a token works once, whatever the answer
    setBusy(false);
    const address = email.trim().toLowerCase();
    if (out.kind === 'error') {
      const weak = out.error.code === 'weak_password' || /password should|password is too/i.test(out.error.message || '');
      setFormError(weak
        ? t('signupV2.err.weak', { min: PASSWORD_MIN, defaultValue: 'This password is too weak or too common. Go back and choose a longer one (at least {{min}} characters), less easy to guess.' })
        : signUpErrorMessage(out.error, t));
      return;
    }
    if (out.kind === 'check_inbox') setDone({ kind: 'inbox', email: address, via: out.via, redirectTo: out.redirectTo });
    else setDone({ kind: 'signed_in', email: address, proofSent: out.proofSent });
  };

  if (done) return <div ref={topRef}><SignupDone done={done} onContinue={() => onFinished?.(dest)} /></div>;

  const stepLine = (
    <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-meta">
      {t('signupV2.stepOf', { n: step, total: 2, defaultValue: 'Step {{n}} of 2' })}
      {' · '}
      {step === 1 ? t('signupV2.step1', 'You') : t('signupV2.step2', 'Your profile')}
    </p>
  );

  if (step === 1) {
    return (
      <div ref={topRef}>
        <form onSubmit={goStep2} noValidate className="space-y-5">
          {stepLine}
          {variant === 'dialog' && (
            <p className="text-[15px] leading-6 text-meta">{t('signupV2.lead', 'Free. The M3 team checks every member, so everyone knows who they talk to.')}</p>
          )}
          {code && (
            <AuthNotice tone="success" title={t('signupV2.codeNotice', 'Your company code is noted')}>
              <p className="text-[13px]">{t('signupV2.codeNoticeBody2', 'The M3 team checks it with your sign-up. In the next step, just choose your profile.')}</p>
            </AuthNotice>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-3">
            <div className="space-y-2">
              <AuthLabel htmlFor="su-first">{t('authRefonte.signup.firstName', 'First name')} *</AuthLabel>
              <AuthInput id="su-first" autoComplete="given-name" value={firstName} onChange={(e) => { setFirstName(e.target.value); clearError('firstName'); }} aria-invalid={!!errors.firstName || undefined} className={errors.firstName ? AUTH_FIELD_ERROR : undefined} />
              {errors.firstName && <FieldError>{errors.firstName}</FieldError>}
            </div>
            <div className="space-y-2">
              <AuthLabel htmlFor="su-last">{t('authRefonte.signup.lastName', 'Last name')} *</AuthLabel>
              <AuthInput id="su-last" autoComplete="family-name" value={lastName} onChange={(e) => { setLastName(e.target.value); clearError('lastName'); }} aria-invalid={!!errors.lastName || undefined} className={errors.lastName ? AUTH_FIELD_ERROR : undefined} />
              {errors.lastName && <FieldError>{errors.lastName}</FieldError>}
            </div>
          </div>
          <div className="space-y-2">
            <AuthLabel htmlFor="su-email">{t('signupV2.email', 'Work e-mail')} *</AuthLabel>
            <AuthInput
              id="su-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => { setEmail(e.target.value); clearError('email'); }}
              placeholder={t('authRefonte.signup.workEmailPlaceholder', 'name@company.com')}
              aria-invalid={!!errors.email || undefined}
              className={errors.email ? AUTH_FIELD_ERROR : undefined}
            />
            {errors.email && <FieldError>{errors.email}</FieldError>}
          </div>
          <div className="space-y-2">
            <AuthLabel htmlFor="su-password">{t('authRefonte.signup.password', 'Password')} *</AuthLabel>
            <PasswordInput
              id="su-password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); clearError('password'); }}
              aria-invalid={!!errors.password || undefined}
              aria-describedby="su-password-hint"
              className={errors.password ? AUTH_FIELD_ERROR : undefined}
            />
            {errors.password
              ? <FieldError>{errors.password}</FieldError>
              : <FieldHint><span id="su-password-hint">{t('signupV2.passwordHint', { min: PASSWORD_MIN, defaultValue: 'At least {{min}} characters. A short sentence is easy to remember.' })}</span></FieldHint>}
          </div>
          <div className="space-y-2">
            <div className="flex items-start gap-3">
              <Checkbox id="su-terms" checked={terms} onCheckedChange={(c) => { setTerms(c === true); clearError('terms'); }} className="mt-0.5 h-5 w-5 border-checkbox" />
              <label htmlFor="su-terms" className="cursor-pointer text-sm leading-6 text-ink">
                {t('auth.acceptTerms', 'I accept the')}{' '}
                <UnderlineLink href="/terms" external arrow={false} className="!text-sm !leading-6">{t('auth.termsAndConditions', 'Terms and Conditions')}</UnderlineLink>{' '}
                {t('auth.andThe', 'and the')}{' '}
                <UnderlineLink href="/privacy" external arrow={false} className="!text-sm !leading-6">{t('auth.privacyPolicy', 'Privacy Policy')}</UnderlineLink>
              </label>
            </div>
            {errors.terms && <FieldError className="pl-8">{errors.terms}</FieldError>}
          </div>
          <div className={STICKY_ACTIONS}>
            <Button type="submit" variant="cta" className="w-full justify-between" data-help-avoid>
              {t('signupV2.continue', 'Continue')}
            </Button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div ref={topRef}>
      <form onSubmit={submit} noValidate className="space-y-6">
        <div className="flex items-center justify-between gap-3">
          {stepLine}
          <button
            type="button"
            onClick={() => { setStep(1); setFormError(null); }}
            className="-mr-1 inline-flex min-h-11 items-center gap-1 rounded px-1 text-sm font-medium text-meta transition-colors hover:text-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" /> {t('auth.back', 'Back')}
          </button>
        </div>

        <TypeCards
          value={type}
          onChange={(v) => { setType(v); clearError('type'); clearError('company'); }}
          legend={t('signupV2.typeLegend', 'Which describes you best?')}
          error={errors.type}
        />

        {company && (
          <CompanyPicker
            value={choice}
            onChange={(c) => { setChoice(c); clearError('company'); }}
            code={code}
            onCodeChange={(c) => { setCode(c); clearError('company'); }}
            idPrefix="su-company"
            error={errors.company}
          />
        )}
        {type === 'participant' && (
          <div className="space-y-2">
            <AuthLabel htmlFor="su-affiliation">{t('signupV2.affiliation', 'Organisation')} <span className="font-normal text-meta">{t('signupV2.optional', '(optional)')}</span></AuthLabel>
            <AuthInput id="su-affiliation" autoComplete="organization" value={affiliation} onChange={(e) => setAffiliation(e.target.value)} maxLength={200} />
            <FieldHint>{t('signupV2.affiliationHint', 'A school, an association, a public body… It does not create a company.')}</FieldHint>
          </div>
        )}

        {type && (
          <>
            <div className="space-y-2">
              <AuthLabel htmlFor="su-job">{t('authRefonte.signup.jobTitle', 'Job title')}</AuthLabel>
              <AuthInput id="su-job" autoComplete="organization-title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} maxLength={200} placeholder={t('authRefonte.signup.jobTitlePlaceholder', 'For example, operations manager')} />
            </div>
            <CountryField id="su-country" label={t('signupV2.country', 'Your country')} value={country} onChange={setCountry} />
            <SectorChips value={sectors} onChange={setSectors} />
          </>
        )}

        {formError && (
          <AuthNotice tone="error" role="alert">
            <p>{formError}</p>
          </AuthNotice>
        )}
        {captcha.active && <Turnstile captcha={captcha} action="signup" />}
        <div className={STICKY_ACTIONS}>
          <Button type="submit" variant="cta" className="w-full justify-between" disabled={busy || (captcha.active && captcha.waiting)} data-help-avoid>
            {busy ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t('auth.creating', 'Creating...')}</> : t('signupV2.create', 'Create my account')}
          </Button>
        </div>
        <FieldHint className="text-center">{t('signupV2.reviewNote', 'Free. The M3 team checks each new account, usually within 2 working days.')}</FieldHint>
      </form>
    </div>
  );
}

/** "Check your inbox", the same words whether or not the address already had an account. */
function SignupDone({ done, onContinue }: { done: Done; onContinue: () => void }) {
  const { t } = useTranslation();
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<'sent' | 'error' | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const resend = async () => {
    if (sending || cooldown > 0) return;
    setSending(true);
    setFeedback(null);
    let ok = false;
    if (done.kind === 'signed_in') {
      const res = await sendEmailProof();
      ok = res.ok;
    } else if (done.via === 'existing') {
      await notifyExisting(done.email);
      ok = true;
    } else {
      try {
        const { error } = await supabase.auth.resend({ type: 'signup', email: done.email, options: { emailRedirectTo: done.redirectTo } });
        ok = !error;
        if (error && import.meta.env.DEV) console.error('Confirmation resend error:', isRateLimited(error) ? 'too soon' : error.message);
      } catch {
        ok = false;
      }
    }
    setSending(false);
    setFeedback(ok ? 'sent' : 'error');
    setCooldown(RESEND_COOLDOWN_S);
  };

  const resendButton = (
    <div className="space-y-2">
      <Button type="button" variant="ctaOutline" arrow={false} roll={false} className="w-full" disabled={sending || cooldown > 0} onClick={resend}>
        {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        {cooldown > 0
          ? t('auth.resendEmailIn', 'Resend the e-mail ({{seconds}} s)', { seconds: cooldown })
          : t('auth.resendEmail', 'Resend the e-mail')}
      </Button>
      {feedback === 'sent' && <p className="text-center text-sm text-teal-text" role="status">{t('auth.resendEmailSent', 'A new e-mail is on its way.')}</p>}
      {feedback === 'error' && <p className="text-center text-sm text-red-700" role="alert">{t('auth.resendEmailError', "We couldn't send the e-mail just now. Please wait a minute and try again.")}</p>}
    </div>
  );

  if (done.kind === 'signed_in') {
    return (
      <div className="space-y-5">
        <span aria-hidden="true" className="grid h-14 w-14 place-items-center rounded-full bg-foam text-teal-text"><MailCheck className="h-7 w-7" /></span>
        <div className="space-y-1.5">
          <Eyebrow as="p">{t('signupV2.done.created', 'Your account is created')}</Eyebrow>
          <h3 className="text-h3 text-navy">{t('signupV2.done.confirmTitle', 'Confirm your e-mail address')}</h3>
        </div>
        {done.proofSent ? (
          <p className="text-sm leading-6 text-ink">
            {t('signupV2.done.proofSentPlain', { email: done.email, defaultValue: 'We sent a link to {{email}}. Open it on this phone or computer, where you are signed in. Then the M3 team reviews your account. Nothing after a few minutes? Check your spam folder.' })}
          </p>
        ) : (
          <AuthNotice tone="warning">
            <p>{t('signupV2.done.proofNotSent', "We couldn't send the confirmation e-mail just now. Ask for it below, or later from your dashboard.")}</p>
          </AuthNotice>
        )}
        {resendButton}
        <div className={STICKY_ACTIONS}>
          <Button type="button" variant="cta" className="w-full justify-between" onClick={onContinue} data-help-avoid>
            {t('signupV2.done.continue', 'Continue')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 text-center" role="status">
      <span aria-hidden="true" className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-foam text-teal-text"><Mail className="h-7 w-7" /></span>
      <div className="space-y-1.5">
        <h3 className="text-h3 text-navy">{t('auth.checkInboxTitle', 'Check your inbox')}</h3>
        <p className="text-sm text-meta">{t('signupV2.done.sentTo', 'We sent an e-mail to:')}</p>
        <p className="break-all text-sm font-semibold text-navy">{done.email}</p>
      </div>
      <p className="text-sm leading-6 text-ink">
        {t('signupV2.done.openLink', 'Open the link in it to confirm your address. It asks for your password once more, then the M3 team reviews your account.')}
      </p>
      <p className={cn('text-[13px] leading-5 text-meta')}>
        {t('signupV2.done.existing', 'Already have an account with this address? The e-mail tells you how to sign in instead. Nothing after a few minutes? Check your spam folder.')}
      </p>
      {resendButton}
    </div>
  );
}
