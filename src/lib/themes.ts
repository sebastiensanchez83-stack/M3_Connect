import { Anchor, Compass, Cpu, Leaf, LifeBuoy, Scale } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * The six themes the library and the directory are browsed by.
 *
 * The platform has 17 sectors. That is the right grain to *tag* a resource or a
 * company, and the wrong one to *browse* by: a list of 17 checkboxes asks the
 * visitor to know the taxonomy before they have seen anything. Themes group
 * the sectors into six doors, each with a picture; the sectors stay available
 * as fine filters once a theme is open.
 *
 * Agreed with Victor on 5 Oct 2026. The grouping lives here, keyed by sector
 * slug (stable, unlike labels), so changing it is a one-line edit — no
 * migration. A sector that is in no theme still shows up under "All".
 */

export type ThemeKey = 'infrastructure' | 'design' | 'digital' | 'energy' | 'operations' | 'business';

export interface Theme {
  key: ThemeKey;
  labelKey: string;
  fallback: string;
  descKey: string;
  descFallback: string;
  icon: LucideIcon;
  /** Sector slugs (sectors.slug) that belong to this theme. */
  sectors: string[];
  /**
   * The theme's photo, served from /public. Null until one has been chosen:
   * CoverImage then draws the theme's gradient with its icon, which is a
   * deliberate look, not a placeholder to hide.
   */
  image: string | null;
  /** Vertical position of the subject in `image`, 0 = top, 1 = bottom. */
  imageFocusY: number;
}

export const THEMES: Theme[] = [
  {
    key: 'infrastructure',
    labelKey: 'themes.infrastructure',
    fallback: 'Infrastructure & construction',
    descKey: 'themes.infrastructureDesc',
    descFallback: 'Dredging, pontoons, mooring and marina equipment',
    icon: Anchor,
    sectors: [
      'dredging-civil-engineering',
      'floating-structures-pontoons',
      'mooring-anchoring-systems',
      'marina-equipment-hardware',
    ],
    // A marina service pedestal — shore power and water at the berth (SM26).
    image: '/images/site/theme-infrastructure.jpg',
    imageFocusY: 0.85,
  },
  {
    key: 'design',
    labelKey: 'themes.design',
    fallback: 'Design & architecture',
    descKey: 'themes.designDesc',
    descFallback: 'Marina design and naval architecture',
    icon: Compass,
    sectors: ['marina-design-architecture', 'naval-architecture'],
    // An architectural scale model of a waterfront with a jetty (SM26). Not a real place.
    image: '/images/site/theme-design.jpg',
    imageFocusY: 0.45,
  },
  {
    key: 'digital',
    labelKey: 'themes.digital',
    fallback: 'Digital & smart marina',
    descKey: 'themes.digitalDesc',
    descFallback: 'Connected infrastructure, data and software',
    icon: Cpu,
    sectors: ['ict-smart-marina-solutions', 'marina-software-saas'],
    // A monitor streaming a live berth camera, demoed at a stand (SM26).
    image: '/images/site/theme-digital.jpg',
    imageFocusY: 0.4,
  },
  {
    key: 'energy',
    labelKey: 'themes.energy',
    fallback: 'Energy & environment',
    descKey: 'themes.energyDesc',
    descFallback: 'Electrification, sustainability, waste and water',
    icon: Leaf,
    sectors: [
      'electrical-energy-systems',
      'environmental-sustainability',
      'waste-management-water-treatment',
    ],
    // A solar "tree" with photovoltaic panels and planting (SM26).
    image: '/images/site/theme-energy.jpg',
    imageFocusY: 0.4,
  },
  {
    key: 'operations',
    labelKey: 'themes.operations',
    fallback: 'Operations & services',
    descKey: 'themes.operationsDesc',
    descFallback: 'Running the marina, yacht services and safety',
    icon: LifeBuoy,
    sectors: ['marina-management-operations', 'yacht-services-concierge', 'safety-security'],
    // Berth occupancy sensors (free / occupied) on a stand, a marina photo
    // behind them (SM26): knowing which berth is free is day-to-day marina
    // operations. It was a gradient until the design audit of 8 Oct 2026 (the
    // one tile without a photo). A better picture is still wanted: dock staff
    // berthing a yacht, a fuel or pump-out station in use, a harbour patrol boat.
    image: '/images/site/moment-sensors.jpg',
    imageFocusY: 0.6,
  },
  {
    key: 'business',
    labelKey: 'themes.business',
    fallback: 'Business & legal',
    descKey: 'themes.businessDesc',
    descFallback: 'Insurance, regulation and marketing',
    icon: Scale,
    sectors: ['insurance-risk-management', 'legal-regulatory', 'marketing-communication'],
    // A handshake across an exhibitor table (SM26). Kept at 660 px on purpose: a
    // visitor's badge is legible in the full-resolution file.
    image: '/images/site/theme-business.jpg',
    imageFocusY: 0.5,
  },
];

const THEME_BY_SECTOR = new Map<string, ThemeKey>(
  THEMES.flatMap((theme) => theme.sectors.map((slug) => [slug, theme.key] as const)),
);

export function getTheme(key: string | null | undefined): Theme | null {
  return THEMES.find((t) => t.key === key) ?? null;
}

export function themeForSector(slug: string | null | undefined): ThemeKey | null {
  return slug ? THEME_BY_SECTOR.get(slug) ?? null : null;
}

/** The themes a set of sector slugs touches, in THEMES order, without duplicates. */
export function themesForSectors(slugs: (string | null | undefined)[]): ThemeKey[] {
  const hit = new Set(slugs.map(themeForSector).filter((k): k is ThemeKey => k !== null));
  return THEMES.filter((t) => hit.has(t.key)).map((t) => t.key);
}
