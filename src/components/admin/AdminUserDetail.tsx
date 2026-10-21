import { useState, useEffect } from 'react';
import { externalUrl } from '@/lib/externalUrl';
import { useParams, useNavigate } from 'react-router-dom';
import { SM26ParticipationCard } from '@/components/sm26/SM26ParticipationCard';
import { AdminUserOrgs } from './AdminUserOrgs';
import { useTranslation } from 'react-i18next';
import {
  Save, Loader2, User, Building2, ExternalLink, UserCheck, FileCheck, FileMinus, Clock,
  ArrowUpCircle, ToggleLeft, Award, Eye, ShieldAlert, HelpCircle, XCircle, Globe, StickyNote,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { TIER_LABELS, OrgTier } from '@/types/database';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { CardLink } from '@/components/home/dashboard/DashboardKit';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { sendNotification } from '@/lib/notifications';
import { useRegistrationFlags } from '@/lib/flags';
import { ValidatePersonDialog } from './ValidatePersonDialog';
import type { PersonAction } from './review/reviewApi';
import { startImpersonation, PendingRecoveryError } from '@/lib/impersonation';
import { useAuth } from '@/contexts/AuthContext';
import type { AdminProfile } from './types';
import {
  AdminDetailHeader, AdminLoading, AdminPanel, AdminStatus, AdminStatusPill, statusLabel,
  ADMIN_BTN, ADMIN_BTN_DANGER, ADMIN_BTN_PRIMARY,
} from './AdminUI';
import { ActionLine, FIELD, FormField, fmtDay, orgTypeLabel, personaLabel, TierPill } from './AdminStyleKit';
import { Field, Note } from './v2/MembersKit';

/**
 * An account's settings screen (/admin/users/:id), opened from the person's page ("Account type
 * and feature access"), from Accounts and export and from a company's settings. Refonte admin
 * style (Oct 2026): panels, labelled fields, buttons that say what they do; changing the account
 * type, the sponsor plan, suspending and turning every feature on ask first. Same reads and
 * writes as before, except the company "admin notes" box: organizations has no admin_notes
 * column, so that save never stored anything; notes live on the company page (Notes tab).
 */

interface ReferenceItem {
  id: string;
  status: string;
  client_legal_name: string;
  confirmed_at: string | null;
  created_at: string;
}

interface ReferenceStatus {
  total: number;
  confirmed: number;
  pending: number;
  rejected: number;
  items: ReferenceItem[];
}

const PERSONA_OPTIONS = ['marina', 'partner', 'media_partner', 'developer', 'investor', 'moderator', 'admin', 'individual'];

/** profiles.onboarding_status, in plain words. */
const ONBOARDING_LABEL: Record<string, string> = {
  draft: 'Filling in their profile',
  submitted: 'Sent, waiting for M3',
  under_review: 'Under review',
  completed: 'Completed',
};

export function AdminUserDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const [viewingAs, setViewingAs] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [user, setUser] = useState<AdminProfile | null>(null);
  const [orgData, setOrgData] = useState<Record<string, unknown> | null>(null);
  const [sectors, setSectors] = useState<string[]>([]);
  const [refStatus, setRefStatus] = useState<ReferenceStatus | null>(null);

  // Editable fields
  const [persona, setPersona] = useState('');
  const [accessStatus, setAccessStatus] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);
  // Review list v2 (registration_flags.review_queue): Approve, Reject and Ask go through M3's
  // validation window (admin_validate_person: company, type, reason, e-mail). Off = as before.
  // Staff profiles (admin, moderator) keep the direct path: admin_validate_person refuses
  // them (staff_profile). Until the switches are read, Approve and Reject wait; a failed read
  // is never taken for "off" (src/lib/flags.ts): they keep waiting, with a retry.
  const { flags: regFlags, ready: flagsReady, failed: flagsFailed, retry: retryFlags } = useRegistrationFlags();
  const flagsKnown = flagsReady && !flagsFailed;
  const [validating, setValidating] = useState<PersonAction | null>(null);

  // Tier management
  const [updatingTier, setUpdatingTier] = useState(false);
  const [editingSeats, setEditingSeats] = useState<number | null>(null);

  // Feature entitlements (the keys are stored in entitlements.feature_key: never rename them)
  const FEATURE_DEFINITIONS: { key: string; label: string; description: string; personas?: string[] }[] = [
    { key: 'marketplace_access', label: 'Marketplace', description: 'Browse the marketplace and say they are interested' },
    { key: 'submit_project', label: 'Send projects', description: 'Send marina projects', personas: ['marina', 'developer'] },
    { key: 'submit_rfp', label: 'Send calls for tenders', description: 'Create requests for proposals', personas: ['marina', 'developer'] },
    { key: 'submit_consultation', label: 'Send consultations', description: 'Create consultation requests', personas: ['marina', 'developer'] },
    { key: 'request_webinar', label: 'Propose webinars', description: 'Propose and host webinars' },
    { key: 'b2b_matching', label: 'Connections', description: 'Send and receive connection requests' },
    { key: 'analytics_dashboard', label: 'Statistics', description: 'See the statistics of their company page' },
    { key: 'team_management', label: 'Team', description: 'Invite and manage their colleagues' },
    { key: 'document_upload', label: 'Documents', description: 'Upload company documents' },
    { key: 'expo_request', label: 'Exhibition stands', description: 'Ask for a stand at an exhibition' },
    { key: 'sponsorship_upgrade', label: 'Sponsorship', description: 'Ask to become a sponsor or change plan' },
  ];
  const [featureStates, setFeatureStates] = useState<Record<string, boolean>>({});
  const [featureLoading, setFeatureLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (id) loadUser(id);
  }, [id]);

  const loadUser = async (userId: string) => {
    setLoading(true);

    // Load profile
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('user_id, first_name, last_name, email, persona, access_status, onboarding_status, rejection_reason, created_at')
      .eq('user_id', userId)
      .single();

    if (error || !profile) {
      toast({ title: 'User not found', variant: 'destructive' });
      navigate('/admin/users');
      return;
    }

    // Load org membership
    const { data: membership } = await supabase
      .from('organization_members')
      .select('user_id, organization_id, organizations(id, name, tier, organization_type, access_status, max_seats, website, country, city, description, logo_url)')
      .eq('user_id', userId)
      .maybeSingle();

    const org = (membership?.organizations as unknown as Record<string, unknown>) || null;
    const merged: AdminProfile = {
      ...(profile as unknown as AdminProfile),
      org_name: (org?.name as string) || null,
      org_id: (org?.id as string) || null,
      org_tier: (org?.tier as string) || null,
      org_type: (org?.organization_type as string) || null,
      org_access_status: (org?.access_status as string) || null,
      org_max_seats: (org?.max_seats as number) || null,
      org_website: (org?.website as string) || null,
      org_country: (org?.country as string) || null,
      org_city: (org?.city as string) || null,
      org_description: (org?.description as string) || null,
      org_logo_url: (org?.logo_url as string) || null,
    };

    setUser(merged);
    setPersona(merged.persona);
    setAccessStatus(merged.access_status);
    setRejectReason('');
    setShowRejectForm(false);

    // Load org detail + sectors in parallel
    if (org?.id) {
      const orgId = org.id as string;
      const [{ data: orgDetail }, { data: sectorData }] = await Promise.all([
        // Only what the Organization card shows. Never '*': claim_code is not
        // readable by signed-in users (audit S2), and select=* then fails.
        supabase.from('organizations').select('id, name, slug, organization_type, country, city, website, access_status, description').eq('id', orgId).maybeSingle(),
        supabase
          .from(
            merged.persona === 'marina' || merged.persona === 'media_partner' || merged.persona === 'developer' || merged.persona === 'investor'
              ? 'organization_interest_sectors'
              : 'organization_service_sectors'
          )
          .select('sectors(label)')
          .eq('organization_id', orgId),
      ]);

      // For marina, also load marina details
      if (merged.persona === 'marina') {
        const { data: marinaDetails } = await supabase
          .from('organization_marina_details')
          .select('*')
          .eq('organization_id', orgId)
          .maybeSingle();
        setOrgData({ ...orgDetail, marina_details: marinaDetails } as Record<string, unknown>);
      } else {
        setOrgData(orgDetail as Record<string, unknown> | null);
      }

      setSectors((sectorData || []).map((s: Record<string, unknown>) => ((s.sectors as Record<string, unknown> | null)?.label as string) || '').filter(Boolean));

      // Load reference status for partners
      if (merged.persona === 'partner') {
        await loadReferenceStatus(orgId);
      }

      // Load feature entitlements
      const { data: entData } = await supabase
        .from('entitlements')
        .select('feature_key, enabled')
        .eq('organization_id', orgId);
      const fStates: Record<string, boolean> = {};
      for (const e of entData || []) fStates[e.feature_key] = e.enabled;
      setFeatureStates(fStates);
    } else {
      setOrgData(null);
      setSectors([]);
      setRefStatus(null);
      setFeatureStates({});
    }

    setLoading(false);
  };

  const loadReferenceStatus = async (orgId: string) => {
    const { data: refData } = await supabase
      .from('reference_requests')
      .select('id, partner_organization_id, status, client_legal_name, confirmed_at, created_at')
      .eq('partner_organization_id', orgId)
      .order('created_at', { ascending: false });

    const refs = refData || [];
    const confirmed = refs.filter((r: { status: string }) => r.status === 'confirmed').length;
    const pending = refs.filter((r: { status: string }) => r.status === 'pending' || r.status === 'sent').length;
    const rejected = refs.filter((r: { status: string }) => r.status === 'rejected').length;

    setRefStatus({
      total: refs.length,
      confirmed,
      pending,
      rejected,
      items: refs as ReferenceItem[],
    });
  };

  const handleSavePersona = async () => {
    if (!user || persona === user.persona) return;
    setSaving(true);
    const { error } = await supabase.from('profiles').update({ persona }).eq('user_id', user.user_id);
    setSaving(false);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: `Account type changed to ${personaLabel(persona)}` });
      loadUser(user.user_id);
    }
  };

  const handleApprove = async () => {
    if (!user) return;
    setSaving(true);

    const { error } = await supabase.from('profiles').update({ access_status: 'verified', onboarding_status: 'completed', rejection_reason: null }).eq('user_id', user.user_id);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); setSaving(false); return; }

    // Cascade to the org ONLY when this user is its owner and it's still pending.
    const { data: membership } = await supabase.from('organization_members').select('organization_id').eq('user_id', user.user_id).eq('role', 'owner').maybeSingle();
    if (membership?.organization_id) {
      await supabase.from('organizations').update({ access_status: 'verified', onboarding_status: 'completed' }).eq('id', membership.organization_id).eq('access_status', 'pending');
    }

    sendNotification({
      type: 'user_account_approved',
      userId: user.user_id,
      data: {
        first_name: user.first_name || '',
        org_name: user.org_name || '',
      },
    });
    toast({ title: 'Account validated' });
    setSaving(false);
    loadUser(user.user_id);
  };

  const handleReject = async () => {
    if (!user || !rejectReason.trim()) {
      toast({ title: 'Say why it is not accepted', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('profiles').update({ access_status: 'rejected', onboarding_status: 'draft', rejection_reason: rejectReason.trim() }).eq('user_id', user.user_id);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); setSaving(false); return; }

    // Cascade to the org ONLY when this user is its owner and it's still pending
    // — never reject an established org over one collaborator.
    const { data: membership } = await supabase.from('organization_members').select('organization_id').eq('user_id', user.user_id).eq('role', 'owner').maybeSingle();
    if (membership?.organization_id) {
      await supabase.from('organizations').update({ access_status: 'rejected', rejection_reason: rejectReason.trim() }).eq('id', membership.organization_id).eq('access_status', 'pending');
    }

    sendNotification({
      type: 'user_account_rejected',
      userId: user.user_id,
      data: {
        first_name: user.first_name || '',
        reason: rejectReason.trim(),
      },
    });
    toast({ title: 'Account not accepted' });
    setSaving(false);
    setShowRejectForm(false);
    loadUser(user.user_id);
  };

  const handleSuspend = async () => {
    if (!user) return;
    setSaving(true);
    await supabase.from('profiles').update({ access_status: 'suspended' }).eq('user_id', user.user_id);
    toast({ title: 'Account suspended' });
    setSaving(false);
    loadUser(user.user_id);
  };

  // handleSetPaymentPending removed — no payment flow

  const updateOrgTier = async (newTier: string) => {
    if (!user?.org_id) return;
    setUpdatingTier(true);
    const { data: tierConfig } = await supabase
      .from('organization_tier_config')
      .select('max_seats')
      .eq('tier', newTier)
      .single();
    const maxSeats = tierConfig?.max_seats || 1;
    const { error } = await supabase
      .from('organizations')
      .update({ tier: newTier, max_seats: maxSeats })
      .eq('id', user.org_id);
    setUpdatingTier(false);
    if (error) {
      toast({ title: 'The sponsor plan was not changed', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: `Sponsor plan changed to ${TIER_LABELS[newTier as OrgTier] || newTier}` });
      loadUser(user.user_id);
    }
  };

  const saveOrgSeats = async (seats: number) => {
    if (!user?.org_id) return;
    const { error } = await supabase.from('organizations').update({ max_seats: seats }).eq('id', user.org_id);
    if (error) {
      toast({ title: 'Failed', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: `Seats changed to ${seats}` });
      loadUser(user.user_id);
    }
    setEditingSeats(null);
  };

  const toggleFeature = async (featureKey: string, enabled: boolean) => {
    if (!user?.org_id) return;
    setFeatureLoading(prev => ({ ...prev, [featureKey]: true }));

    // Upsert entitlement row
    const { error } = await supabase
      .from('entitlements')
      .upsert(
        { organization_id: user.org_id, feature_key: featureKey, enabled, updated_at: new Date().toISOString() },
        { onConflict: 'organization_id,feature_key' }
      );

    if (error) {
      toast({ title: 'Failed to update feature', description: error.message, variant: 'destructive' });
    } else {
      setFeatureStates(prev => ({ ...prev, [featureKey]: enabled }));
      const label = FEATURE_DEFINITIONS.find(f => f.key === featureKey)?.label ?? featureKey.replace(/_/g, ' ');
      toast({ title: `${label}: ${enabled ? 'on' : 'off'}` });
    }
    setFeatureLoading(prev => ({ ...prev, [featureKey]: false }));
  };

  const enableAllFeatures = async () => {
    if (!user?.org_id) return;
    // Enable every defined feature, including cross-persona ones
    const keys = FEATURE_DEFINITIONS.map(f => f.key);
    for (const key of keys) {
      await supabase.from('entitlements').upsert(
        { organization_id: user.org_id, feature_key: key, enabled: true, updated_at: new Date().toISOString() },
        { onConflict: 'organization_id,feature_key' }
      );
    }
    const newStates: Record<string, boolean> = {};
    for (const key of keys) newStates[key] = true;
    setFeatureStates(prev => ({ ...prev, ...newStates }));
    toast({ title: 'Every feature is on' });
  };

  if (loading) return <AdminLoading />;

  if (!user) return null;

  // Review list v2 (registration_flags.review_queue), people only: Approve, Reject and Ask go
  // through M3's validation window (admin_validate_person: company, type, reason, e-mail).
  const validationV2 = regFlags.review_queue && user.persona !== 'admin' && user.persona !== 'moderator';
  const staff = user.persona === 'admin' || user.persona === 'moderator';

  const getUserName = () => {
    if (user.first_name || user.last_name) return `${user.first_name || ''} ${user.last_name || ''}`.trim();
    return user.email?.split('@')[0] || 'Unknown';
  };
  const name = getUserName();
  const statusText = (s: string | null | undefined) => (s === 'verified' ? 'Validated' : statusLabel(s));

  // Asking first (presentation): the handlers below are the ones the screen always had.
  const confirmSavePersona = () => {
    if (persona === user.persona) return;
    const toStaff = persona === 'admin' || persona === 'moderator';
    const msg = t('adm2.user.personaConfirm', 'Change the account type of {{name}} from "{{from}}" to "{{to}}"?', { name, from: personaLabel(user.persona), to: personaLabel(persona) })
      + (toStaff ? '\n\n' + t('adm2.users.personaStaff', 'This gives them access to the M3 administration.') : '');
    if (!window.confirm(msg)) return;
    handleSavePersona();
  };
  const confirmTier = (next: string) => {
    const current = user.org_tier || 'member';
    if (next === current) return;
    const msg = t('adm2.user.tierConfirm', 'Change the sponsor plan of {{org}} from "{{from}}" to "{{to}}"?\n\nIts number of seats is set to what the new plan allows.', {
      org: user.org_name || t('adm2.user.theCompany', 'the company'),
      from: TIER_LABELS[current as OrgTier] || current,
      to: TIER_LABELS[next as OrgTier] || next,
    });
    if (!window.confirm(msg)) return;
    updateOrgTier(next);
  };
  const confirmSuspend = () => {
    if (!window.confirm(t('adm2.user.suspendConfirm', 'Suspend the account of {{name}}?\n\nThey can no longer use the member area until it is validated again. No e-mail is sent.', { name }))) return;
    handleSuspend();
  };
  const confirmEnableAll = () => {
    if (!window.confirm(t('adm2.user.allOnConfirm', 'Turn on every feature for {{org}}, including those not usual for its account type?', { org: user.org_name || t('adm2.user.theCompany', 'the company') }))) return;
    enableAllFeatures();
  };

  const link = 'font-semibold text-teal-text underline decoration-teal/40 underline-offset-2 hover:text-navy';
  const marina = (orgData?.marina_details as Record<string, unknown> | null | undefined) || null;
  const seatsValue = editingSeats ?? user.org_max_seats ?? 1;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <AdminDetailHeader
        back={{ to: `/admin/people/${user.user_id}`, label: t('adm2.user.back', "Back to the person's page") }}
        title={name}
        leading={
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-pill bg-chip text-[17px] font-semibold text-navy" aria-hidden="true">
            {(user.first_name?.[0] || user.email?.[0] || '?').toUpperCase()}
          </span>
        }
        badges={
          <>
            <AdminStatusPill tone={staff ? 'navy' : 'neutral'}>{personaLabel(user.persona)}</AdminStatusPill>
            <AdminStatus status={user.access_status} label={statusText(user.access_status)} />
          </>
        }
        subtitle={t('adm2.user.subtitle', 'Account settings: validation, account type, sponsor plan and feature access.')}
        actions={
          isAdmin && id && !staff && (
          <Button
            variant="outline"
            size="sm"
            className={ADMIN_BTN}
            disabled={viewingAs}
            title="Open the platform in this user's own account to see exactly what they see"
            onClick={async () => {
              setViewingAs(true);
              try {
                await startImpersonation(id);
              } catch (e) {
                // Their password link dies if we proceed, so say so and let the
                // admin decide rather than breaking it silently.
                if (e instanceof PendingRecoveryError && window.confirm(`${e.message}\n\nView as them anyway?`)) {
                  try {
                    await startImpersonation(id, true);
                    return;
                  } catch (e2) {
                    toast({ title: 'Could not start view-as', description: (e2 as Error).message, variant: 'destructive' });
                    setViewingAs(false);
                    return;
                  }
                }
                if (!(e instanceof PendingRecoveryError)) {
                  toast({ title: 'Could not start view-as', description: (e as Error).message, variant: 'destructive' });
                }
                setViewingAs(false);
              }
            }}
          >
            {viewingAs ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Eye className="mr-2 h-4 w-4" aria-hidden="true" />}
            {viewingAs ? t('adm2.user.opening', 'Opening…') : t('adm2.user.viewAs', 'View as this person')}
          </Button>
        )
        }
      />

      {/* SM26 event participation — single source (sm_registration) */}
      {id && <SM26ParticipationCard userId={id} variant="admin" hideWhenEmpty={false} />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left column: who they are */}
        <div className="space-y-6">
          <AdminPanel icon={User} title={t('adm2.user.profile', 'Account')}>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Field label={t('adm2.user.first', 'First name')}>{user.first_name}</Field>
              <Field label={t('adm2.user.last', 'Last name')}>{user.last_name}</Field>
              <div className="sm:col-span-2"><Field label={t('adm2.user.email', 'E-mail')}>{user.email}</Field></div>
              <Field label={t('adm2.user.kind', 'Account type')}>{personaLabel(user.persona)}</Field>
              <Field label={t('adm2.user.status', 'Status')}>{statusText(user.access_status)}</Field>
              <Field label={t('adm2.user.onboarding', 'Registration')}>{ONBOARDING_LABEL[user.onboarding_status] ?? statusLabel(user.onboarding_status)}</Field>
              <Field label={t('adm2.user.created', 'Account created')}>
                {new Date(user.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </Field>
              {user.rejection_reason && (
                <div className="sm:col-span-2">
                  <Field label={t('adm2.user.reason', 'Why it was not accepted')}><span className="text-red-700">{user.rejection_reason}</span></Field>
                </div>
              )}
            </dl>
          </AdminPanel>

          {/* Company memberships (admin-managed multi-company) */}
          {id && <AdminUserOrgs userId={id} />}

          {/* Organization Info */}
          {orgData && (
            <AdminPanel icon={Building2} title={t('adm2.user.company', 'Their company')}>
              <dl className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2"><Field label={t('adm2.user.orgName', 'Name')}>{orgData.name as string}</Field></div>
                <Field label={t('adm2.user.orgType', 'Type')}>{orgData.organization_type ? orgTypeLabel(orgData.organization_type as string) : null}</Field>
                <Field label={t('adm2.user.orgTier', 'Sponsor plan')}><TierPill tier={user.org_tier} /></Field>
                <Field label={t('adm2.user.orgCountry', 'Country')}>{orgData.country as string}</Field>
                <Field label={t('adm2.user.orgCity', 'City')}>{orgData.city as string}</Field>
                <Field label={t('adm2.user.orgStatus', 'Status')}>{orgData.access_status ? statusText(orgData.access_status as string) : null}</Field>
                {!!orgData.website && (
                  <div className="sm:col-span-2">
                    <Field label={t('adm2.user.orgWebsite', 'Website')}>
                      <a href={externalUrl(orgData.website as string) ?? undefined} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1.5 ${link}`}>
                        <Globe className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="[overflow-wrap:anywhere]">{orgData.website as string}</span>
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span className="sr-only">{t('adm2.newTab', '(opens in a new tab)')}</span>
                      </a>
                    </Field>
                  </div>
                )}
                {typeof orgData.description === 'string' && orgData.description && (
                  <div className="sm:col-span-2">
                    <Field label={t('adm2.user.orgDesc', 'Description')}><span className="line-clamp-3">{orgData.description}</span></Field>
                  </div>
                )}
              </dl>
              {sectors.length > 0 && (
                <div className="mt-4">
                  <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-meta">{t('adm2.user.sectors', 'Sectors')}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {sectors.map(s => <AdminStatusPill key={s}>{s}</AdminStatusPill>)}
                  </div>
                </div>
              )}

              {/* Persona-specific org details */}
              {user.persona === 'marina' && !!marina && (
                <div className="mt-4 rounded-xl border border-rule bg-page/60 p-4">
                  <p className="text-[13px] font-semibold text-navy">{t('adm2.user.marina', 'Marina details')}</p>
                  <dl className="mt-2 grid grid-cols-2 gap-3">
                    <Field label={t('adm2.user.berths', 'Berths')}>{String(marina.berths_count ?? '')}</Field>
                    <Field label={t('adm2.user.marinaType', 'Type')}>{String(marina.marina_type ?? '')}</Field>
                    <Field label={t('adm2.user.superyacht', 'Superyacht berths')}>{String(marina.superyacht_berths ?? '')}</Field>
                    <Field label={t('adm2.user.longest', 'Longest berth (m)')}>{String(marina.longest_berth_meters ?? '')}</Field>
                  </dl>
                </div>
              )}

              <div className="mt-5 flex flex-wrap gap-2">
                {user.org_id && <CardLink to={`/admin/companies/${user.org_id}`}>{t('adm2.user.openCompany', 'Open the company page')}</CardLink>}
                {!!orgData.slug && (
                  <a
                    href={`/organizations/${orgData.slug as string}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-pill border border-navy/55 bg-white px-4 py-2 text-[15px] font-semibold leading-5 text-navy transition-colors hover:border-navy hover:bg-chip focus:outline-none focus-visible:shadow-focus"
                  >
                    {t('adm2.user.publicPage', 'See its public page')}
                    <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="sr-only">{t('adm2.newTab', '(opens in a new tab)')}</span>
                  </a>
                )}
              </div>
            </AdminPanel>
          )}

          {/* Notes: kept on the company page (organizations has no admin_notes column). */}
          {user.org_id && (
            <AdminPanel icon={StickyNote} title={t('adm2.user.notes', 'Internal notes')}>
              <p className="text-[14px] leading-5 text-ink">{t('adm2.user.notesWhere', 'Notes about this company and its people are kept on the company page.')}</p>
              <div className="mt-4"><CardLink to={`/admin/companies/${user.org_id}?tab=notes`}>{t('adm2.user.notesOpen', 'Open the company notes')}</CardLink></div>
            </AdminPanel>
          )}

          {/* Marina Recommendations (service providers only — informational) */}
          {user.persona === 'partner' && (
            <AdminPanel
              icon={Award}
              title={t('adm2.user.refs', 'Marina recommendations')}
              description={t('adm2.user.refsDesc', 'Optional; confirmed ones show on the service provider’s public page.')}
            >
              {refStatus ? (
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    {refStatus.confirmed > 0 ? (
                      <FileCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
                    ) : refStatus.total === 0 ? (
                      <FileMinus className="mt-0.5 h-5 w-5 shrink-0 text-meta" aria-hidden="true" />
                    ) : (
                      <Clock className="mt-0.5 h-5 w-5 shrink-0 text-teal" aria-hidden="true" />
                    )}
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold leading-6 text-navy">
                        {refStatus.confirmed > 0
                          ? `${refStatus.confirmed} confirmed recommendation${refStatus.confirmed > 1 ? 's' : ''}`
                          : refStatus.total === 0
                            ? t('adm2.user.refsNone', 'No recommendation asked for yet')
                            : t('adm2.user.refsWaiting', 'Waiting for the marinas to confirm')}
                      </p>
                      {refStatus.total > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          <AdminStatusPill>{`Total ${refStatus.total}`}</AdminStatusPill>
                          <AdminStatusPill tone="success">{`Confirmed ${refStatus.confirmed}`}</AdminStatusPill>
                          {refStatus.pending > 0 && <AdminStatusPill tone="warning">{`Waiting ${refStatus.pending}`}</AdminStatusPill>}
                          {refStatus.rejected > 0 && <AdminStatusPill tone="danger">{`Declined ${refStatus.rejected}`}</AdminStatusPill>}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Per-reference breakdown */}
                  {refStatus.items.length > 0 && (
                    <ul className="divide-y divide-rule rounded-xl border border-rule">
                      {refStatus.items.map((ref) => (
                        <li key={ref.id} className="flex flex-col gap-1.5 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                          <div className="min-w-0">
                            <p className="text-[14px] font-semibold leading-5 text-navy [overflow-wrap:anywhere]">{ref.client_legal_name || 'Unnamed client'}</p>
                            <p className="text-[13px] leading-[18px] text-meta">
                              {`Asked ${fmtDay(ref.created_at)}`}
                              {ref.confirmed_at && ` · Confirmed ${fmtDay(ref.confirmed_at)}`}
                            </p>
                          </div>
                          <AdminStatus status={ref.status} className="self-start sm:self-center" />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <p className="text-[14px] text-meta">{t('adm2.user.refsNoData', 'No recommendation data.')}</p>
              )}
            </AdminPanel>
          )}
        </div>

        {/* Right column: what M3 can change */}
        <div className="space-y-6">
          {/* Actions */}
          <AdminPanel
            icon={UserCheck}
            title={t('adm2.user.validation', 'Validation and access')}
            description={t('adm2.user.validationDesc', 'Current status: {{status}}.', { status: statusText(user.access_status) })}
          >
            <div className="space-y-4">
              {user.access_status !== 'verified' && (
                <ActionLine
                  text={validationV2
                    ? t('adm2.user.validateV2', 'Opens the validation window: company, account type, and the e-mail they receive.')
                    : t('adm2.user.validateV1', 'Gives them access to the member area and sends them the welcome e-mail.')}
                >
                  <Button
                    variant="secondary"
                    size="sm"
                    className={ADMIN_BTN_PRIMARY}
                    onClick={validationV2 ? () => setValidating('validate') : handleApprove}
                    disabled={saving || !flagsKnown}
                  >
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <UserCheck className="mr-2 h-4 w-4" aria-hidden="true" />}
                    {validationV2 ? t('adm2.user.validateBtn', 'Validate…') : t('adm2.user.approveBtn', 'Validate the account')}
                  </Button>
                </ActionLine>
              )}
              {validationV2 && user.access_status !== 'verified' && (
                <ActionLine divided text={t('adm2.user.askDesc', 'Sends them a question before deciding (in the validation window).')}>
                  <Button variant="outline" size="sm" className={ADMIN_BTN} onClick={() => setValidating('ask')}>
                    <HelpCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                    {t('adm2.user.askBtn', 'Ask for a detail…')}
                  </Button>
                </ActionLine>
              )}
              {user.access_status !== 'rejected' && !showRejectForm && (
                <ActionLine
                  divided={user.access_status !== 'verified'}
                  text={validationV2
                    ? t('adm2.user.rejectV2', 'Opens the validation window to say why it is not accepted.')
                    : t('adm2.user.rejectV1', 'Asks you why, then tells them by e-mail that the account is not accepted.')}
                >
                  <Button
                    variant="outline"
                    size="sm"
                    className={ADMIN_BTN_DANGER}
                    disabled={!flagsKnown}
                    onClick={() => (validationV2 ? setValidating('reject') : setShowRejectForm(true))}
                  >
                    <XCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                    {validationV2 ? t('adm2.user.rejectBtnV2', 'Not accepted…') : t('adm2.user.rejectBtnV1', 'Do not accept…')}
                  </Button>
                </ActionLine>
              )}
              {user.access_status !== 'suspended' && (
                <ActionLine divided text={t('adm2.user.suspendDesc', 'Blocks the member area for this person. No e-mail is sent.')}>
                  <Button variant="outline" size="sm" className={ADMIN_BTN_DANGER} onClick={confirmSuspend} disabled={saving}>
                    <ShieldAlert className="mr-2 h-4 w-4" aria-hidden="true" />
                    {t('adm2.user.suspendBtn', 'Suspend this account')}
                  </Button>
                </ActionLine>
              )}
              {/* Payment pending button removed — member tier is free */}

              {flagsFailed && user.access_status !== 'verified' && (
                <Note tone="warning">
                  {t('adm2.user.flagsFailed', 'The review settings could not be loaded, so Validate and Not accepted wait.')}{' '}
                  <button type="button" className="font-semibold underline underline-offset-2" onClick={retryFlags}>{t('adm2.tryAgain', 'Try again')}</button>
                </Note>
              )}

              {validating && id && (
                <ValidatePersonDialog
                  open
                  onOpenChange={(o) => { if (!o) setValidating(null); }}
                  userId={id}
                  initialAction={validating}
                  onDone={() => { loadUser(id); }}
                />
              )}

              {/* Reject form */}
              {showRejectForm && (
                <div className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-4">
                  <FormField
                    label={<span className="text-red-800">{t('adm2.user.rejectReason', 'Why is it not accepted? *')}</span>}
                    htmlFor="user-reject-reason"
                    hint={t('adm2.user.rejectHint', 'They receive this sentence in the e-mail.')}
                  >
                    <Textarea id="user-reject-reason" value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={3} className="bg-white" />
                  </FormField>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button variant="outline" size="sm" className={`${ADMIN_BTN_DANGER} border-red-300`} onClick={handleReject} disabled={saving || !rejectReason.trim()}>
                      {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <XCircle className="mr-2 h-4 w-4" aria-hidden="true" />}
                      {t('adm2.user.rejectConfirm', 'Confirm: not accepted, send the e-mail')}
                    </Button>
                    <Button variant="outline" size="sm" className={ADMIN_BTN} onClick={() => setShowRejectForm(false)}>{t('adm2.cancel', 'Cancel')}</Button>
                  </div>
                </div>
              )}
            </div>
          </AdminPanel>

          {/* Account type */}
          <AdminPanel
            icon={User}
            title={t('adm2.user.typeTitle', 'Account type')}
            description={t('adm2.user.typeDesc', 'What the platform shows them. M3 admin and M3 moderator open the administration.')}
          >
            <FormField label={t('adm2.user.typeLabel', 'Account type')} htmlFor="user-persona">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Select value={persona} onValueChange={setPersona}>
                  <SelectTrigger id="user-persona" className={`${FIELD} sm:w-56`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PERSONA_OPTIONS.map(p => <SelectItem key={p} value={p}>{personaLabel(p)}</SelectItem>)}
                  </SelectContent>
                </Select>
                {persona !== user.persona && (
                  <Button variant="secondary" size="sm" className={ADMIN_BTN_PRIMARY} onClick={confirmSavePersona} disabled={saving}>
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="mr-2 h-4 w-4" aria-hidden="true" />}
                    {t('adm2.user.typeSave', 'Save the account type')}
                  </Button>
                )}
              </div>
            </FormField>
          </AdminPanel>

          {/* Tier & Membership Management */}
          {user.org_id && (
            <AdminPanel
              icon={ArrowUpCircle}
              title={t('adm2.user.planTitle', 'Sponsor plan and seats of {{org}}', { org: user.org_name || t('adm2.user.theCompany', 'the company') })}
              description={t('adm2.user.planDesc', 'A paying plan lists the company as a sponsor. Member = free, not listed.')}
            >
              <div className="space-y-5">
                <FormField
                  label={t('adm2.user.planLabel', 'Sponsor plan')}
                  htmlFor="user-tier"
                  hint={t('adm2.user.planHint', 'Changes at once (it asks first) and sets the seats to what the plan allows.')}
                >
                  <div className="flex items-center gap-2">
                    <Select value={user.org_tier || 'member'} onValueChange={confirmTier} disabled={updatingTier}>
                      <SelectTrigger id="user-tier" className={`${FIELD} sm:w-56`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(TIER_LABELS) as OrgTier[]).map(k => <SelectItem key={k} value={k}>{TIER_LABELS[k]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {updatingTier && <Loader2 className="h-4 w-4 animate-spin text-meta" aria-label={t('adm2.saving', 'Saving')} />}
                  </div>
                </FormField>

                <FormField
                  label={t('adm2.user.seatsLabel', 'Seats (people who can join)')}
                  htmlFor="user-seats"
                  className="border-t border-rule pt-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      id="user-seats"
                      type="number"
                      min={1}
                      max={100}
                      className={`${FIELD} w-28`}
                      value={seatsValue}
                      onChange={(e) => setEditingSeats(parseInt(e.target.value) || 1)}
                    />
                    {editingSeats !== null && editingSeats !== user.org_max_seats && (
                      <Button size="sm" variant="outline" className={ADMIN_BTN} onClick={() => saveOrgSeats(editingSeats)}>
                        <Save className="mr-2 h-4 w-4" aria-hidden="true" />
                        {t('adm2.user.seatsSave', 'Save the seats')}
                      </Button>
                    )}
                  </div>
                </FormField>
              </div>
            </AdminPanel>
          )}

          {/* Feature Access Toggles */}
          {user.org_id && (
            <AdminPanel
              icon={ToggleLeft}
              title={t('adm2.user.featuresTitle', 'Feature access')}
              description={t('adm2.user.featuresDesc', 'For the whole company. Each switch applies at once.')}
              padded={false}
              actions={
                <Button variant="outline" size="sm" className={ADMIN_BTN} onClick={confirmEnableAll}>
                  {t('adm2.user.allOn', 'Turn everything on')}
                </Button>
              }
            >
              <ul className="divide-y divide-rule">
                {FEATURE_DEFINITIONS.map(feature => {
                  const isNative = !feature.personas || feature.personas.includes(user.persona);
                  const on = featureStates[feature.key] ?? false;
                  const switchId = `feature-${feature.key}`;
                  return (
                    <li key={feature.key} className="flex items-start justify-between gap-4 px-5 py-3">
                      <label htmlFor={switchId} className="min-w-0 flex-1 cursor-pointer">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-[14px] font-semibold leading-5 text-navy">{feature.label}</span>
                          {!isNative && <AdminStatusPill tone="warning">{t('adm2.user.notUsual', 'Not usual for this account type')}</AdminStatusPill>}
                        </span>
                        <span className="mt-0.5 block text-[13px] leading-[18px] text-meta">
                          {feature.description}
                          {!isNative && feature.personas && (
                            <span className="text-amber-800">
                              {` — normally for ${feature.personas.map(p => personaLabel(p)).join(' and ')} only. Turning it on gives them access by hand.`}
                            </span>
                          )}
                        </span>
                      </label>
                      <span className="flex shrink-0 items-center gap-2 pt-0.5">
                        <span className="w-7 text-right text-[12px] font-semibold text-meta" aria-hidden="true">{on ? 'On' : 'Off'}</span>
                        <Switch
                          id={switchId}
                          checked={on}
                          onCheckedChange={(checked) => toggleFeature(feature.key, checked)}
                          disabled={featureLoading[feature.key]}
                        />
                      </span>
                    </li>
                  );
                })}
              </ul>
            </AdminPanel>
          )}
        </div>
      </div>
    </div>
  );
}
