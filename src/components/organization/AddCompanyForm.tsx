import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Building2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AuthNotice } from '@/components/auth/fields';
import { TypeCards } from '@/components/auth/signupParts';
import { CompanyPicker, EMPTY_CHOICE, intentOf, type CompanyChoice } from '@/components/organization/CompanyPicker';
import { useAuth } from '@/contexts/AuthContext';
import { readStoredIntent, sendSignupNotices, submitSignupIntent, type SignupType } from '@/lib/accountSignup';
import { supabase } from '@/lib/supabase';

/**
 * "Add my company" (flag account_signup_v2): the same step as the sign-up form's
 * company part, for a signed-in person in no company (a participant, or an
 * account made before). It sends the intent to the database (submit_signup_intent):
 * a listed company gets a join request (its owner answers) or a claim (M3 decides),
 * a new one is a request M3 reviews. Nothing is created here, and nothing runs
 * before the person's address is proven (then it runs at once).
 *
 * Replaces the old "create your organisation" form (create_organization, which
 * verified nobody but let anyone make a company row) and its window.confirm
 * domain bypass.
 */

const COMPANY_TYPES: SignupType[] = ['marina', 'partner', 'investor', 'developer', 'media_partner'];

/** Where a company request stands, in one sentence (complete_signup_for's result.path). */
export function companyPathText(t: TFunction, path: string | undefined, orgName?: string | null): string | null {
  const org = orgName || t('signupV2.path.theCompany', 'the company');
  switch (path) {
    case 'join_requested': return t('signupV2.path.join', { org, defaultValue: 'Your request to join {{org}} is with its owner on the platform.' });
    case 'claim_requested': return t('signupV2.path.claim', { org, defaultValue: 'The M3 team is checking your request for {{org}}.' });
    case 'company_pending': return t('signupV2.path.pending', { org, defaultValue: 'The M3 team is checking {{org}} and your request with it.' });
    case 'new_company': return t('signupV2.path.new', { org, defaultValue: 'The M3 team is checking {{org}}: it appears on the platform once approved.' });
    case 'invitation_pending': return t('signupV2.path.invitation', { org, defaultValue: '{{org}} has already invited you: open the invitation e-mail to join.' });
    case 'already_member': return t('signupV2.path.member', { org, defaultValue: 'You are already in {{org}}.' });
    case 'join_declined_recently': return t('signupV2.path.declined', { org, defaultValue: 'The owner of {{org}} declined a request lately. Write to the M3 team if this is a mistake.' });
    case 'org_not_found': return t('signupV2.path.notFound', 'We could not find that company any more. Add it again, or write to the M3 team.');
    default: return null;
  }
}

/** M3 decides these from the person's card: shown as waiting for this long at most. */
const CARD_REQUEST_DAYS = 30;

export interface CompanyRequest {
  /** A company request still waits for an answer ("Add my company" stays away meanwhile). */
  waiting: boolean;
  /** complete_signup_for's path (or the open request's status), for companyPathText. */
  path: string | null;
  /** The company's name as the person gave or picked it. */
  orgName: string | null;
  /** Saved but not run yet: it runs once the address is proven. */
  awaitingProof: boolean;
}

/**
 * Where the person's company request stands, for a person in no company (flag
 * account_signup_v2). The truth for a join or a claim is the open request row
 * (organization_invitations, status join_requested / claim_requested: the person
 * reads their own), the same test submit_signup_intent makes (request_pending): a
 * request the owner declined or M3 closed no longer counts, whatever the stored
 * intent still says. A new company, or a company M3 has not verified, waits for M3
 * on the person's card: while the person is under review, or for 30 days.
 */
export function useCompanyRequest(enabled: boolean): CompanyRequest {
  const { user, profile } = useAuth();
  const [open, setOpen] = useState<{ status: string; organization_id: string } | null>(null);
  const uid = user?.id ?? null;
  const email = (user?.email ?? '').trim().toLowerCase();
  const intent = readStoredIntent(profile);
  const stamp = intent?.done_at ?? intent?.submitted_at ?? null;

  useEffect(() => {
    if (!enabled || !uid || !email) { setOpen(null); return; }
    let alive = true;
    void (async () => {
      try {
        // RLS shows the person their own rows (by e-mail); staff see more, hence the filter below.
        const { data } = await supabase
          .from('organization_invitations')
          .select('status, organization_id, email')
          .in('status', ['join_requested', 'claim_requested'])
          .order('created_at', { ascending: false })
          .limit(20);
        const rows = (data ?? []) as { status: string; organization_id: string; email: string | null }[];
        if (alive) setOpen(rows.find((r) => (r.email ?? '').trim().toLowerCase() === email) ?? null);
      } catch {
        if (alive) setOpen(null);
      }
    })();
    return () => { alive = false; };
    // The stored intent's time changes when a request is sent or run: read again then.
  }, [enabled, uid, email, stamp]);

  const orgName = intent?.name ?? null;
  if (open) return { waiting: true, path: open.status, orgName, awaitingProof: false };
  if (!intent || intent.action === 'none') return { waiting: false, path: intent?.path ?? null, orgName, awaitingProof: false };
  if (!intent.done_at) return { waiting: true, path: null, orgName, awaitingProof: true };
  const onCard = intent.path === 'company_pending' || intent.path === 'new_company';
  const recent = Date.parse(intent.done_at) > Date.now() - CARD_REQUEST_DAYS * 86400000;
  if (onCard && (profile?.access_status === 'pending' || recent)) return { waiting: true, path: intent.path ?? null, orgName, awaitingProof: false };
  return { waiting: false, path: intent.path ?? null, orgName, awaitingProof: false };
}

