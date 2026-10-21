import { useState, useEffect, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Save, Loader2, CheckCircle, XCircle, ShieldCheck, MessageSquare,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { sendNotification } from '@/lib/notifications';
import type { WebinarRequest } from './types';
import {
  AdminDetailHeader, AdminLoading, AdminPanel, AdminStatusPill, ADMIN_BTN, ADMIN_BTN_DANGER, ADMIN_BTN_PRIMARY,
} from './AdminUI';
import { WebinarStatus } from './AdminWebinarRequests';

/**
 * Events > Webinar proposals > one proposal. Admins accept it (a draft webinar is created in
 * the old editor, date to be set) or refuse it with a reason sent to the member; moderators
 * pre-approve it. Restyled to the admin look (wave 2, 21 Oct 2026): the data, the e-mails and
 * the actions are unchanged.
 */

interface Sector {
  id: string;
  name: string;
}

export function AdminWebinarDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, profile, isAdmin } = useAuth();
  const isMod = profile?.persona === 'moderator';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [request, setRequest] = useState<WebinarRequest | null>(null);
  const [sectors, setSectors] = useState<Sector[]>([]);

  // Editable fields
  const [status, setStatus] = useState('');
  const [moderatorNotes, setModeratorNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');

  useEffect(() => {
    if (id) loadRequest(id);
  }, [id]);

  const loadRequest = async (reqId: string) => {
    setLoading(true);

    // Load webinar request with requester profile
    const { data, error } = await supabase
      .from('webinar_requests')
      .select('*, profiles:user_id(first_name, last_name, email)')
      .eq('id', reqId)
      .single();

    if (error || !data) {
      toast({ title: 'Webinar request not found', variant: 'destructive' });
      navigate('/admin/webinars');
      return;
    }

    const p = data.profiles as Record<string, string> | null;
    const req: WebinarRequest = {
      ...data,
      requester_name: p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() : '',
      requester_email: p?.email || '',
    };
    setRequest(req);
    setStatus(req.status);
    setModeratorNotes(req.moderator_notes || '');

    // Load sectors for this request
    const { data: wrs } = await supabase
      .from('webinar_request_sectors')
      .select('sector_id, sectors(id, name)')
      .eq('webinar_request_id', reqId);

    if (wrs) {
      setSectors(
        wrs.map((row: any) => ({
          id: row.sectors?.id || row.sector_id,
          name: row.sectors?.name || row.sector_id,
        }))
      );
    }

    setLoading(false);
  };

  const handleSaveStatus = async () => {
    if (!request || !id) return;
    setSaving(true);

    const { error } = await supabase.from('webinar_requests').update({
      status,
      moderator_notes: moderatorNotes.trim() || null,
      reviewed_at: new Date().toISOString(),
    }).eq('id', id);

    if (error) {
      toast({ title: 'Failed to update', description: error.message, variant: 'destructive' });
      setSaving(false);
      return;
    }

    toast({ title: `Status updated: ${status}` });
    setSaving(false);
    loadRequest(id);
  };

  const handleAccept = async () => {
    if (!request || !id) return;
    setSaving(true);

    // Update status
    await supabase.from('webinar_requests').update({
      status: 'accepted',
      moderator_notes: moderatorNotes.trim() || null,
      reviewed_at: new Date().toISOString(),
    }).eq('id', id);

    // Auto-create event from webinar request (date TBD — admin should edit after)
    const { error: eventErr, data: newEvent } = await supabase.from('events').insert({
      title: request.title,
      description: request.description || '',
      event_type: 'webinar',
      language: request.preferred_language || 'EN',
      access_level: 'members',
      date_time: null, // Admin needs to set the actual date in the event editor
    }).select('id').single();

    if (eventErr) {
      toast({ title: 'Accepted but event creation failed', description: eventErr.message, variant: 'destructive' });
    } else {
      toast({ title: 'Webinar accepted & event draft created', description: 'Find it in All events to set its date and publish it.' });
    }

    sendNotification({
      type: 'webinar_accepted',
      userId: request.user_id,
      data: { title: request.title },
    });

    setSaving(false);
    loadRequest(id);
  };

  const handleReject = async () => {
    if (!request || !id) return;
    if (!rejectionReason.trim()) {
      toast({ title: 'Rejection reason is required', variant: 'destructive' });
      return;
    }
    setSaving(true);

    await supabase.from('webinar_requests').update({
      status: 'rejected',
      moderator_notes: moderatorNotes.trim() || null,
      reviewed_at: new Date().toISOString(),
    }).eq('id', id);

    sendNotification({
      type: 'webinar_rejected',
      userId: request.user_id,
      data: { title: request.title, reason: rejectionReason.trim() },
    });

    toast({ title: 'Webinar request rejected' });
    setSaving(false);
    loadRequest(id);
  };

  const handleModeratorApprove = async () => {
    if (!request || !id) return;
    setSaving(true);

    await supabase.from('webinar_requests').update({
      status: 'moderator_approved',
      moderator_notes: moderatorNotes.trim() || null,
      reviewed_at: new Date().toISOString(),
    }).eq('id', id);

    sendNotification({
      type: 'webinar_moderator_approved',
      email: 'events@m3monaco.com',
      data: { title: request.title, moderator_notes: moderatorNotes.trim() },
    });

    toast({ title: 'Pre-approved — sent to admin for final validation' });
    setSaving(false);
    loadRequest(id);
  };

  if (loading) return <AdminLoading />;

  if (!request) return null;

  const canAct = request.status !== 'accepted' && request.status !== 'rejected';
  const longDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
  const facts: { label: string; value: ReactNode }[] = [
    { label: 'Proposed by', value: request.requester_name || request.requester_email ? (
      <>
        {request.requester_name || '—'}
        {request.requester_email && <span className="block text-[13px] text-meta">{request.requester_email}</span>}
      </>
    ) : '—' },
    { label: 'Language', value: request.preferred_language || 'EN' },
    { label: 'When they would like it', value: request.preferred_timeframe || 'Not specified' },
    { label: 'Received', value: longDate(request.created_at) },
    ...(request.reviewed_at ? [{ label: 'Last reviewed', value: longDate(request.reviewed_at) }] : []),
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <AdminDetailHeader
        back={{ to: '/admin/webinars', label: t('adminWebinars.back', 'Webinar proposals') }}
        title={request.title}
        badges={<WebinarStatus status={request.status} />}
      />

      <div className="space-y-5">
        <AdminPanel title={t('adminWebinars.proposal', 'The proposal')} icon={MessageSquare}>
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {facts.map(f => (
              <div key={f.label} className="min-w-0">
                <dt className="text-[12px] font-semibold uppercase tracking-[0.06em] text-meta">{f.label}</dt>
                <dd className="mt-0.5 text-[15px] leading-6 text-ink [overflow-wrap:anywhere]">{f.value}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-5">
            <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-meta">Description</p>
            <p className="mt-1 whitespace-pre-wrap rounded-xl bg-page p-3 text-[15px] leading-6 text-ink">{request.description || 'No description provided.'}</p>
          </div>

          {sectors.length > 0 && (
            <div className="mt-5">
              <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-meta">Sectors</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {sectors.map(s => <AdminStatusPill key={s.id}>{s.name}</AdminStatusPill>)}
              </div>
            </div>
          )}

          {request.status === 'moderator_approved' && request.moderator_notes && (
            <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[14px] leading-5 text-emerald-900">
              <strong>Pre-approved by a moderator</strong>
              <p className="mt-1">{request.moderator_notes}</p>
            </div>
          )}
        </AdminPanel>

        <AdminPanel
          title={t('adminWebinars.review', 'Review and decide')}
          icon={ShieldCheck}
          description={canAct
            ? (isAdmin
              ? 'Accept: a draft webinar is created (date to be set) and the member is told. Refuse: the reason below is sent to the member.'
              : 'Pre-approve: the M3 team is told and makes the final decision.')
            : 'This proposal has been decided.'}
        >
          <div className="space-y-4">
            {isAdmin && canAct && (
              <div className="space-y-2">
                <Label htmlFor="wr-status">Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger id="wr-status" className="h-11 w-full rounded-field sm:w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="submitted">Submitted</SelectItem>
                    <SelectItem value="under_review">Under review</SelectItem>
                    <SelectItem value="moderator_approved">Pre-approved</SelectItem>
                    <SelectItem value="accepted">Accepted</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {(!isAdmin || !canAct) && (
              <div className="space-y-2">
                <Label>Status</Label>
                <div><WebinarStatus status={request.status} /></div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="wr-notes">Notes (for the M3 team)</Label>
              <Textarea
                id="wr-notes"
                value={moderatorNotes}
                onChange={(e) => setModeratorNotes(e.target.value)}
                rows={3}
                placeholder="Internal notes about this webinar proposal..."
                disabled={!canAct}
                className="rounded-field text-[15px]"
              />
            </div>

            {canAct && (
              <div className="space-y-2">
                <Label htmlFor="wr-reason">Reason for refusing (required to refuse; sent to the member)</Label>
                <Textarea
                  id="wr-reason"
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  rows={2}
                  placeholder="Explain why this proposal is being refused..."
                  className="rounded-field text-[15px]"
                />
              </div>
            )}

            {canAct && (
              <div className="flex flex-wrap gap-2 border-t border-rule pt-4">
                {isAdmin && (
                  <>
                    <Button type="button" variant="secondary" size="sm" onClick={handleAccept} disabled={saving} className={ADMIN_BTN_PRIMARY + ' h-11 gap-1.5 sm:h-10'}>
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                      Accept and create the webinar
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={handleReject} disabled={saving} className={ADMIN_BTN_DANGER + ' h-11 gap-1.5 sm:h-10'}>
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                      Refuse
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={handleSaveStatus} disabled={saving} className={ADMIN_BTN + ' h-11 gap-1.5 sm:h-10'}>
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Save the status and notes
                    </Button>
                  </>
                )}
                {isMod && (request.status === 'submitted' || request.status === 'under_review') && (
                  <>
                    <Button type="button" variant="secondary" size="sm" onClick={handleModeratorApprove} disabled={saving} className={ADMIN_BTN_PRIMARY + ' h-11 gap-1.5 sm:h-10'}>
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                      Pre-approve
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={handleSaveStatus} disabled={saving} className={ADMIN_BTN + ' h-11 gap-1.5 sm:h-10'}>
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Save the notes
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        </AdminPanel>
      </div>
    </div>
  );
}
