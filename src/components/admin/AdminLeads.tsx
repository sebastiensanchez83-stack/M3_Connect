import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Eye, Target, Flame, Thermometer, Snowflake } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { AdminContextBanner } from './AdminContextBanner';
import type { PartnerLead } from './types';

export function AdminLeads() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlStatus = searchParams.get('status') || '';
  const hasUrlFilters = !!urlStatus;
  const [leads, setLeads] = useState<PartnerLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState<PartnerLead | null>(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [statusFilter, setStatusFilter] = useState(urlStatus || 'all');

  useEffect(() => { loadLeads(); }, []);
  const loadLeads = async () => { setLoading(true); const { data } = await supabase.from('partner_leads').select('*').order('created_at', { ascending: false }); setLeads(data || []); setLoading(false); };
  const updateStatus = async (id: string, status: string) => { await supabase.from('partner_leads').update({ status }).eq('id', id); toast({ title: `Status: ${status}` }); loadLeads(); };
  const saveNotes = async () => { if (!selectedLead) return; await supabase.from('partner_leads').update({ admin_notes: adminNotes }).eq('id', selectedLead.id); toast({ title: 'Notes saved' }); setSelectedLead(null); loadLeads(); };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  const filteredLeads = statusFilter === 'all' ? leads : leads.filter(l => l.status === statusFilter);

  // Lead intensity calculation
  const getIntensity = (l: PartnerLead) => {
    const daysSince = Math.floor((Date.now() - new Date(l.created_at).getTime()) / 86400000);
    if (l.status === 'in_discussion') return { label: 'Hot', icon: Flame, color: 'text-red-600 bg-red-50' };
    if (l.status === 'qualified') return { label: 'Warm', icon: Thermometer, color: 'text-amber-600 bg-amber-50' };
    if (daysSince < 7 && l.status === 'new') return { label: 'Warm', icon: Thermometer, color: 'text-amber-600 bg-amber-50' };
    return { label: 'Cold', icon: Snowflake, color: 'text-blue-400 bg-blue-50' };
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">{t('admin.partnerLeads')} ({filteredLeads.length})</h1>
      </div>

      {/* Context banner */}
      {hasUrlFilters && (
        <AdminContextBanner
          label={`Showing ${urlStatus.replace('_', ' ')} leads`}
          count={filteredLeads.length}
          onClear={() => { setSearchParams({}, { replace: true }); setStatusFilter('all'); }}
          color="amber"
        />
      )}

      {/* Pipeline summary strip */}
      <div className="flex items-center gap-2 mb-4">
        {[
          { key: 'all', label: 'All', count: leads.length },
          { key: 'new', label: 'New', count: leads.filter(l => l.status === 'new').length },
          { key: 'qualified', label: 'Qualified', count: leads.filter(l => l.status === 'qualified').length },
          { key: 'in_discussion', label: 'In Discussion', count: leads.filter(l => l.status === 'in_discussion').length },
          { key: 'signed', label: 'Signed', count: leads.filter(l => l.status === 'signed').length },
          { key: 'rejected', label: 'Rejected', count: leads.filter(l => l.status === 'rejected').length },
        ].map(s => (
          <Button key={s.key} variant={statusFilter === s.key ? 'default' : 'outline'} size="sm"
            className="text-xs gap-1.5" onClick={() => setStatusFilter(s.key)}>
            {s.label}
            {s.count > 0 && <span className="bg-white/20 rounded-full px-1.5 text-[10px] font-bold">{s.count}</span>}
          </Button>
        ))}
      </div>

      {/* Lead cards (clickable rows) */}
      <div className="space-y-2">
        {filteredLeads.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-gray-400">No leads match this filter</CardContent></Card>
        ) : filteredLeads.map(l => {
          const intensity = getIntensity(l);
          const daysSince = Math.floor((Date.now() - new Date(l.created_at).getTime()) / 86400000);
          return (
            <Card key={l.id} className="border-0 shadow-sm hover:shadow-md transition-all cursor-pointer group"
              onClick={() => { setSelectedLead(l); setAdminNotes(l.admin_notes || ''); }}>
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  {/* Intensity indicator */}
                  <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${intensity.color}`}>
                    <intensity.icon className="h-5 w-5" />
                  </div>
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-semibold text-gray-900">{l.company}</span>
                      <Badge variant="outline" className="text-[10px]">{l.actor_type}</Badge>
                      <span className="text-[10px] text-gray-400">{l.country}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span>{l.first_name} {l.last_name}</span>
                      <span>{l.email}</span>
                      <span className="text-gray-300">{daysSince}d ago</span>
                    </div>
                  </div>
                  {/* Status + Actions */}
                  <div className="flex items-center gap-3 shrink-0" onClick={e => e.stopPropagation()}>
                    <div className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${intensity.color}`}>{intensity.label}</div>
                    <Select value={l.status} onValueChange={v => updateStatus(l.id, v)}>
                      <SelectTrigger className="w-36 h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="new">New</SelectItem>
                        <SelectItem value="qualified">Qualified</SelectItem>
                        <SelectItem value="in_discussion">In Discussion</SelectItem>
                        <SelectItem value="signed">Signed</SelectItem>
                        <SelectItem value="rejected">Rejected</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <Dialog open={!!selectedLead} onOpenChange={() => setSelectedLead(null)}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Lead Details</DialogTitle><DialogDescription>View lead information and manage notes.</DialogDescription></DialogHeader>{selectedLead && (<div className="space-y-4 mt-4"><div className="grid grid-cols-2 gap-4"><div><strong>Company:</strong> {selectedLead.company}</div><div><strong>Country:</strong> {selectedLead.country}</div><div><strong>Contact:</strong> {selectedLead.first_name} {selectedLead.last_name}</div><div><strong>Email:</strong> {selectedLead.email}</div></div><div className="space-y-2"><Label>Admin Notes</Label><Textarea value={adminNotes} onChange={e => setAdminNotes(e.target.value)} rows={3} /></div><Button onClick={saveNotes} className="w-full">Save Notes</Button></div>)}</DialogContent></Dialog>
    </div>
  );
}
