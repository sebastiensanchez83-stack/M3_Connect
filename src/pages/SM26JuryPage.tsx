import { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import {
  RefreshCw, ArrowLeft, Scale, CheckCircle, Loader2, AlertTriangle, Lock, ChevronRight, ExternalLink, Lightbulb, Download,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { requireFreshSession } from '@/lib/session';
import { toast } from '@/hooks/use-toast';
import { SM26AssetGallery } from '@/components/sm26/SM26AssetGallery';

// Juror scoring (Area 3). Lists the entries M3 assigned to the signed-in juror,
// and scores each on the right versioned scorecard (innovation: stage picks the
// card; architecture: 7 criteria, anonymised). Only confirmed jurors can write
// (RLS); the official Awards Score is computed from these reviews.

interface Entry {
  entry_id: string; competition: string; mandatory: boolean;
  title: string; subtitle: string; stage: string | null; template_key: string;
  review_status: string | null; review_total: number | null; confidence: number | null; coi_flag: boolean | null;
}
interface Criterion { id: string; label: string; description: string | null; weight: number; critical: boolean; display_order: number; }
interface Template { id: string; competition: string; key: string; name: string; scale_max: number; criteria: Criterion[]; }
type Draft = Record<string, { score: number | null; comment: string }>;
interface AllInnovation {
  entry_id: string; company: string | null; website: string | null; stage: string | null;
  categories: string[] | null; fields: Record<string, string>; assigned: boolean; review_status: string | null;
}

const CONFIDENCE = [{ v: 1, label: 'Low' }, { v: 2, label: 'Medium' }, { v: 3, label: 'High' }];

export function SM26JuryPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { user, loading: authLoading } = useAuth();
  const [eventId, setEventId] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [allInnovations, setAllInnovations] = useState<AllInnovation[]>([]);
  const [browseId, setBrowseId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState<Entry | null>(null);
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [confidence, setConfidence] = useState<number | null>(null);
  const [coi, setCoi] = useState(false);
  const [reviewStatus, setReviewStatus] = useState<string | null>(null);
  const [loadingEntry, setLoadingEntry] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (user) load(); }, [user]);

  const load = async () => {
    setLoading(true);
    const { data: ev } = await supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle();
    if (!ev) { setLoading(false); return; }
    const eid = (ev as { id: string }).id;
    setEventId(eid);
    const [{ data: ents }, { data: tpls }, { data: allInn }] = await Promise.all([
      supabase.rpc('sm_jury_my_entries', { p_event_id: eid }),
      supabase.from('sm_scorecard_template').select('*, criteria:sm_criterion(*)').eq('event_id', eid).eq('is_active', true),
      supabase.rpc('sm_jury_all_innovations', { p_event_id: eid }),
    ]);
    setEntries((ents || []) as Entry[]);
    setAllInnovations((allInn || []) as AllInnovation[]);
    const t = ((tpls || []) as Template[]).map(x => ({ ...x, criteria: [...x.criteria].sort((a, b) => a.display_order - b.display_order) }));
    setTemplates(t);
    setLoading(false);
  };

  const templateFor = (e: Entry) => templates.find(t => t.competition === e.competition && t.key === e.template_key) || null;

  const openEntry = async (e: Entry) => {
    setSelected(e);
    setLoadingEntry(true);
    setPayload(null);
    setDraft({});
    setConfidence(e.confidence ?? null);
    setCoi(!!e.coi_flag);
    setReviewStatus(e.review_status ?? null);
    const [{ data: detail }, { data: review }] = await Promise.all([
      supabase.rpc('sm_jury_entry_detail', { p_entry_id: e.entry_id }),
      supabase.from('sm_review').select('*, scores:sm_criterion_score(criterion_id,score,comment)')
        .eq('entry_role_assignment_id', e.entry_id).eq('juror_user_id', user!.id).maybeSingle(),
    ]);
    setPayload((detail || null) as Record<string, unknown> | null);
    const d: Draft = {};
    const rev = review as { scores?: { criterion_id: string; score: number | null; comment: string | null }[]; confidence?: number; coi_flag?: boolean; status?: string } | null;
    if (rev?.scores) for (const s of rev.scores) d[s.criterion_id] = { score: s.score, comment: s.comment || '' };
    setDraft(d);
    if (rev) { setConfidence(rev.confidence ?? null); setCoi(!!rev.coi_flag); setReviewStatus(rev.status ?? null); }
    setLoadingEntry(false);
  };

  const setScore = (cid: string, score: number) =>
    setDraft(prev => ({ ...prev, [cid]: { score: prev[cid]?.score === score ? null : score, comment: prev[cid]?.comment || '' } }));
  const setComment = (cid: string, comment: string) =>
    setDraft(prev => ({ ...prev, [cid]: { score: prev[cid]?.score ?? null, comment } }));

  const computeTotal = (tpl: Template): number | null => {
    let wsum = 0, weighted = 0;
    for (const c of tpl.criteria) {
      const s = draft[c.id]?.score;
      if (s == null) continue;
      weighted += (s / tpl.scale_max) * c.weight;
      wsum += c.weight;
    }
    return wsum > 0 ? Math.round((weighted / wsum) * 1000) / 10 : null;
  };

  const saveReview = async (submit: boolean) => {
    if (!selected || !eventId) return;
    const tpl = templateFor(selected);
    if (!tpl) { toast({ title: 'No scorecard found for this entry', variant: 'destructive' }); return; }

    if (submit) {
      const unscored = tpl.criteria.filter(c => draft[c.id]?.score == null);
      if (unscored.length) { toast({ title: 'Score every criterion before submitting', description: `${unscored.length} left.`, variant: 'destructive' }); return; }
      if (!confidence) { toast({ title: 'Set your confidence level before submitting', variant: 'destructive' }); return; }
      const threshold = 0.4 * tpl.scale_max;
      const missingComment = tpl.criteria.find(c => c.critical && (draft[c.id]?.score ?? 0) < threshold && !(draft[c.id]?.comment || '').trim());
      if (missingComment) { toast({ title: 'A comment is required', description: `Low score on a critical criterion ("${missingComment.label}") needs a justification.`, variant: 'destructive' }); return; }
    }

    const uid = await requireFreshSession();
    if (!uid) return;

    setSaving(true);
    const total = computeTotal(tpl);
    const { data: rv, error: rvErr } = await supabase.from('sm_review').upsert({
      juror_user_id: user!.id,
      entry_role_assignment_id: selected.entry_id,
      event_id: eventId,
      competition: selected.competition,
      template_id: tpl.id,
      confidence,
      coi_flag: coi,
      status: submit ? 'submitted' : 'draft',
      total_score: total,
      submitted_at: submit ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'juror_user_id,entry_role_assignment_id' }).select('id').single();

    if (rvErr || !rv) { setSaving(false); toast({ title: 'Could not save', description: rvErr?.message, variant: 'destructive' }); return; }

    const rows = tpl.criteria.map(c => ({
      review_id: (rv as { id: string }).id, criterion_id: c.id,
      score: draft[c.id]?.score ?? null, comment: draft[c.id]?.comment?.trim() || null,
    }));
    const { error: scErr } = await supabase.from('sm_criterion_score').upsert(rows, { onConflict: 'review_id,criterion_id' });
    setSaving(false);
    if (scErr) { toast({ title: 'Scores could not be saved', description: scErr.message, variant: 'destructive' }); return; }

    setReviewStatus(submit ? 'submitted' : 'draft');
    toast({ title: submit ? 'Review submitted' : 'Draft saved' });
    // refresh list state
    setEntries(prev => prev.map(e => e.entry_id === selected.entry_id ? { ...e, review_status: submit ? 'submitted' : 'draft', review_total: total, confidence, coi_flag: coi } : e));
  };

  const openArchFile = async (path: string) => {
    const { data } = await supabase.storage.from('event-media').createSignedUrl(path, 300);
    if (data) window.open(data.signedUrl, '_blank'); else toast({ title: 'Could not open file', variant: 'destructive' });
  };

  if (authLoading || loading) return (
    <div className="flex items-center justify-center h-[60vh]"><RefreshCw className="h-8 w-8 animate-spin text-primary" /></div>
  );

  // ---- Scoring view ----
  if (selected) {
    const tpl = templateFor(selected);
    const total = tpl ? computeTotal(tpl) : null;
    const locked = reviewStatus === 'locked';
    const fields = (payload?.fields || {}) as Record<string, string>;
    return (
      <div className={embedded ? '' : 'min-h-screen bg-gray-50'}>
        {!embedded && <Helmet><title>Score entry — SM26 Jury</title></Helmet>}
        <div className={embedded ? 'space-y-4' : 'container mx-auto px-4 py-6 max-w-3xl space-y-4'}>
          <Button variant="ghost" size="sm" onClick={() => setSelected(null)} className="gap-1.5"><ArrowLeft className="h-4 w-4" /> Back to my entries</Button>

          {loadingEntry ? (
            <div className="flex items-center justify-center h-40"><RefreshCw className="h-7 w-7 animate-spin text-gray-400" /></div>
          ) : (
            <>
              {/* Entry content */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <CardTitle className="flex items-center gap-2">
                      {selected.title}
                      <Badge variant="outline" className="text-[10px] capitalize">{selected.competition}</Badge>
                      {selected.subtitle && <Badge variant="secondary" className="text-[10px]">{selected.subtitle}</Badge>}
                    </CardTitle>
                    {reviewStatus && <Badge className={`text-[10px] ${reviewStatus === 'submitted' ? 'bg-green-50 text-green-700 border-green-200' : reviewStatus === 'locked' ? 'bg-gray-100 text-gray-500 border-gray-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>{reviewStatus}</Badge>}
                  </div>
                  {payload?.competition === 'innovation' && payload?.website ? (
                    <CardDescription className="flex items-center gap-1">
                      <a href={String(payload.website)} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1">{String(payload.website)} <ExternalLink className="h-3 w-3" /></a>
                    </CardDescription>
                  ) : payload?.competition === 'architecture' ? (
                    <CardDescription>Anonymised entry — scored on the submitted panels.</CardDescription>
                  ) : null}
                </CardHeader>
                <CardContent className="space-y-3">
                  {Object.entries(fields).map(([k, v]) => (
                    <div key={k}>
                      <div className="text-[11px] uppercase tracking-wide text-gray-400">{k}</div>
                      <div className="text-sm text-gray-800 whitespace-pre-wrap">{v}</div>
                    </div>
                  ))}
                  {Array.isArray(payload?.files) && (payload!.files as unknown[]).length > 0 && (() => {
                    // Label by panel/order — never the filename (it carries the architect's name).
                    const list = payload!.files as { id: string; kind: string; path: string }[];
                    const ps = list.filter(f => f.kind === 'panel');
                    const nt = list.find(f => f.kind === 'notice');
                    const an = list.find(f => f.kind === 'animation');
                    const ordered = [
                      ...ps.map((f, i) => ({ id: f.id, path: f.path, label: `Panel ${i + 1} (A2)` })),
                      ...(nt ? [{ id: nt.id, path: nt.path, label: 'Descriptive notice (A3)' }] : []),
                      ...(an ? [{ id: an.id, path: an.path, label: '3D animation' }] : []),
                    ];
                    return (
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1.5">Project files</div>
                        <div className="space-y-1.5">
                          {ordered.map(f => (
                            <button key={f.id} onClick={() => openArchFile(f.path)} className="flex items-center gap-2 w-full text-left rounded-lg border border-gray-100 hover:border-primary/40 px-3 py-2">
                              <Download className="h-4 w-4 text-primary shrink-0" />
                              <span className="text-sm text-gray-800 truncate">{f.label}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                  {/* Imported architecture entries store their boards in
                      project_renders (not sm_architecture_file) — the resolver
                      surfaces them as anonymised previews for scoring. */}
                  <SM26AssetGallery roleAssignmentId={selected.entry_id} title="Project images" emptyText="" />
                  {Array.isArray(payload?.categories) && (payload!.categories as string[]).length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {(payload!.categories as string[]).map(c => <Badge key={c} variant="secondary" className="text-[10px]">{c}</Badge>)}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Scorecard */}
              {!tpl ? (
                <Card><CardContent className="py-8 text-center text-gray-400">No scorecard configured for this entry.</CardContent></Card>
              ) : (
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <CardTitle className="text-base flex items-center gap-2"><Scale className="h-4 w-4 text-primary" /> {tpl.name}</CardTitle>
                      <div className="text-sm">{total != null ? <span className="font-semibold text-primary">{total.toFixed(1)}/100</span> : <span className="text-gray-400">not scored</span>}</div>
                    </div>
                    <CardDescription>Score each criterion 0–{tpl.scale_max}. A comment is required for a low score on a critical criterion.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    {tpl.criteria.map(c => {
                      const cur = draft[c.id]?.score ?? null;
                      const lowCritical = c.critical && cur != null && cur < 0.4 * tpl.scale_max;
                      return (
                        <div key={c.id} className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <Label className="flex items-center gap-1.5">
                              {c.label}
                              {c.critical && <span title="Critical criterion" className="text-amber-500"><AlertTriangle className="h-3.5 w-3.5" /></span>}
                            </Label>
                            <span className="text-[11px] text-gray-400">weight {c.weight}</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {Array.from({ length: tpl.scale_max + 1 }, (_, i) => i).map(n => (
                              <button
                                key={n} type="button" disabled={locked}
                                onClick={() => setScore(c.id, n)}
                                className={`h-8 w-8 rounded-lg border text-sm font-medium transition-colors ${cur === n ? 'border-primary bg-primary text-white' : 'border-gray-200 text-gray-600 hover:border-primary/40'}`}
                              >{n}</button>
                            ))}
                          </div>
                          <Textarea
                            rows={2} disabled={locked}
                            placeholder={lowCritical ? 'Comment required — justify this low score' : 'Comment (optional)'}
                            className={lowCritical && !(draft[c.id]?.comment || '').trim() ? 'border-amber-400' : ''}
                            value={draft[c.id]?.comment || ''} onChange={e => setComment(c.id, e.target.value)}
                          />
                        </div>
                      );
                    })}

                    <div className="border-t pt-4 space-y-3">
                      <div>
                        <Label className="mb-1.5 block">Your confidence</Label>
                        <div className="flex gap-1.5">
                          {CONFIDENCE.map(cf => (
                            <button key={cf.v} type="button" disabled={locked} onClick={() => setConfidence(confidence === cf.v ? null : cf.v)}
                              className={`px-3 h-8 rounded-lg border text-sm transition-colors ${confidence === cf.v ? 'border-primary bg-primary/5 text-primary font-medium' : 'border-gray-200 text-gray-600 hover:border-primary/40'}`}>{cf.label}</button>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <Checkbox id="coi" checked={coi} disabled={locked} onCheckedChange={v => setCoi(v as boolean)} />
                        <Label htmlFor="coi" className="font-normal text-sm">I have a potential conflict of interest with this entry (M3 will exclude my review from the official score).</Label>
                      </div>
                    </div>

                    {locked ? (
                      <div className="flex items-center gap-2 text-sm text-gray-500"><Lock className="h-4 w-4" /> This review is locked. Contact M3 to reopen it.</div>
                    ) : (
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => saveReview(false)} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save draft</Button>
                        <Button onClick={() => saveReview(true)} disabled={saving}>Submit review</Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // ---- List view ----
  const mandatory = entries.filter(e => e.mandatory);
  const optional = entries.filter(e => !e.mandatory);
  const Row = (e: Entry) => (
    <Card key={e.entry_id} className="border-0 shadow-sm hover:shadow-md transition-all cursor-pointer group" onClick={() => openEntry(e)}>
      <CardContent className="p-4 flex items-center gap-4">
        <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0"><Scale className="h-5 w-5" /></div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900 truncate group-hover:text-primary">{e.title}</span>
            <Badge variant="outline" className="text-[10px] capitalize">{e.competition}</Badge>
            {e.subtitle && <Badge variant="secondary" className="text-[10px]">{e.subtitle}</Badge>}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            {e.review_status === 'submitted'
              ? <span className="text-green-600 inline-flex items-center gap-1"><CheckCircle className="h-3 w-3" /> Submitted · {e.review_total?.toFixed(1)}/100</span>
              : e.review_status === 'draft' ? <span className="text-amber-600">Draft saved</span>
              : <span>Not started</span>}
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-gray-300 group-hover:text-primary shrink-0" />
      </CardContent>
    </Card>
  );

  return (
    <div className={embedded ? '' : 'min-h-screen bg-gray-50'}>
      {!embedded && <Helmet><title>My jury entries — SM26</title></Helmet>}
      {!embedded && (
        <section className="bg-gradient-to-br from-[#0b2653] to-[#143a6b] text-white">
          <div className="container mx-auto px-4 py-10">
            <p className="uppercase tracking-wide text-white/60 text-sm mb-2">SM26 · Jury</p>
            <h1 className="text-2xl lg:text-3xl font-bold">Entries to evaluate</h1>
            <p className="text-white/80 mt-2">Score each assigned entry on its scorecard. Scoring is in English and completes before the event.</p>
          </div>
        </section>
      )}

      <div className={embedded ? 'space-y-6' : 'container mx-auto px-4 py-8 max-w-2xl space-y-6'}>
        {entries.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-gray-400">
            No entries are assigned to you for scoring yet — M3 assigns jurors to entries and you'll be notified.
            {allInnovations.length > 0 && <span className="block mt-1">You can already read every innovation below.</span>}
          </CardContent></Card>
        ) : (
          <>
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-gray-700">Assigned to you ({mandatory.length})</h2>
              {mandatory.map(Row)}
            </div>
            {optional.length > 0 && (
              <div className="space-y-2">
                <h2 className="text-sm font-semibold text-gray-700">Optional (signal only)</h2>
                {optional.map(Row)}
              </div>
            )}
          </>
        )}

        {/* (d) Read-only browse of every innovation — for context/fairness. Scoring stays limited to assigned entries above. */}
        {allInnovations.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-700">All innovations · read-only ({allInnovations.length})</h2>
            <p className="text-xs text-gray-500 -mt-1">Open any entry to read it. You can only score the ones assigned to you above.</p>
            {allInnovations.map(a => {
              const open = browseId === a.entry_id;
              const fieldEntries = Object.entries(a.fields || {});
              return (
                <Card key={a.entry_id} className="border-0 shadow-sm">
                  <button onClick={() => setBrowseId(open ? null : a.entry_id)} className="w-full text-left">
                    <CardContent className="p-4 flex items-center gap-3">
                      <div className="h-9 w-9 rounded-lg bg-gray-100 text-gray-400 flex items-center justify-center shrink-0"><Lightbulb className="h-4 w-4" /></div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-gray-900 truncate">{a.company || 'Innovation'}</span>
                          {a.stage && <Badge variant="secondary" className="text-[10px]">{a.stage}</Badge>}
                          {a.assigned && <Badge className="text-[10px] bg-primary/10 text-primary border-primary/20">Assigned to you</Badge>}
                          {a.assigned && a.review_status === 'submitted' && <Badge className="text-[10px] bg-green-50 text-green-700 border-green-200">scored</Badge>}
                        </div>
                      </div>
                      <ChevronRight className={`h-5 w-5 text-gray-300 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
                    </CardContent>
                  </button>
                  {open && (
                    <CardContent className="px-4 pb-4 pt-0 space-y-2">
                      {a.website && <a href={a.website} target="_blank" rel="noreferrer" className="text-primary text-sm inline-flex items-center gap-1">{a.website.replace(/^https?:\/\//, '')} <ExternalLink className="h-3 w-3" /></a>}
                      {fieldEntries.map(([k, v]) => (
                        <div key={k}>
                          <div className="text-[11px] uppercase tracking-wide text-gray-400">{k}</div>
                          <div className="text-sm text-gray-800 whitespace-pre-wrap">{v}</div>
                        </div>
                      ))}
                      {Array.isArray(a.categories) && a.categories.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">{a.categories.map(c => <Badge key={c} variant="secondary" className="text-[10px]">{c}</Badge>)}</div>
                      )}
                      {fieldEntries.length === 0 && <p className="text-sm text-gray-400">No written details provided yet.</p>}
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
