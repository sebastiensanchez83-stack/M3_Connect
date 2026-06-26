import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, ArrowLeft, CalendarDays, Plus, Pencil, Trash2, Eye, EyeOff, Users, Paperclip, MessageSquare } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { SM26SessionQA } from '@/components/sm26/SM26SessionQA';

// Admin agenda management — CRUD over sm_session (single-track timeline +
// workshops). Times are stored at the Monaco (+02:00) offset for the event.

const TZ = 'Europe/Monaco';
const TYPES = ['talk', 'panel', 'pitch', 'roundtable', 'workshop', 'meal', 'ceremony'];
const fmtTime = (s: string | null) => s ? new Date(s).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '—';
const dayKey = (s: string | null) => s ? new Date(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ }) : 'TBD';
// derive the date / time (Monaco) parts from a stored timestamptz, for the form
const datePart = (s: string | null) => s ? new Date(s).toLocaleDateString('en-CA', { timeZone: TZ }) : '2026-09-20';
const timePart = (s: string | null) => s ? new Date(s).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ }) : '';

interface Session {
  id: string; title: string; description: string | null; type: string;
  starts_at: string | null; ends_at: string | null; room: string | null; speakers: string | null;
  capacity: number | null; presentation_enabled: boolean; share_with_audience: boolean;
  published: boolean; display_order: number; deck_path: string | null; qa_enabled: boolean;
}
type FormState = {
  title: string; type: string; date: string; start: string; end: string;
  room: string; speakers: string; description: string; capacity: string;
  published: boolean; presentation_enabled: boolean; share_with_audience: boolean; qa_enabled: boolean;
};
const EMPTY: FormState = {
  title: '', type: 'talk', date: '2026-09-20', start: '', end: '', room: '', speakers: '',
  description: '', capacity: '', published: true, presentation_enabled: false, share_with_audience: false, qa_enabled: false,
};

