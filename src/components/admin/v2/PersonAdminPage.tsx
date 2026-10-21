import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Building2, Eye, KeyRound, Loader2, Mail, ShieldAlert, ShieldCheck, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CardLink } from '@/components/home/dashboard/DashboardKit';
import { supabase } from '@/lib/supabase';
import { startImpersonation, PendingRecoveryError } from '@/lib/impersonation';
import { toast } from '@/hooks/use-toast';
import { AdminDetailHeader, AdminEmpty, AdminLoading, AdminPanel, AdminStatus, AdminStatusPill, ADMIN_BTN, ADMIN_BTN_DANGER } from '../AdminUI';
import { Field, LinkRow, Note, PageTabs } from './MembersKit';
import { HistoryTab, MessagesTab, NotesTab, RegistrationsTab, RequestsTab } from './memberTabs';
import { fmtDate, loadPerson, personName, type PersonRecord, type Scope } from './membersApi';

/**
 * Members > a person (Victor, 21 Oct 2026). There is no people list: this page opens from the
 * person's company or from the search, and it is also the page of an "Individual" row of the
 * Companies list (a person without a company). It holds what concerns the ACCOUNT, not a company:
 * login e-mail, password link, suspension, newsletter consent, view as them; their companies are
 * shown and link to the company page, where membership is managed. Validation happens in
 * To validate. Persona and feature access stay on the previous screen (/admin/users/:id) for now.
 * Tabs: Account, Registrations, Requests, Messages, History, Notes (?tab=).
 * GDPR export / deletion: no flow exists yet (follow-up), so no button here.
 */

type TabKey = 'account' | 'registrations' | 'requests' | 'messages' | 'history' | 'notes';
const TABS: TabKey[] = ['account', 'registrations', 'requests', 'messages', 'history', 'notes'];
const STAFF = new Set(['admin', 'moderator']);

const PERSONA_LABEL: Record<string, string> = {
  marina: 'Marina', partner: 'Service provider', media_partner: 'Media', developer: 'Developer', investor: 'Investor',
  individual: 'Individual', admin: 'M3 admin', moderator: 'M3 moderator',
};

const PREF_LABEL: Record<string, string> = {
  b2b: 'connections and messages', submissions: 'their requests', recommendations: 'recommendations', events: 'events',
  payments: 'payments', team: 'team', account: 'account', marketing: 'invitations and welcome',
};

type Loaded = Awaited<ReturnType<typeof loadPerson>>;

