import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { RefreshCw, Check, X, Send, Mail, QrCode, ExternalLink, Download, Search, Copy, Ban, Users } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { guestList, partsLabel, type GuestEventSettings, type GuestStatus } from '@/lib/guestList';

// Staff console of a guest-list event (/admin/guest-list/<slug>): review
// invitation requests, send invitations, follow answers, open requests.
// Anything that emails someone goes through the guest-list edge function;
// plain reads and settings are direct table access (RLS: moderators).

interface GlEvent { id: string; slug: string; title: string; capacity: number | null; notify_email: string | null; requests_open: boolean; settings: GuestEventSettings; legacy_event_id: string | null }
interface Guest {
  id: string; source: 'request' | 'invitation' | 'plus_one'; status: GuestStatus;
  first_name: string; last_name: string; email: string; phone: string | null; company: string | null; job_title: string | null;
  country: string | null; motivation: string | null; wants_conference: boolean; wants_gala: boolean; conference: boolean; gala: boolean;
  plus_one_of: string | null; token: string; admin_note: string | null; created_at: string; checked_in_at: string | null;
}

const STATUS_STYLE: Record<GuestStatus, string> = {
  requested: 'bg-amber-100 text-amber-800', invited: 'bg-blue-100 text-blue-800', confirmed: 'bg-green-100 text-green-800',
  declined: 'bg-gray-100 text-gray-600', rejected: 'bg-red-100 text-red-700', cancelled: 'bg-gray-100 text-gray-500',
};
const STATUS_LABEL: Record<GuestStatus, string> = {
  requested: 'Request pending', invited: 'Invited — awaiting answer', confirmed: 'Confirmed',
  declined: 'Declined', rejected: 'Request refused', cancelled: 'Cancelled',
};
const SOURCE_LABEL = { request: 'Request', invitation: 'Invited by us', plus_one: 'Plus-one' };

// Paste from Excel/Sheets: tab- or comma-separated, one person per line.
// Columns: first name, last name, email, company, job title. A header row is skipped.
function parsePaste(text: string) {
  return text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    .map(l => l.split(l.includes('\t') ? '\t' : ',').map(c => c.trim().replace(/^"|"$/g, '')))
    .filter(c => !/^first/i.test(c[0] || ''))
    .map(([first_name = '', last_name = '', email = '', company = '', job_title = '']) => ({ first_name, last_name, email, company, job_title }));
}

function csvEscape(v: unknown) { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }

