import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, TrendingUp, Users, FileText, Link2, ExternalLink } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { PressResourcesEditor } from '@/components/media/PressResourcesEditor';
import {
  AdminEmpty, AdminFilterBar, AdminKpiCard, AdminLoading, AdminPageHeader, AdminPanel, AdminSectionLabel, AdminStatusPill,
} from './AdminUI';

// Who downloaded which press resource, and when. Reads media_download_log —
// RLS already restricts it to admins (and the Yacht Club for its own events),
// so no extra gate is needed here.
// Refonte admin style (Oct 2026): panels, figures, rows that stack on a phone; same reads as before.

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
  const { t } = useTranslation();
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

  if (loading) return <AdminLoading />;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        className="mb-0"
        title={t('adm2.press.title', 'Press')}
        description={t('adm2.press.desc', 'The press material of our events, what accredited media downloaded, and the articles they published.')}
      />

      {/* Press material for our own events — hosted here rather than linked out. */}
      {eventId && (
        <AdminPanel
          icon={FileText}
          title={t('adm2.press.material', 'Press material')}
          description={t('adm2.press.materialDesc', "Link to an organiser's site, or put the documents here (several are fine, usually one per language). Accredited media find them in their press room.")}
        >
          <PressResourcesEditor eventId={eventId} />
        </AdminPanel>
      )}

      {/* Coverage report — what the press actually published. */}
      <AdminPanel
        icon={Link2}
        title={t('adm2.press.coverage', 'Articles published ({{count}})', { count: coverage.length })}
        description={t('adm2.press.coverageDesc', 'What the media declared after the event. Each title opens the article in a new tab.')}
        padded={false}
      >
        {coverage.length === 0 ? (
          <p className="px-5 py-4 text-[14px] text-meta">{t('adm2.press.noCoverage', 'No article declared yet.')}</p>
        ) : (
          <ul className="max-h-80 divide-y divide-rule overflow-y-auto">
            {coverage.map(c => (
              <li key={c.id} className="px-5 py-3">
                <a
                  href={c.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex max-w-full items-start gap-1.5 text-[15px] font-semibold leading-5 text-teal-text underline decoration-teal/40 underline-offset-2 hover:text-navy focus:outline-none focus-visible:shadow-focus"
                >
                  <span className="min-w-0 [overflow-wrap:anywhere]">{c.title || c.url}</span>
                  <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="sr-only">{t('adm2.newTab', '(opens in a new tab)')}</span>
                </a>
                <p className="mt-0.5 text-[13px] leading-[18px] text-meta [overflow-wrap:anywhere]">
                  {[c.outlet, c.organizations?.name, c.published_at ? new Date(c.published_at).toLocaleDateString('en-GB') : null]
                    .filter(Boolean).join(' · ')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </AdminPanel>

      <section>
        <AdminSectionLabel icon={Download}>{t('adm2.press.downloads', 'Downloads')}</AdminSectionLabel>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <AdminKpiCard icon={Download} label={t('adm2.press.kpiDownloads', 'Downloads')} value={rows.length} />
          <AdminKpiCard icon={Users} label={t('adm2.press.kpiMedia', 'Media who downloaded')} value={uniqueReaders} />
          {/* The kpi card's look, with a name instead of a figure. */}
          <div className="min-w-0 rounded-card border border-rule bg-white p-4">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-chip text-navy">
              <TrendingUp className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <p className="mt-3 truncate text-[16px] font-semibold leading-8 text-navy" title={topResources[0]?.[0]}>{topResources[0]?.[0] || '—'}</p>
            <p className="mt-1 text-[13px] leading-[18px] text-meta">{t('adm2.press.kpiTop', 'Most downloaded item')}</p>
          </div>
        </div>

        {topResources.length > 1 && (
          <AdminPanel icon={FileText} title={t('adm2.press.top', 'Most downloaded')} className="mt-4">
            <ul className="space-y-2">
              {topResources.map(([label, n]) => (
                <li key={label} className="flex items-center justify-between gap-3 text-[14px]">
                  <span className="min-w-0 text-ink [overflow-wrap:anywhere]">{label}</span>
                  <AdminStatusPill className="tabular-nums">{n}</AdminStatusPill>
                </li>
              ))}
            </ul>
          </AdminPanel>
        )}

        <AdminFilterBar
          className="mb-0 mt-4"
          search={q}
          onSearchChange={setQ}
          searchPlaceholder={t('adm2.press.search', 'Search a person, a media outlet or an item…')}
        />

        <div className="mt-4 overflow-hidden rounded-card border border-rule bg-white">
          {shown.length === 0 ? (
            <AdminEmpty
              icon={Download}
              title={rows.length === 0 ? t('adm2.press.noDownloads', 'No download recorded yet') : t('adm2.press.noMatch', 'Nothing matches this search')}
            />
          ) : (
            <ul className="divide-y divide-rule">
              {shown.map(r => {
                const p = people[r.user_id];
                const who = [p?.first_name, p?.last_name].filter(Boolean).join(' ') || p?.email || '—';
                return (
                  <li key={r.id} className="flex flex-col gap-1.5 px-5 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                    <div className="min-w-0">
                      <p className="text-[14px] font-semibold leading-5 text-navy [overflow-wrap:anywhere]">{r.label || r.resource_ref || '—'}</p>
                      <p className="text-[13px] leading-[18px] text-meta [overflow-wrap:anywhere]">
                        {who}{r.organizations?.name ? ` · ${r.organizations.name}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end sm:gap-0.5">
                      <AdminStatusPill tone="info">{TYPE_LABEL[r.resource_type] || r.resource_type}</AdminStatusPill>
                      <span className="text-[12px] text-meta">
                        {new Date(r.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
