import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { WYS26_PATH, isWys26Event, wys26Upcoming } from '@/components/events/WysInvitationCard';
import { boardDay } from '@/lib/boardDate';
import type { BoardRow } from './DepartureBoard';

/**
 * Real rows for the DepartureBoard, read anonymously (public data only):
 *
 *  1. upcoming published events, in date order, with the World Yachting Summit
 *     (Dubai, 27 Nov 2026, by invitation → /wys26) added while it is upcoming
 *     unless an events row already carries it;
 *  2. the latest webinar replays;
 *  3. the newest verified member organisations that have an owner (real
 *     members, not the imported marinas nobody has claimed yet).
 *
 * Order, stable from one visit to the next: what is coming first (date order),
 * then everything else newest first (replays and new members mixed by date).
 * Enough rows are fetched for the board's two sets to be different rows.
 *
 * Every query may fail on its own (allSettled): the board shows what it has.
 */

interface EventRow {
  id: string;
  title: string;
  date_time: string;
  event_type: string | null;
  location: string | null;
  invitation_only: boolean | null;
  published: boolean | null;
}
interface ReplayRow extends EventRow {
  replay_url: string | null;
}
interface MemberRow {
  id: string;
  slug: string;
  name: string;
  country: string | null;
  city: string | null;
  created_at: string;
}

/** 27 Nov 2026, Dubai time: the summit's own date, independent of the visitor's zone. */
const WYS26_DATE = '2026-11-27T10:00:00+04:00';

export function useDepartureRows({ members = 7, replays = 3 }: { members?: number; replays?: number } = {}): {
  rows: BoardRow[];
  loading: boolean;
} {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<{ events: EventRow[]; replays: ReplayRow[]; members: MemberRow[] } | null>(null);

  useEffect(() => {
    let alive = true;
    const nowIso = new Date().toISOString();
    (async () => {
      const [eventsRes, replaysRes, membersRes] = await Promise.allSettled([
        supabase
          .from('events')
          .select('id, title, date_time, event_type, location, invitation_only, published')
          .gte('date_time', nowIso)
          .order('date_time', { ascending: true })
          .limit(8),
        supabase
          .from('events')
          .select('id, title, date_time, event_type, location, invitation_only, published, replay_url')
          .not('replay_url', 'is', null)
          .lt('date_time', nowIso)
          .order('date_time', { ascending: false })
          .limit(replays),
        supabase
          .from('organizations')
          .select('id, slug, name, country, city, created_at')
          .eq('access_status', 'verified')
          .not('owner_user_id', 'is', null)
          .order('created_at', { ascending: false })
          .limit(members),
      ]);
      if (!alive) return;
      const ok = (r: PromiseSettledResult<{ data: unknown; error: unknown }>): unknown[] =>
        r.status === 'fulfilled' && !r.value.error && Array.isArray(r.value.data) ? r.value.data : [];
      setData({
        events: ok(eventsRes) as EventRow[],
        replays: ok(replaysRes) as ReplayRow[],
        members: ok(membersRes) as MemberRow[],
      });
    })().catch(() => alive && setData({ events: [], replays: [], members: [] }));
    return () => {
      alive = false;
    };
  }, [members, replays]);

  const rows = useMemo<BoardRow[]>(() => {
    if (!data) return [];
    // Board dates are 7 slots: "27 NOV", "27 FÉVR". Our own abbreviations (shared
    // with the rest of the home page), so a browser's "Sept" never overflows.
    const day = (iso: string, timeZone?: string) => boardDay(iso, i18n.language, timeZone);
    const online = t('brand.board.online', 'Online');
    const city = (location: string | null) => (location ? location.split(',')[0].trim() : '');
    const status = {
      invitation: t('brand.board.statusInvitation', 'By invitation'),
      upcoming: t('brand.board.statusUpcoming', 'Upcoming'),
      replay: t('brand.board.statusReplay', 'Replay'),
      member: t('brand.board.statusMember', 'New member'),
    };

    const events = data.events.filter((e) => e.published !== false);
    const now = Date.now();
    const upcoming: (BoardRow & { at: string })[] = events.map((e) => {
      const wys = isWys26Event(e.title);
      const webinar = (e.event_type ?? '').toLowerCase() === 'webinar';
      return {
        id: `event-${e.id}`,
        at: e.date_time,
        date: day(e.date_time),
        title: wys ? t('brand.events.wys.title', 'World Yachting Summit') : e.title,
        place: webinar ? online : city(e.location),
        status: wys || e.invitation_only ? status.invitation : status.upcoming,
        href: wys ? WYS26_PATH : `/events/${e.id}`,
        kind: wys || e.invitation_only ? 'invitation' : 'event',
      };
    });
    if (wys26Upcoming(now) && !events.some((e) => isWys26Event(e.title))) {
      upcoming.push({
        id: 'wys26',
        at: WYS26_DATE,
        date: day(WYS26_DATE, 'Asia/Dubai'),
        title: t('brand.events.wys.title', 'World Yachting Summit'),
        place: t('brand.events.wys.place', 'Dubai'),
        status: status.invitation,
        href: WYS26_PATH,
        kind: 'invitation',
      });
    }
    upcoming.sort((a, b) => a.at.localeCompare(b.at));

    const replayRows: (BoardRow & { at: string })[] = data.replays
      .filter((e) => e.published !== false)
      .map((e) => ({
        id: `replay-${e.id}`,
        at: e.date_time,
        date: day(e.date_time),
        title: e.title,
        place: online,
        status: status.replay,
        href: `/events/${e.id}`,
        kind: 'replay',
      }));

    const memberRows: (BoardRow & { at: string })[] = data.members.map((o) => ({
      id: `member-${o.id}`,
      at: o.created_at,
      date: day(o.created_at),
      title: o.name,
      place: o.city?.trim() || o.country?.trim() || '',
      status: status.member,
      href: `/organizations/${o.slug}`,
      kind: 'member',
    }));

    const rest = [...replayRows, ...memberRows].sort((a, b) => b.at.localeCompare(a.at));
    return [...upcoming, ...rest].map(({ at: _at, ...row }) => row);
  }, [data, i18n.language, t]);

  return { rows, loading: data === null };
}
