/**
 * SMC brand kit (refonte, Oct 2026): the "v2" look, in the spirit of the Solar
 * Impulse Foundation site. Dev showcase: /__brand (dev server only).
 *
 *  1. Button variant="cta…"            rolling label + arrow disc, in src/components/ui/button.tsx
 *  2. ArrowDisc + CardShell / OrgCard  round arrow with a gold disc that grows, card lift 4 px, picture 1.05
 *  3. InsetHero + HeroIn               inset rounded hero: photo, veil, H1 lines, marquee, notch
 *  4. EventNotch / HeroNotch / NotchCard   the card cut into the hero's corner (M3 events turning every 6 s)
 *  5. GiantMarquee / GiantMarqueeBand  giant sliding text, nudged by the scroll speed
 *  6. AccordionCards                   photo cards that open on hover or focus
 *  7. StickyStack                      large photo cards piling up on scroll
 *  8. BgRevealPanel                    navy panel whose background scales in
 *  9. UnderlineLink                    gold line growing from the left + right arrow
 * 10. SearchField                      the search pill: gold compass, typed placeholder
 * 11. NewsletterField                  e-mail pill, unticked consent
 * Layout pieces (Navbar, Footer, PageHero) live in components/layout and components/ui.
 */
export { ArrowDisc } from './ArrowDisc';
export { UnderlineLink, type UnderlineLinkProps } from './UnderlineLink';
export { GiantMarquee, GiantMarqueeBand } from './GiantMarquee';
export { InsetHero, HeroIn } from './InsetHero';
export { EventNotch, HeroNotch, NotchCard, type NotchItem } from './EventNotch';
export { AccordionCards, CaptionList, type AccordionItem } from './AccordionCards';
export { StickyStack, StickyStackMedia, StickyStackBody } from './StickyStack';
export { BgRevealPanel } from './BgRevealPanel';
export { SearchField } from './SearchField';
export { NewsletterField } from './NewsletterField';
export { CardShell, CardMedia, StretchedLink, type OrgTypeTone } from './CardShell';
export { OrgCard, LogoTile, VerifiedBadge, orgTypeTone, useOrgTypeLabel } from './OrgCard';
export { notchEventItems, RENDEZVOUS_2026_PATH, WEBINARS_PATH } from './m3Events';
export { Eyebrow, SectionNo } from './Eyebrow';
export { ContactCard, M3_PUBLIC_EMAIL } from './ContactCard';
