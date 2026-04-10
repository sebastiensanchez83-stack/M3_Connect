import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, Save, Loader2, Building2, DollarSign, FileText, Calendar,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { sendNotification } from '@/lib/notifications';

interface ExpositionRequest {
  id: string; organization_id: string; event_id: string; requested_by: string;
  status: string; admin_notes: string | null; invoice_reference: string | null;
  amount_due: number | null; payment_confirmed_at: string | null; created_at: string;
  org_name: string; event_title: string; requester_email: string;
}

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-blue-100 text-blue-800',
  invoice_sent: 'bg-indigo-100 text-indigo-800',
  paid: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
};

export function AdminExpositionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [request, setRequest] = useState<ExpositionRequest | null>(null);

  // Editable
  const [adminNotes, setAdminNotes] = useState('');
  const [invoiceRef, setInvoiceRef] = useState('');
  const [amountDue, setAmountDue] = useState<string>('');

  useEffect(() => {
    if (id) loadRequest(id);
  }, [id]);

  const loadRequest = async (reqId: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from('exposition_requests')
      .select('*, organizations:organization_id(name), events:event_id(title), profiles!exposition_requests_requested_by_profiles_fkey(email)')
      .eq('id', reqId)
      .single();

    if (error || !data) {
      toast({ title: 'Exposition request not found', variant: 'destructive' });
      navigate('/admin/expositions');
      return;
    }

    const row: ExpositionRequest = {
      ...(data as Record<string, unknown>),
      org_name: (data.organizations as Record<string, string> | null)?.name || '--',
      event_title: (data.events as Record<string, string> | null)?.title || '--',
      requester_email: (data.profiles as Record<string, string> | null)?.email || '--',
    } as ExpositionRequest;

    setRequest(row);
    setAdminNotes(row.admin_notes || '');
    setInvoiceRef(row.invoice_reference || '');
    setAmountDue(row.amount_due != null ? String(row.amount_due) : '');
    setLoading(false);
  };

  const updateStatus = async (status: string) => {
    if (!request) return;
    setSaving(true);

    const updates: Record<string, unknown> = { status };
    if (invoiceRef) updates.invoice_reference = invoiceRef;
    if (adminNotes) updates.admin_notes = adminNotes;
    if (amountDue) updates.amount_due = parseFloat(amountDue);
    if (status === 'paid') updates.payment_confirmed_at = new Date().toISOString();

    await supabase.from('exposition_requests').update(updates).eq('id', request.id);

    // If paid, auto-create event registration as exhibitor
    if (status === 'paid') {
      await supabase.from('event_registrations').insert({
        event_id: request.event_id,
        user_id: request.requested_by,
        organization_id: request.organization_id,
        registration_type: 'exhibitor',
        payment_status: 'paid',
        amount_due: request.amount_due || 1400,
        invoice_reference: invoiceRef || request.invoice_reference,
        registered_by: request.requested_by,
      });
    }

    // Send notification
    const notifMap: Record<string, 'exposition_approved' | 'exposition_invoice_sent' | 'exposition_paid' | 'exposition_rejected'> = {
      approved: 'exposition_approved',
      invoice_sent: 'exposition_invoice_sent',
      paid: 'exposition_paid',
      rejected: 'exposition_rejected',
    };
    const notifType = notifMap[status];
    if (notifType) {
      sendNotification({
        type: notifType,
        userId: request.requested_by,
        data: {
          event_title: request.event_title,
          invoice_ref: invoiceRef,
          amount: `€${amountDue || request.amount_due || 1400}`,
        },
      });
    }

    toast({ title: `Status updated to ${status.replace('_', ' ')}` });
    setSaving(false);
    loadRequest(request.id);
  };

  const saveFields = async () => {
    if (!request) return;
    setSaving(true);
    const updates: Record<string, unknown> = {};
    if (adminNotes !== (request.admin_notes || '')) updates.admin_notes = adminNotes;
    if (invoiceRef !== (request.invoice_reference || '')) updates.invoice_reference = invoiceRef;
    if (amountDue !== String(request.amount_due || '')) updates.amount_due = amountDue ? parseFloat(amountDue) : null;

    if (Object.keys(updates).length > 0) {
      await supabase.from('exposition_requests').update(updates).eq('id', request.id);
      toast({ title: 'Changes saved' });
      loadRequest(request.id);
    } else {
      toast({ title: 'No changes to save' });
    }
    setSaving(false);
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );

  if (!request) return null;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin/expositions')} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" /> Expositions
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <h1 className="text-xl font-bold text-gray-900">{request.org_name}</h1>
          <Badge className={statusColors[request.status] || 'bg-gray-100 text-gray-800'}>
            {request.status.replace('_', ' ')}
          </Badge>
        </div>
      </div>

      {/* Request Details */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
            <Building2 className="h-4 w-4 text-blue-500" /> Request Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500 font-medium">Organization:</span>
              <span className="ml-2 text-gray-900 font-semibold">{request.org_name}</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5 text-gray-400" />
              <span className="text-gray-500 font-medium">Event:</span>
              <span className="ml-1 text-gray-900">{request.event_title}</span>
            </div>
            <div>
              <span className="text-gray-500 font-medium">Requester:</span>
              <span className="ml-2 text-gray-900">{request.requester_email}</span>
            </div>
            <div>
              <span className="text-gray-500 font-medium">Amount Due:</span>
              <span className="ml-2 text-gray-900 font-semibold">€{request.amount_due || 1400}</span>
            </div>
            <div>
              <span className="text-gray-500 font-medium">Status:</span>
              <Badge className={`ml-2 ${statusColors[request.status] || ''}`}>{request.status.replace('_', ' ')}</Badge>
            </div>
            <div>
              <span className="text-gray-500 font-medium">Created:</span>
              <span className="ml-2 text-gray-900">{new Date(request.created_at).toLocaleString()}</span>
            </div>
            {request.payment_confirmed_at && (
              <div>
                <span className="text-gray-500 font-medium">Payment Confirmed:</span>
                <span className="ml-2 text-gray-900">{new Date(request.payment_confirmed_at).toLocaleString()}</span>
              </div>
            )}
            {request.invoice_reference && (
              <div>
                <span className="text-gray-500 font-medium">Invoice Ref:</span>
                <span className="ml-2 text-gray-900">{request.invoice_reference}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Editable Fields */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-emerald-500" /> Editable Fields
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Invoice Reference</Label>
              <Input value={invoiceRef} onChange={e => setInvoiceRef(e.target.value)} placeholder="INV-2024-001" />
            </div>
            <div className="space-y-2">
              <Label>Amount Due (€)</Label>
              <Input type="number" value={amountDue} onChange={e => setAmountDue(e.target.value)} placeholder="1400" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Admin Notes</Label>
            <Textarea value={adminNotes} onChange={e => setAdminNotes(e.target.value)} rows={3} placeholder="Internal notes..." />
          </div>
          <Button size="sm" variant="outline" onClick={saveFields} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Changes
          </Button>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-gray-700">Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {request.status === 'pending' && (
              <>
                <Button size="sm" variant="outline" onClick={() => updateStatus('approved')} disabled={saving} className="gap-1.5">
                  Approve
                </Button>
                <Button size="sm" variant="destructive" onClick={() => updateStatus('rejected')} disabled={saving}>
                  Reject
                </Button>
              </>
            )}
            {request.status === 'approved' && (
              <Button size="sm" variant="outline" onClick={() => updateStatus('invoice_sent')} disabled={saving} className="gap-1.5">
                <FileText className="h-4 w-4" /> Mark Invoice Sent
              </Button>
            )}
            {request.status === 'invoice_sent' && (
              <Button size="sm" className="bg-green-600 hover:bg-green-700 gap-1.5" onClick={() => updateStatus('paid')} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <DollarSign className="h-4 w-4" />}
                Confirm Payment
              </Button>
            )}
            {(request.status === 'paid' || request.status === 'rejected') && (
              <p className="text-sm text-gray-500 italic">This request has been {request.status}. No further actions available.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
