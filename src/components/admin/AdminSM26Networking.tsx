import { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { RefreshCw, Users, Mail, Loader2, ArrowLeft, CheckCircle2, ArrowLeftRight, QrCode, Printer } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

// Admin networking facilitation: every connection request from badge scans,
// deduped into pairs (mutual flagged), with a per-pair "Send introduction" that
// emails both sides each other's details (Victor CC'd). Plus a printable sheet of
// each attendee's networking QR for the badges.

// Printed badges always point at production.
const CONNECT_BASE = 'https://smartmarinaconnect.com/sm26/connect?c=';

interface Conn {
  id: string; note: string | null; introduced: boolean; created_at: string; mutual: boolean; pair_key: string;
  from_name: string; from_email: string | null; from_company: string | null;
  to_name: string; to_email: string | null; to_company: string | null;
}
interface ConnLink { registration_id: string; name: string | null; company: string | null; connect_token: string }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const who = (name: string, company: string | null) => company && company !== name ? `${company} · ${name}` : (company || name);

export function AdminSM26Networking() {
  const [eventId, setEventId] = useState<string | null>(null);
  const [conns, setConns] = useState<Conn[]>([]);
  const [links, setLinks] = useState<ConnLink[]>([]);
  const [qr, setQr] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<'intros' | 'badges'>('intros');

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  const load = async () => {
    setLoading(true);
    const { data: ev } = await supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle();
    const eid = (ev as { id: string } | null)?.id || null;
    setEventId(eid);
    if (!eid) { setLoading(false); return; }
    const [{ data: c }, { data: l }] = await Promise.all([
      supabase.rpc('sm_admin_connections', { p_event_id: eid }),
      supabase.rpc('sm_admin_connect_links', { p_event_id: eid }),
    ]);
    setConns((c || []) as Conn[]);
    const lk = (l || []) as ConnLink[];
    setLinks(lk);
    const map: Record<string, string> = {};
    await Promise.all(lk.map(async x => { try { map[x.connect_token] = await QRCode.toDataURL(CONNECT_BASE + x.connect_token, { margin: 1, width: 220 }); } catch { /* skip */ } }));
    setQr(map);
    setLoading(false);
  };

  // Collapse A->B and B->A into one row.
  const pairs = (() => {
    const m = new Map<string, Conn>();
    for (const c of conns) {
      const ex = m.get(c.pair_key);
      if (!ex) m.set(c.pair_key, c);
      else m.set(c.pair_key, { ...ex, introduced: ex.introduced || c.introduced, mutual: true, note: ex.note || c.note });
    }
    return [...m.values()].sort((a, b) => Number(a.introduced) - Number(b.introduced) || b.created_at.localeCompare(a.created_at));
  })();
  const pending = pairs.filter(p => !p.introduced).length;

  const introduce = async (c: Conn) => {
    if (!confirm(`Email an introduction to ${c.from_name} and ${c.to_name}? Each will receive the other's contact details (you are CC'd).`)) return;
    setBusy(c.id);
    const { data, error } = await supabase.functions.invoke('sm26-connection', { body: { action: 'introduce', connection_id: c.id } });
    setBusy(null);
    const err = error || (data as { error?: string })?.error;
    if (err) { toast({ title: 'Could not send', description: typeof err === 'string' ? err : 'Please try again.', variant: 'destructive' }); return; }
    toast({ title: 'Introduction sent', description: 'Both sides have been emailed.' });
    load();
  };

  const printSheet = () => {
    const cards = links.map(l => `<div class="card"><img src="${qr[l.connect_token] || ''}"/><div class="n">${esc(l.company || l.name || 'Participant')}</div><div class="u">/sm26/connect?c=${esc(l.connect_token)}</div></div>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>SM26 networking QR codes</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;margin:18px;color:#16264a}
h2{margin:0 0 4px}.sub{color:#667;margin:0 0 16px;font-size:13px}
.grid{display:flex;flex-wrap:wrap;gap:14px}
.card{width:200px;text-align:center;border:1px solid #eee;border-radius:8px;padding:10px;page-break-inside:avoid}
.card img{width:174px;height:174px}.n{font-weight:600;font-size:13px;margin-top:6px}.u{font-size:9px;color:#9aa3ba;word-break:break-all;margin-top:2px}</style></head>
<body><h2>Smart Marina Rendezvous 2026 — networking QR codes</h2>
<p class="sub">One per attendee — add to their badge. Scanning records a connection request; organizers introduce both sides by email after the event.</p>
<div class="grid">${cards}</div></body></html>`;
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
  };

  if (loading) return <div className="flex items-center justify-center h-[60vh]"><RefreshCw className="h-7 w-7 animate-spin text-primary" /></div>;

  return (
    <div className="container mx-auto px-4 py-6 max-w-4xl">
      <Helmet><title>Networking — SM26 admin</title></Helmet>
      <Link to="/admin/sm26" className="text-sm text-gray-500 hover:text-primary inline-flex items-center gap-1.5 mb-3"><ArrowLeft className="h-4 w-4" /> Smart 26</Link>
      <div className="flex items-center justify-between gap-2 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Users className="h-6 w-6 text-primary" /> Networking</h1>
          <p className="text-sm text-gray-500 mt-0.5">Introductions from badge scans, and the networking QR codes for the badges.</p>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={load}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => setTab('intros')} className={`text-sm px-3 py-1.5 rounded-lg border ${tab === 'intros' ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-200 hover:border-primary/40'}`}>Introductions {pending > 0 && <span className="ml-1 text-xs">({pending})</span>}</button>
        <button onClick={() => setTab('badges')} className={`text-sm px-3 py-1.5 rounded-lg border ${tab === 'badges' ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-200 hover:border-primary/40'}`}>Badge QR codes</button>
      </div>

      {tab === 'intros' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Introductions to make ({pairs.length})</CardTitle>
            <CardDescription>Each row is a pair who connected at the event. "Send introduction" emails both their details to each other, with you CC'd. Mutual = they both scanned each other.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {pairs.length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">No connection requests yet — they appear here as attendees scan badges at the event.</p>
            ) : pairs.map(c => (
              <div key={c.id} className={`rounded-lg border p-3 ${c.introduced ? 'border-gray-100 bg-gray-50/50' : 'border-gray-200'}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 text-sm">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900">{who(c.from_name, c.from_company)}</span>
                      <ArrowLeftRight className="h-3.5 w-3.5 text-gray-400" />
                      <span className="font-medium text-gray-900">{who(c.to_name, c.to_company)}</span>
                      {c.mutual && <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 rounded-full px-1.5 py-0.5">mutual</span>}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">{c.from_email || '—'} · {c.to_email || '—'}</div>
                    {c.note && <div className="text-xs text-gray-500 mt-1 italic">“{c.note}”</div>}
                  </div>
                  {c.introduced
                    ? <span className="text-xs text-green-700 inline-flex items-center gap-1 shrink-0"><CheckCircle2 className="h-4 w-4" /> Introduced</span>
                    : <Button size="sm" className="gap-1.5 shrink-0" disabled={busy === c.id || !c.from_email || !c.to_email} onClick={() => introduce(c)}>
                        {busy === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Send introduction
                      </Button>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {tab === 'badges' && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <CardTitle className="text-base flex items-center gap-2"><QrCode className="h-4 w-4 text-primary" /> Networking QR codes ({links.length})</CardTitle>
                <CardDescription>One per attendee — add to their badge (separate from the check-in QR). Scanning opens the connect page.</CardDescription>
              </div>
              <Button size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={printSheet} disabled={links.length === 0}><Printer className="h-4 w-4" /> Open print sheet</Button>
            </div>
          </CardHeader>
          <CardContent>
            {links.length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">No badges yet.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {links.map(l => (
                  <div key={l.registration_id} className="border border-gray-100 rounded-lg p-2 text-center">
                    {qr[l.connect_token]
                      ? <img src={qr[l.connect_token]} alt="" className="w-full max-w-[140px] mx-auto" />
                      : <div className="h-[140px] flex items-center justify-center text-gray-300"><QrCode className="h-8 w-8" /></div>}
                    <div className="text-xs font-medium text-gray-800 truncate mt-1" title={l.company || l.name || ''}>{l.company || l.name || 'Participant'}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