export function PersonAdminPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [regCount, setRegCount] = useState<number | null>(null);
  const [reqCount, setReqCount] = useState<number | null>(null);

  const tabParam = params.get('tab') as TabKey | null;
  const tab: TabKey = tabParam && TABS.includes(tabParam) ? tabParam : 'account';
  const setTab = (next: TabKey) => setParams(prev => {
    const p = new URLSearchParams(prev);
    if (next === 'account') p.delete('tab'); else p.set('tab', next);
    return p;
  }, { replace: true });

  const reload = useCallback(() => {
    loadPerson(id).then(d => { setData(d); setError(null); }, (e: unknown) => setError(e instanceof Error ? e.message : 'Could not load.'));
  }, [id]);
  useEffect(() => { setData(null); setRegCount(null); setReqCount(null); reload(); }, [reload]);

  const person = data?.person ?? null;
  const scope: Scope = useMemo(() => ({ orgId: null, userIds: [id], emails: [person?.email ?? ''] }), [id, person?.email]);

  if (error) return <div className="mx-auto max-w-3xl"><Note tone="warning">{error}</Note></div>;
  if (!data) return <AdminLoading />;
  if (!person) {
    return (
      <div className="mx-auto max-w-3xl">
        <AdminEmpty icon={User} title={t('adminMembers.person.notFound', 'This person was not found')} action={<CardLink to="/admin/companies">{t('adminMembers.company.back', 'Back to Companies')}</CardLink>} />
      </div>
    );
  }

  const companies = data.companies;
  const individual = companies.length === 0 && !STAFF.has(person.persona);
  const back = companies.length === 1
    ? { to: `/admin/companies/${companies[0].org_id}?tab=members`, label: t('adminMembers.person.backTo', 'Back to {{org}}', { org: companies[0].org_name }) }
    : { to: '/admin/companies', label: t('adminMembers.company.back', 'Back to Companies') };

  return (
    <div className="mx-auto max-w-5xl">
      <AdminDetailHeader
        back={back}
        title={personName(person)}
        leading={<span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-chip text-navy"><User className="h-6 w-6" aria-hidden="true" /></span>}
        badges={
          <>
            <AdminStatus status={person.access_status} />
            {individual && <AdminStatusPill tone="info" icon={User}>{t('adminMembers.person.individual', 'Individual')}</AdminStatusPill>}
            {!(individual && person.persona === 'individual') && <AdminStatusPill>{PERSONA_LABEL[person.persona] ?? person.persona}</AdminStatusPill>}
          </>
        }
        subtitle={[person.job_title, companies.map(c => c.org_name).join(', ') || null, t('adminMembers.person.since', 'account since {{date}}', { date: fmtDate(person.created_at) })].filter(Boolean).join(' · ')}
      />

      {person.access_status === 'pending' && (
        <div className="mb-6 flex flex-col gap-3 rounded-card border border-gold/70 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[15px] font-semibold leading-6 text-navy">{t('adminMembers.person.pending', 'This account waits for M3’s validation.')}</p>
          <CardLink to="/admin/review?tab=people">{t('adminMembers.company.validate', 'Validate in To validate')}</CardLink>
        </div>
      )}

      <PageTabs
        label={t('adminMembers.person.tabs', 'Person sections')}
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'account', label: t('adminMembers.tab.account', 'Account') },
          { key: 'registrations', label: t('adminMembers.tab.registrations', 'Registrations'), count: regCount },
          { key: 'requests', label: t('adminMembers.tab.requests', 'Requests'), count: reqCount },
          { key: 'messages', label: t('adminMembers.tab.messages', 'Messages') },
          { key: 'history', label: t('adminMembers.tab.history', 'History') },
          { key: 'notes', label: t('adminMembers.tab.notes', 'Notes') },
        ]}
      />

      {tab === 'account' && <AccountTab person={person} data={data} onChanged={reload} />}
      {tab === 'registrations' && <RegistrationsTab scope={scope} onCount={setRegCount} />}
      {tab === 'requests' && <RequestsTab scope={scope} onCount={setReqCount} />}
      {tab === 'messages' && <MessagesTab scope={scope} />}
      {tab === 'history' && <HistoryTab scope={scope} />}
      {tab === 'notes' && (
        individual
          ? <NotesTab subject={{ userId: person.user_id }} />
          : (
            <AdminPanel title={t('adminMembers.notes.title', 'Internal notes')}>
              <p className="text-[15px] text-ink">{t('adminMembers.person.notesOnCompany', 'Notes about a member of a company are kept on the company page.')}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {companies.map(c => <CardLink key={c.org_id} to={`/admin/companies/${c.org_id}?tab=notes`}>{t('adminMembers.person.notesOf', 'Notes of {{org}}', { org: c.org_name })}</CardLink>)}
              </div>
            </AdminPanel>
          )
      )}
    </div>
  );
}

