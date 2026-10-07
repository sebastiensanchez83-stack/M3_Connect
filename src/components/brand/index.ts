/**
 * SMC brand kit (refonte, Oct 2026): the "v2" look. Dev showcase: /__brand (dev
 * server only).
 *
 *  1. Button variant="cta…"            rolling label + arrow disc, in src/components/ui/button.tsx
 *                                      (the only place a round arrow disc remains)
 *  2. CardShell / OrgCard              card lift 4 px, picture 1.05, gold title line + small arrow
 *  3. SplitHero + HeroIn               marine split hero: text left, rounded photo frame right
 *  4. EventCard                        the "next event" card floating over the frame's corner (M3 events turning every 6 s)
 *  5. NewsBand                         thin band of figures, events, new members and articles sliding sideways
 *  6. Carousel                         scroll-snap row of large cards: drag, buttons, dots, keyboard
 *  7. AccordionCards                   photo cards that open on hover or focus
 *  8. BgRevealPanel                    navy panel whose background scales in
 *  9. UnderlineLink                    gold line growing from the left + right arrow
 * 10. SearchField                      the search pill: gold compass, typed placeholder
 * 11. NewsletterField                  e-mail pill, unticked consent
 * Layout pieces (Navbar, Footer, PageHero) live in components/layout and components/ui.
 */
export { UnderlineLink, type UnderlineLinkProps } from './UnderlineLink';
export { SplitHero, HeroIn } from './SplitHero';
export { EventCard, daysUntilEvent, type EventCardItem } from './EventCard';
export { NewsBand, type NewsItem } from './NewsBand';
export { Carousel } from './Carousel';
export { AccordionCards, CaptionList, type AccordionItem } from './AccordionCards';
export { BgRevealPanel } from './BgRevealPanel';
export { SearchField } from './SearchField';
export { NewsletterField } from './NewsletterField';
export { CardShell, CardMedia, StretchedLink, type OrgTypeTone } from './CardShell';
export { OrgCard, LogoTile, VerifiedBadge, orgTypeTone, useOrgTypeLabel } from './OrgCard';
export { featuredEventItems, RENDEZVOUS_2026_PATH, WEBINARS_PATH } from './m3Events';
export { Eyebrow, SectionNo } from './Eyebrow';
export { ContactCard, M3_PUBLIC_EMAIL } from './ContactCard';
