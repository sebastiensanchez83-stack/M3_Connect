import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  UserCheck, RefreshCw, Download,
  AlertTriangle, UserPlus, FileCheck, Clock, FileX, FileMinus, ShieldPlus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { sendNotification } from '@/lib/notifications';
import { ActionCue } from '@/components/home/dashboard/DashboardKit';
import { AdminContextBanner } from './AdminContextBanner';
import {
  AdminPageHeader, AdminFilterBar, AdminTableCard, AdminKpiCard, AdminLoading, AdminStatusPill, AdminStatus, AdminEmpty, AdminPanel,
  ADMIN_BTN, ADMIN_BTN_PRIMARY,
} from './AdminUI';
import { FIELD, FormField, fmtDay, personaLabel, TierPill } from './AdminStyleKit';
import type { AdminProfile } from './types';

/**
 * Settings > Accounts and export (/admin/users): every account in one list, its CSV export,
 * the e-mails never confirmed, and the creation of M3 admin accounts. Refonte admin style
 * (Oct 2026): a table on a computer, one card per person on a phone; each row opens the
 * account screen and says so. Changing an account type from the list asks first.
 * Filters from links: ?status= ?persona= ?onboarding= ?activity=inactive ?org=<company id>.
 */

// Marina recommendation counts for partner organizations (informational only)
type ReferenceStatus = {
  total: number;
  confirmed: number;
  pending: number;
  rejected: number;
  clientName: string | null;
};

