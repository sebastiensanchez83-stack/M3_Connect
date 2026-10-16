import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CalendarDays, Loader2, Mail, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import type { InvitationCampaign, InvitationCampaignSettings, InvitationDuplicate, InvitationRecipient, InvitationRecipientUpdate } from './types';
import {
  campaignCounts, createCampaign, deleteRecipients, emailLog, eventGuests, findDuplicates, getCampaign, listCampaigns, listEvents,
  listRecipients, unlinkedRows, updateCampaign, updateRecipient, type EmailLogLite, type GlEventLite, type GlGuestLite,
} from './lib/api';
import { buildRows, daysUntil } from './lib/model';
import { PRESETS } from './lib/presets';
import { dateLabel } from './lib/render';
import { GuestsTab } from './GuestsTab';
import { PreviewPanel } from './PreviewPanel';
import { SendTab } from './SendTab';
import { TrackingTab } from './TrackingTab';
import { SettingsTab } from './SettingsTab';

/* ─── "Invitation campaigns" (admin, Events > On-site): /admin/invitations and /admin/invitations/:campaignId ───
 * Staff only (verified admins and moderators: RLS on every table). A campaign invites
 * people to one guest-list event: each invitee becomes an "invited" row of that guest
 * list when the invitation goes out (same token, QR, door and personal page).
 */
export function AdminInvitations() {
  return (
    <Routes>
      <Route index element={<CampaignList />} />
      <Route path=":campaignId" element={<CampaignPage />} />
    </Routes>
  );
}

const notInstalled = (m: string) => /invitation_(campaign|recipient)|does not exist|schema cache/i.test(m);

