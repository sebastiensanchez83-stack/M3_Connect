import { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { Star, Loader2, CheckCircle, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

// Post-event feedback form. Questions are data-driven from sm_feedback_question
// (M3 edits the template); answers are stored per attendee in
// sm_feedback_response (upsert, so they can revise).

interface Question { key: string; label: string; kind: string; required: boolean; display_order: number; }

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
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => { if (user) load(); /* eslint-disable-next-line */ }, [user]);

  const load = async () => {
    setLoading(true);
    const { data: ev } = await supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle();
    if (!ev) { setLoading(false); return; }
    const eid = (ev as { id: string }).id;
    setEventId(eid);
    const [{ data: qs }, { data: resp }] = await Promise.all([
      supabase.from('sm_feedback_question').select('key,label,kind,required,display_order').eq('event_id', eid).order('display_order'),
      supabase.from('sm_feedback_response').select('answers').eq('event_id', eid).eq('user_id', user!.id).maybeSingle(),
    ]);
    setQuestions((qs || []) as Question[]);
    if (resp) setAnswers(((resp as { answers: Record<string, string | number> }).answers) || {});
    setLoading(false);
  };

  const setAns = (key: string, v: string | number) => setAnswers(prev => ({ ...prev, [key]: v }));

  const submit = async () => {
    const missing = questions.filter(q => q.required && !answers[q.key]);
    if (missing.length > 0) { toast({ title: 'Please answer the required questions', variant: 'destructive' }); return; }
    if (!eventId || !user) return;
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
      <p className="text-gray-600">Your feedback helps us make the next Rendezvous even better. You can revisit this page to update your answers any time.</p>
    </div>
  );

  if (questions.length === 0) return (
    <div className="container mx-auto px-4 py-16 max-w-xl text-center text-gray-500">The feedback form isn't available yet.</div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet><title>Your feedback — SM26</title></Helmet>
      <section className="bg-gradient-to-br from-[#0b2653] to-[#143a6b] text-white">
        <div className="container mx-auto px-4 py-10">
          <p className="uppercase tracking-wide text-white/60 text-sm mb-2">SM26 · Smart &amp; Sustainable Marina Rendezvous 2026</p>
          <h1 className="text-2xl lg:text-3xl font-bold">Share your feedback</h1>
          <p className="text-white/80 mt-2">A few minutes of your time helps us improve next year's event.</p>
        </div>
      </section>

      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>Event feedback</CardTitle>
            <CardDescription>Required questions are marked with *. Your responses are linked to your registration.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {questions.map(q => (
              <div key={q.key} className="space-y-2">
                <Label className="text-sm">{q.label}{q.required && ' *'}</Label>
                {q.kind === 'rating' ? (
                  <Stars value={Number(answers[q.key]) || 0} onChange={v => setAns(q.key, v)} />
                ) : (
                  <Textarea rows={3} value={String(answers[q.key] || '')} onChange={e => setAns(q.key, e.target.value)} />
                )}
              </div>
            ))}
            <Button onClick={submit} disabled={saving} className="w-full gap-1.5">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Submit feedback
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
