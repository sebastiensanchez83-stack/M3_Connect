import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ExternalLink, History, Info, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ADMIN_BTN, ADMIN_BTN_PRIMARY, AdminDetailHeader, AdminLoading, AdminPageHeader, AdminPanel, AdminSectionLabel, AdminStatusPill,
} from '@/components/admin/AdminUI';
import { ActionCue } from '@/components/home/dashboard/DashboardKit';
import { toast } from '@/hooks/use-toast';
import { refreshSiteContent } from '@/lib/siteContent/load';
import { SITE_PREVIEW_PARAM, SITE_PREVIEW_STORAGE, type SiteContentBody, type SiteContentKind } from '@/lib/siteContent/store';
import { cn } from '@/lib/utils';
import {
  fetchContentRows, fetchHistory, fetchNames, publishDraft, publishedBody, sameBody, stateAt, versionsOf,
  type ContentRow, type Draft, type HistoryRow,
} from './sitePages/api';
import { HELP_KEY, HERO_KEY, HelpEditor, HomeHeroEditor, LegalEditor, TextSectionsEditor, buildHelpDefs, helpTextKeys, type EditorApi } from './sitePages/Editors';
import { SITE_PAGES, buildTextSections, sitePage, type SitePageDef } from './sitePages/registry';

/**
 * Admin > Site content > Site pages (Oct 2026): change the public pages' text
 * without code. /admin/site-pages lists the pages; /admin/site-pages/<id>
 * edits one: its texts (the home hero's photo or video and featured event, the
 * help centre's questions, a legal page's body), a preview on the real page,
 * Publish, and the page's history with "Restore this version".
 *
 * Changes wait in this browser (localStorage, per page) until Publish, which
 * writes them all at once through site_content_publish (staff only) with one
 * history entry each. The site shows them on its next read of the table; with
 * nothing published every page keeps its code's text. Before the database file
 * is applied, the screen says so and Publish stays off.
 *
 * Routes (wired in AdminPage): /site-pages and /site-pages/:pageId. Staff
 * (admins and moderators): the database checks is_moderator() itself.
 */

const BASE = '/admin/site-pages';
const draftStorageKey = (id: string) => `smc-site-draft:${id}`;

function fmtDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

export function SitePagesPage() {
  const { pageId } = useParams();
  const page = sitePage(pageId);
  if (pageId && !page) return <Navigate to={BASE} replace />;
  return page ? <PageEditor key={page.id} page={page} /> : <PageList />;
}

export default SitePagesPage;

/* ─── The list of pages ──────────────────────────────────────────── */

function NotInstalled() {
  return (
    <AdminPanel className="mb-6 border-navy/30 bg-foam" padded>
      <p className="flex items-start gap-2 text-[14px] leading-6 text-ink">
        <Info className="mt-1 h-4 w-4 shrink-0 text-teal" aria-hidden="true" />
        The database part of this screen is not installed yet. You can open the pages and prepare changes;
        Publish works once it is installed. Until then the site shows the text written in the code.
      </p>
    </AdminPanel>
  );
}

