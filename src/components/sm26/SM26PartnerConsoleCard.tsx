import { useState, useEffect, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Anchor, Rocket, ExternalLink } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

// One-click entry to the event partner console(s) the signed-in user can access.
// Reads sm_event_partner (its RLS returns only the caller's own rows), so it
// renders for Yacht Club de Monaco / Yachting Ventures partners and nobody else.
// Gives them a discoverable button instead of having to know the /sm26/* URL.

const CONSOLES: Record<string, { label: string; desc: string; to: string; icon: ReactNode }> = {
  yacht_club: {
    label: 'Yacht Club — Event console',
    desc: 'Manage the e-catalogue, sponsor deliverables and exhibitor dossiers for the Rendezvous.',
    to: '/sm26/partner',
    icon: <Anchor className="h-4 w-4 text-primary shrink-0" />,
  },
  yachting_ventures: {
    label: 'Yachting Ventures — Event console',
    desc: 'Review the innovation entries and assign the jury panel for the Rendezvous.',
    to: '/sm26/yv',
    icon: <Rocket className="h-4 w-4 text-primary shrink-0" />,
  },
};

export function SM26PartnerConsoleCard() {
  const { user } = useAuth();
  const [kinds, setKinds] = useState<string[]>([]);

  useEffect(() => {
    if (!user) { setKinds([]); return; }
    let alive = true;
    (async () => {
      const { data } = await supabase.from('sm_event_partner').select('kind').eq('user_id', user.id);
      if (alive) setKinds([...new Set((data || []).map(r => (r as { kind: string }).kind))]);
    })();
    return () => { alive = false; };
  }, [user]);

  const consoles = kinds.map(k => CONSOLES[k]).filter(Boolean);
  if (consoles.length === 0) return null;

  return (
    <>
      {consoles.map(c => (
        <Card key={c.to} className="border-l-4 border-l-primary">
          <CardContent className="flex items-center justify-between gap-4 py-4 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-semibold text-gray-900">
                {c.icon} {c.label}
              </div>
              <p className="text-sm text-gray-500 mt-0.5">{c.desc}</p>
            </div>
            <Button asChild size="sm" className="gap-1.5 shrink-0">
              <Link to={c.to}>Open console <ExternalLink className="h-3.5 w-3.5" /></Link>
            </Button>
          </CardContent>
        </Card>
      ))}
    </>
  );
}
