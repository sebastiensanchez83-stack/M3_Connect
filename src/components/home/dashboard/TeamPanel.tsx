import { Suspense, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Award, ChevronDown, Crown, LogOut, Mail, Trash2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RowSkeleton, StatusPill } from '@/components/member/MemberUI';
import { useAuth } from '@/contexts/AuthContext';
import {
  cancelTeamInvitation, inviterName, leaveOrg, removeOrgMember, resendTeamInvitation, type TeamMember,
} from '@/components/organization/orgActions';
import { toast } from '@/hooks/use-toast';
import { displayCase } from '@/lib/displayCase';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { requireFreshSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import type { OrganizationInvitation } from '@/types/database';
import { BTN_TOUCH, ConfirmDialog, errorText } from './EditKit';
import { InviteDialog, JoinRequestsDialog } from './teamDialogs';
import { useTeam } from './useCompany';

const OrganizationWorkspace = lazyWithRetry(() => import('@/components/account/OrganizationWorkspace').then((m) => ({ default: m.OrganizationWorkspace })));

/**
 * My team: the people of the company (photo, name, job title, role, and an
 * "Attended Smart Marina 2026" mark for those who came), the invitations still
 * open, and for the owner: invite a colleague (only while the company has a
 * free place: otherwise a line says to write to the M3 team), answer people
 * who asked to join, remove someone (after a confirmation). A member who is
 * not the owner can leave.
 * Same writes as the full editor (orgActions). Transferring the ownership
 * stays in the full editor, behind "More settings".
 */

type Confirm = { kind: 'remove'; member: TeamMember } | { kind: 'leave' } | { kind: 'cancel'; inv: OrganizationInvitation } | null;

function nameOf(m: TeamMember): string {
  const p = m.profiles;
  const full = displayCase(`${p?.first_name ?? ''} ${p?.last_name ?? ''}`.trim());
  return full || p?.email?.split('@')[0] || 'A member';
}

export function TeamPanel({
  sm26UserIds,
  version,
  onChanged,
  onInboxChanged,
}: {
  sm26UserIds: string[];
  /** The dashboard's version: a change saved elsewhere (a to-do window) reads the team again. */
  version: number;
  onChanged: () => void;
  /** Join requests were answered: the inbox count (to-do, tiles, navbar) is asked again. */
  onInboxChanged: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { user, profile, organization, orgRole, refreshProfile } = useAuth();
  const orgId = organization?.id ?? null;
  const [reloadKey, setReloadKey] = useState(0);
  const { data, loading } = useTeam(orgId, `${reloadKey}:${version}`);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  if (!user || !organization || !orgId) return null;
  const isOwner = orgRole === 'owner';
  const reload = () => { setReloadKey((k) => k + 1); onChanged(); };
  const lang = i18n.language === 'fr' ? 'fr-FR' : 'en-GB';
  const day = (iso: string) => new Date(iso).toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' });

  const members = data?.members ?? [];
  const invitations = data?.invitations ?? [];
  const joinRequests = invitations.filter((i) => i.status === 'join_requested');
  const pending = invitations.filter((i) => i.status === 'pending');
  const isMarinaOrg = organization.organization_type === 'marina' || organization.organization_type === 'developer';
  const maxSeats = organization.max_seats ?? 0;
  // The full editor's count: members plus every invitation it lists (the rule invitationProblem applies).
  const occupied = members.length + invitations.length;
  // Never offer an invitation that the places would refuse (one-place plans are most companies).
  const canInvite = isMarinaOrg || !maxSeats || occupied < maxSeats;
  const attended = new Set(sm26UserIds);

  const doConfirm = async () => {
    if (!confirm) return;
    const fresh = await requireFreshSession();
    if (!fresh) return;
    try {
      if (confirm.kind === 'remove') {
        await removeOrgMember(confirm.member.id);
        toast({ title: t('dash.memberRemoved', { name: nameOf(confirm.member), defaultValue: '{{name}} is no longer in your team' }) });
      } else if (confirm.kind === 'cancel') {
        await cancelTeamInvitation(confirm.inv.id);
        toast({ title: t('dash.inviteCancelled', 'Invitation cancelled') });
      } else {
        await leaveOrg(orgId, user.id);
        toast({ title: t('dash.leftCompany', { org: organization.name, defaultValue: 'You left {{org}}' }) });
        setConfirm(null);
        await refreshProfile();
        onChanged();
        return;
      }
      setConfirm(null);
      reload();
    } catch (err) {
      toast({ title: t('dash.actionFailed', 'That did not work'), description: errorText(err, ''), variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      {/* Who, how many, and the one main action. */}
      <div className="flex flex-col gap-4 rounded-card border border-rule bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <p className="text-[17px] font-semibold leading-6 text-navy">
            {t('dash.teamCount', { count: members.length, org: organization.name, defaultValue_one: '{{count}} person in {{org}}', defaultValue_other: '{{count}} people in {{org}}' })}
          </p>
          {!isMarinaOrg && maxSeats > 0 && data && (
            <p className="mt-0.5 text-[15px] leading-6 text-meta">
              {t('dash.seats', { used: Math.min(occupied, maxSeats), total: maxSeats, defaultValue: '{{used}} of {{total}} places used' })}
            </p>
          )}
          {!isOwner && <p className="mt-0.5 text-[15px] leading-6 text-meta">{t('dash.teamOwnerOnly', 'Only the company owner can invite or remove people.')}</p>}
          {isOwner && data && !canInvite && (
            <p className="mt-1 max-w-xl text-[15px] leading-6 text-ink">
              {t('dash.seatsFull', {
                count: maxSeats,
                defaultValue_one: 'Your company has 1 place on the platform, and it is taken. To add a colleague, write to the M3 team.',
                defaultValue_other: 'All {{count}} places of your company are taken. To add a colleague, write to the M3 team.',
              })}
            </p>
          )}
        </div>
        {isOwner && (canInvite || !data) && (
          <Button type="button" variant="cta" size="sm" arrow={false} className="justify-center" disabled={!data} onClick={() => setInviteOpen(true)}>
            <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('dash.inviteColleague', 'Invite a colleague')}
          </Button>
        )}
        {isOwner && data && !canInvite && (
          <Button asChild variant="outline" className={cn(BTN_TOUCH, 'shrink-0')}>
            <Link to="/contact">{t('dash.writeToM3', 'Write to the M3 team')}</Link>
          </Button>
        )}
      </div>

      {/* People who asked to join (the owner decides). */}
      {isOwner && joinRequests.length > 0 && (
        <div className="flex flex-col gap-3 rounded-card border border-gold/60 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p className="text-[16px] font-semibold leading-6 text-navy">
            {t('dash.joinWaiting', { count: joinRequests.length, defaultValue_one: '{{count}} person asks to join your company', defaultValue_other: '{{count}} people ask to join your company' })}
          </p>
          <Button type="button" className="h-11 rounded-pill bg-navy px-5 text-[15px] font-semibold text-white hover:bg-navy/90 md:h-11" onClick={() => setJoinOpen(true)}>
            {t('dash.answerNow', 'Answer now')}
          </Button>
        </div>
      )}

      {/* The people. */}
      {loading && !data ? (
        <div className="rounded-card border border-rule bg-white"><RowSkeleton rows={3} /></div>
      ) : (
        <ul aria-label={t('dash.teamList', 'People in your company')} className="divide-y divide-rule overflow-hidden rounded-card border border-rule bg-white">
          {members.map((m) => {
            const name = nameOf(m);
            const me = m.user_id === user.id;
            const p = m.profiles;
            const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
            return (
              <li key={m.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  {p?.avatar_url
                    ? <img src={p.avatar_url} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover ring-1 ring-rule" />
                    : <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-chip text-[15px] font-semibold text-navy">{initials}</span>}
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-x-2 text-[16px] font-semibold leading-6 text-navy [overflow-wrap:anywhere]">
                      {name}
                      {me && <span className="text-[14px] font-normal text-meta">{t('dash.you', '(you)')}</span>}
                    </p>
                    <p className="text-[14px] leading-5 text-meta [overflow-wrap:anywhere]">{p?.job_title || t('dash.noJobTitle', 'No job title yet')}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {m.role === 'owner'
                        ? <StatusPill tone="info" icon={Crown}>{t('dash.roleOwner', 'Owner')}</StatusPill>
                        : <StatusPill tone="neutral">{t('dash.roleMember', 'Member')}</StatusPill>}
                      {attended.has(m.user_id) && (
                        <StatusPill tone="success" icon={Award}>{t('dash.attendedSm26', 'Attended Smart Marina 2026')}</StatusPill>
                      )}
                    </div>
                  </div>
                </div>
                {isOwner && !me && (
                  <Button type="button" variant="outline" className={cn(BTN_TOUCH, 'gap-1.5 text-red-700 hover:text-red-800')} onClick={() => setConfirm({ kind: 'remove', member: m })}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    {t('dash.remove', 'Remove')}
                    <span className="sr-only"> {name}</span>
                  </Button>
                )}
                {!isOwner && me && (
                  <Button type="button" variant="outline" className={cn(BTN_TOUCH, 'gap-1.5 text-red-700 hover:text-red-800')} onClick={() => setConfirm({ kind: 'leave' })}>
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                    {t('dash.leave', 'Leave the company')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Invitations still open. */}
      {pending.length > 0 && (
        <section aria-labelledby="team-invites-title" className="rounded-card border border-rule bg-white">
          <h4 id="team-invites-title" className="border-b border-rule px-4 py-3 text-[15px] font-semibold text-navy sm:px-5">
            {t('dash.invitesOpen', { count: pending.length, defaultValue_one: '{{count}} invitation not answered yet', defaultValue_other: '{{count}} invitations not answered yet' })}
          </h4>
          <ul className="divide-y divide-rule">
            {pending.map((inv) => (
              <li key={inv.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-dashed border-amber-300 bg-amber-50 text-amber-800">
                    <Mail className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold text-navy">{inv.email}</p>
                    <p className="text-[13px] text-meta">{t('dash.invitedOn', { date: day(inv.created_at), defaultValue: 'Invited on {{date}}' })}</p>
                  </div>
                </div>
                {isOwner && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className={BTN_TOUCH}
                      onClick={() => {
                        resendTeamInvitation(organization, inv, inviterName(profile, user.email));
                        toast({ title: t('dash.inviteResent', 'Invitation sent again'), description: inv.email });
                      }}
                    >
                      {t('dash.sendAgain', 'Send again')}
                      <span className="sr-only"> {inv.email}</span>
                    </Button>
                    <Button type="button" variant="outline" className={cn(BTN_TOUCH, 'text-red-700 hover:text-red-800')} onClick={() => setConfirm({ kind: 'cancel', inv })}>
                      {t('dash.cancelInvite', 'Cancel it')}
                      <span className="sr-only"> {inv.email}</span>
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* The full editor, on its team section (transfer the ownership…). */}
      {isOwner && (
        <>
          <div className="rounded-card border border-dashed border-rule bg-white/60 px-4 py-3 sm:px-5">
            <button
              type="button"
              onClick={() => { setMoreOpen((o) => !o); if (moreOpen) reload(); }}
              aria-expanded={moreOpen}
              aria-controls="team-more-settings"
              className="flex min-h-11 w-full items-center justify-between gap-3 rounded-field text-left focus:outline-none focus-visible:shadow-focus"
            >
              <span>
                <span className="block text-[16px] font-semibold text-navy">{moreOpen ? t('dash.hideMore', 'Hide more settings') : t('dash.moreSettings', 'More settings')}</span>
                <span className="block text-[14px] leading-5 text-meta">{t('dash.teamMoreHint', 'Hand the company over to a colleague, and the full team list.')}</span>
              </span>
              <ChevronDown className={cn('h-5 w-5 shrink-0 text-meta transition-transform motion-reduce:transition-none', moreOpen && 'rotate-180')} aria-hidden="true" />
            </button>
          </div>
          <div id="team-more-settings">
            {moreOpen && (
              <Suspense fallback={<div className="rounded-card border border-rule bg-white"><RowSkeleton rows={3} /></div>}>
                <OrganizationWorkspace
                  section="team"
                  syncAddress={false}
                  onSaved={() => { setReloadKey((k) => k + 1); onChanged(); onInboxChanged(); }}
                />
              </Suspense>
            )}
          </div>
        </>
      )}

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} org={organization} occupiedSeats={occupied} onSent={reload} />
      <JoinRequestsDialog
        open={joinOpen}
        onOpenChange={(o) => {
          setJoinOpen(o);
          if (o) return;
          reload();
          // The to-do, the team and Messages tiles and the navbar count the same requests.
          onInboxChanged();
        }}
        org={organization}
        onAnswered={() => undefined}
      />
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => { if (!o) setConfirm(null); }}
        title={confirm?.kind === 'remove'
          ? t('dash.removeTitle', { name: nameOf(confirm.member), defaultValue: 'Remove {{name}} from your team?' })
          : confirm?.kind === 'cancel'
            ? t('dash.cancelInviteTitle', { email: confirm.inv.email, defaultValue: 'Cancel the invitation to {{email}}?' })
            : t('dash.leaveTitle', { org: organization.name, defaultValue: 'Leave {{org}}?' })}
        body={confirm?.kind === 'remove'
          ? t('dash.removeBody', 'They will no longer act for your company on the platform. You can invite them again later.')
          : confirm?.kind === 'cancel'
            ? t('dash.cancelInviteBody', 'The link in their e-mail will stop working.')
            : t('dash.leaveBody', 'You will no longer act for this company. To come back, ask its owner to invite you again.')}
        confirmLabel={confirm?.kind === 'remove' ? t('dash.yesRemove', 'Yes, remove') : confirm?.kind === 'cancel' ? t('dash.yesCancel', 'Yes, cancel it') : t('dash.yesLeave', 'Yes, leave')}
        onConfirm={doConfirm}
      />
    </div>
  );
}
