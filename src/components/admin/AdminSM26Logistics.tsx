import { useState, useEffect, useCallback } from 'react';
import { Truck, Loader2, Download, Check, X, RotateCcw, ImageOff, AlertTriangle } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';

// What the exhibitors bring, in the two shapes it is needed in:
//
//  - the exception list, on screen, because a handful of oversized items need a
//    yes or a no from M3 and the participant is already being shown that verdict;
//  - the dossier, as one PDF, because the Yacht Club department that receives it
//    has no account here. Victor downloads it and sends it on.
//
// Deliberately one card: the decisions are what the first page of the dossier
// reports, so taking them and producing the document belong side by side.

interface PendingItem {
  item_id: string; registration_id: string; company: string; contact: string | null;
  kind: string; label: string;
  width_cm: number | null; height_cm: number | null; depth_cm: number | null;
  weight_kg: number | null;
  photo_path: string | null; approval_status: string; approval_note: string | null;
}

interface DossierRow {
  part: string; company: string; line: string;
  detail: string | null; flag: string | null; sort_order: number;
}

const dims = (i: PendingItem) => {
  const d = [i.width_cm, i.height_cm, i.depth_cm].filter(v => v != null);
  const size = d.length ? `${d.join(' × ')} cm` : null;
  const w = i.weight_kg != null ? `${i.weight_kg} kg` : null;
  return [size, w].filter(Boolean).join(' · ') || 'no dimensions given';
};

