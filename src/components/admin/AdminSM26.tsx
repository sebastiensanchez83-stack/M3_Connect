import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search, ChevronRight, Ship, Mail, Building2, Clock, Scale, BookOpen, CalendarDays, QrCode, Trophy, MessageSquare, Check, BellRing, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

// SM26 admin console — list of registrations for the Smart & Sustainable
// Marina Rendezvous 2026, with role/status filters and a click-through detail.
// Staff read access is enforced by RLS (sm_registration_select).

export const SM26_ROLE_LABELS: Record<string, string> = {
  visitor: 'Visitor',
  marina: 'Marina',
  startup: 'Startup',
  architect_pro: 'Architecture · Pro',
  architect_student: 'Architecture · Student',
  media: 'Media',
  jury: 'Jury',
  investor: 'Investor',
  sponsor: 'Sponsor',
  speaker: 'Speaker',
  vip: 'VIP',
};

export const REG_STATUSES = ['submitted', 'under_review', 'confirmed', 'waitlist', 'declined', 'cancelled'] as const;

export function regStatusBadgeClass(status: string): string {
  switch (status) {
    case 'confirmed': return 'bg-green-50 text-green-700 border-green-200';
    case 'under_review': return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'waitlist': return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'declined': return 'bg-red-50 text-red-700 border-red-200';
    case 'cancelled': return 'bg-gray-100 text-gray-500 border-gray-200';
    default: return 'bg-gray-50 text-gray-600 border-gray-200'; // submitted
  }
}

export const prettyStatus = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// Plain-English meaning of each registration status + its position on the
// happy-path timeline (Submitted → Under review → Confirmed → Paid). Off-path
// statuses (waitlist/declined/cancelled) have stage = null.
export const REG_STATUS_META: Record<string, { label: string; desc: string; stage: number | null }> = {
  submitted: { label: 'Submitted', desc: 'Just registered — awaiting M3 review.', stage: 0 },
  under_review: { label: 'Under review', desc: 'M3 is checking eligibility and category.', stage: 1 },
  confirmed: { label: 'Confirmed', desc: 'Approved — full access once payment is settled.', stage: 2 },
  waitlist: { label: 'Waitlist', desc: 'On the waiting list for a place.', stage: null },
  declined: { label: 'Declined', desc: 'Not accepted for this edition — hidden from all public pages.', stage: null },
  cancelled: { label: 'Cancelled', desc: 'Registration withdrawn.', stage: null },
};
export const REG_STAGES = ['Submitted', 'Under review', 'Confirmed', 'Paid'] as const;

export const ROLE_STATUS_DESC: Record<string, string> = {
  self_submitted: 'Chosen by the participant at registration.',
  admin_added: 'Added by M3 — no extra info required yet.',
  needs_info: 'Waiting on the participant to provide requested info.',
  info_provided: 'Participant supplied the info — awaiting M3 review.',
  confirmed: 'Validated by M3.',
  declined: 'Not accepted — hidden from public pages.',
};

// Base registration fields a participant can complete/edit themselves and that
// admins can request. Shared so the participant card and the request picker use
// identical keys + labels. `multi` renders as chips / a longer text box.
export const SM26_BASE_FIELDS: { key: string; label: string; multi?: boolean }[] = [
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
  { key: 'phone', label: 'Phone' },
  { key: 'company_name', label: 'Company' },
  { key: 'job_title', label: 'Job title' },
  { key: 'website', label: 'Website' },
  { key: 'country', label: 'Country' },
  { key: 'objective', label: 'Objectives for attending', multi: true },
];

// Per-role assignment status (distinct from the overall registration status)
export const ROLE_STATUSES = ['self_submitted', 'admin_added', 'needs_info', 'info_provided', 'confirmed', 'declined'] as const;

export function roleStatusBadgeClass(status: string): string {
  switch (status) {
    case 'confirmed': return 'bg-green-50 text-green-700 border-green-200';
    case 'info_provided': return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'needs_info': return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'declined': return 'bg-red-50 text-red-700 border-red-200';
    case 'admin_added': return 'bg-violet-50 text-violet-700 border-violet-200';
    default: return 'bg-gray-50 text-gray-600 border-gray-200'; // self_submitted
  }
}

