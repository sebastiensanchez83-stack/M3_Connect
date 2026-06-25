import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

// Reads the admin-set "participant editing closes on" date (YYYY-MM-DD) from the
// SM26 event settings and tells editors whether editing is now locked. Editing
// stays open through the deadline day and locks the day after.
export function useSm26EditLock() {
  const [date, setDate] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    supabase.from('sm_event').select('settings').eq('slug', 'sm26').maybeSingle()
      .then(({ data }) => {
        const s = (data as { settings?: { edit_locks_at?: string } } | null)?.settings;
        setDate(s?.edit_locks_at || null);
        setLoaded(true);
      });
  }, []);
  const today = new Date().toISOString().slice(0, 10);
  const locked = !!date && today > date;
  const prettyDate = date ? new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
  return { locked, date, prettyDate, loaded };
}
