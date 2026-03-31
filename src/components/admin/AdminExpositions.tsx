import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Eye } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

interface ExpositionRequest {
  id: string; organization_id: string; event_id: string; requested_by: string;
  status: string; admin_notes: string | null; invoice_reference: string | null;
  amount_due: number | null; payment_confirmed_at: string | null; created_at: string;
  org_name: string; event_title: string; requester_email: string;
}

export function AdminExpositions() {
  const { t } = useTranslation();
  const [requests, setRequests] = useState<ExpositionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedReq, setSelectedReq] = useState<ExpositionRequest | null>(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [invoiceRef, setInvoiceRef] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => { loadReqs(); }, []);

  const loadReqs = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('exposition_requests')
      .select('*, organizations:organization_id(name), events:event_id(title), profiles!exposition_requests_requested_by_profiles_fkey(email)')
      .order('created_at', { ascending: false });
    const rows = (data || []).map((r: Record<string, unknown>) => ({
      ...r,
      org_name: (r.organizations as Record<string, string> | null)?.name || '—',
      event_title: (r.events as Record<string, string> | null)?.title || '—',
      requester_email: (r.profiles as Record<string, string> | null)?.email || '—',
    }));
    setRequests(rows as ExpositionRequest[]);
    setLoading(false);
  };

  const updateReqStatus = async (id: string, status: string) => {
    const updates: Record<string, unknown> = { status };
    if (invoiceRef) updates.invoice_reference = invoiceRef;
    if (adminNotes) updates.admin_notes = adminNotes;
    if (status === 'paid') updates.payment_confirmed_at = new Date().toISOString();

    await supabase.from('exposition_requests').update(updates).eq('id', id);

    // If paid, auto-create event registration
    if (status === 'paid' && selectedReq) {
      await supabase.from('event_registrations').insert({
        event_id: selectedReq.event_id,
        user_id: selectedReq.requested_by,
        organization_id: selectedReq.organization_id,
        registration_type: 'exhibitor',
        payment_status: 'paid',
        amount_due: selectedReq.amount_due || 1400,
        invoice_reference: invoiceRef || selectedReq.invoice_reference,
        registered_by: selectedReq.requested_by,
      });
    }

    toast({ title: t('admin.expositions.statusUpdated', { status }) });
    setSelectedReq(null);
    loadReqs();
  };

  const filtered = statusFilter === 'all' ? requests : requests.filter(r => r.status === statusFilter);

  const statusColors: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    approved: 'bg-blue-100 text-blue-800',
    invoice_sent: 'bg-indigo-100 text-indigo-800',
    paid: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">{t('admin.expositions.title')} ({filtered.length})</h1>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('admin.expositions.allStatus')}</SelectItem>
            <SelectItem value="pending">{t('admin.expositions.pending')}</SelectItem>
            <SelectItem value="approved">{t('admin.expositions.approved')}</SelectItem>
            <SelectItem value="invoice_sent">{t('admin.expositions.invoiceSent')}</SelectItem>
            <SelectItem value="paid">{t('admin.expositions.paid')}</SelectItem>
            <SelectItem value="rejected">{t('admin.expositions.rejected')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full"><thead className="bg-gray-50 border-b"><tr>
        <th className="text-left p-4 font-medium">{t('admin.expositions.marina')}</th>
        <th className="text-left p-4 font-medium">{t('admin.expositions.event')}</th>
        <th className="text-left p-4 font-medium">{t('admin.status')}</th>
        <th className="text-left p-4 font-medium">{t('admin.expositions.amount')}</th>
        <th className="text-left p-4 font-medium">{t('admin.expositions.date')}</th>
        <th className="text-left p-4 font-medium">{t('admin.actions')}</th>
      </tr></thead><tbody>
        {filtered.map(r => (
          <tr key={r.id} className="border-b hover:bg-gray-50">
            <td className="p-4">
              <div className="font-medium">{r.org_name}</div>
              <div className="text-xs text-gray-500">{r.requester_email}</div>
            </td>
            <td className="p-4 text-sm">{r.event_title}</td>
            <td className="p-4"><Badge className={statusColors[r.status] || 'bg-gray-100'}>{r.status.replace('_', ' ')}</Badge></td>
            <td className="p-4 text-sm">€{r.amount_due || 1400}</td>
            <td className="p-4 text-sm text-gray-500">{new Date(r.created_at).toLocaleDateString()}</td>
            <td className="p-4">
              <Button size="sm" variant="ghost" onClick={() => { setSelectedReq(r); setAdminNotes(r.admin_notes || ''); setInvoiceRef(r.invoice_reference || ''); }}>
                <Eye className="h-4 w-4" />
              </Button>
            </td>
          </tr>
        ))}
        {filtered.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-gray-400">{t('admin.expositions.noExpositions')}</td></tr>}
      </tbody></table></div></CardContent></Card>

      <Dialog open={!!selectedReq} onOpenChange={() => setSelectedReq(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('admin.expositions.dialogTitle')}</DialogTitle>
            <DialogDescription>{t('admin.expositions.dialogDesc')}</DialogDescription>
          </DialogHeader>
          {selectedReq && (
            <div className="space-y-4 mt-2">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><strong>{t('admin.expositions.marina')}:</strong> {selectedReq.org_name}</div>
                <div><strong>{t('admin.expositions.event')}:</strong> {selectedReq.event_title}</div>
                <div><strong>{t('admin.expositions.requester')}:</strong> {selectedReq.requester_email}</div>
                <div><strong>{t('admin.expositions.amount')}:</strong> €{selectedReq.amount_due || 1400}</div>
                <div><strong>{t('admin.status')}:</strong> <Badge className={statusColors[selectedReq.status] || ''}>{selectedReq.status.replace('_', ' ')}</Badge></div>
                <div><strong>{t('admin.expositions.date')}:</strong> {new Date(selectedReq.created_at).toLocaleString()}</div>
              </div>
              <div className="space-y-2">
                <Label>{t('admin.expositions.invoiceReference')}</Label>
                <Input value={invoiceRef} onChange={e => setInvoiceRef(e.target.value)} placeholder={t('admin.expositions.invoicePlaceholder')} />
              </div>
              <div className="space-y-2">
                <Label>{t('admin.expositions.adminNotes')}</Label>
                <Textarea value={adminNotes} onChange={e => setAdminNotes(e.target.value)} rows={3} />
              </div>
              <div className="flex flex-wrap gap-2 pt-2 border-t">
                {selectedReq.status === 'pending' && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => updateReqStatus(selectedReq.id, 'approved')}>{t('admin.expositions.approve')}</Button>
                    <Button size="sm" variant="destructive" onClick={() => updateReqStatus(selectedReq.id, 'rejected')}>{t('admin.expositions.reject')}</Button>
                  </>
                )}
                {selectedReq.status === 'approved' && (
                  <Button size="sm" variant="outline" onClick={() => updateReqStatus(selectedReq.id, 'invoice_sent')}>{t('admin.expositions.markInvoiceSent')}</Button>
                )}
                {selectedReq.status === 'invoice_sent' && (
                  <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => updateReqStatus(selectedReq.id, 'paid')}>{t('admin.expositions.confirmPayment')}</Button>
                )}
                {(selectedReq.status === 'paid' || selectedReq.status === 'rejected') && (
                  <p className="text-sm text-gray-500 italic">{t('admin.expositions.alreadyProcessed', { status: selectedReq.status })}</p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
