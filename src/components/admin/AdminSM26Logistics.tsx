import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Truck, Loader2, Download, Check, X, RotateCcw, ImageOff, AlertTriangle, ArrowLeft,
  RefreshCw, Search, Zap, Wifi, Droplet, Car, UtensilsCrossed, Users, ChevronDown, ChevronRight, FileText,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { SM26_ROLE_LABELS } from './AdminSM26';

// Everything the exhibitors declared they are bringing, in one place.
//
// Two audiences, one screen. M3 works here: who has answered, who has not, and
// the handful of oversized items that need a yes or a no. The Yacht Club never
// sees it — the department that runs the room has no account, works in French,
// and receives a PDF. So the download is the second half of this page, not an
// afterthought, and it is written in French by logisticsDossierFr.

interface Item {
  id: string; kind: string; label: string | null;
  width_cm: number | null; height_cm: number | null; depth_cm: number | null;
  weight_kg: number | null; photo_path: string | null;
  needs_approval: boolean; approval_status: string; approval_note: string | null;
}
interface Row {
  registration_id: string; company: string; contact: string | null; email: string | null;
  country: string | null; status: string; roles: string[]; num_attendees: number;
  filled: boolean; coming_on_site: boolean | null;
  power_needed: boolean; power_details: string | null;
  internet_needed: boolean; water_needed: boolean;
  vehicle_access: boolean; vehicle_details: string | null;
  brunch_covers: number; notes: string | null; submitted_at: string | null;
  items: Item[];
}

const KIND_LABELS: Record<string, string> = {
  rollup: 'Roll-up or banner', model: 'Scale model or prototype',
  screen: 'Screen or monitor', furniture: 'Furniture', other: 'Something else',
};

const FILTERS = [
  { key: 'all', label: 'Everyone' },
  { key: 'silent', label: 'No answer yet' },
  { key: 'onsite', label: 'Coming on site' },
  { key: 'away', label: 'Not coming' },
  { key: 'validate', label: 'Needs a decision' },
] as const;
type FilterKey = typeof FILTERS[number]['key'];

// An item only needs a ruling if its owner is actually turning up. Someone who
// has said "not coming" keeps their crate on the record but off the venue's desk.
const awaitingDecision = (r: Row) =>
  r.coming_on_site !== false && r.items.some(i => i.needs_approval && i.approval_status === 'pending');

const dims = (i: Item) => {
  const d = [i.width_cm, i.height_cm, i.depth_cm].filter(v => v != null);
  const parts = [d.length ? `${d.join(' × ')} cm` : null, i.weight_kg != null ? `${i.weight_kg} kg` : null];
  return parts.filter(Boolean).join(' · ') || 'no dimensions given';
};

