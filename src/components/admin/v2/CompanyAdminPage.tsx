import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArchiveRestore, Award, Building2, Crown, Globe, Link2, Loader2, MapPin, Send, ShieldCheck, Sparkles, Trash2, UserPlus, Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ActionCue, CardLink } from '@/components/home/dashboard/DashboardKit';
import { MemberBadgeCard } from '@/components/home/dashboard/MemberBadgeCard';
import { SM26ShowcaseRow } from '@/components/home/dashboard/SM26ShowcaseRow';
import { externalUrl } from '@/lib/externalUrl';
import { orgPath } from '@/lib/seoMeta';
import { supabase } from '@/lib/supabase';
import { sendNotification } from '@/lib/notifications';
import { fetchShowcaseSettings, SECTIONS, sectionFilled } from '@/lib/sm26Showcase';
import { awardWinText, useAwardWins } from '@/lib/awardWins';
import { toast } from '@/hooks/use-toast';
import { TIER_LABELS, type OrgTier } from '@/types/database';
import { archiveOrg, markDuplicateOrg, reviewErrorText } from '../review/reviewApi';
import {
  AdminDetailHeader, AdminEmpty, AdminLoading, AdminPanel, AdminStatus, AdminStatusPill, ADMIN_BTN, ADMIN_BTN_DANGER, ADMIN_BTN_PRIMARY,
} from '../AdminUI';
import { Field, Note, PageTabs } from './MembersKit';
import { HistoryTab, MessagesTab, NotesTab, RegistrationsTab, RequestsTab, SponsoringTab } from './memberTabs';
import {
  decideJoinRequest, fmtDate, loadCompany, personName, TYPE_LABEL,
  type CompanyRecord, type InvitationRecord, type MemberRecord, type Scope,
} from './membersApi';

/**
 * Members > Companies > one company (Victor, 21 Oct 2026). Tabs: Profile, Members, Registrations,
 * Requests, Messages, Sponsoring, History, Notes (?tab=). VIEW everywhere, ACT in one place:
 * this page ACTS on the company's page (address, visibility, SM26 texts) and on its team (invite,
 * remove, person in charge, join requests); registrations, requests, reports and sponsoring are
 * read only, each row links to the screen that manages it. Validation happens in To validate.
 * The plan, the claim code and the other settings stay on the previous screen for now
 * (/admin/organizations/:id, linked from the Profile tab).
 */

