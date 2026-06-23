import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  RefreshCw, ArrowLeft, Activity, Users, CreditCard, QrCode, BookOpen, Scale, Trophy, MessageSquare,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { SM26_ROLE_LABELS, regStatusBadgeClass, prettyStatus } from './AdminSM26';
import { AdminEventPartners } from './AdminEventPartners';
import { AdminYVPartners } from './AdminYVPartners';

// At-a-glance event vitals (registrations, payments, check-in, e-catalogue,
// jury, votes, feedback) from a single sm_event_health RPC.

type Counts = Record<string, number>;
interface Health {
  total_regs: number; declined: number;
  by_status: Counts; by_role: Counts; payments: Counts; ecat: Counts;
  checked_in: number; jurors_confirmed: number; jury_assignments: number;
  reviews_submitted: number; votes: number; feedback: number;
}

const sum = (c: Counts) => Object.values(c || {}).reduce((a, b) => a + b, 0);

function Stat({ icon: Icon, label, value, sub }: { icon: typeof Users; label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-gray-400 uppercase tracking-wide"><Icon className="h-3.5 w-3.5" /> {label}</div>
        <div className="text-2xl font-bold text-gray-900 mt-1">{value}</div>
        {sub && <div className="text-xs text-gray-500 mt-1.5 space-y-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

const Bar = ({ label, n, total, color = 'bg-primary' }: { label: string; n: number; total: number; color?: string }) => (
  <div className="flex items-center gap-2">
    <span className="w-28 shrink-0 truncate text-gray-600">{label}</span>
    <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full ${color}`} style={{ width: `${total ? Math.round((n / total) * 100) : 0}%` }} /></div>
    <span className="w-8 text-right tabular-nums text-gray-700">{n}</span>
  </div>
);

export function AdminSM26Health() {
  const navigate = useNavigate();
  const [h, setH] = useState<Health | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);
  const load = async () => {
    setLoading(true);
    const { data: ev } = await supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle();
    if (!ev) { setLoading(false); return; }
    const eid = (ev as { id: string }).id;
    setEventId(eid);
    const { data } = await supabase.rpc('sm_event_health', { p_event_id: eid });
    setH((data || null) as Health | null);
    setLoading(false);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;
  if (!h) return <div className="py-12 text-center text-gray-400">No event data.</div>;

  const totalRoles = sum(h.by_role);
  const paid = (h.payments?.paid || 0) + (h.payments?.waived || 0);
  const ecatPublished = h.ecat?.published || 0;
  const ecatTotal = sum(h.ecat);

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate('/admin/sm26')} className="gap-1.5"><ArrowLeft className="h-4 w-4" /> Back to registrations</Button>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Activity className="h-6 w-6 text-primary" /> Event health</h1>
        <Button variant="outline" size="icon" className="h-9 w-9" onClick={load} title="Refresh"><RefreshCw className="h-4 w-4" /></Button>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon={Users} label="Registrations" value={h.total_regs}
          sub={<>{h.declined > 0 && <div>{h.declined} declined (hidden)</div>}<div>{sum(h.by_status) - h.declined} active</div></>} />
        <Stat icon={CreditCard} label="Paid / waived" value={`${paid}/${h.total_regs}`}
          sub={<>{(h.payments?.invoiced || 0) > 0 && <div>{h.payments.invoiced} invoiced</div>}<div>{Math.max(0, h.total_regs - paid - (h.payments?.invoiced || 0))} not yet invoiced</div></>} />
        <Stat icon={QrCode} label="Checked in" value={`${h.checked_in}/${h.total_regs}`} sub={<div>unique attendees on-site</div>} />
        <Stat icon={BookOpen} label="E-catalogue live" value={`${ecatPublished}/${ecatTotal}`} sub={<div>{(h.ecat?.uploaded || 0)} awaiting participant review</div>} />
        <Stat icon={Scale} label="Jurors confirmed" value={h.jurors_confirmed}
          sub={<><div>{h.jury_assignments} assignments</div><div>{h.reviews_submitted} reviews submitted</div></>} />
        <Stat icon={Trophy} label="Votes cast" value={h.votes} />
        <Stat icon={MessageSquare} label="Feedback" value={h.feedback} sub={<div>responses</div>} />
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="text-sm font-semibold text-gray-700 mb-3">By status</div>
            <div className="space-y-2 text-xs">
              {Object.entries(h.by_status).sort((a, b) => b[1] - a[1]).map(([s, n]) => (
                <div key={s} className="flex items-center gap-2">
                  <span className={`w-28 shrink-0 text-[10px] px-1.5 py-0.5 rounded-full border ${regStatusBadgeClass(s)}`}>{prettyStatus(s)}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full bg-primary" style={{ width: `${sum(h.by_status) ? Math.round((n / sum(h.by_status)) * 100) : 0}%` }} /></div>
                  <span className="w-8 text-right tabular-nums text-gray-700">{n}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="text-sm font-semibold text-gray-700 mb-3">By role</div>
            <div className="space-y-2 text-xs">
              {Object.entries(h.by_role).sort((a, b) => b[1] - a[1]).map(([role, n]) => (
                <Bar key={role} label={SM26_ROLE_LABELS[role] || role} n={n} total={totalRoles} />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {eventId && (
        <div className="grid md:grid-cols-2 gap-4">
          <AdminEventPartners eventId={eventId} />
          <AdminYVPartners eventId={eventId} />
        </div>
      )}
    </div>
  );
}
