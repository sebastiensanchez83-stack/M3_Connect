import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CalendarDays, ChevronRight, Loader2, Mail, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import type { InvitationCampaign, InvitationCampaignSettings, InvitationDuplicate, InvitationRecipient, InvitationRecipientUpdate } from './types';
import {
  campaignCounts, createCampaign, deleteRecipients, emailLog, eventGuests, findDuplicates, getCampaign, listCampaigns, listEvents,
  listRecipients, sendChannels, unlinkedRows, updateCampaign, updateRecipient, type EmailLogLite, type GlEventLite, type GlGuestLite,
} from './lib/api';
import { buildRows, daysUntil } from './lib/model';
import { PRESETS } from './lib/presets';
import { dateLabel } from './lib/render';
import { GuestsTab } from './GuestsTab';
import { PreviewPanel } from './PreviewPanel';
import { SendTab } from './SendTab';
import { HandTab } from './HandTab';
import { TrackingTab } from './TrackingTab';
import { SettingsTab } from './SettingsTab';

/* ─── Invitations of a guest-list event (admin, Events > On-site > WYS 2026 > Invitations) ───
 * /admin/guest-list/:slug/invitations opens the event's campaign directly (as SM26 has its
 * Invitations under the event), or offers to start it from the event's preset; with several
 * campaigns it lists them (/admin/guest-list/:slug/invitations/:campaignId).
 * /admin/invitations and /admin/invitations/:campaignId (every campaign) keep working.
 * Staff only (verified admins and moderators: RLS on every table). A campaign invites
 * people to one guest-list event: each invitee becomes an "invited" row of that guest
 * list when the invitation goes out, by the platform's e-mail or marked as sent by hand
 * (same token, QR, door and personal page).
 */
export function AdminInvitations() {
  return (
    <Routes>
      <Route index element={<CampaignList />} />
      <Route path=":campaignId" element={<CampaignRoute />} />
    </Routes>
  );
}

function CampaignRoute() {
  const { campaignId = '' } = useParams();
  return <CampaignPage key={campaignId} campaignId={campaignId} back={<BackLink />} listPath="/admin/invitations" />;
}

export function AdminEventInvitations() {
  return (
    <Routes>
      <Route index element={<EventInvitationsLanding />} />
      <Route path=":campaignId" element={<EventCampaignRoute />} />
    </Routes>
  );
}

/** The preset a new campaign of this event starts from. */
const presetFor = (slug: string) => PRESETS.find(p => p.key === (slug === 'wys26' ? 'wys-dubai-2026' : 'blank')) || PRESETS[0];

/**
 * The event and its campaigns. Loaded when the page opens (and again by `load`, after a campaign
 * was created or deleted), NOT on every navigation: a tab switch only changes ?tab=, and a
 * reload there could swap the open campaign for an error box. A refresh that fails keeps what
 * is on screen and says so in a toast.
 */
function useEventCampaigns(slug: string) {
  const [state, setState] = useState<{ event: GlEventLite | null; campaigns: InvitationCampaign[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [events, campaigns] = await Promise.all([listEvents(), listCampaigns()]);
      const event = events.find(e => e.slug === slug) || null;
      setState({ event, campaigns: event ? campaigns.filter(c => c.gl_event_id === event.id) : [] });
      setError(null);
      loaded.current = slug;
    } catch (e) {
      const msg = (e as Error).message;
      if (loaded.current === slug) { toast({ title: 'The invitations could not be refreshed', description: msg, variant: 'destructive' }); return; }
      setError(msg); setState({ event: null, campaigns: [] });
    }
  }, [slug]);
  useEffect(() => { load(); }, [load]);
  return { state, error, load };
}

function EventCrumb({ slug, title, campaign }: { slug: string; title: string; campaign?: { id: string; name: string } }) {
  // The event's guest list is admin-only (AdminOnlyGuard): a moderator gets its name, not a link.
  const { isAdmin } = useAuth();
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-gray-500 pl-10 md:pl-0 min-h-[36px]">
      {isAdmin ? <Link to={`/admin/guest-list/${slug}`} className="hover:text-primary">{title}</Link> : <span>{title}</span>}
      <ChevronRight className="h-3.5 w-3.5" />
      {campaign ? <Link to={`/admin/guest-list/${slug}/invitations`} className="hover:text-primary">Invitations</Link>
        : <span className="inline-flex items-center gap-1 text-gray-700"><Mail className="h-4 w-4" /> Invitations</span>}
      {campaign && <><ChevronRight className="h-3.5 w-3.5" /><span className="text-gray-700 break-words">{campaign.name}</span></>}
    </nav>
  );
}

