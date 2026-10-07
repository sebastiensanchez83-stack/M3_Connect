import type { TFunction } from 'i18next';
import { WYS26_PATH, wys26Upcoming } from '@/components/events/WysInvitationCard';
import { SITE_IMAGES } from '@/lib/siteMedia';
import type { EventCardItem } from './EventCard';

/**
 * The three M3 meeting points, presented together so the platform never reads
 * as the Rendezvous' own website: the Monaco Smart & Sustainable Marina
 * Rendezvous (official name first, then "the Rendezvous"), the World Yachting
 * Summit in Dubai (by invitation, /wys26) and the webinars and replays online.
 *
 * Only facts already published: 6th edition 20–21 Sept 2026 with more than 250
 * participants, 7th edition in 2027; WYS 27 Nov 2026, conference + gala dinner.
 * No patronage line until Victor has checked its wording.
 */

/** The 6th edition's event page (events.id, stable even if the title is edited). */
export const RENDEZVOUS_2026_PATH = '/events/f55f7b2f-96ac-4c5e-b620-358624e52240';
export const WEBINARS_PATH = '/events';

/**
 * Items for the hero's floating event card (EventCard), in the order they turn: the next
 * M3 event first (World Yachting Summit while it is upcoming), then the
 * webinars, then the Rendezvous. No event hides the others.
 * The WYS photo is provisional (the Rendezvous hall) until the Summit has its own.
 */
export function featuredEventItems(t: TFunction, now = Date.now()): EventCardItem[] {
  const items: EventCardItem[] = [];
  if (wys26Upcoming(now)) {
    items.push({
      id: 'wys26',
      kicker: t('brand.notch.wysKicker', 'Next event'),
      title: t('brand.events.wys.title', 'World Yachting Summit'),
      meta: t('brand.notch.wysMeta', 'Dubai · 27 Nov 2026 · By invitation'),
      href: WYS26_PATH,
      image: SITE_IMAGES.eventsHero,
      // Dubai is UTC+4: the countdown counts days in Dubai's calendar.
      startsOn: { date: '2026-11-27', timeZone: 'Asia/Dubai' },
    });
  }
  items.push(
    {
      id: 'webinars',
      kicker: t('brand.events.webinars.kicker', 'Online'),
      title: t('brand.notch.webinarsTitle', 'Webinars'),
      meta: t('brand.notch.webinarsMeta', 'One-click registration'),
      href: WEBINARS_PATH,
      image: SITE_IMAGES.resourcesHero,
    },
    {
      id: 'rendezvous',
      kicker: t('brand.notch.rendezvousKicker', 'Monaco · 6th edition'),
      title: t('brand.events.rendezvous.title', 'Monaco Smart & Sustainable Marina Rendezvous'),
      meta: t('brand.events.rendezvous.cta', 'Relive the 6th edition'),
      href: RENDEZVOUS_2026_PATH,
      image: SITE_IMAGES.partnersHero,
    },
  );
  return items;
}