export function AdminSM26Logistics({ eventId }: { eventId: string }) {
  const [items, setItems] = useState<PendingItem[]>([]);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [building, setBuilding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('sm_logistics_pending', { p_event_id: eventId });
    if (error) { toast({ title: 'Could not load the logistics list', description: error.message, variant: 'destructive' }); setLoading(false); return; }
    const list = (data || []) as PendingItem[];
    setItems(list);
    setNotes(Object.fromEntries(list.map(i => [i.item_id, i.approval_note || ''])));
    setLoading(false);

    // Staff can read the whole event-media bucket, so the photo signs directly —
    // no resolver needed for a path we already hold.
    const paths = list.map(i => i.photo_path).filter(Boolean) as string[];
    if (paths.length) {
      const { data: signed } = await supabase.storage.from('event-media').createSignedUrls(paths, 3600);
      const map: Record<string, string> = {};
      (signed || []).forEach(s => { if (s.signedUrl && s.path) map[s.path] = s.signedUrl; });
      setPhotos(map);
    }
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  const decide = async (item: PendingItem, status: 'approved' | 'refused' | 'pending') => {
    if (status === 'refused' && !(notes[item.item_id] || '').trim()) {
      toast({ title: 'Say why', description: 'A refusal is shown to the exhibitor — give them the reason so they can adapt.', variant: 'destructive' });
      return;
    }
    setBusy(item.item_id);
    const { error } = await supabase.rpc('sm_logistics_decide', {
      p_item_id: item.item_id, p_status: status, p_note: notes[item.item_id] || null,
    });
    setBusy(null);
    if (error) { toast({ title: 'Could not save the decision', description: error.message, variant: 'destructive' }); return; }
    setItems(prev => prev.map(i => i.item_id === item.item_id
      ? { ...i, approval_status: status, approval_note: notes[item.item_id] || null } : i));
  };

  // One document, in reading order: what needs deciding, what the room must
  // provide, who is coming with what, and the totals to budget against.
  const downloadDossier = async () => {
    setBuilding(true);
    try {
      const { data, error } = await supabase.rpc('sm_logistics_dossier', { p_event_id: eventId });
      if (error) throw error;
      const rows = (data || []) as DossierRow[];

      const { downloadFeedbackReportPdf } = await import('@/lib/feedbackReportPdf');
      const { toDataUrl } = await import('@/lib/programmePdf');
      const { BUNDLED_ASSETS } = await import('@/lib/invitationTemplates');
      const [banner, footer] = await Promise.all([
        toDataUrl(BUNDLED_ASSETS.banner),
        toDataUrl(BUNDLED_ASSETS.footer),
      ]);

      const of = (part: string) => rows.filter(r => r.part === part);
      const blocks: import('@/lib/feedbackReportPdf').ReportBlock[] = [];

      const totals = of('total');
      if (totals.length) {
        blocks.push({
          kind: 'stats', heading: 'At a glance',
          items: totals.map(t => ({ label: t.line, value: t.flag || '0' })),
        });
      }

      const decisions = of('decision');
      blocks.push(decisions.length ? {
        kind: 'table', heading: 'Needs a decision',
        note: 'Items larger than 2 m on a side or heavier than 50 kg. Nothing below is confirmed to the exhibitor until the Yacht Club has answered.',
        columns: ['Exhibitor', 'Item', 'Size and weight'],
        rows: decisions.map(d => [d.company, d.line, d.detail || '—'] as [string, string, string]),
      } : {
        kind: 'stats', heading: 'Needs a decision',
        note: 'Nothing oversized has been declared so far.',
        items: [{ label: 'Items awaiting a decision', value: '0' }],
      });

      // Grouped by need rather than by company: the venue orders sockets and
      // drops cables per need, and reads down one column to count them.
      const technical = of('technical');
      if (technical.length) {
        const byNeed = new Map<string, DossierRow[]>();
        technical.forEach(t => byNeed.set(t.line, [...(byNeed.get(t.line) || []), t]));
        blocks.push({
          kind: 'table', heading: 'What the room has to provide',
          note: 'One line per exhibitor who asked for it, grouped by need.',
          columns: ['Need', 'Exhibitor', 'What for'],
          rows: [...byNeed.entries()].flatMap(([need, list]) =>
            list.map((t, n) => [n === 0 ? `${need} (${list.length})` : '', t.company, t.detail || '—'] as [string, string, string])),
        });
      }

      const exhibitors = of('exhibitor');
      if (exhibitors.length) {
        blocks.push({
          kind: 'table', heading: 'Who is coming, and with what',
          columns: ['Exhibitor', 'On the stand', 'Notes'],
          rows: exhibitors.map(e => [e.company, e.line, e.detail || '—'] as [string, string, string]),
        });
      }

      blocks.push({
        kind: 'placeholder', heading: 'Yacht Club use',
        note: 'Stand numbers, delivery slots and anything agreed by phone.', lines: 6,
      });

      await downloadFeedbackReportPdf(blocks, {
        title: 'Smart & Sustainable Marina Rendezvous 2026',
        subtitle: '20–21 September 2026 · Yacht Club de Monaco · Logistics dossier',
        note: 'Declared by the exhibitors themselves on the platform. Anything marked as needing a decision is not yet confirmed to them.',
      }, { banner, footer }, 'sm26-logistics-dossier.pdf');
    } catch (e) {
      toast({ title: 'Could not build the dossier', description: (e as Error).message, variant: 'destructive' });
    }
    setBuilding(false);
  };

  const undecided = items.filter(i => i.approval_status === 'pending');

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-4 space-y-3">
        <div className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Truck className="h-4 w-4 text-gray-400" /> Logistics
        </div>
        <p className="text-xs text-gray-500">
          What sponsors, innovations, marinas and architects have declared they are bringing.
          The dossier is one PDF for the Yacht Club — download it and send it on; they have no account here.
        </p>

        <Button size="sm" variant="outline" className="gap-1.5" onClick={downloadDossier} disabled={building}>
          {building ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download the logistics dossier
        </Button>

        <div className="border-t border-gray-100 pt-3 space-y-2">
          <div className="text-xs font-semibold text-gray-600">
            Oversized items {undecided.length > 0 && <span className="text-amber-700">· {undecided.length} awaiting a decision</span>}
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-400 py-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : items.length === 0 ? (
            <p className="text-xs text-gray-400">Nothing over 2 m or 50 kg has been declared. Items appear here on their own as exhibitors fill the form.</p>
          ) : items.map(it => (
            <div key={it.item_id} className={`rounded-lg border p-3 flex gap-3 ${it.approval_status === 'pending' ? 'border-amber-200 bg-amber-50/40' : 'border-gray-200'}`}>
              {it.photo_path && photos[it.photo_path] ? (
                <img src={photos[it.photo_path]} alt={it.label} className="h-20 w-20 rounded object-cover border border-gray-200 shrink-0" />
              ) : (
                <div className="h-20 w-20 rounded border border-dashed border-gray-200 flex flex-col items-center justify-center gap-1 text-gray-300 shrink-0">
                  <ImageOff className="h-4 w-4" /><span className="text-[10px]">no photo</span>
                </div>
              )}
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="text-sm font-medium text-gray-900 truncate">{it.company}</div>
                <div className="text-xs text-gray-600">{it.label} — {dims(it)}</div>
                {it.approval_status === 'approved' && (
                  <div className="text-xs text-green-700 flex items-center gap-1"><Check className="h-3.5 w-3.5" /> Approved{it.approval_note ? ` — ${it.approval_note}` : ''}</div>
                )}
                {it.approval_status === 'refused' && (
                  <div className="text-xs text-red-700 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> Refused — {it.approval_note}</div>
                )}
                <Input
                  className="h-8 text-xs"
                  placeholder={it.approval_status === 'pending' ? 'Condition, or the reason for a refusal (shown to them)' : 'Change the note'}
                  value={notes[it.item_id] ?? ''}
                  onChange={e => setNotes(p => ({ ...p, [it.item_id]: e.target.value }))}
                />
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={busy === it.item_id}
                    onClick={() => decide(it, 'approved')}>
                    {busy === it.item_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Approve
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs text-red-700" disabled={busy === it.item_id}
                    onClick={() => decide(it, 'refused')}>
                    <X className="h-3.5 w-3.5" /> Refuse
                  </Button>
                  {it.approval_status !== 'pending' && (
                    <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-gray-500" disabled={busy === it.item_id}
                      onClick={() => decide(it, 'pending')}>
                      <RotateCcw className="h-3.5 w-3.5" /> Undo
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
