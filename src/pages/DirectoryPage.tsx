import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle, Anchor, ArrowRight, Briefcase, Building2, Check, ChevronDown, ChevronLeft, ChevronRight,
  Compass, HardHat, MapPin, Newspaper, Search, SlidersHorizontal, TrendingUp, Users,
} from 'lucide-react';
import i18next from '@/i18n';
import { DIRECTORY_STRINGS } from '@/i18n/directory';
import { Seo } from '@/components/seo/Seo';
import { themedPath } from '@/lib/seoMeta';
import { Button, buttonVariants } from '@/components/ui/button';
import { PageHero } from '@/components/ui/PageHero';
import { AdBanner } from '@/components/ui/AdBanner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LoginForm } from '@/components/auth/LoginForm';
import { SignupForm } from '@/components/auth/SignupForm';
import { BookmarkButton } from '@/components/shortlist/BookmarkButton';
import { Reveal, RevealGroup } from '@/components/motion/Reveal';
import { LineReveal } from '@/components/motion/LineReveal';
import { WavePanel } from '@/components/motion/WavePanel';
import { BathyPattern } from '@/components/motion/BathyPattern';
import { Graticule } from '@/components/motion/Graticule';
import { useMotion } from '@/components/motion/MotionProvider';
import { SearchField } from '@/components/brand/SearchField';
import { CapArrow } from '@/components/brand/CapArrow';
import { CardShell, StretchedLink } from '@/components/brand/CardShell';
import { BerthBand, LogoTile, TypeFlagLabel, TypePennant, VerifiedMark, ViewProfileCue } from '@/components/brand/OrgCard';
import { FlapFigure } from '@/components/brand/FlapFigure';
import { ThemeFlag } from '@/components/brand/ThemeFlag';
import { BuoyTabs, BuoyTabsContent, BuoyTabsList, BuoyTabsTrigger } from '@/components/brand/BuoyTabs';
import { Eyebrow, WaveMark } from '@/components/brand/Eyebrow';
import { Drawer } from '@/components/brand/Drawer';
import { M3_PUBLIC_EMAIL } from '@/components/brand/ContactCard';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { THEMES, getTheme, themesForSectors, type Theme, type ThemeKey } from '@/lib/themes';
import { SITE_IMAGES } from '@/lib/siteMedia';
import { useNetworkFigures, formatFigure, countryKey, countryKeysOf, countryParts, rawCountryOf } from '@/lib/networkStats';
import { bestSpelling, countrySlug, localizedCountryName } from '@/lib/countryNames';
import { withSiteSuffix } from '@/lib/seoText';
import { SPONSOR_TIERS, TIER_LABELS, type OrgTier } from '@/types/database';
import { cn } from '@/lib/utils';
import '@/styles/directory.css';

// The directory's own strings travel with this lazy chunk, not with the entry
// bundle every route downloads (deep merge, no overwrite: pages.ts keys win).
for (const lng of ['en', 'fr'] as const) {
  i18next.addResourceBundle(lng, 'translation', DIRECTORY_STRINGS[lng], true, false);
}

/**
 * The directory: who is on Smart Marina Connect. Served at /directory.
 *
 * Refonte (Oct 2026), on the SMC devices (never the Solar Impulse ones):
 *   - a compact PageHero (waterline edge) with the live figures counting once;
 *   - a sticky toolbar that rises with the header when it tucks away: search
 *     (plain magnifier, typed example searches), the type as "bouées" buoy
 *     tabs with live counts, "Members only", the Filters drawer and the sort;
 *   - active filters as chips that scale in and out;
 *   - M3 selections: shareable filter URLs built from data that exists
 *     (newest members, marinas on the platform, the six themes), drawn as
 *     chart cartouches;
 *   - one "berth card" grammar (a band of sounding lines, the type flown as a
 *     burgee, logo beside the name, "Verified member" as words in the meta
 *     row only for organizations that have an owner, "View profile" and the
 *     cap needle), and a labelled shortlist button in the card's footer
 *     (members: BookmarkButton; visitors: a drawer explaining the shortlist
 *     with Sign in / Sign up);
 *   - a wide "Run a marina? Publish your need" panel, the SEO text with the six
 *     theme pages, and the "Is your marina listed? Claim it" card.
 *
 * Every filter lives in the URL (?q=&type=&theme=&sector=&country=&joined=1
 * &mine=1&sort=), and a param with nothing on screen to show it is ignored,
 * never applied invisibly. Only ?theme= changes the canonical URL (Seo, lot 0).
 *
 * What an organization's sectors mean depends on its side of the market: a
 * service provider's are the services it offers, a marina's (or investor's, or
 * developer's) are what it is looking for.
 *
 * There is deliberately no "Contact" button on the cards: members connect from
 * the organization's page ("Request to connect"), which writes the request the
 * right way round and checks for an existing one. Unclaimed organizations (no
 * owner) show nothing about connecting at all (Victor, 6 Oct 2026).
 */

/* ─── Model ──────────────────────────────────────────────────────── */

interface SectorRef {
  id: string;
  slug: string;
  label: string;
}

interface DirectoryOrg {
  id: string;
  slug: string;
  name: string;
  organization_type: string | null;
  tier: string;
  website: string | null;
  country: string | null;
  city: string | null;
  headquarters_country: string | null;
  description: string | null;
  audience_description: string | null;
  logo_url: string | null;
  /** banner_url, else the first gallery picture, else null (gradient). */
  cover_url: string | null;
  /** Service sectors for suppliers, interest sectors for marinas/investors/developers. */
  sectors: SectorRef[];
  member_count: number;
  /** Has an owner (claimed or created by a member). Lot 0: only these show "Verified member". */
  claimed: boolean;
  created_at: string | null;
  /** Folded country slugs ("spain", "france"), for the country filter. */
  countries: string[];
}

/** A card with its themes, place and search text resolved once, not on every render. */
interface Indexed extends DirectoryOrg {
  sectorSlugs: string[];
  themes: ThemeKey[];
  /** "Split, Croatia" in the page's language. */
  place: string;
  /** Lower-case, accent-free text the search runs on. */
  haystack: string;
}

type TypeKey = 'marina' | 'partner' | 'investor' | 'developer' | 'media_partner';
type SortKey = 'relevance' | 'az' | 'recent';
type TFn = ReturnType<typeof useTranslation>['t'];

interface TypeFacet {
  key: TypeKey;
  icon: LucideIcon;
  /** Plural, for the buoy tabs. */
  labelKey: string;
  fallback: string;
}

const TYPE_FACETS: TypeFacet[] = [
  { key: 'marina', icon: Anchor, labelKey: 'directory.types.marina', fallback: 'Marinas' },
  { key: 'partner', icon: Briefcase, labelKey: 'directory.types.partner', fallback: 'Service providers' },
  { key: 'investor', icon: TrendingUp, labelKey: 'directory.types.investor', fallback: 'Investors' },
  { key: 'developer', icon: HardHat, labelKey: 'directory.types.developer', fallback: 'Developers' },
  { key: 'media_partner', icon: Newspaper, labelKey: 'directory.types.media_partner', fallback: 'Media' },
];
const FACET_BY_KEY = new Map(TYPE_FACETS.map((f) => [f.key as string, f]));

const TYPE_ONE_FALLBACK: Record<string, string> = {
  marina: 'Marina',
  partner: 'Service provider',
  investor: 'Investor',
  developer: 'Developer',
  media_partner: 'Media',
  organization: 'Organization',
};
function typeOne(t: TFn, type: string | null): string {
  const key = type && type in TYPE_ONE_FALLBACK ? type : 'organization';
  return t(`directory.typeOne.${key}`, TYPE_ONE_FALLBACK[key]);
}

/** Types whose sectors are "what we are looking for" rather than "what we offer". */
const INTEREST_SIDE = new Set(['marina', 'developer', 'investor']);

/** Sponsorship order, as on the old Network screen. */
const TIER_ORDER: Record<string, number> = { main_sponsor: 0, premium_sponsor: 1, premium_partner: 1, associate_partner: 2, innovation_partner: 3, member: 4 };

const isPaying = (tier: string) => (SPONSOR_TIERS as string[]).includes(tier);

const PAGE_SIZE = 24;

/** The navbar's height while it shows (src/components/layout/Navbar.tsx). */
const HEADER_H = 64;

/** Search text: lower case, accents dropped, so "electricite" finds "Électricité". */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function countThemes(list: Indexed[]): Record<ThemeKey, number> {
  const counts = {} as Record<ThemeKey, number>;
  for (const th of THEMES) counts[th.key] = 0;
  for (const o of list) for (const k of o.themes) counts[k] += 1;
  return counts;
}

/** The filter params, in a fixed order: to tell whether a collection is the current view. */
const FILTER_PARAMS = ['type', 'theme', 'sector', 'country', 'joined', 'mine', 'q', 'sort'];
function filterSignature(search: URLSearchParams): string {
  return FILTER_PARAMS.map((k) => `${k}=${search.getAll(k).join(',')}`).join('&');
}

/** Small stable hash, for the cover's sounding-line drawing. */
function seedOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(h) % 97) + 1;
}

/* ─── Page ───────────────────────────────────────────────────────── */

