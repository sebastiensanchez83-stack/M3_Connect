import { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { Star, Loader2, CheckCircle, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { requireFreshSession } from '@/lib/session';
import { toast } from '@/hooks/use-toast';
import { SM26BackLink } from '@/components/sm26/SM26BackLink';

// Post-event feedback. Questions are rows in sm_feedback_question, so next
// year's edition is edited rather than redeployed; answers are one JSONB blob
// per attendee in sm_feedback_response, upserted so they can revise.
//
// Shown one SECTION at a time. The 2025 paper form asked about thirty things
// and a single scrolling page of thirty is where people give up — the questions
// are the same, the wall isn't.
//
// Deliberately not asked: company, participant type, how they heard about the
// event. All three sit on their registration, so asking again would invite a
// second, conflicting answer and spend goodwill on data we hold.

interface Question {
  key: string; label: string; kind: string; required: boolean;
  display_order: number; section: string | null; help: string | null;
  options: { choices?: string[]; rows?: string[]; scale?: string[] } | null;
}
interface Session { id: string; title: string; type: string; starts_at: string }

type Answer = string | number | string[] | Record<string, string>;

function Stars({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" onClick={() => onChange(n)} className="p-0.5" aria-label={`${n} star${n > 1 ? 's' : ''}`}>
          <Star className={`h-7 w-7 transition-colors ${n <= value ? 'fill-amber-400 text-amber-400' : 'text-gray-300 hover:text-amber-300'}`} />
        </button>
      ))}
    </div>
  );
}

