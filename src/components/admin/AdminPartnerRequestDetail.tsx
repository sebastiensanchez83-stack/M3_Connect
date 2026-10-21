import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Loader2, CheckCircle, XCircle, MessageSquare, User, Anchor,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CardLink } from '@/components/home/dashboard/DashboardKit';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { sendNotification } from '@/lib/notifications';
import type { PartnerRequest } from './types';
import { AdminDetailHeader, AdminLoading, AdminPanel, AdminStatus, AdminStatusPill, ADMIN_BTN_DANGER, ADMIN_BTN_PRIMARY } from './AdminUI';
import { ActionLine } from './AdminStyleKit';
import { Field } from './v2/MembersKit';

/**
 * One connection request (/admin/partner-requests/:id): a service provider asks to be introduced
 * to a marina. Refonte admin style (Oct 2026): who asked, who it is for, the message, and the two
 * decisions, each saying what it sends and asking first. Same reads and writes as before, except
 * the sector: sectors has no `name` column (it is `label`), so the sector never showed.
 */

type EnrichedRequest = PartnerRequest & {
  partner_name?: string;
  partner_email?: string;
  marina_name?: string;
  marina_email?: string;
  partner_org_name?: string;
  marina_org_name?: string;
  sector_name?: string;
};

/** partner_requests.status, in plain words. */
const REQUEST_STATUS_LABEL: Record<string, string> = {
  pending: 'Waiting',
  accepted: 'Accepted',
  rejected: 'Refused',
  withdrawn: 'Withdrawn',
};

