/**
 * SMC brand devices (refonte, Oct 2026): our own harbour vocabulary, not the
 * Solar Impulse signatures. Dev showcase: /__brand (dev server only).
 *
 *  1. WaterlineHero + PontoonTag       hero "ligne d'eau" with the pontoon tag
 *  2. DepartureBoard + useDepartureRows split-flap departures board (real data)
 *  3. SearchField                      plain magnifier, typed placeholder
 *  4. HorizonEdge, HarbourCoordinates,
 *     NewsletterField                  the "horizon" footer pieces
 *  5. Button variant="tide…"           in src/components/ui/button.tsx
 *  6. CapArrow + CardShell / OrgCard   inline compass needle with a radar sweep, berth-card grammar
 *  7. BuoyTabs                         labels on a mooring line, a buoy under the active one, wave wipe
 *  8. EventRoute                       Monaco → Dubai → online scroll route
 */
export { WaterlineHero } from './WaterlineHero';
export { PontoonTag, type PontoonTagItem } from './PontoonTag';
export { DepartureBoard, fitBoardText, type BoardRow } from './DepartureBoard';
export { useDepartureRows } from './useDepartureRows';
export { SearchField } from './SearchField';
export { HorizonEdge, HarbourCoordinates, NewsletterField } from './Horizon';
export { CapArrow } from './CapArrow';
export { CardShell, CardMedia, StretchedLink, type OrgTypeTone } from './CardShell';
export { OrgCard, LogoTile, VerifiedBadge, orgTypeTone, useOrgTypeLabel } from './OrgCard';
export { BuoyTabs, BuoyTabsList, BuoyTabsTrigger, BuoyTabsContent } from './BuoyTabs';
export { EventRoute, type RouteStop } from './EventRoute';
export { pontoonTagItems, eventRouteStops, RENDEZVOUS_2026_PATH, WEBINARS_PATH } from './m3Events';
export { Eyebrow } from './Eyebrow';
export { ContactCard, M3_PUBLIC_EMAIL } from './ContactCard';
