import { useEffect, useState } from 'react';
import {
  Cpu, Droplets, FileText, Landmark, Leaf, Lightbulb, Recycle, ShieldCheck, Zap, type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { TextTileItem } from '@/components/organization/TextTiles';

// D4.3: a marina's Smart Marina 2026 sustainability narrative + per-criterion
// evidence images, for its SMC organisation profile. Reads a SECURITY DEFINER RPC
// (sm_marina_extra is otherwise owner/staff-scoped) that returns only the
// non-sensitive narrative for the org's live marina entry. Shown by
// SM26MarinaSustainability as tiles.

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

const SECTIONS: { text: keyof MarinaSubmission; image?: keyof MarinaSubmission; label: string; icon: LucideIcon }[] = [
  { text: 'architectural_quality', label: 'Architectural quality', icon: Landmark },
  { text: 'biodiversity', image: 'biodiversity_image', label: 'Biodiversity & sustainability', icon: Leaf },
  { text: 'water', image: 'water_image', label: 'Water management', icon: Droplets },
  { text: 'energy', image: 'energy_image', label: 'Energy', icon: Zap },
  { text: 'waste', image: 'waste_image', label: 'Waste management', icon: Recycle },
  { text: 'innovation', image: 'innovation_image', label: 'Innovation', icon: Lightbulb },
  { text: 'security', image: 'security_image', label: 'Health & security', icon: ShieldCheck },
  { text: 'sustainable_diff', label: 'Sustainable differentiation & smart solution', icon: Cpu },
  { text: 'further_info', label: 'More', icon: FileText },
];

/**
 * The marina's Smart Marina 2026 texts, as tiles. `loaded` turns true once the read
 * is over (with or without texts); `items` is empty when there is nothing to show.
 * Pass null to skip the read (not a marina).
 */
export function useSM26MarinaTexts(orgId: string | null): { loaded: boolean; items: TextTileItem[] } {
  const [sub, setSub] = useState<MarinaSubmission | null>(null);
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setSub(null);
    setSigned({});
    setLoaded(false);
    if (!orgId) return;
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

  const items: TextTileItem[] = [];
  if (sub) {
    for (const sec of SECTIONS) {
      const text = ((sub[sec.text] as string | null) || '').trim();
      if (!text) continue;
      const imgVal = sec.image ? (sub[sec.image] as string | null) : null;
      items.push({
        key: sec.text,
        title: sec.label,
        text,
        icon: sec.icon,
        image: imgVal ? signed[imgVal] ?? null : null,
        imageAlt: sec.label,
      });
    }
  }
  return { loaded, items };
}