export function DirectoryPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('fr') ? 'fr' : 'en';
  const { user, profile, organization, loading: authLoading } = useAuth();
  const { reduced } = useMotion();
  const [params, setParams] = useSearchParams();
  // The same live counts as the home page, for the hero and the meta description.
  const { figures, loading: figuresLoading } = useNetworkFigures();

  const [orgs, setOrgs] = useState<DirectoryOrg[]>([]);
  const [sectors, setSectors] = useState<SectorRef[]>([]);
  const [mySectorIds, setMySectorIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [limit, setLimit] = useState(PAGE_SIZE);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [shortlistFor, setShortlistFor] = useState<{ name: string } | null>(null);
  const [shortlistOpen, setShortlistOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);
  const [signupPersona, setSignupPersona] = useState<'marina' | undefined>(undefined);

  const toolbarRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const filtersButtonRef = useRef<HTMLButtonElement>(null);
  const pendingScroll = useRef(false);

  // Keyboard focus moving up must not land under the sticky toolbar: its height
  // feeds the page's scroll-padding (index.css) while the directory is mounted.
  useEffect(() => {
    const bar = toolbarRef.current;
    const root = document.documentElement;
    if (!bar) return;
    const set = () => root.style.setProperty('--sticky-offset', `${bar.offsetHeight}px`);
    set();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(set);
      ro.observe(bar);
    }
    return () => {
      ro?.disconnect();
      root.style.removeProperty('--sticky-offset');
    };
  }, []);

  // ---------------------------------------------------------------- URL state
  const typeParam = params.get('type');
  const themeParam = getTheme(params.get('theme'));
  const sectorParam = params.get('sector');
  const query = params.get('q') ?? '';
  const joinedOnly = params.get('joined') === '1';
  const mine = params.get('mine') === '1';
  // ?country=france&country=spain (a comma list is read too).
  const countryParamRaw = params.getAll('country').join(',');
  const sortParam = params.get('sort');
  const sort: SortKey = sortParam === 'az' || sortParam === 'recent' ? sortParam : 'relevance';

  /**
   * Change some filters, keep the rest. Search typing replaces history; clicks
   * push. A list (countries) becomes one repeated param per value.
   */
  const update = useCallback((changes: Record<string, string | string[] | null>, replace = false) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [key, value] of Object.entries(changes)) {
        next.delete(key);
        if (Array.isArray(value)) value.forEach((v) => next.append(key, v));
        else if (value !== null && value !== '') next.set(key, value);
      }
      return next;
    }, { replace });
  }, [setParams]);

  /** Every filter off; the chosen order stays. */
  const clearAll = useCallback(() => {
    setParams((prev) => {
      const next = new URLSearchParams();
      const keepSort = prev.get('sort');
      if (keepSort) next.set('sort', keepSort);
      return next;
    });
  }, [setParams]);

  // ---------------------------------------------------------------- data
  // Only verified organizations are listed. Runs once (and again on "Try again").
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadFailed(false);
    (async () => {
      try {
        const [orgRes, secRes] = await Promise.all([
          supabase
            .from('organizations')
            .select('id, slug, name, organization_type, tier, website, country, city, headquarters_country, description, audience_description, logo_url, banner_url, gallery, access_status, owner_user_id, created_at')
            .eq('access_status', 'verified'),
          supabase.from('sectors').select('id, slug, label').eq('is_active', true).order('label'),
        ]);
        if (orgRes.error) throw orgRes.error;
        if (!alive) return;
        setSectors((secRes.data ?? []) as SectorRef[]);

        type OrgRow = {
          id: string; slug: string; name: string; organization_type: string | null; tier: string | null;
          website: string | null; country: string | null; city: string | null; headquarters_country: string | null;
          description: string | null; audience_description: string | null; logo_url: string | null;
          banner_url: string | null; gallery: unknown; owner_user_id: string | null; created_at: string | null;
        };
        const orgRows = (orgRes.data ?? []) as OrgRow[];
        if (orgRows.length === 0) { setOrgs([]); return; }
        const orgIds = orgRows.map((o) => o.id);

        // Member counts, then service sectors (suppliers) and interest sectors (marinas).
        type LinkRow = { organization_id: string; sector_id: string; sectors: SectorRef | null };
        const [{ data: memberRows }, { data: serviceRows }, { data: interestRows }] = await Promise.all([
          supabase.from('organization_members').select('organization_id').in('organization_id', orgIds),
          supabase.from('organization_service_sectors').select('organization_id, sector_id, sectors(id, slug, label)').in('organization_id', orgIds),
          supabase.from('organization_interest_sectors').select('organization_id, sector_id, sectors(id, slug, label)').in('organization_id', orgIds),
        ]);
        if (!alive) return;

        const memberCount: Record<string, number> = {};
        for (const row of (memberRows ?? []) as { organization_id: string }[]) {
          memberCount[row.organization_id] = (memberCount[row.organization_id] || 0) + 1;
        }

        const toMap = (rows: unknown) => {
          const map: Record<string, SectorRef[]> = {};
          for (const link of (rows ?? []) as LinkRow[]) {
            if (!link.sectors) continue;
            const list = (map[link.organization_id] ??= []);
            if (!list.some((s) => s.id === link.sectors!.id)) {
              list.push({ id: link.sectors.id, slug: link.sectors.slug, label: link.sectors.label });
            }
          }
          return map;
        };
        const serviceMap = toMap(serviceRows);
        const interestMap = toMap(interestRows);

        const cards: DirectoryOrg[] = orgRows.map((o) => {
          const interestSide = INTEREST_SIDE.has(o.organization_type ?? '');
          const primary = (interestSide ? interestMap[o.id] : serviceMap[o.id]) ?? [];
          const other = (interestSide ? serviceMap[o.id] : interestMap[o.id]) ?? [];
          const gallery = Array.isArray(o.gallery) ? (o.gallery as unknown[]).filter((u): u is string => typeof u === 'string' && u.length > 0) : [];
          return {
            id: o.id,
            slug: o.slug,
            name: o.name,
            organization_type: o.organization_type,
            tier: o.tier || 'member',
            website: o.website,
            country: o.country,
            city: o.city,
            headquarters_country: o.headquarters_country,
            description: o.description,
            audience_description: o.audience_description,
            logo_url: o.logo_url || null,
            cover_url: o.banner_url || gallery[0] || null,
            sectors: primary.length > 0 ? primary : other,
            member_count: memberCount[o.id] || 0,
            claimed: !!o.owner_user_id,
            created_at: o.created_at,
            countries: countryKeysOf(o).map(countrySlug),
          };
        });

        // Organisations whose team has actually joined come FIRST. Most of the
        // marina directory is pre-created records that were never claimed, and
        // they'd otherwise bury the real accounts. Then sponsorship tier, then
        // alphabetically.
        cards.sort((a, b) => {
          const aJoined = a.member_count > 0 ? 0 : 1;
          const bJoined = b.member_count > 0 ? 0 : 1;
          if (aJoined !== bJoined) return aJoined - bJoined;
          const aOrder = TIER_ORDER[a.tier] ?? 5;
          const bOrder = TIER_ORDER[b.tier] ?? 5;
          if (aOrder !== bOrder) return aOrder - bOrder;
          return a.name.localeCompare(b.name);
        });

        setOrgs(cards);
      } catch (err) {
        if (import.meta.env.DEV) console.error('Error fetching organizations:', err);
        if (alive) setLoadFailed(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [reloadKey]);

  // The member's own sectors, for the "For your sectors" filter. Keyed on the
  // organization's id and type — never on the user object, which auth-js
  // replaces on every tab refocus.
  const orgId = organization?.id;
  const orgType = organization?.organization_type;
  const signedIn = !!user;
  useEffect(() => {
    if (!signedIn || !orgId) { setMySectorIds([]); return; }
    const table = (orgType === 'marina' || orgType === 'developer' || orgType === 'investor')
      ? 'organization_interest_sectors'
      : 'organization_service_sectors';
    let alive = true;
    supabase.from(table).select('sector_id').eq('organization_id', orgId).then(({ data }) => {
      if (alive) setMySectorIds(((data ?? []) as { sector_id: string }[]).map((d) => d.sector_id));
    });
    return () => { alive = false; };
  }, [orgId, orgType, signedIn]);

  // ---------------------------------------------------------------- derived
  const labelBySlug = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sectors) map.set(s.slug, s.label);
    for (const o of orgs) for (const s of o.sectors) if (!map.has(s.slug)) map.set(s.slug, s.label);
    return map;
  }, [sectors, orgs]);

  const sectorLabel = useCallback((slug: string) => t(`sectorNames.${slug}`, labelBySlug.get(slug) ?? slug), [t, labelBySlug]);
  const themeLabel = useCallback((th: Theme) => t(th.labelKey, th.fallback), [t]);

  // Countries: the free-text field folded to one key per country, named in the
  // page's language when the browser knows it ("Croatia" → "Croatie").
  const countryInfo = useMemo(() => {
    const spellings = new Map<string, Map<string, number>>();
    for (const o of orgs) {
      for (const part of countryParts(rawCountryOf(o))) {
        const key = countryKey(part);
        const bucket = spellings.get(key) ?? new Map<string, number>();
        bucket.set(part, (bucket.get(part) ?? 0) + 1);
        spellings.set(key, bucket);
      }
    }
    const map = new Map<string, { slug: string; label: string; en: string }>();
    for (const [key, bucket] of spellings) {
      const fallback = bestSpelling(key, bucket);
      const slug = countrySlug(key);
      if (!slug) continue;
      map.set(slug, { slug, label: localizedCountryName(key, fallback, lang), en: localizedCountryName(key, fallback, 'en') });
    }
    return map;
  }, [orgs, lang]);

  const indexed: Indexed[] = useMemo(() => orgs.map((o) => {
    const sectorSlugs = [...new Set(o.sectors.map((s) => s.slug))];
    const themes = themesForSectors(sectorSlugs);
    const named = o.countries.map((c) => countryInfo.get(c)).filter((c): c is { slug: string; label: string; en: string } => !!c);
    const countryText = named.length > 0 ? named.map((c) => c.label).join(' / ') : rawCountryOf(o);
    const place = [o.city?.trim(), countryText].filter(Boolean).join(', ');
    const haystack = fold([
      o.name, o.city ?? '', o.country ?? '', o.headquarters_country ?? '',
      o.description ?? '', o.audience_description ?? '',
      typeOne(t, o.organization_type),
      // The database label (English) and the displayed one (French when switched).
      ...o.sectors.map((s) => s.label),
      ...o.sectors.map((s) => t(`sectorNames.${s.slug}`, s.label)),
      ...themes.map((k) => { const th = getTheme(k)!; return t(th.labelKey, th.fallback); }),
      ...named.flatMap((c) => [c.label, c.en]),
    ].join(' '));
    return { ...o, sectorSlugs, themes, place, haystack };
    // `t` changes identity when the language switches, so French names become
    // searchable without a reload.
  }), [orgs, t, countryInfo]);

  // Types that actually have organizations. Untyped ones live under "All" only.
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const o of indexed) if (o.organization_type) counts[o.organization_type] = (counts[o.organization_type] || 0) + 1;
    return counts;
  }, [indexed]);
  const facets = TYPE_FACETS.filter((f) => (typeCounts[f.key] ?? 0) > 0);
  const activeType: TypeKey | null = facets.some((f) => f.key === typeParam) ? (typeParam as TypeKey) : null;

  const typed = useMemo(
    () => (activeType ? indexed.filter((o) => o.organization_type === activeType) : indexed),
    [indexed, activeType],
  );

  // Every filter that narrows the list must show as a chip, a tab or a switch
  // that can undo it. A URL value with nothing on screen to show it — a theme
  // with no organization of this type, a sector outside the open theme, a
  // country nobody here is in, "mine" for someone without sectors — is ignored.
  const typedThemeCounts = useMemo(() => countThemes(typed), [typed]);
  const activeTheme = themeParam && typedThemeCounts[themeParam.key] > 0 ? themeParam : null;

  const themeSectors = useMemo(() => {
    if (!activeTheme) return [];
    return activeTheme.sectors.filter((slug) => typed.some((o) => o.sectorSlugs.includes(slug)));
  }, [activeTheme, typed]);

  const activeSector = activeTheme && sectorParam && themeSectors.length > 1 && themeSectors.includes(sectorParam)
    ? sectorParam
    : null;

  const typedCountries = useMemo(() => new Set(typed.flatMap((o) => o.countries)), [typed]);
  const activeCountries = useMemo(
    () => [...new Set(countryParamRaw.split(',').map((s) => s.trim()).filter((s) => typedCountries.has(s)))],
    [countryParamRaw, typedCountries],
  );
  const activeCountriesKey = activeCountries.join(',');

  const mySectorSlugs = useMemo(() => {
    const bySlugId = new Map<string, string>();
    for (const s of sectors) bySlugId.set(s.id, s.slug);
    for (const o of orgs) for (const s of o.sectors) bySlugId.set(s.id, s.slug);
    return new Set(mySectorIds.map((id) => bySlugId.get(id)).filter((s): s is string => !!s));
  }, [mySectorIds, sectors, orgs]);
  const activeMine = mine && mySectorSlugs.size > 0;

  const tokens = useMemo(() => fold(query).split(/\s+/).filter(Boolean), [query]);
  const tokensKey = tokens.join(' ');

  // The list, and for each filter the count it would give with the others on.
  const derived = useMemo(() => {
    const countrySet = new Set(activeCountries);
    const preds = {
      theme: (o: Indexed) => !activeTheme || o.themes.includes(activeTheme.key),
      sector: (o: Indexed) => !activeSector || o.sectorSlugs.includes(activeSector),
      mine: (o: Indexed) => !activeMine || o.sectorSlugs.some((s) => mySectorSlugs.has(s)),
      country: (o: Indexed) => countrySet.size === 0 || o.countries.some((c) => countrySet.has(c)),
      joined: (o: Indexed) => !joinedOnly || o.member_count > 0,
      q: (o: Indexed) => tokens.every((tk) => o.haystack.includes(tk)),
    };
    type Name = keyof typeof preds;
    const names = Object.keys(preds) as Name[];
    const pass = (o: Indexed, ...except: Name[]) => names.every((n) => except.includes(n) || preds[n](o));

    const filtered = typed.filter((o) => pass(o));

    const themeCounts = countThemes(typed.filter((o) => pass(o, 'theme', 'sector')));
    const sectorBase = typed.filter((o) => pass(o, 'sector'));
    const sectorCounts: Record<string, number> = {};
    for (const slug of themeSectors) sectorCounts[slug] = sectorBase.filter((o) => o.sectorSlugs.includes(slug)).length;

    const countryCounts = new Map<string, number>();
    for (const o of typed) {
      if (!pass(o, 'country')) continue;
      for (const c of o.countries) countryCounts.set(c, (countryCounts.get(c) ?? 0) + 1);
    }

    const joinedAvailable = typed.filter((o) => pass(o, 'joined') && o.member_count > 0).length;
    const mineAvailable = mySectorSlugs.size > 0
      ? typed.filter((o) => pass(o, 'mine') && o.sectorSlugs.some((s) => mySectorSlugs.has(s))).length
      : 0;

    return { filtered, themeCounts, sectorCounts, countryCounts, joinedAvailable, mineAvailable };
    // activeCountriesKey and tokensKey stand for the arrays they come from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed, activeTheme, activeSector, activeMine, mySectorSlugs, activeCountriesKey, joinedOnly, tokensKey, themeSectors]);
  const { filtered } = derived;

  /** Filters other than the search box. */
  const narrowed = !!(activeType || activeTheme || activeSector || activeMine || joinedOnly || activeCountries.length > 0);
  const anyFilter = narrowed || tokens.length > 0;
  /** What the Filters button counts: the drawer's own filters. */
  const drawerFilterCount = (activeTheme ? 1 : 0) + (activeSector ? 1 : 0) + activeCountries.length + (joinedOnly ? 1 : 0) + (activeMine ? 1 : 0);

  const sorted = useMemo(() => {
    if (sort === 'relevance') return filtered; // members first, tier, A–Z: the load order
    const copy = [...filtered];
    if (sort === 'az') copy.sort((a, b) => a.name.localeCompare(b.name, lang, { sensitivity: 'base' }));
    else copy.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '') || a.name.localeCompare(b.name, lang));
    return copy;
  }, [filtered, sort, lang]);

  // Paying-tier organizations open the untouched list in their own strip.
  const featured = useMemo(() => (anyFilter ? [] : filtered
    .filter((o) => isPaying(o.tier))
    .sort((a, b) => (TIER_ORDER[a.tier] ?? 5) - (TIER_ORDER[b.tier] ?? 5) || a.name.localeCompare(b.name))),
  [anyFilter, filtered]);
  const rest = useMemo(
    () => (featured.length > 0 ? sorted.filter((o) => !isPaying(o.tier)) : sorted),
    [featured, sorted],
  );
  const visible = rest.slice(0, limit);
  const shownCount = featured.length + visible.length;

  // A new filter starts from the first batch again.
  const replayKey = `${activeTheme?.key ?? ''}|${activeSector ?? ''}|${activeMine}|${joinedOnly}|${activeCountriesKey}|${sort}`;
  const filterKey = `${activeType ?? ''}|${replayKey}`;
  useEffect(() => { setLimit(PAGE_SIZE); }, [filterKey, query]);

  /**
   * Bring the top of the results under the sticky toolbar. The header comes
   * back when the page scrolls up, and tucks away when it scrolls down.
   */
  const scrollToResults = useCallback((onlyIfBelow = false) => {
    const el = resultsRef.current;
    if (!el) return;
    const bar = toolbarRef.current?.offsetHeight ?? 0;
    const base = el.getBoundingClientRect().top + window.scrollY - bar - 12;
    const goingUp = base < window.scrollY;
    const top = Math.max(0, goingUp ? base - HEADER_H : base);
    if (onlyIfBelow && window.scrollY <= top) return;
    window.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' });
  }, [reduced]);

  // Changing a filter from the sticky toolbar deep in the list would leave the
  // reader looking at the middle of the new results: bring the list back under
  // the toolbar — only when they are below it, never on load. A collection
  // picked above the list scrolls down to it.
  const lastFilterKey = useRef(filterKey);
  useEffect(() => {
    if (filterKey === lastFilterKey.current) return;
    lastFilterKey.current = filterKey;
    if (pendingScroll.current) {
      pendingScroll.current = false;
      window.setTimeout(() => scrollToResults(), 30);
    } else {
      scrollToResults(true);
    }
  }, [filterKey, scrollToResults]);

  // The cards already on screen play their entrance again when the filter
  // changes (not while typing): the new list visibly arrives.
  const lastReplay = useRef(replayKey);
  useEffect(() => {
    if (replayKey === lastReplay.current) return;
    lastReplay.current = replayKey;
    const list = listRef.current;
    if (reduced || !list || typeof list.animate !== 'function') return;
    let n = 0;
    list.querySelectorAll<HTMLElement>(':scope > li.is-done').forEach((li) => {
      const r = li.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) return;
      li.animate(
        [{ opacity: 0, transform: 'translate3d(0, 16px, 0)' }, { opacity: 1, transform: 'none' }],
        { duration: 520, delay: Math.min(n, 8) * 60, easing: 'cubic-bezier(.215,.61,.355,1)', fill: 'backwards' },
      );
      n += 1;
    });
  }, [replayKey, reduced]);

  /** Switch type, keeping the open theme, sector and countries only where they still mean something. */
  const selectType = (key: TypeKey | null) => {
    if (key === activeType) return;
    const nextList = key ? indexed.filter((o) => o.organization_type === key) : indexed;
    const counts = countThemes(nextList);
    const keepTheme = !!activeTheme && counts[activeTheme.key] > 0;
    const nextSectors = keepTheme
      ? activeTheme!.sectors.filter((slug) => nextList.some((o) => o.sectorSlugs.includes(slug)))
      : [];
    const keepSector = keepTheme && !!activeSector && nextSectors.length > 1 && nextSectors.includes(activeSector);
    const keptCountries = activeCountries.filter((c) => nextList.some((o) => o.countries.includes(c)));
    update({
      type: key,
      theme: keepTheme ? activeTheme!.key : null,
      sector: keepSector ? activeSector : null,
      country: keptCountries,
    });
  };

  const toggleCountry = useCallback((slug: string) => {
    const next = activeCountries.includes(slug) ? activeCountries.filter((c) => c !== slug) : [...activeCountries, slug];
    update({ country: next });
  }, [activeCountries, update]);

  // ---------------------------------------------------------------- chips
  const chips = useMemo<ChipItem[]>(() => {
    const list: ChipItem[] = [];
    // The type is a filter too: it gets its chip, so "Clear filters" never stands alone.
    if (activeType) {
      const facet = FACET_BY_KEY.get(activeType);
      list.push({ id: `type:${activeType}`, label: facet ? t(facet.labelKey, facet.fallback) : activeType, onRemove: () => selectType(null) });
    }
    if (activeTheme) list.push({ id: `theme:${activeTheme.key}`, label: themeLabel(activeTheme), onRemove: () => update({ theme: null, sector: null }) });
    if (activeSector) list.push({ id: `sector:${activeSector}`, label: sectorLabel(activeSector), onRemove: () => update({ sector: null }) });
    for (const c of activeCountries) {
      list.push({ id: `country:${c}`, label: countryInfo.get(c)?.label ?? c, onRemove: () => toggleCountry(c) });
    }
    if (activeMine) list.push({ id: 'mine', label: t('directory.forYourSectors', 'For your sectors'), onRemove: () => update({ mine: null }) });
    return list;
    // selectType reads the current filters; it changes with them (activeType, activeTheme…).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeType, activeTheme, activeSector, activeCountries, activeMine, countryInfo, themeLabel, sectorLabel, toggleCountry, update, t]);

  // ---------------------------------------------------------------- collections
  const collections = useMemo<Collection[]>(() => {
    const list: Collection[] = [];
    const joined = indexed.filter((o) => o.member_count > 0);
    if (joined.length > 0) {
      list.push({
        key: 'new-members',
        kicker: t('directory.collections.newMembersKicker', 'Network'),
        title: t('directory.collections.newMembers', 'Newest members'),
        search: '?joined=1&sort=recent',
        icon: Users,
        count: joined.length,
      });
    }
    const marinas = joined.filter((o) => o.organization_type === 'marina').length;
    if (marinas > 0) {
      list.push({
        key: 'marinas-members',
        kicker: t('directory.collections.marinasKicker', 'Marinas'),
        title: t('directory.collections.marinas', 'Marinas on the platform'),
        search: '?type=marina&joined=1',
        icon: Anchor,
        orgType: 'marina',
        count: marinas,
      });
    }
    const counts = countThemes(indexed);
    for (const th of THEMES) {
      if (counts[th.key] === 0) continue;
      list.push({
        key: `theme-${th.key}`,
        kicker: t('directory.collections.themeKicker', 'Theme'),
        title: themeLabel(th),
        search: `?theme=${th.key}`,
        icon: th.icon,
        theme: th.key,
        count: counts[th.key],
      });
    }
    return list;
  }, [indexed, t, themeLabel]);

  const currentSignature = filterSignature(params);
  const currentCollection = collections.find((c) => filterSignature(new URLSearchParams(c.search)) === currentSignature)?.key ?? null;

  const pickCollection = (key: string) => {
    if (key === currentCollection) {
      scrollToResults();
      return;
    }
    // The filter effect scrolls once the new list is in; if the collection
    // happens to give the same filters (only the search differs), do it here.
    pendingScroll.current = true;
    window.setTimeout(() => {
      if (!pendingScroll.current) return;
      pendingScroll.current = false;
      scrollToResults();
    }, 150);
  };

  // ---------------------------------------------------------------- visitors
  const visitor = !authLoading && !user;
  const marinaLike = profile?.persona === 'marina' || profile?.persona === 'developer';
  const showNeed = !authLoading && (!user || marinaLike);

  const openShortlist = useCallback((name: string) => {
    setShortlistFor({ name });
    setShortlistOpen(true);
  }, []);
  const openLogin = () => { setShortlistOpen(false); setLoginOpen(true); };
  const openSignup = (persona?: 'marina') => { setShortlistOpen(false); setSignupPersona(persona); setSignupOpen(true); };

  // ---------------------------------------------------------------- copy
  const searchExamples = useMemo(() => [
    t('directory.searchExamples.ex1', 'Floating pontoons'),
    t('directory.searchExamples.ex2', 'Marina software'),
    t('directory.searchExamples.ex3', 'Dredging'),
    t('directory.searchExamples.ex4', 'Croatia'),
    t('directory.searchExamples.ex5', 'Mooring'),
  ], [t]);

  const sortOptions: { value: SortKey; label: string; long: string }[] = [
    { value: 'relevance', label: t('directory.sort.relevance', 'Relevance'), long: t('directory.sort.relevanceLong', 'Relevance (members first)') },
    { value: 'az', label: t('directory.sort.az', 'Name A–Z'), long: t('directory.sort.az', 'Name A–Z') },
    { value: 'recent', label: t('directory.sort.recent', 'Newest first'), long: t('directory.sort.recent', 'Newest first') },
  ];
  const setSort = (value: SortKey) => update({ sort: value === 'relevance' ? null : value });

  const claimHref = `mailto:${M3_PUBLIC_EMAIL}?subject=${encodeURIComponent(t('directory.claim.mailSubject', 'Claim a marina page on Smart Marina Connect'))}&body=${encodeURIComponent(t('directory.claim.mailBody', 'Marina:\nCountry:\nMy name and role:\nPhone:\n'))}`;

  // The head follows the theme in the URL until the organizations are in (or
  // if they never arrive): the edge function and the sitemap use the URL's
  // theme too, and a canonical pointing at /directory meanwhile would undo them.
  const seoTheme = loading || loadFailed ? themeParam : activeTheme;
  const liveFigures = !figuresLoading && figures.marinas !== null && figures.partners !== null && figures.countries !== null
    ? {
        marinas: formatFigure(figures.marinas, figures.manual, lang),
        suppliers: formatFigure(figures.partners, figures.manual, lang),
        countries: formatFigure(figures.countries, figures.manual, lang),
      }
    : null;
  const seoTitle = seoTheme
    ? withSiteSuffix(t('seo.directory.themeTitle', { theme: themeLabel(seoTheme), defaultValue: '{{theme}} — marina service providers' }))
    : withSiteSuffix(t('seo.directory.title', 'Marina & service provider directory'));
  const seoDescription = seoTheme
    ? t('seo.directory.themeDescription', { theme: themeLabel(seoTheme), defaultValue: '{{theme}}: the marinas and service providers working in this field, in the Smart Marina Connect directory.' })
    : liveFigures
      ? t('seo.directory.descriptionLive', { ...liveFigures, defaultValue: 'Marina suppliers directory: {{marinas}} marinas listed and {{suppliers}} service providers in {{countries}} countries. Filter by theme or country.' })
      : t('seo.directory.description', 'Directory of marinas and marina service providers. Filter by theme or country, shortlist companies and request an introduction from their page.');

  const tabValue = activeType ?? 'all';
  /** Counts show only once the list is really in (never "0" after a failed load). */
  const dataReady = !loading && !loadFailed;
  const cardProps = { openTheme: activeTheme, activeSector, sectorLabel, themeLabel, visitor, onVisitorStar: openShortlist };

  // ---------------------------------------------------------------- render
  return (
    <div className="min-h-screen bg-page">
      <Seo title={seoTitle} description={seoDescription} path={themedPath('/directory', seoTheme?.key)} />

      <PageHero
        image={SITE_IMAGES.directoryHero}
        seed="directory-hero"
        icon={Compass}
        eyebrow={t('directory.eyebrow', "Who's who")}
        title={t('directory.title', 'Marina & service provider directory')}
        subtitle={t('directory.subtitle', 'Marinas, service providers, investors and media. Filter by theme or country, shortlist the companies you need and request an introduction from their page.')}
        belowColor="rgb(246, 247, 249)"
      >
        <HeroFigures marinas={figures.marinas} providers={figures.partners} countries={figures.countries} manual={figures.manual} />
      </PageHero>

      <BuoyTabs
        value={tabValue}
        onValueChange={(v) => selectType(v === 'all' ? null : (v as TypeKey))}
        activationMode="manual"
      >
        {/* ── Toolbar: sticks under the header and rises with it when it tucks away ── */}
        <div
          ref={toolbarRef}
          role="region"
          aria-label={t('directory.toolbarLabel', 'Search and filter the directory')}
          className="sticky top-16 z-30 border-b border-rule bg-page/95 backdrop-blur-md"
        >
          {/* Always mounted (the results panel remounts per type): a screen
              reader hears the new count after each filter or search. */}
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {dataReady ? t('directory.results', { count: filtered.length, defaultValue: '{{count}} organizations' }) : ''}
          </p>
          <div className="container mx-auto px-4 pt-3">
            <div className="flex items-center gap-2 sm:gap-3">
              <SearchField
                className="min-w-0 flex-1 lg:max-w-[560px]"
                tone="light"
                size="md"
                inputId="directory-search"
                value={query}
                onValueChange={(v) => update({ q: v }, true)}
                onSearch={() => {
                  (document.activeElement as HTMLElement | null)?.blur();
                  scrollToResults();
                }}
                examples={searchExamples}
                placeholder={t('directory.searchPlaceholder', 'Name, service, country…')}
                label={t('directory.searchLabel', 'Search the directory')}
              />
              <Button
                ref={filtersButtonRef}
                type="button"
                variant="tideOutline"
                onClick={() => setFiltersOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={filtersOpen}
                aria-label={drawerFilterCount > 0
                  ? t('directory.filters.openCount', { count: drawerFilterCount, defaultValue: 'Filters, {{count}} active' })
                  : t('directory.filters.open', 'Filters')}
                // Labelled on every screen. The tide button clips its overflow (the water), so the count sits inside it.
                className="shrink-0 px-3.5 sm:px-5"
              >
                <SlidersHorizontal className="h-[18px] w-[18px]" aria-hidden="true" />
                <span>{t('directory.filters.open', 'Filters')}</span>
                {drawerFilterCount > 0 && (
                  <span
                    aria-hidden="true"
                    className="tabular grid h-5 min-w-5 place-items-center rounded-pill bg-gold px-1.5 text-[12px] font-semibold leading-none text-navy"
                  >
                    {drawerFilterCount}
                  </span>
                )}
              </Button>
              <SortSelect className="ml-auto hidden lg:inline-flex" value={sort} options={sortOptions} onChange={setSort} />
            </div>

            <div className="mt-2 flex items-start gap-4">
              <BuoyTabsList
                aria-label={t('directory.typeGroup', 'Type of organization')}
                // Edge to edge on phones (the row scrolls sideways), so max-w-none.
                wrapperClassName="-mx-4 min-w-0 max-w-none flex-1 px-4 pb-6 lg:mx-0 lg:max-w-full lg:flex-none lg:px-0"
              >
                <BuoyTabsTrigger value="all">
                  {t('directory.types.all', 'All')}
                  <TabCount value={dataReady ? indexed.length : null} />
                </BuoyTabsTrigger>
                {facets.map((f) => (
                  <BuoyTabsTrigger key={f.key} value={f.key}>
                    {t(f.labelKey, f.fallback)}
                    <TabCount value={typeCounts[f.key] ?? 0} />
                  </BuoyTabsTrigger>
                ))}
                {loading && [0, 1, 2].map((i) => (
                  <span key={i} aria-hidden="true" className="mx-1 h-6 w-24 animate-pulse rounded-pill bg-white/70 motion-reduce:animate-none" />
                ))}
              </BuoyTabsList>
              <MembersSwitch
                className="ml-auto mt-0.5 hidden lg:inline-flex"
                checked={joinedOnly}
                count={dataReady ? derived.joinedAvailable : undefined}
                onToggle={() => update({ joined: joinedOnly ? null : '1' })}
              />
            </div>
          </div>
        </div>

        <div className="container mx-auto px-4">
          {/* ── Active filters: chips that scale in and out ── */}
          <div className="flex flex-wrap items-center gap-2 pt-4">
            <MembersSwitch
              className="-ml-1.5 lg:hidden"
              checked={joinedOnly}
              count={dataReady ? derived.joinedAvailable : undefined}
              onToggle={() => update({ joined: joinedOnly ? null : '1' })}
            />
            <AnimatedChips
              items={chips}
              label={t('directory.filters.active', 'Active filters:')}
              removeLabel={(label) => t('directory.filters.remove', { label, defaultValue: 'Remove the filter: {{label}}' })}
              fallbackFocus={filtersButtonRef}
            />
            {anyFilter && (
              <button
                type="button"
                onClick={clearAll}
                className="focus-ring inline-flex min-h-10 items-center rounded-badge px-1.5 text-sm font-semibold text-gold-text underline underline-offset-[3px] transition-colors hover:text-navy"
              >
                {t('directory.clearFilters', 'Clear filters')}
              </button>
            )}
          </div>

          {/* ── Collections: M3 selections, as shareable filter URLs ── */}
          {!loading && !loadFailed && collections.length > 0 && (
            <CollectionsRow items={collections} currentKey={currentCollection} onPick={pickCollection} />
          )}

          <div className="pt-8">
            <AdBanner placement="marketplace" className="mb-2" />
          </div>
        </div>

        {/* ── Results: the type panel arrives with a wave wipe ── */}
        <BuoyTabsContent key={tabValue} value={tabValue} className="dir-panel mt-0 rounded-none">
          <div ref={resultsRef} id="directory-results" className="container mx-auto px-4 pb-6 pt-6">
            <h2 className="sr-only">{t('directory.resultsHeading', 'Organizations')}</h2>
            {loading ? (
              <>
                <p role="status" className="sr-only">{t('directory.states.loading', 'Loading the directory…')}</p>
                <ul aria-hidden="true" className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 6 }, (_, i) => <CardSkeleton key={i} />)}
                </ul>
              </>
            ) : loadFailed ? (
              <div role="alert" className="mx-auto max-w-xl rounded-card border border-rule bg-white px-6 py-12 text-center">
                <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-pill bg-chip text-navy">
                  <AlertTriangle className="h-6 w-6" aria-hidden="true" />
                </span>
                <p className="text-h3 text-navy">{t('directory.states.errorTitle', 'The directory could not be loaded.')}</p>
                <p className="mt-2 text-body text-meta">{t('directory.states.errorBody', 'Check your connection, then try again.')}</p>
                <Button variant="tideNavy" className="mt-6" onClick={() => setReloadKey((k) => k + 1)}>
                  {t('directory.states.retry', 'Try again')}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="mx-auto max-w-xl rounded-card border border-dashed border-rule bg-white px-6 py-12 text-center">
                <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-pill bg-chip text-navy">
                  {orgs.length === 0 ? <Building2 className="h-6 w-6" aria-hidden="true" /> : <Search className="h-6 w-6" aria-hidden="true" />}
                </span>
                <p className="text-h3 text-navy" role="status">
                  {orgs.length === 0
                    ? t('directory.noOrganizations', 'No organizations are listed yet.')
                    : t('directory.noMatch', 'No organization matches these filters.')}
                </p>
                {orgs.length > 0 && (
                  <>
                    <p className="mt-2 text-body text-meta">{t('directory.states.noMatchHint', 'Try another word, or remove a filter.')}</p>
                    <div className="mt-6 flex flex-wrap justify-center gap-3">
                      {tokens.length > 0 && (
                        <Button variant="tideOutline" onClick={() => update({ q: null })}>
                          {t('directory.states.clearSearch', 'Clear the search')}
                        </Button>
                      )}
                      {narrowed && (
                        <Button variant="tideNavy" onClick={clearAll}>
                          {t('directory.clearFilters', 'Clear filters')}
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <>
                <p className="text-sm text-meta">
                  <span className="sr-only">
                    {t('directory.results', { count: filtered.length, defaultValue: '{{count}} organizations' })}
                  </span>
                  <span aria-hidden="true">
                    <strong className="font-semibold text-ink">
                      <RollingNumber value={filtered.length} lang={lang} />{' '}
                      {t('directory.resultsWord', { count: filtered.length, defaultValue: 'organizations' })}
                    </strong>
                    {' · '}
                    {t(`directory.countSuffix.${sort}`, sort === 'relevance' ? 'members first' : sort === 'az' ? 'A to Z' : 'newest first')}
                  </span>
                </p>

                {featured.length > 0 && (
                  <section
                    aria-labelledby="directory-featured-heading"
                    className="mt-5 rounded-card border border-rule bg-white p-4 sm:p-6"
                  >
                    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                      <div className="min-w-[12rem] flex-1">
                        <h2 id="directory-featured-heading" className="text-h3 text-navy">
                          {t('directory.featuredTitle', 'Event partners')}
                        </h2>
                        <p className="mt-1 text-sm text-meta">{t('directory.featuredDesc', "Companies that sponsor M3's events")}</p>
                      </div>
                      <Link to="/partners" className={buttonVariants({ variant: 'tideOutline', size: 'sm' })}>
                        {t('directory.featuredAll', 'All partners')}
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </Link>
                    </div>
                    <ul className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                      {featured.map((o, i) => (
                        <Reveal as="li" key={o.id} delay={(i % 3) * 80} className="flex">
                          <DirectoryCard org={o} {...cardProps} />
                        </Reveal>
                      ))}
                    </ul>
                  </section>
                )}

                {visible.length > 0 && (
                  <ul ref={listRef} className="mt-5 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                    {visible.map((o, i) => (
                      <FragmentWithNeed
                        key={o.id}
                        need={showNeed && i === Math.min(5, visible.length - 1)}
                        needPanel={
                          <NeedPanel
                            marinaLike={!!user && marinaLike}
                            onSignup={() => openSignup('marina')}
                          />
                        }
                      >
                        <Reveal as="li" delay={(i % 3) * 80} className="flex">
                          <DirectoryCard org={o} {...cardProps} />
                        </Reveal>
                      </FragmentWithNeed>
                    ))}
                  </ul>
                )}

                {rest.length > visible.length && (
                  <div className="mt-10 flex flex-col items-center gap-3">
                    <p className="text-sm text-meta">
                      {t('directory.shownOf', 'Showing {{shown}} of {{total}}', { shown: shownCount, total: filtered.length })}
                    </p>
                    <Button variant="tideOutline" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
                      {t('directory.showMore', 'Show more')}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </BuoyTabsContent>
      </BuoyTabs>

      {/* ── SEO text with the six theme pages, and "claim your marina" ── */}
      <div className="container mx-auto px-4 pb-20 pt-14 md:pb-28 md:pt-20">
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
          <section aria-labelledby="directory-seo-heading" className="lg:col-span-7">
            <Reveal>
              <Eyebrow>{t('directory.seo.eyebrow', 'Directory')}</Eyebrow>
            </Reveal>
            <LineReveal as="h2" id="directory-seo-heading" className="mt-3 text-h2-sm text-navy md:text-h2">
              {t('directory.seo.title', 'Find a service provider for your marina')}
            </LineReveal>
            <Reveal delay={120}>
              <p className="mt-4 text-body text-ink md:text-body-lg">
                {t('directory.seo.p1', 'The Smart Marina Connect directory brings together marinas and the companies that equip and run them: pontoons and dredging, shore power, harbour office software, design, insurance and more. Every member is checked by the M3 team, which organises the industry’s events in Monaco, in Dubai and online.')}
              </p>
              <p className="mt-3 text-body text-ink md:text-body-lg">
                {t('directory.seo.p2', 'Filter by theme or country, shortlist the companies you need, then request an introduction from their page: the request lands in their inbox.')}
              </p>
            </Reveal>
            <p className="text-meta-caps mt-8">{t('directory.seo.themes', 'Explore by theme')}</p>
            <RevealGroup as="ul" step={60} className="mt-3 flex flex-wrap gap-2">
              {THEMES.map((th) => (
                <li key={th.key}>
                  <Link
                    to={themedPath('/directory', th.key)}
                    className="focus-ring inline-flex h-11 items-center gap-2 rounded-field border border-rule bg-white px-3.5 text-sm font-medium text-navy transition-colors hover:border-navy/40 md:h-10"
                  >
                    <ThemeFlag theme={th.key} />
                    {themeLabel(th)}
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </RevealGroup>
          </section>

          {/* The harbour office plate (the same form as the home page's ContactCard). */}
          <Reveal as="aside" aria-labelledby="directory-claim-heading" className="relative self-start rounded-field bg-white p-6 ring-1 ring-inset ring-rule md:p-8 lg:col-span-5">
            <span aria-hidden="true" className="pointer-events-none absolute inset-1.5 rounded-[8px] border border-[#c9a24f]/70" />
            <p className="relative font-signage text-[13px] font-semibold uppercase tracking-[0.16em] text-gold-text">
              {t('brand.contact.office', 'Harbour office · M3 Monaco')}
            </p>
            <h2 id="directory-claim-heading" className="relative mt-3 text-h3 text-navy">
              {t('directory.claim.title', 'Is your marina listed? Claim it')}
            </h2>
            <p className="relative mt-3 text-[15px] leading-6 text-ink/85">
              {t('directory.claim.body', 'Most marinas in the directory were listed by the M3 team before they had an account. Claim your marina’s page to complete it and keep it up to date: the M3 team checks every request before handing the page over.')}
            </p>
            <div className="relative mt-6 flex items-center gap-4">
              <span aria-hidden="true" className="grid h-14 w-14 shrink-0 place-items-center rounded-[6px] border-2 border-[#c9a24f] bg-page font-signage text-[22px] font-semibold tracking-[0.06em] text-navy">
                VM
              </span>
              <div className="min-w-0">
                <p className="text-card-title text-navy">Victor Meyer</p>
                <a href={`mailto:${M3_PUBLIC_EMAIL}`} className="focus-ring rounded-badge text-sm text-navy underline underline-offset-2 hover:text-teal-text">
                  {M3_PUBLIC_EMAIL}
                </a>
              </div>
            </div>
            <div className="relative mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
              <a href={claimHref} className={buttonVariants({ variant: 'tide' })}>
                {t('directory.claim.cta', 'Claim my marina')}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
              <Link to="/contact" className="focus-ring inline-flex min-h-11 items-center rounded-badge text-sm font-semibold text-navy underline underline-offset-4 hover:text-teal-text">
                {t('directory.claim.question', 'Ask a question')}
              </Link>
            </div>
          </Reveal>
        </div>
      </div>

      {/* ── Filters drawer ── */}
      <Drawer
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        title={t('directory.filters.title', 'Filters')}
        closeLabel={t('directory.filters.close', 'Close the filters')}
        headerAction={drawerFilterCount > 0 ? (
          <button
            type="button"
            onClick={() => update({ theme: null, sector: null, country: null, joined: null, mine: null })}
            className="focus-ring rounded-badge px-1.5 py-1 text-sm font-semibold text-gold-text underline underline-offset-[3px] hover:text-navy"
          >
            {t('directory.filters.clearAll', 'Clear all')} ({drawerFilterCount})
          </button>
        ) : null}
        footer={(
          // Every choice applies at once (the counts are live): the footer only closes.
          <Button variant="tide" className="w-full justify-between" onClick={() => { setFiltersOpen(false); window.setTimeout(() => scrollToResults(true), 320); }}>
            {t('directory.filters.done', { count: filtered.length, defaultValue: 'Done · {{count}} organizations' })}
            <Check className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      >
        <FiltersBody
          sort={sort}
          sortOptions={sortOptions}
          onSort={setSort}
          joinedOnly={joinedOnly}
          joinedAvailable={derived.joinedAvailable}
          onJoined={() => update({ joined: joinedOnly ? null : '1' })}
          mineAvailable={mySectorSlugs.size > 0 ? derived.mineAvailable : null}
          activeMine={activeMine}
          onMine={() => update({ mine: activeMine ? null : '1' })}
          activeTheme={activeTheme}
          themeCounts={derived.themeCounts}
          themeHint={!activeType
            ? t('directory.themesHint.all', 'Service providers are grouped by the services they offer, marinas by their areas of interest.')
            : INTEREST_SIDE.has(activeType)
              ? t('directory.themesHint.interest', "Grouped by each organization's areas of interest.")
              : t('directory.themesHint.supply', 'Grouped by the services each company offers.')}
          onTheme={(key) => update({ theme: key, sector: null })}
          themeLabel={themeLabel}
          themeSectors={themeSectors}
          sectorCounts={derived.sectorCounts}
          activeSector={activeSector}
          onSector={(slug) => update({ sector: slug })}
          sectorLabel={sectorLabel}
          countryInfo={countryInfo}
          countryCounts={derived.countryCounts}
          activeCountries={activeCountries}
          onCountry={toggleCountry}
          onClearCountries={() => update({ country: null })}
        />
      </Drawer>

      {/* ── Visitor shortlist drawer ── */}
      <Drawer
        open={shortlistOpen}
        onOpenChange={setShortlistOpen}
        width="sm"
        title={t('directory.shortlist.title', 'Your shortlist')}
        closeLabel={t('directory.shortlist.close', 'Close the shortlist')}
      >
        <div className="py-6">
          <p className="drawer-group text-body text-ink" style={{ '--i': 0 } as CSSProperties}>
            {t('directory.shortlist.intro', 'A berth for the companies you want to call back: keep them here and find them again before your next tender.')}
          </p>
          <div className="drawer-group mt-5 rounded-field border-2 border-dashed border-rule px-6 py-10 text-center" style={{ '--i': 1 } as CSSProperties}>
            <AnchorMark className="mx-auto h-6 w-6 text-navy" />
            <p className="mt-3 text-[15px] leading-6 text-meta">{t('directory.shortlist.empty', 'Nothing moored yet: tap the anchor on a company to keep it here.')}</p>
          </div>
          <hr className="my-6 border-rule" />
          <div className="drawer-group" style={{ '--i': 2 } as CSSProperties}>
            <p className="text-base font-semibold leading-6 text-navy">
              {shortlistFor
                ? t('directory.shortlist.signInTo', { name: shortlistFor.name, defaultValue: 'To moor {{name}} here, sign in.' })
                : t('directory.shortlist.signInGeneric', 'Sign in to keep your shortlist.')}
            </p>
            <p className="mt-1 text-sm text-meta">{t('directory.shortlist.who', 'Free for marinas, developers and investors with an account.')}</p>
            <Button variant="tide" className="mt-5 w-full" onClick={() => openSignup()}>
              {t('directory.shortlist.signUp', 'Create a free account')}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button variant="tideOutline" className="mt-3 w-full" onClick={openLogin}>
              {t('directory.shortlist.signIn', 'Sign in')}
            </Button>
          </div>
        </div>
      </Drawer>

      {/* ── Sign in / sign up (visitors) ── */}
      <Dialog open={loginOpen} onOpenChange={setLoginOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('auth.login', 'Sign in')}</DialogTitle>
            <DialogDescription>{t('directory.shortlist.loginDesc', 'Sign in to keep a shortlist and request introductions.')}</DialogDescription>
          </DialogHeader>
          <LoginForm onSuccess={() => setLoginOpen(false)} />
        </DialogContent>
      </Dialog>
      <Dialog open={signupOpen} onOpenChange={setSignupOpen}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('auth.signup', 'Sign up')}</DialogTitle>
            <DialogDescription>{t('directory.shortlist.signupDesc', 'Free for every member. The M3 team checks every company.')}</DialogDescription>
          </DialogHeader>
          <SignupForm key={signupPersona ?? 'any'} defaultPersona={signupPersona} onSuccess={() => setSignupOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─── Pieces ─────────────────────────────────────────────────────── */

/** A card, and after it (once) the wide "publish your need" panel. */
function FragmentWithNeed({ need, needPanel, children }: { need: boolean; needPanel: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      {children}
      {need && needPanel}
    </>
  );
}

/** The live figures under the hero title: they count once, tabular. */
function HeroFigures({ marinas, providers, countries, manual }: { marinas: number | null; providers: number | null; countries: number | null; manual: boolean }) {
  const { t } = useTranslation();
  const items: [string, number | null, string][] = [
    ['marinas', marinas, t('directory.figures.marinas', 'marinas listed')],
    ['providers', providers, t('directory.figures.providers', 'service providers')],
    ['countries', countries, t('directory.figures.countries', 'countries')],
  ];
  return (
    <dl aria-label={t('directory.figures.label', 'The directory in figures')} className="flex flex-wrap gap-y-3">
      {items.map(([key, value, label], i) => (
        <div key={key} className={cn('flex flex-col-reverse pr-5 sm:pr-8', i > 0 && 'border-l border-white/25 pl-5 sm:pl-8')}>
          <dt className="mt-1.5 font-signage text-[13px] font-semibold uppercase leading-4 tracking-[0.1em] text-white/80">{label}</dt>
          <dd className="text-[24px] text-white sm:text-[30px]">
            <FlapFigure value={value} suffix={manual ? '+' : ''} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The count in a buoy tab: plain tabular meta text after the label. */
function TabCount({ value }: { value: number | null }) {
  if (value === null) return null;
  return <span className="tabular text-[13px] font-normal text-meta">{value}</span>;
}

/** "Members only": a real switch (role="switch"), gold when on. */
function MembersSwitch({ checked, count, onToggle, className }: { checked: boolean; count?: number; onToggle: () => void; className?: string }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      title={t('directory.onPlatformHint', 'Show only organizations whose team has an account on the platform')}
      className={cn('focus-ring inline-flex h-10 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-pill px-1.5 text-sm font-medium text-ink', className)}
    >
      <span
        aria-hidden="true"
        className={cn(
          'relative h-6 w-10 shrink-0 rounded-pill border-[1.5px] transition-colors duration-300',
          checked ? 'border-navy bg-gold' : 'border-checkbox bg-white',
        )}
      >
        <span
          className={cn(
            'absolute left-[3px] top-[3px] h-[15px] w-[15px] rounded-pill transition-transform duration-300 ease-swing motion-reduce:transition-none',
            checked ? 'translate-x-4 bg-navy' : 'bg-checkbox',
          )}
        />
      </span>
      {t('directory.membersOnly', 'Members only')}
      {count !== undefined && <span className="tabular text-[13px] text-meta">{count}</span>}
    </button>
  );
}

function SortSelect({ value, options, onChange, className }: {
  value: SortKey;
  options: { value: SortKey; label: string; long: string }[];
  onChange: (value: SortKey) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <label className={cn('relative h-12 shrink-0 items-center rounded-field border border-checkbox bg-white pl-4 pr-9 focus-within:border-navy focus-within:shadow-focus', className)}>
      <span className="mr-1.5 text-sm text-meta">{t('directory.sort.label', 'Sort:')}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SortKey)}
        className="cursor-pointer appearance-none bg-transparent text-sm font-semibold text-navy outline-none"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-navy" aria-hidden="true" />
    </label>
  );
}

/** The results count, rolling to its new value (0.45 s) when a filter changes. */
function RollingNumber({ value, lang }: { value: number; lang: 'en' | 'fr' }) {
  const { reduced } = useMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduced || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 450);
      const v = Math.round(a + (value - a) * (1 - Math.pow(1 - p, 3)));
      from.current = v;
      setShown(v);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    // Background tabs throttle rAF: the true figure lands anyway.
    const settle = window.setTimeout(() => { from.current = value; setShown(value); }, 700);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(settle); };
  }, [value, reduced]);
  return <span className="tabular">{shown.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB')}</span>;
}

/* ── Active-filter chips ── */

interface ChipItem {
  id: string;
  label: string;
  onRemove: () => void;
}

/**
 * Chips that scale in when a filter is added and shrink away when it is
 * removed (0.32 s), keeping their place meanwhile. Removing one moves the
 * keyboard focus to the next chip, else to the Filters button.
 */
function AnimatedChips({ items, label, removeLabel, fallbackFocus }: {
  items: ChipItem[];
  label: string;
  removeLabel: (label: string) => string;
  fallbackFocus: React.RefObject<HTMLButtonElement>;
}) {
  const { reduced } = useMotion();
  const ref = useRef<HTMLUListElement>(null);
  const [rendered, setRendered] = useState<(ChipItem & { out?: boolean })[]>(items);

  useEffect(() => {
    setRendered((prev) => {
      const byId = new Map(items.map((i) => [i.id, i]));
      const next: (ChipItem & { out?: boolean })[] = [];
      for (const p of prev) {
        const now = byId.get(p.id);
        if (now) next.push(now);
        else if (!reduced) next.push({ ...p, out: true });
      }
      for (const i of items) if (!prev.some((p) => p.id === i.id)) next.push(i);
      return next;
    });
    if (reduced) return;
    const timer = window.setTimeout(() => setRendered((r) => r.filter((x) => !x.out)), 340);
    return () => window.clearTimeout(timer);
  }, [items, reduced]);

  if (rendered.length === 0) return null;

  const remove = (item: ChipItem) => {
    const live = rendered.filter((r) => !r.out);
    const index = live.findIndex((r) => r.id === item.id);
    item.onRemove();
    requestAnimationFrame(() => {
      const buttons = ref.current?.querySelectorAll<HTMLButtonElement>('button[data-chip]:not([data-out])');
      const others = buttons ? [...buttons].filter((b) => b.dataset.chip !== item.id) : [];
      (others[index] ?? others[index - 1] ?? fallbackFocus.current)?.focus();
    });
  };

  return (
    <>
      <span className="sr-only">{label}</span>
      <ul ref={ref} className="contents">
        {rendered.map((item) => (
          <li
            key={item.id}
            aria-hidden={item.out || undefined}
            className={cn('dir-chip inline-flex h-9 items-center gap-0.5 rounded-pill bg-chip pl-3.5 pr-1 text-sm font-medium text-navy', item.out && 'is-out pointer-events-none')}
          >
            {item.label}
            <button
              type="button"
              data-chip={item.id}
              data-out={item.out ? '' : undefined}
              tabIndex={item.out ? -1 : undefined}
              onClick={() => remove(item)}
              aria-label={removeLabel(item.label)}
              className="grid h-7 w-7 place-items-center rounded-pill text-navy transition-colors hover:bg-white focus-visible:shadow-focus focus-visible:outline-none"
            >
              <XSmall />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function XSmall() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

/* ── Collections ── */

interface Collection {
  key: string;
  kicker: string;
  title: string;
  /** The filter URL's query string, e.g. "?theme=energy". */
  search: string;
  icon: LucideIcon;
  count: number;
  /** The flag the cartouche flies: a theme's signal flag, a type's burgee, else a waterline. */
  theme?: ThemeKey;
  orgType?: string;
}

/**
 * M3 selections as shareable filter URLs, drawn as chart cartouches (navy, a
 * graticule and sounding lines, a framed title in the signage face, the
 * organisation count in the board's tabular caps and the cap needle after it),
 * in a scroll-snap row: native swiping and trackpad scrolling, square buttons
 * from md up, and a thin rule that says where you are.
 */
function CollectionsRow({ items, currentKey, onPick }: { items: Collection[]; currentKey: string | null; onPick: (key: string) => void }) {
  const { t } = useTranslation();
  const { reduced } = useMotion();
  const rowRef = useRef<HTMLUListElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false, overflow: false });

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const max = row.scrollWidth - row.clientWidth;
      const frac = Math.min(1, row.clientWidth / Math.max(1, row.scrollWidth));
      const p = max > 0 ? Math.min(1, Math.max(0, row.scrollLeft / max)) : 0;
      const bar = barRef.current;
      if (bar) {
        bar.style.width = `${frac * 100}%`;
        bar.style.transform = `translate3d(${p * (1 / frac - 1) * 100}%, 0, 0)`;
      }
      const next = { start: row.scrollLeft <= 4, end: row.scrollLeft >= max - 4, overflow: max > 4 };
      setEdges((prev) => (prev.start === next.start && prev.end === next.end && prev.overflow === next.overflow ? prev : next));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    row.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(schedule);
      ro.observe(row);
    }
    return () => {
      if (frame) cancelAnimationFrame(frame);
      row.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      ro?.disconnect();
    };
  }, [items.length]);

  const page = (dir: -1 | 1) => {
    const row = rowRef.current;
    if (row) row.scrollBy({ left: dir * row.clientWidth * 0.85, behavior: reduced ? 'auto' : 'smooth' });
  };

  return (
    <section aria-labelledby="directory-collections-heading" className="mt-8 md:mt-10">
      <div className="flex items-end justify-between gap-4">
        <div>
          <Reveal>
            <Eyebrow>{t('directory.collections.eyebrow', 'M3 selections')}</Eyebrow>
          </Reveal>
          <LineReveal as="h2" id="directory-collections-heading" className="mt-2 text-[20px] font-semibold leading-[26px] text-navy md:text-[24px] md:leading-[30px]">
            {t('directory.collections.title', 'Selections by the M3 team')}
          </LineReveal>
        </div>
        <div className={cn('hidden shrink-0 gap-2', edges.overflow && 'md:flex')}>
          <Button variant="tideOutline" size="icon" className="h-10 w-10 rounded-field md:h-10 md:w-10" disabled={edges.start} onClick={() => page(-1)} aria-label={t('directory.collections.prev', 'Previous selections')}>
            <ChevronLeft className="h-[18px] w-[18px]" aria-hidden="true" />
          </Button>
          <Button variant="tideOutline" size="icon" className="h-10 w-10 rounded-field md:h-10 md:w-10" disabled={edges.end} onClick={() => page(1)} aria-label={t('directory.collections.next', 'Next selections')}>
            <ChevronRight className="h-[18px] w-[18px]" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <ul
        ref={rowRef}
        aria-label={t('directory.collections.label', 'M3 selections')}
        className="dir-collections -mx-4 mt-3 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pb-2 pt-2"
      >
        {items.map((item, i) => {
          const current = item.key === currentKey;
          return (
            <Reveal as="li" key={item.key} delay={Math.min(i, 5) * 80} className="shrink-0 snap-start">
              <Link
                to={{ pathname: '/directory', search: item.search }}
                onClick={() => onPick(item.key)}
                aria-current={current ? 'true' : undefined}
                draggable={false}
                className="card-lift group relative isolate flex h-[168px] w-[256px] flex-col justify-between overflow-hidden rounded-card bg-navy-deep p-5 text-white outline-none focus-visible:shadow-focus md:h-[180px] md:w-[284px]"
              >
                {/* The chart: graticule and sounding lines, inside a cartouche frame. */}
                <Graticule tone="white" cell={28} opacity={0.08} className="absolute inset-0 -z-10 h-full w-full" />
                <BathyPattern seed={seedOf(item.key)} rings={7} opacity={0.12} className="absolute inset-0 -z-10" />
                <span aria-hidden="true" className="pointer-events-none absolute inset-2 rounded-[10px] border border-white/20" />
                <span className="relative flex items-center gap-2 font-signage text-[12px] font-semibold uppercase tracking-[0.14em] text-white/75">
                  {item.theme ? (
                    <ThemeFlag theme={item.theme} className="ring-white/40" />
                  ) : item.orgType ? (
                    <TypePennant type={item.orgType} className="h-3 w-5 [&>path:first-child]:fill-white" />
                  ) : (
                    <WaveMark tone="onDark" />
                  )}
                  {item.kicker}
                </span>
                <span className="relative font-signage text-[21px] font-semibold uppercase leading-[24px] tracking-[0.04em]">{item.title}</span>
                <span className="relative flex items-center gap-2 font-signage text-[13px] font-semibold uppercase tabular tracking-[0.12em] text-[#9fd6df]">
                  {t('directory.collections.count', { count: item.count, defaultValue: '{{count}} organizations' })}
                  <CapArrow size="sm" tone="dark" />
                </span>
                {current && (
                  <>
                    <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-card shadow-[inset_0_0_0_2px_rgb(215_166_71),inset_0_0_0_4px_rgb(11_38_83)]" />
                    <span className="sr-only">({t('directory.collections.current', 'current selection')})</span>
                  </>
                )}
              </Link>
            </Reveal>
          );
        })}
      </ul>
      <div aria-hidden="true" className={cn('relative mt-2 h-0.5 overflow-hidden rounded-pill bg-rule', !edges.overflow && 'invisible')}>
        <span ref={barRef} className="absolute inset-y-0 left-0 w-1/3 rounded-pill bg-navy will-change-transform" />
      </div>
    </section>
  );
}

/* ── Cards ── */

function CardSkeleton() {
  return (
    <li className="overflow-hidden rounded-card border border-rule bg-white">
      <div className="h-32 animate-pulse bg-chip motion-reduce:animate-none" />
      <div className="space-y-3 px-5 pb-6 pt-10">
        <div className="h-3 w-24 animate-pulse rounded-pill bg-chip motion-reduce:animate-none" />
        <div className="h-5 w-3/4 animate-pulse rounded-pill bg-chip motion-reduce:animate-none" />
        <div className="h-3 w-1/2 animate-pulse rounded-pill bg-chip motion-reduce:animate-none" />
        <div className="h-3 w-full animate-pulse rounded-pill bg-chip motion-reduce:animate-none" />
        <div className="h-3 w-5/6 animate-pulse rounded-pill bg-chip motion-reduce:animate-none" />
      </div>
    </li>
  );
}

/** A bookmark with an anchor in it: the shortlist's own glyph. */
function AnchorMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3h12v18l-6-4-6 4z" />
      <circle cx="12" cy="7.6" r="1.3" />
      <path d="M12 8.9v5.4M9.2 12.2c.2 1.5 1.4 2.4 2.8 2.4s2.6-.9 2.8-2.4M10.4 10.4h3.2" />
    </svg>
  );
}

/**
 * One organization, as a berth card (OrgCard's grammar): a band of sounding
 * lines with nothing on it, the type flown as a burgee at the card's left edge,
 * the logo beside the name, a meta row (place, "Verified member" as words for
 * organizations that have an owner, the sponsor tier, the team on the
 * platform), the blurb, up to two theme or sector chips, and a footer with the
 * labelled shortlist button and "View profile" with the cap needle. The name
 * is the link and stretches over the whole card; the shortlist button sits
 * above it. The profile it leads to is where members send a connection request.
 */
function DirectoryCard({
  org, openTheme, activeSector, sectorLabel, themeLabel, visitor, onVisitorStar,
}: {
  org: Indexed;
  openTheme: Theme | null;
  activeSector: string | null;
  sectorLabel: (slug: string) => string;
  themeLabel: (th: Theme) => string;
  visitor: boolean;
  onVisitorStar: (name: string) => void;
}) {
  const { t } = useTranslation();
  const blurb = org.description || org.audience_description;
  const paying = isPaying(org.tier);

  // What the card is about, in up to two chips. In the whole directory that is
  // its themes (with their flags); inside an open theme every card would repeat
  // the same name, so the chips name its sectors within that theme instead.
  let chips: { key: string; label: string; theme?: ThemeKey }[];
  let more = 0;
  if (openTheme) {
    const inTheme = org.sectorSlugs.filter((s) => openTheme.sectors.includes(s));
    const ordered = activeSector && inTheme.includes(activeSector)
      ? [activeSector, ...inTheme.filter((s) => s !== activeSector)]
      : inTheme;
    chips = ordered.slice(0, 2).map((slug) => ({ key: slug, label: sectorLabel(slug) }));
    more = Math.max(0, ordered.length - 2);
  } else {
    chips = org.themes.slice(0, 2).map((k) => { const th = getTheme(k)!; return { key: k, label: themeLabel(th), theme: k }; });
    more = Math.max(0, org.themes.length - 2);
  }

  const shortlistLabel = t('directory.shortlist.button', 'Shortlist');

  return (
    <CardShell interactive className="h-full w-full">
      <BerthBand seed={org.id} />

      <div className="flex flex-1 flex-col px-5 pb-4 pt-4">
        <TypeFlagLabel type={org.organization_type} />
        <div className="mt-3 flex items-start gap-3">
          <LogoTile src={org.logo_url} name={org.name} type={org.organization_type} size={48} />
          <h3 className="min-w-0 pt-0.5 text-card-title text-navy">
            <StretchedLink to={`/organizations/${org.slug}`} className="line-clamp-2">{org.name}</StretchedLink>
          </h3>
        </div>

        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-meta">
          {org.place && (
            <span className="inline-flex min-w-0 max-w-full items-center gap-1">
              <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{org.place}</span>
            </span>
          )}
          {org.claimed && <VerifiedMark />}
          {paying && (
            <span className="font-signage text-[12px] font-semibold uppercase tracking-[0.1em] text-navy">
              {t(`sharedUi.sponsorBadge.tiers.${org.tier}`, TIER_LABELS[org.tier as OrgTier] ?? org.tier)}
            </span>
          )}
          {org.member_count > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              {t('directory.members', { count: org.member_count, defaultValue: '{{count}} members' })}
            </span>
          ) : (
            <span className="italic" title={t('directory.notYetJoinedHint', "Listed, but its team hasn't joined the platform yet.")}>
              {t('directory.notYetJoined', 'Not yet on the platform')}
            </span>
          )}
        </p>

        {blurb && <p className="mt-3 line-clamp-3 text-sm leading-5 text-ink/80">{blurb}</p>}

        {chips.length > 0 && (
          <ul
            aria-label={openTheme ? t('directory.card.sectors', 'Sectors') : t('directory.card.themes', 'Themes')}
            className="mt-3 flex flex-wrap gap-1.5"
          >
            {chips.map((c) => (
              <li key={c.key} className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-badge bg-chip px-2 text-[12px] font-medium text-navy">
                {c.theme && <ThemeFlag theme={c.theme} className="h-2.5 w-[15px]" />}
                <span className="truncate">{c.label}</span>
              </li>
            ))}
            {more > 0 && (
              <li className="inline-flex h-6 items-center rounded-badge bg-page px-2 text-[12px] font-medium text-meta">
                <span aria-hidden="true">+{more}</span>
                <span className="sr-only">{t('directory.card.more', { count: more, defaultValue: 'and {{count}} more' })}</span>
              </li>
            )}
          </ul>
        )}

        <div className="mt-auto pt-4">
          <div className="flex items-center justify-between gap-3 border-t border-rule pt-3">
            {/* Above the stretched link, so it toggles instead of navigating. */}
            {visitor ? (
              <button
                type="button"
                onClick={() => onVisitorStar(org.name)}
                aria-haspopup="dialog"
                aria-label={t('directory.shortlist.buttonLabel', { name: org.name, defaultValue: 'Shortlist: {{name}}' })}
                className="relative z-10 -ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-field px-2 text-sm font-semibold text-navy transition-colors hover:bg-chip focus-visible:shadow-focus focus-visible:outline-none md:min-h-9"
              >
                <AnchorMark className="h-[18px] w-[18px]" />
                {shortlistLabel}
              </button>
            ) : (
              // Loads its own org_bookmarks row and renders only for marina,
              // developer and investor members (BookmarkButton).
              <span className="relative z-10 -ml-1.5">
                <BookmarkButton organizationId={org.id} organizationName={org.name} className="h-11 w-11 md:h-9 md:w-9" />
              </span>
            )}
            <ViewProfileCue />
          </div>
        </div>
      </div>
    </CardShell>
  );
}

/**
 * The wide "Run a marina? Publish your need" panel, a navy panel revealed by a
 * rising wave edge. Members who can publish go to the form; visitors sign up
 * as a marina; other members do not see it.
 */
function NeedPanel({ marinaLike, onSignup }: { marinaLike: boolean; onSignup: () => void }) {
  const { t } = useTranslation();
  const examples = [
    t('directory.need.ex1', 'Pontoons'),
    t('directory.need.ex2', 'Shore power pedestals'),
    t('directory.need.ex3', 'Dredging'),
    t('directory.need.ex4', 'Harbour office software'),
  ];
  return (
    <li className="col-span-full">
      <WavePanel as="div" tone="navy" bathy bathySeed={11} role="group" aria-labelledby="directory-need-heading" className="rounded-card px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-col gap-7 lg:flex-row lg:items-center lg:justify-between lg:gap-12">
          <div className="max-w-[680px]">
            <Eyebrow tone="onDark">{t('directory.need.eyebrow', 'For marinas')}</Eyebrow>
            <h3 id="directory-need-heading" className="mt-3 text-[22px] font-semibold leading-[30px] tracking-[-0.01em] text-white md:text-[28px] md:leading-9">
              {t('directory.need.title', 'Run a marina? Publish your need and the verified service providers come to you.')}
            </h3>
            <ul aria-label={t('directory.need.examplesLabel', 'Examples of needs')} className="mt-5 flex flex-wrap gap-2">
              {examples.map((e) => (
                <li key={e} className="inline-flex h-8 items-center rounded-pill bg-white/10 px-3.5 text-sm text-white ring-1 ring-inset ring-white/25">{e}</li>
              ))}
            </ul>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-3">
            {marinaLike ? (
              <Link to="/submit-project" className={buttonVariants({ variant: 'tideOnDark' })}>
                {t('directory.need.cta', 'Publish a need')}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            ) : (
              <Button variant="tideOnDark" onClick={onSignup}>
                {t('directory.need.ctaVisitor', 'Sign up as a marina')}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
            <Link to="/opportunities" className="focus-ring rounded-badge text-sm font-semibold text-white underline underline-offset-4 hover:text-white/80">
              {t('directory.need.how', 'How opportunities work')}
            </Link>
          </div>
        </div>
      </WavePanel>
    </li>
  );
}

/* ── Filters drawer body ── */

function FilterGroup({ index, title, action, className, children, labelId }: {
  index: number;
  title: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
  labelId: string;
}) {
  return (
    <div role="group" aria-labelledby={labelId} className={cn('drawer-group border-b border-rule py-5 last:border-b-0', className)} style={{ '--i': index } as CSSProperties}>
      <div className="mb-2 flex min-h-6 items-center justify-between gap-3">
        <h3 id={labelId} className="text-[12px] font-semibold uppercase leading-4 tracking-[0.06em] text-meta">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

/** A checkbox or radio row: native input (keyboard, forms), drawn box, live count. */
function OptionRow({ type, name, checked, disabled, onChange, label, count }: {
  type: 'checkbox' | 'radio';
  name?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: React.ReactNode;
  count?: number;
}) {
  return (
    <label
      className={cn(
        'relative -mx-2 flex min-h-11 items-center gap-3 rounded-field px-2 text-[15px] leading-5 text-ink transition-colors',
        disabled ? 'cursor-not-allowed text-meta' : 'cursor-pointer hover:bg-chip',
      )}
    >
      <input type={type} name={name} checked={checked} disabled={disabled} onChange={onChange} className="peer sr-only" />
      <span
        aria-hidden="true"
        className={cn(
          'grid h-[18px] w-[18px] shrink-0 place-items-center border-[1.5px] border-checkbox bg-white transition-colors',
          'peer-checked:border-navy peer-checked:bg-gold peer-focus-visible:shadow-focus peer-disabled:border-rule peer-disabled:bg-page',
          '[&>*]:opacity-0 peer-checked:[&>*]:opacity-100',
          type === 'radio' ? 'rounded-pill' : 'rounded-[4px]',
        )}
      >
        {type === 'radio' ? <span className="h-2 w-2 rounded-pill bg-navy" /> : <Check className="h-3 w-3 text-navy" strokeWidth={3.5} />}
      </span>
      <span className="min-w-0 flex-1">{label}</span>
      {count !== undefined && <span className="tabular text-[13px] text-meta">{count}</span>}
    </label>
  );
}

const COUNTRIES_SHOWN = 8;

function FiltersBody(props: {
  sort: SortKey;
  sortOptions: { value: SortKey; label: string; long: string }[];
  onSort: (value: SortKey) => void;
  joinedOnly: boolean;
  joinedAvailable: number;
  onJoined: () => void;
  mineAvailable: number | null;
  activeMine: boolean;
  onMine: () => void;
  activeTheme: Theme | null;
  themeCounts: Record<ThemeKey, number>;
  themeHint: string;
  onTheme: (key: ThemeKey | null) => void;
  themeLabel: (th: Theme) => string;
  themeSectors: string[];
  sectorCounts: Record<string, number>;
  activeSector: string | null;
  onSector: (slug: string | null) => void;
  sectorLabel: (slug: string) => string;
  countryInfo: Map<string, { slug: string; label: string; en: string }>;
  countryCounts: Map<string, number>;
  activeCountries: string[];
  onCountry: (slug: string) => void;
  onClearCountries: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [countryQuery, setCountryQuery] = useState('');
  const [allCountries, setAllCountries] = useState(false);

  const countries = useMemo(() => {
    const q = fold(countryQuery.trim());
    const list = [...props.countryInfo.values()]
      .map((c) => ({ ...c, count: props.countryCounts.get(c.slug) ?? 0, on: props.activeCountries.includes(c.slug) }))
      .filter((c) => c.count > 0 || c.on)
      .filter((c) => !q || fold(c.label).includes(q) || fold(c.en).includes(q));
    list.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, i18n.language));
    return list;
  }, [props.countryInfo, props.countryCounts, props.activeCountries, countryQuery, i18n.language]);

  const searching = countryQuery.trim() !== '';
  const shownCountries = searching || allCountries
    ? countries
    : [...countries.slice(0, COUNTRIES_SHOWN), ...countries.slice(COUNTRIES_SHOWN).filter((c) => c.on)];
  const hiddenCount = countries.length - shownCountries.length;

  const clearLink = (onClick: () => void) => (
    <button type="button" onClick={onClick} className="focus-ring rounded-badge px-1 text-[12px] font-semibold text-gold-text underline underline-offset-[3px] hover:text-navy">
      {t('directory.filters.clearGroup', 'Clear')}
    </button>
  );

  return (
    <div>
      {/* Sort: in the toolbar from lg up; here below. */}
      <FilterGroup index={0} labelId="dir-f-sort" title={t('directory.filters.sort', 'Sort')} className="lg:hidden">
        <div role="radiogroup" aria-labelledby="dir-f-sort">
          {props.sortOptions.map((o) => (
            <OptionRow key={o.value} type="radio" name="dir-sort" checked={props.sort === o.value} onChange={() => props.onSort(o.value)} label={o.long} />
          ))}
        </div>
      </FilterGroup>

      <FilterGroup index={1} labelId="dir-f-status" title={t('directory.filters.status', 'Status')}>
        <OptionRow
          type="checkbox"
          checked={props.joinedOnly}
          onChange={props.onJoined}
          label={(
            <>
              <span className="block">{t('directory.membersOnly', 'Members only')}</span>
              <span className="block text-[13px] leading-[18px] text-meta">{t('directory.onPlatformHint', 'Show only organizations whose team has an account on the platform')}</span>
            </>
          )}
          count={props.joinedAvailable}
        />
        {props.mineAvailable !== null && (
          <OptionRow
            type="checkbox"
            checked={props.activeMine}
            onChange={props.onMine}
            label={(
              <>
                <span className="block">{t('directory.forYourSectors', 'For your sectors')}</span>
                <span className="block text-[13px] leading-[18px] text-meta">{t('directory.forYourSectorsHint', 'Organizations working in the sectors of your organization')}</span>
              </>
            )}
            count={props.mineAvailable}
          />
        )}
      </FilterGroup>

      <FilterGroup
        index={2}
        labelId="dir-f-theme"
        title={t('directory.filters.theme', 'Theme')}
        action={props.activeTheme ? clearLink(() => props.onTheme(null)) : undefined}
      >
        <p className="mb-2 text-[13px] leading-[18px] text-meta">{props.themeHint}</p>
        <div role="radiogroup" aria-labelledby="dir-f-theme">
          <OptionRow type="radio" name="dir-theme" checked={!props.activeTheme} onChange={() => props.onTheme(null)} label={t('directory.allThemes', 'All themes')} />
          {THEMES.map((th) => {
            const count = props.themeCounts[th.key] ?? 0;
            const on = props.activeTheme?.key === th.key;
            return (
              <div key={th.key}>
                <OptionRow
                  type="radio"
                  name="dir-theme"
                  checked={on}
                  disabled={count === 0 && !on}
                  onChange={() => props.onTheme(th.key)}
                  label={props.themeLabel(th)}
                  count={count}
                />
                {on && props.themeSectors.length > 1 && (
                  <div role="radiogroup" aria-label={t('directory.filters.sectors', 'Sectors in this theme')} className="mb-1 ml-7 border-l border-rule pl-3">
                    <OptionRow type="radio" name="dir-sector" checked={!props.activeSector} onChange={() => props.onSector(null)} label={t('directory.filters.allSectors', 'Every sector in this theme')} />
                    {props.themeSectors.map((slug) => {
                      const n = props.sectorCounts[slug] ?? 0;
                      const sectorOn = props.activeSector === slug;
                      return (
                        <OptionRow
                          key={slug}
                          type="radio"
                          name="dir-sector"
                          checked={sectorOn}
                          disabled={n === 0 && !sectorOn}
                          onChange={() => props.onSector(slug)}
                          label={props.sectorLabel(slug)}
                          count={n}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </FilterGroup>

      <FilterGroup
        index={3}
        labelId="dir-f-country"
        title={t('directory.filters.country', 'Country')}
        action={props.activeCountries.length > 0 ? clearLink(props.onClearCountries) : undefined}
      >
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-meta" aria-hidden="true" />
          <input
            type="search"
            value={countryQuery}
            onChange={(e) => setCountryQuery(e.target.value)}
            placeholder={t('directory.filters.countrySearch', 'Search a country')}
            aria-label={t('directory.filters.countrySearch', 'Search a country')}
            className="h-10 w-full rounded-pill border border-rule bg-white pl-10 pr-4 text-[15px] text-ink outline-none placeholder:text-meta focus:border-navy focus-visible:shadow-focus [&::-webkit-search-cancel-button]:hidden"
          />
        </div>
        {shownCountries.length === 0 ? (
          <p className="py-2 text-sm text-meta">{t('directory.filters.countryNone', 'No country matches.')}</p>
        ) : (
          <div>
            {shownCountries.map((c) => (
              <OptionRow key={c.slug} type="checkbox" checked={c.on} onChange={() => props.onCountry(c.slug)} label={c.label} count={c.count} />
            ))}
          </div>
        )}
        {!searching && (hiddenCount > 0 || allCountries) && countries.length > COUNTRIES_SHOWN && (
          <button
            type="button"
            onClick={() => setAllCountries((v) => !v)}
            className="focus-ring mt-1 rounded-badge text-sm font-semibold text-navy underline underline-offset-[3px]"
          >
            {allCountries
              ? t('directory.filters.countryLess', 'Show fewer')
              : t('directory.filters.countryMore', { count: hiddenCount, defaultValue: 'List {{count}} more countries' })}
          </button>
        )}
      </FilterGroup>
    </div>
  );
}
