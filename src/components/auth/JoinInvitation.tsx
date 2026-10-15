import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Building2, CheckCircle2, Loader2, Mail, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { AuthLoading, AuthShell, AuthStatus } from '@/components/auth/AuthShell';
import { AuthDialog } from '@/components/auth/AuthDialog';
import { LoginForm } from '@/components/auth/LoginForm';
import { AUTH_FIELD_ERROR, AuthInput, AuthLabel, AuthNotice, CTA_WRAP, FieldError, FieldHint, PasswordInput } from '@/components/auth/fields';
import { STICKY_ACTIONS } from '@/components/auth/signupParts';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { clearStoredInvite } from '@/lib/invite-store';
import { isInvalidCredentials, signInErrorMessage } from '@/lib/authErrors';
import { PASSWORD_MIN, callAcceptInvite, passwordProblem } from '@/lib/accountSignup';
import { MEMBER_HOME } from '@/lib/signInDestination';
import { cn } from '@/lib/utils';

/**
 * The team invitation, new design (spec regspec-en.md §6 /join/:inviteId, §4.5):
 * one screen with the name prefilled, the e-mail locked, a password and the job
 * title, sent to the edge function accept-invite, which creates the account with
 * that password, adds the person to the team (verified only if M3 verified the
 * company) and proves the address (the link reached that inbox).
 *
 *  - /join/<token>: the signed link of the new invitation e-mails. Already an
 *    account at that address: the person signs in, then accept_org_invitation.
 *  - /join/<invitation id> (flag account_signup_v2): an old e-mail. The id proves
 *    nothing (company members can read it), so a signed-out visitor gets a fresh
 *    signed link by e-mail; signed in, joining goes through accept_org_invitation,
 *    which checks the account's address as before.
 */

interface Preview {
  kind: 'token' | 'legacy';
  state: 'open' | 'expired' | 'accepted' | 'closed';
  invitation_id: string;
  organization: { name: string; logo_url: string | null; type_label: string; verified: boolean };
  email: string;
  first_name?: string;
  last_name?: string;
  account_exists?: boolean | null;
}

type Mode = 'create' | 'signin';

