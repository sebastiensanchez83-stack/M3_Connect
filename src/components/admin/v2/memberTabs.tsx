import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, ClipboardList, Flag, History, HeartHandshake, Loader2, StickyNote, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { CardLink } from '@/components/home/dashboard/DashboardKit';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { TIER_LABELS, type OrgTier } from '@/types/database';
import { AdminEmpty, AdminLoading, AdminPanel, AdminStatus, ADMIN_BTN_DANGER, ADMIN_BTN_PRIMARY } from '../AdminUI';
import { LinkRow, Note } from './MembersKit';
import {
  addNote, deleteNote, fmtDate, loadHistory, loadNotes, loadRegistrations, loadReports, loadRequests, loadSponsoring, money,
  type HistoryItem, type InvitationRecord, type Loaded, type NoteItem, type ReportItem, type RegistrationItem, type RequestItem,
  type Scope, type SponsoringData,
} from './membersApi';

/**
 * The read-only tabs shared by the company page and the person page. Each one shows what the
 * database holds and links to the ONE screen that manages it (VIEW everywhere, ACT in one place).
 * Notes is the only tab that writes (M3's own internal notes).
 */

function useLoaded<T>(load: () => Promise<Loaded<T>>, deps: unknown[]): { data: Loaded<T> | null; reload: () => void } {
  const [data, setData] = useState<Loaded<T> | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setData(null);
    load().then(
      r => { if (alive) setData(r); },
      (e: unknown) => { if (alive) setData({ rows: null as unknown as T, error: e instanceof Error ? e.message : 'Could not load.' }); },
    );
    return () => { alive = false; };
  }, [...deps, n]);
  return { data, reload: () => setN(x => x + 1) };
}

const scopeKey = (s: Scope) => `${s.orgId ?? ''}|${s.userIds.join(',')}|${s.emails.join(',')}`;

/* ------------------------------------------------------------------ registrations */

export function RegistrationsTab({ scope, onCount }: { scope: Scope; onCount?: (n: number) => void }) {
  const { t } = useTranslation();
  const { data } = useLoaded<RegistrationItem[]>(() => loadRegistrations(scope), [scopeKey(scope)]);
  useEffect(() => { if (data?.rows) onCount?.(data.rows.length); }, [data, onCount]);
  if (!data) return <AdminLoading />;
  const rows = data.rows ?? [];
  return (
    <AdminPanel
      title={t('adminMembers.reg.title', 'Event registrations')}
      icon={CalendarDays}
      description={t('adminMembers.reg.desc', 'Read only. A registration is accepted, refused or checked in only inside its event: press the button on its row.')}
      padded={false}
    >
      {data.error && <div className="px-5 pt-4"><Note tone="warning">{data.error}</Note></div>}
      {rows.length === 0 ? (
        <AdminEmpty icon={CalendarDays} title={t('adminMembers.reg.none', 'No event registration')} />
      ) : (
        <ul className="divide-y divide-rule">
          {rows.map(r => (
            <LinkRow
              key={r.key}
              to={r.manageTo}
              title={`${r.person} · ${r.event}`}
              meta={[r.system, r.eventDate ? fmtDate(r.eventDate) : null, r.createdAt ? t('adminMembers.reg.on', 'registered {{date}}', { date: fmtDate(r.createdAt) }) : null].filter(Boolean).join(' · ')}
              aside={<AdminStatus status={r.status === 'checked in' ? 'completed' : r.status} label={r.status === 'checked in' ? 'Checked in' : undefined} />}
              cue={t(`adminMembers.reg.cue.${r.system === 'Smart Marina 2026' ? 'sm' : r.system === 'Guest list' ? 'guestList' : 'event'}`, r.manageLabel)}
            />
          ))}
        </ul>
      )}
    </AdminPanel>
  );
}

/* ------------------------------------------------------------------ requests */

