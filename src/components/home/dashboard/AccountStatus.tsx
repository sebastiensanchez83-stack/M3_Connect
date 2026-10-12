import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban, Building2, CheckCircle2, Clock, Loader2, MailWarning, Ticket, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusCard } from '@/components/ui/StatusCard';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { MemberBanner } from '@/components/member/MemberUI';
import { AddCompanyForm, companyPathText, useCompanyRequest } from '@/components/organization/AddCompanyForm';
import { useAuth } from '@/contexts/AuthContext';
import { isProven, sendEmailProof } from '@/lib/accountSignup';
import { notifyAdmin } from '@/lib/notifications';
import { useReviewSla } from '@/lib/registration';
import { supabase } from '@/lib/supabase';
import type { HomePanel } from '@/lib/accountNav';

/**
 * The top of the dashboard behind flag front_door (spec regspec-en.md §6
 * /dashboard; Victor 6 Oct 2026: M3 validates every person):
 *
 *  - the e-mail proof banner, while the account's address is not proven
 *    (send_email_proof: a /verify-email link; until then the sign-up's company
 *    request waits, and registrations made with that address do not show);
 *  - ONE status card: under review, participant, member of X, or not accepted
 *    with "Ask M3 to review again" (suspended accounts are told so);
 *  - "Add my company" (flag account_signup_v2), for a person in no company with
 *    no company request waiting. Optional: a participant gets no red badge and no
 *    redirect to a company wizard.
 *
 * With front_door off the dashboard keeps its old alerts (MemberDashboard).
 */

const REVIEW_AGAIN_KEY = 'smc_review_again:';
const REVIEW_AGAIN_DAYS = 7;

function readReviewAgain(uid: string | undefined): boolean {
  if (!uid) return false;
  try {
    const at = Number(localStorage.getItem(REVIEW_AGAIN_KEY + uid));
    return at > 0 && Date.now() - at < REVIEW_AGAIN_DAYS * 86400000;
  } catch {
    return false;
  }
}

