import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Loader2, Lock, Mail, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { AuthLoading, AuthShell, AuthStatus } from '@/components/auth/AuthShell';
import { AuthInput, AuthLabel, AuthNotice, CTA_WRAP, FieldHint, PasswordInput } from '@/components/auth/fields';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { safeNext } from '@/lib/safeNext';
import { MEMBER_HOME } from '@/lib/signInDestination';
import type { EmailOtpType } from '@supabase/supabase-js';
import { toast } from '@/hooks/use-toast';

const OTP_TYPES = ['magiclink', 'invite', 'signup', 'recovery', 'email_change'];

// Where people go when the link names no destination.
const EVENT_HUB = '/sm26/me';
const AFTER_SIGNUP = '/onboarding';
// The member home ("Welcome back" and the dashboard): src/lib/signInDestination.ts.

// Landing step for the e-mailed links that /welcome redeems itself (token_hash):
//  - SM26 access links (sm26-register / sm26-provision / sm26-attendee-invite)
//    and sponsor-invite — event-provisioned accounts (pw_pending) set their
//    password here BEFORE reaching their hub; AuthRedirector routes any
//    pw_pending account here until that is done;
//  - claim-code sign-up confirmations (type=signup, next=/onboarding);
//  - sign-in links (LoginForm "Email me a sign-in link", the resend below).
// The SM26 banner and "event hub" wording only show for event links; everything
// else gets the neutral Smart Marina Connect version.
// Logged-out visitors (expired / already-used link) get a clean "send me a new
// link" path instead of a dead end.

/** SM26 destinations: the event pages and the account's event tab (/sm26/me redirects there). */
function isEventPath(path: string): boolean {
  try {
    const url = new URL(path, window.location.origin);
    const p = url.pathname.toLowerCase().replace(/\/+$/, '');
    return p === '/sm26' || p.startsWith('/sm26/') || (p === '/account' && url.searchParams.get('tab') === 'event');
  } catch {
    return false;
  }
}

/** GoTrue reports a failed /verify link (expired, already used) as error params in the query and/or #hash. */
function arrivedWithLinkError(): boolean {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return ['error', 'error_code', 'error_description'].some((k) => query.has(k) || hash.has(k));
}

/**
 * Take out of the address bar what a link left there that no longer serves: an
 * implicit-flow #access_token the PKCE client refuses (it is still a live token
 * for an hour — a copied URL must not carry it), GoTrue's error report, and an
 * auth code this browser cannot exchange. Only once auth has settled:
 * supabase-js reads the URL at start-up.
 */
function scrubLinkLeftovers() {
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const queryKeys = ['code', 'error', 'error_code', 'error_description'];
  const dirtyHash = ['access_token', 'refresh_token', 'error', 'error_code', 'error_description'].some((k) => hash.has(k));
  const dirtyQuery = queryKeys.some((k) => url.searchParams.has(k));
  if (!dirtyHash && !dirtyQuery) return;
  queryKeys.forEach((k) => url.searchParams.delete(k));
  if (dirtyHash) url.hash = '';
  window.history.replaceState(window.history.state, '', url.toString());
}

type AuthErrorLike = { code?: string; status?: number; name?: string; message?: string };

/** GoTrue refuses to "change" a password to the one already set. */
function isSamePassword(error: AuthErrorLike): boolean {
  return error.code === 'same_password' || /different from the old password/i.test(error.message || '');
}

// The session cannot save a password: too old for "Secure password change"
// (reauthentication_needed, sessions over 24 h) or no longer valid. Retrying
// cannot help — a fresh session from an e-mailed link does.
const FRESH_SESSION_CODES = new Set([
  'reauthentication_needed', 'session_not_found', 'session_expired',
  'bad_jwt', 'refresh_token_not_found', 'refresh_token_already_used',
]);
function needsFreshSession(error: AuthErrorLike): boolean {
  return error.name === 'AuthSessionMissingError' || FRESH_SESSION_CODES.has(error.code ?? '') || error.status === 401;
}

function isRateLimited(error: AuthErrorLike): boolean {
  return error.status === 429 || error.code === 'over_email_send_rate_limit' || error.code === 'over_request_rate_limit';
}

// Defined at module level: a component declared inside WelcomePage would be a
// new type on every render, remounting the form — and dropping the focus of the
// password field — on each keystroke.
function WelcomeShell({ event, children }: { event: boolean; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <>
      <Helmet><title>{t('welcome.pageTitle', 'Welcome — Smart Marina Connect')}</title></Helmet>
      <AuthShell
        title={t('onboarding.welcome', 'Welcome to Smart Marina Connect')}
        lead={event
          ? t('welcome.eventLine', 'Monaco Smart & Sustainable Marina Rendezvous 2026 · 20–21 Sep · Yacht Club de Monaco')
          : t('welcome.tagline', 'The marina industry network')}
        points={false}
      >
        {children}
      </AuthShell>
    </>
  );
}

