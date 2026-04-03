import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, Save, Loader2, Calendar, Globe, MessageSquare,
  CheckCircle, XCircle, ShieldCheck, Tag,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { sendNotification } from '@/lib/notifications';
import type { WebinarRequest } from './types';

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

    // Auto-create event from webinar request
    const { error: eventErr } = await supabase.from('events').insert({
      title: request.title,
      description: request.description || '',
      event_type: 'webinar',
      language: request.preferred_language || 'EN',
      access_level: 'members',
    });

    if (eventErr) {
      toast({ title: 'Accepted but event creation failed', description: eventErr.message, variant: 'destructive' });
    } else {
      toast({ title: 'Webinar accepted and event created!' });
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
      email: 'info@m3monaco.com',
      data: { title: request.title, moderator_notes: moderatorNotes.trim() },
    });

    toast({ title: 'Pre-approved — sent to admin for final validation' });
    setSaving(false);
    loadRequest(id);
  };

  const statusBadge = (s: string) => {
    const colors: Record<string, string> = {
      submitted: 'bg-yellow-100 text-yellow-700',
      under_review: 'bg-blue-100 text-blue-700',
      moderator_approved: 'bg-emerald-100 text-emerald-700',
      accepted: 'bg-green-100 text-green-700',
      rejected: 'bg-red-100 text-red-700',
    };
    return <Badge className={`${colors[s] || 'bg-gray-100 text-gray-700'} border-0`}>{s.replace(/_/g, ' ')}</Badge>;
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );

  if (!request) return null;

  const canAct = request.status !== 'accepted' && request.status !== 'rejected';

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin/webinars')} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" /> Webinars
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <h1 className="text-xl font-bold text-gray-900">{request.title}</h1>
          {statusBadge(request.status)}
        </div>
      </div>

      {/* Request Details */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-violet-500" /> Request Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500 block text-xs">Requester</span>
              <span className="font-medium">{request.requester_name || '---'}</span>
              {request.requester_email && (
                <span className="block text-xs text-gray-400">{request.requester_email}</span>
              )}
            </div>
            <div>
              <span className="text-gray-500 block text-xs">Preferred Language</span>
              <span className="font-medium flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5 text-gray-400" />
                {request.preferred_language || 'EN'}
              </span>
            </div>
            <div>
              <span className="text-gray-500 block text-xs">Preferred Timeframe</span>
              <span className="font-medium flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-gray-400" />
                {request.preferred_timeframe || 'Not specified'}
              </span>
            </div>
            <div>
              <span className="text-gray-500 block text-xs">Submitted</span>
              <span className="font-medium">
                {new Date(request.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
              </span>
            </div>
            {request.reviewed_at && (
              <div>
                <span className="text-gray-500 block text-xs">Last Reviewed</span>
                <span className="font-medium">
                  {new Date(request.reviewed_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                </span>
              </div>
            )}
          </div>

          {/* Description */}
          <div>
            <span className="text-gray-500 block text-xs mb-1">Description</span>
            <p className="text-sm p-3 bg-gray-50 rounded-lg whitespace-pre-wrap">{request.description || 'No description provided.'}</p>
          </div>

          {/* Sectors */}
          {sectors.length > 0 && (
            <div>
              <span className="text-gray-500 block text-xs mb-2 flex items-center gap-1">
                <Tag className="h-3 w-3" /> Sectors
              </span>
              <div className="flex flex-wrap gap-2">
                {sectors.map(s => (
                  <Badge key={s.id} variant="outline" className="text-xs">{s.name}</Badge>
                ))}
              </div>
            </div>
          )}

          {/* Moderator pre-approval banner */}
          {request.status === 'moderator_approved' && request.moderator_notes && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm">
              <strong className="text-emerald-700">Moderator pre-approved</strong>
              <p className="mt-1 text-emerald-800">{request.moderator_notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Status & Review */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-blue-500" /> Review & Actions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Status dropdown (admin only) */}
          {isAdmin && canAct && (
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-60">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="submitted">Submitted</SelectItem>
                  <SelectItem value="under_review">Under Review</SelectItem>
                  <SelectItem value="moderator_approved">Moderator Approved</SelectItem>
                  <SelectItem value="accepted">Accepted</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Current status badge for non-admin or completed */}
          {(!isAdmin || !canAct) && (
            <div className="space-y-2">
              <Label>Status</Label>
              <div>{statusBadge(request.status)}</div>
            </div>
          )}

          {/* Moderator Notes */}
          <div className="space-y-2">
            <Label>Moderator Notes</Label>
            <Textarea
              value={moderatorNotes}
              onChange={(e) => setModeratorNotes(e.target.value)}
              rows={3}
              placeholder="Internal notes about this webinar proposal..."
              disabled={!canAct}
            />
          </div>

          {/* Rejection Reason */}
          {canAct && (
            <div className="space-y-2">
              <Label>Rejection Reason (required when rejecting — sent to requester)</Label>
              <Textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                rows={2}
                placeholder="Explain why this proposal is being rejected..."
              />
            </div>
          )}

          {/* Action buttons */}
          {canAct && (
            <div className="flex flex-wrap gap-3 pt-2 border-t">
              {isAdmin && (
                <>
                  <Button
                    onClick={handleAccept}
                    disabled={saving}
                    className="bg-green-600 hover:bg-green-700 text-white gap-1.5"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                    Accept & Create Event
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleReject}
                    disabled={saving}
                    className="gap-1.5"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                    Reject
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleSaveStatus}
                    disabled={saving}
                    className="gap-1.5"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save Status & Notes
                  </Button>
                </>
              )}
              {isMod && (request.status === 'submitted' || request.status === 'under_review') && (
                <>
                  <Button
                    onClick={handleModeratorApprove}
                    disabled={saving}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                    Pre-approve
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleSaveStatus}
                    disabled={saving}
                    className="gap-1.5"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save Notes
                  </Button>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