type TabKey = 'profile' | 'members' | 'registrations' | 'requests' | 'messages' | 'sponsoring' | 'history' | 'notes';
const TABS: TabKey[] = ['profile', 'members', 'registrations', 'requests', 'messages', 'sponsoring', 'history', 'notes'];
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function CompanyAdminPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<{ org: CompanyRecord | null; members: MemberRecord[]; invitations: InvitationRecord[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [regCount, setRegCount] = useState<number | null>(null);
  const [reqCount, setReqCount] = useState<number | null>(null);

  const tabParam = params.get('tab') as TabKey | null;
  const tab: TabKey = tabParam && TABS.includes(tabParam) ? tabParam : 'profile';
  const setTab = (next: TabKey) => setParams(prev => {
    const p = new URLSearchParams(prev);
    if (next === 'profile') p.delete('tab'); else p.set('tab', next);
    return p;
  }, { replace: true });

  const reload = useCallback(() => {
    loadCompany(id).then(d => { setData(d); setError(null); }, (e: unknown) => setError(e instanceof Error ? e.message : 'Could not load.'));
  }, [id]);
  useEffect(() => { setData(null); setRegCount(null); setReqCount(null); reload(); }, [reload]);

  const scope: Scope = useMemo(() => ({
    orgId: id,
    userIds: (data?.members ?? []).map(m => m.user_id),
    emails: (data?.members ?? []).map(m => m.email ?? ''),
  }), [id, data?.members]);

  if (error) return <div className="mx-auto max-w-3xl"><Note tone="warning">{error}</Note></div>;
  if (!data) return <AdminLoading />;
  const { org, members, invitations } = data;
  if (!org) {
    return (
      <div className="mx-auto max-w-3xl">
        <AdminEmpty icon={Building2} title={t('adminMembers.company.notFound', 'This company was not found')} action={<CardLink to="/admin/companies">{t('adminMembers.company.back', 'Back to Companies')}</CardLink>} />
      </div>
    );
  }

  const joinRequests = invitations.filter(i => i.status === 'join_requested' && !i.invited_by_user_id);

  return (
    <div className="mx-auto max-w-5xl">
      <AdminDetailHeader
        back={{ to: '/admin/companies', label: t('adminMembers.company.back', 'Back to Companies') }}
        title={org.name}
        leading={
          <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl border border-rule bg-white">
            {org.logo_url ? <img src={org.logo_url} alt="" className="h-full w-full object-contain p-0.5" /> : <Building2 className="h-6 w-6 text-meta/60" aria-hidden="true" />}
          </span>
        }
        badges={
          <>
            <AdminStatus status={org.access_status} />
            {org.organization_type && <AdminStatusPill>{TYPE_LABEL[org.organization_type] ?? org.organization_type}</AdminStatusPill>}
            {org.tier && org.tier !== 'member' && <AdminStatusPill tone="info">{TIER_LABELS[org.tier as OrgTier] ?? org.tier}</AdminStatusPill>}
            {org.archived_at && <AdminStatusPill>{t('adminMembers.company.archived', 'Archived')}</AdminStatusPill>}
            {org.duplicate_of && <AdminStatusPill>{t('adminMembers.company.duplicate', 'Duplicate')}</AdminStatusPill>}
          </>
        }
        subtitle={[[org.city, org.country].filter(Boolean).join(', '), t('adminMembers.company.since', 'on the platform since {{date}}', { date: fmtDate(org.created_at) })].filter(Boolean).join(' · ')}
        actions={
          <a href={orgPath(org.slug)} target="_blank" rel="noopener noreferrer" className="group rounded-pill focus:outline-none focus-visible:shadow-focus">
            <ActionCue>{t('adminMembers.company.publicPage', 'See the public page')}</ActionCue>
          </a>
        }
      />

      {org.access_status === 'pending' && (
        <div className="mb-6 flex flex-col gap-3 rounded-card border border-gold/70 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[15px] font-semibold leading-6 text-navy">{t('adminMembers.company.pending', 'This company waits for M3’s validation.')}</p>
          <CardLink to="/admin/review?tab=people">{t('adminMembers.company.validate', 'Validate in To validate')}</CardLink>
        </div>
      )}

      <PageTabs
        label={t('adminMembers.company.tabs', 'Company sections')}
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'profile', label: t('adminMembers.tab.profile', 'Profile') },
          { key: 'members', label: t('adminMembers.tab.members', 'Members'), count: members.length + joinRequests.length },
          { key: 'registrations', label: t('adminMembers.tab.registrations', 'Registrations'), count: regCount },
          { key: 'requests', label: t('adminMembers.tab.requests', 'Requests'), count: reqCount },
          { key: 'messages', label: t('adminMembers.tab.messages', 'Messages') },
          { key: 'sponsoring', label: t('adminMembers.tab.sponsoring', 'Sponsoring') },
          { key: 'history', label: t('adminMembers.tab.history', 'History') },
          { key: 'notes', label: t('adminMembers.tab.notes', 'Notes') },
        ]}
      />

      {tab === 'profile' && <ProfileTab org={org} onChanged={reload} />}
      {tab === 'members' && <MembersTab org={org} members={members} invitations={invitations} onChanged={reload} />}
      {tab === 'registrations' && <RegistrationsTab scope={scope} onCount={setRegCount} />}
      {tab === 'requests' && <RequestsTab scope={scope} onCount={setReqCount} />}
      {tab === 'messages' && <MessagesTab scope={scope} />}
      {tab === 'sponsoring' && <SponsoringTab orgId={org.id} tier={org.tier} />}
      {tab === 'history' && <HistoryTab scope={scope} invitations={invitations} />}
      {tab === 'notes' && <NotesTab subject={{ orgId: org.id }} />}
    </div>
  );
}

/* ------------------------------------------------------------------ Profile */

