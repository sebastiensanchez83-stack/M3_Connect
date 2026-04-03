import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Loader2, MessageSquare, User } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { sendNotification } from '@/lib/notifications';
import type { Consultation } from './types';

interface ConsultationWithDetails extends Consultation {
  profile_name: string;
  profile_email: string;
  org_name: string | null;
  sector_name: string | null;
  admin_notes: string | null;
}

export function AdminConsultationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [consultation, setConsultation] = useState<ConsultationWithDetails | null>(null);
  const [isOpen, setIsOpen] = useState(true);
  const [adminNotes, setAdminNotes] = useState('');

  useEffect(() => {
    if (id) loadConsultation(id);
  }, [id]);

  const loadConsultation = async (consultationId: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from('consultations')
      .select('*')
      .eq('id', consultationId)
      .single();

    if (error || !data) {
      toast({ title: 'Consultation not found', variant: 'destructive' });
      navigate('/admin/consultations');
      return;
    }

    const [profileRes, membershipRes, sectorRes] = await Promise.all([
      supabase.from('profiles').select('user_id, first_name, last_name, email').eq('user_id', data.marina_user_id).single(),
      supabase.from('organization_members').select('user_id, organizations(name)').eq('user_id', data.marina_user_id).maybeSingle(),
      data.sector_id
        ? supabase.from('sectors').select('id, name').eq('id', data.sector_id).single()
        : Promise.resolve({ data: null }),
    ]);

    const profile = profileRes.data;
    const org = membershipRes.data?.organizations as unknown as Record<string, string> | null;
    const sector = sectorRes.data as { id: string; name: string } | null;

    const enriched: ConsultationWithDetails = {
      ...data,
      profile_name: profile
        ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || profile.email || data.marina_user_id.slice(0, 8)
        : data.marina_user_id.slice(0, 8),
      profile_email: profile?.email || '',
      org_name: org?.name || null,
      sector_name: sector?.name || null,
      admin_notes: data.admin_notes || null,
    };

    setConsultation(enriched);
    setIsOpen(enriched.is_open);
    setAdminNotes(enriched.admin_notes || '');
    setLoading(false);
  };

  const handleSave = async () => {
    if (!consultation) return;
    setSaving(true);

    const { error } = await supabase
      .from('consultations')
      .update({ is_open: isOpen, admin_notes: adminNotes })
      .eq('id', consultation.id);

    if (error) {
      toast({ title: 'Failed to save', variant: 'destructive' });
      setSaving(false);
      return;
    }

    // Notify when closing
    if (!isOpen && consultation.is_open) {
      sendNotification({
        type: 'consultation_closed',
        userId: consultation.marina_user_id,
        data: { title: consultation.title },
      });
    }

    toast({ title: 'Consultation saved!' });
    loadConsultation(consultation.id);
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!consultation) return null;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin/consultations')} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" /> Consultations
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <h1 className="text-xl font-bold text-gray-900">{consultation.title}</h1>
          <Badge variant={consultation.is_open ? 'success' : 'secondary'}>
            {consultation.is_open ? 'Open' : 'Closed'}
          </Badge>
        </div>
        <Button onClick={handleSave} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Changes
        </Button>
      </div>

      {/* Consultation Details */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-blue-500" /> Consultation Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs text-gray-500">Title</Label>
            <p className="text-sm font-medium mt-1">{consultation.title}</p>
          </div>
          <div>
            <Label className="text-xs text-gray-500">Description</Label>
            <p className="mt-1 p-3 bg-gray-50 rounded-lg text-sm whitespace-pre-wrap">{consultation.description}</p>
          </div>
          {consultation.sector_name && (
            <div>
              <Label className="text-xs text-gray-500">Sector</Label>
              <div className="mt-1">
                <Badge variant="outline">{consultation.sector_name}</Badge>
              </div>
            </div>
          )}
          <div>
            <Label className="text-xs text-gray-500">Submitted</Label>
            <p className="text-sm mt-1">{new Date(consultation.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
          </div>
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
              {(consultation.profile_name?.[0] || '?').toUpperCase()}
            </div>
            <div>
              <div className="text-sm font-medium text-gray-900">{consultation.profile_name}</div>
              <div className="text-xs text-gray-500">
                {consultation.profile_email}
                {consultation.org_name && <span> &bull; {consultation.org_name}</span>}
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
            <div className="flex items-center gap-3">
              <Button
                variant={isOpen ? 'default' : 'outline'}
                size="sm"
                onClick={() => setIsOpen(true)}
              >
                Open
              </Button>
              <Button
                variant={!isOpen ? 'destructive' : 'outline'}
                size="sm"
                onClick={() => setIsOpen(false)}
              >
                Closed
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Admin Notes</Label>
            <Textarea
              value={adminNotes}
              onChange={e => setAdminNotes(e.target.value)}
              rows={4}
              placeholder="Internal notes about this consultation..."
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
