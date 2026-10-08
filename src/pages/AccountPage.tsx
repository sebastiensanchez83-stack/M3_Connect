import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet-async';
import { AlertCircle, Check, ClipboardList, Clock, Inbox, Pencil, ShieldCheck, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  BackLink, BTN, BTN_OUTLINE, MemberBanner, MemberHeader, MemberPanel,
} from '@/components/member/MemberUI';
import { OrganizationTab } from '@/components/organization/OrganizationTab';
import { InboxTab } from '@/components/inbox/InboxTab';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { useAuth } from '@/contexts/AuthContext';
import { useMemberAccess } from '@/hooks/useMemberAccess';
import { accountHref, legacyTabTarget, memberHomeHref } from '@/lib/accountNav';
import { cn } from '@/lib/utils';

/**
 * What is left of the old account area (/account?tab=…), since October 2026:
 * a member manages everything from the home page, where every block of the
 * account opens its editor in place (/?open=<block>). This page only:
 *
 *  - forwards every old address, which notification e-mails and bookmarks still
 *    use, to the matching block: /account?tab=X[&section=Y] → /?open=X[&section=Y]
 *    (see legacyTabTarget: ?tab=event → the events block, ?tab=submissions /
 *    projects / rfps / consultations / webinars → "My requests", ?tab=b2b-requests
 *    → the inbox, ?tab=dashboard, a bare /account or an unknown tab → the home
 *    page). ?tab=pricing, the retired level comparison still linked from six
 *    payment e-mails, goes to the sponsor portal for an account linked to a
 *    sponsor, otherwise to the events block (payments due are there);
 *  - keeps the registration screen (?tab=complete-registration): a draft account
 *    is sent there from everywhere until its sign-up is finished, and a member
 *    whose registration was just submitted sees its "under review" step;
 *  - serves /inbox, still a page of its own (`forceTab="inbox"`).
 */
