import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/lib/supabase';
import { CheckCircle2, XCircle, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';

// Scoring without a login. Some jurors were recruited by email and will never
// use the platform, but the whole ranking keys on a juror id — so rather than
// loosen that, this page reaches an existing juror's own scorecard through the
// same per-session token that already carries the availability question.
//
// The token is scoped to one session, enforced server-side: it cannot score
// another panel's startups, cannot read anyone else's scores, and cannot see
// the standings. Every juror can use it, not only the off-platform ones —
// which also means a juror who has lost their password is never stuck.

interface Criterion { id: string; label: string; description: string | null; weight: number; critical: boolean }
interface Template { id: string; name: string; scale_min: number; scale_max: number; criteria: Criterion[] }
interface Review { status: string; confidence: number | null; coi_flag: boolean; total_score: number | null; scores: Record<string, { score: number | null; comment: string | null }> }
interface Entry { entry_role_assignment_id: string; company: string; template: Template | null; review: Review | null }
interface Payload {
  ok: boolean; error?: string; first_name?: string; rsvp?: string;
  session?: { title: string; slot_label: string | null; scheduled_at: string; duration_minutes: number };
  entries?: Entry[];
}

const TZ = 'Europe/Monaco';
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ });

const ERRORS: Record<string, string> = {
  missing_token: 'This link is incomplete. Please use the button in the email we sent you.',
  invalid_token: 'This link is no longer valid. Please ask Yachting Ventures for a new one.',
  cancelled: 'This jury session was cancelled, so there is nothing to score.',
};

type Draft = Record<string, { score: number | null; comment: string }>;