function PageList() {
  const [loading, setLoading] = useState(true);
  const [installed, setInstalled] = useState(true);
  const [last, setLast] = useState<Record<string, { at: string; by: string | null }>>({});
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      const [{ installed: ok }, history] = await Promise.all([fetchContentRows(), fetchHistory(undefined, 1000)]);
      const byPage: Record<string, { at: string; by: string | null }> = {};
      for (const h of history) if (!byPage[h.page]) byPage[h.page] = { at: h.changed_at, by: h.changed_by };
      const who = await fetchNames(Object.values(byPage).map((v) => v.by ?? ''));
      if (!alive) return;
      setInstalled(ok);
      setLast(byPage);
      setNames(who);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const groups: { id: SitePageDef['group']; title: string }[] = [
    { id: 'pages', title: 'Pages' },
    { id: 'help', title: 'Help centre' },
    { id: 'legal', title: 'Legal pages' },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Site pages"
        description="Change the text of the public pages without code. Nothing changes on the site until you press Publish, and every version can be restored."
      />
      {!installed && <NotInstalled />}
      {loading ? <AdminLoading /> : groups.map((g) => (
        <section key={g.id} className="mb-8">
          <AdminSectionLabel>{g.title}</AdminSectionLabel>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {SITE_PAGES.filter((p) => p.group === g.id).map((p) => {
              const l = last[p.id];
              return (
                <li key={p.id}>
                  <Link
                    to={`${BASE}/${p.id}`}
                    className="group flex h-full flex-col rounded-card border border-rule bg-white p-5 transition-colors hover:border-navy/50 focus:outline-none focus-visible:shadow-focus"
                  >
                    <span className="text-[17px] font-semibold leading-6 text-navy">{p.name}</span>
                    <span className="mt-0.5 text-[13px] leading-5 text-meta">smartmarinaconnect.com{p.path}</span>
                    <span className="mt-2 flex-1 text-[14px] leading-5 text-ink">{p.description}</span>
                    <span className="mt-3 text-[13px] leading-5 text-meta">
                      {l ? `Last published ${fmtDate(l.at)}${l.by && names[l.by] ? ` by ${names[l.by]}` : ''}` : 'Original text (never changed here)'}
                    </span>
                    <ActionCue className="mt-4 self-start" size="sm">Edit this page</ActionCue>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/* ─── One page ───────────────────────────────────────────────────── */

function readStoredDraft(id: string): Draft {
  try {
    const raw = window.localStorage.getItem(draftStorageKey(id));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Draft) : {};
  } catch {
    return {};
  }
}

function PageEditor({ page }: { page: SitePageDef }) {
  const [rows, setRows] = useState<Map<string, ContentRow> | null>(null);
  const [installed, setInstalled] = useState(true);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Draft>(() => readStoredDraft(page.id));
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    const [content, hist] = await Promise.all([fetchContentRows(), fetchHistory(page.id)]);
    setRows(content.rows);
    setInstalled(content.installed);
    setLoadError(content.error);
    setHistory(hist);
    setNames(await fetchNames(hist.map((h) => h.changed_by ?? '')));
  }, [page.id]);

  useEffect(() => { void load(); }, [load]);

  // The changes wait in this browser until Publish (and follow into an open preview tab).
  useEffect(() => {
    try {
      if (Object.keys(draft).length) window.localStorage.setItem(draftStorageKey(page.id), JSON.stringify(draft));
      else window.localStorage.removeItem(draftStorageKey(page.id));
    } catch { /* storage blocked: the changes live until the tab closes */ }
    if (previewing) writePreview(draft);
  }, [draft, page.id, previewing]);

  // Once the published rows are in, drop stored changes that are live already.
  useEffect(() => {
    if (!rows) return;
    setDraft((d) => {
      const next: Draft = {};
      for (const [k, v] of Object.entries(d)) if (!sameBody(v.body, publishedBody(rows, k))) next[k] = v;
      return Object.keys(next).length === Object.keys(d).length ? d : next;
    });
  }, [rows]);

  const api: EditorApi = useMemo(() => ({
    value: (key) => (key in draft ? draft[key].body : rows ? publishedBody(rows, key) : null),
    isDraft: (key) => key in draft,
    set: (key: string, kind: SiteContentKind, body: SiteContentBody | null) => {
      setConfirming(false);
      setDraft((d) => {
        const live = rows ? publishedBody(rows, key) : null;
        const next = { ...d };
        if (sameBody(body, live)) delete next[key];
        else next[key] = { kind, body };
        return next;
      });
    },
  }), [draft, rows]);

  const textSections = useMemo(() => (page.editor === 'text' || page.editor === 'home' ? buildTextSections(page) : []), [page]);
  const helpKeys = useMemo(() => (page.editor === 'help' ? [...helpTextKeys(buildHelpDefs()), HELP_KEY] : []), [page]);

  /** Every block this page owns: what "Original text" puts back. */
  const pageKeys = useMemo(() => {
    const keys = new Set<string>(history.map((h) => h.key));
    textSections.forEach((s) => s.fields.forEach((f) => keys.add(`text:${f.key}`)));
    if (page.editor === 'home') keys.add(HERO_KEY);
    helpKeys.forEach((k) => keys.add(k));
    if (page.legal) keys.add(page.legal.key);
    return [...keys];
  }, [history, textSections, helpKeys, page]);

  const count = Object.keys(draft).length;
  const versions = useMemo(() => versionsOf(history), [history]);
  const liveChanged = rows ? pageKeys.some((k) => publishedBody(rows, k)) : false;

  function writePreview(d: Draft) {
    try {
      window.localStorage.setItem(SITE_PREVIEW_STORAGE, JSON.stringify({
        at: Date.now(),
        page: page.id,
        items: Object.entries(d).map(([key, v]) => ({ key, kind: v.kind, body: v.body })),
      }));
    } catch { /* storage blocked: the preview shows the live page */ }
  }

  const preview = () => {
    writePreview(draft);
    setPreviewing(true);
    window.open(`${page.path}${page.path.includes('?') ? '&' : '?'}${SITE_PREVIEW_PARAM}=1`, '_blank');
  };

  const publish = async () => {
    if (!count || busy) return;
    setBusy(true);
    const res = await publishDraft(page.id, draft, note);
    setBusy(false);
    setConfirming(false);
    if (!res.ok) {
      toast({ title: 'Not published', description: res.message, variant: 'destructive' });
      return;
    }
    setDraft({});
    setNote('');
    toast({ title: 'Published', description: 'Visitors see the new version now.' });
    await load();
    void refreshSiteContent();
  };

  const discard = () => {
    setDraft({});
    setConfirming(false);
  };

  const restore = (lastId: number | null) => {
    const state = lastId === null ? null : stateAt(history, lastId);
    for (const key of pageKeys) {
      const item = state?.get(key);
      const kind: SiteContentKind = item?.kind ?? (key.startsWith('text:') ? 'text' : page.legal ? 'rich' : 'json');
      api.set(key, kind, item?.body ?? null);
    }
    toast({
      title: lastId === null ? 'Original text loaded' : 'Version loaded',
      description: 'Check it on the left or with Preview, then press Publish.',
    });
  };

  if (!rows) return <AdminLoading />;

  const publishBox = (
    <AdminPanel title="Publish" icon={undefined}>
      {count === 0 ? (
        <p className="text-[14px] leading-6 text-meta">
          No change yet. Change a text and it waits here, in this browser, until you publish.
        </p>
      ) : (
        <>
          <p className="text-[15px] font-semibold leading-6 text-navy">
            {count === 1 ? '1 change not published yet' : `${count} changes not published yet`}
          </p>
          <label htmlFor="site-publish-note" className="mt-3 block text-[13px] font-semibold text-navy">What did you change? (optional, for the history)</label>
          <Input id="site-publish-note" className="mt-1" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="New dates for the Summit" />
        </>
      )}
      <div className="mt-4 grid gap-2">
        <Button type="button" variant="outline" size="sm" className={ADMIN_BTN} onClick={preview}>
          Preview on the site (new tab)
        </Button>
        {confirming ? (
          <div className="grid gap-2 rounded-field bg-foam p-3">
            <p className="text-[14px] leading-5 text-navy">Publish now? Visitors see it at once. You can restore the previous version from the history.</p>
            <Button type="button" size="sm" className={ADMIN_BTN_PRIMARY} onClick={publish} disabled={busy}>
              {busy ? 'Publishing…' : 'Yes, publish'}
            </Button>
            <Button type="button" variant="outline" size="sm" className={ADMIN_BTN} onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            className={ADMIN_BTN_PRIMARY}
            onClick={() => setConfirming(true)}
            disabled={!count || !installed}
            title={!installed ? 'The database part is not installed yet' : undefined}
          >
            {count ? `Publish ${count === 1 ? 'this change' : `these ${count} changes`}` : 'Publish'}
          </Button>
        )}
        {count > 0 && (
          <button type="button" onClick={discard} className="min-h-10 rounded-pill text-[14px] font-semibold text-navy underline decoration-gold-text decoration-2 underline-offset-2 hover:bg-chip focus:outline-none focus-visible:shadow-focus">
            Discard my changes
          </button>
        )}
      </div>
    </AdminPanel>
  );

  const historyBox = (
    <AdminPanel title="History" icon={History} padded={false}>
      {versions.length === 0 ? (
        <p className="px-5 py-4 text-[14px] leading-6 text-meta">Nothing published from here yet: the page shows the text written in the code.</p>
      ) : (
        <ol className="divide-y divide-rule">
          {(showAll ? versions : versions.slice(0, 8)).map((v, i) => (
            <li key={v.batchId} className="px-5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-semibold text-navy">{fmtDate(v.at)}</span>
                {i === 0 && <AdminStatusPill tone="success">Live now</AdminStatusPill>}
              </div>
              <p className="mt-0.5 text-[13px] leading-5 text-meta">
                {v.by && names[v.by] ? names[v.by] : 'M3 team'} · {v.count === 1 ? '1 change' : `${v.count} changes`}
                {v.note ? ` · “${v.note}”` : ''}
              </p>
              {i > 0 && (
                <button
                  type="button"
                  onClick={() => restore(v.lastId)}
                  className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-pill border border-navy/55 bg-white px-3 text-[14px] font-semibold text-navy hover:border-navy hover:bg-chip focus:outline-none focus-visible:shadow-focus"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  Restore this version
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
      {versions.length > 8 && !showAll && (
        <button type="button" onClick={() => setShowAll(true)} className="w-full border-t border-rule px-5 py-3 text-left text-[14px] font-semibold text-navy hover:bg-chip">
          Show all {versions.length} versions
        </button>
      )}
      {liveChanged && (
        <div className="border-t border-rule px-5 py-3">
          <button
            type="button"
            onClick={() => restore(null)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-pill border border-navy/55 bg-white px-3 text-[14px] font-semibold text-navy hover:border-navy hover:bg-chip focus:outline-none focus-visible:shadow-focus"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Back to the original text of the whole page
          </button>
        </div>
      )}
    </AdminPanel>
  );

  return (
    <div className={cn(count > 0 && 'pb-24 lg:pb-0')}>
      <AdminDetailHeader
        back={{ to: BASE, label: 'All site pages' }}
        title={page.name}
        subtitle={`smartmarinaconnect.com${page.path}`}
        badges={count > 0 ? <AdminStatusPill tone="navy">{count} not published</AdminStatusPill> : undefined}
        actions={(
          <a href={page.path} target="_blank" rel="noopener noreferrer" className="group rounded-pill focus:outline-none focus-visible:shadow-focus">
            <ActionCue size="sm">
              See the live page
              <ExternalLink className="ml-1 inline h-3.5 w-3.5" aria-hidden="true" />
            </ActionCue>
          </a>
        )}
      />
      {!installed && <NotInstalled />}
      {loadError && (
        <AdminPanel className="mb-6" padded>
          <p className="text-[14px] text-red-700">The published texts could not be read ({loadError}). Reload the page before publishing.</p>
        </AdminPanel>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="min-w-0">
          {page.editor === 'home' && (
            <div className="grid gap-5">
              <TextSectionsEditor sections={textSections} api={api} />
              <HomeHeroEditor api={api} />
            </div>
          )}
          {page.editor === 'text' && <TextSectionsEditor sections={textSections} api={api} />}
          {page.editor === 'help' && <HelpEditor api={api} />}
          {page.editor === 'legal' && <LegalEditor page={page} api={api} />}
        </div>
        <aside className="grid gap-5 lg:sticky lg:top-40">
          {publishBox}
          {historyBox}
        </aside>
      </div>

      {/* Phones and tablets: Publish stays in reach under a long page. */}
      {count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-rule bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
          <span className="text-[14px] font-semibold text-navy">{count === 1 ? '1 change' : `${count} changes`} not published</span>
          <Button
            type="button"
            size="sm"
            className={ADMIN_BTN_PRIMARY}
            onClick={() => { setConfirming(true); document.getElementById('site-publish-note')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}
          >
            Publish…
          </Button>
        </div>
      )}
    </div>
  );
}