export function AccountPage({ forceTab }: { forceTab?: string } = {}) {
  const { t } = useTranslation();
  const { user, profile, loading: authLoading, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tab = searchParams.get('tab');
  const isDraft = profile?.onboarding_status === 'draft';
  // Only ?tab=pricing needs to know about sponsors: the query runs for it alone.
  const access = useMemberAccess(!forceTab && tab === 'pricing' && !!profile && !isDraft);

  if (authLoading) return <LoadingSkeleton variant="screen" />;
  if (!user) return null;

  if (forceTab === 'inbox') return <InboxScreen />;

  if (!profile) {
    return (
      <div className="min-h-[60vh] bg-page px-4 py-16">
        <div className="mx-auto max-w-md rounded-card border border-rule bg-white p-8 text-center">
          <AlertCircle className="mx-auto mb-3 h-10 w-10 text-amber-500" aria-hidden="true" />
          <p className="font-semibold text-navy">{t('accountArea.loadError.title', 'Could not load your profile.')}</p>
          <p className="mt-1 text-sm text-meta">{t('accountArea.loadError.body', 'This may be due to a slow connection. Please try again.')}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Button variant="ctaNavy" size="sm" onClick={() => refreshProfile()}>
              {t('accountArea.loadError.retry', 'Retry')}
            </Button>
            <Button variant="outline" className={BTN_OUTLINE} onClick={() => navigate('/onboarding')}>
              {t('memberHome.loadError.onboarding', 'Go to onboarding')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // A member whose registration was just submitted (not yet reviewed) still
  // gets the wizard's "submitted for review" step on this address.
  const awaitingReview = profile.onboarding_status === 'submitted' && profile.access_status === 'pending';

  if (tab === 'complete-registration') {
    if (isDraft || awaitingReview) return <CompleteRegistration awaitingReview={awaitingReview} />;
    return <Navigate to="/" replace />;
  }

  // Finishing the sign-up comes first: every other address of the old account area leads there.
  if (isDraft) return <Navigate to={accountHref('complete-registration')} replace />;

  if (tab === 'pricing') {
    if (!access) return <LoadingSkeleton variant="screen" />;
    return <Navigate to={memberHomeHref(access.sponsorIds.length > 0 ? 'sponsorship' : 'registrations')} replace />;
  }

  const target = legacyTabTarget(tab, searchParams.get('section'));
  return <Navigate to={target ? memberHomeHref(target.panel, target.section) : '/'} replace />;
}

/* ================================================================== registration */

/**
 * The two-step registration of a draft account: the organisation, then the M3
 * review. Unchanged from the old account area, in a page of its own.
 */
function CompleteRegistration({ awaitingReview }: { awaitingReview: boolean }) {
  const { t } = useTranslation();
  const { user, profile, organization } = useAuth();
  const navigate = useNavigate();
  if (!profile) return null;

  const isOnboarding = profile.onboarding_status === 'draft';
  const currentStep = isOnboarding && !organization ? 1 : 2;
  const title = t('accountArea.onboarding.navLabel', 'Complete registration');

  return (
    <div className="min-h-screen bg-page pb-20">
      <Helmet>
        <title>{`${title} — Smart Marina Connect`}</title>
      </Helmet>
      <MemberHeader
        seed={organization?.id ?? user?.id ?? 'member'}
        icon={ClipboardList}
        eyebrow={t('accountArea.menu.gettingStarted', 'Getting started')}
        title={title}
      >
        <span>{t('accountArea.onboarding.navDesc', 'Two steps to join the network')}</span>
      </MemberHeader>

      <div className="mx-auto w-full max-w-4xl px-4 pt-6 sm:px-6 sm:pt-8 md:pt-10">
        {profile.access_status === 'rejected' && (
          <MemberBanner
            tone="danger"
            icon={XCircle}
            title={t('accountArea.banner.rejectedTitle', 'Your access request has been rejected.')}
            body={profile.rejection_reason ? t('accountArea.banner.rejectedReason', { reason: profile.rejection_reason, defaultValue: 'Reason: {{reason}}' }) : undefined}
            action={(
              <Button size="sm" variant="outline" className={BTN_OUTLINE} onClick={() => navigate('/onboarding')}>
                {t('accountArea.banner.resubmit', 'Edit and resubmit')}
              </Button>
            )}
          />
        )}

        <div className="space-y-6">
          {/* Step indicator — always visible */}
          <MemberPanel>
            <div className="p-5 sm:p-6">
              <p className="text-sm text-meta">
                {currentStep === 1
                  ? t('accountArea.onboarding.step1Intro', 'Fill in your organisation details to get started.')
                  : t('accountArea.onboarding.step2Intro', 'Your profile is submitted for review.')}
              </p>
              <ol className="mt-5 flex items-center gap-3">
                <li className="flex items-center gap-2">
                  <span className={cn('flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold', currentStep > 1 ? 'bg-foam text-teal-text' : 'bg-navy text-white')}>
                    {currentStep > 1 ? <Check className="h-4 w-4" aria-hidden="true" /> : '1'}
                  </span>
                  <span className={cn('text-[15px] font-semibold', currentStep > 1 ? 'text-teal-text' : 'text-navy')}>
                    {t('accountArea.onboarding.stepOrganization', 'Organisation')}
                  </span>
                </li>
                <li aria-hidden="true" className={cn('h-px flex-1', currentStep > 1 ? 'bg-teal/40' : 'bg-rule')} />
                <li className="flex items-center gap-2" aria-current={currentStep === 2 ? 'step' : undefined}>
                  <span className={cn('flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold', currentStep === 2 ? 'bg-navy text-white' : 'bg-chip text-meta')}>
                    2
                  </span>
                  <span className={cn('text-[15px] font-semibold', currentStep === 2 ? 'text-navy' : 'text-meta')}>
                    {t('accountArea.onboarding.stepReview', 'Admin review')}
                  </span>
                </li>
              </ol>
            </div>
          </MemberPanel>

          {/* ── Step 1: the organisation ── */}
          {currentStep === 1 && <OrganizationTab />}

          {/* ── Step 2: the M3 review ── */}
          {currentStep === 2 && (
            <MemberPanel>
              <div className="px-5 py-10 text-center">
                <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-foam">
                  <ShieldCheck className="h-8 w-8 text-teal" aria-hidden="true" />
                </span>
                <h2 className="mt-4 text-h3 text-navy">{t('accountArea.onboarding.submittedTitle', 'Profile submitted for review')}</h2>
                <p className="mx-auto mt-2 max-w-md text-meta">
                  {t('memberHome.onboarding.submittedBody', 'Thank you for completing your registration! The M3 team reviews each profile, usually within 24 to 48 business hours, and emails you as soon as your account is approved.')}
                </p>
                <p className="mt-3 flex items-center justify-center gap-2 text-sm text-meta">
                  <Clock className="h-4 w-4" aria-hidden="true" />
                  {t('accountArea.onboarding.reviewTime', 'Typical review time: 24 to 48 business hours')}
                </p>
                <div className="flex flex-col items-center gap-2 pt-5">
                  <Button variant="outline" className={cn(BTN_OUTLINE, 'gap-2')} onClick={() => navigate(memberHomeHref('organization'), { replace: true })}>
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                    {t('accountArea.onboarding.editRegistration', 'Edit my registration')}
                  </Button>
                  {awaitingReview && (
                    <Link to="/contact" className={cn(BTN, 'inline-flex items-center text-sm font-medium text-navy underline underline-offset-2 hover:text-navy/80 focus:outline-none focus-visible:shadow-focus')}>
                      {t('accountArea.banner.contactSupport', 'Questions? Write to the M3 team')}
                    </Link>
                  )}
                </div>
              </div>
            </MemberPanel>
          )}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== /inbox */

/** /inbox: the inbox as a page of its own (the dashboard's inbox block shows the same thing in place). */
function InboxScreen() {
  const { t } = useTranslation();
  const { user, organization } = useAuth();
  const title = t('memberHome.sections.inbox', 'Inbox');
  return (
    <div className="min-h-screen bg-page pb-20">
      <Helmet>
        <title>{`${title} — Smart Marina Connect`}</title>
      </Helmet>
      <MemberHeader
        seed={organization?.id ?? user?.id ?? 'member'}
        icon={Inbox}
        eyebrow={t('memberUi.memberArea', 'Member area')}
        title={title}
        back={<BackLink to="/#dashboard">{t('memberHome.backToDashboard', 'My dashboard')}</BackLink>}
      >
        <span>{t('memberHome.sections.inboxDesc', 'Connection and team requests')}</span>
      </MemberHeader>
      <div className="mx-auto w-full max-w-5xl px-4 pt-6 sm:px-6 sm:pt-8 md:pt-10">
        <InboxTab />
      </div>
    </div>
  );
}
