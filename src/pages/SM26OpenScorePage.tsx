import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Loader2, XCircle, CheckCircle2, AlertTriangle } from 'lucide-react';
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

interface Juror { user_id: string; name: string }
interface Entry { entry_id: string; company: string; stage: string; template_key: string }
interface Criterion { id: string; label: string; description: string | null; weight: number; critical: boolean }
interface Template { key: string; name: string; scale_max: number; criteria: Criterion[] }
interface Context { ok: boolean; error?: string; jurors?: Juror[]; entries?: Entry[]; templates?: Template[] }

type Draft = Record<string, { score: number | null; comment: string }>;

const CONFIDENCE = [{ v: 1, label: 'Low' }, { v: 2, label: 'Medium' }, { v: 3, label: 'High' }];

export function SM26OpenScorePage() {
  const [params] = useSearchParams();
  const code = params.get('code') || '';
  const [ctx, setCtx] = useState<Context | null>(null);
  const [loading, setLoading] = useState(true);
  const [jurorId, setJurorId] = useState('');
  const [entryId, setEntryId] = useState('');
  const [draft, setDraft] = useState<Draft>({});
  const [confidence, setConfidence] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ company: string; total: number } | null>(null);

  const load = useCallback(async () => {
    if (!code) { setCtx({ ok: false, error: 'missing_code' }); setLoading(false); return; }
    const { data, error } = await supabase.rpc('sm_open_score_context', { p_code: code });
    setCtx(error ? { ok: false, error: 'server_error' } : (data || { ok: false }) as Context);
    setLoading(false);
  }, [code]);
  useEffect(() => { load(); }, [load]);

  // The juror's name is remembered on their own device so scoring a second
  // company does not mean finding themselves in the list again.
  useEffect(() => {
    try { const s = localStorage.getItem('sm26-open-score-juror'); if (s) setJurorId(s); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    if (!jurorId) return;
    try { localStorage.setItem('sm26-open-score-juror', jurorId); } catch { /* ignore */ }
  }, [jurorId]);

  const entry = (ctx?.entries || []).find(e => e.entry_id === entryId) || null;
  const tpl = entry ? (ctx?.templates || []).find(t => t.key === entry.template_key) || null : null;

  // Changing company can change the scorecard, so the marks start clean.
  const pickEntry = (id: string) => { setEntryId(id); setDraft({}); setConfidence(null); setDone(null); };

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
    if (!jurorId) out.push({ id: 'juror', label: 'Choose your name' });
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
      p_code: code, p_juror_user_id: jurorId, p_entry_id: entryId,
      p_scores: scores, p_confidence: confidence,
    });
    setSaving(false);
    const r = (data || {}) as { ok?: boolean; error?: string; total_score?: number };
    if (error || !r.ok) {
      toast({ title: 'Could not save your score', description: error?.message || r.error, variant: 'destructive' });
      return;
    }
    setDone({ company: entry?.company || '', total: r.total_score ?? 0 });
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

      <div className="container mx-auto px-4 py-6 max-w-2xl space-y-4">
        {done && (
          <div className="rounded-xl border border-green-200 bg-green-50 p-5">
            <div className="flex items-center gap-2 text-green-800 font-semibold">
              <CheckCircle2 className="h-5 w-5" /> Thank you — {done.company} scored {done.total.toFixed(1)}/100
            </div>
            <p className="text-sm text-green-700 mt-1">Your score has been recorded. You can score another company below.</p>
            <Button className="mt-3" size="sm" onClick={() => { setDone(null); pickEntry(''); }}>Score another innovation</Button>
          </div>
        )}

        <div className="bg-white rounded-xl border shadow-sm p-5 space-y-4">
          <div id="juror">
            <label className="text-sm font-medium text-gray-900 mb-1.5 block">Your name</label>
            <select className={select} value={jurorId} onChange={e => setJurorId(e.target.value)}>
              <option value="">Choose your name…</option>
              {(ctx.jurors || []).map(j => <option key={j.user_id} value={j.user_id}>{j.name}</option>)}
            </select>
            <p className="text-[11px] text-gray-400 mt-1">Not in the list? Reply to our email and we will add you.</p>
          </div>
          <div id="entry">
            <label className="text-sm font-medium text-gray-900 mb-1.5 block">The innovation you are scoring</label>
            <select className={select} value={entryId} onChange={e => pickEntry(e.target.value)}>
              <option value="">Choose a company…</option>
              {(ctx.entries || []).map(e => (
                <option key={e.entry_id} value={e.entry_id}>{e.company}{e.stage ? ` — ${e.stage}` : ''}</option>
              ))}
            </select>
          </div>
        </div>

        {entry && !tpl && (
          <div className="bg-white rounded-xl border shadow-sm p-6 text-center text-gray-400 text-sm">
            No scorecard is configured for this company yet.
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
  );
}