export function SM26JuryScorePage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [openEntry, setOpenEntry] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [confidence, setConfidence] = useState<number | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: res, error } = await supabase.rpc('sm_jury_scorecard_by_token', { p_token: token });
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

  // Opening a company loads whatever was already saved for it, so a juror can
  // come back to a half-finished card without retyping.
  const openCard = (e: Entry) => {
    if (openEntry === e.entry_role_assignment_id) { setOpenEntry(null); return; }
    const d: Draft = {};
    for (const c of e.template?.criteria || []) {
      const prev = e.review?.scores?.[c.id];
      d[c.id] = { score: prev?.score ?? null, comment: prev?.comment || '' };
    }
    setDraft(d);
    setConfidence(e.review?.confidence ?? null);
    setOpenEntry(e.entry_role_assignment_id);
  };

  const save = async (e: Entry, submit: boolean) => {
    setSaving(e.entry_role_assignment_id);
    const scores: Record<string, { score: number | null; comment: string }> = {};
    for (const [cid, v] of Object.entries(draft)) scores[cid] = { score: v.score, comment: v.comment };
    const { data: res, error } = await supabase.rpc('sm_jury_save_score_by_token', {
      p_token: token,
      p_entry_role_assignment_id: e.entry_role_assignment_id,
      p_scores: scores,
      p_confidence: confidence,
      p_coi: false,
      p_submit: submit,
    });
    setSaving(null);
    const r = (res || {}) as { ok?: boolean; error?: string; missing?: number; total_score?: number };
    if (error || !r.ok) {
      toast({
        title: r.error === 'incomplete' ? 'Score every criterion first' : 'Could not save',
        description: r.error === 'incomplete' ? `${r.missing} still to score.` : error?.message,
        variant: 'destructive',
      });
      return;
    }
    toast({ title: submit ? `Submitted — ${r.total_score}/100` : 'Draft saved' });
    setData(await load());
    if (submit) setOpenEntry(null);
  };

  const s = data?.session;

  return (
    <div className="min-h-[70vh] bg-gray-50 px-4 py-10">
      <Helmet><title>Score the innovations — Smart Marina Rendezvous</title></Helmet>
      <div className="max-w-2xl mx-auto">
        {loading && (
          <div className="bg-white rounded-xl shadow-sm border p-8 text-center">
            <Loader2 className="h-10 w-10 text-primary animate-spin mx-auto mb-4" />
            <p className="text-sm text-gray-500">One moment…</p>
          </div>
        )}

        {!loading && data && !data.ok && (
          <div className="bg-white rounded-xl shadow-sm border p-8 text-center">
            <XCircle className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <h1 className="text-xl font-semibold text-gray-900 mb-2">We couldn't open your scorecards</h1>
            <p className="text-sm text-gray-500">{ERRORS[data.error || ''] || 'Something went wrong. Please reply to the email and we will sort it out.'}</p>
          </div>
        )}

        {!loading && data?.ok && s && (
          <>
            <div className="bg-white rounded-xl shadow-sm border p-6 mb-4">
              <h1 className="text-2xl font-bold text-gray-900">Your scorecards</h1>
              <p className="text-sm text-gray-500 mt-1">
                {data.first_name && data.first_name !== 'there' ? `${data.first_name}, please` : 'Please'} score the
                {' '}{data.entries?.length} {data.entries?.length === 1 ? 'company' : 'companies'} you heard on {fmtDay(s.scheduled_at)}
                {s.slot_label ? `, ${s.slot_label}` : ''}.
              </p>
              <p className="text-xs text-gray-400 mt-2">No password needed — this link is yours. You can save a draft and come back to it.</p>
            </div>

            <div className="space-y-3">
              {(data.entries || []).map(e => {
                const tpl = e.template;
                const open = openEntry === e.entry_role_assignment_id;
                const done = e.review?.status === 'submitted';
                return (
                  <div key={e.entry_role_assignment_id} className="bg-white rounded-xl shadow-sm border overflow-hidden">
                    <button className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-gray-50"
                            onClick={() => openCard(e)}>
                      <span className="flex items-center gap-2 min-w-0">
                        {open ? <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" /> : <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />}
                        <span className="font-medium text-gray-900 truncate">{e.company}</span>
                      </span>
                      <span className="text-xs shrink-0">
                        {done
                          ? <span className="inline-flex items-center gap-1 text-green-700"><CheckCircle2 className="h-3.5 w-3.5" /> submitted · {e.review?.total_score}/100</span>
                          : e.review?.status === 'draft'
                            ? <span className="text-amber-700">draft saved</span>
                            : <span className="text-gray-400">not started</span>}
                      </span>
                    </button>

                    {open && !tpl && (
                      <div className="px-5 pb-5 text-sm text-gray-500">No scorecard is configured for this competition yet.</div>
                    )}

                    {open && tpl && (
                      <div className="px-5 pb-5 space-y-5 border-t border-gray-100 pt-4">
                        {tpl.criteria.map(c => (
                          <div key={c.id}>
                            <div className="flex items-baseline justify-between gap-3">
                              <label className="text-sm font-medium text-gray-900">
                                {c.label}
                                {c.critical && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-red-600">critical</span>}
                              </label>
                              <span className="text-xs text-gray-400 shrink-0">weight {c.weight}</span>
                            </div>
                            {c.description && <p className="text-xs text-gray-500 mt-0.5">{c.description}</p>}
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {Array.from({ length: tpl.scale_max - tpl.scale_min + 1 }, (_, i) => tpl.scale_min + i).map(n => (
                                <button key={n}
                                  className={`h-9 w-9 rounded-md border text-sm font-medium ${draft[c.id]?.score === n ? 'bg-primary text-white border-primary' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'}`}
                                  onClick={() => setDraft(p => ({ ...p, [c.id]: { score: n, comment: p[c.id]?.comment || '' } }))}>
                                  {n}
                                </button>
                              ))}
                            </div>
                            <Textarea className="mt-2 text-sm" rows={2} placeholder="Comment (optional)"
                              value={draft[c.id]?.comment || ''}
                              onChange={ev => setDraft(p => ({ ...p, [c.id]: { score: p[c.id]?.score ?? null, comment: ev.target.value } }))} />
                          </div>
                        ))}

                        <div>
                          <label className="text-sm font-medium text-gray-900">How confident are you in this assessment?</label>
                          <div className="flex gap-1.5 mt-2">
                            {[1, 2, 3, 4, 5].map(n => (
                              <button key={n}
                                className={`h-9 w-9 rounded-md border text-sm font-medium ${confidence === n ? 'bg-primary text-white border-primary' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'}`}
                                onClick={() => setConfidence(n)}>{n}</button>
                            ))}
                          </div>
                        </div>

                        <div className="flex gap-2 pt-1">
                          <Button variant="outline" className="flex-1" disabled={saving === e.entry_role_assignment_id}
                                  onClick={() => save(e, false)}>
                            {saving === e.entry_role_assignment_id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save draft'}
                          </Button>
                          <Button className="flex-1" disabled={saving === e.entry_role_assignment_id}
                                  onClick={() => save(e, true)}>
                            {done ? 'Update my score' : 'Submit my score'}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