export function RequestsTab({ scope, onCount }: { scope: Scope; onCount?: (n: number) => void }) {
  const { t } = useTranslation();
  const { data } = useLoaded<RequestItem[]>(() => loadRequests(scope), [scopeKey(scope)]);
  useEffect(() => { if (data?.rows) onCount?.(data.rows.length); }, [data, onCount]);
  if (!data) return <AdminLoading />;
  const rows = data.rows ?? [];
  return (
    <AdminPanel
      title={t('adminMembers.req.title', 'Requests')}
      icon={ClipboardList}
      description={t('adminMembers.req.desc', 'RFPs, projects, consultations and leads. Read only: each one is handled in the Marketplace.')}
      padded={false}
    >
      {data.error && <div className="px-5 pt-4"><Note tone="warning">{data.error}</Note></div>}
      {rows.length === 0 ? (
        <AdminEmpty icon={ClipboardList} title={t('adminMembers.req.none', 'No request')} />
      ) : (
        <ul className="divide-y divide-rule">
          {rows.map(r => (
            <LinkRow
              key={r.key}
              to={r.to}
              title={r.title}
              meta={`${r.kind} · ${fmtDate(r.createdAt)}`}
              aside={<AdminStatus status={r.status} />}
              cue={t('adminMembers.req.cue', 'Open in the Marketplace')}
            />
          ))}
        </ul>
      )}
    </AdminPanel>
  );
}

/* ------------------------------------------------------------------ reported conversations */

export function MessagesTab({ scope }: { scope: Scope }) {
  const { t } = useTranslation();
  const { data } = useLoaded<{ reports: ReportItem[]; conversations: number }>(() => loadReports(scope), [scopeKey(scope)]);
  if (!data) return <AdminLoading />;
  const reports = data.rows?.reports ?? [];
  const open = reports.filter(r => r.status === 'open').length;
  return (
    <AdminPanel
      title={t('adminMembers.msg.title', 'Reported conversations')}
      icon={Flag}
      description={t('adminMembers.msg.desc', 'Messages stay private: M3 sees only what a member reported. Reports are closed in To validate.')}
      actions={open > 0 ? <CardLink to="/admin/review?tab=content">{t('adminMembers.msg.handle', 'Handle in To validate')}</CardLink> : undefined}
      padded={false}
    >
      <div className="px-5 pt-4">
        <Note>
          {t('adminMembers.msg.count', {
            count: data.rows?.conversations ?? 0,
            defaultValue_one: '{{count}} conversation with other members.',
            defaultValue_other: '{{count}} conversations with other members.',
          })}
        </Note>
        {data.error && <div className="mt-3"><Note tone="warning">{data.error}</Note></div>}
      </div>
      {reports.length === 0 ? (
        <AdminEmpty icon={Flag} title={t('adminMembers.msg.none', 'Nothing reported')} />
      ) : (
        <ul className="mt-2 divide-y divide-rule">
          {reports.map(r => (
            <LinkRow
              key={r.id}
              to={r.status === 'open' ? '/admin/review?tab=content' : null}
              title={r.reason || t('adminMembers.msg.noReason', 'No reason given')}
              meta={[
                r.reportedByScope ? t('adminMembers.msg.byThem', 'Reported by them') : t('adminMembers.msg.aboutThem', 'A conversation with them was reported'),
                fmtDate(r.createdAt),
                r.excerpt ? `“${r.excerpt.slice(0, 140)}${r.excerpt.length > 140 ? '…' : ''}”` : null,
              ].filter(Boolean).join(' · ')}
              aside={<AdminStatus status={r.status} />}
              cue={t('adminMembers.msg.cue', 'Handle in To validate')}
            />
          ))}
        </ul>
      )}
    </AdminPanel>
  );
}

/* ------------------------------------------------------------------ sponsoring */

