import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { AUTH_FIELD_ERROR, AuthInput, AuthLabel, AuthNotice, FieldError, FieldHint, PasswordInput } from '@/components/auth/fields';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { PersonaType } from '@/types/database';
import { Checkbox } from '@/components/ui/checkbox';
import { Turnstile, useTurnstile } from '@/components/security/Turnstile';
import { Anchor, ArrowRight, Building2, Newspaper, Loader2, ChevronLeft, Info, HardHat, TrendingUp, Mail } from 'lucide-react';

interface SignupFormProps {
  onSuccess?: () => void;
  defaultPersona?: PersonaType;
}

// No password: claim-code-signup creates the account with a random one, and the
// person chooses theirs on /welcome once the address is confirmed.
type ClaimSignupBody = {
  email: string;
  first_name: string;
  last_name: string;
  persona: PersonaType;
  claim_code: string;
  lang: 'fr' | 'en';
};

// An account waiting for its activation link, and how to send that link again:
// 'auth' = a GoTrue signup (supabase.auth.resend), 'claim' = claim-code-signup,
// which re-sends the link when called again for a not-yet-confirmed account.
type PendingConfirmation =
  | { email: string; via: 'auth'; redirectTo: string }
  | { email: string; via: 'claim'; body: ClaimSignupBody };

// GoTrue and claim-code-signup both refuse a second confirmation mail to the
// same address within ~60 s.
const RESEND_COOLDOWN_S = 60;

// What claim-code-signup answers, on success and on error alike.
type ClaimSignupPayload = {
  success?: boolean;
  error?: string;
  code?: string; // 'already_exists' | 'too_soon' | 'email_send_failed' | 'invalid_code' | 'rate_limited'
  needs_confirmation?: boolean;
};

// supabase-js turns any non-2xx answer into a FunctionsHttpError and leaves `data`
// null, so the function's own JSON body has to be read off the response.
async function readFunctionPayload(error: unknown): Promise<ClaimSignupPayload | null> {
  try {
    const ctx = (error as { context?: Response } | null)?.context;
    if (ctx && typeof ctx.json === 'function') {
      const payload = await ctx.json();
      if (payload && typeof payload === 'object') return payload as ClaimSignupPayload;
    }
  } catch { /* not JSON */ }
  return null;
}

// The deployed v9 sends only the English text, the newer function also a code.
const isAlreadyExists = (payload: ClaimSignupPayload | null) =>
  payload?.code === 'already_exists' || !!payload?.error?.toLowerCase().includes('already exists');

const isInvalidCode = (payload: ClaimSignupPayload | null) =>
  payload?.code === 'invalid_code' || !!payload?.error?.toLowerCase().includes('invalid organization code');

// The organisation code in the address, but only on the link the "Send Connect
// Link" e-mail carries (send-notification org_claim_code):
// /?signup=true&email=…&code=…. Other pages use ?code= for other things
// (/sm26/claim?code=SM26-…, /sm26/open-score?code=…) and also show this form.
function readUrlClaimCode(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('signup') === 'true' ? params.get('code') : null;
}

// That code, or the one kept from it earlier in this tab. Read while the first
// render is built, so the password fields that path does without never flash up
// first.
function readIncomingClaimCode(): string | null {
  try {
    return readUrlClaimCode() || sessionStorage.getItem('pending_claim_code');
  } catch {
    return null;
  }
}

