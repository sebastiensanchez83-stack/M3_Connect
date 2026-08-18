import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/lib/supabase';
import { CheckCircle2, XCircle, Loader2, ChevronDown, ChevronRight, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from '@/hooks/use-toast';

// Architecture jury without a login. The external architects on this jury will
// most probably never join the platform, so the whole scoresheet hangs off one
// unguessable per-reviewer token — the same shape as /sm26/jury/score, but for
// the anonymised architecture competition.
//
// Two ways in, and both matter: score on screen, or print the paper sheet,
// circle the grades in ink, post it back, and let M3 key it in through this
// same link. Nothing here may identify an entrant — anon_code and category
// only, and files are labelled "Panel 1 (A2)" because the filenames carry the
// architects' names.

interface Criterion { id: string; label: string; description: string | null; weight: number; critical: boolean }
interface Template { id: string; name: string; scale_min: number; scale_max: number; criteria: Criterion[] }
interface Review { status: string; confidence: number | null; coi_flag: boolean; total_score: number | null; scores: Record<string, { score: number | null; comment: string | null }> }
interface Entry { entry_id: string; anon_code: string; category: string; review: Review | null }
interface Payload {
  ok: boolean; error?: string;
  reviewer?: { name: string };
  template?: Template | null;
  entries?: Entry[];
}
// One file of one entry. No url: the edge function streams the bytes and hands back only an opaque
// index, because a signed url embeds the storage path and live paths carry the
// firm's name ("…/Cowan Architects_….pdf"). This competition is judged blind.
interface AssetFile { label: string; kind: string; is_image: boolean; idx: number }

const ERRORS: Record<string, string> = {
  missing_token: 'This link is incomplete. Please use the button in the email we sent you.',
  invalid_token: 'This link is no longer valid. Please ask Monaco Marina Management for a new one.',
  revoked: 'This link has been closed. Any score you already submitted still counts — contact Monaco Marina Management if you need it reopened.',
  no_template: 'Scoring is temporarily closed while the scorecard is updated. Please try again later.',
};

const CONFIDENCE = [{ v: 1, label: 'Low' }, { v: 2, label: 'Medium' }, { v: 3, label: 'High' }];
const LEAVE = 'You have changes on this entry that are not saved. Leave anyway?';

// The navbar and the dark footer would otherwise print on every sheet. Scoped
// through Helmet so it only applies while this page is mounted.
const PRINT_CSS = `
@media print {
  header, footer { display: none !important; }
  body { background: #fff !important; }
  @page { margin: 14mm; }
}
`;

type Draft = Record<string, { score: number | null; comment: string }>;

const scaleOf = (t: Template) => Array.from({ length: t.scale_max - t.scale_min + 1 }, (_, i) => t.scale_min + i);

// Same arithmetic as sm_architecture_save_score_by_token, so the number shown
// while scoring is the number that ends up stored.
const computeTotal = (t: Template, d: Draft) => {
  const sumW = t.criteria.reduce((s, c) => s + c.weight, 0);
  if (!sumW) return null;
  let weighted = 0; let scored = 0;
  for (const c of t.criteria) {
    const v = d[c.id]?.score;
    if (v == null) continue;
    weighted += (v / t.scale_max) * c.weight;
    scored += 1;
  }
  return scored ? Math.round((weighted / sumW) * 1000) / 10 : null;
};

export function SM26ArchitectureReviewPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [openEntry, setOpenEntry] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [confidence, setConfidence] = useState<number | null>(null);
  const [coi, setCoi] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [showSheet, setShowSheet] = useState(false);
  // The file manifest per entry, kept for the session — refetching on every
  // click would make paging through a dozen panels feel broken.
  const [files, setFiles] = useState<Record<string, AssetFile[]>>({});
  const [filesLoading, setFilesLoading] = useState<string | null>(null);
  const [viewIdx, setViewIdx] = useState(0);

  const load = useCallback(async () => {
    const { data: res, error } = await supabase.rpc('sm_architecture_review_by_token', { p_token: token });
    if (error) return { ok: false, error: 'server_error' } as Payload;
    return (res || { ok: false, error: 'unknown' }) as Payload;
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) { setData({ ok: false, error: 'missing_token' }); setLoading(false); return; }
      const res = await load();
      if (!cancelled) { setData(res); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [token, load]);

  // Keying twelve entries off a paper sheet is long work; a stray refresh
  // should not silently eat the one that was half typed.
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [dirty]);

  // The bytes come from the function itself, addressed by the opaque index it
  // gave us — so the storage path (and with it the firm's name) never reaches
  // the browser. Public function: no apikey, no session, the token is the gate.
  const fileUrl = (entryId: string, f: AssetFile) =>
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sm26-arch-review` +
    `?token=${encodeURIComponent(token)}&entry=${encodeURIComponent(entryId)}&i=${f.idx}`;

  const loadFiles = async (entryId: string) => {
    if (files[entryId]) return;
    setFilesLoading(entryId);
    const { data: res, error } = await supabase.functions.invoke('sm26-arch-review', { body: { token, entry_id: entryId } });
    setFilesLoading(null);
    const r = (res || {}) as { ok?: boolean; files?: AssetFile[] };
    if (error || !r.ok) {
      toast({ title: 'Could not open the project files', description: 'Please reload the page and try again.', variant: 'destructive' });
      return;
    }
    setFiles(p => ({ ...p, [entryId]: r.files || [] }));
  };

  // Opening an entry loads whatever was already saved for it, so a reviewer can
  // come back to a half-finished sheet without retyping.
  const openCard = (e: Entry) => {
    if (dirty && !window.confirm(LEAVE)) return;
    setDirty(false);
    if (openEntry === e.entry_id) { setOpenEntry(null); return; }
    const d: Draft = {};
    for (const c of data?.template?.criteria || []) {
      const prev = e.review?.scores?.[c.id];
      d[c.id] = { score: prev?.score ?? null, comment: prev?.comment || '' };
    }
    setDraft(d);
    setConfidence(e.review?.confidence ?? null);
    setCoi(!!e.review?.coi_flag);
    setViewIdx(0);
    setOpenEntry(e.entry_id);
    void loadFiles(e.entry_id);
  };

  const setScore = (cid: string, n: number) => {
    setDirty(true);
    setDraft(p => ({ ...p, [cid]: { score: p[cid]?.score === n ? null : n, comment: p[cid]?.comment || '' } }));
  };
  const setComment = (cid: string, comment: string) => {
    setDirty(true);
    setDraft(p => ({ ...p, [cid]: { score: p[cid]?.score ?? null, comment } }));
  };

  const save = async (e: Entry, submit: boolean) => {
    setSaving(e.entry_id);
    const scores: Record<string, { score: number | null; comment: string }> = {};
    for (const [cid, v] of Object.entries(draft)) scores[cid] = { score: v.score, comment: v.comment };
    const { data: res, error } = await supabase.rpc('sm_architecture_save_score_by_token', {
      p_token: token,
      p_entry_role_assignment_id: e.entry_id,
      p_scores: scores,
      p_confidence: confidence,
      p_coi: coi,
      p_submit: submit,
    });
    setSaving(null);
    const r = (res || {}) as { ok?: boolean; error?: string; missing?: number; total_score?: number };
    if (error || !r.ok) {
      // A revoked link is an M3 decision, not something the reviewer can fix —
      // say so instead of leaving them retrying a button.
      const known: Record<string, { title: string; description: string }> = {
        incomplete: { title: 'Score every criterion first', description: `${r.missing} still to score.` },
        revoked: { title: 'This link has been closed', description: 'Anything you already submitted still counts. Contact Monaco Marina Management to reopen it.' },
        invalid_token: { title: 'This link is no longer valid', description: 'Please ask Monaco Marina Management for a new one.' },
        not_an_entry: { title: 'That entry is not in this competition', description: 'Please reload the page and try again.' },
        no_template: { title: 'Scoring is temporarily closed', description: 'The scorecard is being updated. Please try again later.' },
      };
      const k = known[r.error || ''];
      toast({ title: k?.title || 'Could not save', description: k?.description || error?.message, variant: 'destructive' });
      return;
    }
    setDirty(false);
    toast({ title: submit ? `Submitted — ${r.total_score}/100` : 'Draft saved' });
    setData(await load());
    if (submit) setOpenEntry(null);
  };

  const tpl = data?.template || null;
  const entries = data?.entries || [];
  const reviewerName = data?.reviewer?.name || '';

  return (
    <div className="min-h-[70vh] bg-gray-50 px-4 py-10 print:bg-white print:p-0">
      <Helmet>
        <title>Architecture scoresheets — Smart Marina Rendezvous 2026</title>
        <style type="text/css">{PRINT_CSS}</style>
      </Helmet>

      <div className="max-w-3xl mx-auto print:hidden">
        {loading && (
          <div className="bg-white rounded-xl shadow-sm border p-8 text-center">
            <Loader2 className="h-10 w-10 text-primary animate-spin mx-auto mb-4" />
            <p className="text-sm text-gray-500">One moment…</p>
          </div>
        )}

        {!loading && data && !data.ok && (
          <div className="bg-white rounded-xl shadow-sm border p-8 text-center">
            <XCircle className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <h1 className="text-xl font-semibold text-gray-900 mb-2">We couldn't open your scoresheets</h1>
            <p className="text-sm text-gray-500">{ERRORS[data.error || ''] || 'Something went wrong. Please reply to the email and we will sort it out.'}</p>
          </div>
        )}

        {!loading && data?.ok && (
          <>
            <div className="bg-white rounded-xl shadow-sm border p-6 mb-4">
              <h1 className="text-2xl font-bold text-gray-900">Architecture competition — your scoresheets</h1>
              <p className="text-sm text-gray-500 mt-1">
                {reviewerName ? `${reviewerName}, please` : 'Please'} score the {entries.length}{' '}
                {entries.length === 1 ? 'entry' : 'entries'} below. They are anonymous: each is identified only
                by its code and category.
              </p>
              <p className="text-xs text-gray-400 mt-2">No password needed — this link is yours. You can save a draft and come back to it.</p>
              <div className="flex flex-wrap gap-2 mt-4 print:hidden">
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.print()}>
                  <Printer className="h-4 w-4" /> Print / Save PDF
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowSheet(s => !s)}>
                  {showSheet ? 'Hide the paper sheet' : 'Preview the paper sheet'}
                </Button>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Prefer paper? Print the sheet, circle one grade per criterion, then post or email it back —
                we will enter it for you. In the print dialog, switch off “Headers and footers” so your
                private link is not printed on every page.
              </p>
            </div>

            {!tpl && (
              <div className="bg-white rounded-xl shadow-sm border p-6 text-sm text-gray-500">
                No scorecard is configured for the architecture competition yet.
              </div>
            )}

            {tpl && (
              <div className="space-y-3">
                {entries.map(e => {
                  const open = openEntry === e.entry_id;
                  const done = e.review?.status === 'submitted';
                  const list = files[e.entry_id] || [];
                  const idx = list.length ? Math.min(viewIdx, list.length - 1) : -1;
                  const cur = idx >= 0 ? list[idx] : null;
                  const scored = tpl.criteria.filter(c => draft[c.id]?.score != null).length;
                  const total = computeTotal(tpl, draft);
                  return (
                    <div key={e.entry_id} className="bg-white rounded-xl shadow-sm border overflow-hidden">
                      <button className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-gray-50"
                              onClick={() => openCard(e)}>
                        <span className="flex items-center gap-2 min-w-0">
                          {open ? <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" /> : <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />}
                          <span className="font-medium text-gray-900">{e.anon_code}</span>
                          <span className="text-xs text-gray-400 capitalize">{e.category}</span>
                        </span>
                        <span className="text-xs shrink-0">
                          {done
                            ? <span className="inline-flex items-center gap-1 text-green-700"><CheckCircle2 className="h-3.5 w-3.5" /> submitted · {e.review?.total_score}/100</span>
                            : e.review?.status === 'draft'
                              ? <span className="text-amber-700">draft saved</span>
                              : <span className="text-gray-400">not started</span>}
                        </span>
                      </button>

                      {open && (
                        <div className="px-5 pb-5 space-y-5 border-t border-gray-100 pt-4">
                          {/* Project files: one viewer, a row of labels above it.
                              Never a filename — it carries the architect's name. */}
                          {filesLoading === e.entry_id && (
                            <div className="flex items-center gap-2 text-sm text-gray-400">
                              <Loader2 className="h-4 w-4 animate-spin" /> Loading the project files…
                            </div>
                          )}
                          {/* Loaded and genuinely empty — say so. One live entry (the
                              whole student category) has nothing uploaded, and silence
                              there reads as a broken page. */}
                          {filesLoading !== e.entry_id && files[e.entry_id] && list.length === 0 && (
                            <div className="rounded-lg border border-dashed border-gray-200 px-3 py-6 text-center text-sm text-gray-400">
                              Nothing has been uploaded for this entry yet. Please leave it unscored and tell M3.
                            </div>
                          )}
                          {cur && (
                            <div>
                              <div className="flex flex-wrap gap-1.5">
                                {list.map((f, i) => (
                                  <button key={f.idx} type="button" onClick={() => setViewIdx(i)}
                                    className={`px-2.5 h-8 rounded-lg border text-xs transition-colors ${i === idx ? 'border-primary bg-primary/5 text-primary font-medium' : 'border-gray-200 text-gray-600 hover:border-primary/40'}`}>
                                    {f.label}
                                  </button>
                                ))}
                              </div>
                              <div className="mt-2 h-[65vh] rounded-lg border border-gray-200 bg-white overflow-hidden flex items-center justify-center">
                                {cur.is_image
                                  ? <img src={fileUrl(e.entry_id, cur)} alt={cur.label} className="max-h-full max-w-full object-contain" />
                                  : cur.kind === 'animation'
                                    ? <video src={fileUrl(e.entry_id, cur)} controls className="max-h-full max-w-full" />
                                    // A2 at 300 dpi: the browser's own PDF viewer gives zoom and page controls for free.
                                    : <iframe src={fileUrl(e.entry_id, cur)} title={cur.label} className="w-full h-full border-0 bg-white" />}
                              </div>
                            </div>
                          )}

                          <div className="flex items-baseline justify-between gap-3 border-t border-gray-100 pt-4">
                            <span className="text-sm font-semibold text-gray-900">{tpl.name}</span>
                            <span className="text-sm text-right">
                              {total != null
                                ? <span className="font-semibold text-primary">{total.toFixed(1)}/100</span>
                                : <span className="text-gray-400">not scored</span>}
                              {total != null && scored < tpl.criteria.length && (
                                <span className="block text-[11px] text-amber-600">partial — {scored} of {tpl.criteria.length} scored</span>
                              )}
                            </span>
                          </div>

                          {tpl.criteria.map((c, i) => (
                            <div key={c.id}>
                              <div className="flex items-baseline justify-between gap-3">
                                <label className="text-sm font-medium text-gray-900">
                                  {i + 1}. {c.label}
                                  {c.critical && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-red-600">critical</span>}
                                </label>
                                <span className="text-xs text-gray-400 shrink-0">weight {c.weight}</span>
                              </div>
                              {c.description && <p className="text-xs text-gray-500 mt-0.5">{c.description}</p>}
                              {/* Compact row — this is usually typed straight off a paper sheet. */}
                              <div className="flex flex-wrap gap-1 mt-2">
                                {scaleOf(tpl).map(n => (
                                  <button key={n} type="button"
                                    className={`h-8 w-8 rounded-lg border text-sm font-medium transition-colors ${draft[c.id]?.score === n ? 'bg-primary text-white border-primary' : 'bg-white text-gray-700 border-gray-200 hover:border-primary/40'}`}
                                    onClick={() => setScore(c.id, n)}>
                                    {n}
                                  </button>
                                ))}
                              </div>
                              <Textarea className="mt-2 text-sm" rows={2} placeholder="Comment (optional)"
                                value={draft[c.id]?.comment || ''} onChange={ev => setComment(c.id, ev.target.value)} />
                            </div>
                          ))}

                          <div className="border-t border-gray-100 pt-4 space-y-3">
                            <div>
                              <label className="text-sm font-medium text-gray-900">Your confidence in this assessment</label>
                              <div className="flex gap-1.5 mt-2">
                                {CONFIDENCE.map(cf => (
                                  <button key={cf.v} type="button"
                                    className={`px-3 h-8 rounded-lg border text-sm transition-colors ${confidence === cf.v ? 'border-primary bg-primary/5 text-primary font-medium' : 'border-gray-200 text-gray-600 hover:border-primary/40'}`}
                                    onClick={() => { setDirty(true); setConfidence(confidence === cf.v ? null : cf.v); }}>
                                    {cf.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="flex items-start gap-2">
                              <Checkbox id={`coi-${e.entry_id}`} checked={coi} onCheckedChange={v => { setDirty(true); setCoi(v as boolean); }} />
                              <label htmlFor={`coi-${e.entry_id}`} className="text-sm text-gray-700">
                                I have a potential conflict of interest with this entry (M3 will exclude my review from the official score).
                              </label>
                            </div>
                          </div>

                          <div className="flex gap-2 pt-1">
                            <Button variant="outline" className="flex-1" disabled={saving === e.entry_id} onClick={() => save(e, false)}>
                              {saving === e.entry_id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save draft'}
                            </Button>
                            <Button className="flex-1" disabled={saving === e.entry_id} onClick={() => save(e, true)}>
                              {done ? 'Update my score' : 'Submit my score'}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* ---- Paper scoresheet ----
          One page per entry, black on white, nothing where colour carries the
          meaning: this gets printed, circled in ink, posted back, and keyed in
          above under the same reviewer's name. */}
      {!loading && data?.ok && tpl && (
        <div className={`${showSheet ? 'block' : 'hidden'} print:block text-black`}>
          {showSheet && (
            <p className="max-w-3xl mx-auto text-xs text-gray-400 mb-3 print:hidden">
              Paper sheet preview — one page per entry when printed.
            </p>
          )}
          {entries.map((e, idx) => (
            <section key={e.entry_id}
              className={`max-w-3xl mx-auto bg-white p-6 mb-6 border border-black/20 print:border-0 print:p-0 print:mb-0 ${idx < entries.length - 1 ? 'break-after-page' : ''}`}>
              <div className="flex items-baseline justify-between gap-4 border-b-2 border-black pb-1">
                <div className="text-[13px] font-bold uppercase tracking-wide">SM26 Architecture Competition</div>
                <div className="text-[11px]">Reviewer: <span className="font-semibold">{reviewerName || '________________'}</span></div>
              </div>
              <div className="flex items-baseline justify-between gap-4 mt-1.5">
                <div className="text-xl font-bold">Entry {e.anon_code}</div>
                <div className="text-[11px] uppercase tracking-wide">{e.category}</div>
              </div>
              <p className="text-[10px] mt-1 mb-3">
                Circle one grade per criterion — {tpl.scale_min} = lowest, {tpl.scale_max} = highest.
                Return the completed sheet to Monaco Marina Management.
                {/* A juror on paper has the grid but not the projects. Say where they are:
                    without this the sheet is 12 pages of criteria and nothing to judge. */}
                {' '}The panels for every entry are on your personal link, or ask Monaco Marina
                Management to send them to you.
              </p>

              {tpl.criteria.map((c, i) => (
                <div key={c.id} className="break-inside-avoid mb-2.5">
                  <div className="text-[12px] font-semibold">
                    {i + 1}. {c.label}
                    {c.critical && <span className="ml-1.5 text-[9px] uppercase tracking-wide font-bold">· critical</span>}
                  </div>
                  {/* Plain numbers, one wide cell each — a border here would be
                      the thing the pen circles, and read as the answer. */}
                  <div className="flex items-center mt-0.5">
                    {scaleOf(tpl).map(n => (
                      <span key={n} className="inline-block w-8 h-8 leading-8 text-center text-[13px]">{n}</span>
                    ))}
                  </div>
                  <div className="border-b border-dotted border-black/60 h-6" />
                  <div className="border-b border-dotted border-black/60 h-6" />
                </div>
              ))}

              <div className="break-inside-avoid border-t border-black pt-2 mt-3 space-y-2.5">
                <div className="text-[12px]">
                  Overall confidence (circle one):
                  <span className="inline-flex gap-8 ml-6 font-medium">
                    {CONFIDENCE.map(cf => <span key={cf.v}>{cf.label}</span>)}
                  </span>
                </div>
                <div className="flex items-start gap-2 text-[11px]">
                  <span className="inline-block h-3.5 w-3.5 border border-black shrink-0 mt-0.5" />
                  <span>Tick if you have a potential conflict of interest with this entry — M3 will exclude this sheet from the official score.</span>
                </div>
                <div className="grid grid-cols-2 gap-10 pt-4 text-[11px]">
                  <div><div className="border-b border-black h-6" /><div className="mt-0.5">Signature</div></div>
                  <div><div className="border-b border-black h-6" /><div className="mt-0.5">Date</div></div>
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
