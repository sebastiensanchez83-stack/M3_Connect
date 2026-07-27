import { useState, useEffect, useCallback } from 'react';
import { Loader2, Check, X, HelpCircle, Newspaper, ExternalLink, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { PressResourcesEditor } from '@/components/media/PressResourcesEditor';

// Press accreditation, handled by the Yacht Club on its own console.
// Writes go through sm_partner_set_media_status (SECURITY DEFINER), which checks
// the caller is the yacht_club partner of that event and that the role really is
// `media` — the table itself stays closed to direct writes, and M3 keeps
// supervision + veto from the admin registration sheet.

interface PressRow {
  id: string;                 // role_assignment id
  status: string;
  module_data: Record<string, unknown> | null;
  registration: {
    id: string; first_name: string | null; last_name: string | null;
    email: string | null; company_name: string | null; country: string | null;
  } | null;
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  self_submitted: { label: 'À traiter', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  needs_info: { label: 'Infos demandées', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  info_provided: { label: 'Infos fournies', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  confirmed: { label: 'Accrédité', cls: 'bg-green-50 text-green-700 border-green-200' },
  declined: { label: 'Refusé', cls: 'bg-gray-100 text-gray-500 border-gray-200' },
};

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function SM26PartnerPressRequests({ eventId }: { eventId: string }) {
  const [rows, setRows] = useState<PressRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<{ id: string; url: string; outlet: string | null; title: string | null; published_at: string | null }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const [ra, cov] = await Promise.all([
      supabase.from('sm_role_assignment')
        .select('id, status, module_data, registration:sm_registration(id, first_name, last_name, email, company_name, country)')
        .eq('event_id', eventId).eq('role', 'media'),
      supabase.from('media_coverage')
        .select('id, url, outlet, title, published_at').eq('event_id', eventId)
        .order('published_at', { ascending: false, nullsFirst: false }),
    ]);
    setRows(((ra.data || []) as unknown as PressRow[]).filter(r => r.registration));
    setCoverage((cov.data || []) as typeof coverage);
    setLoading(false);
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  const setStatus = async (id: string, status: string) => {
    setBusy(id);
    const { error } = await supabase.rpc('sm_partner_set_media_status', {
      p_role_assignment_id: id, p_status: status,
    });
    setBusy(null);
    if (error) { toast({ title: 'Action impossible', description: error.message, variant: 'destructive' }); return; }
    toast({
      title: status === 'confirmed' ? 'Accréditation confirmée'
        : status === 'declined' ? 'Demande refusée' : 'Informations demandées',
    });
    load();
  };

  if (loading) return <div className="py-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-300" /></div>;

  const pending = rows.filter(r => ['self_submitted', 'needs_info', 'info_provided'].includes(r.status));
  const handled = rows.filter(r => !['self_submitted', 'needs_info', 'info_provided'].includes(r.status));

  const row = (r: PressRow) => {
    const reg = r.registration!;
    const md = r.module_data || {};
    const name = [reg.first_name, reg.last_name].filter(Boolean).join(' ') || reg.email || '—';
    const outlet = str(md.outlet) || reg.company_name;
    const meta = STATUS_META[r.status] || { label: r.status, cls: 'bg-gray-100 text-gray-600 border-gray-200' };
    const socials = (md.social_links && typeof md.social_links === 'object' && !Array.isArray(md.social_links))
      ? md.social_links as Record<string, string> : {};
    const open = ['self_submitted', 'needs_info', 'info_provided'].includes(r.status);

    return (
      <div key={r.id} className="rounded-lg border border-gray-100 px-3 py-2.5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="font-medium text-gray-900 flex items-center gap-2">
              {name}
              <Badge variant="outline" className={`text-[10px] ${meta.cls}`}>{meta.label}</Badge>
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              {outlet && <span className="font-medium text-gray-600">{outlet}</span>}
              {reg.country && <span> · {reg.country}</span>}
              {reg.email && <span> · {reg.email}</span>}
            </div>
            {Object.keys(socials).length > 0 && (
              <div className="flex flex-wrap gap-2 mt-1">
                {Object.entries(socials).filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => (
                  <a key={k} href={/^https?:\/\//i.test(v) ? v : `https://${v}`} target="_blank" rel="noreferrer"
                    className="text-[11px] text-primary inline-flex items-center gap-0.5">
                    <ExternalLink className="h-3 w-3" /> {k}
                  </a>
                ))}
              </div>
            )}
          </div>
          {open && (
            <div className="flex items-center gap-1.5 shrink-0">
              <Button size="sm" className="gap-1" disabled={busy === r.id} onClick={() => setStatus(r.id, 'confirmed')}>
                {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Accréditer
              </Button>
              <Button size="sm" variant="outline" className="gap-1" disabled={busy === r.id} onClick={() => setStatus(r.id, 'needs_info')}>
                <HelpCircle className="h-3.5 w-3.5" /> Infos
              </Button>
              <Button size="sm" variant="ghost" className="gap-1 text-gray-500" disabled={busy === r.id} onClick={() => setStatus(r.id, 'declined')}>
                <X className="h-3.5 w-3.5" /> Refuser
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {rows.length === 0 && (
        <p className="text-sm text-gray-400">Aucune demande d'accréditation presse pour le moment.</p>
      )}

      {pending.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-gray-600 flex items-center gap-1.5">
            <Newspaper className="h-3.5 w-3.5 text-primary" /> À traiter ({pending.length})
          </div>
          {pending.map(row)}
        </div>
      )}
      {handled.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-gray-500">Traitées ({handled.length})</div>
          {handled.map(row)}
        </div>
      )}
      <p className="text-[11px] text-gray-400">
        M3 supervise ces accréditations et peut les modifier depuis la console d'administration.
      </p>

      {/* Press material — link out to your own site, or host the documents here
          (several are fine, e.g. one per language). */}
      <div className="border-t border-gray-100 pt-3 space-y-2">
        <div className="text-xs font-semibold text-gray-600 flex items-center gap-1.5">
          <Link2 className="h-3.5 w-3.5 text-primary" /> Espace presse — photos et communiqués
        </div>
        <p className="text-[11px] text-gray-500 -mt-1">
          Ce que vous publiez ici apparaît dans l'espace presse des journalistes accrédités.
        </p>
        <PressResourcesEditor eventId={eventId} french />
      </div>

      {/* What the press actually published about the event. */}
      {coverage.length > 0 && (
        <div className="border-t border-gray-100 pt-3 space-y-1.5">
          <div className="text-xs font-semibold text-gray-600">Retombées presse ({coverage.length})</div>
          {coverage.map(c => (
            <div key={c.id} className="rounded-lg border border-gray-100 px-3 py-2">
              <a href={c.url} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline truncate block">
                {c.title || c.url}
              </a>
              <div className="text-xs text-gray-500">
                {c.outlet}{c.outlet && c.published_at ? ' · ' : ''}
                {c.published_at ? new Date(c.published_at).toLocaleDateString('fr-FR') : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
