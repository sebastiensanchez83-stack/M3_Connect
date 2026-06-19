import { useState, useEffect } from 'react';
import { RefreshCw, Plus, Trash2, Save, Star, MessageSquare, Loader2 } from 'lucide-react';
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

interface Question { key: string; label: string; kind: string; required: boolean; display_order: number; _isNew?: boolean; }
interface Response { answers: Record<string, string | number>; submitted_at: string; }

export function AdminSM26Feedback() {
  const [eventId, setEventId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [responses, setResponses] = useState<Response[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    const { data: ev } = await supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle();
    if (!ev) { setLoading(false); return; }
    const eid = (ev as { id: string }).id;
    setEventId(eid);
    const [{ data: qs }, { data: rs }] = await Promise.all([
      supabase.from('sm_feedback_question').select('key,label,kind,required,display_order').eq('event_id', eid).order('display_order'),
      supabase.from('sm_feedback_response').select('answers,submitted_at').eq('event_id', eid),
    ]);
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

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  const ratingQs = questions.filter(q => q.kind === 'rating');
  const textQs = questions.filter(q => q.kind === 'text');

  return (
    <div className="space-y-6 max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><MessageSquare className="h-6 w-6 text-primary" /> SM26 Feedback</h1>

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
                  <SelectItem value="rating">Rating</SelectItem>
                  <SelectItem value="text">Text</SelectItem>
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
