import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, Save, Loader2, Building2, DollarSign, FileText, ExternalLink, Flag,
} from 'lucide-react';
import { TIER_LABELS, OrgTier } from '@/types/database';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { sendNotification } from '@/lib/notifications';
import type { SponsorshipRequestRow } from './types';
import {
  AdminDetailHeader, AdminLoading, AdminPanel, ADMIN_BTN, ADMIN_BTN_DANGER, ADMIN_BTN_PRIMARY,
} from './AdminUI';
import { Field, Note } from './v2/MembersKit';
import { ADMIN_INPUT, DetailList, FormField } from './v2/ContentFormKit';
import { SponsorshipRequestStatus } from './AdminSponsorships';

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
      navigate('/admin/sponsorship-requests');
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
            amount: amountDue ? `€${amountDue}` : '',
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

  if (loading) return <AdminLoading />;

  if (!request) return null;

  const tierName = (tier: string) => TIER_LABELS[tier as OrgTier] || tier;
  const spin = <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />;

  return (
    <div className="mx-auto max-w-4xl">
      <AdminDetailHeader
        back={{ to: '/admin/sponsorship-requests', label: t('adminContent.spReq.back', 'Back to Old sponsorship requests') }}
        title={request.org_name}
        badges={<SponsorshipRequestStatus status={request.status} />}
        subtitle={t('adminContent.spReq.subtitle', 'Asks to move from {{from}} to {{to}}', { from: tierName(request.current_tier), to: tierName(request.requested_tier) })}
      />

      <div className="space-y-6">
        {/* Request Details */}
        <AdminPanel title={t('adminContent.spReq.details', 'The request')} icon={Building2}>
          <DetailList>
            <Field label={t('adminContent.spReq.company', 'Company')}>{request.org_name}</Field>
            <Field label={t('adminContent.spReq.askedBy', 'Asked by')}>{request.requester_email}</Field>
            <Field label={t('adminContent.spReq.colCurrent', 'Plan now')}>{tierName(request.current_tier)}</Field>
            <Field label={t('adminContent.spReq.colAsked', 'Plan asked for')}>
              <span className="font-semibold text-navy">{tierName(request.requested_tier)}</span>
            </Field>
            <Field label={t('adminContent.spReq.alreadyPaid', 'Already paid')}>{request.amount_already_paid > 0 ? `€${request.amount_already_paid}` : '--'}</Field>
            <Field label={t('adminContent.spReq.status', 'Status')}><SponsorshipRequestStatus status={request.status} /></Field>
            <Field label={t('adminContent.spReq.created', 'Sent on')}>{new Date(request.created_at).toLocaleString()}</Field>
            {request.payment_confirmed_at && (
              <Field label={t('adminContent.spReq.paidOn', 'Payment confirmed on')}>{new Date(request.payment_confirmed_at).toLocaleString()}</Field>
            )}
          </DetailList>
        </AdminPanel>

        {/* Invoice URL (if uploaded by org) */}
        {invoiceUrl && (
          <div className="flex flex-col gap-3 rounded-card border border-teal/25 bg-foam px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-[15px] font-semibold leading-6 text-navy">
              <FileText className="h-4 w-4 shrink-0 text-teal" aria-hidden="true" />
              {t('adminContent.spReq.invoiceUploaded', 'The company uploaded an invoice')}
            </p>
            <a
              href={invoiceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex min-h-11 items-center gap-1.5 rounded-pill border border-navy/55 bg-white px-4 text-[15px] font-semibold text-navy transition-colors hover:border-navy hover:bg-chip focus:outline-none focus-visible:shadow-focus"
            >
              {t('adminContent.spReq.openInvoice', 'Open the invoice (new tab)')}
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
        )}

        {/* Editable Fields */}
        <AdminPanel
          title={t('adminContent.spReq.invoicePanel', 'Invoice and notes')}
          icon={DollarSign}
          description={t('adminContent.spReq.invoicePanelHint', 'The invoice number and the amount are added to the message the company receives. The notes are not shown to the company.')}
        >
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <FormField label={t('adminContent.spReq.invoiceRef', 'Invoice number')} htmlFor="spr-invoice-ref">
                <Input id="spr-invoice-ref" value={invoiceRef} onChange={e => setInvoiceRef(e.target.value)} placeholder="INV-2024-001" className={ADMIN_INPUT} />
              </FormField>
              <FormField label={t('adminContent.spReq.amountDue', 'Amount due (€)')} htmlFor="spr-amount">
                <Input id="spr-amount" type="number" value={amountDue} onChange={e => setAmountDue(e.target.value)} placeholder="0" className={ADMIN_INPUT} />
              </FormField>
            </div>
            <FormField label={t('adminContent.spReq.notes', 'Notes for the M3 team')} htmlFor="spr-notes" hint={t('adminContent.spReq.notesHint', 'Not shown to the company on the site.')}>
              <Textarea id="spr-notes" value={adminNotes} onChange={e => setAdminNotes(e.target.value)} rows={3} placeholder="Internal notes..." className="bg-white" />
            </FormField>
            <Button variant="outline" onClick={saveFields} disabled={saving} className={ADMIN_BTN + ' gap-1.5'}>
              {saving ? spin : <Save className="h-4 w-4" aria-hidden="true" />}
              {t('adminContent.spReq.saveFields', 'Save the invoice details and notes')}
            </Button>
          </div>
        </AdminPanel>

        {/* Action Buttons */}
        <AdminPanel title={t('adminContent.spReq.next', 'Next step')} icon={Flag}>
          {request.status === 'pending' && (
            <>
              <p className="mb-4 text-[14px] leading-5 text-meta">{t('adminContent.spReq.pendingHint', 'Send the invoice to the company, or refuse the request. The person who asked is notified either way.')}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => updateStatus('invoice_sent')} disabled={saving} className={ADMIN_BTN_PRIMARY + ' gap-1.5'}>
                  {saving ? spin : <FileText className="h-4 w-4" aria-hidden="true" />}
                  {t('adminContent.spReq.sendInvoice', 'Send the invoice')}
                </Button>
                <Button variant="outline" onClick={() => updateStatus('rejected')} disabled={saving} className={ADMIN_BTN_DANGER}>
                  {t('adminContent.spReq.reject', 'Refuse the request')}
                </Button>
              </div>
            </>
          )}
          {request.status === 'invoice_sent' && (
            <>
              <p className="mb-4 text-[14px] leading-5 text-meta">{t('adminContent.spReq.invoicedHint', 'Once the money has arrived, confirm the payment. The person who asked is notified.')}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => updateStatus('paid')} disabled={saving} className={ADMIN_BTN_PRIMARY + ' gap-1.5'}>
                  {saving ? spin : <DollarSign className="h-4 w-4" aria-hidden="true" />}
                  {t('adminContent.spReq.confirmPayment', 'Confirm the payment')}
                </Button>
                <Button variant="outline" onClick={() => updateStatus('rejected')} disabled={saving} className={ADMIN_BTN_DANGER}>
                  {t('adminContent.spReq.reject', 'Refuse the request')}
                </Button>
              </div>
            </>
          )}
          {request.status === 'paid' && (
            <>
              <p className="mb-4 text-[14px] leading-5 text-meta">{t('adminContent.spReq.paidHint', 'Approving moves the company to {{tier}} and notifies all its members.', { tier: tierName(request.requested_tier) })}</p>
              <Button variant="secondary" onClick={() => updateStatus('approved')} disabled={saving} className={ADMIN_BTN_PRIMARY + ' gap-1.5'}>
                {saving ? spin : <ArrowLeft className="h-4 w-4 rotate-180" aria-hidden="true" />}
                {t('adminContent.spReq.approve', 'Approve the upgrade')}
              </Button>
            </>
          )}
          {(request.status === 'rejected' || request.status === 'approved') && (
            <Note>{t('adminContent.spReq.done', 'This request has been {{status}}. There is nothing more to do.', { status: request.status })}</Note>
          )}
        </AdminPanel>
      </div>
    </div>
  );
}
