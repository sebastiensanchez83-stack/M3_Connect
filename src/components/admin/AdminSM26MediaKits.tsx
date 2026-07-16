import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Megaphone, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { SM26MediaKitBoard } from '@/components/sm26/SM26MediaKitBoard';

// Admin home for media kits: the same flat board the Yacht Club uses, so M3 can
// upload social visuals + notify participants + see who has received / opened /
// downloaded theirs, without opening each registration.
export function AdminSM26MediaKits() {
  const navigate = useNavigate();
  const [eventId, setEventId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: ev } = await supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle();
      setEventId((ev as { id: string } | null)?.id || null);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate('/admin/sm26')} className="gap-1.5"><ArrowLeft className="h-4 w-4" /> Back to registrations</Button>
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Megaphone className="h-6 w-6 text-primary" /> Media kits</h1>
        <p className="text-sm text-gray-500 mt-0.5">Hand out the social visuals participants can post about the event and see who has received, opened and downloaded theirs. The Yacht Club can do this too from their partner console.</p>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-400 py-8 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : eventId ? (
        <SM26MediaKitBoard eventId={eventId} />
      ) : (
        <p className="text-sm text-gray-400">SM26 event not found.</p>
      )}
    </div>
  );
}