function EventInvitationsLanding() {
  const { slug = '' } = useParams();
  const { state, error, load } = useEventCampaigns(slug);
  const [creating, setCreating] = useState(false);
  if (!state) return <div className="flex justify-center py-20"><RefreshCw className="h-8 w-8 animate-spin text-primary" /></div>;
  const { event, campaigns } = state;
  const title = event?.title || slug.toUpperCase();
  if (error) {
    return (
      <div className="space-y-3 max-w-3xl">
        <EventCrumb slug={slug} title={title} />
        <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {notInstalled(error) ? 'The invitation tables are not installed on this database yet.' : `The invitations could not be loaded: ${error}`}
        </p>
      </div>
    );
  }
  if (!event) return <div className="space-y-3"><EventCrumb slug={slug} title={title} /><p className="text-gray-500">No guest-list event "{slug}".</p></div>;
  const active = campaigns.filter(c => !c.archived_at);
  // One campaign for the event: open it directly, as SM26 opens its invitations.
  if (active.length === 1) {
    const c = active[0];
    return <CampaignPage key={c.id} campaignId={c.id} back={<EventCrumb slug={slug} title={title} />} listPath={`/admin/guest-list/${slug}/invitations`} onDeleted={load} />;
  }
  const start = async () => {
    const p = presetFor(slug);
    setCreating(true);
    try {
      await createCampaign(p.build(event.id));
      toast({ title: `Invitations of ${title} started`, description: p.key === 'blank' ? 'Fill the texts in Settings, then add the guests.' : "Prefilled with the kit's texts: check Settings, then add the guests." });
      await load();
    } catch (e) { toast({ title: 'Not created', description: (e as Error).message, variant: 'destructive' }); }
    finally { setCreating(false); }
  };
  return (
    <div className="space-y-5 max-w-5xl">
      <EventCrumb slug={slug} title={title} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Invitations, {title}</h1>
          <p className="text-sm text-gray-500 max-w-2xl">Personal invitations with a ticket and a letter in PDF: send them from the platform, or download them and send them yourself, then follow every reply. Each invitee joins the {title} guest list when the invitation goes out: same QR and door as the other guests.</p>
        </div>
        {active.length === 0 && (
          <Button onClick={start} disabled={creating}>{creating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}Start the invitations</Button>
        )}
      </div>
      {active.length === 0 && (
        <div className="rounded-lg border bg-white p-6 text-sm text-gray-600 space-y-1">
          <p>No invitations for {title} yet.</p>
          <p>{presetFor(slug).key === 'blank' ? 'They start blank: you write the ticket, letter and e-mail texts in Settings.' : "They start from the kit's texts (ticket, letter and e-mail), all editable."}</p>
        </div>
      )}
      {campaigns.length > 0 && (active.length > 1 || active.length === 0) && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {campaigns.map(c => (
            <li key={c.id}>
              <Link to={`/admin/guest-list/${slug}/invitations/${c.id}`} className="block rounded-lg border bg-white p-4 hover:border-[#5E9CC4] hover:shadow-sm transition">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-gray-900 break-words">{c.name}</div>
                  {c.archived_at && <span className="text-xs rounded bg-gray-100 px-2 py-0.5 text-gray-600">Archived</span>}
                </div>
                {c.rsvp_deadline && <div className="mt-1 text-sm text-gray-500 inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />RSVP {dateLabel(c.rsvp_deadline)}</div>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EventCampaignRoute() {
  const { slug = '', campaignId = '' } = useParams();
  const { state, error } = useEventCampaigns(slug);
  if (!state) return <div className="flex justify-center py-20"><RefreshCw className="h-8 w-8 animate-spin text-primary" /></div>;
  const title = state.event?.title || slug.toUpperCase();
  const c = state.campaigns.find(x => x.id === campaignId.toLowerCase());
  if (error || !c) {
    // Only this event's campaigns show under its name (a campaign of another event would look like one of WYS 2026's).
    return (
      <div className="space-y-3 max-w-3xl">
        <EventCrumb slug={slug} title={title} />
        <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {error ? `The invitations could not be loaded: ${error}`
            : <>This is not a campaign of {title} (or it was deleted). <Link to={`/admin/guest-list/${slug}/invitations`} className="underline">Back to the invitations of {title}</Link>.</>}
        </p>
      </div>
    );
  }
  return <CampaignPage key={campaignId} campaignId={campaignId} listPath={`/admin/guest-list/${slug}/invitations`}
    back={<EventCrumb slug={slug} title={title} campaign={{ id: c.id, name: c.name }} />} />;
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

type Tab = 'guests' | 'preview' | 'hand' | 'send' | 'tracking' | 'settings';
const TABS: { key: Tab; label: string }[] = [
  { key: 'guests', label: 'Guests' }, { key: 'preview', label: 'Preview' }, { key: 'hand', label: 'Send yourself' },
  { key: 'send', label: 'Send from the platform' }, { key: 'tracking', label: 'Tracking' }, { key: 'settings', label: 'Settings' },
];

/**
 * One campaign. back: the link above the header (the campaigns list, or the event's
 * breadcrumb); listPath: where to go once the campaign is deleted; onDeleted: then called
 * (listPath may be the page already open, which reloads its list).
 */
function CampaignPage({ campaignId, back, listPath, onDeleted }: { campaignId: string; back: ReactNode; listPath: string; onDeleted?: () => void }) {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find(t => t.key === params.get('tab'))?.key || 'guests') as Tab;
  const setTab = (t: Tab) => setParams(p => { const n = new URLSearchParams(p); n.set('tab', t); return n; }, { replace: true });

  const [campaign, setCampaign] = useState<InvitationCampaign | null>(null);
  const [missing, setMissing] = useState(false);
  const [events, setEvents] = useState<GlEventLite[]>([]);
  const [recipients, setRecipients] = useState<InvitationRecipient[]>([]);
  const [guests, setGuests] = useState<GlGuestLite[]>([]);
  const [log, setLog] = useState<EmailLogLite[]>([]);
  const [channels, setChannels] = useState<Map<string, string>>(new Map());
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
      const [lg, ch] = await Promise.all([
        emailLog(rs.map(r => r.gl_guest_id).filter(Boolean) as string[]),
        // How each invitation went out: shown in Tracking; the screens work without it.
        sendChannels(campaignId).catch(() => new Map<string, string>()),
      ]);
      setCampaign(c); setEvents(ev); setRecipients(rs); setGuests(gs); setLog(lg); setChannels(ch); setError(null);
      setSelectedId(s => (s && rs.some(r => r.id === s) ? s : rs[0]?.id || null));
      reloadDups();
    } catch (e) { setError((e as Error).message); }
  }, [campaignId, reloadDups]);
  useEffect(() => { reload(); }, [reload]);

  const event = events.find(e => e.id === campaign?.gl_event_id) || null;
  const rows = useMemo(() => (campaign ? buildRows(campaign, recipients, guests, dups, log, channels) : []), [campaign, recipients, guests, dups, log, channels]);

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

  if (missing) return <div className="space-y-3">{back}<p className="text-gray-500">This campaign does not exist (or was deleted).</p></div>;
  if (error && !campaign) return <div className="space-y-3">{back}<p role="alert" className="text-red-700">The campaign could not be loaded: {error}</p></div>;
  if (!campaign) return <div className="flex justify-center py-20"><RefreshCw className="h-8 w-8 animate-spin text-primary" /></div>;

  const s = campaign.settings || {};
  const selected = rows.find(g => g.r.id === selectedId) || null;
  const invitedAny = rows.some(g => g.r.gl_guest_id || !['draft', 'ready'].includes(g.r.status));

  return (
    <div className="space-y-4 max-w-[1400px]">
      {back}
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
      {tab === 'hand' && <HandTab campaign={campaign} rows={rows} event={event} guests={guests} reload={reload} onTracking={() => setTab('tracking')} />}
      {tab === 'send' && <SendTab campaign={campaign} rows={rows} event={event} selectedId={selectedId} reload={reload} />}
      {tab === 'tracking' && <TrackingTab campaign={campaign} rows={rows} event={event} guests={guests} reload={reload} />}
      {tab === 'settings' && (
        <SettingsTab campaign={campaign} events={events} hasGuests={rows.length > 0} invitedAny={invitedAny} onSaved={setCampaign} listPath={listPath} onDeleted={onDeleted} />
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
