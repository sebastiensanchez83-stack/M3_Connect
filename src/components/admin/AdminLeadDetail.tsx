import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Loader2, Target, User, Globe, Mail, Phone } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import type { PartnerLead } from './types';

const STATUS_BADGE: Record<string, { variant: any; label: string }> = {
  new: { variant: 'info', label: 'New' },
  qualified: { variant: 'warning', label: 'Qualified' },
  in_discussion: { variant: 'default', label: 'In Discussion' },
  signed: { variant: 'success', label: 'Signed' },
  rejected: { variant: 'destructive', label: 'Rejected' },
};

export function AdminLeadDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lead, setLead] = useState<PartnerLead | null>(null);
  const [status, setStatus] = useState('new');
  const [adminNotes, setAdminNotes] = useState('');

  useEffect(() => {
    if (id) loadLead(id);
  }, [id]);

  const loadLead = async (leadId: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from('partner_leads')
      .select('*')
      .eq('id', leadId)
      .single();

    if (error || !data) {
      toast({ title: 'Lead not found', variant: 'destructive' });
      navigate('/admin/leads');
      return;
    }

    setLead(data);
    setStatus(data.status);
    setAdminNotes(data.admin_notes || '');
    setLoading(false);
  };

  const handleSave = async () => {
    if (!lead) return;
    setSaving(true);

    const { error } = await supabase
      .from('partner_leads')
      .update({ status, admin_notes: adminNotes })
      .eq('id', lead.id);

    if (error) {
      toast({ title: 'Failed to save', variant: 'destructive' });
      setSaving(false);
      return;
    }

    toast({ title: 'Lead saved!' });
    loadLead(lead.id);
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!lead) return null;

  const badge = STATUS_BADGE[lead.status] || { variant: 'outline', label: lead.status };
  const daysSince = Math.floor((Date.now() - new Date(lead.created_at).getTime()) / 86400000);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin/leads')} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" /> Leads
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <h1 className="text-xl font-bold text-gray-900">{lead.company}</h1>
          <Badge variant={badge.variant}>{badge.label}</Badge>
          <span className="text-xs text-gray-400">{daysSince}d ago</span>
        </div>
        <Button onClick={handleSave} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Changes
        </Button>
      </div>

      {/* Company Info */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
            <Target className="h-4 w-4 text-blue-500" /> Company Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label className="text-xs text-gray-500">Company</Label>
              <p className="text-sm font-medium mt-1">{lead.company}</p>
            </div>
            <div>
              <Label className="text-xs text-gray-500">Actor Type</Label>
              <p className="text-sm mt-1"><Badge variant="outline">{lead.actor_type}</Badge></p>
            </div>
            <div>
              <Label className="text-xs text-gray-500">Country</Label>
              <p className="text-sm mt-1">{lead.country}</p>
            </div>
          </div>
          {lead.website && (
            <div>
              <Label className="text-xs text-gray-500 flex items-center gap-1"><Globe className="h-3 w-3" /> Website</Label>
              <a href={lead.website} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline mt-1 block">{lead.website}</a>
            </div>
          )}
          {lead.solutions && (
            <div>
              <Label className="text-xs text-gray-500">Solutions</Label>
              <p className="mt-1 p-3 bg-gray-50 rounded-lg text-sm whitespace-pre-wrap">{lead.solutions}</p>
            </div>
          )}
          {lead.goals && (
            <div>
              <Label className="text-xs text-gray-500">Goals</Label>
              <p className="mt-1 p-3 bg-gray-50 rounded-lg text-sm whitespace-pre-wrap">{lead.goals}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Contact Info */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
            <User className="h-4 w-4 text-violet-500" /> Contact Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-xl bg-violet-100 flex items-center justify-center text-sm font-bold text-violet-700">
              {(lead.first_name?.[0] || '?').toUpperCase()}
            </div>
            <div>
              <div className="text-sm font-medium text-gray-900">{lead.first_name} {lead.last_name}</div>
              <div className="text-xs text-gray-500">{lead.company}</div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-gray-400" />
              <a href={`mailto:${lead.email}`} className="text-sm text-blue-600 hover:underline">{lead.email}</a>
            </div>
            {lead.phone && (
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-gray-400" />
                <span className="text-sm">{lead.phone}</span>
              </div>
            )}
          </div>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-gray-500">Engagement Level</Label>
              <p className="text-sm mt-1">{lead.engagement_level}</p>
            </div>
            <div>
              <Label className="text-xs text-gray-500">Submitted</Label>
              <p className="text-sm mt-1">{new Date(lead.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
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
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="qualified">Qualified</SelectItem>
                <SelectItem value="in_discussion">In Discussion</SelectItem>
                <SelectItem value="signed">Signed</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Admin Notes</Label>
            <Textarea
              value={adminNotes}
              onChange={e => setAdminNotes(e.target.value)}
              rows={4}
              placeholder="Internal notes about this lead..."
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