export function AddCompanyForm({ initialCode = '', onDone }: { initialCode?: string; onDone?: () => void }) {
  const { t } = useTranslation();
  const { refreshProfile } = useAuth();
  const [type, setType] = useState<SignupType | null>(initialCode ? 'marina' : null);
  const [choice, setChoice] = useState<CompanyChoice>(EMPTY_CHOICE);
  const [code, setCode] = useState(initialCode);
  const [errors, setErrors] = useState<{ type?: string; company?: string }>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const intent = intentOf(choice, code);
    const errs: typeof errors = {};
    if (!type) errs.type = t('signupV2.err.companyType', 'Choose the kind of company.');
    if (!intent) errs.company = t('signupV2.err.company', 'Pick your company in the list, or create it.');
    setErrors(errs);
    if (!type || !intent) return;
    setFailure(null);
    setBusy(true);
    const res = await submitSignupIntent({ ...intent, type });
    setBusy(false);
    if (!res.ok) {
      setFailure(
        res.error === 'request_pending' ? t('signupV2.add.pending', 'You already have a company request waiting. The M3 team or the company’s owner answers it.')
          : res.error === 'already_in_company' ? t('signupV2.add.already', 'You are already in a company. Reload the page to see it.')
            : res.error === 'too_soon' ? t('signupV2.add.tooSoon', 'Please wait a minute before sending another request.')
              : res.error === 'account_suspended' ? t('signupV2.add.suspended', 'This account is suspended. Please contact events@m3monaco.com.')
                : t('signupV2.add.failed', "We couldn't send your request just now. Please try again in a moment."),
      );
      return;
    }
    const result = res.result ?? {};
    const inner = (result.result && typeof result.result === 'object' ? result.result : {}) as { path?: string };
    // The e-mails this step owes (the owner's join request; "under review" for a pending account).
    void sendSignupNotices(result);
    const name = choice.mode === 'join' ? choice.org.name : choice.mode === 'new' ? choice.name.trim() : null;
    if (result.done === true) {
      setSent(companyPathText(t, inner.path, name) ?? t('signupV2.add.sent', 'Your request is sent to the M3 team.'));
    } else if (result.reason === 'not_proven') {
      setSent(t('signupV2.add.afterProof', 'Saved. It goes to the M3 team as soon as you confirm your e-mail address (see the banner above).'));
    } else {
      setSent(t('signupV2.add.saved', 'Saved. The M3 team will look at it.'));
    }
    void refreshProfile().catch(() => {});
    onDone?.();
  };

  if (sent) {
    return (
      <AuthNotice tone="success" role="status" title={t('signupV2.add.doneTitle', 'Request sent')}>
        <p>{sent}</p>
      </AuthNotice>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <TypeCards
        value={type}
        onChange={(v) => { setType(v); setErrors((x) => ({ ...x, type: undefined })); }}
        only={COMPANY_TYPES}
        legend={t('signupV2.add.typeLegend', 'What kind of company?')}
        error={errors.type}
      />
      <CompanyPicker
        value={choice}
        onChange={(c) => { setChoice(c); setErrors((x) => ({ ...x, company: undefined })); }}
        code={code}
        onCodeChange={setCode}
        idPrefix="add-company"
        error={errors.company}
      />
      {failure && (
        <AuthNotice tone="error" role="alert">
          <p>{failure}</p>
        </AuthNotice>
      )}
      <Button type="submit" variant="cta" className="w-full justify-between sm:w-auto" disabled={busy}>
        {busy ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t('reg.sending', 'Sending…')}</> : t('signupV2.add.submit', 'Send my request')}
      </Button>
      <p className="text-[13px] leading-5 text-meta">
        {t('signupV2.add.note', 'Free. The M3 team checks every company, and the owner of a listed company confirms who joins it.')}
      </p>
    </form>
  );
}

/**
 * The company panel of a person in no company (flag account_signup_v2; the
 * dashboard's My company, the old account page's Organization tab): "Add my
 * company", or where the request already sent stands.
 */
export function AddMyCompany({ onSaved }: { onSaved?: () => void }) {
  const { t } = useTranslation();
  const request = useCompanyRequest(true);
  // A request sent from this panel keeps its own "Request sent" notice on screen.
  const [sentHere, setSentHere] = useState(false);
  const waiting = request.waiting && !sentHere;
  const line = request.awaitingProof
    ? t('signupV2.add.afterProof', 'Saved. It goes to the M3 team as soon as you confirm your e-mail address (see the banner above).')
    : companyPathText(t, request.path ?? undefined, request.orgName);
  return (
    <>
      <div className="flex items-start gap-3">
        <Building2 className="mt-0.5 h-6 w-6 shrink-0 text-navy" aria-hidden="true" />
        <div>
          <h3 className="text-lg font-semibold text-navy">{waiting ? t('signupV2.add.waitingTitle', 'Your company request') : t('signupV2.add.title', 'Add my company')}</h3>
          <p className="text-sm text-meta">
            {waiting
              ? (line ?? t('signupV2.add.saved', 'Saved. The M3 team will look at it.'))
              : t('signupV2.add.lead', 'Find it among the companies already on the platform, or describe it: the M3 team checks it, and the owner of a listed company confirms who joins.')}
          </p>
        </div>
      </div>
      {!waiting && <AddCompanyForm onDone={() => { setSentHere(true); onSaved?.(); }} />}
    </>
  );
}
