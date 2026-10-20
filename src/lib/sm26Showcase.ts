import {
  BookOpen, Briefcase, Coins, Crosshair, Gem, Globe2, Leaf, Lightbulb, Link2, Puzzle, Ruler, Swords, Users,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

/**
 * A company's Smart Marina 2026 catalogue and jury texts on its page (Victor, 20 Oct 2026).
 *
 * The database decides what is public (supabase/migrations/20261020140000_org_sm26_showcase.sql):
 * - org_sm26_showcase(p_org_id), anyone: only the allowed blocks of a verified company's latest
 *   confirmed startup entry and professional architecture entry, minus what the company hid;
 *   null when there is nothing to show. A "restricted" entry (startup visibility level 1, or no
 *   consent to the e-catalogue) shows nothing until the company opts in.
 * - org_sm26_showcase_settings(p_org_id), members of the company and M3 staff: each entry, its
 *   blocks and the company's choice for it (one choice per entry kind).
 * - org_sm26_showcase_set(p_org_id, p_kind, p_opted_in, p_hidden_sections), the owner and M3
 *   staff. Staff may hide anything but cannot switch on a restricted entry for the company.
 * Never part of it: the pitch deck, the funding fields (amount, stage, type), the team, jury data,
 * images (the files are private; showing them is a follow-up). The free texts are shown as the
 * company wrote them: `mentionsMoney` flags the ones that talk about amounts or investment, so
 * the owner checks them before choosing.
 */

export type ShowcaseKind = 'startup' | 'architect';

export type ShowcaseSectionKey =
  | 'activity' | 'problem' | 'solution' | 'differentiation' | 'usp' | 'target_markets' | 'business_model'
  | 'positioning' | 'collaboration' | 'references' | 'links' | 'description' | 'sustainability';

export interface ShowcaseLinks {
  linkedin?: string;
  instagram?: string;
  facebook?: string;
  twitter?: string;
  x?: string;
  youtube?: string;
  tiktok?: string;
  website?: string;
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

/** One entry as its company sees it, with the company's choice for it. */
export interface ShowcaseEntry extends ShowcaseBlock {
  restricted: boolean;
  restricted_reason: 'visibility' | 'consent' | null;
  /** null = no choice yet (shown unless restricted), true = shown, false = hidden. */
  opted_in: boolean | null;
  hidden_sections: ShowcaseSectionKey[];
  updated_at: string | null;
}

export interface ShowcaseSettings {
  can_edit: boolean;
  /** The company owner (staff who are not the owner cannot switch a restricted entry on). */
  is_owner: boolean;
  listed: boolean;
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
  // Victor's list for architects: description, sustainability statement, references (renders later).
  architect: [
    { key: 'description', title: 'About the practice', icon: Ruler },
    { key: 'sustainability', title: 'Sustainability statement', icon: Leaf },
    { key: 'references', title: 'References', icon: BookOpen },
  ],
};

export const KIND_LABEL: Record<ShowcaseKind, string> = {
  startup: 'Innovation dossier',
  architect: 'Architecture competition entry',
};

const LINK_LABEL: Record<keyof ShowcaseLinks, string> = {
  linkedin: 'LinkedIn', instagram: 'Instagram', facebook: 'Facebook', twitter: 'X / Twitter', x: 'X / Twitter',
  youtube: 'YouTube', tiktok: 'TikTok', website: 'Website',
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

/** An amount of money: a currency sign or code next to a number, or "2 million", "500k€"… */
const AMOUNT_RE = /(?:[€$£]\s?\d)|(?:\d(?:[\d.,\s]*\d)?\s?(?:k|m|mn|bn|million|millions|billion)?\s?(?:€|\$|£|eur\b|euros?\b|usd\b|chf\b|gbp\b|dollars?\b))|(?:\d\s?(?:million|millions|billion|billions)\b)/i;
/** Fundraising and investment words. */
const FUNDING_RE = /\b(?:invest(?:or|ors|ment|ments|ing)?|fund(?:ing|raising|raise|ed)?|seed\s+round|series\s+[abc]\b|pre-seed|valuation|equity|venture\s+capital|business\s+angels?)\b/i;

/**
 * Whether a text talks about money (an amount) or investment: the owner is asked to read it
 * before showing it, because the free texts are shown exactly as written.
 */
export function mentionsMoney(text: string | undefined | null): 'amount' | 'funding' | null {
  if (!text) return null;
  if (AMOUNT_RE.test(text)) return 'amount';
  if (FUNDING_RE.test(text)) return 'funding';
  return null;
}

/** What the visitor of a company page sees; null when nothing (or when the read fails). */
export async function fetchShowcase(orgId: string): Promise<Showcase | null> {
  const { data, error } = await supabase.rpc('org_sm26_showcase', { p_org_id: orgId });
  if (error || !data) return null;
  const s = data as Showcase;
  return Array.isArray(s.blocks) && s.blocks.length > 0 ? s : null;
}

function normalize(data: unknown): ShowcaseSettings {
  const s = (data ?? {}) as Partial<ShowcaseSettings>;
  return {
    can_edit: !!s.can_edit,
    is_owner: !!s.is_owner,
    listed: !!s.listed,
    entries: (Array.isArray(s.entries) ? s.entries : []).map((e) => ({
      ...e,
      sections: e.sections ?? {},
      opted_in: typeof e.opted_in === 'boolean' ? e.opted_in : null,
      hidden_sections: Array.isArray(e.hidden_sections) ? e.hidden_sections : [],
    })),
  };
}

/** The company's entries and choices, for its members; null when this person may not read it. */
export async function fetchShowcaseSettings(orgId: string): Promise<ShowcaseSettings | null> {
  const { data, error } = await supabase.rpc('org_sm26_showcase_settings', { p_org_id: orgId });
  if (error || !data) return null;
  return normalize(data);
}

/** Save the choice for one entry kind (the owner or M3 staff). Returns the new settings. */
export async function saveShowcase(
  orgId: string,
  kind: ShowcaseKind,
  optedIn: boolean | null,
  hidden: ShowcaseSectionKey[],
): Promise<ShowcaseSettings> {
  const { data, error } = await supabase.rpc('org_sm26_showcase_set', {
    p_org_id: orgId,
    p_kind: kind,
    p_opted_in: optedIn,
    p_hidden_sections: hidden,
  });
  if (error) {
    // The database's refusals ("Only the company owner can…") are written for people.
    throw new Error(error.code === '42501' && !error.message?.startsWith('Only') ? 'Only the company owner can change this.' : error.message || 'Could not save your choice.');
  }
  return normalize(data);
}

/** Whether the page shows an entry now: the company's choice, or by default unless restricted. */
export function entryShown(e: ShowcaseEntry): boolean {
  return e.opted_in ?? !e.restricted;
}

/** A restricted entry nobody has decided on yet: hidden, and the company is asked to choose. */
export function entryWaiting(e: ShowcaseEntry): boolean {
  return e.restricted && e.opted_in === null;
}
