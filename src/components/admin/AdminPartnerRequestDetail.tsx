import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, Loader2, CheckCircle, XCircle, MessageSquare, User, Building2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { sendNotification } from '@/lib/notifications';
import type { PartnerRequest } from './types';

type EnrichedRequest = PartnerRequest & {
  partner_name?: string;
  partner_email?: string;
  marina_name?: string;
  marina_email?: string;
  partner_org_name?: string;
  marina_org_name?: string;
  sector_name?: string;
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
      toast({ title: 'Partner request not found', variant: 'destructive' });
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

    // Fetch sector name
    let sectorName = '';
    if (row.sector_id) {
      const { data: sector } = await supabase
        .from('sectors')
        .select('name')
        .eq('id', row.sector_id)
        .single();
      sectorName = sector?.name || '';
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

    // Notify both users
    sendNotification({
      type: 'partner_request_accepted',
      userId: request.partner_user_id,
      data: {
        marina_name: request.marina_name || 'A marina',
        marina_email: request.marina_email || '',
        partner_name: request.partner_name || '',
        partner_email: request.partner_email || '',
      },
    });
    sendNotification({
      type: 'partner_request_accepted',
      userId: request.marina_user_id,
      data: {
        marina_name: request.marina_name || 'A marina',
        marina_email: request.marina_email || '',
        partner_name: request.partner_name || '',
        partner_email: request.partner_email || '',
      },
    });

    toast({ title: 'Request accepted', description: `Connection between ${request.partner_name} and ${request.marina_name} established.` });
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

    toast({ title: 'Request rejected' });
    setSaving(false);
    loadRequest(id);
  };

  const statusBadge = (s: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-amber-100 text-amber-800 border-amber-200',
      accepted: 'bg-green-100 text-green-800 border-green-200',
      rejected: 'bg-red-100 text-red-800 border-red-200',
      withdrawn: 'bg-gray-100 text-gray-600 border-gray-200',
    };
    return <Badge className={`${colors[s] || colors.withdrawn} border`}>{s}</Badge>;
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );

  if (!request) return null;

  const daysSince = Math.floor((Date.now() - new Date(request.created_at).getTime()) / 86400000);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin/partner-requests')} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" /> B2B Requests
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <h1 className="text-xl font-bold text-gray-900">
            {request.partner_name} → {request.marina_name}
          </h1>
          {statusBadge(request.status)}
        </div>
      </div>

      {/* Partner Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
              <User className="h-4 w-4 text-blue-500" /> Requester (Partner)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <span className="text-gray-500 block text-xs">Name</span>
              <span className="font-medium">{request.partner_name}</span>
            </div>
            <div>
              <span className="text-gray-500 block text-xs">Email</span>
              <span className="font-medium">{request.partner_email || '---'}</span>
            </div>
            {request.partner_org_name && (
              <div>
                <span className="text-gray-500 block text-xs">Organization</span>
                <span className="font-medium flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-gray-400" />
                  {request.partner_org_name}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
              <Building2 className="h-4 w-4 text-emerald-500" /> Target (Marina)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <span className="text-gray-500 block text-xs">Name</span>
              <span className="font-medium">{request.marina_name}</span>
            </div>
            <div>
              <span className="text-gray-500 block text-xs">Email</span>
              <span className="font-medium">{request.marina_email || '---'}</span>
            </div>
            {request.marina_org_name && (
              <div>
                <span className="text-gray-500 block text-xs">Organization</span>
                <span className="font-medium flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-gray-400" />
                  {request.marina_org_name}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Request Details */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-violet-500" /> Request Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-gray-500 block text-xs">Status</span>
              <div className="mt-1">{statusBadge(request.status)}</div>
            </div>
            <div>
              <span className="text-gray-500 block text-xs">Submitted</span>
              <span className="font-medium">
                {new Date(request.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                <span className="text-gray-400 ml-1">({daysSince}d ago)</span>
              </span>
            </div>
            {request.sector_name && (
              <div>
                <span className="text-gray-500 block text-xs">Sector</span>
                <Badge variant="outline" className="text-xs mt-1">{request.sector_name}</Badge>
              </div>
            )}
          </div>

          {request.message && (
            <div>
              <span className="text-gray-500 block text-xs mb-1">Message</span>
              <p className="text-sm bg-gray-50 rounded-lg p-3 whitespace-pre-wrap">{request.message}</p>
            </div>
          )}

          {/* Actions */}
          {request.status === 'pending' && (
            <div className="flex gap-3 pt-4 border-t">
              <Button
                className="bg-green-600 hover:bg-green-700 text-white gap-1.5"
                onClick={handleAccept}
                disabled={saving}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                Accept Connection
              </Button>
              <Button
                variant="outline"
                className="text-red-700 border-red-200 hover:bg-red-50 gap-1.5"
                onClick={handleReject}
                disabled={saving}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                Reject
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
