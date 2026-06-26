import { useState, useEffect } from 'react';
import { ThumbsUp, Loader2, Send, Check, EyeOff, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

// Live audience Q&A for one session. Attendees ask + upvote; with canModerate
// (staff) you also see hidden questions and can hide / mark answered. Used in the
// participant agenda and the admin programme editor.

interface Q {
  id: string; author_name: string | null; text: string; answered: boolean; hidden: boolean;
  created_at: string; upvotes: number; mine_voted: boolean; is_mine: boolean;
}

export function SM26SessionQA({ sessionId, canModerate = false }: { sessionId: string; canModerate?: boolean }) {
  const { user } = useAuth();
  const [questions, setQuestions] = useState<Q[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await supabase.rpc('sm_session_questions', { p_session_id: sessionId });
    setQuestions((data || []) as Q[]);
    setLoaded(true);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sessionId]);

  const ask = async () => {
    if (!text.trim()) return;
    if (!user) { toast({ title: 'Please sign in to ask a question' }); return; }
    setBusy(true);
    const { error } = await supabase.rpc('sm_ask_question', { p_session_id: sessionId, p_text: text.trim() });
    setBusy(false);
    if (error) { toast({ title: 'Could not post', description: error.message, variant: 'destructive' }); return; }
    setText('');
    toast({ title: 'Question posted' });
    load();
  };

  const toggleVote = async (q: Q) => {
    if (!user) { toast({ title: 'Sign in to upvote' }); return; }
    setQuestions(prev => prev.map(x => x.id === q.id ? { ...x, mine_voted: !x.mine_voted, upvotes: x.upvotes + (x.mine_voted ? -1 : 1) } : x));
    const { error } = await supabase.rpc('sm_toggle_question_vote', { p_question_id: q.id });
    if (error) load();
  };

  const moderate = async (q: Q, patch: { hidden?: boolean; answered?: boolean }) => {
    const { error } = await supabase.rpc('sm_moderate_question', { p_question_id: q.id, p_hidden: patch.hidden ?? null, p_answered: patch.answered ?? null });
    if (error) { toast({ title: 'Could not update', description: error.message, variant: 'destructive' }); return; }
    load();
  };

  return (
    <div className="space-y-2">
      {user ? (
        <div className="flex items-start gap-2">
          <Textarea rows={1} value={text} onChange={e => setText(e.target.value)} placeholder="Ask the speaker a question…" className="text-sm min-h-[38px]" />
          <Button size="sm" className="gap-1.5 shrink-0" onClick={ask} disabled={busy || !text.trim()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</Button>
        </div>
      ) : (
        <p className="text-xs text-gray-400">Sign in to ask a question.</p>
      )}

      {loaded && questions.length === 0 && <p className="text-xs text-gray-400">No questions yet — be the first to ask.</p>}

      {questions.map(q => (
        <div key={q.id} className={`flex items-start gap-2 rounded-lg border p-2 ${q.hidden ? 'border-red-100 bg-red-50/40 opacity-70' : q.answered ? 'border-green-100 bg-green-50/40' : 'border-gray-100'}`}>
          <button onClick={() => toggleVote(q)} title="Upvote" className={`flex flex-col items-center justify-center rounded-md border px-1.5 py-0.5 shrink-0 ${q.mine_voted ? 'border-primary text-primary bg-primary/5' : 'border-gray-200 text-gray-500 hover:border-primary/40'}`}>
            <ThumbsUp className="h-3.5 w-3.5" /><span className="text-[11px] font-medium leading-none mt-0.5">{q.upvotes}</span>
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-sm text-gray-800 whitespace-pre-wrap">{q.text}</div>
            <div className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
              <span>{q.author_name || 'Attendee'}{q.is_mine ? ' · you' : ''}</span>
              {q.answered && <span className="text-green-600 inline-flex items-center gap-0.5"><Check className="h-3 w-3" /> answered</span>}
              {q.hidden && <span className="text-red-500">hidden</span>}
            </div>
          </div>
          {canModerate && (
            <div className="flex items-center gap-1 shrink-0">
              <button title={q.answered ? 'Mark unanswered' : 'Mark answered'} onClick={() => moderate(q, { answered: !q.answered })} className={`p-1 ${q.answered ? 'text-green-600' : 'text-gray-400 hover:text-green-600'}`}><Check className="h-3.5 w-3.5" /></button>
              <button title={q.hidden ? 'Unhide' : 'Hide'} onClick={() => moderate(q, { hidden: !q.hidden })} className="text-gray-400 hover:text-red-600 p-1">{q.hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