export function AdminGuestList() {
  const { slug = '' } = useParams();
  const [ev, setEv] = useState<GlEvent | null>(null);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notifyReject, setNotifyReject] = useState(false);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<GuestStatus | 'all'>('all');

  const load = useCallback(async () => {
    const { data: e } = await supabase.from('gl_event').select('*').eq('slug', slug).maybeSingle();
    setEv(e as GlEvent | null);
    if (e) {
      const { data: g } = await supabase.from('gl_guest').select('*').eq('event_id', (e as GlEvent).id).order('created_at', { ascending: false });
      setGuests((g || []) as Guest[]);
    }
    setLoading(false);
  }, [slug]);
  useEffect(() => { load(); }, [load]);

  const byId = useMemo(() => new Map(guests.map(g => [g.id, g])), [guests]);
  const requests = guests.filter(g => g.status === 'requested');
  const stats = useMemo(() => {
    const c = guests.filter(g => g.status === 'confirmed');
    return {
      requested: requests.length,
      invited: guests.filter(g => g.status === 'invited').length,
      confirmed: c.length,
      conference: c.filter(g => g.conference).length,
      gala: c.filter(g => g.gala).length,
      checkedIn: c.filter(g => g.checked_in_at).length,
      held: guests.filter(g => g.status === 'confirmed' || g.status === 'invited').length,
    };
  }, [guests, requests.length]);

  // Runs a staff action; on a capacity refusal, asks and retries with force.
  const run = async (body: Record<string, unknown>) => {
    setBusy(true);
    let r = await guestList({ ...body, slug });
    if (r.error === 'capacity') {
      const ok = confirm(`This would bring the guest list to ${r.held + r.adding} for a capacity of ${r.capacity} (confirmed + awaiting answer). Go over capacity anyway?`);
      r = ok ? await guestList({ ...body, slug, force: true }) : { error: 'cancelled' };
    }
    setBusy(false);
    if (r.error && r.error !== 'cancelled') toast({ title: 'Not done', description: r.error, variant: 'destructive' });
    await load();
    return r;
  };

  const decide = async (ids: string[], decision: 'approve' | 'reject') => {
    if (!ids.length) return;
    if (decision === 'reject' && !confirm(`Refuse ${ids.length} request(s)?${notifyReject ? ' They will receive a polite decline email.' : ' No email will be sent.'}`)) return;
    const r = await run({ action: 'decide', guest_ids: ids, decision, notify: notifyReject });
    if (!r.error) {
      toast({ title: decision === 'approve' ? `${r.approved} approved — ${r.sent} pass(es) emailed${r.failed ? `, ${r.failed} email(s) failed` : ''}` : `${r.rejected} refused` });
      setSelected(new Set());
    }
  };

  const toggle = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const exportCsv = () => {
    const head = ['Status', 'Source', 'First name', 'Last name', 'Email', 'Phone', 'Company', 'Job title', 'Country', 'Conference', 'Gala', 'Plus-one of', 'Checked in', 'Why'];
    const rows = guests.map(g => {
      const host = g.plus_one_of ? byId.get(g.plus_one_of) : null;
      return [STATUS_LABEL[g.status], SOURCE_LABEL[g.source], g.first_name, g.last_name, g.email, g.phone, g.company, g.job_title, g.country,
        g.conference ? 'yes' : '', g.gala ? 'yes' : '', host ? `${host.first_name} ${host.last_name}` : '', g.checked_in_at || '', g.motivation];
    });
    const blob = new Blob(['﻿' + [head, ...rows].map(r => r.map(csvEscape).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${slug}-guest-list.csv`; a.click();
  };

  if (loading) return <div className="flex justify-center py-20"><RefreshCw className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!ev) return <p className="text-gray-500">No guest-list event “{slug}”.</p>;

  const publicUrl = `${window.location.origin}/${ev.slug}`;
  const filtered = guests.filter(g => g.status !== 'requested')
    .filter(g => statusFilter === 'all' || g.status === statusFilter)
    .filter(g => !q || `${g.first_name} ${g.last_name} ${g.email} ${g.company || ''}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{ev.title}</h1>
          <p className="text-sm text-gray-500">{ev.settings.date_label} · {ev.settings.venue}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild><a href={publicUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4 mr-1" /> Public page</a></Button>
          <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(publicUrl); toast({ title: 'Link copied', description: publicUrl }); }}><Copy className="h-4 w-4 mr-1" /> Copy link</Button>
          <Button variant="outline" size="sm" onClick={exportCsv}><Download className="h-4 w-4 mr-1" /> Export CSV</Button>
          <Button size="sm" asChild><Link to={`/admin/guest-list/${ev.slug}/checkin`}><QrCode className="h-4 w-4 mr-1" /> Check-in</Link></Button>
        </div>
      </div>

      <Card><CardContent className="pt-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Switch checked={ev.requests_open} onCheckedChange={async v => {
            const { error } = await supabase.from('gl_event').update({ requests_open: v }).eq('id', ev.id);
            if (error) toast({ title: 'Not saved', description: error.message, variant: 'destructive' }); else load();
          }} />
          <div>
            <div className="font-medium">{ev.requests_open ? 'Invitation requests are OPEN' : 'Invitation requests are closed'}</div>
            <div className="text-xs text-gray-500">{ev.requests_open ? 'Anyone with the link can ask to be invited.' : 'The public page shows “not open yet”. Invitations you send still work.'}</div>
          </div>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-7 gap-4 text-center">
          {[
            ['To review', stats.requested], ['Awaiting answer', stats.invited], ['Confirmed', stats.confirmed],
            ['Conference', stats.conference], ['Gala', stats.gala], ['Checked in', stats.checkedIn],
            ['Seats held', `${stats.held}${ev.capacity ? ` / ${ev.capacity}` : ''}`],
          ].map(([k, v]) => (
            <div key={k as string}><div className="text-xl font-bold">{v}</div><div className="text-[11px] text-gray-500 uppercase">{k}</div></div>
          ))}
        </div>
      </CardContent></Card>

      <Tabs defaultValue={requests.length ? 'requests' : 'guests'}>
        <TabsList>
          <TabsTrigger value="requests">Requests{requests.length ? ` (${requests.length})` : ''}</TabsTrigger>
          <TabsTrigger value="guests">Guest list</TabsTrigger>
          <TabsTrigger value="invite">Invite</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="requests" className="space-y-3">
          {requests.length === 0 ? <p className="text-gray-500 py-6">No request waiting.</p> : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm" disabled={busy || !selected.size} onClick={() => decide([...selected].filter(id => byId.get(id)?.status === 'requested'), 'approve')}>
                  <Check className="h-4 w-4 mr-1" /> Approve selected ({[...selected].filter(id => byId.get(id)?.status === 'requested').length})
                </Button>
                <Button size="sm" variant="outline" disabled={busy || !selected.size} onClick={() => decide([...selected].filter(id => byId.get(id)?.status === 'requested'), 'reject')}>
                  <X className="h-4 w-4 mr-1" /> Refuse selected
                </Button>
                <label className="flex items-center gap-2 text-sm text-gray-600"><Checkbox checked={notifyReject} onCheckedChange={v => setNotifyReject(v === true)} /> Email a polite decline when refusing</label>
              </div>
              <p className="text-xs text-gray-500">Approving confirms the guest for what they asked for (conference / gala — tick below to change) and emails their entry QR. Plus-ones get the same access as the guest who asked for them.</p>
              {requests.map(g => {
                const host = g.plus_one_of ? byId.get(g.plus_one_of) : null;
                return (
                  <Card key={g.id}><CardContent className="pt-4 pb-4 flex gap-4">
                    <Checkbox className="mt-1" checked={selected.has(g.id)} onCheckedChange={() => toggle(g.id)} />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-3">
                        <span className="font-semibold">{g.first_name} {g.last_name}</span>
                        <span className="text-sm text-gray-600">{[g.job_title, g.company].filter(Boolean).join(' · ')}</span>
                        {host && <span className="text-xs rounded bg-purple-100 text-purple-800 px-2 py-0.5">Plus-one of {host.first_name} {host.last_name}</span>}
                      </div>
                      <div className="text-sm text-gray-500">{g.email}{g.phone ? ` · ${g.phone}` : ''}{g.country ? ` · ${g.country}` : ''} · {new Date(g.created_at).toLocaleDateString()}</div>
                      {g.motivation && <p className="text-sm text-gray-700 mt-2 whitespace-pre-line">{g.motivation}</p>}
                      <div className="flex gap-4 mt-2 text-sm">
                        <label className="flex items-center gap-1.5"><Checkbox checked={g.wants_conference} onCheckedChange={async v => { await supabase.from('gl_guest').update({ wants_conference: v === true }).eq('id', g.id); load(); }} /> Conference</label>
                        <label className="flex items-center gap-1.5"><Checkbox checked={g.wants_gala} onCheckedChange={async v => { await supabase.from('gl_guest').update({ wants_gala: v === true }).eq('id', g.id); load(); }} /> Gala dinner</label>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Button size="sm" disabled={busy || (!g.wants_conference && !g.wants_gala)} onClick={() => decide([g.id], 'approve')}><Check className="h-4 w-4 mr-1" /> Approve</Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => decide([g.id], 'reject')}><X className="h-4 w-4 mr-1" /> Refuse</Button>
                    </div>
                  </CardContent></Card>
                );
              })}
            </>
          )}
        </TabsContent>

        <TabsContent value="guests" className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative"><Search className="h-4 w-4 absolute left-2.5 top-2.5 text-gray-400" /><Input className="pl-8 w-64" placeholder="Search name, email, company" value={q} onChange={e => setQ(e.target.value)} /></div>
            <select className="border rounded-md px-3 text-sm h-10 bg-white" value={statusFilter} onChange={e => setStatusFilter(e.target.value as GuestStatus | 'all')}>
              <option value="all">All statuses</option>
              {(['confirmed', 'invited', 'declined', 'rejected', 'cancelled'] as GuestStatus[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
          <div className="bg-white rounded-lg border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-500"><tr>
                <th className="p-3">Guest</th><th className="p-3">Status</th><th className="p-3">Access</th><th className="p-3">Source</th><th className="p-3 text-right">Actions</th>
              </tr></thead>
              <tbody>
                {filtered.map(g => {
                  const host = g.plus_one_of ? byId.get(g.plus_one_of) : null;
                  const active = g.status === 'confirmed' || g.status === 'invited';
                  return (
                    <tr key={g.id} className="border-t align-top">
                      <td className="p-3">
                        <div className="font-medium">{g.first_name} {g.last_name}{g.checked_in_at && <span className="ml-2 text-xs text-green-700">✓ in</span>}</div>
                        <div className="text-gray-500">{[g.job_title, g.company].filter(Boolean).join(' · ')}</div>
                        <div className="text-gray-400 text-xs">{g.email}</div>
                      </td>
                      <td className="p-3"><span className={`text-xs rounded px-2 py-0.5 ${STATUS_STYLE[g.status]}`}>{STATUS_LABEL[g.status]}</span></td>
                      <td className="p-3">
                        {active ? (
                          <div className="space-y-1">
                            <label className="flex items-center gap-1.5"><Checkbox checked={g.conference} onCheckedChange={v => run({ action: 'update', guest_id: g.id, conference: v === true })} /> Conference</label>
                            <label className="flex items-center gap-1.5"><Checkbox checked={g.gala} onCheckedChange={v => run({ action: 'update', guest_id: g.id, gala: v === true })} /> Gala</label>
                          </div>
                        ) : <span className="text-gray-400">{partsLabel(g)}</span>}
                      </td>
                      <td className="p-3 text-gray-600">{SOURCE_LABEL[g.source]}{host && <div className="text-xs text-gray-400">of {host.first_name} {host.last_name}</div>}</td>
                      <td className="p-3 text-right whitespace-nowrap">
                        {active && <Button size="sm" variant="ghost" disabled={busy} title={g.status === 'invited' ? 'Resend invitation' : 'Resend entry pass'}
                          onClick={async () => { const r = await run({ action: 'resend', guest_id: g.id }); if (r.ok) toast({ title: r.kind === 'pass' ? 'Entry pass re-sent' : 'Invitation re-sent' }); }}><Mail className="h-4 w-4" /></Button>}
                        <Button size="sm" variant="ghost" title="Copy personal link" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/${ev.slug}/guest?t=${g.token}`); toast({ title: 'Personal link copied' }); }}><Copy className="h-4 w-4" /></Button>
                        {active && <Button size="sm" variant="ghost" disabled={busy} title="Cancel this guest (no email is sent)"
                          onClick={() => { if (confirm(`Cancel ${g.first_name} ${g.last_name}? Their QR will no longer admit them. No email is sent.`)) run({ action: 'cancel', guest_id: g.id }); }}><Ban className="h-4 w-4 text-red-500" /></Button>}
                      </td>
                    </tr>
                  );
                })}
                {!filtered.length && <tr><td colSpan={5} className="p-6 text-center text-gray-400">Nobody here yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="invite"><InviteTab onRun={run} busy={busy} /></TabsContent>
        <TabsContent value="settings"><SettingsTab ev={ev} onSaved={load} /></TabsContent>
      </Tabs>
    </div>
  );
}

function InviteTab({ onRun, busy }: { onRun: (b: Record<string, unknown>) => Promise<any>; busy: boolean }) {
  const [one, setOne] = useState({ first_name: '', last_name: '', email: '', company: '', job_title: '' });
  const [paste, setPaste] = useState('');
  const [conference, setConference] = useState(true);
  const [gala, setGala] = useState(true);
  const [result, setResult] = useState<any>(null);
  const parsed = useMemo(() => parsePaste(paste), [paste]);

  const send = async (list: typeof parsed) => {
    if (!list.length) return;
    if (!conference && !gala) { toast({ title: 'Choose conference, gala or both', variant: 'destructive' }); return; }
    if (!confirm(`Send ${list.length} invitation email(s) now, for ${partsLabel({ conference, gala }).toLowerCase()}?`)) return;
    const r = await onRun({ action: 'invite', guests: list, conference, gala });
    if (!r.error) { setResult(r); setOne({ first_name: '', last_name: '', email: '', company: '', job_title: '' }); setPaste(''); }
  };

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <Card><CardContent className="pt-6 space-y-3">
        <div className="font-semibold flex items-center gap-2"><Send className="h-4 w-4" /> Invite one person</div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>First name *</Label><Input value={one.first_name} onChange={e => setOne({ ...one, first_name: e.target.value })} /></div>
          <div><Label>Last name *</Label><Input value={one.last_name} onChange={e => setOne({ ...one, last_name: e.target.value })} /></div>
        </div>
        <div><Label>Email *</Label><Input type="email" value={one.email} onChange={e => setOne({ ...one, email: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Company</Label><Input value={one.company} onChange={e => setOne({ ...one, company: e.target.value })} /></div>
          <div><Label>Job title</Label><Input value={one.job_title} onChange={e => setOne({ ...one, job_title: e.target.value })} /></div>
        </div>
        <Button disabled={busy || !one.first_name || !one.last_name || !one.email} onClick={() => send([one])}>Send invitation</Button>
      </CardContent></Card>

      <Card><CardContent className="pt-6 space-y-3">
        <div className="font-semibold flex items-center gap-2"><Users className="h-4 w-4" /> Invite a list</div>
        <p className="text-sm text-gray-500">Paste rows from Excel: <strong>first name, last name, email, company, job title</strong> (one person per line; a header row is ignored).</p>
        <Textarea rows={8} value={paste} onChange={e => setPaste(e.target.value)} placeholder={'Jane\tDoe\tjane@example.com\tAcme Yachts\tCEO'} className="font-mono text-xs" />
        {parsed.length > 0 && <p className="text-sm text-gray-600">{parsed.length} row(s) read. People already on the list are skipped, never emailed twice.</p>}
        <Button disabled={busy || !parsed.length} onClick={() => send(parsed)}>Send {parsed.length || ''} invitations</Button>
      </CardContent></Card>

      <Card className="lg:col-span-2"><CardContent className="pt-6 flex flex-wrap items-center gap-6">
        <span className="font-medium">These invitations are for:</span>
        <label className="flex items-center gap-2"><Checkbox checked={conference} onCheckedChange={v => setConference(v === true)} /> Conference</label>
        <label className="flex items-center gap-2"><Checkbox checked={gala} onCheckedChange={v => setGala(v === true)} /> Gala dinner</label>
        <span className="text-xs text-gray-500">Each invitee receives an email with Accept / Decline; accepting emails their entry QR.</span>
      </CardContent></Card>

      {result && (
        <Card className="lg:col-span-2"><CardContent className="pt-6 text-sm space-y-1">
          <div><strong>{result.sent}</strong> invitation(s) sent{result.failed ? `, ${result.failed} failed` : ''}.</div>
          {result.already_on_list?.length > 0 && <div className="text-gray-600">Already on the list (skipped): {result.already_on_list.join(', ')}</div>}
          {result.invalid?.length > 0 && <div className="text-red-600">Rows skipped (missing name/email or duplicate): {result.invalid.join(', ')}</div>}
        </CardContent></Card>
      )}
    </div>
  );
}

function SettingsTab({ ev, onSaved }: { ev: GlEvent; onSaved: () => void }) {
  const [capacity, setCapacity] = useState(ev.capacity?.toString() || '');
  const [notify, setNotify] = useState(ev.notify_email || '');
  const [s, setS] = useState<GuestEventSettings>(ev.settings);
  const [themes, setThemes] = useState((ev.settings.themes || []).join('\n'));
  const [saving, setSaving] = useState(false);
  const field = (k: keyof GuestEventSettings, label: string, long = false) => (
    <div><Label>{label}</Label>{long
      ? <Textarea rows={4} value={(s[k] as string) || ''} onChange={e => setS({ ...s, [k]: e.target.value })} />
      : <Input value={(s[k] as string) || ''} onChange={e => setS({ ...s, [k]: e.target.value })} />}</div>
  );
  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from('gl_event').update({
      capacity: capacity ? parseInt(capacity, 10) : null, notify_email: notify.trim() || null,
      settings: { ...s, themes: themes.split('\n').map(t => t.trim()).filter(Boolean) },
    }).eq('id', ev.id);
    setSaving(false);
    if (error) toast({ title: 'Not saved', description: error.message, variant: 'destructive' }); else { toast({ title: 'Saved' }); onSaved(); }
  };
  return (
    <Card><CardContent className="pt-6 grid md:grid-cols-2 gap-4">
      <div><Label>Capacity (people)</Label><Input type="number" value={capacity} onChange={e => setCapacity(e.target.value)} />
        <p className="text-xs text-gray-500 mt-1">Confirmed guests + invitations awaiting an answer count against it.</p></div>
      <div><Label>Email alerted for each new request</Label><Input value={notify} onChange={e => setNotify(e.target.value)} /></div>
      {field('tagline', 'Tagline')}
      {field('date_label', 'Date (as displayed)')}
      {field('venue', 'Venue')}
      {field('city', 'City')}
      {field('contact_email', 'Contact / reply-to email')}
      {field('programme_note', 'Programme note')}
      <div className="md:col-span-2">{field('intro', 'Introduction', true)}</div>
      <div className="md:col-span-2"><Label>Conference themes (one per line)</Label><Textarea rows={4} value={themes} onChange={e => setThemes(e.target.value)} /></div>
      <div className="md:col-span-2"><Button onClick={save} disabled={saving}>{saving && <RefreshCw className="h-4 w-4 animate-spin mr-2" />}Save</Button></div>
    </CardContent></Card>
  );
}
