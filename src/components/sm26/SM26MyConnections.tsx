import { useState, useEffect } from 'react';
import { Users } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/lib/supabase';

// The attendee's own "people I asked to connect with" list (from badge scans).
// Renders nothing until there's at least one connection, so it stays invisible
// before the event.

interface Conn { to_company: string; to_name: string | null; note: string | null; introduced: boolean; created_at: string }

export function SM26MyConnections({ eventId }: { eventId: string }) {
  const [conns, setConns] = useState<Conn[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    supabase.rpc('sm_my_connections', { p_event_id: eventId }).then(({ data }) => {
      setConns((data || []) as Conn[]);
      setLoaded(true);
    });
  }, [eventId]);

  if (!loaded || conns.length === 0) return null;

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-sm font-semibold text-gray-900 mb-1 flex items-center gap-2"><Users className="h-4 w-4 text-primary" /> People you connected with ({conns.length})</div>
        <p className="text-xs text-gray-500 mb-3">From badge scans at the event — the organizers will introduce you by email afterwards.</p>
        <div className="space-y-1.5">
          {conns.map((c, i) => (
            <div key={i} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">{c.to_company}{c.to_name && c.to_name !== c.to_company ? ` · ${c.to_name}` : ''}</div>
                {c.note && <div className="text-xs text-gray-500 truncate">{c.note}</div>}
              </div>
              {c.introduced
                ? <span className="text-[11px] text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5 shrink-0">Introduced</span>
                : <span className="text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded-full px-2 py-0.5 shrink-0">Intro pending</span>}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