// Roles that take an 'org' scope (vs an individual 'user' scope)
export const ORG_SCOPE_ROLES = new Set(['marina', 'startup', 'sponsor']);
// Roles with a dedicated module table (others store extra fields in module_data)
export const MODULE_TABLE_ROLES = new Set(['startup', 'marina', 'architect_pro', 'architect_student']);

interface RoleRow { role: string; status: string; scope: string; }
interface RegRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  company_name: string | null;
  country: string | null;
  status: string;
  created_at: string;
  user_id: string | null;
  roles: RoleRow[];
}

export function AdminSM26() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<RegRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    const { data: ev } = await supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle();
    if (!ev) { setRows([]); setLoading(false); return; }
    const { data } = await supabase
      .from('sm_registration')
      .select('id,first_name,last_name,email,company_name,country,status,created_at,user_id, roles:sm_role_assignment(role,status,scope)')
      .eq('event_id', (ev as { id: string }).id)
      .order('created_at', { ascending: false });
    setRows((data || []) as RegRow[]);
    setLoading(false);
  };

  const filtered = rows.filter(r => {
    if (search) {
      const hay = `${r.first_name || ''} ${r.last_name || ''} ${r.email || ''} ${r.company_name || ''}`.toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    if (roleFilter !== 'all' && !r.roles.some(x => x.role === roleFilter)) return false;
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    return true;
  });

  // Summary counts by registration status
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;

  // ── Bulk selection ──
  const toggleSel = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clearSel = () => setSelected(new Set());
  const allVisibleSelected = filtered.length > 0 && filtered.every(r => selected.has(r.id));
  const toggleAllVisible = () => setSelected(prev => {
    if (filtered.every(r => prev.has(r.id))) { const n = new Set(prev); filtered.forEach(r => n.delete(r.id)); return n; }
    const n = new Set(prev); filtered.forEach(r => n.add(r.id)); return n;
  });

  const bulkStatus = async (status: string) => {
    if (selected.size === 0) return;
    setBulkBusy(true);
    const ids = [...selected];
    const { error } = await supabase.from('sm_registration').update({ status }).in('id', ids);
    setBulkBusy(false);
    if (error) { toast({ title: 'Bulk update failed', description: error.message, variant: 'destructive' }); return; }
    toast({ title: `${ids.length} registration${ids.length > 1 ? 's' : ''} set to ${prettyStatus(status)}` });
    clearSel();
    load();
  };

  const bulkAskDetails = async () => {
    const targets = rows.filter(r => selected.has(r.id) && r.user_id);
    if (targets.length === 0) { toast({ title: 'None of the selected have an account to notify' }); return; }
    setBulkBusy(true);
    const notes = targets.map(r => ({
      user_id: r.user_id, type: 'sm26_info_required',
      title: 'Please complete your SM26 details',
      body: 'M3 asks you to review and complete your registration details for the Smart & Sustainable Marina Rendezvous 2026.',
      link: '/sm26/me',
    }));
    const { error } = await supabase.from('sm_notification').insert(notes);
    setBulkBusy(false);
    if (error) { toast({ title: 'Could not notify', description: error.message, variant: 'destructive' }); return; }
    toast({ title: `Asked ${targets.length} participant${targets.length > 1 ? 's' : ''} to complete their details` });
    clearSel();
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <RefreshCw className="h-8 w-8 animate-spin text-gray-400" />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Ship className="h-6 w-6 text-primary" /> SM26 Registrations ({rows.length})
        </h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-1.5" onClick={() => navigate('/admin/sm26/checkin')}>
            <QrCode className="h-4 w-4" /> Check-in
          </Button>
          <Button variant="outline" className="gap-1.5" onClick={() => navigate('/admin/sm26/agenda')}>
            <CalendarDays className="h-4 w-4" /> Agenda
          </Button>
          <Button variant="outline" className="gap-1.5" onClick={() => navigate('/admin/sm26/ecat')}>
            <BookOpen className="h-4 w-4" /> E-catalogue
          </Button>
          <Button variant="outline" className="gap-1.5" onClick={() => navigate('/admin/sm26/jury')}>
            <Scale className="h-4 w-4" /> Jury &amp; evaluation
          </Button>
          <Button variant="outline" className="gap-1.5" onClick={() => navigate('/admin/sm26/awards')}>
            <Trophy className="h-4 w-4" /> Awards
          </Button>
          <Button variant="outline" className="gap-1.5" onClick={() => navigate('/admin/sm26/feedback')}>
            <MessageSquare className="h-4 w-4" /> Feedback
          </Button>
        </div>
      </div>

      {/* Status summary chips */}
      <div className="flex items-center gap-2 flex-wrap">
        {REG_STATUSES.filter(s => counts[s]).map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(statusFilter === s ? 'all' : s)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-all ${regStatusBadgeClass(s)} ${statusFilter === s ? 'ring-2 ring-primary/30' : ''}`}
          >
            {prettyStatus(s)} · {counts[s]}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, email, company..." className="pl-9 h-9" />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-44 h-9"><SelectValue placeholder="All roles" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            {Object.entries(SM26_ROLE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40 h-9"><SelectValue placeholder="All status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            {REG_STATUSES.map(s => <SelectItem key={s} value={s}>{prettyStatus(s)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 ? (
        <div className="flex items-center gap-2 flex-wrap rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
          <span className="text-sm font-medium text-gray-700">{selected.size} selected</span>
          <Button size="sm" className="h-8 gap-1.5" disabled={bulkBusy} onClick={() => bulkStatus('confirmed')}><Check className="h-3.5 w-3.5" /> Confirm</Button>
          <Select value="" onValueChange={v => bulkStatus(v)} disabled={bulkBusy}>
            <SelectTrigger className="w-40 h-8 text-xs"><SelectValue placeholder="Set status…" /></SelectTrigger>
            <SelectContent>{REG_STATUSES.map(s => <SelectItem key={s} value={s}>{prettyStatus(s)}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={bulkBusy} onClick={bulkAskDetails}><BellRing className="h-3.5 w-3.5" /> Ask to complete details</Button>
          <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-gray-500 ml-auto" onClick={clearSel}><X className="h-3.5 w-3.5" /> Clear</Button>
        </div>
      ) : filtered.length > 0 && (
        <label className="flex items-center gap-2 text-xs text-gray-500 px-1 cursor-pointer w-fit">
          <Checkbox checked={allVisibleSelected} onCheckedChange={toggleAllVisible} /> Select all {filtered.length} shown
        </label>
      )}

      <div className="space-y-2">
        {filtered.length === 0 ? (
          <Card className="border-0 shadow-sm">
            <CardContent className="py-12 text-center text-gray-400">No registrations match your filters</CardContent>
          </Card>
        ) : (
          filtered.map(r => {
            const name = `${r.first_name || ''} ${r.last_name || ''}`.trim() || '(no name)';
            return (
              <Card key={r.id}
                className="border-0 shadow-sm hover:shadow-md transition-all cursor-pointer group"
                onClick={() => navigate(`/admin/sm26/${r.id}`)}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <div onClick={e => e.stopPropagation()} className="shrink-0 flex items-center">
                      <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggleSel(r.id)} aria-label="Select registration" />
                    </div>
                    <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 font-semibold uppercase">
                      {(r.first_name?.[0] || r.email?.[0] || '?')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className="text-sm font-semibold text-gray-900 truncate group-hover:text-primary transition-colors">{name}</span>
                        <Badge className={`shrink-0 text-[10px] ${regStatusBadgeClass(r.status)}`}>{prettyStatus(r.status)}</Badge>
                        {!r.user_id && <Badge className="shrink-0 text-[10px] bg-gray-100 text-gray-500 border-gray-200">No account</Badge>}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                        {r.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> {r.email}</span>}
                        {r.company_name && <span className="flex items-center gap-1"><Building2 className="h-3 w-3" /> {r.company_name}</span>}
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {new Date(r.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                      </div>
                      {r.roles.length > 0 && (
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          {r.roles.map((role, i) => (
                            <Badge key={i} variant="secondary" className="text-[10px]">
                              {SM26_ROLE_LABELS[role.role] || role.role}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <ChevronRight className="h-5 w-5 text-gray-300 group-hover:text-primary transition-colors shrink-0" />
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