export function AdminPartnerRequestDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [request, setRequest] = useState<EnrichedRequest | null>(null);

  useEffect(() => {
    if (id) loadRequest(id);
  }, [id]);

  const loadRequest = async (reqId: string) => {
    setLoading(true);

    const { data, error } = await supabase
      .from('partner_requests')
      .select('*')
      .eq('id', reqId)
      .single();

    if (error || !data) {
      toast({ title: 'Request not found', variant: 'destructive' });
      navigate('/admin/partner-requests');
      return;
    }

    const row = data as PartnerRequest;

    // Fetch profile info for both users
    const userIds = [row.partner_user_id, row.marina_user_id];
    const nameMap: Record<string, { name: string; email: string }> = {};
    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, first_name, last_name, email')
      .in('user_id', userIds);

    (profiles || []).forEach((p: any) => {
      nameMap[p.user_id] = {
        name: `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.user_id.slice(0, 8),
        email: p.email || '',
      };
    });

    // Fetch org names
    const orgIds = [row.partner_organization_id, row.marina_organization_id].filter(Boolean) as string[];
    const orgMap: Record<string, string> = {};
    if (orgIds.length > 0) {
      const { data: orgs } = await supabase
        .from('organizations')
        .select('id, name')
        .in('id', orgIds);
      (orgs || []).forEach((o: any) => { orgMap[o.id] = o.name; });
    }

    // Fetch sector name (the column is `label`; `name` does not exist and made this read fail)
    let sectorName = '';
    if (row.sector_id) {
      const { data: sector } = await supabase
        .from('sectors')
        .select('label')
        .eq('id', row.sector_id)
        .single();
      sectorName = sector?.label || '';
    }

    setRequest({
      ...row,
      partner_name: nameMap[row.partner_user_id]?.name || row.partner_user_id.slice(0, 8),
      partner_email: nameMap[row.partner_user_id]?.email || '',
      marina_name: nameMap[row.marina_user_id]?.name || row.marina_user_id.slice(0, 8),
      marina_email: nameMap[row.marina_user_id]?.email || '',
      partner_org_name: row.partner_organization_id ? orgMap[row.partner_organization_id] || '' : '',
      marina_org_name: row.marina_organization_id ? orgMap[row.marina_organization_id] || '' : '',
      sector_name: sectorName,
    });

    setLoading(false);
  };

  const handleAccept = async () => {
    if (!request || !id) return;
    setSaving(true);

    const { error } = await supabase
      .from('partner_requests')
      .update({ status: 'accepted' })
      .eq('id', id);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      setSaving(false);
      return;
    }

    // Single intro email that puts BOTH parties on one thread. The edge function
    // merges recipients (requester + acceptor) only when acceptor_email is set —
    // so this must be ONE call, not one per party (two calls => two separate
    // single-recipient emails, no shared thread, Victor CC'd twice).
    sendNotification({
      type: 'partner_request_accepted',
      userId: request.partner_user_id,
      data: {
        marina_name: request.marina_name || 'A marina',
        acceptor_email: request.marina_email || '',
        acceptor_name: request.marina_name || '',
      },
    });

    toast({ title: 'Request accepted', description: `${request.partner_name} and ${request.marina_name} are introduced by e-mail.` });
    setSaving(false);
    loadRequest(id);
  };

  const handleReject = async () => {
    if (!request || !id) return;
    setSaving(true);

    const { error } = await supabase
      .from('partner_requests')
      .update({ status: 'rejected' })
      .eq('id', id);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      setSaving(false);
      return;
    }

    sendNotification({
      type: 'partner_request_rejected',
      userId: request.partner_user_id,
      data: { marina_name: request.marina_name || 'A marina' },
    });

    toast({ title: 'Request refused' });
    setSaving(false);
    loadRequest(id);
  };

  if (loading) return <AdminLoading />;

  if (!request) return null;

  const daysSince = Math.floor((Date.now() - new Date(request.created_at).getTime()) / 86400000);
  const sentOn = new Date(request.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const statusText = REQUEST_STATUS_LABEL[request.status] ?? undefined;

  // Both decisions send an e-mail at once: ask first (presentation; the handlers are unchanged).
  const confirmAccept = () => {
    if (!window.confirm(t('adm2.b2bReq.acceptConfirm', 'Accept this request?\n\n{{partner}} and {{marina}} receive one e-mail that introduces them to each other.', { partner: request.partner_name, marina: request.marina_name }))) return;
    handleAccept();
  };
  const confirmReject = () => {
    if (!window.confirm(t('adm2.b2bReq.rejectConfirm', 'Refuse this request?\n\n{{partner}} receives an e-mail saying that {{marina}} declined.', { partner: request.partner_name, marina: request.marina_name }))) return;
    handleReject();
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <AdminDetailHeader
        back={{ to: '/admin/partner-requests', label: t('adm2.b2bReq.back', 'Back to connection requests') }}
        title={`${request.partner_name} → ${request.marina_name}`}
        badges={<AdminStatus status={request.status} label={statusText} />}
        subtitle={t('adm2.b2bReq.subtitle', 'Connection request sent {{date}} ({{count}} days ago)', { date: sentOn, count: daysSince })}
      />

      {/* Decision first, when there is one to take */}
      {request.status === 'pending' && (
        <AdminPanel
          icon={CheckCircle}
          title={t('adm2.b2bReq.decide', 'Your decision')}
          description={t('adm2.b2bReq.decideDesc', 'Each button sends an e-mail at once; it asks you first.')}
          className="border-gold"
        >
          <div className="space-y-4">
            <ActionLine text={t('adm2.b2bReq.acceptText', 'Accept: both receive one e-mail that introduces them to each other.')}>
              <Button variant="secondary" size="sm" className={ADMIN_BTN_PRIMARY} onClick={confirmAccept} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle className="mr-2 h-4 w-4" aria-hidden="true" />}
                {t('adm2.b2bReq.acceptBtn', 'Accept and introduce them')}
              </Button>
            </ActionLine>
            <ActionLine divided text={t('adm2.b2bReq.rejectText', 'Refuse: the service provider receives an e-mail saying the marina declined.')}>
              <Button variant="outline" size="sm" className={ADMIN_BTN_DANGER} onClick={confirmReject} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <XCircle className="mr-2 h-4 w-4" aria-hidden="true" />}
                {t('adm2.b2bReq.rejectBtn', 'Refuse the request')}
              </Button>
            </ActionLine>
          </div>
        </AdminPanel>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <AdminPanel icon={User} title={t('adm2.b2bReq.from', 'Who asked (service provider)')}>
          <dl className="grid gap-4">
            <Field label={t('adm2.b2bReq.name', 'Name')}>{request.partner_name}</Field>
            <Field label={t('adm2.b2bReq.email', 'E-mail')}>{request.partner_email}</Field>
            {request.partner_org_name && <Field label={t('adm2.b2bReq.company', 'Company')}>{request.partner_org_name}</Field>}
          </dl>
          <div className="mt-5 flex flex-wrap gap-2">
            <CardLink to={`/admin/people/${request.partner_user_id}`}>{t('adm2.b2bReq.openPerson', 'Open their page')}</CardLink>
            {request.partner_organization_id && <CardLink to={`/admin/companies/${request.partner_organization_id}`}>{t('adm2.b2bReq.openCompany', 'Open the company')}</CardLink>}
          </div>
        </AdminPanel>

        <AdminPanel icon={Anchor} title={t('adm2.b2bReq.to', 'Who it is for (marina)')}>
          <dl className="grid gap-4">
            <Field label={t('adm2.b2bReq.name', 'Name')}>{request.marina_name}</Field>
            <Field label={t('adm2.b2bReq.email', 'E-mail')}>{request.marina_email}</Field>
            {request.marina_org_name && <Field label={t('adm2.b2bReq.company', 'Company')}>{request.marina_org_name}</Field>}
          </dl>
          <div className="mt-5 flex flex-wrap gap-2">
            <CardLink to={`/admin/people/${request.marina_user_id}`}>{t('adm2.b2bReq.openPerson', 'Open their page')}</CardLink>
            {request.marina_organization_id && <CardLink to={`/admin/companies/${request.marina_organization_id}`}>{t('adm2.b2bReq.openCompany', 'Open the company')}</CardLink>}
          </div>
        </AdminPanel>
      </div>

      {/* Request Details */}
      <AdminPanel icon={MessageSquare} title={t('adm2.b2bReq.request', 'The request')}>
        <dl className="grid gap-4 sm:grid-cols-3">
          <Field label={t('adm2.b2bReq.status', 'Status')}><AdminStatus status={request.status} label={statusText} /></Field>
          <Field label={t('adm2.b2bReq.sentOn', 'Sent')}>{sentOn}</Field>
          {request.sector_name && <Field label={t('adm2.b2bReq.sector', 'Sector')}><AdminStatusPill>{request.sector_name}</AdminStatusPill></Field>}
        </dl>
        {request.message && (
          <div className="mt-5">
            <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-meta">{t('adm2.b2bReq.message', 'Their message')}</p>
            <p className="mt-1.5 whitespace-pre-wrap rounded-xl bg-page p-4 text-[15px] leading-6 text-ink [overflow-wrap:anywhere]">{request.message}</p>
          </div>
        )}
      </AdminPanel>
    </div>
  );
}
