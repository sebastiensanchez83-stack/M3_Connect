import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, ArrowLeft, QrCode, Search, Check, Download, UserCheck, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { SM26_ROLE_LABELS } from './AdminSM26';

// Admin check-in console (Area 7). The emailed entry QR encodes
// /admin/sm26/checkin?token=… — a staff phone scanning it lands here and checks
// the attendee in for the active window. Manual name-lookup is the fallback.
// Multi-window scans (Sun/Mon AM/PM) give a live headcount. Export feeds the
// external badge printing.

interface Win { key: string; label: string; sort: number; }
interface Attendee {
  id: string; first_name: string | null; last_name: string | null; email: string | null; company_name: string | null;
  badge?: { checkin_token: string } | { checkin_token: string }[];
  roles: { role: string }[];
  checkins: { window_key: string }[];
}
interface ScanResult { ok: boolean; error?: string; name?: string; company?: string | null; roles?: string[]; already?: boolean; }

const tokenOf = (a: Attendee) => (Array.isArray(a.badge) ? a.badge[0]?.checkin_token : a.badge?.checkin_token) || '';

export function AdminSM26Checkin() {
  const navigate = useNavigate();
  const [eventId, setEventId] = useState<string | null>(null);
  const [windows, setWindows] = useState<Win[]>([]);
  const [activeWindow, setActiveWindow] = useState<string>('');
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    const { data: ev } = await supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle();
    if (!ev) { setLoading(false); return; }
    const eid = (ev as { id: string }).id;
    setEventId(eid);
    await supabase.rpc('sm_ensure_badges', { p_event_id: eid });
    const [{ data: wins }, { data: regs }] = await Promise.all([
      supabase.from('sm_attendance_window').select('key,label,sort').eq('event_id', eid).order('sort'),
      supabase.from('sm_registration')
        .select('id,first_name,last_name,email,company_name, badge:sm_badge(checkin_token), roles:sm_role_assignment(role), checkins:sm_checkin(window_key)')
        .eq('event_id', eid).order('created_at', { ascending: true }),
    ]);
    const ws = (wins || []) as Win[];
    setWindows(ws);
    const initialWindow = activeWindow || ws[0]?.key || '';
    setActiveWindow(initialWindow);
    setAttendees((regs || []) as Attendee[]);
    setLoading(false);

    // process a scanned token from the URL (?token=…)
    const token = new URLSearchParams(window.location.search).get('token');
    if (token && initialWindow) processToken(token, initialWindow, (regs || []) as Attendee[]);
  };

  const processToken = async (token: string, win: string, list: Attendee[]) => {
    const { data, error } = await supabase.rpc('sm_checkin_by_token', { p_token: token, p_window: win });
    if (error) { toast({ title: 'Check-in failed', description: error.message, variant: 'destructive' }); return; }
    const res = data as ScanResult;
    setScan(res);
    if (res.ok) {
      // reflect locally
      setAttendees(prev => prev.map(a => a.id === (data as { registration_id?: string }).registration_id
        ? { ...a, checkins: a.checkins.some(c => c.window_key === win) ? a.checkins : [...a.checkins, { window_key: win }] }
        : a));
      // clear token from the URL so a refresh doesn't re-scan
      const u = new URL(window.location.href); u.searchParams.delete('token'); window.history.replaceState({}, '', u.pathname);
    } else {
      void list;
    }
  };

  const manualCheckin = async (a: Attendee) => {
    if (!activeWindow) { toast({ title: 'Pick an attendance window first', variant: 'destructive' }); return; }
    setBusy(a.id);
    const { data, error } = await supabase.rpc('sm_checkin_registration', { p_registration_id: a.id, p_window: activeWindow });
    setBusy(null);
    if (error) { toast({ title: 'Failed', description: error.message, variant: 'destructive' }); return; }
    const res = data as { already?: boolean };
    setAttendees(prev => prev.map(x => x.id === a.id
      ? { ...x, checkins: x.checkins.some(c => c.window_key === activeWindow) ? x.checkins : [...x.checkins, { window_key: activeWindow }] }
      : x));
    toast({ title: res.already ? 'Already checked in for this window' : 'Checked in' });
  };

  const exportCsv = () => {
    const origin = window.location.origin;
    const head = ['First name', 'Last name', 'Email', 'Company', 'Roles', 'Checkin token', 'Checkin URL', 'Profile URL'];
    const rows = attendees.map(a => [
      a.first_name || '', a.last_name || '', a.email || '', a.company_name || '',
      a.roles.map(r => r.role).join('; '), tokenOf(a),
      `${origin}/admin/sm26/checkin?token=${tokenOf(a)}`,
      `${origin}/users/${a.id}`,
    ]);
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const csv = [head, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = 'sm26-participants.csv'; link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  const countFor = (win: string) => attendees.filter(a => a.checkins.some(c => c.window_key === win)).length;
  const totalCheckedIn = attendees.filter(a => a.checkins.length > 0).length;
  const filtered = attendees.filter(a => {
    if (!search) return true;
    const hay = `${a.first_name || ''} ${a.last_name || ''} ${a.email || ''} ${a.company_name || ''}`.toLowerCase();
    return hay.includes(search.toLowerCase());
  });

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate('/admin/sm26')} className="gap-1.5"><ArrowLeft className="h-4 w-4" /> Back to registrations</Button>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><QrCode className="h-6 w-6 text-primary" /> Check-in</h1>
        <Button variant="outline" className="gap-1.5" onClick={exportCsv}><Download className="h-4 w-4" /> Export participants (CSV)</Button>
      </div>

      {/* Scan result */}
      {scan && (
        <Card className={`border-0 shadow-sm ${scan.ok ? 'bg-green-50' : 'bg-red-50'}`}>
          <CardContent className="p-4 flex items-center justify-between gap-3">
            {scan.ok ? (
              <div className="flex items-center gap-3">
                <UserCheck className="h-8 w-8 text-green-600" />
                <div>
                  <div className="font-semibold text-gray-900">{scan.name} {scan.already && <span className="text-xs text-amber-600">(already checked in)</span>}</div>
                  <div className="text-sm text-gray-600">{scan.company} · {(scan.roles || []).map(r => SM26_ROLE_LABELS[r] || r).join(', ')}</div>
                  <div className="text-xs text-green-700 mt-0.5">Checked in · {windows.find(w => w.key === activeWindow)?.label}</div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-red-700">Unknown or invalid QR token.</div>
            )}
            <button onClick={() => setScan(null)} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
          </CardContent>
        </Card>
      )}

      {/* Window selector + headcount */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-2">Active window for new check-ins</div>
          <div className="flex flex-wrap gap-2">
            {windows.map(w => (
              <button key={w.key} onClick={() => setActiveWindow(w.key)}
                className={`px-3 py-2 rounded-lg border text-sm text-left transition-colors ${activeWindow === w.key ? 'border-primary bg-primary/5 text-primary' : 'border-gray-200 text-gray-600 hover:border-primary/40'}`}>
                <div className="font-medium">{w.label}</div>
                <div className="text-xs opacity-70">{countFor(w.key)} checked in</div>
              </button>
            ))}
          </div>
          <div className="text-sm text-gray-500 mt-3">Unique attendees on-site: <span className="font-semibold text-gray-900">{totalCheckedIn}</span> / {attendees.length}</div>
        </CardContent>
      </Card>

      {/* Manual search + check-in */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search to check in by name…" className="pl-9 h-9" />
      </div>

      <div className="space-y-2">
        {filtered.map(a => {
          const here = a.checkins.some(c => c.window_key === activeWindow);
          const name = `${a.first_name || ''} ${a.last_name || ''}`.trim() || a.email || '(no name)';
          return (
            <Card key={a.id} className="border-0 shadow-sm">
              <CardContent className="p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-900">{name}</span>
                    {a.roles.map((r, i) => <Badge key={i} variant="secondary" className="text-[10px]">{SM26_ROLE_LABELS[r.role] || r.role}</Badge>)}
                  </div>
                  <div className="text-xs text-gray-500">{a.company_name}</div>
                  {a.checkins.length > 0 && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {windows.filter(w => a.checkins.some(c => c.window_key === w.key)).map(w => (
                        <Badge key={w.key} className="bg-green-50 text-green-700 border-green-200 text-[10px]">{w.label}</Badge>
                      ))}
                    </div>
                  )}
                </div>
                {here ? (
                  <Badge className="bg-green-50 text-green-700 border-green-200"><Check className="h-3 w-3 mr-1" /> In</Badge>
                ) : (
                  <Button size="sm" disabled={busy === a.id} onClick={() => manualCheckin(a)}>Check in</Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