function ProfileTab({ org, onChanged }: { org: CompanyRecord; onChanged: () => void }) {
  const { t } = useTranslation();
  const wins = useAwardWins().get(org.id) ?? [];
  const [showcase, setShowcase] = useState<'loading' | 'some' | 'none'>('loading');
  const [busy, setBusy] = useState<string | null>(null);
  const [slug, setSlug] = useState(org.slug);
  const [media, setMedia] = useState(!!org.is_event_media_partner);

  useEffect(() => { setSlug(org.slug); setMedia(!!org.is_event_media_partner); }, [org.slug, org.is_event_media_partner]);
  useEffect(() => {
    let alive = true;
    fetchShowcaseSettings(org.id).then(
      // The row shows only entries with something written in them (SM26ShowcaseRow).
      s => { if (alive) setShowcase(s && s.entries.some(e => SECTIONS[e.kind].some(x => sectionFilled(e.sections, x.key))) ? 'some' : 'none'); },
      () => { if (alive) setShowcase('none'); },
    );
    return () => { alive = false; };
  }, [org.id]);

  const slugClean = slug.trim().toLowerCase();
  const slugValid = SLUG_RE.test(slugClean) && slugClean.length <= 80;
  const slugChanged = slugClean !== org.slug;

  const saveSlug = async () => {
    if (!slugValid || !slugChanged) return;
    if (!window.confirm(t('adminMembers.slug.confirm', 'Change the address to /organizations/{{slug}}?\n\nThe old address stops working, and so do the member badges the company already pasted on its website.', { slug: slugClean }))) return;
    setBusy('slug');
    const { error } = await supabase.from('organizations').update({ slug: slugClean, updated_at: new Date().toISOString() }).eq('id', org.id);
    setBusy(null);
    if (error) {
      toast({
        title: t('adminMembers.slug.failed', 'The address was not changed'),
        description: error.code === '23505' ? t('adminMembers.slug.taken', 'Another company already uses this address.') : error.message,
        variant: 'destructive',
      });
      return;
    }
    toast({ title: t('adminMembers.slug.saved', 'Address changed') });
    onChanged();
  };

  const saveMedia = async (next: boolean) => {
    setMedia(next);
    setBusy('media');
    const { error } = await supabase.from('organizations').update({ is_event_media_partner: next, updated_at: new Date().toISOString() }).eq('id', org.id);
    setBusy(null);
    if (error) { setMedia(!next); toast({ title: t('adminMembers.vis.failed', 'Nothing was changed'), description: error.message, variant: 'destructive' }); return; }
    toast({ title: next ? t('adminMembers.vis.mediaOn', 'Tagged as a media partner') : t('adminMembers.vis.mediaOff', 'No longer tagged as a media partner') });
    onChanged();
  };

  const restore = async (what: 'archive' | 'duplicate') => {
    setBusy(what);
    try {
      if (what === 'archive') await archiveOrg(org.id, false); else await markDuplicateOrg(org.id, null);
      toast({ title: t('adminMembers.vis.listedAgain', '{{name}} is listed again', { name: org.name }) });
      onChanged();
    } catch (e) {
      toast({ title: t('adminMembers.vis.failed', 'Nothing was changed'), description: reviewErrorText(e, t), variant: 'destructive' });
    }
    setBusy(null);
  };

  const hidden = !!org.archived_at || !!org.duplicate_of;
  const listed = org.access_status === 'verified' && !hidden;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        <AdminPanel
          title={t('adminMembers.profile.public', 'Public information')}
          icon={Building2}
          description={t('adminMembers.profile.publicDesc', 'What visitors see. The company edits it from its own dashboard.')}
        >
          <dl className="grid gap-4 sm:grid-cols-2">
            <Field label={t('adminMembers.profile.type', 'Type')}>{org.organization_type ? TYPE_LABEL[org.organization_type] ?? org.organization_type : null}</Field>
            <Field label={t('adminMembers.profile.place', 'Place')}>
              {(org.city || org.country) && <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4 text-meta" aria-hidden="true" />{[org.city, org.country].filter(Boolean).join(', ')}</span>}
            </Field>
            <Field label={t('adminMembers.profile.website', 'Website')}>
              {org.website && (
                <a href={externalUrl(org.website) ?? undefined} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-teal-text underline underline-offset-2 hover:text-navy">
                  <Globe className="h-4 w-4" aria-hidden="true" />{org.website}
                </a>
              )}
            </Field>
            <Field label={t('adminMembers.profile.domain', 'E-mail domain')}>{org.primary_domain}</Field>
            <div className="sm:col-span-2">
              <Field label={t('adminMembers.profile.description', 'Description')}>
                {org.description && <span className="line-clamp-6 whitespace-pre-wrap">{org.description}</span>}
              </Field>
            </div>
          </dl>
          <div className="mt-5 flex flex-wrap gap-2">
            <a href={orgPath(org.slug)} target="_blank" rel="noopener noreferrer" className="group rounded-pill focus:outline-none focus-visible:shadow-focus">
              <ActionCue>{t('adminMembers.company.publicPage', 'See the public page')}</ActionCue>
            </a>
            <CardLink to={`/admin/organizations/${org.id}`}>{t('adminMembers.profile.oldScreen', 'Plan, claim code and other settings')}</CardLink>
          </div>
        </AdminPanel>

        <AdminPanel title={t('adminMembers.vis.title', 'Visibility')} icon={ShieldCheck}>
          <p className="text-[15px] leading-6 text-ink">
            {listed
              ? t('adminMembers.vis.listed', 'Listed: shown in the directory, the company search and the matching.')
              : hidden
                ? t('adminMembers.vis.hidden', 'Hidden from the directory, the company search and the matching.')
                : t('adminMembers.vis.notYet', 'Not listed yet: a company is shown once M3 has verified it.')}
          </p>
          {org.archived_at && (
            <div className="mt-3 flex flex-col gap-3 rounded-xl border border-rule bg-page p-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-[14px] text-ink">{t('adminMembers.vis.archivedOn', 'Archived on {{date}}.', { date: fmtDate(org.archived_at) })}</span>
              <Button type="button" variant="outline" className={ADMIN_BTN} disabled={!!busy} onClick={() => restore('archive')}>
                {busy === 'archive' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArchiveRestore className="mr-2 h-4 w-4" aria-hidden="true" />}
                {t('adminMembers.vis.relist', 'List it again')}
              </Button>
            </div>
          )}
          {org.duplicate_of && (
            <div className="mt-3 flex flex-col gap-3 rounded-xl border border-rule bg-page p-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-[14px] text-ink">
                {t('adminMembers.vis.duplicateOf', 'Marked as a duplicate of')}{' '}
                <Link to={`/admin/companies/${org.duplicate_of}`} className="font-semibold text-teal-text underline underline-offset-2 hover:text-navy">{t('adminMembers.vis.theOther', 'the company kept')}</Link>.
              </span>
              <Button type="button" variant="outline" className={ADMIN_BTN} disabled={!!busy} onClick={() => restore('duplicate')}>
                {busy === 'duplicate' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArchiveRestore className="mr-2 h-4 w-4" aria-hidden="true" />}
                {t('adminMembers.vis.notDuplicate', 'Not a duplicate')}
              </Button>
            </div>
          )}
          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-rule p-3 hover:bg-page">
            <Checkbox checked={media} disabled={busy === 'media'} onCheckedChange={v => saveMedia(!!v)} className="mt-0.5 h-5 w-5" />
            <span>
              <span className="block text-[15px] font-semibold text-navy">{t('adminMembers.vis.media', 'Media partner')}</span>
              <span className="block text-[13px] leading-[18px] text-meta">{t('adminMembers.vis.mediaHint', 'A badge in the partners directory. Saved as soon as you tick or untick it.')}</span>
            </span>
          </label>
        </AdminPanel>

        <AdminPanel title={t('adminMembers.slug.title', 'Page address')} icon={Link2}>
          <label className="block">
            <span className="text-[14px] font-semibold text-navy">smartmarinaconnect.com/organizations/</span>
            <Input value={slug} onChange={e => setSlug(e.target.value)} className="mt-1.5 h-11 bg-white font-mono" spellCheck={false} autoCapitalize="off" />
          </label>
          {!slugValid && <p className="mt-2 text-[13px] text-red-700">{t('adminMembers.slug.invalid', 'Lower-case letters, digits and single hyphens only (80 at most).')}</p>}
          <p className="mt-2 text-[13px] leading-[18px] text-meta">{t('adminMembers.slug.warn', 'Changing it breaks the old links and the member badge already pasted on the company’s website.')}</p>
          <Button type="button" variant="secondary" className={`${ADMIN_BTN_PRIMARY} mt-3`} disabled={!slugValid || !slugChanged || busy === 'slug'} onClick={saveSlug}>
            {busy === 'slug' && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {t('adminMembers.slug.save', 'Change the address')}
          </Button>
        </AdminPanel>
      </div>

      <div className="space-y-6">
        <AdminPanel
          title={t('adminMembers.sm26.title', 'Smart Marina 2026 details')}
          icon={Sparkles}
          description={t('adminMembers.sm26.desc', 'The e-catalogue and jury texts shown on the company page. M3 can hide any of them; only the company can switch on a restricted one.')}
        >
          {showcase === 'loading' ? (
            <p className="text-[14px] text-meta">{t('adminMembers.loading', 'Loading…')}</p>
          ) : showcase === 'none' ? (
            <p className="text-[14px] text-meta">{t('adminMembers.sm26.none', 'No Smart Marina 2026 texts for this company.')}</p>
          ) : (
            <SM26ShowcaseRow orgId={org.id} version={org.updated_at} onChanged={onChanged} />
          )}
        </AdminPanel>

        <AdminPanel title={t('adminMembers.badge.title', 'Member badge')} icon={ShieldCheck} description={t('adminMembers.badge.desc', 'The badge the company can put on its own website, linking to its page here.')}>
          {org.access_status === 'verified'
            ? <MemberBadgeCard org={{ slug: org.slug, name: org.name }} />
            : <p className="text-[14px] text-meta">{t('adminMembers.badge.notYet', 'Offered once M3 has verified the company.')}</p>}
        </AdminPanel>

        <AdminPanel title={t('adminMembers.awards.title', 'Awards')} icon={Award}>
          {wins.length === 0 ? (
            <p className="text-[14px] text-meta">{t('adminMembers.awards.none', 'No award won yet.')}</p>
          ) : (
            <ul className="space-y-2">
              {wins.map(w => (
                <li key={`${w.award_key}:${w.edition_year}`} className="flex items-center gap-2 text-[15px] text-ink">
                  <Award className="h-4 w-4 shrink-0 text-teal" aria-hidden="true" />{awardWinText(w)}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4"><CardLink to="/admin/sm26/evaluation">{t('adminMembers.awards.manage', 'Manage the awards in Smart 26')}</CardLink></div>
        </AdminPanel>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Members */

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
}

function MembersTab({ org, members, invitations, onChanged }: { org: CompanyRecord; members: MemberRecord[]; invitations: InvitationRecord[]; onChanged: () => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');

  const joinRequests = invitations.filter(i => i.status === 'join_requested' && !i.invited_by_user_id);
  const pendingInvites = invitations.filter(i => i.status === 'pending');
  const hasOwner = members.some(m => m.role === 'owner');

  const makeOwner = async (m: MemberRecord) => {
    const name = personName(m);
    if (!window.confirm(t('adminMembers.members.ownerConfirm', 'Make {{name}} the person in charge of {{org}}?\n\nThe current person in charge stays in the team as a member.', { name, org: org.name }))) return;
    setBusy(`owner:${m.user_id}`);
    const { error } = await supabase.rpc('admin_set_org_owner', { p_org_id: org.id, p_user_id: m.user_id });
    setBusy(null);
    if (error) { toast({ title: t('adminMembers.members.ownerFailed', 'The person in charge was not changed'), description: error.message, variant: 'destructive' }); return; }
    toast({ title: t('adminMembers.members.ownerDone', '{{name}} is now in charge', { name }) });
    onChanged();
  };

  const remove = async (m: MemberRecord) => {
    const name = personName(m);
    if (!window.confirm(t('adminMembers.members.removeConfirm', 'Remove {{name}} from {{org}}?\n\nTheir account stays; they only leave this company.', { name, org: org.name }))) return;
    setBusy(`remove:${m.user_id}`);
    const { error } = await supabase.rpc('admin_remove_org_member', { p_user_id: m.user_id, p_org_id: org.id });
    setBusy(null);
    if (error) { toast({ title: t('adminMembers.members.removeFailed', 'Nobody was removed'), description: error.message, variant: 'destructive' }); return; }
    toast({ title: t('adminMembers.members.removed', '{{name}} left {{org}}', { name, org: org.name }) });
    onChanged();
  };

  const answer = async (inv: InvitationRecord, approve: boolean) => {
    const who = [inv.first_name, inv.last_name].filter(Boolean).join(' ') || inv.email;
    if (!window.confirm(approve
      ? t('adminMembers.join.acceptConfirm', 'Let {{who}} join {{org}}?', { who, org: org.name })
      : t('adminMembers.join.refuseConfirm', 'Refuse the request of {{who}}?', { who }))) return;
    setBusy(`join:${inv.id}`);
    try {
      await decideJoinRequest(inv.id, approve);
      toast({ title: approve ? t('adminMembers.join.accepted', '{{who}} joined the company', { who }) : t('adminMembers.join.refused', 'Request refused') });
      onChanged();
    } catch (e) {
      toast({ title: t('adminMembers.join.failed', 'Nothing was changed'), description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
    setBusy(null);
  };

  // The existing admin invitation (admin_invite_org_member + the team_invitation e-mail), as on
  // the previous company screen.
  const invite = async () => {
    const address = email.trim();
    if (!address) return;
    setBusy('invite');
    try {
      const { data, error } = await supabase.rpc('admin_invite_org_member', {
        p_organization_id: org.id, p_email: address, p_first_name: first.trim() || null, p_last_name: last.trim() || null,
      });
      if (error) throw error;
      const res = data as { ok?: boolean; reason?: string; invitation_id?: string; reused?: boolean } | null;
      if (!res?.ok) {
        toast({
          title: res?.reason === 'already_member' ? t('adminMembers.invite.already', 'Already in this team') : t('adminMembers.invite.failed', 'The invitation was not sent'),
          variant: 'destructive',
        });
      } else {
        await sendNotification({
          type: 'team_invitation',
          email: address,
          data: { org_name: org.name, inviter_name: 'Smart Marina Connect', signup_url: `${window.location.origin}/join/${res.invitation_id}`, first_name: first.trim() || '' },
        });
        toast({ title: res.reused ? t('adminMembers.invite.resent', 'Invitation sent again') : t('adminMembers.invite.sent', 'Invitation sent'), description: address });
        setEmail(''); setFirst(''); setLast('');
        onChanged();
      }
    } catch (e) {
      toast({ title: t('adminMembers.invite.failed', 'The invitation was not sent'), description: e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e), variant: 'destructive' });
    }
    setBusy(null);
  };

  return (
    <div className="space-y-6">
      {!hasOwner && members.length > 0 && (
        <Note tone="warning">{t('adminMembers.members.noOwner', 'Nobody is in charge of this company. Press “Make person in charge” on one of the people below.')}</Note>
      )}

      {joinRequests.length > 0 && (
        <AdminPanel
          title={t('adminMembers.join.title', { count: joinRequests.length, defaultValue_one: '{{count}} person asks to join', defaultValue_other: '{{count}} people ask to join' })}
          icon={UserPlus}
          description={t('adminMembers.join.desc', 'The person in charge usually answers from their dashboard. Answer here when they cannot.')}
          className="border-gold/70"
          padded={false}
        >
          <ul className="divide-y divide-rule">
            {joinRequests.map(inv => (
              <li key={inv.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-navy [overflow-wrap:anywhere]">{[inv.first_name, inv.last_name].filter(Boolean).join(' ') || inv.email}</p>
                  <p className="text-[13px] text-meta [overflow-wrap:anywhere]">{inv.email} · {t('adminMembers.join.since', 'asked {{date}}', { date: fmtDate(inv.created_at) })}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" className={ADMIN_BTN_PRIMARY} disabled={!!busy} onClick={() => answer(inv, true)}>
                    {busy === `join:${inv.id}` && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                    {t('adminMembers.join.accept', 'Accept')}
                  </Button>
                  <Button type="button" variant="outline" className={ADMIN_BTN_DANGER} disabled={!!busy} onClick={() => answer(inv, false)}>
                    {t('adminMembers.join.refuse', 'Refuse')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </AdminPanel>
      )}

      <AdminPanel
        title={t('adminMembers.members.title', 'People in this company')}
        icon={Users}
        description={t('adminMembers.members.desc', 'Press a name to open the person’s page (login, password, suspension).')}
        padded={false}
      >
        {members.length === 0 ? (
          <AdminEmpty icon={Users} title={t('adminMembers.members.none', 'Nobody in this company yet')} />
        ) : (
          <ul className="divide-y divide-rule">
            {members.map(m => {
              const name = personName(m);
              const owner = m.role === 'owner';
              return (
                <li key={m.id} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center">
                  <Link to={`/admin/people/${m.user_id}`} className="group flex min-w-0 flex-1 items-center gap-3 rounded-xl focus:outline-none focus-visible:shadow-focus">
                    <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-chip text-[14px] font-semibold text-navy">{initials(name)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[15px] font-semibold text-navy [overflow-wrap:anywhere]"><span className="card-ul">{name}</span></span>
                        {owner
                          ? <AdminStatusPill tone="info" icon={Crown}>{t('adminMembers.members.owner', 'Person in charge')}</AdminStatusPill>
                          : <AdminStatusPill>{t('adminMembers.members.member', 'Member')}</AdminStatusPill>}
                        {m.access_status && m.access_status !== 'verified' && <AdminStatus status={m.access_status} />}
                      </span>
                      <span className="block text-[13px] text-meta [overflow-wrap:anywhere]">{[m.job_title, m.email].filter(Boolean).join(' · ')}</span>
                    </span>
                    <ActionCue size="sm" className="hidden sm:inline-flex">{t('adminMembers.members.open', 'Open their page')}</ActionCue>
                  </Link>
                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    <Link to={`/admin/people/${m.user_id}`} className="group rounded-pill sm:hidden"><ActionCue size="sm">{t('adminMembers.members.open', 'Open their page')}</ActionCue></Link>
                    {!owner && (
                      <Button type="button" variant="outline" className={`${ADMIN_BTN} h-9`} disabled={!!busy} onClick={() => makeOwner(m)}>
                        {busy === `owner:${m.user_id}` ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Crown className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                        {t('adminMembers.members.makeOwner', 'Make person in charge')}
                      </Button>
                    )}
                    {!owner && (
                      <Button type="button" variant="outline" className={`${ADMIN_BTN_DANGER} h-9`} disabled={!!busy} onClick={() => remove(m)}>
                        {busy === `remove:${m.user_id}` ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                        {t('adminMembers.members.remove', 'Remove')}
                        <span className="sr-only"> {name}</span>
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {members.some(m => m.role === 'owner') && members.length > 1 && (
          <p className="border-t border-rule px-5 py-3 text-[13px] text-meta">{t('adminMembers.members.ownerHint', 'To remove the person in charge, first make someone else the person in charge.')}</p>
        )}
      </AdminPanel>

      <AdminPanel
        title={t('adminMembers.invite.title', 'Invite a colleague')}
        icon={Send}
        description={t('adminMembers.invite.desc', 'They receive an e-mail with a link to join {{org}} as a member.', { org: org.name })}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block sm:col-span-3">
            <span className="text-[14px] font-semibold text-navy">{t('adminMembers.invite.email', 'E-mail address')}</span>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} className="mt-1.5 h-11 bg-white" autoComplete="off" />
          </label>
          <label className="block">
            <span className="text-[14px] font-semibold text-navy">{t('adminMembers.invite.first', 'First name')}</span>
            <Input value={first} onChange={e => setFirst(e.target.value)} className="mt-1.5 h-11 bg-white" autoComplete="off" />
          </label>
          <label className="block">
            <span className="text-[14px] font-semibold text-navy">{t('adminMembers.invite.last', 'Last name')}</span>
            <Input value={last} onChange={e => setLast(e.target.value)} className="mt-1.5 h-11 bg-white" autoComplete="off" />
          </label>
        </div>
        <Button type="button" variant="secondary" className={`${ADMIN_BTN_PRIMARY} mt-4`} disabled={!email.trim() || busy === 'invite'} onClick={invite}>
          {busy === 'invite' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="mr-2 h-4 w-4" aria-hidden="true" />}
          {t('adminMembers.invite.send', 'Send the invitation')}
        </Button>
        {pendingInvites.length > 0 && (
          <div className="mt-5">
            <p className="text-meta-caps">{t('adminMembers.invite.waiting', 'Invitations not answered yet')}</p>
            <ul className="mt-2 space-y-1.5">
              {pendingInvites.map(i => (
                <li key={i.id} className="text-[14px] text-ink [overflow-wrap:anywhere]">
                  {[i.first_name, i.last_name].filter(Boolean).join(' ') || i.email}
                  <span className="text-meta"> · {i.email} · {t('adminMembers.invite.sentOn', 'sent {{date}}', { date: fmtDate(i.created_at) })}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </AdminPanel>
    </div>
  );
}