export function WelcomePage() {
  const { t, i18n } = useTranslation();
  // The send-email hook writes its e-mails in this language (lang= on the link).
  const lang = i18n.language?.startsWith('fr') ? 'fr' : 'en';
  const { user, profile, loading: authLoading, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Where the link says to go — only ever a path on this site, never this page.
  const explicitNext = safeNext(params.get('next'), { deny: ['/welcome'] });

  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [resendEmail, setResendEmail] = useState('');
  const [resent, setResent] = useState(false);
  // Set when this session cannot save a password (see needsFreshSession): the
  // way out is a password link e-mailed to the account.
  const [freshLink, setFreshLink] = useState<'needed' | 'sent' | null>(null);
  // An access link carrying token_hash has to be redeemed here. Start in the
  // redeeming state when one is present so the "your link is dead" card never
  // flashes up while it is still being checked. Read from the address bar, like
  // the effect below: the router's copy is not updated by its replaceState.
  const [redeeming, setRedeeming] = useState(() => new URLSearchParams(window.location.search).has('token_hash'));
  const redeemed = useRef(false);
  // What the link turned out to be. The redeem effect takes `type` out of the
  // URL, so it is kept here: a 'signup' link makes the password step mandatory.
  const [redeemedType, setRedeemedType] = useState<EmailOtpType | null>(null);
  const [redeemFailed, setRedeemFailed] = useState(false);
  // Read before scrubLinkLeftovers() clears it.
  const [arrivalError] = useState(arrivedWithLinkError);
  const linkFailed = redeemFailed || arrivalError;

  // The redeem effect runs once; it reaches refreshProfile (rebuilt whenever the
  // user object changes) through a ref instead of depending on it.
  const refreshProfileRef = useRef(refreshProfile);
  useEffect(() => { refreshProfileRef.current = refreshProfile; }, [refreshProfile]);

  // Redeem a token_hash access link. Unlike the PKCE code flow, this is verified
  // server-side, so it works from any browser on any device — the link survives
  // being requested on a laptop and opened on a phone, or being sent by an admin.
  useEffect(() => {
    if (redeemed.current) return;
    const url = new URL(window.location.href);
    const tokenHash = url.searchParams.get('token_hash');
    if (!tokenHash) return;
    redeemed.current = true;

    const typeParam = url.searchParams.get('type');
    const type: EmailOtpType =
      typeParam && OTP_TYPES.includes(typeParam) ? (typeParam as EmailOtpType) : 'magiclink';

    void (async () => {
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      if (error) {
        console.error('Access link could not be redeemed:', error.message);
        setRedeemFailed(true);
      } else {
        setRedeemedType(type);
        // A sign-up link confirms an account whose password was chosen by
        // whoever filled in the sign-up form — not necessarily the owner of
        // this mailbox. Record that the password step is still owed, so a
        // reload, the navbar or a closed tab cannot skip it: AuthRedirector
        // routes any pw_pending account back here until a password is set.
        if (type === 'signup') {
          // Keep where the link was headed too (e.g. /onboarding?code=… to claim the
          // company): if the person leaves before setting a password, AuthRedirector
          // brings them back to a bare /welcome and the link's `next` is gone.
          const pendingNext = safeNext(url.searchParams.get('next'), { deny: ['/welcome'] });
          const { error: markError } = await supabase.auth.updateUser({ data: { pw_pending: true, pw_pending_reason: 'signup', pw_pending_next: pendingNext } });
          if (markError) console.error('Could not record the pending password step:', markError.message);
        }
        await refreshProfileRef.current().catch(() => {});
      }

      // Spent or not, take the credential out of the address bar — keeping only
      // where they were headed — so a copied URL carries nothing usable.
      const keep = new URLSearchParams();
      const n = url.searchParams.get('next');
      if (n) keep.set('next', n);
      const q = keep.toString();
      window.history.replaceState(window.history.state, '', url.pathname + (q ? `?${q}` : ''));

      // A no-op if the page has gone in the meantime.
      setRedeeming(false);
    })();
  }, []);

  const scrubbed = useRef(false);
  useEffect(() => {
    if (authLoading || redeeming || scrubbed.current) return;
    scrubbed.current = true;
    scrubLinkLeftovers();
  }, [authLoading, redeeming]);

  const uid = user?.id ?? null;
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const pwPending = meta.pw_pending === true;
  // Sign-up confirmations must end with a password the mailbox owner chose (or
  // proved they know): no "I already have a password", whatever `next` says.
  const mustSetPassword = !!user && (redeemedType === 'signup' || (pwPending && meta.pw_pending_reason === 'signup'));

  // A link with no `next` and no pw_pending flag may still be an SM26 one
  // (sm26-provision mails existing accounts, the resend below, a sign-in link):
  // ask whether this person has their own SM26 registration.
  const needsLookup = !!uid && !explicitNext && !mustSetPassword && !pwPending;
  const [sm26Lookup, setSm26Lookup] = useState<{ uid: string; registered: boolean } | null>(null);
  useEffect(() => {
    if (!uid || !needsLookup) return;
    let active = true;
    void (async () => {
      let registered = false;
      try {
        const { data } = await supabase
          .from('sm_registration')
          .select('id, sm_event!inner(slug)')
          .eq('user_id', uid)
          .eq('sm_event.slug', 'sm26')
          .limit(1);
        registered = !!(data && data.length);
      } catch {
        /* unknown — fall back to the neutral version */
      }
      if (active) setSm26Lookup({ uid, registered });
    })();
    return () => { active = false; };
  }, [uid, needsLookup]);
  const lookupPending = needsLookup && sm26Lookup?.uid !== uid;

  let isEvent: boolean;
  if (explicitNext) isEvent = isEventPath(explicitNext);
  else if (!user || mustSetPassword) isEvent = false;
  else if (pwPending) isEvent = true; // event-provisioned account (sm26-register / sm26-provision)
  else isEvent = sm26Lookup?.uid === uid && !!sm26Lookup?.registered;

  const storedNext = mustSetPassword ? safeNext(typeof meta.pw_pending_next === 'string' ? meta.pw_pending_next : null, { deny: ['/welcome'] }) : null;
  const next = explicitNext ?? storedNext ?? (isEvent ? EVENT_HUB : mustSetPassword ? AFTER_SIGNUP : MEMBER_HOME);

  const finish = () => {
    navigate(next, { replace: true });
  };

  const setPassword = async () => {
    if (busy) return;
    if (pw.length < 8) { toast({ title: t('auth.passwordTooShort', 'Password too short (min. 8 characters).'), variant: 'destructive' }); return; }
    // GoTrue refuses more than 72 bytes (bcrypt); say so before the round trip.
    if (new TextEncoder().encode(pw).length > 72) { toast({ title: t('welcome.passwordTooLong', 'Password too long (max. 72 characters).'), variant: 'destructive' }); return; }
    if (pw !== pw2) { toast({ title: t('auth.passwordMismatch', 'Passwords do not match.'), variant: 'destructive' }); return; }
    setBusy(true);
    const done = { pw_pending: false, pw_pending_reason: null, pw_pending_next: null };
    let { error } = await supabase.auth.updateUser({ password: pw, data: done });
    // Typing the password the account already has proves the person knows it.
    // GoTrue rejects that as a "change" (and drops `data` with it), so the step
    // is recorded as done in a second call. Reachable while an account still
    // carries the password typed on the claim-code sign-up form — every such
    // account if claim-code-signup keeps storing it, and those created before
    // it stops doing so, whose links stay valid after that deploy.
    let confirmed = false;
    if (error && isSamePassword(error)) {
      ({ error } = await supabase.auth.updateUser({ data: done }));
      confirmed = !error;
    }
    setBusy(false);
    if (error) {
      console.error('Password could not be saved:', error.code ?? error.name, error.message);
      // Nothing to retry from here: offer the e-mailed way out instead of a
      // dead end (AuthRedirector keeps a pw_pending account on this page).
      if (needsFreshSession(error)) { setFreshLink('needed'); return; }
      toast({
        title: t('welcome.setFailed', 'Could not set your password'),
        description: error.code === 'weak_password'
          ? t('welcome.weakPassword', 'This password is too weak or too common. Choose a longer, less predictable one.')
          : t('welcome.tryAgain', 'Please try again in a moment.'),
        variant: 'destructive',
      });
      return;
    }
    toast({
      title: confirmed
        ? t('welcome.passwordConfirmed', 'Password confirmed — welcome aboard!')
        : t('welcome.passwordSet', 'Password set — welcome aboard!'),
    });
    void refreshProfile().catch(() => {});
    finish();
  };

  const skipHasPassword = async () => {
    if (mustSetPassword) return;
    setBusy(true);
    await supabase.auth.updateUser({ data: { pw_pending: false, pw_pending_next: null } }).catch(() => {});
    setBusy(false);
    finish();
  };

  // The way out when this session cannot save a password: the same e-mail as
  // "Forgot password". /reset-password redeems it on any device, saves the
  // password from that fresh session, clears pw_pending and — given `next` —
  // keeps them signed in and takes them on to where this page was going. The
  // link goes to the account's own address, so it also proves the mailbox.
  const sendPasswordLink = async () => {
    const email = user?.email;
    if (!email || busy) return;
    setBusy(true);
    const redirect = new URL('/reset-password', window.location.origin);
    redirect.searchParams.set('next', next);
    redirect.searchParams.set('lang', lang);
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirect.toString() });
    setBusy(false);
    if (error) {
      console.error('Password link could not be sent:', error.code ?? error.name, error.message);
      toast({
        title: isRateLimited(error)
          ? t('welcome.resendTooSoon', 'Please wait a minute before asking for another link.')
          : t('welcome.resendFailed', 'Could not send the link'),
        description: isRateLimited(error) ? undefined : t('welcome.tryAgain', 'Please try again in a moment.'),
        variant: 'destructive',
      });
      return;
    }
    setFreshLink('sent');
  };

  const resend = async () => {
    const email = resendEmail.trim().toLowerCase();
    if (!email) return;
    setBusy(true);
    // Sends a fresh link to an EXISTING account only (no signup here). It comes
    // back here, to the same destination as the link that failed.
    const redirect = new URL('/welcome', window.location.origin);
    if (explicitNext) redirect.searchParams.set('next', explicitNext);
    redirect.searchParams.set('lang', lang);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: redirect.toString() },
    });
    setBusy(false);
    if (error) {
      // An unknown address is answered like a known one: which addresses have
      // an account is not ours to disclose.
      const unknownAccount = error.code === 'otp_disabled' || /signups not allowed/i.test(error.message || '');
      if (!unknownAccount) {
        console.error('Access link could not be sent:', error.code ?? error.name, error.message);
        const tooSoon = isRateLimited(error);
        toast({
          title: tooSoon
            ? t('welcome.resendTooSoon', 'Please wait a minute before asking for another link.')
            : t('welcome.resendFailed', 'Could not send the link'),
          description: tooSoon ? undefined : t('welcome.tryAgain', 'Please try again in a moment.'),
          variant: 'destructive',
        });
        return;
      }
    }
    setResent(true);
  };

  if (authLoading || redeeming || lookupPending) return <AuthLoading label={t('common.loading', 'Loading...')} />;

  // ── Logged out: expired or already-used link → resend path ──
  if (!user) {
    return (
      <WelcomeShell event={isEvent}>
        <AuthStatus
          tone={linkFailed ? 'warning' : 'default'}
          icon={linkFailed ? <AlertTriangle className="h-6 w-6" /> : <Mail className="h-6 w-6" />}
          title={linkFailed ? t('welcome.linkInvalidTitle', "This link can't be used") : t('welcome.getLinkTitle', 'Get your access link')}
        >
          <p className="text-sm leading-6 text-meta">
            {linkFailed
              ? t('welcome.linkInvalidDesc', "Links in our e-mails work once and expire. This one has already been used, has run out, or was replaced by a newer link. Enter your e-mail address and we'll send you a fresh one.")
              : t('welcome.getLinkDesc', "Access links work once and expire quickly. Enter the e-mail address of your account and we'll send you a fresh one.")}
          </p>
          {resent ? (
            <AuthNotice tone="success" role="status">
              <p className="break-words">
                {t('welcome.linkSent', 'If an account exists for {{email}}, a new access link is on its way. Check your inbox (and your spam folder).', { email: resendEmail.trim().toLowerCase() })}
              </p>
            </AuthNotice>
          ) : (
            <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void resend(); }}>
              <div className="space-y-2">
                <AuthLabel htmlFor="welcome-email">{t('auth.email', 'E-mail')}</AuthLabel>
                <AuthInput
                  id="welcome-email"
                  type="email"
                  autoComplete="email"
                  value={resendEmail}
                  onChange={e => setResendEmail(e.target.value)}
                  placeholder={t('auth.emailPlaceholder', 'you@example.com')}
                />
              </div>
              <Button type="submit" variant="cta" roll={false} className={cn('w-full justify-between', CTA_WRAP)} disabled={busy || !resendEmail.trim()}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t('welcome.sendLink', 'E-mail me a new access link')}
              </Button>
              <FieldHint className="text-center">
                {t('welcome.haveLogin', 'Already have a password? Use {{login}} (top-right) instead.', { login: t('nav.login', 'Login') })}
              </FieldHint>
            </form>
          )}
        </AuthStatus>
      </WelcomeShell>
    );
  }

  // ── Logged in: set the password, then continue ──
  // A sign-up's name was typed by whoever filled in the form: on that step the
  // verified address is shown instead.
  const firstName = mustSetPassword ? '' : (profile?.first_name || (meta.first_name as string | undefined) || '');
  // Worded so it holds whether or not the account still carries a password typed
  // on the sign-up form (see setPassword's same-password note).
  const title = mustSetPassword
    ? t('welcome.forcedTitle', 'Choose your password')
    : firstName
      ? t('welcome.secureTitleNamed', '{{name}}, secure your account', { name: firstName })
      : t('welcome.secureTitle', 'Secure your account');
  const description = mustSetPassword
    ? t('welcome.forcedDesc', 'Your e-mail address is confirmed. Choose a password to finish creating your account.')
    : isEvent
      ? t('welcome.eventDesc', 'Your Smart Marina Connect account is ready. Choose a password so you can sign back in anytime — then head to your event hub to complete your participation.')
      : t('welcome.neutralDesc', 'You are signed in. Choose a password so you can sign back in anytime with your e-mail address.');

  return (
    <WelcomeShell event={isEvent}>
      <AuthStatus icon={mustSetPassword ? <ShieldCheck className="h-6 w-6" /> : <Lock className="h-6 w-6" />} title={title}>
        {linkFailed && (
          <AuthNotice tone="warning">
            <p>{t('welcome.linkIgnored', 'The link you opened has already been used or has expired, so it changed nothing. You are still signed in with the account below.')}</p>
          </AuthNotice>
        )}
        <p className="text-sm leading-6 text-meta">{description}</p>
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void setPassword(); }}>
          {user.email && (
            <p className="break-all text-[13px] leading-5 text-meta">{t('welcome.signedInAs', 'Account: {{email}}', { email: user.email })}</p>
          )}
          {/* Lets password managers file the new password under the right account. */}
          <input type="email" name="username" autoComplete="username" value={user.email ?? ''} readOnly hidden />
          <div className="space-y-2">
            <AuthLabel htmlFor="welcome-password">{t('auth.password', 'Password')}</AuthLabel>
            <PasswordInput
              id="welcome-password"
              value={pw}
              onChange={e => setPw(e.target.value)}
              placeholder={t('auth.passwordPlaceholder', 'Min. 8 characters')}
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-2">
            <AuthLabel htmlFor="welcome-password2">{t('auth.confirmPassword', 'Confirm Password')}</AuthLabel>
            <PasswordInput
              id="welcome-password2"
              value={pw2}
              onChange={e => setPw2(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          {freshLink && (
            <AuthNotice
              tone={freshLink === 'sent' ? 'success' : 'warning'}
              role="alert"
              icon={freshLink === 'sent' ? undefined : <AlertTriangle className="h-4 w-4" />}
            >
              {freshLink === 'sent' ? (
                <p className="break-words">
                  {t('welcome.reauthSent', 'Link sent to {{email}}. Open it to choose your password (check your spam folder too). You can close this page.', { email: user.email ?? '' })}
                </p>
              ) : (
                <>
                  <p>{t('welcome.reauthNeeded', "For your security, we need to check it's you before saving a password. We'll e-mail you a link: open it to choose your password.")}</p>
                  <div className="pt-1.5">
                    <Button type="button" size="sm" variant="ctaOutline" arrow={false} roll={false} className={cn('bg-white', CTA_WRAP, 'min-h-11')} onClick={() => void sendPasswordLink()} disabled={busy || !user.email}>
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                      {t('welcome.reauthSend', 'E-mail me a link to set my password')}
                    </Button>
                  </div>
                </>
              )}
            </AuthNotice>
          )}
          <Button type="submit" variant="cta" roll={false} className={cn('w-full justify-between', CTA_WRAP)} disabled={busy || !pw || !pw2}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isEvent
              ? t('welcome.ctaEvent', 'Set password & open my event hub')
              : t('welcome.ctaContinue', 'Set password & continue')}
          </Button>
          {mustSetPassword ? (
            <FieldHint className="text-center">
              {t('welcome.forcedHint', 'This step is required: it makes sure only you can sign in to this account.')}
            </FieldHint>
          ) : (
            <div className="text-center">
              <UnderlineLink arrow={false} onClick={skipHasPassword} disabled={busy} className="!text-sm !font-medium">
                {isEvent
                  ? t('welcome.skipEvent', 'I already have a password — take me to my event hub')
                  : t('welcome.skipContinue', 'I already have a password — continue')}
              </UnderlineLink>
            </div>
          )}
        </form>
      </AuthStatus>
    </WelcomeShell>
  );
}