export function SM26FeedbackPage() {
  const { user, loading: authLoading } = useAuth();
  const [eventId, setEventId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => { if (user) load(); /* eslint-disable-next-line */ }, [user]);

  const load = async () => {
    setLoading(true);
    const { data: ev } = await supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle();
    if (!ev) { setLoading(false); return; }
    const eid = (ev as { id: string }).id;
    setEventId(eid);
    const [{ data: qs }, { data: resp }, { data: ss }] = await Promise.all([
      supabase.from('sm_feedback_question')
        .select('key,label,kind,required,display_order,section,help,options').eq('event_id', eid).order('display_order'),
      supabase.from('sm_feedback_response').select('answers').eq('event_id', eid).eq('user_id', user!.id).maybeSingle(),
      // The programme itself, so "remarks on the sessions" never lists last
      // year's conference titles.
      supabase.rpc('sm_agenda', { p_event_id: eid }),
    ]);
    setQuestions((qs || []) as Question[]);
    if (resp) setAnswers(((resp as { answers: Record<string, Answer> }).answers) || {});
    setSessions(((ss || []) as Session[]).filter(s => s.type !== 'meal'));
    setLoading(false);
  };

  const setAns = (key: string, v: Answer) => setAnswers(prev => ({ ...prev, [key]: v }));
  const toggleChoice = (key: string, choice: string) => {
    const cur = Array.isArray(answers[key]) ? (answers[key] as string[]) : [];
    setAns(key, cur.includes(choice) ? cur.filter(c => c !== choice) : [...cur, choice]);
  };

  // Sections in question order, so reordering questions reorders the steps.
  const sections: { name: string; questions: Question[] }[] = [];
  for (const q of questions) {
    const name = q.section || 'Feedback';
    const last = sections[sections.length - 1];
    if (last && last.name === name) last.questions.push(q);
    else sections.push({ name, questions: [q] });
  }

  const submit = async () => {
    const missing = questions.filter(q => q.required && !answers[q.key]);
    if (missing.length > 0) {
      // Send them to the step that is actually incomplete rather than saying no.
      const idx = sections.findIndex(s => s.questions.some(q => q.key === missing[0].key));
      if (idx >= 0) setStep(idx);
      toast({ title: 'One question still needs an answer', description: missing[0].label, variant: 'destructive' });
      return;
    }
    if (!eventId || !user) return;
    const uid = await requireFreshSession();
    if (!uid) return;
    setSaving(true);
    const { error } = await supabase.from('sm_feedback_response').upsert({
      event_id: eventId, user_id: user.id, answers, submitted_at: new Date().toISOString(),
    }, { onConflict: 'event_id,user_id' });
    setSaving(false);
    if (error) { toast({ title: 'Could not submit', description: error.message, variant: 'destructive' }); return; }
    setDone(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (authLoading || loading) return (
    <div className="flex items-center justify-center h-[60vh]"><RefreshCw className="h-8 w-8 animate-spin text-primary" /></div>
  );

  if (done) return (
    <div className="container mx-auto px-4 py-16 max-w-xl text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
        <CheckCircle className="h-8 w-8 text-green-600" />
      </div>
      <h1 className="text-2xl font-bold mb-2">Thank you</h1>
      <p className="text-gray-600">Your feedback shapes the next Rendezvous. You can come back to this page and change your answers any time.</p>
    </div>
  );

  if (sections.length === 0) return (
    <div className="container mx-auto px-4 py-16 max-w-xl text-center text-gray-500">The feedback form isn't available yet.</div>
  );

  const current = sections[Math.min(step, sections.length - 1)];
  const isLast = step >= sections.length - 1;

  const renderQuestion = (q: Question) => {
    switch (q.kind) {
      case 'rating':
        return <Stars value={Number(answers[q.key]) || 0} onChange={v => setAns(q.key, v)} />;

      case 'yesno':
        return (
          <div className="flex gap-2">
            {['Yes', 'No'].map(v => (
              <Button key={v} type="button" variant={answers[q.key] === v ? 'default' : 'outline'}
                className="flex-1" onClick={() => setAns(q.key, v)}>{v}</Button>
            ))}
          </div>
        );

      case 'select':
        return (
          <div className="flex flex-wrap gap-2">
            {(q.options?.choices || []).map(c => (
              <Button key={c} type="button" size="sm" variant={answers[q.key] === c ? 'default' : 'outline'}
                onClick={() => setAns(q.key, c)}>{c}</Button>
            ))}
          </div>
        );

      case 'multiselect': {
        const chosen = Array.isArray(answers[q.key]) ? (answers[q.key] as string[]) : [];
        return (
          <div className="space-y-2">
            {(q.options?.choices || []).map(c => (
              <label key={c} className="flex items-start gap-2.5 cursor-pointer">
                <Checkbox checked={chosen.includes(c)} onCheckedChange={() => toggleChoice(q.key, c)} className="mt-0.5" />
                <span className="text-sm text-gray-700">{c}</span>
              </label>
            ))}
          </div>
        );
      }

      case 'matrix': {
        const grid = (answers[q.key] && typeof answers[q.key] === 'object' && !Array.isArray(answers[q.key]))
          ? (answers[q.key] as Record<string, string>) : {};
        const scale = q.options?.scale || [];
        return (
          <div className="space-y-3">
            {(q.options?.rows || []).map(row => (
              <div key={row}>
                <div className="text-sm text-gray-700 mb-1.5">{row}</div>
                {/* Buttons rather than a table: five columns of radio dots are
                    unusable on a phone, and most of these arrive on a phone. */}
                <div className="flex flex-wrap gap-1.5">
                  {scale.map(s => (
                    <button key={s} type="button"
                      onClick={() => setAns(q.key, { ...grid, [row]: s })}
                      className={`text-xs rounded-md border px-2.5 py-1.5 transition-colors ${grid[row] === s ? 'border-primary bg-primary text-white' : 'border-gray-200 text-gray-600 hover:border-primary/40'}`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      }

      case 'per_session': {
        const per = (answers[q.key] && typeof answers[q.key] === 'object' && !Array.isArray(answers[q.key]))
          ? (answers[q.key] as Record<string, string>) : {};
        if (sessions.length === 0) return <p className="text-sm text-gray-400">The programme isn't published yet.</p>;
        return (
          <div className="space-y-3">
            {sessions.map(s => (
              <div key={s.id}>
                <div className="text-sm text-gray-700 mb-1">{s.title}</div>
                <Textarea rows={2} value={per[s.id] || ''} placeholder="Leave blank if you didn't attend"
                  onChange={e => setAns(q.key, { ...per, [s.id]: e.target.value })} />
              </div>
            ))}
          </div>
        );
      }

      default:
        return <Textarea rows={3} value={String(answers[q.key] ?? '')} onChange={e => setAns(q.key, e.target.value)} />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet><title>Your feedback — SM26</title></Helmet>
      <section className="bg-gradient-to-br from-[#0b2653] to-[#143a6b] text-white">
        <div className="container mx-auto px-4 py-10">
          <div className="mb-3"><SM26BackLink light /></div>
          <p className="uppercase tracking-wide text-white/60 text-sm mb-2">SM26 · Smart &amp; Sustainable Marina Rendezvous 2026</p>
          <h1 className="text-2xl lg:text-3xl font-bold">Share your feedback</h1>
          <p className="text-white/80 mt-2">Six short steps. Your answers are saved when you submit, and you can change them later.</p>
        </div>
      </section>

      <div className="container mx-auto px-4 py-8 max-w-2xl space-y-4">
        {/* Where they are, and how much is left. */}
        <div>
          <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
            <span>{current.name}</span>
            <span>Step {step + 1} of {sections.length}</span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${((step + 1) / sections.length) * 100}%` }} />
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{current.name}</CardTitle>
            <CardDescription>Questions marked * are the only ones we need.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {current.questions.map(q => (
              <div key={q.key} className="space-y-2">
                <Label className="text-sm">{q.label}{q.required && ' *'}</Label>
                {q.help && <p className="text-xs text-gray-500 -mt-1">{q.help}</p>}
                {renderQuestion(q)}
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-1.5" disabled={step === 0} onClick={() => { setStep(s => s - 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
            <ChevronLeft className="h-4 w-4" /> Back
          </Button>
          {isLast ? (
            <Button onClick={submit} disabled={saving} className="flex-1 gap-1.5">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Submit feedback
            </Button>
          ) : (
            <Button className="flex-1 gap-1.5" onClick={() => { setStep(s => s + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