export function JoinInvitation({ token }: { token: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, profile, loading: authLoading, signIn, signOut, refreshProfile } = useAuth();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('create');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [terms, setTerms] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [linkState, setLinkState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [resetState, setResetState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [loginOpen, setLoginOpen] = useState(false);
  // The visitor asked to join on this page (sign-in form): join as soon as the session is here.
  const joinAsked = useRef(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await callAcceptInvite<Omit<Preview, 'kind'> & { kind?: string }>({ action: 'preview', token });
      if (!alive) return;
      if (!res.ok || !res.organization || !res.invitation_id) {
        setLoadError(res.ok ? 'invalid_link' : res.error);
        return;
      }
      const p: Preview = {
        kind: res.kind === 'legacy' ? 'legacy' : 'token',
        state: (['open', 'expired', 'accepted', 'closed'] as const).includes(res.state as Preview['state']) ? res.state as Preview['state'] : 'closed',
        invitation_id: res.invitation_id,
        organization: {
          name: res.organization.name || t('joinInvite.fallbackOrg', 'Organisation'),
          logo_url: res.organization.logo_url ?? null,
          type_label: res.organization.type_label || '',
          verified: res.organization.verified === true,
        },
        email: res.email || '',
        first_name: res.first_name,
        last_name: res.last_name,
        account_exists: res.account_exists,
      };
      setPreview(p);
      setFirstName(p.first_name || '');
      setLastName(p.last_name || '');
      if (p.account_exists) setMode('signin');
    })();
    return () => { alive = false; };
  }, [token, t]);

  const orgName = preview?.organization.name ?? '';
  const emailMatches = !!user && !!preview && preview.kind === 'token' && (user.email || '').toLowerCase() === preview.email.toLowerCase();

  const accept = useCallback(async () => {
    if (!preview || accepting) return;
    setAccepting(true);
    setFormError(null);
    const { error } = await supabase.rpc('accept_org_invitation', { p_invitation_id: preview.invitation_id });
    setAccepting(false);
    if (error) {
      const msg = error.message || '';
      if (import.meta.env.DEV) console.error('accept_org_invitation:', msg);
      // The database's words (accept_org_invitation): "Invitation is no longer pending (current
      // status: …)", "This invitation has expired…", "Your email does not match this invitation",
      // "Please confirm your email address before joining an organization".
      if (/no longer pending/i.test(msg)) {
        setPreview({ ...preview, state: /accepted/i.test(msg) ? 'accepted' : /expired/i.test(msg) ? 'expired' : 'closed' });
        return;
      }
      setFormError(/expired/i.test(msg)
        ? t('joinV2.expiredAccept', 'This invitation has expired. Ask the company’s owner to send a new one.')
        : /does not match/i.test(msg)
          ? t('joinV2.wrongAccount', { email: user?.email ?? '', defaultValue: 'This invitation was sent to another address. You are signed in as {{email}}.' })
          : /confirm your email/i.test(msg)
            ? t('joinV2.confirmFirst', 'Confirm your e-mail address first, with the link we e-mailed you when you signed up. Then open this invitation again.')
            : t('joinV2.acceptFailed', "We couldn't add you to the team just now. Please try again in a moment."));
      return;
    }
    clearStoredInvite();
    await refreshProfile().catch(() => {});
    toast({ title: t('joinInvite.welcomeTitle', 'Welcome!'), description: t('org.joined', 'You have joined {{orgName}}!', { orgName }) });
    navigate(MEMBER_HOME, { replace: true });
  }, [preview, accepting, refreshProfile, navigate, orgName, t, user?.email]);

  // Signed in from this page's own sign-in form: join at once (their click was the consent).
  useEffect(() => {
    if (!joinAsked.current || !user || !profile || !preview || preview.state !== 'open') return;
    if (preview.kind === 'token' && !emailMatches) return;
    joinAsked.current = false;
    void accept();
  }, [user, profile, preview, emailMatches, accept]);

  const createAccount = async (e: FormEvent) => {
    e.preventDefault();
    if (!preview || busy) return;
    const errs: Record<string, string> = {};
    if (!firstName.trim()) errs.firstName = t('signupV2.err.firstName', 'Please enter your first name.');
    if (!lastName.trim()) errs.lastName = t('signupV2.err.lastName', 'Please enter your last name.');
    const pw = passwordProblem(password);
    if (pw === 'short') errs.password = t('signupV2.err.passwordShort', { min: PASSWORD_MIN, defaultValue: 'Choose a password of at least {{min}} characters.' });
    if (pw === 'long') errs.password = t('signupV2.err.passwordLong', 'Password too long (max. 72 characters).');
    if (!terms) errs.terms = t('auth.acceptTermsRequired', 'Please accept the Terms and Conditions to continue');
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setFormError(null);
    const res = await callAcceptInvite<{ email?: string; verified?: boolean; organization_name?: string; sign_in_required?: boolean }>({
      action: 'accept',
      token,
      email: preview.email,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      password,
      job_title: jobTitle.trim(),
    });
    if (res.ok && res.sign_in_required) {
      setBusy(false);
      setMode('signin');
      setPassword('');
      setNotice(t('joinV2.hasAccount', 'This address already has an account. Sign in with its password to join the team.'));
      return;
    }
    if (!res.ok) {
      setBusy(false);
      if (res.error === 'weak_password') setErrors({ password: t('signupV2.err.weak', { min: PASSWORD_MIN, defaultValue: 'This password is too weak or too common. Go back and choose a longer one (at least {{min}} characters), less easy to guess.' }) });
      else if (res.error === 'password_too_long') setErrors({ password: t('signupV2.err.passwordLong', 'Password too long (max. 72 characters).') });
      else if (res.error === 'expired' || res.error === 'accepted' || res.error === 'closed') setPreview({ ...preview, state: res.error });
      else if (res.error === 'rate_limited') setFormError(t('joinV2.tooMany', 'Too many attempts. Please wait a few minutes, then try again.'));
      else setFormError(t('joinV2.createFailed', "We couldn't create your account just now. Please try again in a moment."));
      return;
    }
    // The account exists, in the team: sign in with the password just chosen.
    const { error } = await signIn(preview.email, password);
    setBusy(false);
    clearStoredInvite();
    if (error) {
      setMode('signin');
      setPassword('');
      setNotice(t('joinV2.createdSignIn', 'Your account is ready. Sign in with the password you just chose.'));
      return;
    }
    toast({
      title: t('joinInvite.welcomeTitle', 'Welcome!'),
      description: res.verified
        ? t('org.joined', 'You have joined {{orgName}}!', { orgName })
        : t('joinV2.joinedPending', { org: orgName, defaultValue: 'You have joined {{org}}. The M3 team checks the company, then everything opens.' }),
    });
    navigate(MEMBER_HOME, { replace: true });
  };

  const signInAndJoin = async (e: FormEvent) => {
    e.preventDefault();
    if (!preview || busy) return;
    setBusy(true);
    setFormError(null);
    joinAsked.current = true;
    const { error } = await signIn(preview.email, password);
    setBusy(false);
    if (error) {
      joinAsked.current = false;
      setFormError(isInvalidCredentials(error)
        ? t('loginV2.refused', 'The e-mail address or the password is not right.')
        : signInErrorMessage(error, t));
    }
  };

  const sendPasswordLink = async () => {
    if (!preview || resetState === 'sending') return;
    setResetState('sending');
    const redirect = new URL('/reset-password', window.location.origin);
    redirect.searchParams.set('next', `/join/${token}`);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(preview.email, { redirectTo: redirect.toString() });
      setResetState(error ? 'error' : 'sent');
    } catch {
      setResetState('error');
    }
  };

  const sendFreshLink = async () => {
    setLinkState('sending');
    const res = await callAcceptInvite({ action: 'send_link', token });
    setLinkState(res.ok ? 'sent' : 'error');
  };

  const shell = (children: React.ReactNode) => (
    <AuthShell
      eyebrow={t('authRefonte.join.eyebrow', 'Invitation')}
      title={orgName ? t('joinInvite.title', 'Join {{org}}', { org: orgName }) : t('joinV2.titleGeneric', 'Join the team')}
      lead={orgName ? t('joinV2.lead', { org: orgName, defaultValue: '{{org}} invited you to Smart Marina Connect, the marina industry network. Free.' }) : null}
      points={false}
      stickyActions
    >
      {children}
    </AuthShell>
  );

  if (loadError) {
    return (
      <AuthShell layout="centered" icon={<AlertTriangle className="h-6 w-6" />}
        title={t('joinInvite.invalidTitle', 'Invalid or Expired Invitation')}
        lead={loadError === 'network' || loadError === 'unavailable' || loadError === 'rate_limited'
          ? t('joinV2.loadFailed', "We couldn't open this invitation just now. Please reload the page in a moment.")
          : t('joinInvite.invalidDesc', 'This invitation link is no longer valid. It may have expired or already been used. Please ask the organisation owner to send a new invitation.')}>
        <Button onClick={() => navigate('/')} variant="ctaOnDark">{t('common.goHome', 'Go to Homepage')}</Button>
      </AuthShell>
    );
  }
  if (!preview || authLoading) return <AuthLoading />;

  const orgCard = (
    <div className="mb-6 flex items-center gap-3 rounded-field border border-rule bg-page p-3.5">
      {preview.organization.logo_url
        ? <img src={preview.organization.logo_url} alt="" className="h-12 w-12 shrink-0 rounded-field border border-rule bg-white object-contain" />
        : <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-field bg-chip text-navy"><Building2 className="h-6 w-6" /></span>}
      <div className="min-w-0">
        <p className="font-semibold text-navy [overflow-wrap:anywhere]">{orgName}</p>
        <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-meta">
          {preview.organization.type_label && <span>{preview.organization.type_label}</span>}
          {preview.organization.verified && <span className="inline-flex items-center gap-1 text-teal-text"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />{t('joinV2.verified', 'Verified by M3')}</span>}
        </p>
      </div>
    </div>
  );

  if (preview.state !== 'open') {
    const words = preview.state === 'accepted'
      ? t('joinV2.accepted', 'This invitation was already accepted. Sign in to reach your team.')
      : preview.state === 'expired'
        ? t('joinV2.expired', 'This invitation has expired. Ask the company’s owner to send a new one.')
        : t('joinV2.closed', 'This invitation is no longer valid. Ask the company’s owner to send a new one.');
    return shell(
      <AuthStatus tone="warning" icon={<AlertTriangle className="h-6 w-6" />} title={t('joinV2.notOpenTitle', 'This invitation cannot be used')}>
        {orgCard}
        <p className="text-sm leading-6 text-meta">{words}</p>
        <Button variant="cta" className="w-full justify-between" onClick={() => navigate(user ? MEMBER_HOME : '/?signin=true')}>
          {user ? t('memberHome.backToDashboard', 'My dashboard') : t('auth.login', 'Sign in')}
        </Button>
      </AuthStatus>,
    );
  }

  // ── Signed in ──
  if (user) {
    if (preview.kind === 'token' && !emailMatches) {
      return shell(
        <AuthStatus tone="warning" icon={<AlertTriangle className="h-6 w-6" />} title={t('joinInvite.wrongAccountTitle', 'Wrong account')}>
          {orgCard}
          <p className="break-words text-sm leading-6 text-meta">
            {t('joinV2.otherAccount', { invited: preview.email, current: user.email ?? '', defaultValue: 'This invitation is for {{invited}}. You are signed in as {{current}}: sign out, then open the link again.' })}
          </p>
          <Button variant="ctaOutline" arrow={false} roll={false} className="w-full" onClick={() => void signOut()}>{t('nav.logout', 'Log out')}</Button>
        </AuthStatus>,
      );
    }
    return shell(
      <div>
        {orgCard}
        <p className="mb-5 break-words text-sm leading-6 text-meta">{t('joinV2.signedInAs', { email: user.email ?? '', defaultValue: 'Signed in as {{email}}.' })}</p>
        {formError && <AuthNotice tone="error" role="alert" className="mb-5"><p>{formError}</p></AuthNotice>}
        <div className={STICKY_ACTIONS}>
          <Button variant="cta" roll={false} className={cn('w-full justify-between', CTA_WRAP)} onClick={() => void accept()} disabled={accepting} data-help-avoid>
            {accepting ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t('joinInvite.joining', 'Joining...')}</> : t('joinInvite.acceptAndJoin', 'Accept & Join {{org}}', { org: orgName })}
          </Button>
        </div>
      </div>,
    );
  }

  // ── Signed out, an old link: a fresh signed link by e-mail, or sign in ──
  if (preview.kind === 'legacy') {
    return shell(
      <AuthStatus icon={<Mail className="h-6 w-6" />} title={t('joinV2.legacyTitle', 'Get a fresh invitation link')}>
        {orgCard}
        <p className="text-sm leading-6 text-meta">
          {t('joinV2.legacyBody', { email: preview.email, defaultValue: 'For your security, this older link has to be renewed. We send a new one to {{email}}, the address the invitation was sent to.' })}
        </p>
        {linkState === 'sent' ? (
          <AuthNotice tone="success" role="status"><p>{t('joinV2.legacySent', 'Sent. Open the new link in that e-mail to join the team.')}</p></AuthNotice>
        ) : (
          <>
            <Button variant="cta" roll={false} className={cn('w-full justify-between', CTA_WRAP)} onClick={() => void sendFreshLink()} disabled={linkState === 'sending'} data-help-avoid>
              {linkState === 'sending' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {t('joinV2.legacySend', 'E-mail me a new link')}
            </Button>
            {linkState === 'error' && <p role="alert" className="text-sm text-red-700">{t('joinV2.legacyError', "We couldn't send the link just now. Please wait a few minutes and try again.")}</p>}
          </>
        )}
        <p className="text-center text-sm text-meta">
          {t('auth.haveAccount', 'Already have an account?')}{' '}
          <UnderlineLink arrow={false} onClick={() => { joinAsked.current = true; setLoginOpen(true); }} className="min-h-11 !text-sm">{t('auth.login', 'Sign in')}</UnderlineLink>
        </p>
        <AuthDialog mode="login" open={loginOpen} onOpenChange={setLoginOpen} sheet>
          <LoginForm onSuccess={() => setLoginOpen(false)} />
        </AuthDialog>
      </AuthStatus>,
    );
  }

  // ── Signed out, the signed link: sign in (an account exists) ──
  if (mode === 'signin') {
    return shell(
      <form onSubmit={signInAndJoin} className="space-y-5">
        {orgCard}
        {notice && <AuthNotice tone="info" role="status"><p>{notice}</p></AuthNotice>}
        <div className="space-y-2">
          <AuthLabel htmlFor="join-email">{t('auth.email', 'E-mail')}</AuthLabel>
          <AuthInput id="join-email" type="email" autoComplete="username" value={preview.email} readOnly aria-readonly="true" className="bg-page" />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <AuthLabel htmlFor="join-password">{t('auth.password', 'Password')}</AuthLabel>
            <UnderlineLink arrow={false} onClick={() => void sendPasswordLink()} disabled={resetState === 'sending'} className="-my-2.5 min-h-11 !text-[13px] !font-medium">
              {t('auth.forgotPassword', 'Forgot password?')}
            </UnderlineLink>
          </div>
          <PasswordInput id="join-password" autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); setFormError(null); }} autoFocus required />
        </div>
        {formError && <AuthNotice tone="error" role="alert"><p>{formError}</p></AuthNotice>}
        {resetState === 'sent' && (
          <AuthNotice tone="success" role="status">
            <p className="break-words">{t('joinInvite.passwordLinkSent', 'If {{email}} has an account, a link is on its way. Open it to choose your password: it brings you back here to join the team. Nothing after a few minutes? Check your spam folder, or create your account instead.', { email: preview.email })}</p>
          </AuthNotice>
        )}
        {resetState === 'error' && <AuthNotice tone="error" role="alert"><p>{t('auth.passwordLink.failed', "We couldn't send the link just now. Please try again in a moment.")}</p></AuthNotice>}
        <div className={STICKY_ACTIONS}>
          <Button type="submit" variant="cta" className="w-full justify-between" disabled={busy} data-help-avoid>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {t('joinInvite.signInAndJoin', 'Sign in and join')}
          </Button>
        </div>
      </form>,
    );
  }

  // ── Signed out, the signed link: one screen to create the account and join ──
  return shell(
    <form onSubmit={createAccount} noValidate className="space-y-5">
      {orgCard}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-3">
        <div className="space-y-2">
          <AuthLabel htmlFor="join-first">{t('authRefonte.signup.firstName', 'First name')} *</AuthLabel>
          <AuthInput id="join-first" autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} aria-invalid={!!errors.firstName || undefined} className={errors.firstName ? AUTH_FIELD_ERROR : undefined} />
          {errors.firstName && <FieldError>{errors.firstName}</FieldError>}
        </div>
        <div className="space-y-2">
          <AuthLabel htmlFor="join-last">{t('authRefonte.signup.lastName', 'Last name')} *</AuthLabel>
          <AuthInput id="join-last" autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} aria-invalid={!!errors.lastName || undefined} className={errors.lastName ? AUTH_FIELD_ERROR : undefined} />
          {errors.lastName && <FieldError>{errors.lastName}</FieldError>}
        </div>
      </div>
      <div className="space-y-2">
        <AuthLabel htmlFor="join-email">{t('auth.email', 'E-mail')}</AuthLabel>
        <AuthInput id="join-email" type="email" autoComplete="username" value={preview.email} readOnly aria-readonly="true" className="bg-page" />
        <FieldHint>{t('joinInvite.emailHint', 'This is the e-mail the invitation was sent to')}</FieldHint>
      </div>
      <div className="space-y-2">
        <AuthLabel htmlFor="join-password">{t('auth.password', 'Password')} *</AuthLabel>
        <PasswordInput id="join-password" autoComplete="new-password" value={password} onChange={(e) => { setPassword(e.target.value); setErrors((x) => ({ ...x, password: '' })); }} aria-invalid={!!errors.password || undefined} className={errors.password ? AUTH_FIELD_ERROR : undefined} />
        {errors.password
          ? <FieldError>{errors.password}</FieldError>
          : <FieldHint>{t('signupV2.passwordHint', { min: PASSWORD_MIN, defaultValue: 'At least {{min}} characters. A short sentence is easy to remember.' })}</FieldHint>}
      </div>
      <div className="space-y-2">
        <AuthLabel htmlFor="join-job">{t('authRefonte.signup.jobTitle', 'Job title')}</AuthLabel>
        <AuthInput id="join-job" autoComplete="organization-title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} maxLength={200} />
      </div>
      <div className="space-y-2">
        <div className="flex items-start gap-3">
          <Checkbox id="join-terms" checked={terms} onCheckedChange={(c) => setTerms(c === true)} className="mt-0.5 h-5 w-5 border-checkbox" />
          <label htmlFor="join-terms" className="cursor-pointer text-sm leading-6 text-ink">
            {t('auth.acceptTerms', 'I accept the')}{' '}
            <UnderlineLink href="/terms" external arrow={false} className="!text-sm !leading-6">{t('auth.termsAndConditions', 'Terms and Conditions')}</UnderlineLink>{' '}
            {t('auth.andThe', 'and the')}{' '}
            <UnderlineLink href="/privacy" external arrow={false} className="!text-sm !leading-6">{t('auth.privacyPolicy', 'Privacy Policy')}</UnderlineLink>
          </label>
        </div>
        {errors.terms && <FieldError className="pl-8">{errors.terms}</FieldError>}
      </div>
      {formError && <AuthNotice tone="error" role="alert"><p>{formError}</p></AuthNotice>}
      <div className={STICKY_ACTIONS}>
        <Button type="submit" variant="cta" roll={false} className={cn('w-full justify-between', CTA_WRAP)} disabled={busy} data-help-avoid>
          {busy ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t('auth.creating', 'Creating...')}</> : t('joinV2.createAndJoin', { org: orgName, defaultValue: 'Create my account and join {{org}}' })}
        </Button>
      </div>
      <p className="text-center text-sm text-meta">
        {t('auth.haveAccount', 'Already have an account?')}{' '}
        <UnderlineLink arrow={false} onClick={() => { setMode('signin'); setFormError(null); }} className="min-h-11 !text-sm">{t('auth.login', 'Sign in')}</UnderlineLink>
      </p>
      <p className="flex items-start gap-2 text-[13px] leading-5 text-meta">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-text" aria-hidden="true" />
        {preview.organization.verified
          ? t('joinV2.verifiedNote', 'The company is verified by M3: your account opens as soon as you join.')
          : t('joinV2.pendingNote', 'The M3 team is still checking this company: your account opens with it.')}
      </p>
    </form>,
  );
}
