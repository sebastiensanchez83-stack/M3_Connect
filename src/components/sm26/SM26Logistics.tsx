import { useState, useEffect, useCallback } from 'react';
import { Truck, Plus, Trash2, Loader2, AlertTriangle, CheckCircle2, Save } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { requireFreshSession } from '@/lib/session';
import { toast } from '@/hooks/use-toast';
import { SM26AssetUpload } from './SM26AssetUpload';

// What an exhibitor brings, and what the venue needs to know about it.
//
// Replaces the standalone Jotform. Three things it deliberately does NOT do:
//
// It does not ask for workshop preferences. The programme already books
// workshops with capacity and a waitlist, and a second place to express the
// same wish is a second answer to disagree with.
//
// It does not ask how many people are coming. That is on the registration, and
// once the attendee list is confirmed it comes from the named roster.
//
// It does not tell anyone to email M3 about large equipment. Oversized items
// are declared here and carry their own approval state, so the record of what
// was agreed is not somebody's inbox.

const BIG_CM = 200;
const BIG_KG = 50;

const KINDS: { key: string; label: string }[] = [
  { key: 'rollup', label: 'Roll-up or banner' },
  { key: 'model', label: 'Scale model or prototype' },
  { key: 'screen', label: 'Screen or monitor' },
  { key: 'furniture', label: 'Furniture' },
  { key: 'other', label: 'Something else' },
];

interface Logistics {
  registration_id: string; event_id: string;
  coming_on_site: boolean | null; stand_people: number | null;
  power_needed: boolean; power_details: string | null;
  internet_needed: boolean; water_needed: boolean;
  vehicle_access: boolean; vehicle_details: string | null;
  setup_preference: string | null; brunch_covers: number | null;
  notes: string | null; submitted_at: string | null;
}
interface Item {
  id: string; kind: string; label: string | null;
  width_cm: number | null; height_cm: number | null; depth_cm: number | null;
  weight_kg: number | null; photo_path: string | null;
  needs_approval: boolean; approval_status: string; approval_note: string | null;
}

const oversized = (i: Partial<Item>) =>
  Math.max(i.width_cm || 0, i.height_cm || 0, i.depth_cm || 0) > BIG_CM || (i.weight_kg || 0) > BIG_KG;

