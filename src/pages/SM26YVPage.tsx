import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { RefreshCw, Lightbulb, Scale, Lock } from 'lucide-react';
import { SM26BackLink } from '@/components/sm26/SM26BackLink';

// Yachting Ventures (Gabriella) console: the innovation pipeline + innovation
// jury, with registration / confirmation / payment status for follow-ups.
// Access is enforced server-side by sm_yv_innovations / sm_yv_jurors (staff or
// a kind='yachting_ventures' event partner); this page just reflects it.

interface Innovation {
  registration_id: string; company: string; contact: string | null; email: string;
  reg_status: string; role_status: string; payment_status: string; stage: string | null; categories: string[] | null;
}
interface Juror {
  registration_id: string; name: string | null; email: string; company: string | null;
  role_status: string; innovation_assignments: number;
}

const regBadge = (s: string) => {
  if (s === 'confirmed') return 'bg-green-50 text-green-700 border-green-200';
  if (s === 'declined') return 'bg-red-50 text-red-600 border-red-200';
  if (s === 'cancelled') return 'bg-gray-50 text-gray-500 border-gray-200';
  return 'bg-blue-50 text-blue-700 border-blue-200';
};
const payBadge = (s: string) =>
  s === 'paid' || s === 'waived' ? 'bg-green-50 text-green-700 border-green-200'
  : s === 'invoiced' ? 'bg-amber-50 text-amber-700 border-amber-200'
  : 'bg-gray-50 text-gray-500 border-gray-200';
const Pill = ({ s, cls }: { s: string; cls: string }) => (
  <span className={`text-xs px-2 py-0.5 rounded-full border whitespace-nowrap ${cls}`}>{s}</span>
);

export function SM26YVPage() {
  const [innovations, setInnovations] = useState<Innovation[]>([]);
  const [jurors, setJurors] = useState<Juror[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data: ev } = await supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle();
    if (!ev) { setLoading(false); return; }
    const eventId = (ev as { id: string }).id;
    const [inn, jur] = await Promise.all([
      supabase.rpc('sm_yv_innovations', { p_event_id: eventId }),
      supabase.rpc('sm_yv_jurors', { p_event_id: eventId }),
    ]);
    if (inn.error || jur.error) { setDenied(true); setLoading(false); return; }
    setInnovations((inn.data || []) as Innovation[]);
    setJurors((jur.data || []) as Juror[]);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-[60vh]"><RefreshCw className="h-6 w-6 animate-spin text-gray-300" /></div>
  );
  if (denied) return (
    <div className="container mx-auto px-4 py-16 max-w-lg text-center">
      <Lock className="h-8 w-8 mx-auto text-gray-300 mb-3" />
      <h1 className="text-xl font-bold mb-1">Yachting Ventures access only</h1>
      <p className="text-gray-500 text-sm">This console is reserved for the Yachting Ventures team. If you should have access, contact M3.</p>
    </div>
  );

  const paid = innovations.filter(i => i.payment_status === 'paid' || i.payment_status === 'waived').length;
  const confirmed = innovations.filter(i => i.reg_status === 'confirmed').length;
  const stats: [string, number][] = [
    ['Innovations', innovations.length], ['Confirmed', confirmed], ['Paid', paid], ['Jurors', jurors.length],
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet><title>Yachting Ventures — Smart Marina Rendezvous 2026</title></Helmet>

      <section className="bg-gradient-to-br from-[#0b2653] to-[#143a6b] text-white">
        <div className="container mx-auto px-4 py-10">
          <div className="mb-4"><SM26BackLink to="/account" label="Back" light /></div>
          <p className="uppercase tracking-wide text-white/60 text-sm mb-1">Yachting Ventures · Innovation scouting</p>
          <h1 className="text-3xl font-bold">Innovation pipeline &amp; jury</h1>
          <p className="text-white/80 mt-2 max-w-2xl">Every innovation entry and juror — registration, confirmation and payment status, so you can chase follow-ups.</p>
        </div>
      </section>

      <div className="container mx-auto px-4 py-8 max-w-5xl space-y-6">
        <div className="flex items-center justify-between">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1 mr-4">
            {stats.map(([l, v]) => (
              <div key={l} className="rounded-xl bg-white border border-gray-200 p-4">
                <div className="text-[11px] uppercase tracking-wide text-gray-400">{l}</div>
                <div className="text-2xl font-semibold mt-0.5">{v}</div>
              </div>
            ))}
          </div>
          <Button size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={load}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
        </div>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Lightbulb className="h-4 w-4 text-primary" /> Innovation entries ({innovations.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  <th className="px-4 py-2">Company</th><th className="px-4 py-2">Contact</th><th className="px-4 py-2">Registration</th><th className="px-4 py-2">Payment</th><th className="px-4 py-2">Stage</th>
                </tr></thead>
                <tbody>
                  {innovations.map(i => (
                    <tr key={i.registration_id} className="border-b border-gray-50 align-top">
                      <td className="px-4 py-2.5 font-medium">{i.company}</td>
                      <td className="px-4 py-2.5 text-gray-500"><div>{i.contact || '—'}</div><div className="text-xs text-gray-400">{i.email}</div></td>
                      <td className="px-4 py-2.5"><Pill s={i.reg_status} cls={regBadge(i.reg_status)} /></td>
                      <td className="px-4 py-2.5"><Pill s={i.payment_status} cls={payBadge(i.payment_status)} /></td>
                      <td className="px-4 py-2.5 text-gray-500">{i.stage || '—'}</td>
                    </tr>
                  ))}
                  {innovations.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">No innovation entries yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Scale className="h-4 w-4 text-primary" /> Innovation jury ({jurors.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  <th className="px-4 py-2">Juror</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Innovation assignments</th>
                </tr></thead>
                <tbody>
                  {jurors.map(j => (
                    <tr key={j.registration_id} className="border-b border-gray-50">
                      <td className="px-4 py-2.5"><div className="font-medium">{j.name || '—'}</div><div className="text-xs text-gray-400">{j.email}{j.company ? ` · ${j.company}` : ''}</div></td>
                      <td className="px-4 py-2.5"><Pill s={j.role_status} cls={regBadge(j.role_status === 'confirmed' ? 'confirmed' : j.role_status === 'declined' ? 'declined' : 'submitted')} /></td>
                      <td className="px-4 py-2.5 text-gray-500">{j.innovation_assignments}</td>
                    </tr>
                  ))}
                  {jurors.length === 0 && <tr><td colSpan={3} className="px-4 py-6 text-center text-gray-400">No jurors yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
