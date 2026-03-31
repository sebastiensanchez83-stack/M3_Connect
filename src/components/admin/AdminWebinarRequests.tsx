import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Eye, CheckCircle } from 'lucide-react';
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
  const { user, profile, organization, isAdmin } = useAuth();
  const isMod = profile?.persona === 'moderator';
  const [requests, setRequests] = useState<WebinarRequest[]>([]);
  const [myProposals, setMyProposals] = useState<WebinarRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<WebinarRequest | null>(null);
  const [moderatorNotes, setModeratorNotes] = useState('');
  const [tab, setTab] = useState<'review' | 'my'>('review');

  useEffect(() => { loadRequests(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadRequests = async () => {
    setLoading(true);

    if (isAdmin) {
      // Admin sees ALL webinar requests
      const { data } = await supabase
        .from('webinar_requests')
        .select('*')
        .order('created_at', { ascending: false });
      setRequests(data || []);
      setMyProposals([]);
    } else if (isMod && user) {
      // ── Moderator: load own proposals (status view) ──
      const { data: ownData } = await supabase
        .from('webinar_requests')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      setMyProposals(ownData || []);

      // ── Moderator: load proposals to review ──
      // 1. Get moderator's org sectors
      let sectorIds: string[] = [];
      if (organization?.id) {
        const { data: orgSectors } = await supabase
          .from('organization_service_sectors')
          .select('sector_id')
          .eq('organization_id', organization.id);
        sectorIds = (orgSectors || []).map((s: { sector_id: string }) => s.sector_id);
      }

      if (sectorIds.length > 0) {
        // 2. Find webinar requests matching sectors
        const { data: matchedWRS } = await supabase
          .from('webinar_request_sectors')
          .select('webinar_request_id')
          .in('sector_id', sectorIds);
        const matchedIds = [...new Set((matchedWRS || []).map((wr: { webinar_request_id: string }) => wr.webinar_request_id))];

        if (matchedIds.length > 0) {
          // 3. Fetch those requests, EXCLUDING:
          //    - Own proposals (moderator can't review their own)
          //    - Proposals from other moderators
          const { data: allData } = await supabase
            .from('webinar_requests')
            .select('*')
            .in('id', matchedIds)
            .neq('user_id', user.id)
            .order('created_at', { ascending: false });

          // Filter out proposals from other moderators (check via profiles table)
          if (allData && allData.length > 0) {
            const userIds = [...new Set(allData.map((r: WebinarRequest) => r.user_id))];
            const { data: profiles } = await supabase
              .from('profiles')
              .select('user_id, persona')
              .in('user_id', userIds);
            const moderatorUserIds = new Set(
              (profiles || [])
                .filter((p: { persona: string }) => p.persona === 'moderator')
                .map((p: { user_id: string }) => p.user_id)
            );
            setRequests(allData.filter((r: WebinarRequest) => !moderatorUserIds.has(r.user_id)));
          } else {
            setRequests([]);
          }
        } else {
          setRequests([]);
        }
      } else {
        setRequests([]);
      }
    } else {
      setRequests([]);
      setMyProposals([]);
    }

    setLoading(false);
  };

  const updateStatus = async (id: string, status: string) => {
    await supabase.from('webinar_requests').update({
      status,
      reviewed_at: new Date().toISOString(),
    }).eq('id', id);

    // When accepted (admin), auto-create an event from the webinar request
    if (status === 'accepted' && isAdmin) {
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

    toast({ title: `Status updated: ${status}` });
    loadRequests();
  };

  // Moderator pre-validation: approve as moderator (before admin final approval)
  const moderatorApprove = async (id: string) => {
    await supabase.from('webinar_requests').update({
      status: 'moderator_approved',
      moderator_notes: moderatorNotes.trim() || null,
      reviewed_at: new Date().toISOString(),
    }).eq('id', id);
    toast({ title: 'Pre-approved — sent to admin for final validation' });
    setSelected(null);
    loadRequests();
  };

  const saveNotes = async () => {
    if (!selected) return;
    await supabase.from('webinar_requests').update({
      moderator_notes: moderatorNotes.trim() || null,
    }).eq('id', selected.id);
    toast({ title: t('admin.webinarRequests.notesSaved') });
    setSelected(null);
    loadRequests();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      submitted: 'bg-yellow-100 text-yellow-700',
      under_review: 'bg-blue-100 text-blue-700',
      moderator_approved: 'bg-emerald-100 text-emerald-700',
      accepted: 'bg-green-100 text-green-700',
      rejected: 'bg-red-100 text-red-700',
    };
    return <Badge className={`${colors[status] || 'bg-gray-100 text-gray-700'} border-0`}>{status.replace('_', ' ')}</Badge>;
  };

  const RequestTable = ({ data, showActions }: { data: WebinarRequest[]; showActions: boolean }) => (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left p-4 font-medium">{t('admin.userDetail.name')}</th>
                <th className="text-left p-4 font-medium">{t('admin.webinarRequests.lang')}</th>
                <th className="text-left p-4 font-medium">{t('admin.status')}</th>
                <th className="text-left p-4 font-medium">{t('admin.webinarRequests.date')}</th>
                {showActions && <th className="text-left p-4 font-medium">{t('admin.actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id} className="border-b hover:bg-gray-50">
                  <td className="p-4 font-medium max-w-xs truncate">{r.title}</td>
                  <td className="p-4">{r.preferred_language}</td>
                  <td className="p-4">
                    {showActions && isAdmin ? (
                      <Select value={r.status} onValueChange={(v) => updateStatus(r.id, v)}>
                        <SelectTrigger className="w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="submitted">{t('admin.webinarRequests.statusSubmitted')}</SelectItem>
                          <SelectItem value="under_review">{t('admin.webinarRequests.statusUnderReview')}</SelectItem>
                          <SelectItem value="moderator_approved">Moderator Approved</SelectItem>
                          <SelectItem value="accepted">{t('admin.webinarRequests.statusAccepted')}</SelectItem>
                          <SelectItem value="rejected">{t('admin.webinarRequests.statusRejected')}</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      statusBadge(r.status)
                    )}
                  </td>
                  <td className="p-4 text-gray-500">{new Date(r.created_at).toLocaleDateString()}</td>
                  {showActions && (
                    <td className="p-4 flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => { setSelected(r); setModeratorNotes(r.moderator_notes || ''); }}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      {isMod && (r.status === 'submitted' || r.status === 'under_review') && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-emerald-600 hover:text-emerald-700"
                          onClick={() => { setSelected(r); setModeratorNotes(r.moderator_notes || ''); }}
                          title="Pre-approve"
                        >
                          <CheckCircle className="h-4 w-4" />
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {data.length === 0 && (
                <tr>
                  <td colSpan={showActions ? 5 : 4} className="p-8 text-center text-gray-400">
                    {t('admin.webinarRequests.noRequests')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold">
          {isAdmin ? t('admin.webinarRequests.title') : 'Webinar Proposals'}
          {' '}({requests.length})
        </h1>
        {isMod && (
          <Badge variant="outline" className="text-xs">
            {t('admin.webinarRequests.filteredBySectors')}
          </Badge>
        )}
      </div>

      {/* Moderator tab switcher: Review / My Proposals */}
      {isMod && (
        <div className="flex gap-2 mb-6">
          <Button
            variant={tab === 'review' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTab('review')}
          >
            Review Proposals ({requests.length})
          </Button>
          <Button
            variant={tab === 'my' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTab('my')}
          >
            My Proposals ({myProposals.length})
          </Button>
        </div>
      )}

      {/* Admin: single table; Moderator: tab-based */}
      {isAdmin ? (
        <RequestTable data={requests} showActions />
      ) : tab === 'review' ? (
        <RequestTable data={requests} showActions />
      ) : (
        <RequestTable data={myProposals} showActions={false} />
      )}

      {/* Detail / Notes Dialog */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('admin.webinarRequests.dialogTitle')}</DialogTitle>
            <DialogDescription>{t('admin.webinarRequests.dialogDesc')}</DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 mt-2">
              <div>
                <strong>{t('admin.userDetail.name')}:</strong> {selected.title}
              </div>
              <div>
                <strong>{t('admin.userDetail.description')}:</strong>
                <p className="mt-1 p-3 bg-gray-50 rounded text-sm whitespace-pre-wrap">
                  {selected.description}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t('admin.webinarRequests.moderatorNotes')}</Label>
                <Textarea
                  value={moderatorNotes}
                  onChange={(e) => setModeratorNotes(e.target.value)}
                  rows={3}
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={saveNotes} className="flex-1">
                  {t('admin.webinarRequests.saveNotes')}
                </Button>
                {isMod && (selected.status === 'submitted' || selected.status === 'under_review') && (
                  <Button
                    onClick={() => moderatorApprove(selected.id)}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                  >
                    Pre-approve
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
