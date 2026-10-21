import { useState, useEffect } from 'react';
import { externalUrl } from '@/lib/externalUrl';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SM26SectorSuggestions } from '@/components/admin/SM26SectorSuggestions';
import { SM26ParticipationCard } from '@/components/sm26/SM26ParticipationCard';
import {
  Save, Loader2, Building2, Globe, Users, UserPlus,
  ExternalLink, Anchor, Copy, CheckCircle, Shield,
  KeyRound, Send, Archive, ArchiveRestore, Crown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { TIER_LABELS, OrgTier } from '@/types/database';
import { ActionCue, CardLink } from '@/components/home/dashboard/DashboardKit';
import {
  AdminDetailHeader, AdminEmpty, AdminLoading, AdminPanel, AdminStatus, AdminStatusPill, ADMIN_BTN, ADMIN_BTN_PRIMARY,
} from './AdminUI';
import { FIELD, FormField, fmtDay, orgTypeLabel, personaLabel, TierPill } from './AdminStyleKit';
import { Field, Note } from './v2/MembersKit';
import { archiveOrg, markDuplicateOrg, reviewErrorText } from './review/reviewApi';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { sendNotification } from '@/lib/notifications';

/**
 * A company's settings screen (/admin/organizations/:id), opened from the company page
 * ("Plan, claim code and other settings") and from To validate. Refonte admin style
 * (Oct 2026): panels, labelled fields, buttons that say what they do; the members list
 * shows each person with an "Open their account" pill. Same reads and writes as before.
 */

/* ─── Types ─── */

interface OrgDetail {
  id: string;
  name: string;
  slug: string;
  primary_domain: string | null;
  organization_type: string | null;
  tier: string;
  max_seats: number;
  logo_url: string | null;
  website: string | null;
  description: string | null;
  country: string | null;
  city: string | null;
  headquarters_country: string | null;
  access_status: string;
  onboarding_status: string;
  rejection_reason: string | null;
  auto_approve_domain_joins: boolean;
  featured_partner: boolean;
  is_event_media_partner: boolean;
  created_at: string;
  updated_at: string;
  owner_user_id: string | null;
}

interface MemberRow {
  id: string;
  user_id: string;
  role: string;
  joined_at: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  persona: string | null;
  access_status: string | null;
}

interface MarinaDetails {
  marina_type: string | null;
  berths_count: number | null;
  superyacht_berths: number | null;
  longest_berth_meters: number | null;
  marina_description: string | null;
  services_description: string | null;
  has_yacht_club: boolean;
  has_sailing_school: boolean;
  has_boat_yard: boolean;
  has_restaurants: boolean;
  restaurants_count: number | null;
  has_concierge: boolean;
  certifications: string[];
}

// Every organizations column except claim_code. Never select '*': claim_code is
// not readable through the table by signed-in users, staff included (audit S2),
// and select=* is then refused as a whole. The code goes through the
// admin_get_org_claim_code / admin_set_org_claim_code RPCs instead.
const ORG_COLUMNS =
  'id, name, slug, primary_domain, organization_type, tier, max_seats, created_by_user_id, owner_user_id, logo_url, description, website, country, city, created_at, updated_at, access_status, onboarding_status, rejection_reason, audience_description, headquarters_country, social_media_links, marina_subtype, auto_approve_domain_joins, banner_url, investment_geographies, investment_size_min, investment_size_max, investment_hold_period, investment_thesis, featured_partner, gallery, is_event_media_partner';

/** organizations.archived_at / duplicate_of (migration 20261016090000) and the survivor's name. */
interface Listing {
  archived_at: string | null;
  duplicate_of: string | null;
  survivor: { id: string; name: string } | null;
}

const STATUS_OPTIONS = ['verified', 'pending', 'rejected', 'suspended'];
// organizations.onboarding_status is plain text (no enum, no check). These are
// the values the app actually writes; it matters because an organization only
// counts as fully onboarded — and, downstream, as commercially eligible — when
// it is 'completed'. Without this control the only way to set it was raw SQL:
// the user-facing admin screens filter on profiles.access_status, not on the
// organization's onboarding_status.
const ONBOARDING_OPTIONS = ['draft', 'submitted', 'completed'];

export function AdminOrganizationDetail() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [marina, setMarina] = useState<MarinaDetails | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [sendingInvite, setSendingInvite] = useState(false);
  const [memberEmail, setMemberEmail] = useState('');
  const [memberFirst, setMemberFirst] = useState('');
  const [memberLast, setMemberLast] = useState('');
  const [invitingMember, setInvitingMember] = useState(false);

  // Editable fields
  const [status, setStatus] = useState('');
  const [onboardingStatus, setOnboardingStatus] = useState('');
  const [settingOwner, setSettingOwner] = useState<string | null>(null);
  const [tier, setTier] = useState('');
  const [maxSeats, setMaxSeats] = useState(5);
  const [rejectionReason, setRejectionReason] = useState('');
  const [claimCode, setClaimCode] = useState('');
  // The code as stored (from admin_get_org_claim_code). "Send Connect Link"
  // always sends this one, never an unsaved edit.
  const [savedClaimCode, setSavedClaimCode] = useState('');
  // false when the code could not be read (RPC refused or not deployed yet):
  // the editor is then locked so a save can never blank the stored code.
  const [claimCodeReady, setClaimCodeReady] = useState(false);
  const [featured, setFeatured] = useState(false);
  const [mediaPartner, setMediaPartner] = useState(false);
  // Listing (registration Phase 3): archived, or marked as a duplicate, by M3 from the review
  // queue. Read apart from ORG_COLUMNS: before migration 20261016090000 the two columns do not
  // exist, the read fails and the block stays hidden (the rest of the page is unaffected).
  const [listing, setListing] = useState<Listing | null>(null);
  const [listingBusy, setListingBusy] = useState(false);

  useEffect(() => { if (id) loadOrg(); }, [id]);

  const loadListing = async (orgId: string) => {
    const { data, error } = await supabase.from('organizations').select('archived_at, duplicate_of').eq('id', orgId).maybeSingle();
    if (error || !data) { setListing(null); return; }
    const row = data as { archived_at: string | null; duplicate_of: string | null };
    let survivor: Listing['survivor'] = null;
    if (row.duplicate_of) {
      const { data: s } = await supabase.from('organizations').select('id, name').eq('id', row.duplicate_of).maybeSingle();
      survivor = { id: row.duplicate_of, name: (s as { name?: string } | null)?.name || '' };
    }
    setListing({ archived_at: row.archived_at, duplicate_of: row.duplicate_of, survivor });
  };

  // admin_archive_org(false) / admin_mark_duplicate_org(null): verified admins, logged by the server.
  const restoreListing = async (what: 'archive' | 'duplicate') => {
    if (!org) return;
    setListingBusy(true);
    try {
      if (what === 'archive') await archiveOrg(org.id, false);
      else await markDuplicateOrg(org.id, null);
      toast({
        title: what === 'archive'
          ? t('admin.orgListing.relisted', '{{name}} is listed again', { name: org.name })
          : t('admin.orgListing.unmarked', '{{name}} is no longer marked as a duplicate', { name: org.name }),
        description: t('admin.orgListing.shownAgain', 'It shows again in the directory, company search and matching.'),
      });
      await loadListing(org.id);
    } catch (e) {
      toast({ title: t('admin.orgListing.failed', 'Nothing was changed'), description: reviewErrorText(e, t), variant: 'destructive' });
    }
    setListingBusy(false);
  };

  const loadOrg = async () => {
    setLoading(true);
    setListing(null);
    if (id) void loadListing(id);
    const [{ data: orgData }, { data: memberData }, { data: marinaData }, codeRes] = await Promise.all([
      supabase.from('organizations').select(ORG_COLUMNS).eq('id', id!).single(),
      supabase.from('organization_members').select('id, user_id, role, joined_at').eq('organization_id', id!),
      supabase.from('organization_marina_details').select('*').eq('organization_id', id!).maybeSingle(),
      // claim_code is staff-only (audit S2): verified admins read it here.
      supabase.rpc('admin_get_org_claim_code', { p_org_id: id! }),
    ]);

    if (!orgData) { setLoading(false); return; }

    // Fetch member profiles
    const userIds = (memberData || []).map((m: { user_id: string }) => m.user_id);
    const { data: profiles } = userIds.length > 0
      ? await supabase.from('profiles').select('user_id, first_name, last_name, email, persona, access_status').in('user_id', userIds)
      : { data: [] };
    const profileMap = new Map((profiles || []).map((p: any) => [p.user_id, p]));

    const enrichedMembers: MemberRow[] = (memberData || []).map((m: any) => {
      const p = profileMap.get(m.user_id) as any;
      return {
        ...m,
        first_name: p?.first_name || null,
        last_name: p?.last_name || null,
        email: p?.email || null,
        persona: p?.persona || null,
        access_status: p?.access_status || null,
      };
    });

    setOrg(orgData as OrgDetail);
    setMembers(enrichedMembers);
    setMarina(marinaData as MarinaDetails | null);
    setStatus(orgData.access_status);
    setOnboardingStatus(orgData.onboarding_status);
    setTier(orgData.tier);
    setMaxSeats(orgData.max_seats);
    setRejectionReason(orgData.rejection_reason || '');
    if (codeRes.error) {
      setClaimCodeReady(false);
      setSavedClaimCode('');
      setClaimCode('');
    } else {
      const code = typeof codeRes.data === 'string' ? codeRes.data : '';
      setClaimCodeReady(true);
      setSavedClaimCode(code);
      setClaimCode(code);
    }
    setFeatured(orgData.featured_partner || false);
    setMediaPartner(orgData.is_event_media_partner || false);
    setLoading(false);
  };

  // Designate an owner. transfer_org_ownership cannot do this — it requires the
  // caller to BE the current owner, so an organization that ended up without one
  // (e.g. a pre-created marina whose manager was attached as a collaborator)
  // was unrecoverable except by hand.
  const handleSetOwner = async (m: MemberRow) => {
    if (!org) return;
    const label = [m.first_name, m.last_name].filter(Boolean).join(' ') || m.email || 'this member';
    if (!window.confirm(`Make ${label} the person in charge of ${org.name}?\n\nThe current person in charge, if any, becomes a member.`)) return;
    setSettingOwner(m.user_id);
    const { error } = await supabase.rpc('admin_set_org_owner', { p_org_id: org.id, p_user_id: m.user_id });
    setSettingOwner(null);
    if (error) { toast({ title: 'Could not change the person in charge', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Person in charge changed', description: `${label} is now in charge of ${org.name}.` });
    await loadOrg();
  };

  const handleSave = async () => {
    if (!org) return;
    setSaving(true);
    const updates: Record<string, unknown> = {
      access_status: status,
      onboarding_status: onboardingStatus,
      tier,
      max_seats: maxSeats,
      rejection_reason: status === 'rejected' ? rejectionReason : null,
      featured_partner: featured,
      is_event_media_partner: mediaPartner,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from('organizations').update(updates).eq('id', org.id);
    if (error) {
      toast({ title: 'Error saving', description: error.message, variant: 'destructive' });
      setSaving(false);
      return;
    }

    // The claim code is written through the admin RPC (audit S2), and only
    // when it was actually changed.
    const nextCode = claimCode.trim().toUpperCase();
    if (claimCodeReady && nextCode !== savedClaimCode) {
      const { error: codeError } = await supabase.rpc('admin_set_org_claim_code', {
        p_org_id: org.id,
        p_claim_code: nextCode || null,
      });
      if (codeError) {
        // Keep the typed code on screen so it can be corrected.
        toast({
          title: t('admin.orgClaimCode.saveFailed', 'Organisation updated, but the claim code was not saved'),
          description: codeError.message,
          variant: 'destructive',
        });
        setSaving(false);
        return;
      }
    }

    toast({ title: 'Settings saved' });
    await loadOrg();
    setSaving(false);
  };

  const copyCode = () => {
    if (!claimCode) return;
    navigator.clipboard.writeText(claimCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  };

  // Invite a colleague on the organisation's behalf. Until now only the OWNER
  // could invite anyone — every policy on organization_invitations tests
  // role='owner' — which fails in the one case where help is needed most: the
  // owner is locked out or has left, so nobody can add their replacement. The
  // RPC is admin-gated, reuses a live invitation rather than duplicating it, and
  // frees a seat when the organisation is full (a plan limit should not stand
  // between M3 and a rescue).
  const handleAdminInvite = async () => {
    const email = memberEmail.trim();
    if (!email || !org) return;
    setInvitingMember(true);
    try {
      const { data, error } = await supabase.rpc('admin_invite_org_member', {
        p_organization_id: org.id,
        p_email: email,
        p_first_name: memberFirst.trim() || null,
        p_last_name: memberLast.trim() || null,
      });
      if (error) throw error;
      const res = data as { ok?: boolean; reason?: string; invitation_id?: string; reused?: boolean; seats_raised?: boolean; max_seats?: number };
      if (!res?.ok) {
        toast({
          title: res?.reason === 'already_member' ? 'Already in this team' : 'Could not invite',
          description: res?.reason === 'already_member' ? `${email} is already a member of ${org.name}.` : undefined,
          variant: 'destructive',
        });
        return;
      }
      await sendNotification({
        type: 'team_invitation',
        email,
        data: {
          org_name: org.name,
          inviter_name: 'Smart Marina Connect',
          signup_url: `${window.location.origin}/join/${res.invitation_id}`,
          first_name: memberFirst.trim() || '',
        },
      });
      toast({
        title: res.reused ? 'Invitation re-sent' : 'Invitation sent',
        description: [
          `${email} can now join ${org.name}.`,
          res.seats_raised ? `The team was full, so seats were raised to ${res.max_seats}.` : '',
        ].filter(Boolean).join(' '),
      });
      setMemberEmail(''); setMemberFirst(''); setMemberLast('');
      await loadOrg();
    } catch (err: unknown) {
      toast({ title: 'Could not invite', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    }
    setInvitingMember(false);
  };

  // The code typed in the editor differs from the stored one: it would not work
  // until saved, so it must not be e-mailed.
  const claimCodeDirty = claimCode.trim().toUpperCase() !== savedClaimCode;
  // A company that already has an owner cannot be claimed with its code (the database refuses
  // it since 15 Oct, Victor 11 Oct): its Connect link would only lead to that refusal.
  const orgOwned = !!org?.owner_user_id || members.some(m => m.role === 'owner');

  const handleSendConnectLink = async () => {
    // Always the stored code (from admin_get_org_claim_code), never an unsaved edit.
    if (!inviteEmail.trim() || !savedClaimCode || claimCodeDirty || !org || orgOwned) return;
    setSendingInvite(true);
    try {
      await sendNotification({
        type: 'org_claim_code',
        email: inviteEmail.trim(),
        data: {
          org_name: org.name,
          claim_code: savedClaimCode,
          email: inviteEmail.trim(),
        },
      });
      toast({ title: 'Connect link sent', description: `Email sent to ${inviteEmail.trim()} with claim code ${savedClaimCode}.` });
      setInviteEmail('');
    } catch {
      toast({ title: 'Failed to send', description: 'Please try again.', variant: 'destructive' });
    }
    setSendingInvite(false);
  };

  if (loading) return <AdminLoading />;

  if (!org) return (
    <div className="mx-auto max-w-3xl rounded-card border border-rule bg-white">
      <AdminEmpty
        icon={Building2}
        title={t('adm2.org.notFound', 'This company was not found')}
        action={<CardLink to="/admin/companies">{t('adm2.org.backToList', 'Back to Companies')}</CardLink>}
      />
    </div>
  );

  const roleLabel = (role: string) => role === 'owner'
    ? t('adm2.org.roleOwner', 'Person in charge')
    : role === 'collaborator' ? t('adm2.org.roleMember', 'Member') : role.charAt(0).toUpperCase() + role.slice(1);
  const saveButton = (extra?: string) => (
    <Button variant="secondary" size="sm" className={[ADMIN_BTN_PRIMARY, extra].filter(Boolean).join(' ')} onClick={handleSave} disabled={saving}>
      {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="mr-2 h-4 w-4" aria-hidden="true" />}
      {t('adm2.org.save', 'Save the settings')}
    </Button>
  );
  const link = 'font-semibold text-teal-text underline decoration-teal/40 underline-offset-2 hover:text-navy';

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <AdminDetailHeader
        back={{ to: `/admin/companies/${org.id}`, label: t('adm2.org.back', 'Back to the company page') }}
        title={org.name}
        leading={
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-rule bg-white">
            {org.logo_url ? (
              <img src={org.logo_url} alt="" className="h-full w-full object-contain p-0.5" />
            ) : (
              <Building2 className="h-6 w-6 text-meta/60" aria-hidden="true" />
            )}
          </div>
        }
        badges={
          <>
            <AdminStatus status={org.access_status} />
            {org.organization_type && <AdminStatusPill>{orgTypeLabel(org.organization_type)}</AdminStatusPill>}
            <TierPill tier={org.tier} />
            {listing?.archived_at && <AdminStatusPill icon={Archive}>{t('admin.orgListing.archivedPill', 'Archived')}</AdminStatusPill>}
            {listing?.duplicate_of && <AdminStatusPill>{t('admin.orgListing.duplicatePill', 'Duplicate')}</AdminStatusPill>}
          </>
        }
        subtitle={t('adm2.org.subtitle', 'Settings: access, sponsor plan, seats, claim code and team.')}
        actions={saveButton()}
      />

      {/* Listing: archived or marked as a duplicate from the review queue; M3 can undo it here. */}
      {listing && (listing.archived_at || listing.duplicate_of) && (
        <div role="status" className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-[14px] leading-5 text-navy">
          {listing.archived_at && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p>
                <span className="font-semibold">
                  {t('admin.orgListing.archivedOn', 'Archived on {{date}}.', { date: new Date(listing.archived_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) })}
                </span>{' '}
                {t('admin.orgListing.archivedBody', 'Hidden from the directory, company search and matching; it gives no rights.')}
              </p>
              <Button variant="outline" size="sm" className={`${ADMIN_BTN} shrink-0 self-start sm:self-auto`} onClick={() => restoreListing('archive')} disabled={listingBusy}>
                {listingBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArchiveRestore className="mr-2 h-4 w-4" />}
                {t('admin.orgListing.relist', 'List again')}
              </Button>
            </div>
          )}
          {listing.duplicate_of && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="[overflow-wrap:anywhere]">
                <span className="font-semibold">{t('admin.orgListing.duplicateOf', 'Marked as a duplicate of')}</span>{' '}
                <Link to={`/admin/organizations/${listing.duplicate_of}`} className={link}>
                  {listing.survivor?.name || t('admin.orgListing.anotherCompany', 'another company')}
                </Link>
                {'. '}
                {t('admin.orgListing.duplicateBody', 'Hidden like an archived company until the two are merged.')}
              </p>
              <Button variant="outline" size="sm" className={`${ADMIN_BTN} shrink-0 self-start sm:self-auto`} onClick={() => restoreListing('duplicate')} disabled={listingBusy}>
                {listingBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArchiveRestore className="mr-2 h-4 w-4" />}
                {t('admin.orgListing.notDuplicate', 'Not a duplicate')}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* SM26 event participation linked to this organization (single source: sm_registration) */}
      {id && <SM26ParticipationCard organizationId={id} companyName={org.name} variant="admin" hideWhenEmpty={false} />}

      {/* D2 crosswalk: sectors suggested from this org's SM26 innovation categories (self-hides if none) */}
      {id && <SM26SectorSuggestions orgId={id} />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left column: what the company is */}
        <div className="space-y-6">
          <AdminPanel icon={Building2} title={t('adm2.org.details', 'Company details')}>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Field label={t('adm2.org.slug', 'Address on the site')}><span className="font-mono text-[14px]">{org.slug}</span></Field>
              <Field label={t('adm2.org.domain', 'E-mail domain')}>{org.primary_domain}</Field>
              <Field label={t('adm2.org.country', 'Country')}>{org.country}</Field>
              <Field label={t('adm2.org.city', 'City')}>{org.city}</Field>
              {org.website && (
                <div className="sm:col-span-2">
                  <Field label={t('adm2.org.website', 'Website')}>
                    <a href={externalUrl(org.website) ?? undefined} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1.5 ${link}`}>
                      <Globe className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="[overflow-wrap:anywhere]">{org.website}</span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="sr-only">{t('adm2.newTab', '(opens in a new tab)')}</span>
                    </a>
                  </Field>
                </div>
              )}
              {org.description && (
                <div className="sm:col-span-2">
                  <Field label={t('adm2.org.description', 'Description')}><span className="whitespace-pre-wrap">{org.description}</span></Field>
                </div>
              )}
            </dl>
            <p className="mt-4 text-[13px] leading-5 text-meta">
              {t('adm2.org.dates', 'Created {{created}} · last change {{updated}}', { created: fmtDay(org.created_at), updated: fmtDay(org.updated_at) })}
            </p>
          </AdminPanel>

          {/* Claim Code & Send Connect Link */}
          <AdminPanel
            icon={KeyRound}
            title={t('adm2.org.claimTitle', 'Claim code')}
            description={t('adm2.org.claimDesc', 'A person types this code when they sign up, to join this company.')}
          >
            <div className="space-y-4">
              <FormField
                label={t('adm2.org.claimLabel', 'The code')}
                htmlFor="org-claim-code"
                hint={claimCodeReady
                  ? t('adm2.org.claimHint', 'A new code takes effect when you press "Save the settings".')
                  : <span className="text-amber-800">{t('admin.orgClaimCode.unavailable', 'The claim code could not be loaded. Only verified admins can see it; reload the page to try again.')}</span>}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    id="org-claim-code"
                    value={claimCode}
                    onChange={(e) => setClaimCode(e.target.value.toUpperCase())}
                    // Fake example on purpose: the bundle and the repo are public, so never put a real code here.
                    placeholder={t('admin.orgClaimCode.placeholder', 'e.g. ABC-1234')}
                    disabled={!claimCodeReady}
                    className={`${FIELD} max-w-[220px] font-mono uppercase tracking-wider`}
                  />
                  {claimCode && (
                    <Button type="button" variant="outline" size="sm" className={ADMIN_BTN} onClick={copyCode}>
                      {codeCopied ? <CheckCircle className="mr-2 h-4 w-4 text-emerald-600" aria-hidden="true" /> : <Copy className="mr-2 h-4 w-4" aria-hidden="true" />}
                      {codeCopied ? t('adm2.org.copied', 'Copied') : t('adm2.org.copy', 'Copy the code')}
                    </Button>
                  )}
                </div>
              </FormField>

              {savedClaimCode && orgOwned && (
                <div className="border-t border-rule pt-4">
                  <Note>{t('admin.orgClaimCode.owned', 'This company already has an owner on Smart Marina Connect, so its code cannot add anyone. To bring someone in, ask the owner to invite them to the team, or use "Invite a colleague" in the Members box.')}</Note>
                </div>
              )}
              {savedClaimCode && !orgOwned && (
                <div className="border-t border-rule pt-4">
                  <FormField
                    label={t('adm2.org.sendLabel', 'Send the code by e-mail')}
                    htmlFor="org-connect-email"
                    hint={claimCodeDirty
                      ? <span className="text-amber-800">{t('admin.orgClaimCode.saveBeforeSend', 'Save the new code first: the e-mail always carries the saved code.')}</span>
                      : t('adm2.org.sendHint', 'They get an e-mail with the code and how to sign up.')}
                  >
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        id="org-connect-email"
                        type="email"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder="name@example.com"
                        className={FIELD}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className={`${ADMIN_BTN} shrink-0`}
                        onClick={handleSendConnectLink}
                        disabled={sendingInvite || !inviteEmail.trim() || claimCodeDirty}
                      >
                        {sendingInvite ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="mr-2 h-4 w-4" aria-hidden="true" />}
                        {sendingInvite ? t('adm2.sending', 'Sending…') : t('adm2.org.send', 'Send the e-mail')}
                      </Button>
                    </div>
                  </FormField>
                </div>
              )}
            </div>
          </AdminPanel>

          {/* Marina Details */}
          {marina && (
            <AdminPanel icon={Anchor} title={t('adm2.org.marina', 'Marina details')}>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Field label={t('adm2.org.marinaType', 'Type')}>{marina.marina_type}</Field>
                <Field label={t('adm2.org.berths', 'Berths')}>{marina.berths_count ?? null}</Field>
                <Field label={t('adm2.org.superyacht', 'Superyacht berths')}>{marina.superyacht_berths ?? null}</Field>
                {marina.longest_berth_meters ? <Field label={t('adm2.org.longest', 'Longest berth')}>{`${marina.longest_berth_meters} m`}</Field> : null}
              </dl>
              {(marina.has_yacht_club || marina.has_sailing_school || marina.has_boat_yard || marina.has_restaurants || marina.has_concierge) && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {marina.has_yacht_club && <AdminStatusPill>Yacht club</AdminStatusPill>}
                  {marina.has_sailing_school && <AdminStatusPill>Sailing school</AdminStatusPill>}
                  {marina.has_boat_yard && <AdminStatusPill>Boat yard</AdminStatusPill>}
                  {marina.has_restaurants && <AdminStatusPill>Restaurants ({marina.restaurants_count || '?'})</AdminStatusPill>}
                  {marina.has_concierge && <AdminStatusPill>Concierge</AdminStatusPill>}
                </div>
              )}
              {marina.certifications && marina.certifications.length > 0 && (
                <div className="mt-4">
                  <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-meta">{t('adm2.org.certifications', 'Certifications')}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {marina.certifications.map(c => <AdminStatusPill key={c} tone="info">{c}</AdminStatusPill>)}
                  </div>
                </div>
              )}
              {(marina.marina_description || marina.services_description) && (
                <dl className="mt-4 grid gap-4">
                  {marina.marina_description && <Field label={t('adm2.org.marinaDesc', 'About the marina')}><span className="whitespace-pre-wrap">{marina.marina_description}</span></Field>}
                  {marina.services_description && <Field label={t('adm2.org.services', 'Services')}><span className="whitespace-pre-wrap">{marina.services_description}</span></Field>}
                </dl>
              )}
            </AdminPanel>
          )}
        </div>

        {/* Right column: M3 settings + the people */}
        <div className="space-y-6">
          <AdminPanel
            icon={Shield}
            title={t('adm2.org.settings', 'M3 settings')}
            description={t('adm2.org.settingsDesc', 'Nothing changes until you press "Save the settings".')}
          >
            <div className="space-y-5">
              <FormField label={t('adm2.org.access', 'Access')} htmlFor="org-access">
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger id="org-access" className={FIELD}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FormField>
              {status === 'rejected' && (
                <FormField label={t('adm2.org.reason', 'Why it was not accepted')} htmlFor="org-reason">
                  <Textarea id="org-reason" value={rejectionReason} onChange={e => setRejectionReason(e.target.value)} rows={2} className="bg-white" />
                </FormField>
              )}
              <FormField
                label={t('adm2.org.onboarding', 'Registration progress')}
                htmlFor="org-onboarding"
                hint={t('adm2.org.onboardingHint', 'Only "Completed" counts as a fully registered company. Set it here rather than in SQL.')}
              >
                <Select value={onboardingStatus} onValueChange={setOnboardingStatus}>
                  <SelectTrigger id="org-onboarding" className={FIELD}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ONBOARDING_OPTIONS.map(s => <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField
                label={t('adm2.org.tier', 'Sponsor plan')}
                htmlFor="org-tier"
                hint={
                  <>
                    {t('adm2.org.tierHint1', 'A paying plan puts a validated company on the one sponsors list:')}{' '}
                    <Link to="/partners" className={link}>{t('adm2.org.tierHintLink', 'the Partners page')}</Link>
                    {t('adm2.org.tierHint2', ', the home page band and the event pages, grouped by plan. Member = free, not listed.')}
                  </>
                }
              >
                <Select value={tier} onValueChange={setTier}>
                  <SelectTrigger id="org-tier" className={FIELD}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(TIER_LABELS) as OrgTier[]).map(k => <SelectItem key={k} value={k}>{TIER_LABELS[k]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label={t('adm2.org.seats', 'Seats (people who can join)')} htmlFor="org-seats">
                <Input id="org-seats" type="number" value={maxSeats} onChange={e => setMaxSeats(parseInt(e.target.value) || 1)} min={1} className={`${FIELD} w-28`} />
              </FormField>
              <label htmlFor="org-media" className="flex cursor-pointer items-start gap-3 rounded-xl border border-rule bg-white p-3">
                <Checkbox id="org-media" checked={mediaPartner} onCheckedChange={v => setMediaPartner(!!v)} className="mt-0.5" />
                <span>
                  <span className="block text-[14px] font-semibold leading-5 text-navy">{t('adm2.org.media', 'Media partner')}</span>
                  <span className="mt-0.5 block text-[13px] leading-[18px] text-meta">
                    {t('adm2.org.mediaHint', 'Tags this media outlet as one of our media partners, with a badge in the public directory. Accreditation for an event is separate.')}
                  </span>
                </span>
              </label>
              <p className="text-[13px] leading-5 text-meta">
                {t('adm2.org.autoJoin', 'People with its e-mail domain join without approval:')}{' '}
                <span className="font-semibold text-navy">{org.auto_approve_domain_joins ? t('adm2.yes', 'Yes') : t('adm2.no', 'No')}</span>
              </p>
              <div className="border-t border-rule pt-4">{saveButton('w-full sm:w-auto')}</div>
            </div>
          </AdminPanel>

          {/* Members */}
          <AdminPanel
            icon={Users}
            title={t('adm2.org.people', 'People ({{count}} of {{max}} seats)', { count: members.length, max: maxSeats })}
            padded={false}
          >
            {!org.owner_user_id && members.length > 0 && (
              <div className="px-5 pt-4">
                <Note tone="warning">
                  {t('adm2.org.noOwner', 'This company has no person in charge. Press "Make them the person in charge" on someone below, or let the real manager claim it with the code: claiming also promotes an existing member.')}
                </Note>
              </div>
            )}

            {members.length === 0 ? (
              <p className="px-5 py-6 text-center text-[14px] text-meta">{t('adm2.org.noMembers', 'Nobody has joined yet.')}</p>
            ) : (
              <ul className="divide-y divide-rule">
                {members.map(m => {
                  const name = [m.first_name, m.last_name].filter(Boolean).join(' ') || 'Unknown';
                  return (
                    <li key={m.id} className="px-5 py-3.5">
                      <Link
                        to={`/admin/users/${m.user_id}`}
                        className="group -mx-2 flex flex-col gap-2 rounded-xl px-2 py-1 transition-colors hover:bg-page focus:outline-none focus-visible:shadow-focus sm:flex-row sm:items-center sm:gap-3"
                      >
                        <span className="flex min-w-0 flex-1 items-center gap-3">
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-pill bg-chip text-[13px] font-semibold text-navy" aria-hidden="true">
                            {(m.first_name?.[0] || '?').toUpperCase()}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[15px] font-semibold leading-5 text-navy [overflow-wrap:anywhere]">{name}</span>
                            <span className="block text-[13px] leading-[18px] text-meta [overflow-wrap:anywhere]">
                              {[m.email, m.persona ? personaLabel(m.persona) : null].filter(Boolean).join(' · ')}
                            </span>
                          </span>
                        </span>
                        <ActionCue size="sm" className="self-start sm:self-center">{t('adm2.org.openAccount', 'Open their account')}</ActionCue>
                      </Link>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 sm:pl-12">
                        <AdminStatusPill tone={m.role === 'owner' ? 'navy' : 'neutral'}>{roleLabel(m.role)}</AdminStatusPill>
                        {m.access_status && <AdminStatus status={m.access_status} />}
                        {m.role !== 'owner' && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleSetOwner(m)}
                            disabled={settingOwner === m.user_id}
                            className="h-9 rounded-pill border-navy/30 bg-white px-3 text-[13px] text-navy hover:border-navy hover:bg-chip hover:text-navy sm:ml-auto"
                          >
                            {settingOwner === m.user_id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Crown className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                            {t('adm2.org.makeOwner', 'Make them the person in charge')}
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Add a colleague on the organisation's behalf. The owner's own
                screen can do this too, but not when the owner cannot sign in —
                which is exactly when someone asks us to. */}
            <div className="space-y-3 border-t border-rule bg-page/60 px-5 py-4">
              <p className="flex items-center gap-2 text-[14px] font-semibold text-navy">
                <UserPlus className="h-4 w-4 text-teal" aria-hidden="true" />
                {t('adm2.org.invite', 'Invite a colleague')}
              </p>
              <FormField label={t('adm2.org.inviteEmail', 'Their e-mail')} htmlFor="org-invite-email">
                <Input
                  id="org-invite-email"
                  value={memberEmail}
                  onChange={e => setMemberEmail(e.target.value)}
                  placeholder="name@example.com"
                  type="email"
                  className={FIELD}
                  onKeyDown={e => { if (e.key === 'Enter') handleAdminInvite(); }}
                />
              </FormField>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label={t('adm2.org.first', 'First name')} htmlFor="org-invite-first">
                  <Input id="org-invite-first" value={memberFirst} onChange={e => setMemberFirst(e.target.value)} className={FIELD} />
                </FormField>
                <FormField label={t('adm2.org.last', 'Last name')} htmlFor="org-invite-last">
                  <Input id="org-invite-last" value={memberLast} onChange={e => setMemberLast(e.target.value)} className={FIELD} />
                </FormField>
              </div>
              <Button type="button" variant="outline" size="sm" className={`${ADMIN_BTN} w-full sm:w-auto`} disabled={!memberEmail.trim() || invitingMember} onClick={handleAdminInvite}>
                {invitingMember ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="mr-2 h-4 w-4" aria-hidden="true" />}
                {invitingMember ? t('adm2.sending', 'Sending…') : t('adm2.org.inviteSend', 'Send the invitation')}
              </Button>
              <p className="text-[13px] leading-[18px] text-meta">
                {t('adm2.org.inviteHint', 'They get an e-mail with a link to join {{org}} as a member. The person in charge keeps their role.', { org: org.name })}
                {members.length >= maxSeats && ` ${t('adm2.org.inviteFull', 'The team is full: sending frees a seat.')}`}
              </p>
            </div>

            <div className="border-t border-rule px-5 py-4">
              <CardLink to={`/admin/users?org=${org.id}`}>{t('adm2.org.allAccounts', 'See these people in Accounts and export')}</CardLink>
            </div>
          </AdminPanel>
        </div>
      </div>
    </div>
  );
}
