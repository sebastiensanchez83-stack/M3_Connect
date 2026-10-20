import {
  BookOpen, Briefcase, Coins, Compass, Crosshair, Gem, Globe2, Leaf, Lightbulb, Link2, Puzzle, Ruler, Swords, Users,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

/**
 * A company's Smart Marina 2026 catalogue and jury texts on its page (Victor, 20 Oct 2026).
 *
 * The database decides what is public (supabase/migrations/20261020140000_org_sm26_showcase.sql):
 * - org_sm26_showcase(p_org_id), anyone: only the allowed blocks of a verified company's latest
 *   confirmed startup or professional architecture entry, minus what the company hid; null when
 *   there is nothing to show. A "restricted" entry (startup visibility level 1, or no consent to
 *   the e-catalogue) shows nothing until the company opts in.
 * - org_sm26_showcase_settings(p_org_id), members of the company and M3 staff: the choice, and
 *   the blocks the company has.
 * - org_sm26_showcase_set(p_org_id, p_opted_in, p_hidden_sections), the owner and M3 staff.
 * Never part of it: the pitch deck, funding figures, the team, jury data, images (the files are
 * private; showing them is a follow-up).
 */

export type ShowcaseKind = 'startup' | 'architect';

export type ShowcaseSectionKey =
  | 'activity' | 'problem' | 'solution' | 'differentiation' | 'usp' | 'target_markets' | 'business_model'
  | 'positioning' | 'collaboration' | 'references' | 'links' | 'description' | 'sustainability' | 'domain';

export interface ShowcaseLinks {
  linkedin?: string;
  instagram?: string;
  facebook?: string;
  twitter?: string;
  x?: string;
  youtube?: string;
  tiktok?: string;
  website?: string;
  portfolio?: string;
}

export type ShowcaseSections = Partial<Record<Exclude<ShowcaseSectionKey, 'links'>, string>> & { links?: ShowcaseLinks };

export interface ShowcaseBlock {
  kind: ShowcaseKind;
  sections: ShowcaseSections;
}

export interface Showcase {
  edition: string;
  blocks: ShowcaseBlock[];
}

export interface ShowcaseEntry extends ShowcaseBlock {
  restricted: boolean;
  restricted_reason: 'visibility' | 'consent' | null;
}

export interface ShowcaseSettings {
  can_edit: boolean;
  listed: boolean;
  opted_in: boolean | null;
  hidden_sections: ShowcaseSectionKey[];
  updated_at: string | null;
  entries: ShowcaseEntry[];
}

export interface SectionDef {
  key: ShowcaseSectionKey;
  title: string;
  icon: LucideIcon;
}

/** The blocks of each kind, in reading order (the database returns them unordered). */
export const SECTIONS: Record<ShowcaseKind, SectionDef[]> = {
  startup: [
    { key: 'activity', title: 'What we do', icon: Briefcase },
    { key: 'problem', title: 'The problem', icon: Crosshair },
    { key: 'solution', title: 'Our solution', icon: Lightbulb },
    { key: 'differentiation', title: 'What makes it different', icon: Puzzle },
    { key: 'usp', title: 'Unique selling point', icon: Gem },
    { key: 'target_markets', title: 'Target markets', icon: Globe2 },
    { key: 'business_model', title: 'Business model', icon: Coins },
    { key: 'positioning', title: 'Competitive positioning', icon: Swords },
    { key: 'collaboration', title: 'Collaboration we are looking for', icon: Users },
    { key: 'references', title: 'References', icon: BookOpen },
    { key: 'links', title: 'Links', icon: Link2 },
  ],
  architect: [
    { key: 'domain', title: 'Field', icon: Compass },
    { key: 'description', title: 'About the practice', icon: Ruler },
    { key: 'sustainability', title: 'Sustainability statement', icon: Leaf },
    { key: 'references', title: 'References', icon: BookOpen },
    { key: 'links', title: 'Links', icon: Link2 },
  ],
};

export const KIND_LABEL: Record<ShowcaseKind, string> = {
  startup: 'Innovation dossier',
  architect: 'Architecture competition entry',
};

const LINK_LABEL: Record<keyof ShowcaseLinks, string> = {
  linkedin: 'LinkedIn', instagram: 'Instagram', facebook: 'Facebook', twitter: 'X / Twitter', x: 'X / Twitter',
  youtube: 'YouTube', tiktok: 'TikTok', website: 'Website', portfolio: 'Portfolio',
};

/** The links of a block, labelled, in a stable order. */
export function showcaseLinks(links: ShowcaseLinks | undefined): { key: string; label: string; url: string }[] {
  if (!links) return [];
  return (Object.keys(LINK_LABEL) as (keyof ShowcaseLinks)[])
    .filter((k) => typeof links[k] === 'string' && links[k]!.trim())
    .map((k) => ({ key: k, label: LINK_LABEL[k], url: links[k]!.trim() }));
}

/** Whether a section of an entry has something to show. */
export function sectionFilled(sections: ShowcaseSections, key: ShowcaseSectionKey): boolean {
  if (key === 'links') return showcaseLinks(sections.links).length > 0;
  const v = sections[key];
  return typeof v === 'string' && v.trim().length > 0;
}

/** What the visitor of a company page sees; null when nothing (or when the read fails). */
export async function fetchShowcase(orgId: string): Promise<Showcase | null> {
  const { data, error } = await supabase.rpc('org_sm26_showcase', { p_org_id: orgId });
  if (error || !data) return null;
  const s = data as Showcase;
  return Array.isArray(s.blocks) && s.blocks.length > 0 ? s : null;
}

/** The company's choice and blocks, for its members; null when this person may not read it. */
export async function fetchShowcaseSettings(orgId: string): Promise<ShowcaseSettings | null> {
  const { data, error } = await supabase.rpc('org_sm26_showcase_settings', { p_org_id: orgId });
  if (error || !data) return null;
  const s = data as ShowcaseSettings;
  return { ...s, hidden_sections: Array.isArray(s.hidden_sections) ? s.hidden_sections : [], entries: Array.isArray(s.entries) ? s.entries : [] };
}

/** Save the choice (the owner or M3 staff). Returns the new settings. */
export async function saveShowcase(orgId: string, optedIn: boolean | null, hidden: ShowcaseSectionKey[]): Promise<ShowcaseSettings> {
  const { data, error } = await supabase.rpc('org_sm26_showcase_set', {
    p_org_id: orgId,
    p_opted_in: optedIn,
    p_hidden_sections: hidden,
  });
  if (error) throw new Error(error.code === '42501' ? 'Only the company owner can change this.' : error.message || 'Could not save your choice.');
  const s = data as ShowcaseSettings;
  return { ...s, hidden_sections: Array.isArray(s.hidden_sections) ? s.hidden_sections : [], entries: Array.isArray(s.entries) ? s.entries : [] };
}

/**
 * Whether the page shows the entries now, from the settings: the company's choice, or by
 * default every entry that is not restricted.
 */
export function shownNow(s: ShowcaseSettings): boolean {
  if (s.opted_in !== null) return s.opted_in;
  return s.entries.some((e) => !e.restricted);
}