export function SponsoringTab({ orgId, tier }: { orgId: string; tier: string | null }) {
  const { t } = useTranslation();
  const { data } = useLoaded<SponsoringData>(() => loadSponsoring(orgId), [orgId]);
  if (!data) return <AdminLoading />;
  const d = data.rows ?? { sponsors: [], agreements: [], invoices: [] };
  const sponsorId = d.sponsors[0]?.id;
  const paying = !!tier && tier !== 'member';
  return (
    <div className="space-y-6">
      <AdminPanel
        title={t('adminMembers.sp.title', 'Sponsoring')}
        icon={HeartHandshake}
        description={t('adminMembers.sp.desc', 'Read only. Contracts, benefits and invoices are managed in Sponsors and partners.')}
        actions={<CardLink to={sponsorId ? `/admin/sponsorships/${sponsorId}` : '/admin/sponsorships'}>{t('adminMembers.sp.manage', 'Manage in Sponsors and partners')}</CardLink>}
      >
        {data.error && <div className="mb-4"><Note tone="warning">{data.error}</Note></div>}
        <p className="text-[15px] leading-6 text-ink">
          {t('adminMembers.sp.plan', 'Plan:')}{' '}
          <span className="font-semibold text-navy">{tier ? TIER_LABELS[tier as OrgTier] ?? tier : '—'}</span>
          {' · '}
          {paying
            ? t('adminMembers.sp.listed', 'listed among the sponsors once verified (Partners page, home page band, event pages).')
            : t('adminMembers.sp.notListed', 'not listed among the sponsors.')}
        </p>
      </AdminPanel>

      <AdminPanel title={t('adminMembers.sp.contracts', 'Contracts')} padded={false}>
        {d.agreements.length === 0 ? (
          <AdminEmpty title={t('adminMembers.sp.noContract', 'No sponsoring contract')} />
        ) : (
          <ul className="divide-y divide-rule">
            {d.agreements.map(a => (
              <LinkRow
                key={a.id}
                to={`/admin/sponsorships/${a.sponsor_id}`}
                title={a.tier_key ? a.tier_key.replace(/_/g, ' ') : t('adminMembers.sp.contract', 'Contract')}
                meta={`${fmtDate(a.term_start)} → ${fmtDate(a.term_end)} · ${money(a.negotiated_fee_cents, a.currency, true)}`}
                aside={<AdminStatus status={a.status} />}
                cue={t('adminMembers.sp.open', 'Open the contract')}
              />
            ))}
          </ul>
        )}
      </AdminPanel>

      <AdminPanel title={t('adminMembers.sp.invoices', 'Invoices')} padded={false}>
        {d.invoices.length === 0 ? (
          <AdminEmpty title={t('adminMembers.sp.noInvoice', 'No invoice')} />
        ) : (
          <ul className="divide-y divide-rule">
            {d.invoices.map(i => (
              <LinkRow
                key={i.id}
                to={null}
                title={i.invoice_number || t('adminMembers.sp.invoice', 'Invoice')}
                meta={`${fmtDate(i.invoice_date)} · ${money(i.total_amount, i.currency_code)}${i.balance_due ? ` · ${t('adminMembers.sp.due', 'due')} ${money(i.balance_due, i.currency_code)}` : ''}`}
                aside={<AdminStatus status={i.display_status} />}
                cue=""
              />
            ))}
          </ul>
        )}
      </AdminPanel>
    </div>
  );
}

/* ------------------------------------------------------------------ history */

