import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Loader2, FileText, User } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { sendNotification } from '@/lib/notifications';
import type { RFP } from './types';

const STATUS_BADGE: Record<string, { variant: string; label: string }> = {
  submitted: { variant: 'info', label: 'Submitted' },
  under_review: { variant: 'warning', label: 'Under Review' },
  approved: { variant: 'success', label: 'Approved' },
  closed: { variant: 'secondary', label: 'Closed' },
  rejected: { variant: 'destructive', label: 'Rejected' },
  archived: { variant: 'outline', label: 'Archived' },
};

interface RFPWithDetails extends RFP {
  profile_name: string;
  profile_email: string;
  org_name: string | null;
  sectors: { id: string; name: string }[];
  admin_notes: string | null;
}

export function AdminRFPDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rfp, setRfp] = useState<RFPWithDetails | null>(null);
  const [status, setStatus] = useState('submitted');
  const [rejectionReason, setRejectionReason] = useState('');
  const [adminNotes, setAdminNotes] = useState('');

  useEffect(() => {
    if (id) loadRFP(id);
  }, [id]);

  const loadRFP = async (rfpId: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from('rfps')
      .select('*')
      .eq('id', rfpId)
      .single();

    if (error || !data) {
      toast({ title: 'RFP not found', variant: 'destructive' });
      navigate('/admin/rfps');
      return;
    }

    // Load user info, sectors, and related partner requests in parallel
    const [profileRes, membershipRes, sectorRes] = await Promise.all([
      supabase.from('profiles').select('user_id, first_name, last_name, email').eq('user_id', data.marina_user_id).single(),
      supabase.from('organization_members').select('user_id, organizations(name)').eq('user_id', data.marina_user_id).maybeSingle(),
      data.sector_id
        ? supabase.from('sectors').select('id, name').eq('id', data.sector_id)
        : Promise.resolve({ data: [] }),
    ]);

    const profile = profileRes.data;
    const org = membershipRes.data?.organizations as unknown as Record<string, string> | null;
    const sectors = (sectorRes.data || []) as { id: string; name: string }[];

    const enriched: RFPWithDetails = {
      ...data,
      profile_name: profile
        ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || profile.email || data.marina_user_id.slice(0, 8)
        : data.marina_user_id.slice(0, 8),
      profile_email: profile?.email || '',
      org_name: org?.name || null,
      sectors,
      admin_notes: data.admin_notes || null,
    };

    setRfp(enriched);
    setStatus(data.status || 'submitted');
    setRejectionReason(data.rejection_reason || '');
    setAdminNotes(enriched.admin_notes || '');
    setLoading(false);
  };

  const handleSave = async () => {
    if (!rfp) return;
    setSaving(true);

    const oldStatus = rfp.status;

    const { error } = await supabase
      .from('rfps')
      .update({ status, admin_notes: adminNotes, rejection_reason: rejectionReason || null })
      .eq('id', rfp.id);

    if (error) {
      toast({ title: 'Failed to save', variant: 'destructive' });
      setSaving(false);
      return;
    }

    // Notify on approval
    if (status === 'approved' && oldStatus !== 'approved') {
      sendNotification({
        type: 'rfp_approved',
        userId: rfp.marina_user_id,
        data: { title: rfp.title },
      });
    }

    // Notify on rejection
    if (status === 'rejected' && oldStatus !== 'rejected') {
      sendNotification({
        type: 'rfp_rejected',
        userId: rfp.marina_user_id,
        data: { title: rfp.title, reason: rejectionReason },
      });
    }

    // Notify on close (fulfilled) — previously silent
    if (status === 'closed' && oldStatus !== 'closed') {
      sendNotification({
        type: 'rfp_closed',
        userId: rfp.marina_user_id,
        data: { title: rfp.title },
      });
    }

    toast({ title: 'RFP saved!' });
    loadRFP(rfp.id);
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!rfp) return null;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin/rfps')} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" /> RFPs
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <h1 className="text-xl font-bold text-gray-900">{rfp.title}</h1>
          <Badge variant={(STATUS_BADGE[status]?.variant || 'secondary') as any}>
            {STATUS_BADGE[status]?.label || status}
          </Badge>
        </div>
        <Button onClick={handleSave} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Changes
        </Button>
      </div>

      {/* RFP Details */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
            <FileText className="h-4 w-4 text-blue-500" /> RFP Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs text-gray-500">Title</Label>
            <p className="text-sm font-medium mt-1">{rfp.title}</p>
          </div>
          <div>
            <Label className="text-xs text-gray-500">Scope</Label>
            <p className="mt-1 p-3 bg-gray-50 rounded-lg text-sm whitespace-pre-wrap">{rfp.scope}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-gray-500">Deadline</Label>
              <p className="text-sm mt-1">
                {rfp.deadline_date
                  ? new Date(rfp.deadline_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                  : 'No deadline set'}
              </p>
            </div>
            <div>
              <Label className="text-xs text-gray-500">Submitted</Label>
              <p className="text-sm mt-1">{new Date(rfp.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
            </div>
          </div>
          {rfp.sectors.length > 0 && (
            <div>
              <Label className="text-xs text-gray-500">Sectors</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {rfp.sectors.map(s => (
                  <Badge key={s.id} variant="outline">{s.name}</Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Submitted By */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
            <User className="h-4 w-4 text-violet-500" /> Submitted By
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-violet-100 flex items-center justify-center text-sm font-bold text-violet-700">
              {(rfp.profile_name?.[0] || '?').toUpperCase()}
            </div>
            <div>
              <div className="text-sm font-medium text-gray-900">{rfp.profile_name}</div>
              <div className="text-xs text-gray-500">
                {rfp.profile_email}
                {rfp.org_name && <span> &bull; {rfp.org_name}</span>}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Admin Controls */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-gray-700">Admin Controls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="submitted">Submitted</SelectItem>
                <SelectItem value="under_review">Under Review</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {status === 'rejected' && (
            <div className="space-y-2">
              <Label>Rejection Reason</Label>
              <Textarea
                value={rejectionReason}
                onChange={e => setRejectionReason(e.target.value)}
                rows={3}
                placeholder="Explain why this RFP was rejected..."
              />
            </div>
          )}
          <div className="space-y-2">
            <Label>Admin Notes</Label>
            <Textarea
              value={adminNotes}
              onChange={e => setAdminNotes(e.target.value)}
              rows={4}
              placeholder="Internal notes about this RFP..."
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
