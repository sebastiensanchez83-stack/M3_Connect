import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Loader2, XCircle, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

// Scoring with no account and no sign-in: the juror picks their own name and the
// innovation from two lists, scores, submits. Everything else on the platform
// needs a login or a per-session token; this is the fallback for jurors who will
// do neither, and it writes a normal review so the score counts officially.
//
// The link carries a shared code. That is not an identity check — anyone holding
// the link can score as any juror in the list — it only keeps the page off the
// open web. M3 sees every review in the admin console and can remove one.

interface Entry { entry_id: string; company: string; stage: string; template_key: string }
interface Criterion { id: string; label: string; description: string | null; weight: number; critical: boolean }
interface Template { key: string; name: string; scale_max: number; criteria: Criterion[] }
interface Context { ok: boolean; error?: string; entries?: Entry[]; templates?: Template[] }
interface EntryDetail {
  ok: boolean; company?: string; country?: string | null; website?: string | null;
  stage?: string | null; startup_or_scaleup?: string | null; categories?: string[] | null;
  fields?: Record<string, string>;
}

type Draft = Record<string, { score: number | null; comment: string }>;

const CONFIDENCE = [{ v: 1, label: 'Low' }, { v: 2, label: 'Medium' }, { v: 3, label: 'High' }];

export function SM26OpenScorePage() {
  const [params] = useSearchParams();
  const code = params.get('code') || '';
  const [ctx, setCtx] = useState<Context | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [entryId, setEntryId] = useState('');
  const [draft, setDraft] = useState<Draft>({});
  const [confidence, setConfidence] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ company: string; total: number; matched: boolean } | null>(null);
  // Whether the typed name resolves to a juror we know. Checked as they type so
  // a typo is caught before they spend ten minutes on the card, not after.
  const [known, setKnown] = useState<{ recognised: boolean; display_name: string | null } | null>(null);
  const [checking, setChecking] = useState(false);
  // What this name has already scored. A juror working through a dozen companies
  // loses track otherwise, and the page used to forget them the moment it said
  // thank you.
  const [scored, setScored] = useState<string[]>([]);
  // The company's own file, alongside the marks. A juror scoring three weeks
  // after the pitch does not remember which one was which.
  const [detail, setDetail] = useState<EntryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    if (!code) { setCtx({ ok: false, error: 'missing_code' }); setLoading(false); return; }
    const { data, error } = await supabase.rpc('sm_open_score_context', { p_code: code });
    setCtx(error ? { ok: false, error: 'server_error' } : (data || { ok: false }) as Context);
    setLoading(false);
  }, [code]);
  useEffect(() => { load(); }, [load]);

  // Remembered on their own device, so scoring a second company does not mean
  // typing your name again.
  useEffect(() => {
    try { const s = localStorage.getItem('sm26-open-score-name'); if (s) setName(s); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    if (!name.trim()) return;
    try { localStorage.setItem('sm26-open-score-name', name); } catch { /* ignore */ }
  }, [name]);

  useEffect(() => {
    const n = name.trim();
    if (n.length < 3) { setKnown(null); return; }
    setChecking(true);
    const t = setTimeout(async () => {
      const [{ data }, { data: mine }] = await Promise.all([
        supabase.rpc('sm_open_score_check_name', { p_code: code, p_name: n }),
        supabase.rpc('sm_open_score_mine', { p_code: code, p_name: n }),
      ]);
      const r = (data || {}) as { recognised?: boolean; display_name?: string | null };
      setKnown({ recognised: !!r.recognised, display_name: r.display_name ?? null });
      setScored(((mine || {}) as { scored?: string[] }).scored || []);
      setChecking(false);
    }, 450);
    return () => { clearTimeout(t); setChecking(false); };
  }, [name, code]);

  const entry = (ctx?.entries || []).find(e => e.entry_id === entryId) || null;
  const tpl = entry ? (ctx?.templates || []).find(t => t.key === entry.template_key) || null : null;

  // Changing company can change the scorecard, so the marks start clean.
  const pickEntry = (id: string) => { setEntryId(id); setDraft({}); setConfidence(null); setDone(null); };

  useEffect(() => {
    if (!entryId) { setDetail(null); return; }
    let cancelled = false;
    setDetailLoading(true);
    (async () => {
      const { data } = await supabase.rpc('sm_open_score_entry', { p_code: code, p_entry_id: entryId });
      if (cancelled) return;
      setDetail((data || null) as EntryDetail | null);
      setDetailLoading(false);
    })();
    return () => { cancelled = true; };
  }, [entryId, code]);

  const setScore = (cid: string, score: number) =>
    setDraft(p => ({ ...p, [cid]: { score, comment: p[cid]?.comment || '' } }));
  const setComment = (cid: string, comment: string) =>
    setDraft(p => ({ ...p, [cid]: { score: p[cid]?.score ?? null, comment } }));

  const total = (() => {
    if (!tpl) return null;
    const full = tpl.criteria.reduce((a, c) => a + Number(c.weight), 0);
    let weighted = 0, any = false;
    for (const c of tpl.criteria) {
      const s = draft[c.id]?.score;
      if (s == null) continue;
      any = true;
      weighted += (s / tpl.scale_max) * Number(c.weight);
    }
    return any && full > 0 ? Math.round((weighted / full) * 1000) / 10 : null;
  })();

  // Named, standing, and clickable — not a toast that fades while you scroll.
  const blockers: { id: string; label: string }[] = (() => {
    const out: { id: string; label: string }[] = [];
    if (name.trim().length < 3) out.push({ id: 'juror', label: 'Enter your name' });
    if (!entryId) out.push({ id: 'entry', label: 'Choose the innovation' });
    if (!tpl) return out;
    tpl.criteria.forEach((c, i) => {
      if (draft[c.id]?.score == null) out.push({ id: `crit-${c.id}`, label: `Score ${i + 1}. ${c.label}` });
    });
    const threshold = 0.4 * tpl.scale_max;
    tpl.criteria.forEach((c, i) => {
      const s = draft[c.id]?.score;
      if (c.critical && s != null && s < threshold && !(draft[c.id]?.comment || '').trim()) {
        out.push({ id: `crit-${c.id}`, label: `Justify the low score on ${i + 1}. ${c.label}` });
      }
    });
    if (!confidence) out.push({ id: 'confidence', label: 'Set your confidence' });
    return out;
  })();

  const submit = async () => {
    if (blockers.length) {
      document.getElementById(blockers[0].id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setSaving(true);
    const scores: Record<string, { score: number | null; comment: string }> = {};
    for (const [cid, v] of Object.entries(draft)) scores[cid] = { score: v.score, comment: v.comment };
    const { data, error } = await supabase.rpc('sm_open_score_submit', {
      p_code: code, p_juror_name: name.trim(), p_entry_id: entryId,
      p_scores: scores, p_confidence: confidence,
    });
    setSaving(false);
    const r = (data || {}) as { ok?: boolean; error?: string; total_score?: number; matched?: boolean };
    if (error || !r.ok) {
      toast({ title: 'Could not save your score', description: error?.message || r.error, variant: 'destructive' });
      return;
    }
    setDone({ company: entry?.company || '', total: r.total_score ?? 0, matched: !!r.matched });
    setScored(prev => (prev.includes(entryId) ? prev : [...prev, entryId]));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (loading) return (
    <div className="min-h-[70vh] flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
  );

  if (!ctx?.ok) return (
    <div className="min-h-[70vh] bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl border shadow-sm max-w-md w-full p-8 text-center">
        <XCircle className="h-12 w-12 text-gray-300 mx-auto mb-4" />
        <h1 className="text-xl font-semibold text-gray-900 mb-2">This scoring link is not valid</h1>
        <p className="text-sm text-gray-500">Please use the link exactly as we sent it, or reply to our email and we will send a new one.</p>
      </div>
    </div>
  );

  const select = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30';

  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet><title>Score an innovation — Smart Marina Rendezvous</title></Helmet>
      <section className="bg-gradient-to-br from-[#0b2653] to-[#143a6b] text-white">
        <div className="container mx-auto px-4 py-10 max-w-2xl">
          <p className="uppercase tracking-wide text-white/60 text-sm mb-2">SM26 · Innovation Award</p>
          <h1 className="text-2xl lg:text-3xl font-bold">Score an innovation</h1>
          <p className="text-white/80 mt-2">No account and no password. Choose your name, choose the company, and score it.</p>
        </div>
      </section>

      <div className="container mx-auto px-4 py-6 max-w-6xl space-y-4">
        {done && (
          <div className="rounded-xl border border-green-200 bg-green-50 p-5">
            <div className="flex items-center gap-2 text-green-800 font-semibold">
              <CheckCircle2 className="h-5 w-5" /> Thank you — {done.company} scored {done.total.toFixed(1)}/100
            </div>
            <p className="text-sm text-green-700 mt-1">
              {done.matched
                ? 'Your score has been recorded with the jury\'s. You can score another company below.'
                : 'Your score has been recorded, but we could not match your name to a jury member, so M3 will attribute it by hand. You can score another company below.'}
            </p>
            <p className="text-xs text-green-700 mt-2">
              {scored.length} scored so far. Your name stays filled in — just pick the next company.
            </p>
            <Button className="mt-3" size="sm" onClick={() => {
              setDone(null); pickEntry('');
              document.getElementById('entry')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }}>Score another innovation</Button>
          </div>
        )}

        <div className="bg-white rounded-xl border shadow-sm p-5 space-y-4">
          <div id="juror" className="scroll-mt-6">
            <label className="text-sm font-medium text-gray-900 mb-1.5 block">Your name</label>
            <input className={select} value={name} autoComplete="name" placeholder="First name and surname"
              onChange={e => setName(e.target.value)} />
            {/* Said before they spend ten minutes on the card, not after. */}
            {checking && <p className="text-[11px] text-gray-400 mt-1">Checking…</p>}
            {!checking && known?.recognised && (
              <p className="text-[11px] text-green-700 mt-1 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Recognised as {known.display_name}. Your score will count with the jury's.
              </p>
            )}
            {!checking && known && !known.recognised && (
              <p className="text-[11px] text-amber-700 mt-1">
                We do not recognise this name. You can still submit — your score will be held for M3 to attribute.
                If you are on the jury, check the spelling.
              </p>
            )}
          </div>
          <div id="entry" className="scroll-mt-6">
            <div className="flex items-baseline justify-between gap-2 mb-1.5">
              <label className="text-sm font-medium text-gray-900">The innovation you are scoring</label>
              {scored.length > 0 && (
                <span className="text-xs text-gray-500">{scored.length} already scored by you</span>
              )}
            </div>
            <select className={select} value={entryId} onChange={e => pickEntry(e.target.value)}>
              <option value="">Choose a company…</option>
              {(ctx.entries || []).map(e => (
                <option key={e.entry_id} value={e.entry_id}>
                  {scored.includes(e.entry_id) ? '✓ ' : ''}{e.company}{e.stage ? ` — ${e.stage}` : ''}
                </option>
              ))}
            </select>
            {entryId && scored.includes(entryId) && (
              <p className="text-[11px] text-amber-700 mt-1">
                You have already scored this one. Submitting again replaces your previous score.
              </p>
            )}
          </div>
        </div>

        {entry && !tpl && (
          <div className="bg-white rounded-xl border shadow-sm p-6 text-center text-gray-400 text-sm">
            No scorecard is configured for this company yet.
          </div>
        )}

        {/* The company's file beside the marks, not above them: on a laptop the
            juror reads and scores without scrolling between the two, and the
            file follows as they work down the criteria. */}
        <div className="grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-4 items-start">
        {entry && (
          <div className="bg-white rounded-xl border shadow-sm p-5 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
            {detailLoading ? (
              <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-300" /></div>
            ) : detail?.ok ? (
              <div className="space-y-3">
                <div>
                  <div className="font-semibold text-gray-900">{detail.company}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {[detail.stage, detail.startup_or_scaleup, detail.country].filter(Boolean).join(' · ')}
                  </div>
                  {detail.website && (
                    <a href={/^https?:\/\//i.test(detail.website) ? detail.website : `https://${detail.website}`}
                      target="_blank" rel="noreferrer"
                      className="text-xs text-primary inline-flex items-center gap-1 mt-1">
                      {detail.website.replace(/^https?:\/\//, '')} <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                {Array.isArray(detail.categories) && detail.categories.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {detail.categories.map(c => (
                      <span key={c} className="text-[10px] rounded-full bg-gray-100 text-gray-600 px-2 py-0.5">{c}</span>
                    ))}
                  </div>
                )}
                {Object.entries(detail.fields || {}).map(([k, v]) => (
                  <div key={k}>
                    <div className="text-[11px] uppercase tracking-wide text-gray-400">{k}</div>
                    <div className="text-sm text-gray-800 whitespace-pre-wrap">{v}</div>
                  </div>
                ))}
                {Object.keys(detail.fields || {}).length === 0 && (
                  <p className="text-sm text-gray-400">This company did not fill in a written file.</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-400">We could not load this company's file.</p>
            )}
          </div>
        )}

        {tpl && (
          <div className="bg-white rounded-xl border shadow-sm p-5 space-y-5">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <div>
                <div className="font-semibold text-gray-900">{tpl.name}</div>
                <p className="text-xs text-gray-500 mt-0.5">
                  Score each criterion 0–{tpl.scale_max}. A comment is required for a low score on a critical criterion.
                </p>
              </div>
              <div className="text-sm text-right">
                {total != null
                  ? <span className="font-semibold text-primary">{total.toFixed(1)}/100</span>
                  : <span className="text-gray-400">not scored</span>}
              </div>
            </div>

            {tpl.criteria.map((c, i) => {
              const cur = draft[c.id]?.score ?? null;
              const lowCritical = c.critical && cur != null && cur < 0.4 * tpl.scale_max;
              return (
                <div key={c.id} id={`crit-${c.id}`} className="space-y-1.5 scroll-mt-6">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
                      {i + 1}. {c.label}
                      {c.critical && <span title="Critical criterion" className="text-amber-500"><AlertTriangle className="h-3.5 w-3.5" /></span>}
                    </label>
                    <span className="text-[11px] text-gray-400">
                      {cur == null && <span className="text-amber-600 mr-2">not scored</span>}
                      weight {c.weight}
                    </span>
                  </div>
                  {c.description && <p className="text-xs text-gray-500 -mt-0.5">{c.description}</p>}
                  <div className="flex flex-wrap gap-1">
                    {Array.from({ length: tpl.scale_max + 1 }, (_, n) => n).map(n => (
                      <button key={n} type="button" onClick={() => setScore(c.id, n)}
                        className={`h-9 w-9 rounded-lg border text-sm font-medium transition-colors ${cur === n ? 'border-primary bg-primary text-white' : 'border-gray-200 text-gray-600 hover:border-primary/40'}`}>
                        {n}
                      </button>
                    ))}
                  </div>
                  <Textarea rows={2}
                    placeholder={lowCritical ? 'Comment required — justify this low score' : 'Comment (optional)'}
                    className={lowCritical && !(draft[c.id]?.comment || '').trim() ? 'border-amber-400' : ''}
                    value={draft[c.id]?.comment || ''} onChange={e => setComment(c.id, e.target.value)} />
                </div>
              );
            })}

            <div id="confidence" className="border-t pt-4 scroll-mt-6">
              <label className="text-sm font-medium text-gray-900 mb-1.5 block">Your confidence in this assessment</label>
              <div className="flex gap-1.5">
                {CONFIDENCE.map(cf => (
                  <button key={cf.v} type="button" onClick={() => setConfidence(cf.v)}
                    className={`px-3 h-9 rounded-lg border text-sm transition-colors ${confidence === cf.v ? 'border-primary bg-primary/5 text-primary font-medium' : 'border-gray-200 text-gray-600 hover:border-primary/40'}`}>
                    {cf.label}
                  </button>
                ))}
              </div>
            </div>

            {blockers.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <div className="text-sm font-medium text-amber-800">
                  {blockers.length} thing{blockers.length > 1 ? 's' : ''} still to do before you can submit
                </div>
                <ul className="mt-1.5 space-y-1">
                  {blockers.map(b => (
                    <li key={b.id + b.label}>
                      <button type="button" className="text-sm text-amber-800 underline underline-offset-2 text-left"
                        onClick={() => document.getElementById(b.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
                        {b.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex justify-end">
              <Button onClick={submit} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Submit my score
              </Button>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
