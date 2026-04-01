import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Eye } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { sendNotification } from '@/lib/notifications';
import type { Consultation } from './types';

export function AdminConsultations() {
  const { t } = useTranslation();
  const [consultations, setConsultations] = useState<(Consultation & { marina_name?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<(Consultation & { marina_name?: string }) | null>(null);

  useEffect(() => { load(); }, []);
  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('consultations').select('*').order('created_at', { ascending: false });
    const rows = data || [];
    const userIds = [...new Set(rows.map((c: Consultation) => c.marina_user_id))];
    const nameMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('user_id, first_name, last_name').in('user_id', userIds);
      (profiles || []).forEach((p: { user_id: string; first_name: string; last_name: string }) => { nameMap[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.user_id.slice(0, 8); });
    }
    setConsultations(rows.map((c: Consultation) => ({ ...c, marina_name: nameMap[c.marina_user_id] || c.marina_user_id.slice(0, 8) })));
    setLoading(false);
  };
  const toggleOpen = async (id: string, is_open: boolean) => {
    await supabase.from('consultations').update({ is_open }).eq('id', id);
    // Notify marina owner when consultation is closed
    if (!is_open) {
      const consultation = consultations.find(c => c.id === id);
      if (consultation) {
        sendNotification({ type: 'consultation_closed', userId: consultation.marina_user_id, data: { title: consultation.title } });
      }
    }
    toast({ title: is_open ? t('admin.consultations.reopened') : t('admin.consultations.closedToast') });
    load();
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t('admin.consultations.title')} ({consultations.length})</h1>
      <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full"><thead className="bg-gray-50 border-b"><tr>
        <th className="text-left p-4 font-medium">{t('admin.userDetail.name')}</th><th className="text-left p-4 font-medium">{t('admin.consultations.marina')}</th><th className="text-left p-4 font-medium">{t('admin.status')}</th><th className="text-left p-4 font-medium">{t('admin.webinarRequests.date')}</th><th className="text-left p-4 font-medium">{t('admin.actions')}</th>
      </tr></thead><tbody>
        {consultations.map(c => (<tr key={c.id} className="border-b hover:bg-gray-50">
          <td className="p-4 font-medium max-w-xs truncate">{c.title}</td>
          <td className="p-4 text-sm font-medium">{c.marina_name}</td>
          <td className="p-4"><Badge variant={c.is_open ? 'success' : 'secondary'}>{c.is_open ? t('admin.consultations.open') : t('admin.consultations.closed')}</Badge></td>
          <td className="p-4 text-sm text-gray-500">{new Date(c.created_at).toLocaleDateString()}</td>
          <td className="p-4"><div className="flex gap-2">
            <Button size="sm" variant="ghost" aria-label="View details" onClick={() => setSelected(c)}><Eye className="h-4 w-4" /></Button>
            <Button size="sm" variant="outline" onClick={() => toggleOpen(c.id, !c.is_open)}>{c.is_open ? t('admin.consultations.close') : t('admin.consultations.reopen')}</Button>
          </div></td>
        </tr>))}
        {consultations.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-gray-400">{t('admin.consultations.noConsultations')}</td></tr>}
      </tbody></table></div></CardContent></Card>
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>{t('admin.consultations.dialogTitle')}</DialogTitle><DialogDescription>{t('admin.consultations.dialogDesc')}</DialogDescription></DialogHeader>{selected && (<div className="space-y-4 mt-2"><div><strong>{t('admin.userDetail.name')}:</strong> {selected.title}</div><div><strong>{t('admin.consultations.marina')}:</strong> {selected.marina_name}</div><div><strong>{t('admin.userDetail.description')}:</strong><p className="mt-1 p-3 bg-gray-50 rounded text-sm whitespace-pre-wrap">{selected.description}</p></div></div>)}</DialogContent></Dialog>
    </div>
  );
}
