import { useState, useEffect } from 'react';
import { RefreshCw, Eye } from 'lucide-react';
import { TIER_LABELS, TIER_COLORS, OrgTier } from '@/types/database';
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
import type { SponsorshipRequestRow } from './types';

export function AdminSponsorships() {
  const [requests, setRequests] = useState<SponsorshipRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedReq, setSelectedReq] = useState<SponsorshipRequestRow | null>(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [invoiceRef, setInvoiceRef] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => { loadRequests(); }, []);

  const loadRequests = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('sponsorship_requests')
      .select('*, organizations:organization_id(name), profiles:requested_by(email)')
      .order('created_at', { ascending: false });
    const rows: SponsorshipRequestRow[] = (data || []).map((r: Record<string, unknown>) => ({
      ...r,
      org_name: (r.organizations as Record<string, string> | null)?.name || '—',
      requester_email: (r.profiles as Record<string, string> | null)?.email || '—',
    })) as SponsorshipRequestRow[];
    setRequests(rows);
    setLoading(false);
  };

  const updateRequestStatus = async (id: string, status: string) => {
    const updates: Record<string, unknown> = { status };
    if (status === 'paid') updates.payment_confirmed_at = new Date().toISOString();
    if (invoiceRef) updates.invoice_reference = invoiceRef;
    if (adminNotes) updates.admin_notes = adminNotes;

    await supabase.from('sponsorship_requests').update(updates).eq('id', id);

    // If approved, also update the organization tier
    if (status === 'approved' && selectedReq) {
      const { data: tierConfig } = await supabase
        .from('organization_tier_config')
        .select('max_seats')
        .eq('tier', selectedReq.requested_tier)
        .single();
      await supabase
        .from('organizations')
        .update({ tier: selectedReq.requested_tier, max_seats: tierConfig?.max_seats || 5 })
        .eq('id', selectedReq.organization_id);
      toast({ title: `Sponsorship approved — tier set to ${TIER_LABELS[selectedReq.requested_tier as OrgTier] || selectedReq.requested_tier}` });
    } else {
      toast({ title: `Status updated to ${status}` });
    }
    setSelectedReq(null);
    loadRequests();
  };

  const filtered = statusFilter === 'all' ? requests : requests.filter(r => r.status === statusFilter);

  const statusColors: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    invoice_sent: 'bg-blue-100 text-blue-800',
    paid: 'bg-green-100 text-green-800',
    approved: 'bg-emerald-100 text-emerald-800',
    rejected: 'bg-red-100 text-red-800',
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Sponsorship Requests ({filtered.length})</h1>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="invoice_sent">Invoice Sent</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full"><thead className="bg-gray-50 border-b"><tr>
        <th className="text-left p-4 font-medium">Organization</th>
        <th className="text-left p-4 font-medium">Current Tier</th>
        <th className="text-left p-4 font-medium">Requested Tier</th>
        <th className="text-left p-4 font-medium">Status</th>
        <th className="text-left p-4 font-medium">Date</th>
        <th className="text-left p-4 font-medium">Actions</th>
      </tr></thead><tbody>
        {filtered.map(r => {
          const curColors = TIER_COLORS[r.current_tier as OrgTier] || TIER_COLORS.member;
          const reqColors = TIER_COLORS[r.requested_tier as OrgTier] || TIER_COLORS.member;
          return (
            <tr key={r.id} className="border-b hover:bg-gray-50">
              <td className="p-4">
                <div className="font-medium">{r.org_name}</div>
                <div className="text-xs text-gray-500">{r.requester_email}</div>
              </td>
              <td className="p-4"><Badge className={`${curColors.bg} ${curColors.text} border ${curColors.border}`}>{TIER_LABELS[r.current_tier as OrgTier] || r.current_tier}</Badge></td>
              <td className="p-4"><Badge className={`${reqColors.bg} ${reqColors.text} border ${reqColors.border}`}>{TIER_LABELS[r.requested_tier as OrgTier] || r.requested_tier}</Badge></td>
              <td className="p-4"><Badge className={statusColors[r.status] || 'bg-gray-100 text-gray-800'}>{r.status.replace('_', ' ')}</Badge></td>
              <td className="p-4 text-gray-500 text-sm">{new Date(r.created_at).toLocaleDateString()}</td>
              <td className="p-4">
                <Button size="sm" variant="ghost" onClick={() => { setSelectedReq(r); setAdminNotes(r.admin_notes || ''); setInvoiceRef(r.invoice_reference || ''); }}>
                  <Eye className="h-4 w-4" />
                </Button>
              </td>
            </tr>
          );
        })}
        {filtered.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-gray-400">No sponsorship requests found</td></tr>}
      </tbody></table></div></CardContent></Card>

      {/* Detail / Action Dialog */}
      <Dialog open={!!selectedReq} onOpenChange={() => setSelectedReq(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Sponsorship Request</DialogTitle>
            <DialogDescription>Review and process this sponsorship upgrade request.</DialogDescription>
          </DialogHeader>
          {selectedReq && (
            <div className="space-y-4 mt-2">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><strong>Organization:</strong> {selectedReq.org_name}</div>
                <div><strong>Requester:</strong> {selectedReq.requester_email}</div>
                <div><strong>Current Tier:</strong> {TIER_LABELS[selectedReq.current_tier as OrgTier] || selectedReq.current_tier}</div>
                <div><strong>Requested Tier:</strong> {TIER_LABELS[selectedReq.requested_tier as OrgTier] || selectedReq.requested_tier}</div>
                <div><strong>Already Paid:</strong> {selectedReq.amount_already_paid > 0 ? `€${selectedReq.amount_already_paid}` : '—'}</div>
                <div><strong>Amount Due:</strong> {selectedReq.amount_due ? `€${selectedReq.amount_due}` : 'TBD'}</div>
                <div><strong>Status:</strong> <Badge className={statusColors[selectedReq.status] || ''}>{selectedReq.status.replace('_', ' ')}</Badge></div>
                <div><strong>Date:</strong> {new Date(selectedReq.created_at).toLocaleString()}</div>
              </div>
              <div className="space-y-2">
                <Label>Invoice Reference</Label>
                <Input value={invoiceRef} onChange={e => setInvoiceRef(e.target.value)} placeholder="e.g. INV-2026-001" />
              </div>
              <div className="space-y-2">
                <Label>Admin Notes</Label>
                <Textarea value={adminNotes} onChange={e => setAdminNotes(e.target.value)} rows={3} placeholder="Internal notes..." />
              </div>
              {/* Action buttons based on current status */}
              <div className="flex flex-wrap gap-2 pt-2 border-t">
                {selectedReq.status === 'pending' && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => updateRequestStatus(selectedReq.id, 'invoice_sent')}>
                      Mark Invoice Sent
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => updateRequestStatus(selectedReq.id, 'rejected')}>
                      Reject
                    </Button>
                  </>
                )}
                {selectedReq.status === 'invoice_sent' && (
                  <>
                    <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => updateRequestStatus(selectedReq.id, 'paid')}>
                      Confirm Payment
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => updateRequestStatus(selectedReq.id, 'rejected')}>
                      Reject
                    </Button>
                  </>
                )}
                {selectedReq.status === 'paid' && (
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => updateRequestStatus(selectedReq.id, 'approved')}>
                    Approve &amp; Assign Tier
                  </Button>
                )}
                {(selectedReq.status === 'rejected' || selectedReq.status === 'approved') && (
                  <p className="text-sm text-gray-500 italic">This request has been {selectedReq.status}.</p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