function Stat({ icon: Icon, label, value, sub }: { icon: typeof Users; label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-gray-400 uppercase tracking-wide"><Icon className="h-3.5 w-3.5" /> {label}</div>
        <div className="text-2xl font-bold text-gray-900 mt-1">{value}</div>
        {sub && <div className="text-xs text-gray-500 mt-1.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

const Need = ({ on, icon: Icon, label }: { on: boolean; icon: typeof Zap; label: string }) => (
  <span title={label}
    className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] ${
      on ? 'border-primary/25 bg-primary/5 text-primary' : 'border-gray-100 text-gray-300'}`}>
    <Icon className="h-3 w-3" />
  </span>
);

export function AdminSM26Logistics() {
  const navigate = useNavigate();
  const [eventId, setEventId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [building, setBuilding] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    const { data: ev } = await supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle();
    if (!ev) { setLoading(false); return; }
    const eid = (ev as { id: string }).id;
    setEventId(eid);

    const { data, error } = await supabase.rpc('sm_logistics_overview', { p_event_id: eid });
    if (error) { toast({ title: 'Could not load logistics', description: error.message, variant: 'destructive' }); setLoading(false); return; }
    const list = ((data || []) as Row[]);
    setRows(list);
    setNotes(Object.fromEntries(list.flatMap(r => r.items.map(i => [i.id, i.approval_note || '']))));
    setLoading(false);

    // Staff can read the whole event-media bucket, so a path we already hold
    // signs directly — no resolver round-trip for a thumbnail.
    const paths = list.flatMap(r => r.items.map(i => i.photo_path)).filter(Boolean) as string[];
    if (paths.length) {
      const { data: signed } = await supabase.storage.from('event-media').createSignedUrls(paths, 3600);
      const map: Record<string, string> = {};
      (signed || []).forEach(s => { if (s.signedUrl && s.path) map[s.path] = s.signedUrl; });
      setPhotos(map);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const decide = async (item: Item, status: 'approved' | 'refused' | 'pending') => {
    if (status === 'refused' && !(notes[item.id] || '').trim()) {
      toast({ title: 'Say why', description: 'A refusal is shown to the exhibitor — give them the reason so they can adapt.', variant: 'destructive' });
      return;
    }
    setBusy(item.id);
    const { error } = await supabase.rpc('sm_logistics_decide', {
      p_item_id: item.id, p_status: status, p_note: notes[item.id] || null,
    });
    setBusy(null);
    if (error) { toast({ title: 'Could not save the decision', description: error.message, variant: 'destructive' }); return; }
    setRows(prev => prev.map(r => ({
      ...r,
      items: r.items.map(i => (i.id === item.id
        ? { ...i, approval_status: status, approval_note: notes[item.id] || null } : i)),
    })));
  };

  // The document for the Yacht Club. French, because the people who read it
  // work in French and this PDF is the entire interface they get.
  const downloadDossier = async () => {
    if (!eventId) return;
    setBuilding(true);
    try {
      const { data, error } = await supabase.rpc('sm_logistics_dossier', { p_event_id: eventId });
      if (error) throw error;

      const { dossierBlocks, DOSSIER_META, dossierFilename } = await import('@/lib/logisticsDossierFr');
      const { downloadFeedbackReportPdf } = await import('@/lib/feedbackReportPdf');
      const { toDataUrl } = await import('@/lib/programmePdf');
      const { BUNDLED_ASSETS } = await import('@/lib/invitationTemplates');
      const [banner, footer] = await Promise.all([
        toDataUrl(BUNDLED_ASSETS.banner),
        toDataUrl(BUNDLED_ASSETS.footer),
      ]);

      await downloadFeedbackReportPdf(
        dossierBlocks(data as Parameters<typeof dossierBlocks>[0]),
        DOSSIER_META, { banner, footer }, dossierFilename(new Date()),
      );
    } catch (e) {
      toast({ title: 'Could not build the dossier', description: (e as Error).message, variant: 'destructive' });
    }
    setBuilding(false);
  };

  const exportCsv = () => {
    const header = ['Company', 'Contact', 'Email', 'Country', 'Roles', 'Answered', 'Coming on site',
      'People', 'Power', 'Power details', 'Internet', 'Water', 'Vehicle', 'Vehicle details',
      'Brunch covers', 'Items', 'Awaiting decision', 'Notes', 'Last saved'];
    const yn = (v: boolean | null) => (v === null ? '' : v ? 'yes' : 'no');
    const body = rows.map(r => [
      r.company, r.contact || '', r.email || '', r.country || '',
      r.roles.map(x => SM26_ROLE_LABELS[x] || x).join(' / '),
      r.filled ? 'yes' : 'no', yn(r.coming_on_site), String(r.num_attendees),
      yn(r.power_needed), r.power_details || '', yn(r.internet_needed), yn(r.water_needed),
      yn(r.vehicle_access), r.vehicle_details || '', String(r.brunch_covers),
      String(r.items.length), String(r.items.filter(i => i.needs_approval && i.approval_status === 'pending').length),
      r.notes || '', r.submitted_at ? new Date(r.submitted_at).toISOString().slice(0, 10) : '',
    ]);
    const esc = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const csv = [header, ...body].map(r => r.map(esc).join(',')).join('\r\n');
    // A BOM, so Excel opens accented names as written rather than as mojibake.
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'sm26-logistics.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  // Every figure here also appears in the PDF the Yacht Club budgets against, so
  // both must count the same people. Anyone who has said they are NOT coming is
  // excluded — including their stand, their covers and their crates.
  const counts = useMemo(() => {
    const onSite = rows.filter(r => r.coming_on_site);
    const notAway = rows.filter(r => r.coming_on_site !== false);
    return {
      answered: rows.filter(r => r.filled).length,
      onsite: onSite.length,
      people: onSite.reduce((a, r) => a + r.num_attendees, 0),
      power: onSite.filter(r => r.power_needed).length,
      brunch: onSite.reduce((a, r) => a + r.brunch_covers, 0),
      pending: notAway.reduce((a, r) => a + r.items.filter(i => i.needs_approval && i.approval_status === 'pending').length, 0),
    };
  }, [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(r => {
      if (needle && !`${r.company} ${r.contact || ''} ${r.email || ''}`.toLowerCase().includes(needle)) return false;
      if (filter === 'silent') return !r.filled;
      if (filter === 'onsite') return r.coming_on_site === true;
      if (filter === 'away') return r.coming_on_site === false;
      if (filter === 'validate') return awaitingDecision(r);
      return true;
    });
  }, [rows, q, filter]);

  const toggle = (id: string) => setOpen(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const filterCount = (key: FilterKey) => {
    if (key === 'all') return rows.length;
    if (key === 'silent') return rows.length - counts.answered;
    if (key === 'onsite') return counts.onsite;
    if (key === 'away') return rows.filter(r => r.coming_on_site === false).length;
    return rows.filter(awaitingDecision).length;
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate('/admin/sm26')} className="gap-1.5"><ArrowLeft className="h-4 w-4" /> Back to registrations</Button>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Truck className="h-6 w-6 text-primary" /> Logistics</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={exportCsv} disabled={!rows.length}>
            <FileText className="h-4 w-4" /> CSV
          </Button>
          <Button size="sm" className="gap-1.5" onClick={downloadDossier} disabled={building || !eventId}>
            {building ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Dossier for the Yacht Club (FR)
          </Button>
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={load} title="Refresh"><RefreshCw className="h-4 w-4" /></Button>
        </div>
      </div>
      <p className="text-xs text-gray-500 -mt-1">
        What sponsors, innovations, marinas and architects have declared they are bringing. The dossier is one French PDF
        for the Yacht Club — download it and send it on; the department that runs the room has no account here.
      </p>

      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat icon={Truck} label="Answered" value={`${counts.answered}/${rows.length}`}
          sub={rows.length - counts.answered > 0 ? `${rows.length - counts.answered} still silent` : 'everyone has answered'} />
        <Stat icon={Users} label="Coming on site" value={counts.onsite} sub={`${counts.people} people on stands`} />
        <Stat icon={Zap} label="Stands needing power" value={counts.power} />
        <Stat icon={UtensilsCrossed} label="Brunch covers" value={counts.brunch} sub="35 € each, settled separately" />
        <Stat icon={AlertTriangle} label="Awaiting a decision" value={counts.pending}
          sub={counts.pending ? 'oversized or heavy' : 'nothing over 2 m or 50 kg'} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              filter === f.key ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>
            {f.label} <span className="tabular-nums opacity-70">{filterCount(f.key)}</span>
          </button>
        ))}
        <div className="relative ml-auto">
          <Search className="h-3.5 w-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search a company"
            className="h-8 w-56 pl-8 text-xs" />
        </div>
      </div>

      {shown.length === 0 ? (
        <Card className="border-0 shadow-sm"><CardContent className="p-8 text-center text-sm text-gray-400">
          Nothing matches that filter.
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {shown.map(r => {
            const isOpen = open.has(r.registration_id);
            const toValidate = awaitingDecision(r)
              ? r.items.filter(i => i.needs_approval && i.approval_status === 'pending').length : 0;
            return (
              <Card key={r.registration_id} className="border-0 shadow-sm overflow-hidden">
                <button onClick={() => toggle(r.registration_id)}
                  className="w-full text-left p-3 flex items-center gap-3 hover:bg-gray-50/70 transition-colors">
                  {isOpen ? <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" /> : <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-gray-900 truncate">{r.company}</div>
                    <div className="text-[11px] text-gray-500 truncate">
                      {r.roles.map(x => SM26_ROLE_LABELS[x] || x).join(' · ') || '—'}
                      {r.contact ? ` — ${r.contact}` : ''}
                    </div>
                  </div>
                  {!r.filled ? (
                    <span className="text-[10px] px-2 py-0.5 rounded-full border border-gray-200 text-gray-400 shrink-0">No answer</span>
                  ) : r.coming_on_site === false ? (
                    <span className="text-[10px] px-2 py-0.5 rounded-full border border-gray-200 text-gray-500 shrink-0">Not coming</span>
                  ) : (
                    <div className="hidden sm:flex items-center gap-1 shrink-0">
                      <Need on={r.power_needed} icon={Zap} label="Electrical outlets" />
                      <Need on={r.internet_needed} icon={Wifi} label="Wired internet" />
                      <Need on={r.water_needed} icon={Droplet} label="Water supply" />
                      <Need on={r.vehicle_access} icon={Car} label="Vehicle access" />
                    </div>
                  )}
                  {toValidate > 0 && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-800 shrink-0">
                      {toValidate} to validate
                    </span>
                  )}
                </button>

                {isOpen && (
                  <CardContent className="p-4 pt-0 border-t border-gray-100 space-y-3">
                    {!r.filled ? (
                      <p className="text-sm text-gray-400 pt-3">
                        This exhibitor has not opened the logistics form yet. It appears on their event hub under “Your participation”.
                        {r.email && <> Chase them at <span className="text-gray-600">{r.email}</span>.</>}
                      </p>
                    ) : (
                      <>
                        <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs pt-3">
                          <div className="flex gap-2"><dt className="text-gray-400 w-32 shrink-0">Coming on site</dt><dd className="text-gray-800">{r.coming_on_site ? 'Yes' : 'No'}</dd></div>
                          <div className="flex gap-2"><dt className="text-gray-400 w-32 shrink-0">People</dt><dd className="text-gray-800">{r.num_attendees}</dd></div>
                          <div className="flex gap-2"><dt className="text-gray-400 w-32 shrink-0">Electrical outlets</dt><dd className="text-gray-800">{r.power_needed ? (r.power_details || 'Yes') : 'No'}</dd></div>
                          <div className="flex gap-2"><dt className="text-gray-400 w-32 shrink-0">Wired internet</dt><dd className="text-gray-800">{r.internet_needed ? 'Yes' : 'No'}</dd></div>
                          <div className="flex gap-2"><dt className="text-gray-400 w-32 shrink-0">Water supply</dt><dd className="text-gray-800">{r.water_needed ? 'Yes' : 'No'}</dd></div>
                          <div className="flex gap-2"><dt className="text-gray-400 w-32 shrink-0">Vehicle access</dt><dd className="text-gray-800">{r.vehicle_access ? (r.vehicle_details || 'Yes') : 'No'}</dd></div>
                          <div className="flex gap-2"><dt className="text-gray-400 w-32 shrink-0">Brunch covers</dt><dd className="text-gray-800">{r.brunch_covers || '—'}</dd></div>
                          <div className="flex gap-2"><dt className="text-gray-400 w-32 shrink-0">Last saved</dt><dd className="text-gray-800">{r.submitted_at ? new Date(r.submitted_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</dd></div>
                          {r.notes && <div className="flex gap-2 sm:col-span-2"><dt className="text-gray-400 w-32 shrink-0">Notes</dt><dd className="text-gray-800">{r.notes}</dd></div>}
                        </dl>

                        {r.items.length === 0 ? (
                          <p className="text-xs text-gray-400">Nothing declared to bring.</p>
                        ) : (
                          <div className="space-y-2">
                            <div className="text-xs font-semibold text-gray-600">Bringing ({r.items.length})</div>
                            {r.items.map(it => (
                              <div key={it.id} className={`rounded-lg border p-3 flex gap-3 ${
                                it.needs_approval && it.approval_status === 'pending' ? 'border-amber-200 bg-amber-50/40' : 'border-gray-200'}`}>
                                {it.photo_path && photos[it.photo_path] ? (
                                  <a href={photos[it.photo_path]} target="_blank" rel="noreferrer" className="shrink-0">
                                    <img src={photos[it.photo_path]} alt={it.label || it.kind}
                                      className="h-20 w-20 rounded object-cover border border-gray-200" />
                                  </a>
                                ) : (
                                  <div className="h-20 w-20 rounded border border-dashed border-gray-200 flex flex-col items-center justify-center gap-1 text-gray-300 shrink-0">
                                    <ImageOff className="h-4 w-4" /><span className="text-[10px]">no photo</span>
                                  </div>
                                )}
                                <div className="min-w-0 flex-1 space-y-1.5">
                                  <div className="text-sm text-gray-900">
                                    {(it.label || '').trim() || KIND_LABELS[it.kind] || it.kind}
                                    <span className="text-gray-400 text-xs"> — {dims(it)}</span>
                                  </div>
                                  {!it.needs_approval ? (
                                    <div className="text-xs text-gray-400">Within the standard gauge.</div>
                                  ) : it.approval_status === 'approved' ? (
                                    <div className="text-xs text-green-700 flex items-center gap-1"><Check className="h-3.5 w-3.5" /> Approved{it.approval_note ? ` — ${it.approval_note}` : ''}</div>
                                  ) : it.approval_status === 'refused' ? (
                                    <div className="text-xs text-red-700 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> Refused — {it.approval_note}</div>
                                  ) : (
                                    <div className="text-xs text-amber-800 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> Over the gauge — waiting on a decision</div>
                                  )}

                                  {it.needs_approval && (
                                    <>
                                      <Input className="h-8 text-xs"
                                        placeholder={it.approval_status === 'pending' ? 'Condition, or the reason for a refusal (shown to them)' : 'Change the note'}
                                        value={notes[it.id] ?? ''}
                                        onChange={e => setNotes(p => ({ ...p, [it.id]: e.target.value }))} />
                                      <div className="flex flex-wrap gap-1.5">
                                        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={busy === it.id}
                                          onClick={() => decide(it, 'approved')}>
                                          {busy === it.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Approve
                                        </Button>
                                        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs text-red-700" disabled={busy === it.id}
                                          onClick={() => decide(it, 'refused')}>
                                          <X className="h-3.5 w-3.5" /> Refuse
                                        </Button>
                                        {it.approval_status !== 'pending' && (
                                          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-gray-500" disabled={busy === it.id}
                                            onClick={() => decide(it, 'pending')}>
                                            <RotateCcw className="h-3.5 w-3.5" /> Undo
                                          </Button>
                                        )}
                                      </div>
                                    </>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
