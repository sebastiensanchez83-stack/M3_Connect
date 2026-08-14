import { useState, useEffect } from 'react';
import { RefreshCw, Plus, Trash2, Save, Star, MessageSquare, Loader2, Download } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

// Admin feedback: edit the post-event questionnaire template and review
// responses (rating averages + free-text answers).

interface Question {
  key: string; label: string; kind: string; required: boolean; display_order: number;
  section?: string | null; help?: string | null;
  options?: { choices?: string[]; rows?: string[]; scale?: string[] } | null;
  _isNew?: boolean;
}
// An answer is a rating, a free text, a list of ticked choices, or a map keyed
// by matrix row / session id.
type AnswerValue = string | number | string[] | Record<string, string>;
// Answers carry who wrote them, taken from the registration rather than retyped
// on the form — so they can be cut by role, country or whether they paid.
interface Response {
  user_id: string | null; name: string; company: string; email: string | null;
  country: string | null; roles: string | null; paid: boolean | null; attended: boolean | null;
  answers: Record<string, AnswerValue>; submitted_at: string;
}

export function AdminSM26Feedback() {
  const [eventId, setEventId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [responses, setResponses] = useState<Response[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reporting, setReporting] = useState(false);
  // Session remarks are stored by id; titles make them readable.
  const [sessionTitles, setSessionTitles] = useState<Record<string, string>>({});

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    const { data: ev } = await supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle();
    if (!ev) { setLoading(false); return; }
    const eid = (ev as { id: string }).id;
    setEventId(eid);
    const [{ data: qs }, { data: rs }, { data: ss }] = await Promise.all([
      supabase.from('sm_feedback_question').select('key,label,kind,required,display_order,section,help,options').eq('event_id', eid).order('display_order'),
      supabase.rpc('sm_feedback_responses_admin', { p_event_id: eid }),
      supabase.rpc('sm_agenda', { p_event_id: eid }),
    ]);
    const titles: Record<string, string> = {};
    for (const x of ((ss || []) as { id: string; title: string }[])) titles[x.id] = x.title;
    setSessionTitles(titles);
    setQuestions((qs || []) as Question[]);
    setResponses((rs || []) as Response[]);
    setRemoved([]);
    setLoading(false);
  };

  const updateQ = (i: number, patch: Partial<Question>) =>
    setQuestions(prev => prev.map((q, idx) => idx === i ? { ...q, ...patch } : q));

  const addQuestion = () =>
    setQuestions(prev => [...prev, { key: `q_${Math.random().toString(36).slice(2, 8)}`, label: '', kind: 'text', required: false, display_order: prev.length + 1, _isNew: true }]);

  const removeQ = (i: number) => {
    const q = questions[i];
    if (!q._isNew) setRemoved(prev => [...prev, q.key]);
    setQuestions(prev => prev.filter((_, idx) => idx !== i));
  };

  const saveTemplate = async () => {
    if (!eventId) return;
    const valid = questions.filter(q => q.label.trim());
    if (removed.length > 0 && !window.confirm(
      `Save will permanently delete ${removed.length} question(s) and any answers already submitted for them. Continue?`)) return;
    setSaving(true);
    if (removed.length > 0) {
      await supabase.from('sm_feedback_question').delete().eq('event_id', eventId).in('key', removed);
    }
    const rows = valid.map((q, idx) => ({
      event_id: eventId, key: q.key, label: q.label.trim(), kind: q.kind, required: q.required, display_order: idx + 1,
    }));
    const { error } = await supabase.from('sm_feedback_question').upsert(rows, { onConflict: 'event_id,key' });
    setSaving(false);
    if (error) { toast({ title: 'Could not save template', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Feedback template saved' });
    load();
  };

  const avg = (key: string) => {
    const vals = responses.map(r => Number(r.answers[key])).filter(n => Number.isFinite(n) && n > 0);
    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  };
  // How many people picked each value of a Yes/No question.
  const yesNo = (key: string) => {
    let yes = 0, no = 0;
    for (const r of responses) {
      const v = String(r.answers[key] ?? '');
      if (v === 'Yes') yes++; else if (v === 'No') no++;
    }
    return { yes, no, answered: yes + no };
  };
  // How often each choice was ticked, commonest first.
  const tally = (key: string) => {
    const counts = new Map<string, number>();
    for (const r of responses) {
      const v = r.answers[key];
      if (Array.isArray(v)) for (const c of v) counts.set(String(c), (counts.get(String(c)) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  };
  // A matrix row scored Poor…Excellent, expressed as a mean position on the
  // scale so five rows can be compared at a glance.
  const matrixRows = (q: Question) => {
    const scale = q.options?.scale || [];
    return (q.options?.rows || []).map(row => {
      const vals: number[] = [];
      for (const r of responses) {
        const grid = r.answers[q.key];
        if (grid && typeof grid === 'object' && !Array.isArray(grid)) {
          const idx = scale.indexOf(String((grid as Record<string, string>)[row] ?? ''));
          if (idx >= 0) vals.push(idx + 1);
        }
      }
      return { row, n: vals.length, mean: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null };
    });
  };

  // Everyone who said they would come again — next year's invitation list,
  // ready the day after the event instead of reconstructed from memory in June.
  const returners = responses.filter(r => String(r.answers['return_next'] ?? '') === 'Yes');
  // What people said they might build together. Chased a few months later, this
  // is the only number a sponsor actually buys: what the Rendezvous generated.
  const collaborations = responses
    .map(r => ({ r, text: String(r.answers['collaborations'] ?? '').trim() }))
    .filter(x => x.text.length > 0);
  const consented = (r: Response) => String(r.answers['consent'] ?? '') === 'Yes';

  const downloadCsv = (filename: string, header: string[], rows: (string | number | null)[][]) => {
    // Quote everything: company names carry commas, verbatims carry newlines.
    const esc = (v: string | number | null) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
    // A BOM, so Excel opens accented names as written rather than as mojibake.
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  // The whole report assembled from what is already on screen, so the document
  // and the console can never quote different numbers.
  const downloadReport = async () => {
    setReporting(true);
    try {
      const { downloadFeedbackReportPdf } = await import('@/lib/feedbackReportPdf');
      const { toDataUrl } = await import('@/lib/programmePdf');
      const { BUNDLED_ASSETS } = await import('@/lib/invitationTemplates');
      const [banner, footer] = await Promise.all([
        toDataUrl(BUNDLED_ASSETS.banner),
        toDataUrl(BUNDLED_ASSETS.footer),
      ]);

      const blocks: import('@/lib/feedbackReportPdf').ReportBlock[] = [];
      const countries = new Set(responses.map(r => r.country).filter(Boolean));
      const overall = avg('overall');
      const ret = yesNo('return_next');
      blocks.push({
        kind: 'stats', heading: 'In numbers',
        items: [
          { label: 'Responses', value: String(responses.length) },
          { label: 'Countries represented', value: String(countries.size) },
          { label: 'Overall rating', value: overall != null ? `${overall.toFixed(1)}/5` : '—' },
          { label: 'Would come again', value: ret.answered ? `${Math.round((ret.yes / ret.answered) * 100)}%` : '—' },
          { label: 'Collaborations declared', value: String(collaborations.length) },
          { label: 'Checked in on site', value: String(responses.filter(r => r.attended).length) },
        ],
      });

      if (ratingQs.length) {
        blocks.push({
          kind: 'bars', heading: 'How the event was rated',
          items: ratingQs.map(q => {
            const a = avg(q.key);
            return { label: q.label, value: a ?? 0, max: 5, caption: a != null ? `${a.toFixed(1)}/5` : 'no answers' };
          }).filter(i => i.value > 0),
        });
      }

      for (const q of matrixQs) {
        const rows = matrixRows(q).filter(r => r.mean != null);
        const scaleMax = (q.options?.scale || []).length || 5;
        if (rows.length) {
          blocks.push({
            kind: 'bars', heading: q.label,
            items: rows.map(r => ({
              label: r.row, value: r.mean as number, max: scaleMax,
              caption: `${(r.mean as number).toFixed(1)}/${scaleMax}`,
            })),
          });
        }
      }

      for (const q of choiceQs) {
        const rows = tally(q.key);
        if (rows.length) {
          blocks.push({
            kind: 'bars', heading: q.label,
            items: rows.map(([choice, n]) => ({ label: choice, value: n, max: rows[0][1], caption: `${n}` })),
          });
        }
      }

      // Only people who said we may name them. Everything else stays internal —
      // that is exactly what the consent question buys.
      const quotable = responses.filter(consented);
      const verbatims = quotable
        .map(r => ({ text: String(r.answers['found_solutions'] ?? '').trim(), author: r.company }))
        .filter(v => v.text.length > 20).slice(0, 12);
      if (verbatims.length) {
        blocks.push({
          kind: 'quotes', heading: 'In their words',
          note: 'Only from participants who agreed to be named.', items: verbatims,
        });
      }
      const collabQuotes = collaborations.filter(c => consented(c.r))
        .map(({ r, text }) => ({ text, author: r.company })).slice(0, 12);
      if (collabQuotes.length) {
        blocks.push({
          kind: 'quotes', heading: 'Collaborations under discussion',
          note: 'Declared by participants as a direct result of the Rendezvous.', items: collabQuotes,
        });
      }

      await downloadFeedbackReportPdf(blocks, {
        title: 'Smart & Sustainable Marina Rendezvous 2026',
        subtitle: '20–21 September 2026 · Yacht Club de Monaco · Post-event report',
        note: `Based on ${responses.length} response${responses.length === 1 ? '' : 's'}. Quotes are published only where the participant gave permission.`,
      }, { banner, footer });
    } catch (e) {
      toast({ title: 'Could not build the report', description: (e as Error).message, variant: 'destructive' });
    }
    setReporting(false);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  const ratingQs = questions.filter(q => q.kind === 'rating');
  const textQs = questions.filter(q => q.kind === 'text');
  const yesNoQs = questions.filter(q => q.kind === 'yesno');
  const choiceQs = questions.filter(q => q.kind === 'multiselect' || q.kind === 'select');
  const matrixQs = questions.filter(q => q.kind === 'matrix');
  const perSessionQs = questions.filter(q => q.kind === 'per_session');

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><MessageSquare className="h-6 w-6 text-primary" /> SM26 Feedback</h1>
        {responses.length > 0 && (
          <Button variant="outline" className="gap-1.5" disabled={reporting} onClick={downloadReport}>
            {reporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Download the impact report
          </Button>
        )}
      </div>

      {/* The two answers with a life beyond the survey get their own cards,
          above the averages. An average is something you read once; these are
          lists you act on. */}
      {responses.length > 0 && (
        <div className="grid md:grid-cols-2 gap-4">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">Coming back · {returners.length}</CardTitle>
                {returners.length > 0 && (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                    onClick={() => downloadCsv('sm26-coming-back.csv',
                      ['Name', 'Company', 'Email', 'Country', 'Roles', 'Paid', 'Attended'],
                      returners.map(r => [r.name, r.company, r.email, r.country, r.roles, r.paid ? 'yes' : 'no', r.attended ? 'yes' : 'no']))}>
                    <Download className="h-3.5 w-3.5" /> CSV
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {returners.length === 0 ? (
                <p className="text-sm text-gray-400">Nobody has said yes yet.</p>
              ) : (
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {returners.map(r => (
                    <div key={r.user_id || r.submitted_at} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="text-gray-800 truncate">{r.name}</span>
                      <span className="text-xs text-gray-400 truncate shrink-0 max-w-[45%]">{r.company}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-gray-400 mt-2">Next year's invitation list, ready the day after the event.</p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">Collaborations declared · {collaborations.length}</CardTitle>
                {collaborations.length > 0 && (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                    onClick={() => downloadCsv('sm26-collaborations.csv',
                      ['Name', 'Company', 'Email', 'Roles', 'May we quote them', 'What they wrote'],
                      collaborations.map(({ r, text }) => [r.name, r.company, r.email, r.roles, consented(r) ? 'yes' : 'no', text]))}>
                    <Download className="h-3.5 w-3.5" /> CSV
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {collaborations.length === 0 ? (
                <p className="text-sm text-gray-400">Nothing declared yet.</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {collaborations.map(({ r, text }) => (
                    <div key={(r.user_id || '') + r.submitted_at}>
                      <div className="flex items-center gap-1.5 text-xs text-gray-500">
                        <span className="truncate">{r.company}</span>
                        {consented(r)
                          ? <Badge className="bg-green-50 text-green-700 border-green-200 text-[10px]">quotable</Badge>
                          : <Badge className="bg-gray-100 text-gray-500 border-gray-200 text-[10px]">internal only</Badge>}
                      </div>
                      <p className="text-sm text-gray-700">{text}</p>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-gray-400 mt-2">Chase these a few months on — it is the number that sells next year's sponsorship.</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Responses summary */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2"><CardTitle className="text-base">Responses · {responses.length}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {responses.length === 0 ? (
            <p className="text-sm text-gray-400">No responses yet.</p>
          ) : (
            <>
              <div className="grid sm:grid-cols-2 gap-x-8 gap-y-2">
                {ratingQs.map(q => {
                  const a = avg(q.key);
                  return (
                    <div key={q.key} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-gray-600 truncate">{q.label}</span>
                      <span className="flex items-center gap-1 font-medium text-gray-900 shrink-0">
                        {a != null ? a.toFixed(1) : '—'} <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                      </span>
                    </div>
                  );
                })}
              </div>
              {/* Yes/No first: "would you come again" and the permission to
                  quote people are the two answers with consequences. */}
              {yesNoQs.map(q => {
                const { yes, no, answered } = yesNo(q.key);
                if (!answered) return null;
                return (
                  <div key={q.key} className="border-t border-gray-100 pt-3">
                    <div className="flex items-baseline justify-between gap-3 mb-1.5">
                      <span className="text-sm text-gray-700">{q.label}</span>
                      <span className="text-sm font-semibold text-gray-900 shrink-0">{yes} yes · {no} no</span>
                    </div>
                    <div className="h-2 rounded-full bg-red-100 overflow-hidden">
                      <div className="h-full bg-green-500" style={{ width: `${Math.round((yes / answered) * 100)}%` }} />
                    </div>
                  </div>
                );
              })}

              {choiceQs.map(q => {
                const rows = tally(q.key);
                if (rows.length === 0) return null;
                const top = rows[0][1];
                return (
                  <div key={q.key} className="border-t border-gray-100 pt-3">
                    <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1.5">{q.label}</div>
                    <div className="space-y-1">
                      {rows.map(([choice, n]) => (
                        <div key={choice} className="flex items-center gap-2 text-sm">
                          <span className="text-gray-600 flex-1 truncate">{choice}</span>
                          <div className="w-24 h-1.5 rounded-full bg-gray-100 overflow-hidden shrink-0">
                            <div className="h-full bg-primary" style={{ width: `${Math.round((n / top) * 100)}%` }} />
                          </div>
                          <span className="text-gray-900 font-medium w-6 text-right shrink-0">{n}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              {matrixQs.map(q => {
                const rows = matrixRows(q).filter(r => r.mean != null);
                if (rows.length === 0) return null;
                const scaleMax = (q.options?.scale || []).length || 5;
                return (
                  <div key={q.key} className="border-t border-gray-100 pt-3">
                    <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1.5">{q.label}</div>
                    <div className="space-y-1">
                      {rows.map(r => (
                        <div key={r.row} className="flex items-center gap-2 text-sm">
                          <span className="text-gray-600 flex-1 truncate">{r.row}</span>
                          <div className="w-24 h-1.5 rounded-full bg-gray-100 overflow-hidden shrink-0">
                            <div className="h-full bg-primary" style={{ width: `${Math.round(((r.mean as number) / scaleMax) * 100)}%` }} />
                          </div>
                          <span className="text-gray-900 font-medium w-14 text-right shrink-0">
                            {(r.mean as number).toFixed(1)}/{scaleMax}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              {textQs.map(q => {
                const answers = responses.map(r => String(r.answers[q.key] || '').trim()).filter(Boolean);
                if (answers.length === 0) return null;
                return (
                  <div key={q.key} className="border-t border-gray-100 pt-3">
                    <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">{q.label}</div>
                    <div className="space-y-1.5">
                      {answers.map((a, i) => <p key={i} className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2">{a}</p>)}
                    </div>
                  </div>
                );
              })}

              {/* Session remarks arrive keyed by session id; grouped by session
                  they read as a debrief, ungrouped they are noise. */}
              {perSessionQs.map(q => {
                const bySession = new Map<string, string[]>();
                for (const r of responses) {
                  const per = r.answers[q.key];
                  if (per && typeof per === 'object' && !Array.isArray(per)) {
                    for (const [sid, txt] of Object.entries(per as Record<string, string>)) {
                      const t = String(txt || '').trim();
                      if (t) bySession.set(sid, [...(bySession.get(sid) || []), t]);
                    }
                  }
                }
                if (bySession.size === 0) return null;
                return (
                  <div key={q.key} className="border-t border-gray-100 pt-3">
                    <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1.5">{q.label}</div>
                    <div className="space-y-3">
                      {[...bySession.entries()].map(([sid, texts]) => (
                        <div key={sid}>
                          <div className="text-sm font-medium text-gray-800 mb-1">
                            {sessionTitles[sid] || 'Session'} <span className="text-gray-400 font-normal">· {texts.length}</span>
                          </div>
                          <div className="space-y-1.5">
                            {texts.map((t, i) => <p key={i} className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2">{t}</p>)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </CardContent>
      </Card>

      {/* Template editor */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">Questionnaire template</CardTitle>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={addQuestion}><Plus className="h-4 w-4" /> Add question</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {questions.map((q, i) => (
            <div key={q.key} className="flex items-center gap-2 rounded-lg border border-gray-100 p-2">
              <span className="text-xs text-gray-400 w-5 text-center shrink-0">{i + 1}</span>
              <Input value={q.label} onChange={e => updateQ(i, { label: e.target.value })} placeholder="Question text" className="h-9 flex-1" />
              <Select value={q.kind} onValueChange={v => updateQ(i, { kind: v })}>
                <SelectTrigger className="h-9 w-28 shrink-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {/* Every kind the participant page can draw. A question whose
                      kind is missing here would show an empty dropdown and could
                      be saved back as blank — which is how a matrix quietly
                      becomes a text box. */}
                  <SelectItem value="rating">Rating (1–5 stars)</SelectItem>
                  <SelectItem value="text">Free text</SelectItem>
                  <SelectItem value="yesno">Yes / No</SelectItem>
                  <SelectItem value="select">One choice</SelectItem>
                  <SelectItem value="multiselect">Several choices</SelectItem>
                  <SelectItem value="matrix">Grid of rows to rate</SelectItem>
                  <SelectItem value="per_session">One box per programme session</SelectItem>
                </SelectContent>
              </Select>
              <label className="flex items-center gap-1.5 text-xs text-gray-500 shrink-0">
                <Checkbox checked={q.required} onCheckedChange={c => updateQ(i, { required: c as boolean })} /> Req.
              </label>
              <Button size="icon" variant="ghost" className="h-8 w-8 text-gray-400 hover:text-red-600 shrink-0" onClick={() => removeQ(i)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          {questions.length === 0 && <p className="text-sm text-gray-400 py-2">No questions — add one to build the form.</p>}
          <div className="flex items-center justify-between pt-2">
            <Badge variant="secondary" className="text-[10px]">Participants fill this at /sm26/feedback</Badge>
            <Button size="sm" className="gap-1.5" onClick={saveTemplate} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save template
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
