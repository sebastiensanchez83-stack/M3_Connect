import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { WYS26_PATH, isWys26Event, wys26Upcoming } from '@/components/events/WysInvitationCard';
import { RENDEZVOUS_2026_PATH } from '@/components/brand/m3Events';
import { boardDate } from '@/lib/boardDate';

/**
 * The home page's agenda, from real data (public rows, read anonymously):
 *
 *  1. the next published events, in date order, with the World Yachting Summit
 *     (Dubai, 27 Nov 2026, by invitation → /wys26) added while it is upcoming
 *     unless an events row already carries it;
 *  2. the Rendezvous' 6th edition (20 Sept 2026, finished), whose page stays the
 *     way to relive it.
 *
 * The component adds the closing row (webinar dates arrive by newsletter).
 * One query that may fail on its own: the agenda then shows what it has.
 */
export interface AgendaEntry {
  id: string;
  /** "27", "NOV", "2026": the date block. */
  day: string;
  month: string;
  year: string;
  /** Spoken date, for screen readers. */
  spoken: string;
  title: string;
  /** One line under the title: place · format · status. */
  sub: string;
  href: string;
}

interface EventRow {
  id: string;
  title: string;
  date_time: string;
  event_type: string | null;
  location: string | null;
  invitation_only: boolean | null;
  published: boolean | null;
}

/** 27 Nov 2026, Dubai time: the summit's own date, independent of the visitor's zone. */
const WYS26_DATE = '2026-11-27T10:00:00+04:00';
/** The 6th edition's first day, Monaco time. */
const RENDEZVOUS_DATE = '2026-09-20T10:00:00+02:00';

export function useHomeAgenda(max = 3): { entries: AgendaEntry[]; loading: boolean } {
  const { t, i18n } = useTranslation();
  const [events, setEvents] = useState<EventRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await supabase
        .from('events')
        .select('id, title, date_time, event_type, location, invitation_only, published')
        .gte('date_time', new Date().toISOString())
        .order('date_time', { ascending: true })
        .limit(8);
      if (!alive) return;
      setEvents(!res.error && Array.isArray(res.data) ? (res.data as EventRow[]) : []);
    })().catch(() => alive && setEvents([]));
    return () => {
      alive = false;
    };
  }, []);

  const entries = useMemo<AgendaEntry[]>(() => {
    if (!events) return [];
    const lang = i18n.language;
    const split = (iso: string, timeZone?: string) => {
      const [day, month, year] = boardDate(iso, lang, timeZone).split(' ');
      return { day, month, year };
    };
    const city = (location: string | null) => (location ? location.split(',')[0].trim() : '');
    const online = t('brand.board.online', 'Online');
    const published = events.filter((e) => e.published !== false);
    const now = Date.now();

    type Row = AgendaEntry & { at: string };
    const upcoming: Row[] = published.map((e) => {
      const wys = isWys26Event(e.title);
      const webinar = (e.event_type ?? '').toLowerCase() === 'webinar';
      const invitation = wys || !!e.invitation_only;
      const parts = [
        webinar ? online : city(e.location),
        wys ? t('homePage.agenda.wysFormat', 'Conference and gala') : null,
        invitation ? t('brand.board.statusInvitation', 'By invitation') : null,
      ].filter(Boolean);
      return {
        id: `event-${e.id}`,
        at: e.date_time,
        ...split(e.date_time, wys ? 'Asia/Dubai' : undefined),
        spoken: boardDate(e.date_time, lang),
        title: wys ? t('brand.events.wys.title', 'World Yachting Summit 2026') : e.title,
        sub: parts.join(' · '),
        href: wys ? WYS26_PATH : `/events/${e.id}`,
      };
    });
    if (wys26Upcoming(now) && !published.some((e) => isWys26Event(e.title))) {
      upcoming.push({
        id: 'wys26',
        at: WYS26_DATE,
        ...split(WYS26_DATE, 'Asia/Dubai'),
        spoken: boardDate(WYS26_DATE, lang, 'Asia/Dubai'),
        title: t('brand.events.wys.title', 'World Yachting Summit 2026'),
        sub: [
          t('brand.events.wys.place', 'Dubai'),
          t('homePage.agenda.wysFormat', 'Conference and gala'),
          t('brand.board.statusInvitation', 'By invitation'),
        ].join(' · '),
        href: WYS26_PATH,
      });
    }
    upcoming.sort((a, b) => a.at.localeCompare(b.at));

    const rendezvous: Row = {
      id: 'rendezvous-6',
      at: RENDEZVOUS_DATE,
      ...split(RENDEZVOUS_DATE, 'Europe/Monaco'),
      spoken: boardDate(RENDEZVOUS_DATE, lang, 'Europe/Monaco'),
      title: t('homePage.agenda.rendezvousTitle', 'Monaco Smart & Sustainable Marina Rendezvous, 6th edition'),
      sub: [
        t('homePage.agenda.monaco', 'Monaco'),
        t('homePage.agenda.finished', 'Finished'),
        t('homePage.agenda.relive', 'See the programme'),
      ].join(' · '),
      href: RENDEZVOUS_2026_PATH,
    };

    return [...upcoming.slice(0, max), rendezvous].map(({ at: _at, ...row }) => row);
  }, [events, i18n.language, t, max]);

  return { entries, loading: events === null };
}
