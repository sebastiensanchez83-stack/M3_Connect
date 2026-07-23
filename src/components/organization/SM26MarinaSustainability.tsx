import { useState, useEffect } from 'react';
import { Leaf } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/lib/supabase';

// D4.3: surface a marina's Smart Marina 2026 sustainability narrative + per-
// criterion evidence images on its SMC organisation profile. Reads a
// SECURITY DEFINER RPC (sm_marina_extra is otherwise owner/staff-scoped) that
// returns only the non-sensitive narrative for the org's live marina entry.
// Self-hiding: renders nothing until there is a submission with some text.

interface MarinaSubmission {
  architectural_quality?: string | null;
  biodiversity?: string | null;
  water?: string | null;
  energy?: string | null;
  waste?: string | null;
  innovation?: string | null;
  security?: string | null;
  sustainable_diff?: string | null;
  further_info?: string | null;
  biodiversity_image?: string | null;
  water_image?: string | null;
  energy_image?: string | null;
  waste_image?: string | null;
  innovation_image?: string | null;
  security_image?: string | null;
}

const SECTIONS: { text: keyof MarinaSubmission; image?: keyof MarinaSubmission; label: string }[] = [
  { text: 'architectural_quality', label: 'Architectural quality' },
  { text: 'biodiversity', image: 'biodiversity_image', label: 'Biodiversity & sustainability' },
  { text: 'water', image: 'water_image', label: 'Water management' },
  { text: 'energy', image: 'energy_image', label: 'Energy' },
  { text: 'waste', image: 'waste_image', label: 'Waste management' },
  { text: 'innovation', image: 'innovation_image', label: 'Innovation' },
  { text: 'security', image: 'security_image', label: 'Health & security' },
  { text: 'sustainable_diff', label: 'Sustainable differentiation & smart solution' },
  { text: 'further_info', label: 'More' },
];

export function SM26MarinaSustainability({ orgId }: { orgId: string }) {
  const [sub, setSub] = useState<MarinaSubmission | null>(null);
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.rpc('sm_org_marina_submission', { p_org_id: orgId });
      if (!active) return;
      const s = (data || null) as MarinaSubmission | null;
      setSub(s);
      setLoaded(true);
      if (!s) return;
      const urls: Record<string, string> = {};
      for (const sec of SECTIONS) {
        const val = sec.image ? (s[sec.image] as string | null) : null;
        if (!val) continue;
        if (/^https?:\/\//i.test(val)) { urls[val] = val; continue; } // imported (Jotform) URL
        const { data: sg } = await supabase.storage.from('event-media').createSignedUrl(val, 600);
        if (sg) urls[val] = sg.signedUrl;
      }
      if (active) setSigned(urls);
    })();
    return () => { active = false; };
  }, [orgId]);

  if (!loaded || !sub) return null;
  const hasAny = SECTIONS.some(sec => ((sub[sec.text] as string | null) || '').trim());
  if (!hasAny) return null;

  return (
    <Card>
      <CardContent className="pt-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1 flex items-center gap-2">
          <Leaf className="h-5 w-5 text-green-600" /> Sustainability &amp; Innovation
        </h2>
        <p className="text-xs text-gray-500 mb-5">From this marina's Smart &amp; Sustainable Marina Rendezvous 2026 submission.</p>
        <div className="space-y-5">
          {SECTIONS.map(sec => {
            const text = ((sub[sec.text] as string | null) || '').trim();
            if (!text) return null;
            const imgVal = sec.image ? (sub[sec.image] as string | null) : null;
            const imgUrl = imgVal ? signed[imgVal] : undefined;
            return (
              <div key={sec.text as string} className="grid sm:grid-cols-[1fr_auto] gap-3 items-start">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-800">{sec.label}</div>
                  <p className="text-sm text-gray-600 whitespace-pre-line mt-0.5">{text}</p>
                </div>
                {imgUrl && (
                  <a href={imgUrl} target="_blank" rel="noreferrer" className="block shrink-0">
                    <img src={imgUrl} alt={sec.label} className="w-24 h-24 object-cover rounded-lg border border-gray-100" />
                  </a>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