function AccountTab({ person, data, onChanged }: { person: PersonRecord; data: Loaded; onChanged: () => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  const staff = STAFF.has(person.persona);
  const suspended = person.access_status === 'suspended';

  // The same call as the person's own "Forgot password" (and Smart 26's "Send a password link").
  const sendPasswordLink = async () => {
    if (!person.email) return;
    let warn = '';
    const { data: probe } = await supabase.rpc('admin_pending_recovery', { p_user_id: person.user_id });
    const p = probe as { pending?: boolean; age_minutes?: number } | null;
    if (p?.pending) {
      const mins = p.age_minutes ?? 0;
      warn = '\n\n' + t('adminMembers.pw.pending', 'They already have an unused link from {{ago}} ago. Sending a new one cancels it.', { ago: mins < 60 ? `${mins} minutes` : `${Math.round(mins / 60)} hours` });
    }
    if (!window.confirm(t('adminMembers.pw.confirm', 'E-mail {{email}} a link to choose a new password?', { email: person.email }) + warn)) return;
    setBusy('pw');
    const { error } = await supabase.auth.resetPasswordForEmail(person.email, { redirectTo: `${window.location.origin}/reset-password` });
    setBusy(null);
    if (error) { toast({ title: t('adminMembers.pw.failed', 'The link was not sent'), description: error.message, variant: 'destructive' }); return; }
    toast({ title: t('adminMembers.pw.sent', 'Password link sent'), description: t('adminMembers.pw.spam', '{{email}}: if it has not arrived in a few minutes, ask them to check their spam folder.', { email: person.email }) });
  };

  // profiles.access_status, as on the previous screens (no e-mail is sent).
  const setSuspended = async (next: boolean) => {
    const name = personName(person);
    if (!window.confirm(next
      ? t('adminMembers.susp.confirm', 'Suspend {{name}}? They can no longer use the member area until you lift it. No e-mail is sent.', { name })
      : t('adminMembers.susp.liftConfirm', 'Lift the suspension of {{name}}? Their account becomes verified again.', { name }))) return;
    setBusy('susp');
    const { error } = await supabase.from('profiles').update({ access_status: next ? 'suspended' : 'verified' }).eq('user_id', person.user_id);
    setBusy(null);
    if (error) { toast({ title: t('adminMembers.susp.failed', 'Nothing was changed'), description: error.message, variant: 'destructive' }); return; }
    toast({ title: next ? t('adminMembers.susp.done', '{{name}} is suspended', { name }) : t('adminMembers.susp.lifted', 'Suspension lifted') });
    onChanged();
  };

  const viewAs = async () => {
    setBusy('view');
    try {
      await startImpersonation(person.user_id);
    } catch (e) {
      if (e instanceof PendingRecoveryError && window.confirm(`${e.message}\n\n${t('adminMembers.view.anyway', 'View as them anyway?')}`)) {
        try { await startImpersonation(person.user_id, true); return; } catch (e2) {
          toast({ title: t('adminMembers.view.failed', 'Could not open their view'), description: (e2 as Error).message, variant: 'destructive' });
        }
      } else if (!(e instanceof PendingRecoveryError)) {
        toast({ title: t('adminMembers.view.failed', 'Could not open their view'), description: (e as Error).message, variant: 'destructive' });
      }
      setBusy(null);
    }
  };

  const news = data.newsletter;
  // notification_prefs: a category set to false is off; a missing one is on (NotificationPreferencesTab).
  const off = Object.entries((person.notification_prefs ?? {}) as Record<string, unknown>).filter(([, v]) => v === false).map(([k]) => PREF_LABEL[k] ?? k);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        <AdminPanel title={t('adminMembers.acc.title', 'Account')} icon={User}>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Field label={t('adminMembers.acc.email', 'Login e-mail')}>{person.email}</Field>
            <Field label={t('adminMembers.acc.proven', 'E-mail confirmed')}>
              {person.email_proven_at ? t('adminMembers.acc.provenOn', 'Yes, on {{date}}', { date: fmtDate(person.email_proven_at) }) : t('adminMembers.acc.notProven', 'Not yet')}
            </Field>
            <Field label={t('adminMembers.acc.kind', 'Account type')}>{PERSONA_LABEL[person.persona] ?? person.persona}</Field>
            <Field label={t('adminMembers.acc.status', 'Status')}><AdminStatus status={person.access_status} /></Field>
            <Field label={t('adminMembers.acc.country', 'Country')}>{person.country}</Field>
            <Field label={t('adminMembers.acc.phone', 'Phone')}>{person.phone}</Field>
          </dl>
          <div className="mt-5"><CardLink to={`/admin/users/${person.user_id}`}>{t('adminMembers.acc.oldScreen', 'Account type and feature access')}</CardLink></div>
        </AdminPanel>

        <AdminPanel title={t('adminMembers.acc.actions', 'Help with the account')} icon={KeyRound}>
          <div className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[14px] leading-5 text-ink">{t('adminMembers.pw.hint', 'Sends them an e-mail with a link to choose a new password.')}</p>
              <Button type="button" variant="outline" className={`${ADMIN_BTN} shrink-0`} disabled={!person.email || !!busy} onClick={sendPasswordLink}>
                {busy === 'pw' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" aria-hidden="true" />}
                {t('adminMembers.pw.send', 'Send a password link')}
              </Button>
            </div>
            {!staff && (
              <div className="flex flex-col gap-2 border-t border-rule pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[14px] leading-5 text-ink">{t('adminMembers.view.hint', 'Opens the platform as them, to see exactly what they see.')}</p>
                <Button type="button" variant="outline" className={`${ADMIN_BTN} shrink-0`} disabled={!!busy} onClick={viewAs}>
                  {busy === 'view' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" aria-hidden="true" />}
                  {t('adminMembers.view.button', 'View as this person')}
                </Button>
              </div>
            )}
            {!staff && person.access_status !== 'pending' && person.access_status !== 'rejected' && (
              <div className="flex flex-col gap-2 border-t border-rule pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[14px] leading-5 text-ink">
                  {suspended ? t('adminMembers.susp.isOn', 'Suspended: they cannot use the member area.') : t('adminMembers.susp.hint', 'Blocks the member area for this person.')}
                </p>
                <Button type="button" variant="outline" className={`${suspended ? ADMIN_BTN : ADMIN_BTN_DANGER} shrink-0`} disabled={!!busy} onClick={() => setSuspended(!suspended)}>
                  {busy === 'susp' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : suspended ? <ShieldCheck className="mr-2 h-4 w-4" aria-hidden="true" /> : <ShieldAlert className="mr-2 h-4 w-4" aria-hidden="true" />}
                  {suspended ? t('adminMembers.susp.lift', 'Lift the suspension') : t('adminMembers.susp.button', 'Suspend')}
                </Button>
              </div>
            )}
          </div>
        </AdminPanel>
      </div>

      <div className="space-y-6">
        <AdminPanel
          title={t('adminMembers.acc.companies', 'Companies')}
          icon={Building2}
          description={t('adminMembers.acc.companiesDesc', 'Joining and leaving a company is managed on the company page.')}
          padded={false}
        >
          {data.companies.length === 0 ? (
            <p className="px-5 py-4 text-[14px] text-meta">{t('adminMembers.acc.noCompany', 'No company: shown as an Individual in the Companies list.')}</p>
          ) : (
            <ul className="divide-y divide-rule">
              {data.companies.map(c => (
                <LinkRow
                  key={c.org_id}
                  to={`/admin/companies/${c.org_id}?tab=members`}
                  title={c.org_name}
                  meta={c.role === 'owner' ? t('adminMembers.members.owner', 'Person in charge') : t('adminMembers.members.member', 'Member')}
                  cue={t('adminMembers.acc.openCompany', 'Open the company')}
                />
              ))}
            </ul>
          )}
        </AdminPanel>

        <AdminPanel title={t('adminMembers.news.title', 'Newsletter and e-mails')} icon={Mail}>
          <p className="text-[15px] leading-6 text-ink">
            {news === 'unknown'
              ? t('adminMembers.news.unknown', 'The newsletter list could not be read.')
              : news
                ? t('adminMembers.news.on', 'On the newsletter list since {{date}} ({{status}}).', { date: fmtDate(news.first_consented_at), status: news.mailchimp_status || 'status unknown' })
                : t('adminMembers.news.off', 'Not on the newsletter list.')}
          </p>
          <p className="mt-2 text-[14px] leading-5 text-meta">
            {off.length ? t('adminMembers.news.prefsOff', 'E-mails they turned off: {{list}}.', { list: off.join(', ') }) : t('adminMembers.news.prefsOn', 'They receive every kind of platform e-mail (none turned off in their settings).')}
          </p>
        </AdminPanel>

        <AdminPanel title={t('adminMembers.gdpr.title', 'Personal data (GDPR)')}>
          <p className="text-[14px] leading-5 text-meta">
            {t('adminMembers.gdpr.none', 'Export and deletion of a person’s data are not available in the admin yet. Until they are, write to the technical team.')}
          </p>
        </AdminPanel>
      </div>
    </div>
  );
}