export function AdminUsers() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlStatus = searchParams.get('status') || '';
  const urlPersona = searchParams.get('persona') || '';
  // The dashboard tiles open this list pre-filtered: ?onboarding=draft (not activated), ?status=verified&activity=inactive (dormant).
  const urlOnboarding = searchParams.get('onboarding') || '';
  const urlInactive = searchParams.get('activity') === 'inactive';
  // ?org=<id>: the company's settings screen links here ("See these people…"); it used to be ignored.
  const urlOrg = searchParams.get('org') || '';
  const hasUrlFilters = !!urlStatus || !!urlPersona || !!urlOnboarding || urlInactive || !!urlOrg;

  const [users, setUsers] = useState<AdminProfile[]>([]);
  // Every company each person belongs to (a person can be in several), built from the
  // memberships already loaded below: the ?org= filter must not miss anyone.
  const [orgsByUser, setOrgsByUser] = useState<Record<string, string[]>>({});
  const [orgNameById, setOrgNameById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [personaFilter, setPersonaFilter] = useState(urlPersona || 'all');
  const [statusFilter, setStatusFilter] = useState(urlStatus || 'all');
  const [onboardingFilter, setOnboardingFilter] = useState(urlOnboarding || 'all');
  const [inactiveOnly, setInactiveOnly] = useState(urlInactive);
  const [emailStatusMap, setEmailStatusMap] = useState<Record<string, boolean>>({});
  const [referenceStatusMap, setReferenceStatusMap] = useState<Record<string, ReferenceStatus>>({});
  const [unconfirmedUsers, setUnconfirmedUsers] = useState<{ id: string; email: string; created_at: string; first_name: string | null; last_name: string | null; persona: string | null }[]>([]);
  const [showUnconfirmed, setShowUnconfirmed] = useState(false);
  const [createAdminOpen, setCreateAdminOpen] = useState(false);
  const [createAdminForm, setCreateAdminForm] = useState({ email: '', password: '', firstName: '', lastName: '' });
  const [creatingAdmin, setCreatingAdmin] = useState(false);
  const [invitePartnerOpen, setInvitePartnerOpen] = useState(false);
  const [invitePartnerForm, setInvitePartnerForm] = useState({ email: '', firstName: '' });
  const [sendingPartnerInvite, setSendingPartnerInvite] = useState(false);
  const [changingPersona, setChangingPersona] = useState(false);
  useEffect(() => { loadUsers(); }, []);

  const loadUsers = async () => {
    setLoading(true);
    try {
      // Split into separate queries to avoid Supabase relationship join error
      const [{ data: profilesData, error }, { data: membershipsData }, { data: emailData }, { data: unconfData }] = await Promise.all([
        supabase
          .from('profiles')
          .select('user_id, first_name, last_name, email, persona, access_status, onboarding_status, rejection_reason, created_at, updated_at')
          .order('created_at', { ascending: false }),
        supabase
          .from('organization_members')
          .select('user_id, organization_id, organizations(id, name, tier, organization_type, access_status, max_seats, website, country, city, description, logo_url)'),
        supabase.rpc('get_users_email_status'),
        supabase.rpc('get_unconfirmed_users'),
      ]);
      if (error) { if (import.meta.env.DEV) console.error('Error loading users:', error); toast({ title: 'Error loading users', description: error.message, variant: 'destructive' }); }
      // Build a map from user_id → org info (including tier, type, status for merged Partners view)
      const orgMap = new Map<string, { org_id: string; org_name: string; org_tier: string; org_type: string | null; org_access_status: string; org_max_seats: number; org_website: string | null; org_country: string | null; org_city: string | null; org_description: string | null; org_logo_url: string | null }>();
      const allOrgsByUser: Record<string, string[]> = {};
      const namesById: Record<string, string> = {};
      (membershipsData || []).forEach((m: Record<string, unknown>) => {
        const org = m.organizations as Record<string, unknown> | null;
        if (org) {
          const uid = m.user_id as string;
          allOrgsByUser[uid] = [...(allOrgsByUser[uid] || []), org.id as string];
          namesById[org.id as string] = org.name as string;
          orgMap.set(m.user_id as string, {
            org_id: org.id as string,
            org_name: org.name as string,
            org_tier: (org.tier as string) || 'member',
            org_type: (org.organization_type as string) || null,
            org_access_status: (org.access_status as string) || 'pending',
            org_max_seats: (org.max_seats as number) || 1,
            org_website: (org.website as string) || null,
            org_country: (org.country as string) || null,
            org_city: (org.city as string) || null,
            org_description: (org.description as string) || null,
            org_logo_url: (org.logo_url as string) || null,
          });
        }
      });
      // Merge profiles with org info
      const merged = (profilesData || []).map((row: Record<string, unknown>) => {
        const orgInfo = orgMap.get(row.user_id as string);
        return {
          ...row,
          org_name: orgInfo?.org_name || null,
          org_id: orgInfo?.org_id || null,
          org_tier: orgInfo?.org_tier || null,
          org_type: orgInfo?.org_type || null,
          org_access_status: orgInfo?.org_access_status || null,
          org_max_seats: orgInfo?.org_max_seats || null,
          org_website: orgInfo?.org_website || null,
          org_country: orgInfo?.org_country || null,
          org_city: orgInfo?.org_city || null,
          org_description: orgInfo?.org_description || null,
          org_logo_url: orgInfo?.org_logo_url || null,
        };
      });
      setUsers(merged as unknown as AdminProfile[]);
      setOrgsByUser(allOrgsByUser);
      setOrgNameById(namesById);
      // Build email confirmation status map
      const statusMap: Record<string, boolean> = {};
      (emailData || []).forEach((row: { user_id: string; email_confirmed: boolean }) => { statusMap[row.user_id] = row.email_confirmed; });
      setEmailStatusMap(statusMap);
      setUnconfirmedUsers((unconfData || []) as typeof unconfirmedUsers);

      // ── Load marina recommendation counts for partner orgs (informational) ──
      const partnerUsers = (merged as unknown as AdminProfile[]).filter((u) => u.persona === 'partner' && u.org_id);
      const partnerOrgIds = partnerUsers.map((u) => u.org_id as string);
      if (partnerOrgIds.length > 0) {
        const uniqueOrgIds = [...new Set(partnerOrgIds)];
        const { data: refData } = await supabase
          .from('reference_requests')
          .select('id, partner_organization_id, status, client_legal_name, confirmed_at, created_at')
          .in('partner_organization_id', uniqueOrgIds)
          .order('created_at', { ascending: false });

        const refMap: Record<string, ReferenceStatus> = {};
        const orgRefMap = new Map<string, typeof refData>();
        (refData || []).forEach((ref: { id: string; partner_organization_id: string; status: string; client_legal_name: string; confirmed_at: string | null; created_at: string }) => {
          const orgId = ref.partner_organization_id;
          if (!orgRefMap.has(orgId)) orgRefMap.set(orgId, []);
          orgRefMap.get(orgId)!.push(ref);
        });

        partnerUsers.forEach((u) => {
          const refs = orgRefMap.get(u.org_id!) || [];
          const confirmed = refs.filter((r: { status: string }) => r.status === 'confirmed').length;
          const pending = refs.filter((r: { status: string }) => r.status === 'pending' || r.status === 'sent').length;
          const rejected = refs.filter((r: { status: string }) => r.status === 'rejected').length;
          const latest = refs[0];
          refMap[u.user_id] = {
            total: refs.length,
            confirmed,
            pending,
            rejected,
            clientName: latest?.client_legal_name || null,
          };
        });
        setReferenceStatusMap(refMap);
      } else {
        setReferenceStatusMap({});
      }
    } catch (err) { if (import.meta.env.DEV) console.error('Error loading users:', err); }
    setLoading(false);
  };

  const getUserName = (u: AdminProfile) => {
    try {
      if (u.first_name || u.last_name) return `${u.first_name || ''} ${u.last_name || ''}`.trim();
      return u.email?.split('@')[0] || t('admin.userDetail.noName');
    } catch { return t('admin.userDetail.noName'); }
  };

  const getOrgName = (u: AdminProfile) => {
    return u.org_name || '';
  };

  const handleChangePersona = async (userId: string, newPersona: string) => {
    setChangingPersona(true);
    const { error } = await supabase.from('profiles').update({ persona: newPersona }).eq('user_id', userId);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: `Account type changed to ${personaLabel(newPersona)}` });
      loadUsers();
    }
    setChangingPersona(false);
  };

  const handleCreateAdmin = async () => {
    const { email, password, firstName, lastName } = createAdminForm;
    if (!email || !password || !firstName || !lastName) {
      toast({ title: 'All fields are required', variant: 'destructive' });
      return;
    }
    if (password.length < 8) {
      toast({ title: 'Password must be at least 8 characters', variant: 'destructive' });
      return;
    }
    setCreatingAdmin(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { toast({ title: 'Not authenticated', variant: 'destructive' }); setCreatingAdmin(false); return; }
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL || 'https://djjbgzasuomhyfvtlidi.supabase.co'}/functions/v1/create-admin-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ email, password, first_name: firstName, last_name: lastName }),
      });
      const result = await res.json();
      if (!res.ok) {
        toast({ title: 'Error', description: result.error || 'Failed to create admin', variant: 'destructive' });
      } else {
        toast({ title: 'Admin user created', description: `${firstName} ${lastName} (${email}) has been created as admin.` });
        setCreateAdminOpen(false);
        setCreateAdminForm({ email: '', password: '', firstName: '', lastName: '' });
        loadUsers();
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error('Create admin error:', err);
      toast({ title: 'Error', description: 'Network error', variant: 'destructive' });
    }
    setCreatingAdmin(false);
  };

  // Dormant = not updated for 30+ days (the same rule as the dashboard's Inactive tile).
  const dormantBefore = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const isDormant = (u: AdminProfile) => !!u.updated_at && new Date(u.updated_at).getTime() <= dormantBefore;

  // ?org=: everyone who belongs to that company, even when it is not the company shown on their row.
  const inUrlOrg = (u: AdminProfile) => u.org_id === urlOrg || (orgsByUser[u.user_id] || []).includes(urlOrg);

  const filteredUsers = users.filter(user => {
    const name = getUserName(user).toLowerCase();
    const org = getOrgName(user).toLowerCase();
    const email = (user.email || '').toLowerCase();
    const q = search.toLowerCase();
    const matchesSearch = search === '' || name.includes(q) || org.includes(q) || email.includes(q) || user.persona.includes(q);
    const matchesPersona = personaFilter === 'all' || user.persona === personaFilter;
    const matchesStatus = statusFilter === 'all' || user.access_status === statusFilter;
    const matchesOnboarding = onboardingFilter === 'all'
      || (onboardingFilter === 'in_progress' && ['draft', 'submitted', 'under_review'].includes(user.onboarding_status))
      || user.onboarding_status === onboardingFilter;
    const matchesActivity = !inactiveOnly || isDormant(user);
    const matchesOrg = !urlOrg || inUrlOrg(user);
    return matchesSearch && matchesPersona && matchesStatus && matchesOnboarding && matchesActivity && matchesOrg;
  });

  // Count users by onboarding stage (for the summary strip)
  const inProgressCount = users.filter(u => ['draft', 'submitted', 'under_review'].includes(u.onboarding_status)).length;
  const draftCount = users.filter(u => u.onboarding_status === 'draft').length;
  const submittedCount = users.filter(u => u.onboarding_status === 'submitted').length;

  const exportCSV = () => {
    const csv = [['Name', 'Email', 'Organization', 'Persona', 'Access Status', 'Onboarding', 'Created'].join(','),
      ...filteredUsers.map(u => [
        `"${getUserName(u)}"`, `"${u.email || ''}"`, `"${getOrgName(u)}"`,
        u.persona, u.access_status, u.onboarding_status, new Date(u.created_at).toLocaleDateString()
      ].join(','))
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'users.csv'; a.click();
  };

  const getOnboardingBadge = (user: AdminProfile) => {
    // Email not confirmed yet — before they even created a profile
    if (emailStatusMap[user.user_id] === false) {
      return <AdminStatusPill tone="warning" icon={Clock} title="Account created but the e-mail address was never confirmed">E-mail not confirmed</AdminStatusPill>;
    }
    const stage = user.onboarding_status;
    const hasOrg = !!user.org_id;
    switch (stage) {
      case 'draft':
        return <AdminStatusPill tone="warning" icon={Clock} title={hasOrg ? 'Persona & profile created, organization form in progress' : 'Step 1/3: persona selected, has not filled the organization form yet'}>
          {hasOrg ? 'Filling in their profile' : 'Account type chosen'}
        </AdminStatusPill>;
      case 'submitted':
        return <AdminStatusPill tone="info" icon={FileCheck} title="Company form sent, waiting for M3 (To validate)">Waiting for M3</AdminStatusPill>;
      case 'under_review':
        return <AdminStatusPill tone="info" icon={FileCheck}>Under review</AdminStatusPill>;
      case 'completed':
        return <AdminStatusPill tone="success" icon={FileCheck}>Completed</AdminStatusPill>;
      default:
        return <AdminStatusPill>{stage || '—'}</AdminStatusPill>;
    }
  };

  const getReferenceBadge = (userId: string) => {
    const ref = referenceStatusMap[userId];
    if (!ref || ref.total === 0) {
      return (
        <AdminStatusPill icon={FileMinus} title="No marina recommendation yet">No recommendation</AdminStatusPill>
      );
    }
    if (ref.confirmed > 0) {
      return (
        <AdminStatusPill tone="success" icon={FileCheck} title={`${ref.confirmed} confirmed recommendation(s) — latest: ${ref.clientName}`}>
          {ref.confirmed} confirmed
        </AdminStatusPill>
      );
    }
    if (ref.rejected > 0 && ref.pending === 0) {
      return (
        <AdminStatusPill tone="danger" icon={FileX} title={`${ref.rejected} declined by marina`}>
          {ref.rejected} declined
        </AdminStatusPill>
      );
    }
    return (
      <AdminStatusPill tone="warning" icon={Clock} title={`${ref.pending} pending — latest: ${ref.clientName}`}>
        {ref.pending} pending
      </AdminStatusPill>
    );
  };

  const getTierBadge = (tier: string | null) => <TierPill tier={tier} />;

  if (loading) return <AdminLoading />;

  const PERSONA_OPTIONS = ['marina', 'partner', 'media_partner', 'developer', 'investor', 'moderator', 'admin'];
  // Changing an account type from the list asks first (it can give access to the M3 administration).
  const confirmPersona = (u: AdminProfile, next: string) => {
    if (next === u.persona) return;
    const staff = next === 'admin' || next === 'moderator';
    const msg = t('adm2.users.personaConfirm', 'Change the account type of {{name}} from "{{from}}" to "{{to}}"?', { name: getUserName(u), from: personaLabel(u.persona), to: personaLabel(next) })
      + (staff ? '\n\n' + t('adm2.users.personaStaff', 'This gives them access to the M3 administration.') : '');
    if (!window.confirm(msg)) return;
    handleChangePersona(u.user_id, next);
  };
  const personaSelect = (u: AdminProfile, className: string) => (
    <Select value={u.persona} onValueChange={(v) => confirmPersona(u, v)} disabled={changingPersona}>
      <SelectTrigger className={className} onClick={(e) => e.stopPropagation()} aria-label={t('adm2.users.personaFor', 'Account type of {{name}}', { name: getUserName(u) })}><SelectValue /></SelectTrigger>
      <SelectContent>
        {PERSONA_OPTIONS.map(p => <SelectItem key={p} value={p}>{personaLabel(p)}</SelectItem>)}
      </SelectContent>
    </Select>
  );
  const orgFilterName = urlOrg ? (orgNameById[urlOrg] || t('adm2.users.oneCompany', 'one company')) : '';
  const openLabel = t('adm2.users.open', 'Open');

  return (
    <div>
      <AdminPageHeader
        title={t('adm2.users.title', 'Accounts and export')}
        count={users.length}
        description={t('adm2.users.desc', 'Every account on the platform. Press a row to open the account; validation itself happens in To validate.')}
        className="mb-4"
      />

      {/* The screen's buttons on their own line: four of them would squeeze the title beside them. */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {unconfirmedUsers.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            aria-expanded={showUnconfirmed}
            className={showUnconfirmed ? 'h-10 rounded-pill border-amber-300 bg-amber-50 px-4 text-amber-900 hover:bg-amber-100 hover:text-amber-900' : ADMIN_BTN}
            onClick={() => setShowUnconfirmed(!showUnconfirmed)}
          >
            <AlertTriangle className="mr-2 h-4 w-4" aria-hidden="true" />
            {showUnconfirmed
              ? t('adm2.users.hideUnconfirmed', 'Hide the unconfirmed e-mails')
              : t('adm2.users.showUnconfirmed', { count: unconfirmedUsers.length, defaultValue_one: 'See the unconfirmed e-mail', defaultValue_other: 'See the {{count}} unconfirmed e-mails' })}
          </Button>
        )}
        <Button variant="outline" size="sm" className={ADMIN_BTN} onClick={exportCSV}>
          <Download className="mr-2 h-4 w-4" aria-hidden="true" />{t('adm2.users.export', 'Download the list (CSV)')}
        </Button>
        <Button variant="outline" size="sm" className={ADMIN_BTN} onClick={() => setInvitePartnerOpen(true)}>
          <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />{t('adm2.users.invite', 'Invite a service provider')}
        </Button>
        <Button variant="secondary" size="sm" className={ADMIN_BTN_PRIMARY} onClick={() => setCreateAdminOpen(true)}>
          <ShieldPlus className="mr-2 h-4 w-4" aria-hidden="true" />{t('adm2.users.createAdmin', 'Create an M3 admin account')}
        </Button>
      </div>

      {/* URL-based filter context banner */}
      {hasUrlFilters && (
        <AdminContextBanner
          lead={t('adm2.banner.lead', 'Showing only:')}
          label={[
            urlStatus ? `Status: ${urlStatus.replace('_', ' ')}` : '',
            urlPersona ? `Type: ${personaLabel(urlPersona)}` : '',
            urlOnboarding ? `Registration: ${urlOnboarding.replace('_', ' ')}` : '',
            urlInactive ? 'Inactive 30+ days' : '',
            urlOrg ? `Company: ${orgFilterName}` : '',
          ].filter(Boolean).join(' + ')}
          count={users.filter(u => {
            const matchStatus = !urlStatus || u.access_status === urlStatus;
            const matchPersona = !urlPersona || u.persona === urlPersona;
            const matchOnboarding = !urlOnboarding || u.onboarding_status === urlOnboarding;
            const matchActivity = !urlInactive || isDormant(u);
            const matchOrg = !urlOrg || inUrlOrg(u);
            return matchStatus && matchPersona && matchOnboarding && matchActivity && matchOrg;
          }).length}
          onClear={() => {
            setSearchParams({}, { replace: true });
            setStatusFilter('all');
            setPersonaFilter('all');
            setOnboardingFilter('all');
            setInactiveOnly(false);
          }}
          color={urlStatus === 'pending' ? 'amber' : urlStatus === 'rejected' ? 'red' : 'blue'}
        />
      )}

      {/* Unconfirmed emails section */}
      {showUnconfirmed && unconfirmedUsers.length > 0 && (
        <AdminPanel
          icon={AlertTriangle}
          title={t('adm2.users.unconfirmedTitle', 'E-mail never confirmed ({{count}})', { count: unconfirmedUsers.length })}
          description={t('adm2.users.unconfirmedDesc', 'These accounts were created but the e-mail address was never confirmed. They have no profile yet.')}
          padded={false}
          className="mb-6 border-amber-200"
        >
          <ul className="divide-y divide-rule">
            {unconfirmedUsers.map(u => (
              <li key={u.id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <div className="min-w-0">
                  <span className="font-semibold text-navy">{u.first_name || u.last_name ? `${u.first_name || ''} ${u.last_name || ''}`.trim() : t('adm2.users.noName', 'No name')}</span>
                  <span className="ml-2 text-[14px] text-meta [overflow-wrap:anywhere]">{u.email}</span>
                  {u.persona && <AdminStatusPill className="ml-2">{personaLabel(u.persona)}</AdminStatusPill>}
                </div>
                <span className="shrink-0 text-[13px] text-meta">{t('adm2.users.createdOn', 'Created {{date}}', { date: fmtDay(u.created_at) })}</span>
              </li>
            ))}
          </ul>
        </AdminPanel>
      )}
      {/* Onboarding progress strip — quick overview of users still in the signup funnel */}
      {inProgressCount > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <AdminKpiCard
            label={t('adm2.users.kpiProgress', 'Still registering')}
            hint={t('adm2.users.kpiProgressHint', 'Press to show only them')}
            value={inProgressCount}
            selected={onboardingFilter === 'in_progress'}
            onClick={() => setOnboardingFilter(onboardingFilter === 'in_progress' ? 'all' : 'in_progress')}
          />
          <AdminKpiCard
            label={t('adm2.users.kpiDraft', 'Filling in their profile')}
            hint={t('adm2.users.kpiDraftHint', 'Not sent yet')}
            value={draftCount}
            selected={onboardingFilter === 'draft'}
            onClick={() => setOnboardingFilter(onboardingFilter === 'draft' ? 'all' : 'draft')}
          />
          <AdminKpiCard
            label={t('adm2.users.kpiSubmitted', 'Sent, waiting for M3')}
            hint={t('adm2.users.kpiSubmittedHint', 'Validate them in To validate')}
            value={submittedCount}
            selected={onboardingFilter === 'submitted'}
            onClick={() => setOnboardingFilter(onboardingFilter === 'submitted' ? 'all' : 'submitted')}
          />
          {onboardingFilter !== 'all' && (
            <button
              type="button"
              onClick={() => setOnboardingFilter('all')}
              className="rounded-card border border-dashed border-navy/40 bg-white p-4 text-left transition-colors hover:border-navy hover:bg-chip focus:outline-none focus-visible:shadow-focus"
            >
              <div className="text-[13px] text-meta">{t('adm2.users.clearKpi', 'The list is filtered')}</div>
              <div className="mt-1 text-[15px] font-semibold text-navy">{t('adm2.users.showAll', 'Show every account')}</div>
            </button>
          )}
        </div>
      )}

      <AdminFilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('adm2.users.search', 'Search a name, an e-mail, a company…')}
      >
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-44" aria-label={t('adm2.users.status', 'Status')}><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="verified">Validated</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
          </SelectContent>
        </Select>
        <Select value={onboardingFilter} onValueChange={setOnboardingFilter}>
          <SelectTrigger className="w-full sm:w-52" aria-label={t('adm2.users.onboarding', 'Registration')}><SelectValue placeholder="Registration" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All registration steps</SelectItem>
            <SelectItem value="in_progress">Still registering (any step)</SelectItem>
            <SelectItem value="draft">Filling in their profile</SelectItem>
            <SelectItem value="submitted">Sent, waiting for M3</SelectItem>
            <SelectItem value="under_review">Under review</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={personaFilter} onValueChange={setPersonaFilter}>
          <SelectTrigger className="w-full sm:w-48" aria-label={t('adm2.users.persona', 'Account type')}><SelectValue placeholder="Account type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All account types</SelectItem>
            {PERSONA_OPTIONS.map(p => <SelectItem key={p} value={p}>{personaLabel(p)}</SelectItem>)}
          </SelectContent>
        </Select>
      </AdminFilterBar>

      {filteredUsers.length === 0 ? (
        <div className="rounded-card border border-rule bg-white">
          <AdminEmpty icon={UserCheck} title={t('adm2.users.none', 'No account matches these filters')} />
        </div>
      ) : (
        <>
          {/* Phone and tablet (below 1280 px, where the table would scroll sideways): one card per person. The card is the link; the account type sits under it. */}
          <ul className="grid gap-3 lg:grid-cols-2 xl:hidden" aria-label={t('adm2.users.title', 'Accounts and export')}>
            {filteredUsers.map(user => (
              <li key={user.user_id} className="rounded-card border border-rule bg-white">
                <Link to={`/admin/users/${user.user_id}`} className="group block rounded-t-card p-4 focus:outline-none focus-visible:shadow-focus">
                  <p className="text-[16px] font-semibold leading-6 text-navy [overflow-wrap:anywhere]">{getUserName(user)}</p>
                  <p className="flex items-center gap-1 text-[13px] leading-5 text-meta [overflow-wrap:anywhere]">
                    {user.email || ''}
                    {emailStatusMap[user.user_id] === false && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-label="E-mail not confirmed" />}
                  </p>
                  {getOrgName(user) && <p className="text-[13px] leading-5 text-ink [overflow-wrap:anywhere]">{getOrgName(user)}</p>}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <AdminStatus status={user.access_status} label={user.access_status === 'verified' ? 'Validated' : undefined} />
                    {getOnboardingBadge(user)}
                    {user.org_tier && getTierBadge(user.org_tier)}
                    {user.persona === 'partner' && getReferenceBadge(user.user_id)}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-[13px] text-meta">{t('adm2.users.createdOn', 'Created {{date}}', { date: fmtDay(user.created_at) })}</span>
                    <ActionCue size="sm">{t('adm2.users.openAccount', 'Open the account')}</ActionCue>
                  </div>
                </Link>
                <div className="flex items-center gap-3 border-t border-rule px-4 py-3">
                  <span className="shrink-0 text-[13px] font-semibold text-navy">{t('adm2.users.persona', 'Account type')}</span>
                  {personaSelect(user, `${FIELD} flex-1 rounded-pill`)}
                </div>
              </li>
            ))}
          </ul>

          {/* Wide screens (1280 px and up): the table */}
          <AdminTableCard className="hidden xl:block" footer={t('adm2.users.footer', '{{shown}} of {{total}} accounts shown', { shown: filteredUsers.length, total: users.length })}>
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left">{t('adm2.users.colName', 'Name')}</th>
                  <th className="text-left">{t('adm2.users.colOrg', 'Company')}</th>
                  <th className="text-left">{t('adm2.users.persona', 'Account type')}</th>
                  <th className="text-left">{t('adm2.users.onboarding', 'Registration')}</th>
                  <th className="hidden text-left 2xl:table-cell">{t('adm2.users.colTier', 'Sponsor plan')}</th>
                  <th className="hidden text-left 2xl:table-cell">{t('adm2.users.colRefs', 'Recommendations')}</th>
                  <th className="text-left">{t('adm2.users.status', 'Status')}</th>
                  <th className="hidden text-left 2xl:table-cell">{t('adm2.users.colCreated', 'Created')}</th>
                  <th className="text-left"><span className="sr-only">{openLabel}</span></th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map(user => (
                  <tr key={user.user_id} className="group cursor-pointer" onClick={() => navigate(`/admin/users/${user.user_id}`)}>
                    <td className="min-w-[200px]">
                      <Link
                        to={`/admin/users/${user.user_id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded-sm font-semibold text-navy focus:outline-none focus-visible:shadow-focus"
                      >
                        <span className="card-ul">{getUserName(user)}</span>
                      </Link>
                      <div className="flex items-center gap-1 text-xs text-meta break-all">
                        {user.email || ''}
                        {emailStatusMap[user.user_id] === false && (
                          <span className="inline-flex items-center gap-0.5 text-amber-600" title="E-mail not confirmed">
                            <AlertTriangle className="h-3 w-3" aria-label="E-mail not confirmed" />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="text-sm text-ink">{getOrgName(user) || <span className="text-meta/60">—</span>}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {personaSelect(user, 'h-9 w-44 rounded-pill bg-white text-[13px]')}
                    </td>
                    <td>{getOnboardingBadge(user)}</td>
                    <td className="hidden 2xl:table-cell">{getTierBadge(user.org_tier)}</td>
                    <td className="hidden 2xl:table-cell">
                      {user.persona === 'partner' ? getReferenceBadge(user.user_id) : <span className="text-xs text-meta/60">—</span>}
                    </td>
                    <td>
                      {/* Read-only: a status changes in To validate or on the person's page, never in one click here. */}
                      <AdminStatus status={user.access_status} label={user.access_status === 'verified' ? 'Validated' : undefined} />
                    </td>
                    <td className="hidden 2xl:table-cell">
                      <span className="whitespace-nowrap text-sm text-meta">{fmtDay(user.created_at)}</span>
                    </td>
                    <td className="text-right"><ActionCue size="sm">{openLabel}</ActionCue></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTableCard>
        </>
      )}


      {/* ─── Create Admin Dialog ─── */}
      <Dialog open={createAdminOpen} onOpenChange={setCreateAdminOpen}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-md overflow-y-auto rounded-card p-4 sm:p-6">
          <DialogHeader className="pr-8 text-left">
            <DialogTitle className="text-[19px] leading-7 text-navy">{t('adm2.users.createTitle', 'Create an M3 admin account')}</DialogTitle>
            <DialogDescription className="text-[14px] leading-5 text-meta">
              {t('adm2.users.createDesc', 'For someone of the M3 team only: the account gets full access to the administration and is validated at once.')}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label={t('adm2.users.first', 'First name *')} htmlFor="ca-first">
                <Input id="ca-first" className={FIELD} value={createAdminForm.firstName} onChange={(e) => setCreateAdminForm({ ...createAdminForm, firstName: e.target.value })} />
              </FormField>
              <FormField label={t('adm2.users.last', 'Last name *')} htmlFor="ca-last">
                <Input id="ca-last" className={FIELD} value={createAdminForm.lastName} onChange={(e) => setCreateAdminForm({ ...createAdminForm, lastName: e.target.value })} />
              </FormField>
            </div>
            <FormField label={t('adm2.users.email', 'E-mail *')} htmlFor="ca-email">
              <Input id="ca-email" className={FIELD} type="email" value={createAdminForm.email} onChange={(e) => setCreateAdminForm({ ...createAdminForm, email: e.target.value })} placeholder="name@example.com" />
            </FormField>
            <FormField label={t('adm2.users.password', 'Password *')} htmlFor="ca-password" hint={t('adm2.users.passwordHint', 'At least 8 characters. Give it to them in person, never by e-mail.')}>
              <Input id="ca-password" className={FIELD} type="password" autoComplete="new-password" value={createAdminForm.password} onChange={(e) => setCreateAdminForm({ ...createAdminForm, password: e.target.value })} />
            </FormField>
            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
              <Button variant="outline" className={ADMIN_BTN} onClick={() => setCreateAdminOpen(false)}>{t('adm2.cancel', 'Cancel')}</Button>
              <Button variant="secondary" className={ADMIN_BTN_PRIMARY} onClick={handleCreateAdmin} disabled={creatingAdmin}>
                {creatingAdmin && <RefreshCw className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                {t('adm2.users.createButton', 'Create the admin account')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Invite Partner Dialog ─── */}
      <Dialog open={invitePartnerOpen} onOpenChange={setInvitePartnerOpen}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-md overflow-y-auto rounded-card p-4 sm:p-6">
          <DialogHeader className="pr-8 text-left">
            <DialogTitle className="text-[19px] leading-7 text-navy">{t('adm2.users.inviteTitle', 'Invite a service provider')}</DialogTitle>
            <DialogDescription className="text-[14px] leading-5 text-meta">
              {t('adm2.users.inviteDesc', 'Sends them a short e-mail that explains the 3 steps to sign up, with a link to create their account.')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <FormField label={t('adm2.users.inviteFirst', 'First name (optional, used to greet them)')} htmlFor="ip-first">
              <Input
                id="ip-first"
                className={FIELD}
                value={invitePartnerForm.firstName}
                onChange={(e) => setInvitePartnerForm({ ...invitePartnerForm, firstName: e.target.value })}
              />
            </FormField>
            <FormField label={t('adm2.users.inviteEmail', 'Their e-mail *')} htmlFor="ip-email">
              <Input
                id="ip-email"
                className={FIELD}
                type="email"
                value={invitePartnerForm.email}
                onChange={(e) => setInvitePartnerForm({ ...invitePartnerForm, email: e.target.value })}
                placeholder="name@example.com"
              />
            </FormField>
            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
              <Button variant="outline" className={ADMIN_BTN} onClick={() => setInvitePartnerOpen(false)}>{t('adm2.cancel', 'Cancel')}</Button>
              <Button
                variant="secondary"
                className={ADMIN_BTN_PRIMARY}
                onClick={async () => {
                  if (!invitePartnerForm.email.trim()) return;
                  setSendingPartnerInvite(true);
                  try {
                    await sendNotification({
                      type: 'partner_onboarding_welcome',
                      email: invitePartnerForm.email.trim(),
                      data: {
                        email: invitePartnerForm.email.trim(),
                        first_name: invitePartnerForm.firstName.trim(),
                      },
                    });
                    toast({ title: 'Invitation sent', description: `Onboarding guide sent to ${invitePartnerForm.email.trim()}.` });
                    setInvitePartnerForm({ email: '', firstName: '' });
                    setInvitePartnerOpen(false);
                  } catch {
                    toast({ title: 'Failed to send', description: 'Please try again.', variant: 'destructive' });
                  }
                  setSendingPartnerInvite(false);
                }}
                disabled={sendingPartnerInvite || !invitePartnerForm.email.trim()}
              >
                {sendingPartnerInvite && <RefreshCw className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                {t('adm2.users.inviteSend', 'Send the invitation e-mail')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