export function SM26Logistics({ registrationId, eventId }: { registrationId: string; eventId: string }) {
  const [log, setLog] = useState<Logistics | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: l }, { data: it }] = await Promise.all([
      supabase.from('sm_logistics').select('*').eq('registration_id', registrationId).maybeSingle(),
      supabase.from('sm_logistics_item').select('*').eq('registration_id', registrationId).order('created_at'),
    ]);
    setLog((l as Logistics | null) || {
      registration_id: registrationId, event_id: eventId,
      coming_on_site: null, stand_people: null,
      power_needed: false, power_details: null, internet_needed: false, water_needed: false,
      vehicle_access: false, vehicle_details: null, setup_preference: null,
      brunch_covers: null, notes: null, submitted_at: null,
    });
    setItems((it || []) as Item[]);
    setLoading(false);
  }, [registrationId, eventId]);
  useEffect(() => { load(); }, [load]);

  const set = (patch: Partial<Logistics>) => setLog(prev => (prev ? { ...prev, ...patch } : prev));

  const save = async () => {
    if (!log) return;
    const uid = await requireFreshSession();
    if (!uid) return;
    setSaving(true);
    const { error } = await supabase.from('sm_logistics').upsert({
      ...log, event_id: eventId, registration_id: registrationId,
      submitted_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }, { onConflict: 'registration_id' });
    setSaving(false);
    if (error) { toast({ title: 'Could not save', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Saved', description: 'M3 and the Yacht Club can see what you are bringing.' });
    load();
  };

  const addItem = async () => {
    const { data, error } = await supabase.from('sm_logistics_item')
      .insert({ registration_id: registrationId, event_id: eventId, kind: 'rollup' })
      .select('*').single();
    if (error) { toast({ title: 'Could not add', description: error.message, variant: 'destructive' }); return; }
    setItems(prev => [...prev, data as Item]);
  };
  const patchItem = async (id: string, patch: Partial<Item>) => {
    setItems(prev => prev.map(i => (i.id === id ? { ...i, ...patch } : i)));
    // The database re-flags oversized items on every write, so the returned row
    // is the truth about whether this one now needs approval.
    const { data, error } = await supabase.from('sm_logistics_item').update(patch).eq('id', id).select('*').single();
    if (error) { toast({ title: 'Could not save that item', description: error.message, variant: 'destructive' }); load(); return; }
    setItems(prev => prev.map(i => (i.id === id ? (data as Item) : i)));
  };
  const removeItem = async (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
    await supabase.from('sm_logistics_item').delete().eq('id', id);
  };

  if (loading || !log) return (
    <Card><CardContent className="py-10 text-center"><Loader2 className="h-6 w-6 animate-spin text-gray-300 mx-auto" /></CardContent></Card>
  );

  const flagged = items.filter(i => i.needs_approval);

  return (
    <Card>
      <CardContent className="pt-6 space-y-5">
        <div className="flex items-start gap-2.5">
          <Truck className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-gray-900">Coming on site</div>
            <p className="text-xs text-gray-500">
              Your exhibitor space comes with a high table and a chair. Tell us what you plan to bring
              so the Yacht Club can plan access, power and storage.
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          {[{ v: true, l: "Yes, we'll be on site" }, { v: false, l: 'No, we are not coming' }].map(o => (
            <Button key={String(o.v)} type="button" variant={log.coming_on_site === o.v ? 'default' : 'outline'}
              className="flex-1" onClick={() => set({ coming_on_site: o.v })}>{o.l}</Button>
          ))}
        </div>

        {log.coming_on_site && (
          <>
            {/* ── What you bring ── */}
            <div className="border-t border-gray-100 pt-4">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="text-sm font-semibold text-gray-900">What you're bringing</div>
                <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={addItem}>
                  <Plus className="h-3.5 w-3.5" /> Add an item
                </Button>
              </div>
              <p className="text-xs text-gray-500 mb-3">
                Measurements in centimetres. Anything over {BIG_CM} cm on any side, or heavier than {BIG_KG} kg,
                needs the Yacht Club's approval — we'll ask for you.
              </p>

              {items.length === 0 && <p className="text-sm text-gray-400">Nothing declared yet.</p>}

              <div className="space-y-3">
                {items.map(it => (
                  <div key={it.id} className={`rounded-lg border p-3 space-y-2.5 ${it.needs_approval ? 'border-amber-200 bg-amber-50/40' : 'border-gray-200'}`}>
                    <div className="flex items-center gap-2">
                      <select value={it.kind} onChange={e => patchItem(it.id, { kind: e.target.value })}
                        className="h-8 rounded-md border border-gray-200 text-sm px-2 bg-white">
                        {KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
                      </select>
                      <Input className="h-8 flex-1" placeholder="Describe it briefly"
                        defaultValue={it.label || ''} onBlur={e => patchItem(it.id, { label: e.target.value })} />
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-gray-400 hover:text-red-600"
                        aria-label="Remove" onClick={() => removeItem(it.id)}><Trash2 className="h-4 w-4" /></Button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {([['width_cm', 'Width cm'], ['height_cm', 'Height cm'], ['depth_cm', 'Depth cm']] as const).map(([k, lbl]) => (
                        <div key={k}>
                          <Label className="text-[11px] text-gray-500">{lbl}</Label>
                          <Input type="number" min={0} className="h-8" defaultValue={it[k] ?? ''}
                            onBlur={e => patchItem(it.id, { [k]: e.target.value === '' ? null : Number(e.target.value) } as Partial<Item>)} />
                        </div>
                      ))}
                      <div>
                        <Label className="text-[11px] text-gray-500">Weight kg</Label>
                        <Input type="number" min={0} className="h-8" defaultValue={it.weight_kg ?? ''}
                          onBlur={e => patchItem(it.id, { weight_kg: e.target.value === '' ? null : Number(e.target.value) })} />
                      </div>
                    </div>

                    {(it.needs_approval || oversized(it)) && (
                      <div className="flex items-start gap-2 text-xs">
                        {it.approval_status === 'approved' ? (
                          <><CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0 mt-0.5" />
                            <span className="text-green-700">Approved by the Yacht Club.</span></>
                        ) : it.approval_status === 'refused' ? (
                          <><AlertTriangle className="h-3.5 w-3.5 text-red-600 shrink-0 mt-0.5" />
                            <span className="text-red-700">Not possible on site. {it.approval_note}</span></>
                        ) : (
                          <><AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                            <span className="text-amber-800">
                              Large item — waiting on the Yacht Club's approval. A photo helps them decide.
                            </span></>
                        )}
                      </div>
                    )}

                    <div>
                      <Label className="text-[11px] text-gray-500">Photo{it.needs_approval ? ' (please add one)' : ' (optional)'}</Label>
                      <SM26AssetUpload
                        value={it.photo_path || ''}
                        basePath={`logistics/${registrationId}/${it.id}`}
                        accept="image/*"
                        maxFiles={1}
                        onChange={v => patchItem(it.id, { photo_path: Array.isArray(v) ? (v[0] ?? null) : (v || null) })}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Technical needs ── */}
            <div className="border-t border-gray-100 pt-4 space-y-2.5">
              <div className="text-sm font-semibold text-gray-900">On your stand</div>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <Checkbox checked={log.power_needed} onCheckedChange={c => set({ power_needed: !!c })} className="mt-0.5" />
                <span className="text-sm text-gray-700">I need electrical outlets</span>
              </label>
              {log.power_needed && (
                <Input placeholder="What will you plug in? (laptop, screen, lights…)"
                  defaultValue={log.power_details || ''} onBlur={e => set({ power_details: e.target.value })} />
              )}
              <label className="flex items-start gap-2.5 cursor-pointer">
                <Checkbox checked={log.internet_needed} onCheckedChange={c => set({ internet_needed: !!c })} className="mt-0.5" />
                <span className="text-sm text-gray-700">I need a wired internet connection</span>
              </label>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <Checkbox checked={log.water_needed} onCheckedChange={c => set({ water_needed: !!c })} className="mt-0.5" />
                <span className="text-sm text-gray-700">I need a water supply</span>
              </label>
            </div>

            {/* ── Access ── */}
            <div className="border-t border-gray-100 pt-4 space-y-2.5">
              <div className="text-sm font-semibold text-gray-900">Getting your material in</div>
              <p className="text-xs text-gray-500">
                Material is brought in and taken out during official event hours, and deliveries remain your responsibility.
              </p>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <Checkbox checked={log.vehicle_access} onCheckedChange={c => set({ vehicle_access: !!c })} className="mt-0.5" />
                <span className="text-sm text-gray-700">I need vehicle access to unload</span>
              </label>
              {log.vehicle_access && (
                <Input placeholder="Vehicle type and size, and when you expect to arrive"
                  defaultValue={log.vehicle_details || ''} onBlur={e => set({ vehicle_details: e.target.value })} />
              )}
            </div>

            {/* ── Brunch ── */}
            <div className="border-t border-gray-100 pt-4">
              <div className="text-sm font-semibold text-gray-900">Sunday brunch at the Yacht Club</div>
              <p className="text-xs text-gray-500 mb-2">
                35 € per person, champagne not included. Settled separately — we only need the headcount.
              </p>
              <div className="flex items-center gap-2">
                <Label className="text-sm text-gray-600">How many covers?</Label>
                <Input type="number" min={0} className="h-9 w-24" defaultValue={log.brunch_covers ?? ''}
                  onBlur={e => set({ brunch_covers: e.target.value === '' ? null : Number(e.target.value) })} />
              </div>
            </div>

            <div className="border-t border-gray-100 pt-4">
              <Label className="text-sm">Anything else we should know?</Label>
              <Textarea rows={2} className="mt-1" defaultValue={log.notes || ''} onBlur={e => set({ notes: e.target.value })} />
            </div>
          </>
        )}

        <div className="flex items-center gap-3 pt-1">
          <Button onClick={save} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
          </Button>
          {flagged.length > 0 && (
            <Badge className="bg-amber-50 text-amber-800 border-amber-200 text-[11px]">
              {flagged.length} item{flagged.length === 1 ? '' : 's'} awaiting approval
            </Badge>
          )}
          {log.submitted_at && (
            <span className="text-xs text-gray-400">
              Last saved {new Date(log.submitted_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