export function SignupForm({ onSuccess, defaultPersona }: SignupFormProps) {
  const { t, i18n } = useTranslation();
  const { signUp } = useAuth();
  // Cloudflare Turnstile: invisible unless a challenge is needed; off without a site key.
  const captcha = useTurnstile();
  const [step, setStep] = useState<1 | 2>(defaultPersona ? 2 : 1);
  const [loading, setLoading] = useState(false);
  const [selectedPersona, setSelectedPersona] = useState<PersonaType | ''>(defaultPersona || '');
  const [formData, setFormData] = useState({ firstName: '', lastName: '', email: '', jobTitle: '', companyName: '', companyWebsite: '', password: '', confirmPassword: '' });
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [detectedOrg, setDetectedOrg] = useState<{ id: string; name: string } | null>(null);
  const [errors, setErrors] = useState<{ passwordMismatch?: boolean; termsRequired?: boolean; passwordWeak?: boolean }>({});
  // Set: sign-up goes through claim-code-signup and asks for no password.
  const [incomingClaimCode, setIncomingClaimCode] = useState<string | null>(readIncomingClaimCode);
  const captchaOn = captcha.active && !incomingClaimCode;
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [mailSent, setMailSent] = useState(true);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resending, setResending] = useState(false);
  const [resendFeedback, setResendFeedback] = useState<'sent' | 'error' | 'active' | null>(null);

  // Count the resend cooldown down, one second at a time.
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  // Swap the form for the "check your inbox" panel. `sent` is false when the first
  // mail could not be sent; the button still waits out the cooldown, since a retry
  // inside it is refused anyway.
  const showCheckInbox = (pending: PendingConfirmation, sent = true) => {
    setPendingConfirmation(pending);
    setMailSent(sent);
    setResendFeedback(null);
    setResendCooldown(RESEND_COOLDOWN_S);
  };

  const handleResend = async () => {
    if (!pendingConfirmation || resending || resendCooldown > 0) return;
    setResending(true);
    setResendFeedback(null);
    let feedback: 'sent' | 'error' | 'active' = 'error';
    try {
      if (pendingConfirmation.via === 'claim') {
        const { data, error } = await supabase.functions.invoke('claim-code-signup', { body: pendingConfirmation.body });
        const payload: ClaimSignupPayload | null = error ? await readFunctionPayload(error) : data;
        if (!error && payload?.success) {
          feedback = 'sent';
        } else if (isAlreadyExists(payload)) {
          // Already confirmed in the meantime (link opened in another tab/device).
          feedback = 'active';
        } else {
          console.error('Claim-code resend error:', payload?.error || error?.message);
        }
      } else {
        const { error } = await supabase.auth.resend({
          type: 'signup',
          email: pendingConfirmation.email,
          options: { emailRedirectTo: pendingConfirmation.redirectTo },
        });
        if (!error) feedback = 'sent';
        else console.error('Signup resend error:', error.message);
      }
    } catch (err) {
      console.error('Resend error:', err);
    }
    setResending(false);
    setResendFeedback(feedback);
    if (feedback === 'sent') setMailSent(true);
    // A failure is usually the 60 s limit itself ("too soon"): wait it out too.
    if (feedback !== 'active') setResendCooldown(RESEND_COOLDOWN_S);
  };

  const validatePasswordStrength = (pwd: string) => {
    return pwd.length >= 8 && /[A-Z]/.test(pwd) && /[^A-Za-z0-9]/.test(pwd);
  };

  // Domain detection: check if an organization exists for this email domain
  // (Public/personal email domains are now allowed — no blacklist)
  const checkDomain = useCallback(async (email: string) => {
    if (!email.includes('@')) { setDetectedOrg(null); return; }
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) { setDetectedOrg(null); return; }

    // Check if organization already exists for this domain
    try {
      const { data } = await supabase
        .from('organizations')
        .select('id, name')
        .eq('primary_domain', domain)
        .maybeSingle();
      setDetectedOrg(data || null);
    } catch {
      setDetectedOrg(null);
    }
  }, []);

  // Debounced email domain check
  useEffect(() => {
    const timer = setTimeout(() => {
      if (formData.email) checkDomain(formData.email);
    }, 500);
    return () => clearTimeout(timer);
  }, [formData.email, checkDomain]);

  // Pre-fill email and claim code from URL params (from "Send Connect Link" email)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const emailParam = params.get('email');
    const codeParam = readUrlClaimCode();
    if (emailParam) {
      setFormData(prev => ({ ...prev, email: emailParam }));
      // Marina persona is most common for claim codes; auto-advance to step 2
      if (codeParam && !defaultPersona) {
        setSelectedPersona('marina');
        setStep(2);
      }
    }
    if (codeParam) {
      // Persist code so OnboardingPage can pre-fill it after email confirmation
      try { sessionStorage.setItem('pending_claim_code', codeParam); } catch { /* ignore */ }
      setIncomingClaimCode(codeParam);
    } else {
      // Check sessionStorage in case user refreshed
      try {
        const stored = sessionStorage.getItem('pending_claim_code');
        if (stored) setIncomingClaimCode(stored);
      } catch { /* ignore */ }
    }
  }, [defaultPersona]);

  const personas = [
    { value: 'marina' as PersonaType, icon: <Anchor className="h-6 w-6" />, title: t('auth.personaMarina'), desc: t('auth.personaMarinaDesc') },
    { value: 'partner' as PersonaType, icon: <Building2 className="h-6 w-6" />, title: t('auth.personaPartner'), desc: t('auth.personaPartnerDesc') },
    { value: 'media_partner' as PersonaType, icon: <Newspaper className="h-6 w-6" />, title: t('auth.personaMedia'), desc: t('auth.personaMediaDesc') },
    { value: 'developer' as PersonaType, icon: <HardHat className="h-6 w-6" />, title: t('auth.personaDeveloper', 'Developer'), desc: t('auth.personaDeveloperDesc', 'Marina developer, real-estate group or builder. Publish tenders and projects, and find service providers.') },
    { value: 'investor' as PersonaType, icon: <TrendingUp className="h-6 w-6" />, title: t('auth.personaInvestor', 'Investor'), desc: t('auth.personaInvestorDesc', 'Fund, family office or strategic investor. Browse marinas, start-ups and deal flow, and get in touch.') },
  ];

  const handlePersonaSelect = (persona: PersonaType) => {
    setSelectedPersona(persona);
    setStep(2);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPersona) return;
    if (!acceptTerms) {
      setErrors(prev => ({ ...prev, termsRequired: true }));
      toast({ title: t('auth.error'), description: t('auth.acceptTermsRequired', 'Please accept the Terms and Conditions to continue'), variant: 'destructive' });
      return;
    }
    // The claim-code path asks for no password (see below).
    const claimCode = incomingClaimCode;
    if (!claimCode && formData.password !== formData.confirmPassword) {
      setErrors(prev => ({ ...prev, passwordMismatch: true }));
      toast({ title: t('auth.error'), description: t('auth.passwordMismatch'), variant: 'destructive' });
      return;
    }
    if (!claimCode && !validatePasswordStrength(formData.password)) {
      setErrors(prev => ({ ...prev, passwordWeak: true }));
      toast({ title: t('auth.error'), description: t('auth.passwordWeak', 'Password must be at least 8 characters and include one uppercase letter and one symbol.'), variant: 'destructive' });
      return;
    }
    setLoading(true);
    // Validate company website URL format if provided
    if (formData.companyWebsite.trim()) {
      try {
        const url = formData.companyWebsite.trim().startsWith('http') ? formData.companyWebsite.trim() : `https://${formData.companyWebsite.trim()}`;
        new URL(url);
      } catch {
        toast({ title: t('auth.error'), description: t('auth.invalidWebsite'), variant: 'destructive' });
        setLoading(false);
        return;
      }
    }
    // Arrived through a claim-code link: sign up through claim-code-signup, which
    // e-mails the activation link itself. That link ends on /onboarding with the
    // code, where the organization is claimed once the address is confirmed,
    // never before. No password is asked for or sent on this path:
    // whoever fills in this form is not proven to own the address, and a password
    // they chose would keep working after the real owner confirmed it. The
    // function sets a random one; the person chooses theirs on /welcome, which
    // the activation link opens.
    if (claimCode) {
      const claimBody: ClaimSignupBody = {
        email: formData.email,
        first_name: formData.firstName.trim(),
        last_name: formData.lastName.trim(),
        persona: selectedPersona,
        claim_code: claimCode,
        lang: i18n.language?.startsWith('fr') ? 'fr' : 'en',
      };
      let claimPayload: ClaimSignupPayload | null = null;
      try {
        const { data: claimResult, error: claimError } = await supabase.functions.invoke('claim-code-signup', {
          body: claimBody,
        });
        claimPayload = claimError ? await readFunctionPayload(claimError) : claimResult;
        if (claimError && !claimPayload) console.error('Claim-code signup error:', claimError.message);
      } catch (err) {
        console.error('Claim-code signup error:', err);
      }
      setLoading(false);

      if (claimPayload?.needs_confirmation) {
        // The account exists and waits for its activation link: just sent (2xx),
        // sent under a minute ago (429 too_soon), or not sent (502
        // email_send_failed). The normal signup below must not run: with
        // "Confirm email" OFF, GoTrue would confirm this existing account with
        // no proof that the mailbox is theirs.
        showCheckInbox({ email: formData.email, via: 'claim', body: claimBody }, claimPayload.code !== 'email_send_failed');
        return;
      }
      if (isAlreadyExists(claimPayload)) {
        toast({ title: t('auth.error'), description: t('auth.accountAlreadyExists', 'An account with this e-mail already exists. Please log in instead.'), variant: 'destructive' });
        return;
      }
      if (isInvalidCode(claimPayload)) {
        // Not a code we know (any more). Drop it, from the address too so that
        // reopening the dialog cannot bring it back: the password fields come
        // back and the next submit is a normal sign-up. A code can still be
        // entered during onboarding.
        try { sessionStorage.removeItem('pending_claim_code'); } catch { /* ignore */ }
        try {
          const url = new URL(window.location.href);
          if (url.searchParams.has('code')) {
            url.searchParams.delete('code');
            window.history.replaceState(window.history.state, '', url.toString());
          }
        } catch { /* ignore */ }
        setIncomingClaimCode(null);
        toast({ title: t('auth.error'), description: t('auth.claimCodeInvalid', 'This invitation code is not valid. Choose a password below to create your account without it; you can still enter a code after signing up.'), variant: 'destructive' });
        return;
      }
      if (claimPayload?.code === 'rate_limited') {
        toast({ title: t('auth.error'), description: t('auth.claimSignupRateLimited', 'Too many attempts from this network. Please try again later.'), variant: 'destructive' });
        return;
      }
      // Anything else must not fall through to the normal sign-up: this path has
      // no password to give it. That includes the 400 "Email, password, and
      // claim_code are required" of the previous function (v9), which this page
      // gets until the new claim-code-signup is deployed.
      console.error('Claim-code signup failed:', claimPayload?.error);
      toast({ title: t('auth.error'), description: t('auth.claimSignupRetry', "We couldn't create your account just now. Please try again in a minute."), variant: 'destructive' });
      return;
    }

    // Normal signup path
    const { error, needsConfirmation, emailRedirectTo } = await signUp(formData.email, formData.password, selectedPersona, formData.firstName.trim(), formData.lastName.trim(), formData.companyName.trim(), formData.companyWebsite.trim(), detectedOrg?.id, formData.jobTitle.trim(), captcha.token);
    setLoading(false);
    captcha.reset(); // a token works once, whatever the answer
    if (error) {
      toast({ title: t('auth.error'), description: error.message, variant: 'destructive' });
    } else if (needsConfirmation) {
      // "Confirm email" ON: no session until the link is opened. onSuccess would
      // send callers to /onboarding, which bounces a signed-out visitor.
      showCheckInbox({ email: formData.email, via: 'auth', redirectTo: emailRedirectTo });
    } else {
      toast({ title: t('auth.signupSuccess'), description: t('auth.signupSuccessDesc') });
      onSuccess?.();
    }
  };

  if (pendingConfirmation) {
    return (
      <div className="space-y-5 text-center">
        <span aria-hidden="true" className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-foam text-teal-text">
          <Mail className="h-7 w-7" />
        </span>
        {mailSent ? (
          <>
            <div className="space-y-1.5">
              <h3 className="text-h3 text-navy">{t('auth.checkInboxTitle', 'Check your inbox')}</h3>
              <p className="text-sm text-meta">{t('auth.checkInboxSentTo', 'We sent an activation link to:')}</p>
              <p className="break-all text-sm font-semibold text-navy">{pendingConfirmation.email}</p>
            </div>
            <p className="text-sm leading-6 text-ink">
              {t('auth.checkInboxOpenLink', 'Open the link in that e-mail to activate your account. It stays inactive until you do.')}
            </p>
            <p className="text-[13px] leading-5 text-meta">
              {t('auth.checkInboxSpam', 'Nothing after a few minutes? Check your spam or junk folder. If you already have an account with this address, log in instead.')}
            </p>
          </>
        ) : (
          <>
            <div className="space-y-1.5">
              <h3 className="text-h3 text-navy">{t('auth.activateAccountTitle', 'Activate your account')}</h3>
              <p className="text-sm text-meta">{t('auth.checkInboxCreatedFor', 'Your account has been created for:')}</p>
              <p className="break-all text-sm font-semibold text-navy">{pendingConfirmation.email}</p>
            </div>
            <p className="text-sm leading-6 text-ink">
              {t('auth.checkInboxNotSent', "We couldn't send the activation e-mail just now. When the countdown ends, use the button below to send it, then open its link to activate your account.")}
            </p>
          </>
        )}
        {pendingConfirmation.via === 'claim' && (
          <p className="text-sm leading-6 text-ink">{t('auth.claimPasswordLater', 'You will choose your password after confirming your e-mail address.')}</p>
        )}
        <div className="space-y-2">
          <Button type="button" variant="ctaOutline" arrow={false} roll={false} className="w-full" disabled={resending || resendCooldown > 0} onClick={handleResend}>
            {resending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {resendCooldown > 0
              ? t('auth.resendEmailIn', 'Resend the e-mail ({{seconds}} s)', { seconds: resendCooldown })
              : t('auth.resendEmail', 'Resend the e-mail')}
          </Button>
          {resendFeedback === 'sent' && (
            <p className="text-sm text-teal-text" role="status">{t('auth.resendEmailSent', 'A new e-mail is on its way.')}</p>
          )}
          {resendFeedback === 'active' && (
            <p className="text-sm text-ink" role="status">{t('auth.resendAlreadyActive', 'This account is already activated. You can log in.')}</p>
          )}
          {resendFeedback === 'error' && (
            <p className="text-sm text-red-700" role="alert">{t('auth.resendEmailError', "We couldn't send the e-mail just now. Please wait a minute and try again.")}</p>
          )}
        </div>
      </div>
    );
  }

  if (step === 1) {
    return (
      <div className="space-y-4">
        <p className="text-[15px] leading-6 text-meta">{t('authRefonte.signup.selectPersona', 'Which best describes your organisation?')}</p>
        <div className="space-y-3">
          {personas.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => handlePersonaSelect(p.value)}
              className="group card-lift flex w-full items-center gap-4 rounded-card border border-rule bg-white p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-field bg-chip text-navy">{p.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-card-title text-navy">
                  <span className="card-ul">{p.title}</span>
                  <ArrowRight className="card-arrow" strokeWidth={2.25} aria-hidden="true" />
                </span>
                <span className="mt-0.5 block text-sm leading-5 text-meta">{p.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const selected = personas.find((p) => p.value === selectedPersona);

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <button
        type="button"
        onClick={() => setStep(1)}
        className="-ml-1 inline-flex items-center gap-1 rounded px-1 text-sm font-medium text-meta transition-colors hover:text-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" /> {t('auth.back')}
      </button>
      {incomingClaimCode && (
        <AuthNotice tone="success" icon={<Info className="h-4 w-4" />} title={t('auth.claimInviteTitle', "You've been invited to join an organisation")}>
          <p className="text-[13px]">
            {t('auth.claimInviteCodeLabel', 'Invitation code:')} <span className="font-mono font-semibold">{incomingClaimCode}</span>
          </p>
          <p className="text-[13px]">{t('auth.claimInviteApplied', 'It will be applied to your account automatically.')}</p>
        </AuthNotice>
      )}
      {selected && (
        <div className="flex items-center gap-3 rounded-field border border-rule bg-page p-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-field bg-chip text-navy">{selected.icon}</span>
          <div className="min-w-0">
            <div className="font-semibold text-navy">{selected.title}</div>
            <div className="text-[13px] leading-5 text-meta">{selected.desc}</div>
          </div>
        </div>
      )}
      <p className="text-[13px] leading-5 text-meta">{t('authRefonte.signup.required', 'Fields marked * are required.')}</p>

      <fieldset className="space-y-4">
        <legend className="mb-4"><Eyebrow as="span">{t('authRefonte.signup.aboutYou', 'About you')}</Eyebrow></legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-3">
          <div className="space-y-2">
            <AuthLabel htmlFor="firstName">{t('authRefonte.signup.firstName', 'First name')} *</AuthLabel>
            <AuthInput id="firstName" autoComplete="given-name" value={formData.firstName} onChange={(e) => setFormData({ ...formData, firstName: e.target.value })} required />
          </div>
          <div className="space-y-2">
            <AuthLabel htmlFor="lastName">{t('authRefonte.signup.lastName', 'Last name')} *</AuthLabel>
            <AuthInput id="lastName" autoComplete="family-name" value={formData.lastName} onChange={(e) => setFormData({ ...formData, lastName: e.target.value })} required />
          </div>
        </div>
        <div className="space-y-2">
          <AuthLabel htmlFor="jobTitle">{t('authRefonte.signup.jobTitle', 'Job title')}</AuthLabel>
          <AuthInput id="jobTitle" autoComplete="organization-title" value={formData.jobTitle} onChange={(e) => setFormData({ ...formData, jobTitle: e.target.value })} placeholder={t('authRefonte.signup.jobTitlePlaceholder', 'For example, operations manager')} />
        </div>
        <div className="space-y-2">
          <AuthLabel htmlFor="email">{t('authRefonte.signup.workEmail', 'Work email')} *</AuthLabel>
          <AuthInput id="email" type="email" autoComplete="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} required placeholder={t('authRefonte.signup.workEmailPlaceholder', 'name@company.com')} />
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-4"><Eyebrow as="span">{t('authRefonte.signup.yourOrganisation', 'Your organisation')}</Eyebrow></legend>
        {/* Reserved: "My company is already listed" (find the organisation in the directory and
            ask to join it) will sit here, above the two fields, once Victor decides on it.
            Until then a new organisation is always described below; the "company already
            exists" match runs at onboarding (create-company step). Domain auto-join was removed. */}
        <div className="space-y-2">
          <AuthLabel htmlFor="companyName">{t('authRefonte.signup.companyName', 'Company or organisation')} *</AuthLabel>
          <AuthInput id="companyName" autoComplete="organization" value={formData.companyName} onChange={(e) => setFormData({ ...formData, companyName: e.target.value })} required />
        </div>
        <div className="space-y-2">
          <AuthLabel htmlFor="companyWebsite">{t('authRefonte.signup.website', 'Website')}</AuthLabel>
          <AuthInput id="companyWebsite" type="url" autoComplete="url" value={formData.companyWebsite} onChange={(e) => setFormData({ ...formData, companyWebsite: e.target.value })} placeholder={t('authRefonte.signup.websitePlaceholder', 'https://www.example.com')} />
        </div>
      </fieldset>

      {incomingClaimCode ? (
        <p className="flex items-start gap-2 text-sm leading-6 text-meta">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t('auth.claimPasswordLater', 'You will choose your password after confirming your e-mail address.')}
        </p>
      ) : (
        <fieldset className="space-y-4">
          <legend className="mb-4"><Eyebrow as="span">{t('authRefonte.signup.yourPassword', 'Your password')}</Eyebrow></legend>
          <div className="space-y-2">
            <AuthLabel htmlFor="password">{t('authRefonte.signup.password', 'Password')} *</AuthLabel>
            <PasswordInput
              id="password"
              autoComplete="new-password"
              value={formData.password}
              onChange={(e) => {
                const pwd = e.target.value;
                setFormData({ ...formData, password: pwd });
                if (pwd.length > 0) {
                  setErrors(prev => ({ ...prev, passwordWeak: !validatePasswordStrength(pwd) }));
                } else {
                  setErrors(prev => ({ ...prev, passwordWeak: false }));
                }
              }}
              required
              minLength={8}
              placeholder={t('authRefonte.signup.passwordPlaceholder', 'At least 8 characters')}
              className={errors.passwordWeak ? AUTH_FIELD_ERROR : undefined}
              aria-invalid={errors.passwordWeak || undefined}
            />
            {errors.passwordWeak ? (
              <FieldError>{t('auth.passwordWeak', 'Password must be at least 8 characters and include one uppercase letter and one symbol.')}</FieldError>
            ) : (
              <FieldHint>{t('authRefonte.signup.passwordRules', 'At least 8 characters, with one capital letter and one symbol.')}</FieldHint>
            )}
          </div>
          <div className="space-y-2">
            <AuthLabel htmlFor="confirmPassword">{t('authRefonte.signup.confirmPassword', 'Confirm password')} *</AuthLabel>
            <PasswordInput
              id="confirmPassword"
              autoComplete="new-password"
              value={formData.confirmPassword}
              onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
              required
              className={errors.passwordMismatch ? AUTH_FIELD_ERROR : undefined}
              aria-invalid={errors.passwordMismatch || undefined}
              onBlur={() => {
                if (formData.confirmPassword && formData.password !== formData.confirmPassword) {
                  setErrors(prev => ({ ...prev, passwordMismatch: true }));
                } else {
                  setErrors(prev => ({ ...prev, passwordMismatch: false }));
                }
              }}
            />
            {errors.passwordMismatch && (
              <FieldError>{t('auth.passwordMismatch', 'Passwords do not match')}</FieldError>
            )}
          </div>
        </fieldset>
      )}
      <div className="space-y-2">
        <div className="flex items-start gap-3">
          <Checkbox
            id="acceptTerms"
            checked={acceptTerms}
            onCheckedChange={(checked) => { setAcceptTerms(checked === true); setErrors(prev => ({ ...prev, termsRequired: false })); }}
            className="mt-0.5 h-5 w-5 border-checkbox"
          />
          <label htmlFor="acceptTerms" className="cursor-pointer text-sm leading-6 text-ink">
            {t('auth.acceptTerms', 'I accept the')}{' '}
            <UnderlineLink href="/terms" external arrow={false} className="!text-sm !leading-6">
              {t('auth.termsAndConditions', 'Terms and Conditions')}
            </UnderlineLink>{' '}
            {t('auth.andThe', 'and the')}{' '}
            <UnderlineLink href="/privacy" external arrow={false} className="!text-sm !leading-6">
              {t('auth.privacyPolicy', 'Privacy Policy')}
            </UnderlineLink>
          </label>
        </div>
        {errors.termsRequired && !acceptTerms && (
          <FieldError className="pl-8">{t('auth.acceptTermsRequired', 'Please accept the Terms and Conditions to continue')}</FieldError>
        )}
      </div>
      {/* The claim-code path (claim-code-signup) sends no token, so it neither shows nor waits for the check. */}
      {captchaOn && <Turnstile captcha={captcha} action="signup" />}
      <Button type="submit" variant="cta" className="w-full justify-between" disabled={loading || (captchaOn && captcha.waiting)}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {loading ? t('auth.creating') : t('auth.createAccount')}
      </Button>
    </form>
  );
}
