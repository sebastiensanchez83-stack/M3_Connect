import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Save, Loader2, Building2, DollarSign, FileText, Flag, Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { sendNotification } from '@/lib/notifications';
import {
  AdminDetailHeader, AdminLoading, AdminPanel, ADMIN_BTN, ADMIN_BTN_DANGER, ADMIN_BTN_PRIMARY,
} from './AdminUI';
import { Field, Note } from './v2/MembersKit';
import { ADMIN_INPUT, DetailList, FormField } from './v2/ContentFormKit';
import { ExpositionStatus } from './AdminExpositions';

interface ExpositionRequest {
  id: string; organization_id: string; event_id: string; requested_by: string;
  status: string; admin_notes: string | null; invoice_reference: string | null;
  amount_due: number | null; payment_confirmed_at: string | null; created_at: string;
  org_name: string; event_title: string; requester_email: string;
}

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

  if (loading) return <AdminLoading />;

  if (!request) return null;

  const spin = <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />;

  return (
    <div className="mx-auto max-w-4xl">
      <AdminDetailHeader
        back={{ to: '/admin/expositions', label: t('adminContent.expo.back', 'Back to Old exposition requests') }}
        title={request.org_name}
        badges={<ExpositionStatus status={request.status} />}
        subtitle={t('adminContent.expo.subtitle', 'Asks for an exhibition stand at {{event}}', { event: request.event_title })}
      />

      <div className="space-y-6">
        {/* Request Details */}
        <AdminPanel title={t('adminContent.expo.details', 'The request')} icon={Building2}>
          <DetailList>
            <Field label={t('adminContent.expo.colCompany', 'Company')}>{request.org_name}</Field>
            <Field label={t('adminContent.expo.colEvent', 'Event')}>{request.event_title}</Field>
            <Field label={t('adminContent.expo.askedBy', 'Asked by')}>{request.requester_email}</Field>
            <Field label={t('adminContent.expo.amountDue', 'Amount due')}>
              <span className="font-semibold text-navy">€{request.amount_due || 1400}</span>
            </Field>
            <Field label={t('adminContent.expo.colStatus', 'Status')}><ExpositionStatus status={request.status} /></Field>
            <Field label={t('adminContent.expo.created', 'Sent on')}>{new Date(request.created_at).toLocaleString()}</Field>
            {request.payment_confirmed_at && (
              <Field label={t('adminContent.expo.paidOn', 'Payment confirmed on')}>{new Date(request.payment_confirmed_at).toLocaleString()}</Field>
            )}
            {request.invoice_reference && (
              <Field label={t('adminContent.expo.invoiceRef', 'Invoice number')}>{request.invoice_reference}</Field>
            )}
          </DetailList>
        </AdminPanel>

        {/* Editable Fields */}
        <AdminPanel
          title={t('adminContent.expo.invoicePanel', 'Invoice and notes')}
          icon={DollarSign}
          description={t('adminContent.expo.invoicePanelHint', 'The invoice number and the amount are added to the message the company receives. The notes stay with the M3 team.')}
        >
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <FormField label={t('adminContent.expo.invoiceRef', 'Invoice number')} htmlFor="expo-invoice-ref">
                <Input id="expo-invoice-ref" value={invoiceRef} onChange={e => setInvoiceRef(e.target.value)} placeholder="INV-2024-001" className={ADMIN_INPUT} />
              </FormField>
              <FormField label={t('adminContent.expo.amountDueEur', 'Amount due (€)')} htmlFor="expo-amount" hint={t('adminContent.expo.amountHint', 'Empty: €1,400, the usual price of a stand.')}>
                <Input id="expo-amount" type="number" value={amountDue} onChange={e => setAmountDue(e.target.value)} placeholder="1400" className={ADMIN_INPUT} />
              </FormField>
            </div>
            <FormField label={t('adminContent.expo.notes', 'Notes for the M3 team')} htmlFor="expo-notes" hint={t('adminContent.expo.notesHint', 'Only the M3 team sees these notes.')}>
              <Textarea id="expo-notes" value={adminNotes} onChange={e => setAdminNotes(e.target.value)} rows={3} placeholder="Internal notes..." className="bg-white" />
            </FormField>
            <Button variant="outline" onClick={saveFields} disabled={saving} className={ADMIN_BTN + ' gap-1.5'}>
              {saving ? spin : <Save className="h-4 w-4" aria-hidden="true" />}
              {t('adminContent.expo.saveFields', 'Save the invoice details and notes')}
            </Button>
          </div>
        </AdminPanel>

        {/* Action Buttons */}
        <AdminPanel title={t('adminContent.expo.next', 'Next step')} icon={Flag}>
          {request.status === 'pending' && (
            <>
              <p className="mb-4 text-[14px] leading-5 text-meta">{t('adminContent.expo.pendingHint', 'Approve the stand, or refuse the request. The person who asked is notified either way.')}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => updateStatus('approved')} disabled={saving} className={ADMIN_BTN_PRIMARY + ' gap-1.5'}>
                  {saving ? spin : <Check className="h-4 w-4" aria-hidden="true" />}
                  {t('adminContent.expo.approve', 'Approve the stand')}
                </Button>
                <Button variant="outline" onClick={() => updateStatus('rejected')} disabled={saving} className={ADMIN_BTN_DANGER}>
                  {t('adminContent.expo.reject', 'Refuse the request')}
                </Button>
              </div>
            </>
          )}
          {request.status === 'approved' && (
            <>
              <p className="mb-4 text-[14px] leading-5 text-meta">{t('adminContent.expo.approvedHint', 'Once the invoice has gone out, mark it as sent. The person who asked is notified.')}</p>
              <Button variant="secondary" onClick={() => updateStatus('invoice_sent')} disabled={saving} className={ADMIN_BTN_PRIMARY + ' gap-1.5'}>
                {saving ? spin : <FileText className="h-4 w-4" aria-hidden="true" />}
                {t('adminContent.expo.markInvoiceSent', 'Mark the invoice as sent')}
              </Button>
            </>
          )}
          {request.status === 'invoice_sent' && (
            <>
              <p className="mb-4 text-[14px] leading-5 text-meta">{t('adminContent.expo.invoicedHint', 'Once the money has arrived, confirm the payment: the company is registered at the event as an exhibitor and the person who asked is notified.')}</p>
              <Button variant="secondary" onClick={() => updateStatus('paid')} disabled={saving} className={ADMIN_BTN_PRIMARY + ' gap-1.5'}>
                {saving ? spin : <DollarSign className="h-4 w-4" aria-hidden="true" />}
                {t('adminContent.expo.confirmPayment', 'Confirm the payment')}
              </Button>
            </>
          )}
          {(request.status === 'paid' || request.status === 'rejected') && (
            <Note>{t('adminContent.expo.done', 'This request has been {{status}}. There is nothing more to do.', { status: request.status })}</Note>
          )}
        </AdminPanel>
      </div>
    </div>
  );
}
