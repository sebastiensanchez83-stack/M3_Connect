import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Camera, Search, RefreshCw, CheckCircle, XCircle, AlertTriangle, Undo2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { partsLabel } from '@/lib/guestList';
import { QrScanner, doorSignal } from './AdminSM26Checkin';

// Door check-in of a guest-list event (/admin/guest-list/<slug>/checkin).
// The entry QR in each guest's email encodes this URL with ?token=…, so a
// staff phone's own camera app lands here and admits the guest at once; the
// built-in scanner does the same without leaving the page. Name search is
// the fallback for anyone without their QR.

interface Row { id: string; first_name: string; last_name: string; company: string | null; status: string; conference: boolean; gala: boolean; checked_in_at: string | null; plus_one_of: string | null }
interface Verdict { ok: boolean; error?: string; already?: boolean; name?: string; company?: string | null; conference?: boolean; gala?: boolean; plus_one?: boolean; guest_id?: string; checked_in_at?: string }

const REFUSAL: Record<string, string> = {
  unknown_token: 'Unknown QR code — not a pass for this event',
  status_requested: 'Request not approved yet',
  status_invited: 'Invited but has not accepted — check with the organiser',
  status_declined: 'Declined the invitation',
  status_rejected: 'Request was refused',
  status_cancelled: 'Invitation cancelled',
};

export function AdminGuestCheckin() {
  const { slug = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const [eventId, setEventId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [scanning, setScanning] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: e } = await supabase.from('gl_event').select('id, title').eq('slug', slug).maybeSingle();
    if (!e) return;
    setEventId(e.id); setTitle(e.title);
    const { data } = await supabase.from('gl_guest')
      .select('id, first_name, last_name, company, status, conference, gala, checked_in_at, plus_one_of')
      .eq('event_id', e.id).in('status', ['confirmed', 'invited']).order('last_name');
    setRows((data || []) as Row[]);
  }, [slug]);
  useEffect(() => { load(); }, [load]);

  const checkin = useCallback(async (args: { token?: string; guestId?: string }) => {
    if (!eventId) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('gl_checkin', {
      p_event_id: eventId, p_token: args.token || null, p_guest_id: args.guestId || null, p_undo: false,
    });
    setBusy(false);
    const v: Verdict = error ? { ok: false, error: /uuid/i.test(error.message) ? 'unknown_token' : error.message } : data;
    setVerdict(v);
    try { doorSignal(!v.ok ? 'refused' : v.already ? 'already' : 'admitted'); } catch { /* sound is a nicety */ }
    load();
  }, [eventId, load]);

  // Arrived from a phone camera scanning the QR: admit straight away, then
  // drop the token from the address so a refresh does not re-scan.
  const urlToken = params.get('token');
  useEffect(() => {
    if (urlToken && eventId) { checkin({ token: urlToken }); setParams({}, { replace: true }); }
  }, [urlToken, eventId, checkin, setParams]);

  const undo = async (guestId: string) => {
    if (!eventId) return;
    await supabase.rpc('gl_checkin', { p_event_id: eventId, p_token: null, p_guest_id: guestId, p_undo: true });
    setVerdict(null); load();
  };

  const confirmed = rows.filter(r => r.status === 'confirmed');
  const inCount = confirmed.filter(r => r.checked_in_at).length;
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [];
    return rows.filter(r => `${r.first_name} ${r.last_name} ${r.company || ''}`.toLowerCase().includes(t)).slice(0, 12);
  }, [q, rows]);

  return (
    <div className="max-w-2xl space-y-5">
      <div className="flex items-center justify-between">
        <Link to={`/admin/guest-list/${slug}`} className="text-sm text-gray-500 flex items-center gap-1"><ArrowLeft className="h-4 w-4" /> Guest list</Link>
        <Button variant="ghost" size="sm" onClick={load}><RefreshCw className="h-4 w-4" /></Button>
      </div>
      <div>
        <h1 className="text-2xl font-bold">Check-in</h1>
        <p className="text-gray-500">{title} · <strong>{inCount}</strong> of {confirmed.length} confirmed guests arrived</p>
      </div>

      {verdict && (
        <Card className={verdict.ok ? (verdict.already ? 'border-amber-300 bg-amber-50' : 'border-green-300 bg-green-50') : 'border-red-300 bg-red-50'}>
          <CardContent className="pt-6 flex gap-4 items-start">
            {verdict.ok ? (verdict.already ? <AlertTriangle className="h-10 w-10 text-amber-500" /> : <CheckCircle className="h-10 w-10 text-green-600" />) : <XCircle className="h-10 w-10 text-red-600" />}
            <div className="flex-1">
              <div className="text-xl font-bold">{verdict.name || 'Not admitted'}</div>
              {verdict.company && <div className="text-gray-600">{verdict.company}</div>}
              {verdict.ok ? (
                <div className="mt-1">
                  <div className="font-medium">{verdict.already ? `Already checked in at ${new Date(verdict.checked_in_at!).toLocaleTimeString()}` : 'Welcome — admitted'}</div>
                  <div className="text-sm text-gray-700">Access: {partsLabel({ conference: !!verdict.conference, gala: !!verdict.gala })}{verdict.plus_one ? ' · plus-one' : ''}</div>
                </div>
              ) : <div className="mt-1 font-medium text-red-700">{REFUSAL[verdict.error || ''] || verdict.error}</div>}
            </div>
            {verdict.ok && !verdict.already && verdict.guest_id && (
              <Button variant="ghost" size="sm" onClick={() => undo(verdict.guest_id!)} title="Undo this check-in"><Undo2 className="h-4 w-4" /></Button>
            )}
          </CardContent>
        </Card>
      )}

      <Button className="w-full h-14 text-lg" onClick={() => setScanning(true)} disabled={!eventId}><Camera className="h-5 w-5 mr-2" /> Scan a QR code</Button>
      {scanning && (
        <QrScanner paused={busy} onClose={() => setScanning(false)} onToken={t => { setScanning(false); checkin({ token: t }); }} />
      )}

      <div className="relative">
        <Search className="h-4 w-4 absolute left-3 top-3.5 text-gray-400" />
        <Input className="pl-9 h-11" placeholder="No QR? Search a name or company" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <div className="space-y-2">
        {matches.map(r => (
          <Card key={r.id}><CardContent className="py-3 flex items-center justify-between gap-3">
            <div>
              <div className="font-medium">{r.first_name} {r.last_name}{r.plus_one_of && <span className="ml-2 text-xs text-purple-700">plus-one</span>}</div>
              <div className="text-sm text-gray-500">{[r.company, partsLabel(r)].filter(Boolean).join(' · ')}</div>
            </div>
            {r.status !== 'confirmed' ? <span className="text-xs text-amber-700">Not accepted yet</span>
              : r.checked_in_at ? <Button size="sm" variant="ghost" onClick={() => undo(r.id)}><Undo2 className="h-4 w-4 mr-1" /> In</Button>
              : <Button size="sm" disabled={busy} onClick={() => { checkin({ guestId: r.id }); setQ(''); }}>Check in</Button>}
          </CardContent></Card>
        ))}
      </div>
    </div>
  );
}
