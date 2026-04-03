import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, Save, Loader2, Building2, DollarSign, FileText, ExternalLink,
} from 'lucide-react';
import { TIER_LABELS, TIER_COLORS, OrgTier } from '@/types/database';
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
import type { SponsorshipRequestRow } from './types';

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  invoice_sent: 'bg-blue-100 text-blue-800',
  paid: 'bg-green-100 text-green-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
};

export function AdminSponsorshipDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [request, setRequest] = useState<SponsorshipRequestRow | null>(null);
  const [invoiceUrl, setInvoiceUrl] = useState<string | null>(null);

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
      .from('sponsorship_requests')
      .select('*, organizations:organization_id(name), profiles!sponsorship_requests_requested_by_profiles_fkey(email)')
      .eq('id', reqId)
      .single();

    if (error || !data) {
      toast({ title: 'Sponsorship request not found', variant: 'destructive' });
      navigate('/admin/sponsorships');
      return;
    }

    const row: SponsorshipRequestRow = {
      ...data,
      org_name: (data.organizations as Record<string, string> | null)?.name || '--',
      requester_email: (data.profiles as Record<string, string> | null)?.email || '--',
    } as SponsorshipRequestRow;

    setRequest(row);
    setAdminNotes(row.admin_notes || '');
    setInvoiceRef(row.invoice_reference || '');
    setAmountDue(row.amount_due != null ? String(row.amount_due) : '');
    setInvoiceUrl((data as Record<string, unknown>).invoice_url as string || null);
    setLoading(false);
  };

  const updateStatus = async (status: string) => {
    if (!request) return;
    setSaving(true);

    const updates: Record<string, unknown> = { status };
    if (status === 'paid') updates.payment_confirmed_at = new Date().toISOString();
    if (invoiceRef) updates.invoice_reference = invoiceRef;
    if (adminNotes) updates.admin_notes = adminNotes;
    if (amountDue) updates.amount_due = parseFloat(amountDue);

    await supabase.from('sponsorship_requests').update(updates).eq('id', request.id);

    // If approved, update organization tier and notify ALL org members
    if (status === 'approved') {
      const { data: tierConfig } = await supabase
        .from('organization_tier_config')
        .select('max_seats')
        .eq('tier', request.requested_tier)
        .single();
      await supabase
        .from('organizations')
        .update({ tier: request.requested_tier, max_seats: tierConfig?.max_seats || 5 })
        .eq('id', request.organization_id);

      const { data: orgMembers } = await supabase
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', request.organization_id);
      const tierLabel = TIER_LABELS[request.requested_tier as OrgTier] || request.requested_tier;
      (orgMembers || []).forEach((m: { user_id: string }) => {
        sendNotification({
          type: 'sponsorship_approved',
          userId: m.user_id,
          data: { requested_tier: tierLabel },
        });
      });
      toast({ title: `Sponsorship approved - tier upgraded to ${tierLabel}` });
    } else {
      // Notify requester
      const notifMap: Record<string, 'sponsorship_invoice_sent' | 'sponsorship_paid' | 'sponsorship_rejected'> = {
        invoice_sent: 'sponsorship_invoice_sent',
        paid: 'sponsorship_paid',
        rejected: 'sponsorship_rejected',
      };
      const notifType = notifMap[status];
      if (notifType) {
        sendNotification({
          type: notifType,
          userId: request.requested_by,
          data: {
            requested_tier: TIER_LABELS[request.requested_tier as OrgTier] || request.requested_tier,
            invoice_ref: invoiceRef,
            amount: amountDue ? `\u20AC${amountDue}` : '',
          },
        });
      }
      toast({ title: `Status updated to ${status.replace('_', ' ')}` });
    }

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
      await supabase.from('sponsorship_requests').update(updates).eq('id', request.id);
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

  const curColors = TIER_COLORS[request.current_tier as OrgTier] || TIER_COLORS.member;
  const reqColors = TIER_COLORS[request.requested_tier as OrgTier] || TIER_COLORS.member;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin/sponsorships')} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" /> Sponsorships
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
            <div>
              <span className="text-gray-500 font-medium">Requester:</span>
              <span className="ml-2 text-gray-900">{request.requester_email}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500 font-medium">Current Tier:</span>
              <Badge className={`${curColors.bg} ${curColors.text} border ${curColors.border}`}>
                {TIER_LABELS[request.current_tier as OrgTier] || request.current_tier}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500 font-medium">Requested Tier:</span>
              <Badge className={`${reqColors.bg} ${reqColors.text} border ${reqColors.border}`}>
                {TIER_LABELS[request.requested_tier as OrgTier] || request.requested_tier}
              </Badge>
            </div>
            <div>
              <span className="text-gray-500 font-medium">Already Paid:</span>
              <span className="ml-2 text-gray-900">{request.amount_already_paid > 0 ? `\u20AC${request.amount_already_paid}` : '--'}</span>
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
          </div>
        </CardContent>
      </Card>

      {/* Invoice URL (if uploaded by org) */}
      {invoiceUrl && (
        <Card className="border-0 shadow-sm bg-blue-50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-medium text-blue-800">Invoice uploaded by organization</span>
              <a
                href={invoiceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> View Invoice
              </a>
            </div>
          </CardContent>
        </Card>
      )}

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
              <Label>Amount Due (\u20AC)</Label>
              <Input type="number" value={amountDue} onChange={e => setAmountDue(e.target.value)} placeholder="0" />
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
                <Button size="sm" variant="outline" onClick={() => updateStatus('invoice_sent')} disabled={saving} className="gap-1.5">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                  Send Invoice
                </Button>
                <Button size="sm" variant="destructive" onClick={() => updateStatus('rejected')} disabled={saving}>
                  Reject
                </Button>
              </>
            )}
            {request.status === 'invoice_sent' && (
              <>
                <Button size="sm" className="bg-green-600 hover:bg-green-700 gap-1.5" onClick={() => updateStatus('paid')} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <DollarSign className="h-4 w-4" />}
                  Confirm Payment
                </Button>
                <Button size="sm" variant="destructive" onClick={() => updateStatus('rejected')} disabled={saving}>
                  Reject
                </Button>
              </>
            )}
            {request.status === 'paid' && (
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 gap-1.5" onClick={() => updateStatus('approved')} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeft className="h-4 w-4 rotate-180" />}
                Approve Upgrade
              </Button>
            )}
            {(request.status === 'rejected' || request.status === 'approved') && (
              <p className="text-sm text-gray-500 italic">This request has been {request.status}. No further actions available.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
