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
import type { RFP } from './types';

export function AdminRFPs() {
  const { t } = useTranslation();
  const [rfps, setRfps] = useState<(RFP & { marina_name?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<(RFP & { marina_name?: string }) | null>(null);

  useEffect(() => { load(); }, []);
  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('rfps').select('*').order('created_at', { ascending: false });
    const rows = data || [];
    const userIds = [...new Set(rows.map((r: RFP) => r.marina_user_id))];
    const nameMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('user_id, first_name, last_name').in('user_id', userIds);
      (profiles || []).forEach((p: { user_id: string; first_name: string; last_name: string }) => { nameMap[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.user_id.slice(0, 8); });
    }
    setRfps(rows.map((r: RFP) => ({ ...r, marina_name: nameMap[r.marina_user_id] || r.marina_user_id.slice(0, 8) })));
    setLoading(false);
  };
  const toggleOpen = async (id: string, is_open: boolean) => { await supabase.from('rfps').update({ is_open }).eq('id', id); toast({ title: is_open ? t('admin.rfps.reopened') : t('admin.rfps.closedToast') }); load(); };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t('admin.rfps.title')} ({rfps.length})</h1>
      <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full"><thead className="bg-gray-50 border-b"><tr>
        <th className="text-left p-4 font-medium">{t('admin.userDetail.name')}</th><th className="text-left p-4 font-medium">{t('admin.rfps.marina')}</th><th className="text-left p-4 font-medium">{t('admin.rfps.deadline')}</th><th className="text-left p-4 font-medium">{t('admin.status')}</th><th className="text-left p-4 font-medium">{t('admin.actions')}</th>
      </tr></thead><tbody>
        {rfps.map(r => (<tr key={r.id} className="border-b hover:bg-gray-50">
          <td className="p-4 font-medium max-w-xs truncate">{r.title}</td>
          <td className="p-4 text-sm font-medium">{r.marina_name}</td>
          <td className="p-4 text-sm text-gray-500">{r.deadline_date ? new Date(r.deadline_date).toLocaleDateString() : '—'}</td>
          <td className="p-4"><Badge variant={r.is_open ? 'success' : 'secondary'}>{r.is_open ? t('admin.rfps.open') : t('admin.rfps.closed')}</Badge></td>
          <td className="p-4"><div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected(r)}><Eye className="h-4 w-4" /></Button>
            <Button size="sm" variant="outline" onClick={() => toggleOpen(r.id, !r.is_open)}>{r.is_open ? t('admin.rfps.close') : t('admin.rfps.reopen')}</Button>
          </div></td>
        </tr>))}
        {rfps.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-gray-400">{t('admin.rfps.noRfps')}</td></tr>}
      </tbody></table></div></CardContent></Card>
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>{t('admin.rfps.dialogTitle')}</DialogTitle><DialogDescription>{t('admin.rfps.dialogDesc')}</DialogDescription></DialogHeader>{selected && (<div className="space-y-4 mt-2"><div><strong>{t('admin.userDetail.name')}:</strong> {selected.title}</div><div><strong>{t('admin.rfps.marina')}:</strong> {selected.marina_name}</div><div><strong>{t('admin.rfps.scope')}:</strong><p className="mt-1 p-3 bg-gray-50 rounded text-sm whitespace-pre-wrap">{selected.scope}</p></div><div className="grid grid-cols-2 gap-4 text-sm"><div><strong>{t('admin.rfps.deadline')}:</strong> {selected.deadline_date || '—'}</div><div><strong>{t('admin.status')}:</strong> {selected.is_open ? t('admin.rfps.open') : t('admin.rfps.closed')}</div></div></div>)}</DialogContent></Dialog>
    </div>
  );
}
