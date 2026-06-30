import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  RefreshCw, ArrowLeft, Activity, Users, CreditCard, QrCode, BookOpen, Scale, Trophy, MessageSquare, Mail, Send, Loader2, Lock, Save,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
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

// supabase.functions.invoke can throw a transient FunctionsFetchError when the
// request hits a cold function before it boots (surfaces as "Failed to send a
// request to the Edge Function"). These are launch-critical blast buttons, so we
// retry a transient NETWORK failure once. A real HTTP error (the function ran and
// returned 4xx/5xx) is returned immediately, never retried.
async function invokeWithRetry(name: string, body: Record<string, unknown>) {
  for (let attempt = 0; ; attempt++) {
    const res = await supabase.functions.invoke(name, { body });
    if (res.error && (res.error as { name?: string }).name === 'FunctionsFetchError' && attempt < 1) {
      await new Promise(r => setTimeout(r, 900));
      continue;
    }
    return res;
  }
}

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
  const [remindBusy, setRemindBusy] = useState<string | null>(null);
  const [remindMsg, setRemindMsg] = useState<string | null>(null);
  const [payBusy, setPayBusy] = useState(false);
  const [payMsg, setPayMsg] = useState<string | null>(null);
  const [onboardBusy, setOnboardBusy] = useState<string | null>(null);
  const [onboardMsg, setOnboardMsg] = useState<string | null>(null);
  const [editDeadline, setEditDeadline] = useState('');
  const [savingDeadline, setSavingDeadline] = useState(false);

  useEffect(() => { load(); }, []);
  const load = async () => {
    setLoading(true);
    const { data: ev } = await supabase.from('sm_event').select('id, settings').eq('slug', 'sm26').maybeSingle();
    if (!ev) { setLoading(false); return; }
    const eid = (ev as { id: string }).id;
    setEventId(eid);
    setEditDeadline(((ev as { settings?: { edit_locks_at?: string } }).settings?.edit_locks_at) || '');
    const { data } = await supabase.rpc('sm_event_health', { p_event_id: eid });
    setH((data || null) as Health | null);
    setLoading(false);
  };

  // Date after which participants can no longer edit their registration/details.
  const saveDeadline = async () => {
    if (!eventId) return;
    setSavingDeadline(true);
    const { error } = await supabase.rpc('sm_set_edit_deadline', { p_event_id: eventId, p_date: editDeadline || null });
    setSavingDeadline(false);
    if (error) { toast({ title: 'Could not save', description: error.message, variant: 'destructive' }); return; }
    toast({ title: editDeadline ? `Editing closes after ${editDeadline}` : 'Editing deadline cleared' });
  };

  // Pre-event reminder: a test to myself, or a one-off send to all confirmed
  // (the cron handles the scheduled 7-day / 1-day sends automatically).
  const sendTestReminder = async () => {
    setRemindBusy('test'); setRemindMsg(null);
    const { data: u } = await supabase.auth.getUser();
    const email = u?.user?.email;
    if (!email) { setRemindBusy(null); setRemindMsg('Could not determine your email.'); return; }
    const { error } = await invokeWithRetry('sm26-reminders', { test_email: email, kind: 'manual' });
    setRemindBusy(null);
    if (error) { setRemindMsg(`Test failed: ${error.message}`); return; }
    setRemindMsg(`Test reminder sent to ${email}.`);
    toast({ title: 'Test reminder sent', description: email });
  };

  const sendAllReminders = async () => {
    if (!window.confirm('Send the pre-event reminder now to ALL confirmed participants? Each is emailed once — anyone already reminded is skipped.')) return;
    setRemindBusy('all'); setRemindMsg(null);
    const { data, error } = await invokeWithRetry('sm26-reminders', { kind: 'manual_all' });
    setRemindBusy(null);
    if (error) { setRemindMsg(`Send failed: ${error.message}`); return; }
    const n = (data as { sent?: number } | null)?.sent ?? 0;
    setRemindMsg(`Reminder sent to ${n} participant(s).`);
    toast({ title: `Reminder sent to ${n} participant(s)` });
  };

  // Payment reminder to everyone invoiced-but-unpaid (status='invoiced'), one
  // sm26-email call per participant — reuses the per-participant reminder.
  const remindUnpaid = async () => {
    if (!eventId) return;
    setPayBusy(true); setPayMsg(null);
    const { data, error } = await supabase
      .from('sm_payment')
      .select('registration_id, registration:sm_registration!inner(status,email)')
      .eq('event_id', eventId)
      .eq('status', 'invoiced');
    if (error) { setPayBusy(false); setPayMsg(`Could not load: ${error.message}`); return; }
    const rows = (data || []) as Array<{ registration_id: string; registration: { status?: string; email?: string } | { status?: string; email?: string }[] }>;
    const targets = rows.filter((r) => {
      const reg = Array.isArray(r.registration) ? r.registration[0] : r.registration;
      return reg && !['declined', 'cancelled'].includes(reg.status || '') && !!reg.email;
    });
    if (targets.length === 0) { setPayBusy(false); setPayMsg('No invoiced-but-unpaid participants to remind.'); return; }
    if (!window.confirm(`Send a payment reminder to ${targets.length} invoiced-but-unpaid participant(s)?`)) { setPayBusy(false); return; }
    let n = 0;
    await Promise.all(targets.map(async (t) => {
      const { error: e } = await invokeWithRetry('sm26-email', { registration_id: t.registration_id, kind: 'payment_reminder' });
      if (!e) n++;
    }));
    setPayBusy(false);
    setPayMsg(`Payment reminder sent to ${n} participant(s).`);
    toast({ title: `Payment reminders sent to ${n}` });
  };

  // Onboarding invites: email everyone who has a registration but no account yet
  // a link to create their account + claim it. Repeatable (re-targets only those
  // still not on the platform).
  const sendTestOnboarding = async () => {
    setOnboardBusy('test'); setOnboardMsg(null);
    const { data: u } = await supabase.auth.getUser();
    const email = u?.user?.email;
    if (!email) { setOnboardBusy(null); setOnboardMsg('Could not determine your email.'); return; }
    const { error } = await invokeWithRetry('sm26-onboarding', { test_email: email });
    setOnboardBusy(null);
    if (error) { setOnboardMsg(`Test failed: ${error.message}`); return; }
    setOnboardMsg(`Test onboarding email sent to ${email}.`);
    toast({ title: 'Test onboarding email sent', description: email });
  };

  const sendAllOnboarding = async () => {
    if (!window.confirm('Email everyone who has a registration but no account yet, inviting them to create their account and claim it? Only people not yet on the platform are emailed.')) return;
    setOnboardBusy('all'); setOnboardMsg(null);
    const { data, error } = await invokeWithRetry('sm26-onboarding', {});
    setOnboardBusy(null);
    if (error) { setOnboardMsg(`Send failed: ${error.message}`); return; }
    const n = (data as { sent?: number } | null)?.sent ?? 0;
    setOnboardMsg(`Onboarding invite sent to ${n} participant(s).`);
    toast({ title: `Onboarding sent to ${n} participant(s)` });
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

      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 space-y-3">
          <div className="text-sm font-semibold text-gray-700 flex items-center gap-2"><Send className="h-4 w-4 text-gray-400" /> Onboarding invites</div>
          <p className="text-xs text-gray-500">Email everyone who has a registration but <strong>hasn't created an account yet</strong> a link to set up their account and claim it. Repeatable — only people still not on the platform are emailed. <span className="text-amber-600">Send this at launch, once the public SM26 pages are live.</span></p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={sendTestOnboarding} disabled={!!onboardBusy}>
              {onboardBusy === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Send test to me
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={sendAllOnboarding} disabled={!!onboardBusy}>
              {onboardBusy === 'all' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send to everyone not yet on the platform
            </Button>
          </div>
          {onboardMsg && <p className="text-xs text-gray-500">{onboardMsg}</p>}
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 space-y-3">
          <div className="text-sm font-semibold text-gray-700 flex items-center gap-2"><Mail className="h-4 w-4 text-gray-400" /> Pre-event reminder</div>
          <p className="text-xs text-gray-500">An automated reminder emails <strong>confirmed</strong> participants 7 days and 1 day before the event. Preview it or send it now — each person is emailed only once per reminder.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={sendTestReminder} disabled={!!remindBusy}>
              {remindBusy === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Send test to me
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={sendAllReminders} disabled={!!remindBusy}>
              {remindBusy === 'all' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send to all confirmed now
            </Button>
          </div>
          {remindMsg && <p className="text-xs text-gray-500">{remindMsg}</p>}
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 space-y-3">
          <div className="text-sm font-semibold text-gray-700 flex items-center gap-2"><CreditCard className="h-4 w-4 text-gray-400" /> Payment reminders</div>
          <p className="text-xs text-gray-500">Email a "still awaiting payment" reminder to everyone whose payment status is <strong>Invoiced</strong> (not yet paid). Repeatable — send whenever you want to chase. You can also remind one person at a time from their Payment panel.</p>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={remindUnpaid} disabled={payBusy}>
            {payBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Remind all invoiced-but-unpaid
          </Button>
          {payMsg && <p className="text-xs text-gray-500">{payMsg}</p>}
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 space-y-3">
          <div className="text-sm font-semibold text-gray-700 flex items-center gap-2"><Lock className="h-4 w-4 text-gray-400" /> Participant editing deadline</div>
          <p className="text-xs text-gray-500">After this date, participants can no longer edit their registration or details (editing stays open through the day itself). Clear the date for no deadline.</p>
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={editDeadline} onChange={e => setEditDeadline(e.target.value)} className="h-9 text-sm border border-gray-200 rounded-md px-2.5" />
            <Button size="sm" variant="outline" className="gap-1.5" onClick={saveDeadline} disabled={savingDeadline}>
              {savingDeadline ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
            </Button>
          </div>
        </CardContent>
      </Card>

      {eventId && (
        <div className="grid md:grid-cols-2 gap-4">
          <AdminEventPartners eventId={eventId} />
          <AdminYVPartners eventId={eventId} />
        </div>
      )}
    </div>
  );
}
