import { useState, useEffect, useMemo } from 'react';
import { Download, RefreshCw, TrendingUp, Users, FileText, Newspaper, Link2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { PressResourcesEditor } from '@/components/media/PressResourcesEditor';

// Who downloaded which press resource, and when. Reads media_download_log —
// RLS already restricts it to admins (and the Yacht Club for its own events),
// so no extra gate is needed here.

interface LogRow {
  id: string; created_at: string; user_id: string;
  organization_id: string | null; event_id: string | null;
  resource_type: string; resource_id: string | null; resource_ref: string | null; label: string | null;
  organizations: { name: string } | null;
}
interface Person { first_name: string | null; last_name: string | null; email: string | null }
interface CoverageRow {
  id: string; url: string; outlet: string | null; title: string | null;
  published_at: string | null; organizations: { name: string } | null;
}

const TYPE_LABEL: Record<string, string> = {
  article: 'Article', press_release: 'Press release', photo_link: 'Photos',
};

export function AdminMediaDownloads() {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [people, setPeople] = useState<Record<string, Person>>({});
  const [coverage, setCoverage] = useState<CoverageRow[]>([]);
  const [eventId, setEventId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  const load = async () => {
    setLoading(true);
    // organizations embeds via its FK; user_id has none, so names are fetched
    // in a second pass rather than through a join PostgREST can't resolve.
    const { data } = await supabase
      .from('media_download_log')
      .select('id, created_at, user_id, organization_id, event_id, resource_type, resource_id, resource_ref, label, organizations(name)')
      .order('created_at', { ascending: false })
      .limit(500);
    const list = (data || []) as unknown as LogRow[];
    setRows(list);

    const ids = [...new Set(list.map(r => r.user_id))];
    if (ids.length) {
      const { data: profs } = await supabase.from('profiles')
        .select('user_id, first_name, last_name, email').in('user_id', ids);
      const map: Record<string, Person> = {};
      for (const p of (profs || []) as ({ user_id: string } & Person)[]) {
        map[p.user_id] = { first_name: p.first_name, last_name: p.last_name, email: p.email };
      }
      setPeople(map);
    }

    const [cov, ev] = await Promise.all([
      supabase.from('media_coverage')
        .select('id, url, outlet, title, published_at, organizations(name)')
        .order('published_at', { ascending: false, nullsFirst: false }),
      supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle(),
    ]);
    setCoverage((cov.data || []) as unknown as CoverageRow[]);
    setEventId((ev.data as { id: string } | null)?.id || null);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const term = q.trim().toLowerCase();
  const shown = useMemo(() => rows.filter(r => {
    if (!term) return true;
    const p = people[r.user_id];
    const who = `${p?.first_name || ''} ${p?.last_name || ''} ${p?.email || ''}`;
    return `${who} ${r.organizations?.name || ''} ${r.label || ''}`.toLowerCase().includes(term);
  }), [rows, term, people]);

  const topResources = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) { const k = r.label || r.resource_ref || '—'; m.set(k, (m.get(k) || 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [rows]);

  const uniqueReaders = useMemo(() => new Set(rows.map(r => r.user_id)).size, [rows]);

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
        <Newspaper className="h-6 w-6 text-primary" /> Press
      </h1>
      <p className="text-sm text-gray-500 -mt-2">
        Press material, what accredited media downloaded, and the coverage they published.
      </p>

      {/* Press material for our own events — hosted here rather than linked out. */}
      {eventId && (
        <Card><CardContent className="pt-6 space-y-2">
          <div className="text-sm font-medium flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" /> Press material
          </div>
          <p className="text-xs text-gray-500 -mt-1">
            Link out to an organiser's site, or host the documents here — several are fine, typically
            one per language. Accredited media see them in their press room.
          </p>
          <PressResourcesEditor eventId={eventId} />
        </CardContent></Card>
      )}

      {/* Coverage report — what the press actually published. */}
      <Card><CardContent className="pt-6">
        <div className="text-sm font-medium flex items-center gap-2 mb-2">
          <Link2 className="h-4 w-4 text-primary" /> Coverage report ({coverage.length})
        </div>
        {coverage.length === 0 ? (
          <p className="text-xs text-gray-400">No coverage declared yet.</p>
        ) : (
          <div className="divide-y divide-gray-100 max-h-72 overflow-y-auto">
            {coverage.map(c => (
              <div key={c.id} className="py-2">
                <a href={c.url} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline truncate block">
                  {c.title || c.url}
                </a>
                <div className="text-xs text-gray-500">
                  {[c.outlet, c.organizations?.name, c.published_at ? new Date(c.published_at).toLocaleDateString('en-GB') : null]
                    .filter(Boolean).join(' · ')}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent></Card>

      <div className="text-sm font-semibold text-gray-700 flex items-center gap-2 pt-2">
        <Download className="h-4 w-4 text-primary" /> Downloads
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-2 text-xs text-gray-400 uppercase tracking-wide"><Download className="h-3.5 w-3.5" /> Downloads</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{rows.length}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-2 text-xs text-gray-400 uppercase tracking-wide"><Users className="h-3.5 w-3.5" /> Media</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{uniqueReaders}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-2 text-xs text-gray-400 uppercase tracking-wide"><TrendingUp className="h-3.5 w-3.5" /> Top item</div>
          <div className="text-sm font-semibold text-gray-900 mt-1.5 truncate">{topResources[0]?.[0] || '—'}</div>
        </CardContent></Card>
      </div>

      {topResources.length > 1 && (
        <Card><CardContent className="pt-6">
          <div className="text-sm font-medium flex items-center gap-2 mb-2"><FileText className="h-4 w-4 text-primary" /> Most downloaded</div>
          <div className="space-y-1.5">
            {topResources.map(([label, n]) => (
              <div key={label} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-gray-700 truncate">{label}</span>
                <Badge variant="secondary" className="shrink-0">{n}</Badge>
              </div>
            ))}
          </div>
        </CardContent></Card>
      )}

      <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by media, outlet or item" className="max-w-sm" />

      <Card><CardContent className="p-0">
        {shown.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400">
            {rows.length === 0 ? 'No downloads recorded yet.' : 'No match.'}
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {shown.map(r => {
              const p = people[r.user_id];
              const who = [p?.first_name, p?.last_name].filter(Boolean).join(' ') || p?.email || '—';
              return (
                <div key={r.id} className="px-4 py-2.5 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm text-gray-900 truncate">{r.label || r.resource_ref || '—'}</div>
                    <div className="text-xs text-gray-500">
                      {who}{r.organizations?.name ? ` · ${r.organizations.name}` : ''}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <Badge variant="outline" className="text-[10px]">{TYPE_LABEL[r.resource_type] || r.resource_type}</Badge>
                    <div className="text-[11px] text-gray-400 mt-0.5">
                      {new Date(r.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent></Card>
    </div>
  );
}