export function AdminSM26Agenda() {
  const navigate = useNavigate();
  const [eventId, setEventId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deckFile, setDeckFile] = useState<File | null>(null);
  const [existingDeck, setExistingDeck] = useState<string | null>(null);
  const [removeDeck, setRemoveDeck] = useState(false);
  const [qaSession, setQaSession] = useState<Session | null>(null);
  const [speakers, setSpeakers] = useState<string[]>([]);
  const [dayTab, setDayTab] = useState<string>('all');

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    const { data: ev } = await supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle();
    if (!ev) { setLoading(false); return; }
    const eid = (ev as { id: string }).id;
    setEventId(eid);
    const { data } = await supabase.from('sm_session').select('*').eq('event_id', eid)
      .order('starts_at', { ascending: true, nullsFirst: false }).order('display_order');
    const ss = (data || []) as Session[];
    setSessions(ss);
    const wsIds = ss.filter(s => s.type === 'workshop').map(s => s.id);
    if (wsIds.length) {
      const { data: bk } = await supabase.from('sm_workshop_booking').select('session_id,status').in('session_id', wsIds).eq('status', 'booked');
      const c: Record<string, number> = {};
      for (const b of (bk || []) as { session_id: string }[]) c[b.session_id] = (c[b.session_id] || 0) + 1;
      setCounts(c);
    }
    // Registered speakers — offered as quick-picks in the session form.
    const { data: spk } = await supabase.from('sm_role_assignment')
      .select('registration:sm_registration(first_name,last_name)')
      .eq('event_id', eid).eq('role', 'speaker').neq('status', 'declined');
    const names = ((spk || []) as { registration?: { first_name?: string; last_name?: string } }[])
      .map(r => `${r.registration?.first_name || ''} ${r.registration?.last_name || ''}`.trim()).filter(Boolean);
    setSpeakers([...new Set(names)]);
    setLoading(false);
  };

  const openNew = () => { setEditId(null); setForm(EMPTY); setDeckFile(null); setExistingDeck(null); setRemoveDeck(false); setOpen(true); };
  const openEdit = (s: Session) => {
    setEditId(s.id);
    setForm({
      title: s.title, type: s.type, date: datePart(s.starts_at), start: timePart(s.starts_at), end: timePart(s.ends_at),
      room: s.room || '', speakers: s.speakers || '', description: s.description || '', capacity: s.capacity?.toString() || '',
      published: s.published, presentation_enabled: s.presentation_enabled, share_with_audience: s.share_with_audience, qa_enabled: s.qa_enabled,
    });
    setDeckFile(null); setExistingDeck(s.deck_path); setRemoveDeck(false);
    setOpen(true);
  };

  const save = async () => {
    if (!eventId || !form.title.trim()) { toast({ title: 'Title is required', variant: 'destructive' }); return; }
    setSaving(true);
    const startsAt = form.date && form.start ? `${form.date}T${form.start}:00+02:00` : null;
    const endsAt = form.date && form.end ? `${form.date}T${form.end}:00+02:00` : null;
    const payload = {
      event_id: eventId, title: form.title.trim(), type: form.type,
      starts_at: startsAt, ends_at: endsAt,
      room: form.room.trim() || null, speakers: form.speakers.trim() || null,
      description: form.description.trim() || null,
      capacity: form.type === 'workshop' && form.capacity ? parseInt(form.capacity, 10) : null,
      published: form.published, presentation_enabled: form.presentation_enabled,
      share_with_audience: form.share_with_audience, qa_enabled: form.qa_enabled, updated_at: new Date().toISOString(),
    };
    let sessionId = editId;
    let saveErr;
    if (editId) {
      const { error } = await supabase.from('sm_session').update(payload).eq('id', editId);
      saveErr = error;
    } else {
      const { data, error } = await supabase.from('sm_session').insert(payload).select('id').single();
      saveErr = error;
      sessionId = (data as { id: string } | null)?.id ?? null;
    }
    if (saveErr || !sessionId) { setSaving(false); toast({ title: 'Could not save', description: saveErr?.message, variant: 'destructive' }); return; }
    // Slides: upload a new file (auto-enables the presentation), or clear the attached one.
    if (deckFile) {
      const safe = deckFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `session-decks/${sessionId}/${safe}`;
      const { error: upErr } = await supabase.storage.from('event-media').upload(path, deckFile, { upsert: true });
      if (upErr) { setSaving(false); toast({ title: 'Slides upload failed', description: upErr.message, variant: 'destructive' }); return; }
      await supabase.from('sm_session').update({ deck_path: path, presentation_enabled: true }).eq('id', sessionId);
    } else if (removeDeck && editId) {
      await supabase.from('sm_session').update({ deck_path: null }).eq('id', editId);
    }
    setSaving(false);
    setOpen(false);
    toast({ title: editId ? 'Session updated' : 'Session added' });
    load();
  };

  const togglePublish = async (s: Session) => {
    const { error } = await supabase.from('sm_session').update({ published: !s.published }).eq('id', s.id);
    if (error) { toast({ title: 'Failed', description: error.message, variant: 'destructive' }); return; }
    setSessions(prev => prev.map(x => x.id === s.id ? { ...x, published: !x.published } : x));
  };
  const remove = async (s: Session) => {
    if (!confirm(`Delete "${s.title}"?`)) return;
    const { error } = await supabase.from('sm_session').delete().eq('id', s.id);
    if (error) { toast({ title: 'Could not delete', description: error.message, variant: 'destructive' }); return; }
    setSessions(prev => prev.filter(x => x.id !== s.id));
    toast({ title: 'Session deleted' });
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  const days: { key: string; items: Session[] }[] = [];
  for (const s of sessions) {
    const k = dayKey(s.starts_at);
    let d = days.find(x => x.key === k);
    if (!d) { d = { key: k, items: [] }; days.push(d); }
    d.items.push(s);
  }
  const publishedCount = sessions.filter(s => s.published).length;
  const workshopCount = sessions.filter(s => s.type === 'workshop').length;

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate('/admin/sm26')} className="gap-1.5"><ArrowLeft className="h-4 w-4" /> Back to registrations</Button>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><CalendarDays className="h-6 w-6 text-primary" /> Programme</h1>
          <p className="text-sm text-gray-500 mt-0.5">{sessions.length} session{sessions.length !== 1 ? 's' : ''} · {publishedCount} published · {workshopCount} workshop{workshopCount !== 1 ? 's' : ''}</p>
        </div>
        <Button className="gap-1.5" onClick={openNew}><Plus className="h-4 w-4" /> New session</Button>
      </div>

      {sessions.length === 0 ? (
        <Card className="border-0 shadow-sm"><CardContent className="py-12 text-center">
          <CalendarDays className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-600 font-medium">No sessions yet</p>
          <p className="text-gray-400 text-sm mt-1 mb-4">Build the two-day programme — talks, panels, startup pitches, workshops and the awards ceremony.</p>
          <Button className="gap-1.5" onClick={openNew}><Plus className="h-4 w-4" /> Add the first session</Button>
        </CardContent></Card>
      ) : (
      <>
      {days.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setDayTab('all')} className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${dayTab === 'all' ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-200 hover:border-primary/40'}`}>All days</button>
          {days.map(d => (
            <button key={d.key} onClick={() => setDayTab(d.key)} className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${dayTab === d.key ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-200 hover:border-primary/40'}`}>{d.key} · {d.items.length}</button>
          ))}
        </div>
      )}

      {(dayTab === 'all' ? days : days.filter(d => d.key === dayTab)).map(day => (
        <div key={day.key}>
          <h2 className="text-sm font-semibold text-gray-700 mb-2">{day.key}</h2>
          <div className="space-y-2">
            {day.items.map(s => (
              <Card key={s.id} className={`border-0 shadow-sm ${!s.published ? 'border-l-4 border-l-amber-400' : ''}`}>
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="w-14 shrink-0 text-sm">
                    <div className="font-semibold text-gray-900">{fmtTime(s.starts_at)}</div>
                    <div className="text-xs text-gray-400">{fmtTime(s.ends_at)}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900">{s.title}</span>
                      <Badge variant="secondary" className="text-[10px] capitalize">{s.type}</Badge>
                      {!s.published && <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-[10px]">Draft</Badge>}
                      {s.type === 'workshop' && s.capacity != null && (
                        <span className="text-[11px] text-gray-500 inline-flex items-center gap-1"><Users className="h-3 w-3" /> {counts[s.id] || 0}/{s.capacity}</span>
                      )}
                      {s.deck_path && <span title={s.share_with_audience ? 'Slides attached & shared' : 'Slides attached (not shared)'} className={s.share_with_audience ? 'text-primary' : 'text-gray-300'}><Paperclip className="h-3 w-3" /></span>}
                    </div>
                    {s.room && <span className="text-xs text-gray-500">{s.room}</span>}
                  </div>
                  <button onClick={() => togglePublish(s)} title={s.published ? 'Unpublish' : 'Publish'} className="text-gray-400 hover:text-primary p-1.5">
                    {s.published ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </button>
                  {s.qa_enabled && <button onClick={() => setQaSession(s)} title="Moderate Q&amp;A" className="text-gray-400 hover:text-primary p-1.5"><MessageSquare className="h-4 w-4" /></button>}
                  <button onClick={() => openEdit(s)} className="text-gray-400 hover:text-primary p-1.5"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => remove(s)} className="text-gray-400 hover:text-red-600 p-1.5"><Trash2 className="h-4 w-4" /></button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}
      </>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editId ? 'Edit session' : 'New session'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Title *</Label><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Type</Label>
                <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TYPES.map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>Room</Label><Input value={form.room} onChange={e => setForm({ ...form, room: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1"><Label>Date</Label><Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
              <div className="space-y-1"><Label>Start</Label><Input type="time" value={form.start} onChange={e => setForm({ ...form, start: e.target.value })} /></div>
              <div className="space-y-1"><Label>End</Label><Input type="time" value={form.end} onChange={e => setForm({ ...form, end: e.target.value })} /></div>
            </div>
            <div className="space-y-1">
              <Label>Speakers</Label>
              <Input value={form.speakers} onChange={e => setForm({ ...form, speakers: e.target.value })} placeholder="Comma-separated names" />
              {speakers.length > 0 && (
                <Select value="" onValueChange={name => setForm(f => ({ ...f, speakers: f.speakers.trim() ? `${f.speakers.replace(/,\s*$/, '')}, ${name}` : name }))}>
                  <SelectTrigger className="h-8 text-xs text-gray-500"><SelectValue placeholder="+ Add a registered speaker" /></SelectTrigger>
                  <SelectContent>{speakers.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-1"><Label>Description</Label><Textarea rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
            {form.type === 'workshop' && (
              <div className="space-y-1 max-w-[10rem]"><Label>Capacity</Label><Input type="number" min={1} value={form.capacity} onChange={e => setForm({ ...form, capacity: e.target.value })} placeholder="10" /></div>
            )}
            <div className="flex flex-wrap gap-4 pt-1">
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.published} onCheckedChange={c => setForm({ ...form, published: c as boolean })} /> Published</label>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.presentation_enabled} onCheckedChange={c => setForm({ ...form, presentation_enabled: c as boolean })} /> Presentation</label>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.share_with_audience} onCheckedChange={c => setForm({ ...form, share_with_audience: c as boolean })} /> Share slides</label>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.qa_enabled} onCheckedChange={c => setForm({ ...form, qa_enabled: c as boolean })} /> Live Q&amp;A</label>
            </div>
            <div className="space-y-1.5 rounded-lg border border-gray-100 p-3">
              <Label className="text-xs text-gray-600 flex items-center gap-1.5"><Paperclip className="h-3.5 w-3.5" /> Slides / presentation file</Label>
              {existingDeck && !removeDeck && !deckFile && (
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-gray-600 truncate">{existingDeck.split('/').pop()}</span>
                  <button type="button" className="text-red-500 hover:underline shrink-0" onClick={() => setRemoveDeck(true)}>Remove</button>
                </div>
              )}
              {removeDeck && <div className="text-xs text-amber-600">Slides will be removed on save. <button type="button" className="underline" onClick={() => setRemoveDeck(false)}>Undo</button></div>}
              <Input type="file" accept=".pdf,.ppt,.pptx,image/*" className="text-xs" onChange={e => { setDeckFile(e.target.files?.[0] || null); setRemoveDeck(false); }} />
              {deckFile && <div className="text-xs text-gray-500">New: {deckFile.name}</div>}
              <p className="text-[11px] text-gray-400">Uploading enables the presentation. Tick “Share slides” to let attendees download it from the programme.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : (editId ? 'Save' : 'Add session')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!qaSession} onOpenChange={o => { if (!o) setQaSession(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><MessageSquare className="h-4 w-4 text-primary" /> Q&amp;A · {qaSession?.title}</DialogTitle></DialogHeader>
          {qaSession && <SM26SessionQA sessionId={qaSession.id} canModerate />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
