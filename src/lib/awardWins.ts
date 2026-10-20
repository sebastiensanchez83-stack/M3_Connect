import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Smart Marina award winners, by company page (the winner badge on the company
 * page and the directory card).
 *
 * Read through the public RPC org_award_wins() (migration 20261020130000): the
 * confirmed, visible awards of Admin > SM26 > Awards whose winning entry
 * belongs to a company. It is the same list as the public results on
 * /sm26/vote (sm_award_results), with the company's id instead of its name.
 * Read once per visit and shared by every card. Any failure (the function not
 * installed yet, offline) simply means "no badge".
 */

export interface AwardWin {
  organization_id: string;
  award_key: string;
  /** As stored on sm_award, e.g. "Innovation — Jury Award". Show it through awardWinText(). */
  award_label: string;
  competition: string;
  award_type: string;
  edition_year: number;
  event_slug: string;
}

export type AwardWinsByOrg = ReadonlyMap<string, AwardWin[]>;

const EMPTY: AwardWinsByOrg = new Map();
let cache: Promise<AwardWinsByOrg> | null = null;

export function fetchAwardWins(): Promise<AwardWinsByOrg> {
  if (!cache) {
    cache = Promise.resolve(supabase.rpc('org_award_wins'))
      .then(({ data, error }) => {
        if (error || !Array.isArray(data)) return EMPTY;
        const byOrg = new Map<string, AwardWin[]>();
        for (const row of data as AwardWin[]) {
          if (!row?.organization_id || !row.award_label) continue;
          const list = byOrg.get(row.organization_id) ?? [];
          list.push(row);
          byOrg.set(row.organization_id, list);
        }
        return byOrg as AwardWinsByOrg;
      })
      .catch(() => EMPTY);
  }
  return cache;
}

/** Every company's wins (empty until read, and when the read fails). */
export function useAwardWins(): AwardWinsByOrg {
  const [wins, setWins] = useState<AwardWinsByOrg>(EMPTY);
  useEffect(() => {
    let alive = true;
    void fetchAwardWins().then((m) => { if (alive) setWins(m); });
    return () => { alive = false; };
  }, []);
  return wins;
}

/** "Innovation — Jury Award" → "Innovation Jury Award": no dash in the badge text. */
export function awardName(label: string): string {
  return label.replace(/\s*[—–]\s*/g, ' ').replace(/\s+-\s+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** "Smart Marina 2026 winner, Innovation Jury Award". */
export function awardWinText(win: Pick<AwardWin, 'award_label' | 'edition_year'>): string {
  return `Smart Marina ${win.edition_year} winner, ${awardName(win.award_label)}`;
}