export function HistoryTab({ scope, invitations }: { scope: Scope; invitations?: InvitationRecord[] }) {
  const { t } = useTranslation();
  const { data } = useLoaded<HistoryItem[]>(() => loadHistory(scope, invitations), [scopeKey(scope), invitations?.length ?? 0]);
  if (!data) return <AdminLoading />;
  const rows = data.rows ?? [];
  return (
    <AdminPanel
      title={t('adminMembers.hist.title', 'History')}
      icon={History}
      description={t('adminMembers.hist.desc', 'What the database recorded: creation, M3 decisions, invitations and join requests, newest first.')}
      padded={false}
    >
      {data.error && <div className="px-5 pt-4"><Note tone="warning">{data.error}</Note></div>}
      {rows.length === 0 ? (
        <AdminEmpty icon={History} title={t('adminMembers.hist.none', 'Nothing recorded yet')} />
      ) : (
        <ol className="divide-y divide-rule">
          {rows.map(h => (
            <li key={h.key} className="flex flex-col gap-0.5 px-5 py-3 sm:flex-row sm:items-baseline sm:gap-4">
              <span className="w-28 shrink-0 text-[13px] tabular-nums text-meta">{fmtDate(h.at)}</span>
              <span className="min-w-0 text-[15px] leading-6 text-ink [overflow-wrap:anywhere]">
                <span className="font-semibold text-navy">{h.what}</span>
                {h.detail && <> · {h.detail}</>}
                {h.actor && <span className="text-meta"> · {t('adminMembers.hist.by', 'by {{name}}', { name: h.actor })}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </AdminPanel>
  );
}

/* ------------------------------------------------------------------ internal notes */

export function NotesTab({ subject }: { subject: { orgId?: string | null; userId?: string | null } }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [state, setState] = useState<{ rows: NoteItem[]; state: 'ok' | 'missing' | 'error' } | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const key = `${subject.orgId ?? ''}|${subject.userId ?? ''}`;

  const load = useCallback(() => { loadNotes(subject).then(setState, () => setState({ rows: [], state: 'error' })); },
    [key]);
  useEffect(() => { setState(null); load(); }, [load]);

  const save = async () => {
    if (!user || !draft.trim()) return;
    setBusy(true);
    try {
      await addNote(subject, draft, user.id);
      setDraft('');
      toast({ title: t('adminMembers.notes.saved', 'Note saved') });
      load();
    } catch (e) {
      toast({ title: t('adminMembers.notes.failed', 'The note was not saved'), description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
    setBusy(false);
  };

  const remove = async (n: NoteItem) => {
    if (!window.confirm(t('adminMembers.notes.confirmDelete', 'Delete this note for good?'))) return;
    try {
      await deleteNote(n.id);
      load();
    } catch (e) {
      toast({ title: t('adminMembers.notes.deleteFailed', 'The note was not deleted'), description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  };

  if (!state) return <AdminLoading />;
  return (
    <AdminPanel
      title={t('adminMembers.notes.title', 'Internal notes')}
      icon={StickyNote}
      description={t('adminMembers.notes.desc', 'For the M3 team only. Members never see them.')}
    >
      {state.state === 'missing' ? (
        <Note tone="warning">{t('adminMembers.notes.missing', 'Notes are not set up yet: the database update for them is waiting for approval.')}</Note>
      ) : (
        <>
          {state.state === 'error' && <div className="mb-4"><Note tone="warning">{t('adminMembers.notes.error', 'The notes could not be read. Reload the page to try again.')}</Note></div>}
          <label className="block">
            <span className="text-[14px] font-semibold text-navy">{t('adminMembers.notes.new', 'Write a note')}</span>
            <Textarea value={draft} onChange={e => setDraft(e.target.value)} rows={3} maxLength={4000} className="mt-1.5 bg-white"
              placeholder={t('adminMembers.notes.placeholder', 'What the team should know: a phone call, a promise, a detail to check…')} />
          </label>
          <Button type="button" variant="secondary" className={`${ADMIN_BTN_PRIMARY} mt-3`} onClick={save} disabled={busy || !draft.trim()}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {t('adminMembers.notes.add', 'Save the note')}
          </Button>
          {state.rows.length === 0 ? (
            <p className="mt-5 text-[14px] text-meta">{t('adminMembers.notes.none', 'No note yet.')}</p>
          ) : (
            <ul className="mt-5 space-y-3">
              {state.rows.map(n => (
                <li key={n.id} className="rounded-xl border border-rule bg-page px-4 py-3">
                  <p className="whitespace-pre-wrap text-[15px] leading-6 text-ink [overflow-wrap:anywhere]">{n.body}</p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[13px] text-meta">
                    <span>{n.author} · {fmtDate(n.created_at)}</span>
                    {n.author_id === user?.id && (
                      <Button type="button" variant="outline" size="sm" className={`${ADMIN_BTN_DANGER} h-9`} onClick={() => remove(n)}>
                        <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminMembers.notes.delete', 'Delete')}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </AdminPanel>
  );
}

