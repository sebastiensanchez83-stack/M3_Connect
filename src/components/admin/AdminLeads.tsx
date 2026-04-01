import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Eye } from 'lucide-react';
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
import type { PartnerLead } from './types';

export function AdminLeads() {
  const { t } = useTranslation();
  const [leads, setLeads] = useState<PartnerLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState<PartnerLead | null>(null);
  const [adminNotes, setAdminNotes] = useState('');

  useEffect(() => { loadLeads(); }, []);
  const loadLeads = async () => { setLoading(true); const { data } = await supabase.from('partner_leads').select('*').order('created_at', { ascending: false }); setLeads(data || []); setLoading(false); };
  const updateStatus = async (id: string, status: string) => { await supabase.from('partner_leads').update({ status }).eq('id', id); toast({ title: `Status: ${status}` }); loadLeads(); };
  const saveNotes = async () => { if (!selectedLead) return; await supabase.from('partner_leads').update({ admin_notes: adminNotes }).eq('id', selectedLead.id); toast({ title: 'Notes saved' }); setSelectedLead(null); loadLeads(); };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6"><h1 className="text-2xl font-bold">{t('admin.partnerLeads')} ({leads.length})</h1></div>
      <Card><CardContent className="p-0"><table className="w-full"><thead className="bg-gray-50 border-b"><tr><th className="text-left p-4 font-medium">Company</th><th className="text-left p-4 font-medium">Contact</th><th className="text-left p-4 font-medium">Type</th><th className="text-left p-4 font-medium">Status</th><th className="text-left p-4 font-medium">Date</th><th className="text-left p-4 font-medium">Actions</th></tr></thead><tbody>
        {leads.map(l => (<tr key={l.id} className="border-b hover:bg-gray-50"><td className="p-4"><div className="font-medium">{l.company}</div><div className="text-sm text-gray-500">{l.country}</div></td><td className="p-4"><div>{l.first_name} {l.last_name}</div><div className="text-sm text-gray-500">{l.email}</div></td><td className="p-4"><Badge variant="outline">{l.actor_type}</Badge></td><td className="p-4"><Select value={l.status} onValueChange={v => updateStatus(l.id, v)}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="new">New</SelectItem><SelectItem value="qualified">Qualified</SelectItem><SelectItem value="in_discussion">In Discussion</SelectItem><SelectItem value="signed">Signed</SelectItem><SelectItem value="rejected">Rejected</SelectItem></SelectContent></Select></td><td className="p-4 text-gray-500">{new Date(l.created_at).toLocaleDateString()}</td><td className="p-4"><Button size="sm" variant="ghost" aria-label="View details" onClick={() => { setSelectedLead(l); setAdminNotes(l.admin_notes || ''); }}><Eye className="h-4 w-4" /></Button></td></tr>))}
      </tbody></table></CardContent></Card>
      <Dialog open={!!selectedLead} onOpenChange={() => setSelectedLead(null)}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Lead Details</DialogTitle><DialogDescription>View lead information and manage notes.</DialogDescription></DialogHeader>{selectedLead && (<div className="space-y-4 mt-4"><div className="grid grid-cols-2 gap-4"><div><strong>Company:</strong> {selectedLead.company}</div><div><strong>Country:</strong> {selectedLead.country}</div><div><strong>Contact:</strong> {selectedLead.first_name} {selectedLead.last_name}</div><div><strong>Email:</strong> {selectedLead.email}</div></div><div className="space-y-2"><Label>Admin Notes</Label><Textarea value={adminNotes} onChange={e => setAdminNotes(e.target.value)} rows={3} /></div><Button onClick={saveNotes} className="w-full">Save Notes</Button></div>)}</DialogContent></Dialog>
    </div>
  );
}
