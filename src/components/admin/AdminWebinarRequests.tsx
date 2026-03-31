import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Eye } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import type { WebinarRequest } from './types';

export function AdminWebinarRequests() {
  const { t } = useTranslation();
  const { profile, organization } = useAuth();
  const isAdmin = profile?.persona === 'admin';
  const [requests, setRequests] = useState<WebinarRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<WebinarRequest | null>(null);
  const [moderatorNotes, setModeratorNotes] = useState('');

  useEffect(() => { loadRequests(); }, []);
  const loadRequests = async () => {
    setLoading(true);
    if (isAdmin) {
      // Admin sees all webinar requests
      const { data } = await supabase.from('webinar_requests').select('*').order('created_at', { ascending: false });
      setRequests(data || []);
    } else if (organization?.id) {
      // Moderator sees only webinars matching their org's service sectors
      const { data: orgSectors } = await supabase
        .from('organization_service_sectors')
        .select('sector_id')
        .eq('organization_id', organization.id);
      const sectorIds = (orgSectors || []).map((s: { sector_id: string }) => s.sector_id);

      if (sectorIds.length > 0) {
        // Fetch webinar requests that have at least one matching sector
        const { data: matchedWRS } = await supabase
          .from('webinar_request_sectors')
          .select('webinar_request_id')
          .in('sector_id', sectorIds);
        const matchedIds = [...new Set((matchedWRS || []).map((wr: { webinar_request_id: string }) => wr.webinar_request_id))];
        if (matchedIds.length > 0) {
          const { data } = await supabase
            .from('webinar_requests')
            .select('*')
            .in('id', matchedIds)
            .order('created_at', { ascending: false });
          setRequests(data || []);
        } else {
          setRequests([]);
        }
      } else {
        setRequests([]);
      }
    } else {
      setRequests([]);
    }
    setLoading(false);
  };
  const updateStatus = async (id: string, status: string) => {
    await supabase.from('webinar_requests').update({ status, reviewed_at: new Date().toISOString() }).eq('id', id);
    // When accepted, auto-create an event from the webinar request
    if (status === 'accepted') {
      const req = requests.find(r => r.id === id);
      if (req) {
        const { error: eventErr } = await supabase.from('events').insert({
          title: req.title,
          description: req.description || '',
          event_type: 'webinar',
          language: req.preferred_language || 'EN',
          access_level: 'members',
        });
        if (eventErr) {
          toast({ title: t('admin.webinarRequests.acceptedEventFailed'), description: eventErr.message, variant: 'destructive' });
        } else {
          toast({ title: t('admin.webinarRequests.acceptedEventCreated') });
        }
        loadRequests();
        return;
      }
    }
    toast({ title: `Status: ${status}` }); loadRequests();
  };
  const saveNotes = async () => { if (!selected) return; await supabase.from('webinar_requests').update({ moderator_notes: moderatorNotes.trim() || null }).eq('id', selected.id); toast({ title: t('admin.webinarRequests.notesSaved') }); setSelected(null); loadRequests(); };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold">{t('admin.webinarRequests.title')} ({requests.length})</h1>
        {!isAdmin && <Badge variant="outline" className="text-xs">{t('admin.webinarRequests.filteredBySectors')}</Badge>}
      </div>
      <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full"><thead className="bg-gray-50 border-b"><tr><th className="text-left p-4 font-medium">{t('admin.userDetail.name')}</th><th className="text-left p-4 font-medium">{t('admin.webinarRequests.lang')}</th><th className="text-left p-4 font-medium">{t('admin.status')}</th><th className="text-left p-4 font-medium">{t('admin.webinarRequests.date')}</th><th className="text-left p-4 font-medium">{t('admin.actions')}</th></tr></thead><tbody>
        {requests.map(r => (<tr key={r.id} className="border-b hover:bg-gray-50"><td className="p-4 font-medium max-w-xs truncate">{r.title}</td><td className="p-4">{r.preferred_language}</td><td className="p-4"><Select value={r.status} onValueChange={v => updateStatus(r.id, v)}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="submitted">{t('admin.webinarRequests.statusSubmitted')}</SelectItem><SelectItem value="under_review">{t('admin.webinarRequests.statusUnderReview')}</SelectItem><SelectItem value="accepted">{t('admin.webinarRequests.statusAccepted')}</SelectItem><SelectItem value="rejected">{t('admin.webinarRequests.statusRejected')}</SelectItem></SelectContent></Select></td><td className="p-4 text-gray-500">{new Date(r.created_at).toLocaleDateString()}</td><td className="p-4"><Button size="sm" variant="ghost" onClick={() => { setSelected(r); setModeratorNotes(r.moderator_notes || ''); }}><Eye className="h-4 w-4" /></Button></td></tr>))}
        {requests.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-gray-400">{t('admin.webinarRequests.noRequests')}</td></tr>}
      </tbody></table></div></CardContent></Card>
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>{t('admin.webinarRequests.dialogTitle')}</DialogTitle><DialogDescription>{t('admin.webinarRequests.dialogDesc')}</DialogDescription></DialogHeader>{selected && (<div className="space-y-4 mt-2"><div><strong>{t('admin.userDetail.name')}:</strong> {selected.title}</div><div><strong>{t('admin.userDetail.description')}:</strong><p className="mt-1 p-3 bg-gray-50 rounded text-sm whitespace-pre-wrap">{selected.description}</p></div><div className="space-y-2"><Label>{t('admin.webinarRequests.moderatorNotes')}</Label><Textarea value={moderatorNotes} onChange={e => setModeratorNotes(e.target.value)} rows={3} /></div><Button onClick={saveNotes} className="w-full">{t('admin.webinarRequests.saveNotes')}</Button></div>)}</DialogContent></Dialog>
    </div>
  );
}
