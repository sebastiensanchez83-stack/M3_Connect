import { useState, useEffect } from 'react';
import { Scale } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { supabase } from '@/lib/supabase';

// Shown to innovators (startups) in the event hub: the panel of experts
// evaluating the Innovation Awards. Names/company only — individual scores and
// comments are never exposed (judging stays blind). Renders nothing until the
// jury is confirmed.

interface Juror { name: string | null; company: string | null; job_title: string | null; domain: string | null }

export function SM26MyJuryPanel({ eventId }: { eventId: string }) {
  const [jurors, setJurors] = useState<Juror[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.rpc('sm_my_innovation_jury_panel', { p_event_id: eventId });
      if (active) { setJurors((data || []) as Juror[]); setLoaded(true); }
    })();
    return () => { active = false; };
  }, [eventId]);

  if (!loaded || jurors.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Scale className="h-5 w-5 text-primary" /> Your innovation jury</CardTitle>
        <CardDescription>The experts evaluating the Innovation Awards. Scoring is confidential — individual scores and comments are never shared.</CardDescription>
      </CardHeader>
      <CardContent className="grid sm:grid-cols-2 gap-2">
        {jurors.map((j, i) => (
          <div key={i} className="rounded-lg border border-gray-100 p-3">
            <div className="font-medium text-gray-900">{j.name || 'Juror'}</div>
            {(j.job_title || j.company) && (
              <div className="text-xs text-gray-500">{[j.job_title, j.company].filter(Boolean).join(' · ')}</div>
            )}
            {j.domain && <div className="text-[11px] text-gray-400 mt-0.5">{j.domain}</div>}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
