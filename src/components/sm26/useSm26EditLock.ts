import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

// Reads the admin-set "participant editing closes on" date (YYYY-MM-DD) from the
// SM26 event settings and tells editors whether editing is now locked. Editing
// stays open through the deadline day (Monaco time, the event's timezone) and
// locks the day after. With no date set, the event's last day (end_date) applies.
// Same reading as the server (sm_participant_edits_locked, migration 20261009160000).
export function useSm26EditLock() {
  const [date, setDate] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    supabase.from('sm_event').select('settings, end_date').eq('slug', 'sm26').maybeSingle()
      .then(({ data }) => {
        const ev = data as { settings?: { edit_locks_at?: string } | null; end_date?: string | null } | null;
        setDate(ev?.settings?.edit_locks_at || ev?.end_date || null);
        setLoaded(true);
      });
  }, []);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Monaco' });
  const locked = !!date && today > date;
  const prettyDate = date ? new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
  return { locked, date, prettyDate, loaded };
}

// Same pattern for the attendee-roster deadline (settings.roster_locks_at). The
// roster stays editable through the deadline day (Monaco time — the event's
// timezone) and locks the day after. With no date set, the event's last day applies.
export function useSm26RosterLock() {
  const [date, setDate] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    supabase.from('sm_event').select('settings, end_date').eq('slug', 'sm26').maybeSingle()
      .then(({ data }) => {
        const ev = data as { settings?: { roster_locks_at?: string } | null; end_date?: string | null } | null;
        setDate(ev?.settings?.roster_locks_at || ev?.end_date || null);
        setLoaded(true);
      });
  }, []);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Monaco' });
  const locked = !!date && today > date;
  const prettyDate = date ? new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
  return { locked, date, prettyDate, loaded };
}