function CampaignList() {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<InvitationCampaign[] | null>(null);
  const [events, setEvents] = useState<GlEventLite[]>([]);
  const [counts, setCounts] = useState<{ campaign_id: string; status: string; gl_guest_id: string | null }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, e, n] = await Promise.all([listCampaigns(), listEvents(), campaignCounts()]);
      setCampaigns(c); setEvents(e); setCounts(n); setError(null);
    } catch (err) { setError((err as Error).message); setCampaigns([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const evTitle = (id: string) => events.find(e => e.id === id)?.title || 'Unknown event';
  const stat = (id: string) => {
    const mine = counts.filter(c => c.campaign_id === id);
    return { total: mine.length, sent: mine.filter(c => c.gl_guest_id).length, accepted: mine.filter(c => c.status === 'accepted').length };
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Invitation campaigns</h1>
          <p className="text-sm text-gray-500 max-w-2xl">Personal invitations by e-mail, with a ticket and a letter in PDF. Every invitee joins the event's guest list when the invitation goes out: same QR and door as the other guests.</p>
        </div>
        <Button onClick={() => setCreating(true)} disabled={!!error}><Plus className="h-4 w-4 mr-1" /> New campaign</Button>
      </div>
      {error && (
        <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {notInstalled(error) ? 'The invitation tables are not installed on this database yet (step 1 migrations).' : `The campaigns could not be loaded: ${error}`}
        </div>
      )}
      {campaigns === null ? <div className="flex justify-center py-16"><RefreshCw className="h-8 w-8 animate-spin text-primary" /></div> : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {campaigns.map(c => {
            const s = stat(c.id);
            const left = daysUntil(c.rsvp_deadline);
            return (
              <li key={c.id}>
                <Link to={`/admin/invitations/${c.id}`} className="block rounded-lg border bg-white p-4 hover:border-[#5E9CC4] hover:shadow-sm transition">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-gray-900 break-words">{c.name}</div>
                      <div className="text-sm text-gray-500">{evTitle(c.gl_event_id)}</div>
                    </div>
                    {c.archived_at && <span className="text-xs rounded bg-gray-100 px-2 py-0.5 text-gray-600">Archived</span>}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
                    <span><b>{s.total}</b> guests</span><span><b>{s.sent}</b> invited</span><span><b>{s.accepted}</b> accepted</span>
                    {c.rsvp_deadline && <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />RSVP {dateLabel(c.rsvp_deadline)}{left !== null && left >= 0 ? `, ${left} days left` : ''}</span>}
                  </div>
                </Link>
              </li>
            );
          })}
          {!campaigns.length && !error && <li className="text-sm text-gray-500 sm:col-span-2">No campaign yet. The first one can start from the WYS 2026 Dubai texts of the kit.</li>}
        </ul>
      )}
      <NewCampaignDialog open={creating} onClose={() => setCreating(false)} events={events} hasCampaigns={!!campaigns?.length}
        onCreated={c => navigate(`/admin/invitations/${c.id}?tab=settings`)} />
    </div>
  );
}

function NewCampaignDialog({ open, onClose, events, hasCampaigns, onCreated }: {
  open: boolean; onClose: () => void; events: GlEventLite[]; hasCampaigns: boolean; onCreated: (c: InvitationCampaign) => void;
}) {
  const usable = events.filter(e => e.engine === 'guest_list_v1');
  const [eventId, setEventId] = useState('');
  const [preset, setPreset] = useState(PRESETS[0].key);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const wys = usable.find(e => e.slug === 'wys26') || usable[0];
    setEventId(wys?.id || ''); setPreset(PRESETS[0].key); setName('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, events]);
  const create = async () => {
    const p = PRESETS.find(x => x.key === preset)!;
    setBusy(true);
    try {
      const row = p.build(eventId);
      const c = await createCampaign({ ...row, name: name.trim() || row.name });
      toast({ title: 'Campaign created', description: 'Check its settings, then import the guests.' });
      onClose(); onCreated(c);
    } catch (e) { toast({ title: 'Not created', description: (e as Error).message, variant: 'destructive' }); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-lg">
        <DialogHeader><DialogTitle>New invitation campaign</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <label className="block"><span className="block text-xs font-medium text-gray-600 mb-1">Event (its guest list receives the invitees)</span>
            <select className="border rounded-md h-10 px-2 bg-white w-full" value={eventId} onChange={e => setEventId(e.target.value)}>
              {usable.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
            </select>
          </label>
          <label className="block"><span className="block text-xs font-medium text-gray-600 mb-1">Start from</span>
            <select className="border rounded-md h-10 px-2 bg-white w-full" value={preset} onChange={e => setPreset(e.target.value)}>
              {PRESETS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </label>
          <label className="block"><span className="block text-xs font-medium text-gray-600 mb-1">Name (optional)</span>
            <Input value={name} placeholder={PRESETS.find(p => p.key === preset)?.build(eventId).name} onChange={e => setName(e.target.value)} />
          </label>
          {!hasCampaigns && preset === PRESETS[0].key && <p className="text-xs text-gray-500">Prefilled with the kit's WYS 2026 Dubai texts: ticket, letter and e-mail, all editable.</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button disabled={busy || !eventId} onClick={create}>{busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Create</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── One campaign ─── */

type Tab = 'guests' | 'preview' | 'send' | 'tracking' | 'settings';
const TABS: { key: Tab; label: string }[] = [
  { key: 'guests', label: 'Guests' }, { key: 'preview', label: 'Preview' }, { key: 'send', label: 'Send' },
  { key: 'tracking', label: 'Tracking' }, { key: 'settings', label: 'Settings' },
];

function CampaignPage() {
  const { campaignId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find(t => t.key === params.get('tab'))?.key || 'guests') as Tab;
  const setTab = (t: Tab) => setParams(p => { const n = new URLSearchParams(p); n.set('tab', t); return n; }, { replace: true });

  const [campaign, setCampaign] = useState<InvitationCampaign | null>(null);
  const [missing, setMissing] = useState(false);
  const [events, setEvents] = useState<GlEventLite[]>([]);
  const [recipients, setRecipients] = useState<InvitationRecipient[]>([]);
  const [guests, setGuests] = useState<GlGuestLite[]>([]);
  const [log, setLog] = useState<EmailLogLite[]>([]);
  const [dups, setDups] = useState<InvitationDuplicate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reloadDups = useCallback(async () => {
    try {
      const [all, own] = await Promise.all([findDuplicates(campaignId), unlinkedRows(campaignId)]);
      // A guest's own row, cancelled after a refused send, is not a duplicate: the next send re-opens it.
      setDups(all.filter(d => !(d.other_kind === 'guest' && d.other_status === 'cancelled' && own.has(`${d.recipient_id}:${d.other_id}`))));
    } catch { /* shown as no duplicate; the import already checked */ }
  }, [campaignId]);

  const reload = useCallback(async () => {
    try {
      const c = await getCampaign(campaignId);
      if (!c) { setMissing(true); return; }
      const [ev, rs, gs] = await Promise.all([listEvents(), listRecipients(campaignId), eventGuests(c.gl_event_id)]);
      const lg = await emailLog(rs.map(r => r.gl_guest_id).filter(Boolean) as string[]);
      setCampaign(c); setEvents(ev); setRecipients(rs); setGuests(gs); setLog(lg); setError(null);
      setSelectedId(s => (s && rs.some(r => r.id === s) ? s : rs[0]?.id || null));
      reloadDups();
    } catch (e) { setError((e as Error).message); }
  }, [campaignId, reloadDups]);
  useEffect(() => { reload(); }, [reload]);

  const event = events.find(e => e.id === campaign?.gl_event_id) || null;
  const rows = useMemo(() => (campaign ? buildRows(campaign, recipients, guests, dups, log) : []), [campaign, recipients, guests, dups, log]);

  const saveRecipient = useCallback(async (id: string, patch: InvitationRecipientUpdate): Promise<boolean> => {
    try {
      const updated = await updateRecipient(id, patch);
      setRecipients(rs => rs.map(r => (r.id === id ? updated : r)));
      if ('email' in patch || 'first_name' in patch || 'last_name' in patch || 'name_on_ticket' in patch || 'organisation' in patch) {
        if (dupTimer.current) clearTimeout(dupTimer.current);
        dupTimer.current = setTimeout(reloadDups, 400);
      }
      return true;
    } catch (e) {
      const err = e as Error & { code?: string };
      toast({
        title: 'Not saved',
        description: err.code === '23505' ? 'Another guest of this campaign already has this e-mail address: one address, one person.' : err.message,
        variant: 'destructive',
      });
      return false;
    }
  }, [reloadDups]);

  const removeRecipients = useCallback(async (ids: string[]) => {
    try {
      await deleteRecipients(ids);
      setRecipients(rs => rs.filter(r => !ids.includes(r.id)));
      toast({ title: `${ids.length} guest${ids.length === 1 ? '' : 's'} removed` });
      reloadDups();
    } catch (e) { toast({ title: 'Not removed', description: (e as Error).message, variant: 'destructive' }); }
  }, [reloadDups]);

  const patchCampaign = useCallback(async (patch: Parameters<typeof updateCampaign>[1]) => {
    if (!campaign) return;
    try { setCampaign(await updateCampaign(campaign.id, patch)); }
    catch (e) { toast({ title: 'Not saved', description: (e as Error).message, variant: 'destructive' }); }
  }, [campaign]);
  const patchSettings = useCallback(async (patch: Partial<InvitationCampaignSettings>) => {
    if (!campaign) return;
    await patchCampaign({ settings: { ...(campaign.settings || {}), ...patch } });
  }, [campaign, patchCampaign]);

  if (missing) return <div className="space-y-3"><BackLink /><p className="text-gray-500">This campaign does not exist (or was deleted).</p></div>;
  if (error && !campaign) return <div className="space-y-3"><BackLink /><p role="alert" className="text-red-700">The campaign could not be loaded: {error}</p></div>;
  if (!campaign) return <div className="flex justify-center py-20"><RefreshCw className="h-8 w-8 animate-spin text-primary" /></div>;

  const s = campaign.settings || {};
  const selected = rows.find(g => g.r.id === selectedId) || null;
  const invitedAny = rows.some(g => g.r.gl_guest_id || !['draft', 'ready'].includes(g.r.status));

  return (
    <div className="space-y-4 max-w-[1400px]">
      <BackLink />
      <header className="rounded-lg bg-[#0A2E5C] text-white px-4 py-4 sm:px-6 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.22em] text-[#8EC5E5] font-medium">{[s.name, s.edition].filter(Boolean).join(' · ') || event?.title}</div>
          <h1 className="text-2xl sm:text-3xl italic break-words" style={{ fontFamily: 'Palatino, "Palatino Linotype", "Book Antiqua", Georgia, serif' }}>{campaign.name}</h1>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-[#C9DAEC]">
          {s.date_label && <span><b className="text-white font-medium">{s.date_label}</b></span>}
          {s.venue && <span>{s.venue}</span>}
          {campaign.rsvp_deadline && <span>RSVP by <b className="text-white font-medium">{dateLabel(campaign.rsvp_deadline)}</b>{s.rsvp_email ? ` to ${s.rsvp_email}` : ''}</span>}
          {event && <span>Guest list: {event.title}</span>}
          {campaign.archived_at && <span className="rounded bg-white/15 px-2">Archived</span>}
        </div>
      </header>

      <div className="overflow-x-auto -mx-1 px-1">
        <div role="tablist" aria-label="Campaign" className="inline-flex gap-1 border-b min-w-full">
          {TABS.map(t => (
            <button key={t.key} role="tab" type="button" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
              className={`px-3 sm:px-4 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${tab === t.key ? 'border-[#0A2E5C] text-gray-900 font-medium' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
              {t.label}{t.key === 'guests' ? ` (${rows.length})` : ''}
            </button>
          ))}
        </div>
      </div>

      {tab === 'guests' && (
        <GuestsTab campaign={campaign} rows={rows} guests={guests} selectedId={selectedId} onSelect={setSelectedId}
          saveRecipient={saveRecipient} removeRecipients={removeRecipients} patchSettings={patchSettings}
          setStyle={st => patchCampaign({ ticket_style: st })} reload={reload} />
      )}
      {tab === 'preview' && (
        <div className="space-y-3 max-w-5xl">
          <label className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-gray-600">Guest</span>
            <select className="border rounded-md h-10 px-2 bg-white max-w-full" value={selectedId || ''} onChange={e => setSelectedId(e.target.value)}>
              {rows.map((g, i) => <option key={g.r.id} value={g.r.id}>{String(i + 1).padStart(2, '0')} {g.r.name_on_ticket}</option>)}
            </select>
          </label>
          <PreviewPanel campaign={campaign} recipient={selected?.r || null} onStyle={st => patchCampaign({ ticket_style: st })} large />
        </div>
      )}
      {tab === 'send' && <SendTab campaign={campaign} rows={rows} event={event} selectedId={selectedId} reload={reload} />}
      {tab === 'tracking' && <TrackingTab campaign={campaign} rows={rows} event={event} guests={guests} reload={reload} />}
      {tab === 'settings' && (
        <SettingsTab campaign={campaign} events={events} hasGuests={rows.length > 0} invitedAny={invitedAny} onSaved={setCampaign} />
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/admin/invitations" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-primary pl-10 md:pl-0 min-h-[36px]">
      <ArrowLeft className="h-4 w-4" /><Mail className="h-4 w-4" /> Invitation campaigns
    </Link>
  );
}