export function AccountStatus({
  onOpen,
  hasOrganization,
  orgName,
  orgVerified,
  signupV2,
}: {
  onOpen: (key: HomePanel) => void;
  hasOrganization: boolean;
  orgName: string;
  orgVerified: boolean;
  /** account_signup_v2: "Add my company" replaces the old company form. */
  signupV2: boolean;
}) {
  const { t } = useTranslation();
  const { user, profile } = useAuth();
  const sla = useReviewSla();
  // ?code= on the home page: a claim link opened while signed in (/onboarding?code= lands here).
  const [urlCode] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('code') || ''; } catch { return ''; }
  });
  const [addOpen, setAddOpen] = useState(!!urlCode);
  const [reviewAgain, setReviewAgain] = useState(() => readReviewAgain(user?.id));
  const [reviewBusy, setReviewBusy] = useState(false);
  // Where a company request stands (the open request row first: useCompanyRequest).
  const request = useCompanyRequest(signupV2 && !hasOrganization);
  // A request sent from the card keeps the card (and its "Request sent" notice) on screen.
  const [sentHere, setSentHere] = useState(false);

  // Take the code out of the address once it is in the form (a copied link must not carry it).
  useEffect(() => {
    if (!urlCode) return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('code');
      window.history.replaceState(window.history.state, '', url.toString());
    } catch { /* ignore */ }
  }, [urlCode]);

  if (!user || !profile) return null;

  const proven = isProven(profile, user.email);
  const status = profile.access_status;
  const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim() || user.email || '';
  const requestWaiting = !hasOrganization && request.waiting;
  const pathLine = !hasOrganization && request.path ? companyPathText(t, request.path, request.orgName) : null;
  const showAdd = signupV2 && !hasOrganization && (sentHere || !requestWaiting) && (status === 'pending' || status === 'verified');

  const askReviewAgain = async () => {
    if (reviewBusy) return;
    setReviewBusy(true);
    // M3 sees it as a new item: the person's own sign-up step is submitted again, and the team is told.
    try { await supabase.from('profiles').update({ onboarding_status: 'submitted' }).eq('user_id', user.id); } catch { /* the e-mail below is what counts */ }
    await notifyAdmin(
      'account review requested again',
      name,
      [`Email: ${user.email ?? ''}`, profile.rejection_reason ? `Reason given before: ${profile.rejection_reason}` : '', 'The person asks the M3 team to review their account again (dashboard).'].filter(Boolean).join('\n'),
    );
    try { localStorage.setItem(REVIEW_AGAIN_KEY + user.id, String(Date.now())); } catch { /* ignore */ }
    setReviewBusy(false);
    setReviewAgain(true);
  };

  let card: JSX.Element;
  if (status === 'suspended') {
    card = (
      <StatusCard tone="stop" icon={Ban} eyebrow={t('dashStatus.eyebrow', 'Your account')} title={t('dashStatus.suspended', 'Your account is suspended')}
        actions={<UnderlineLink to="/contact" className="!text-[15px]">{t('dashboard.contactUs', 'Contact us')}</UnderlineLink>}>
        <p>{t('dashStatus.suspendedBody', 'Please write to the M3 team at events@m3monaco.com.')}</p>
      </StatusCard>
    );
  } else if (status === 'rejected') {
    card = (
      <StatusCard
        tone="stop"
        icon={XCircle}
        eyebrow={t('dashStatus.eyebrow', 'Your account')}
        title={t('dashStatus.rejected', 'The M3 team did not accept your account')}
        actions={reviewAgain ? undefined : (
          <>
            <Button type="button" size="sm" variant="ctaNavy" arrow={false} roll={false} onClick={() => void askReviewAgain()} disabled={reviewBusy}>
              {reviewBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {t('dashStatus.reviewAgain', 'Ask M3 to review again')}
            </Button>
            <UnderlineLink to="/contact" className="!text-[15px]">{t('dashStatus.write', 'Write to the M3 team')}</UnderlineLink>
          </>
        )}
      >
        {profile.rejection_reason && <p>{t('dashStatus.reason', { reason: profile.rejection_reason, defaultValue: 'Reason: {{reason}}' })}</p>}
        {reviewAgain
          ? <p role="status" className="font-medium text-navy">{t('dashStatus.reviewAgainSent', 'Done: the M3 team will look at your account again and e-mail you.')}</p>
          : <p>{t('dashStatus.reviewAgainHint', 'Correct your profile if something was missing, then ask the M3 team to look again.')}</p>}
      </StatusCard>
    );
  } else if (status === 'pending') {
    card = (
      <StatusCard
        tone="pending"
        icon={Clock}
        eyebrow={t('dashStatus.eyebrow', 'Your account')}
        title={proven ? t('dashStatus.pending', 'The M3 team is reviewing your account') : t('dashStatus.pendingProof', 'Confirm your e-mail, then the M3 team reviews your account')}
        actions={(
          <>
            <UnderlineLink onClick={() => onOpen('profile')} className="!text-[15px]">{t('dashboard.pendingProfile', 'Complete your profile')}</UnderlineLink>
            <UnderlineLink to="/events" className="!text-[15px]">{t('dashStatus.seeEvents', 'See the events')}</UnderlineLink>
          </>
        )}
      >
        <p>
          {proven
            ? t('dashStatus.pendingBody', { sla, defaultValue: 'M3 checks every member, usually {{sla}}, and e-mails you. Meanwhile, the events, the library and the directory are open to you.' })
            : t('dashStatus.pendingProofBody', 'Use the link we e-mailed you (the banner above sends a new one). Meanwhile, the events, the library and the directory are open to you.')}
        </p>
        {proven && pathLine && <p>{pathLine}</p>}
      </StatusCard>
    );
  } else if (hasOrganization) {
    card = (
      <StatusCard
        tone={orgVerified ? 'ok' : 'pending'}
        icon={orgVerified ? CheckCircle2 : Building2}
        eyebrow={t('dashStatus.eyebrow', 'Your account')}
        title={t('dashStatus.member', { org: orgName, defaultValue: 'Member of {{org}}' })}
      >
        <p>
          {orgVerified
            ? t('dashStatus.memberBody', 'Verified by M3. Everything for your type of company is open to you.')
            : t('dashStatus.memberOrgPending', { org: orgName, defaultValue: 'The M3 team is checking {{org}}. Writing to companies and publishing needs open once it is approved.' })}
        </p>
      </StatusCard>
    );
  } else {
    card = (
      <StatusCard
        tone="info"
        icon={Ticket}
        eyebrow={t('dashStatus.eyebrow', 'Your account')}
        title={t('dashStatus.participant', 'Participant')}
        actions={<UnderlineLink to="/events" className="!text-[15px]">{t('dashStatus.seeEvents', 'See the events')}</UnderlineLink>}
      >
        <p>{t('dashStatus.participantBody', 'Verified by M3. The events, the library and the company directory are open to you.')}</p>
        {pathLine && requestWaiting && <p>{pathLine}</p>}
      </StatusCard>
    );
  }

  return (
    <div className="mb-6 space-y-4">
      {!proven && <ProofBanner email={user.email ?? ''} />}
      {card}
      {showAdd && (
        <section aria-labelledby="add-company-title" className="rounded-card border border-rule bg-white p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3.5">
              <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-chip text-navy"><Building2 className="h-5 w-5" /></span>
              <div className="min-w-0 text-[15px] leading-6">
                <h3 id="add-company-title" className="font-semibold text-navy">
                  {t('dashStatus.addTitle', 'Add my company')} <span className="font-normal text-meta">{t('signupV2.optional', '(optional)')}</span>
                </h3>
                <p className="text-ink/90">{t('dashStatus.addBody', 'With a company checked by M3 you can write to other companies and, depending on its type, publish needs.')}</p>
              </div>
            </div>
            {!addOpen && (
              <Button type="button" variant="outline" size="sm" className="h-11 shrink-0 rounded-pill border-navy/25 bg-white px-5 text-[15px] text-navy hover:border-navy hover:bg-chip" onClick={() => setAddOpen(true)}>
                {t('dashStatus.addCta', 'Add my company')}
              </Button>
            )}
          </div>
          {addOpen && (
            <div className="mt-5 border-t border-rule pt-5">
              <AddCompanyForm initialCode={urlCode} onDone={() => setSentHere(true)} />
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/** "Confirm your e-mail address": one button, the link goes to the account's address. */
function ProofBanner({ email }: { email: string }) {
  const { t } = useTranslation();
  const { refreshProfile } = useAuth();
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'too_soon' | 'error'>('idle');

  const send = async () => {
    if (state === 'sending') return;
    setState('sending');
    const res = await sendEmailProof();
    if (res.ok) {
      if (res.already_proven) { void refreshProfile().catch(() => {}); setState('idle'); return; }
      setState('sent');
      return;
    }
    setState(res.error === 'rate_limited' ? 'too_soon' : 'error');
  };

  return (
    <MemberBanner
      tone="info"
      icon={MailWarning}
      className="mb-0"
      title={t('dashStatus.proofTitle', 'Confirm your e-mail address')}
      body={
        state === 'sent'
          ? <span role="status">{t('dashStatus.proofSent', { email, defaultValue: 'Sent to {{email}}. Open the link while signed in to this account. Nothing after a few minutes? Check your spam folder.' })}</span>
          : state === 'too_soon'
            ? <span role="alert">{t('dashStatus.proofTooSoon', 'A link was sent a moment ago. Please wait a minute before asking for another one.')}</span>
            : state === 'error'
              ? <span role="alert">{t('dashStatus.proofError', "We couldn't send the link just now. Please try again in a moment.")}</span>
              : t('dashStatus.proofBody', { email, defaultValue: 'So the M3 team can review your account, and so the registrations made with {{email}} show here.' })
      }
      action={state === 'sent' ? undefined : (
        <Button type="button" variant="ctaNavy" size="sm" arrow={false} roll={false} onClick={() => void send()} disabled={state === 'sending'}>
          {state === 'sending' && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          {t('dashStatus.proofSend', 'Send me the link')}
        </Button>
      )}
    />
  );
}

