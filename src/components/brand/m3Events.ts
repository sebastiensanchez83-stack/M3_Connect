import type { TFunction } from 'i18next';
import { WYS26_PATH, wys26Upcoming } from '@/components/events/WysInvitationCard';
import type { PontoonTagItem } from './PontoonTag';
import type { RouteStop } from './EventRoute';

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

/** Items for the hero's pontoon tag, in the order they should show. */
export function pontoonTagItems(t: TFunction, now = Date.now()): PontoonTagItem[] {
  const items: PontoonTagItem[] = [];
  if (wys26Upcoming(now)) {
    items.push({
      id: 'wys26',
      kicker: t('brand.events.wys.kicker', 'Dubai · 27 November 2026'),
      title: t('brand.events.wys.title', 'World Yachting Summit'),
      meta: t('brand.events.wys.meta', 'Conference and gala dinner, by invitation'),
      href: WYS26_PATH,
      cta: t('brand.events.wys.cta', 'Request an invitation'),
    });
  }
  items.push(
    {
      id: 'webinars',
      kicker: t('brand.events.webinars.kicker', 'Online'),
      title: t('brand.events.webinars.title', 'Webinars & replays'),
      meta: t('brand.events.webinars.meta', 'One-click registration once signed in'),
      href: WEBINARS_PATH,
      cta: t('brand.events.webinars.cta', 'See the webinars'),
    },
    {
      id: 'rendezvous',
      kicker: t('brand.events.rendezvous.kicker', 'Monaco · 7th edition in 2027'),
      title: t('brand.events.rendezvous.title', 'Monaco Smart & Sustainable Marina Rendezvous'),
      meta: t('brand.events.rendezvous.meta', '6th edition: more than 250 participants'),
      href: RENDEZVOUS_2026_PATH,
      cta: t('brand.events.rendezvous.cta', 'Relive the 6th edition'),
    },
  );
  return items;
}

/** Stops for the EventRoute section: Monaco → Dubai → online. */
export function eventRouteStops(t: TFunction): RouteStop[] {
  return [
    {
      id: 'monaco',
      place: t('brand.route.monaco', 'Monaco'),
      coords: '43°44′ N · 7°25′ E',
      kicker: t('brand.events.rendezvous.routeKicker', 'Monaco · 20–21 September 2026'),
      title: t('brand.events.rendezvous.title', 'Monaco Smart & Sustainable Marina Rendezvous'),
      lines: [
        t('brand.events.rendezvous.meta', '6th edition: more than 250 participants'),
        t('brand.events.rendezvous.next', '7th edition in 2027'),
      ],
      cta: { label: t('brand.events.rendezvous.cta', 'Relive the 6th edition'), href: RENDEZVOUS_2026_PATH },
    },
    {
      id: 'dubai',
      place: t('brand.route.dubai', 'Dubai'),
      coords: '25°16′ N · 55°18′ E',
      kicker: t('brand.events.wys.kicker', 'Dubai · 27 November 2026'),
      title: t('brand.events.wys.title', 'World Yachting Summit'),
      lines: [
        t('brand.events.wys.meta', 'Conference and gala dinner, by invitation'),
        t('brand.events.wys.body', 'Organised by M3 Monaco.'),
      ],
      cta: { label: t('brand.events.wys.cta', 'Request an invitation'), href: WYS26_PATH },
    },
    {
      id: 'online',
      place: t('brand.route.online', 'Online'),
      kicker: t('brand.events.webinars.kicker', 'Online'),
      title: t('brand.events.webinars.title', 'Webinars & replays'),
      lines: [
        t('brand.events.webinars.body', 'Live sessions with marina operators and service providers, and every replay afterwards.'),
        t('brand.events.webinars.meta', 'One-click registration once signed in'),
      ],
      cta: { label: t('brand.events.webinars.cta', 'See the webinars'), href: WEBINARS_PATH },
    },
  ];
}
