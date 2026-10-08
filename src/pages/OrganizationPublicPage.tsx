import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { externalUrl } from '@/lib/externalUrl';
import type { ReactNode, MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Seo } from '@/components/seo/Seo';
import { useSeoTr } from '@/components/seo/useSeoTr';
import { organizationMeta } from '@/lib/seoMeta';
import type { LucideIcon } from 'lucide-react';
import {
  Anchor, Award, BadgeCheck, Building2, CalendarClock, Camera, CheckCircle, ChevronLeft, ChevronRight,
  ClipboardList, Clock, ConciergeBell, Droplets, ExternalLink, GraduationCap, PencilLine, HardHat, Info, Landmark,
  Layers, Leaf, Link2, Loader2, Lock, MapPin, Newspaper, Ruler, Sailboat, Ship, Tag, Target,
  TrendingUp, Users, UtensilsCrossed, Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { CoverImage } from '@/components/ui/CoverImage';
import { SponsorBadge } from '@/components/ui/SponsorBadge';
import { BookmarkButton } from '@/components/shortlist/BookmarkButton';
import { SM26MarinaSustainability } from '@/components/organization/SM26MarinaSustainability';
import { useSM26MarinaTexts } from '@/components/organization/useSM26MarinaTexts';
import { TextTiles, type TextTileItem } from '@/components/organization/TextTiles';
import { LoginForm } from '@/components/auth/LoginForm';
import { SignupForm } from '@/components/auth/SignupForm';
import { formatCapitalRange } from '@/components/capital/InvestmentThesisSection';
import { useRegisterHeaderHero } from '@/components/layout/headerOverlay';
import { BathyPattern } from '@/components/motion/BathyPattern';
import { LineReveal } from '@/components/motion/LineReveal';
import { Reveal, RevealGroup } from '@/components/motion/Reveal';
import { Counter } from '@/components/motion/Counter';
import { useParallax } from '@/components/motion/useParallax';
import { Carousel } from '@/components/brand/Carousel';
import { CardShell, StretchedLink, type OrgTypeTone } from '@/components/brand/CardShell';
import { ContactCard } from '@/components/brand/ContactCard';
import { ClaimRequestButton } from '@/components/contact/ClaimRequestButton';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { LogoTile, OrgCard, TYPE_RGB, VerifiedBadge, orgTypeTone, seedOf } from '@/components/brand/OrgCard';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { requireFreshSession } from '@/lib/session';
import { sendNotification } from '@/lib/notifications';
import { checkSectorMatch } from '@/lib/sector-matching';
import { THEMES, getTheme, themeForSector, themesForSectors, type Theme, type ThemeKey } from '@/lib/themes';
import { accountHref } from '@/lib/accountNav';
import { boardDate } from '@/lib/boardDate';
import { cn } from '@/lib/utils';
import { withSiteSuffix } from '@/lib/seoText';
import { displayCase } from '@/lib/displayCase';
import { englishCountryName } from '@/lib/countryNames';
import { toast } from '@/hooks/use-toast';
import { HOLD_PERIODS } from '@/types/database';
import type { Organization, OrganizationMarinaDetails, Sector, OrgTier } from '@/types/database';
import { registerOrgRefonteStrings } from '@/i18n/refonte-org';

registerOrgRefonteStrings();

/**
 * The public profile of an organization, at /organizations/:slug.
 *
 * Before: a navy block with the logo, then three tabs (About, Marina details,
 * Representatives). Most of what a visitor came for — the gallery, the sectors,
 * the marinas that recommend a supplier — sat in one long "About" tab, and the
 * other two tabs only existed for verified members, so a guest saw a tab bar
 * with one tab.
 *
 * Now: the organization's own cover (or its gradient) with the logo, the facts
 * that identify it and every action in one header; then one scrolling page cut
 * into sections, with a sticky bar under the navbar that lists only the
 * sections this organization actually has, lights the one being read and jumps
 * to any of them. Sectors are grouped by the six browsing themes
 * (src/lib/themes.ts), so a profile reads with the same words as the
 * directory and the library.
 *
 * Who sees what is unchanged: marina details and the team stay reserved to
 * verified members, the connection request to verified members of another
 * organization, the shortlist to the personas BookmarkButton allows.
 *
 * Refonte v2 (Oct 2026), the directory's design: a cover (the banner, or the
 * type's gradient with sounding lines) the header overlaps, the logo straddling
 * the cover and a white identity band (type, "Verified member" for claimed pages
 * only, key facts, every action), a sticky bar of text tabs with a gold reading
 * line, numbered sections on cards that match the directory's, then related
 * articles, similar organizations as the directory's cards in a carousel, and
 * the M3 contact. Pages the M3 team listed before anyone had an account (no
 * owner) invite their marina to claim and complete them. The two extra reads
 * (articles, similar organizations) are best-effort: a failure leaves the
 * section out.
 *
 * Refonte v3 (Victor's audit, 8 Oct 2026): "a lot of text, so it should be split
 * into blocks". A shorter cover that only shows the banner when it is a real
 * picture (not the logo blown up), the facts at a glance in one row under the
 * name, one primary action by reader (sign up to contact for visitors, the
 * connection request for verified members of another company, "edit your
 * company page" for its own members; the website became a secondary link),
 * facts first (the marina's figures, an investor's terms), sectors as one chip
 * cloud, and every long text (the Smart Marina 2026 submission, the marina's
 * description and services) as tiles that open the full text (TextTiles). Names
 * typed in capitals read in title case, countries in English. A thin page says
 * so with a next step instead of leaving a void. The team is photo, name and job
 * title, with no link: people have no page of their own. A connection request
 * goes to the whole company (marina_organization_id), and any member answers.
 */

/** The section bar: 48 px tabs plus its bottom border. */
const SECTION_NAV_H = 49;
/** The header bar's height while it shows: 64 px on phones, 72 px from md (--header-full, index.css). */
function headerBand(): number {
  if (typeof document === 'undefined') return 64;
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-full'));
  return Number.isFinite(v) && v > 0 ? v : 64;
}
/** Where a section counts as "being read": just under both sticky bars. */
const spyOffset = () => headerBand() + SECTION_NAV_H + 8;
/** Same column for the cover, the identity band, the section bar and the body, so their edges line up. */
const WRAP = 'mx-auto w-full max-w-7xl px-4 sm:px-6';
const CARD = 'rounded-card border border-rule bg-white';
/** Gallery tiles shown before the "+N" tile that opens the rest in the lightbox. */
const GALLERY_TILES = 9;

interface MemberProfile {
  first_name: string | null;
  last_name: string | null;
  persona: string;
  job_title: string | null;
  avatar_url: string | null;
}

interface MemberRow {
  id: string;
  organization_id: string;
  user_id: string;
  role: string;
  joined_at: string;
  profiles: MemberProfile | null;
}

interface ConfirmedReference {
  client_legal_name: string;
  client_country: string | null;
  project_name: string | null;
  confirmed_signer_name: string | null;
  confirmed_signer_title: string | null;
  confirmed_at: string | null;
}

interface FuturePlan {
  sector_slug: string | null;
  sector_label: string;
  timeline: string;
}

/** A similar organization, with what the directory's card shows. */
interface SimilarOrg {
  id: string;
  slug: string;
  name: string;
  organization_type: string | null;
  logo_url: string | null;
  city: string | null;
  country: string | null;
  headquarters_country: string | null;
  description: string | null;
  owner_user_id: string | null;
}

/** An article of the library, with the themes its sectors touch. */
interface RelatedArticle {
  id: string;
  title: string;
  type: string;
  access_level: string;
  thumbnail_url: string | null;
  created_at: string;
  published_at: string | null;
  themes: ThemeKey[];
}

type SectionId =
  | 'about'
  | 'investment'
  | 'sectors'
  | 'gallery'
  | 'marina'
  | 'sustainability'
  | 'recommendations'
  | 'team';

const TYPE_ICON: Record<string, LucideIcon> = {
  marina: Anchor,
  partner: Building2,
  media_partner: Newspaper,
  developer: HardHat,
  investor: TrendingUp,
};

/** Only these types get a label; any other value showed nothing before and still doesn't. */
const TYPE_FALLBACK: Record<string, string> = {
  marina: 'Marina / Port',
  partner: 'Service provider',
  media_partner: 'Media',
  developer: 'Developer',
  investor: 'Investor',
};

/**
 * Future-plan timelines, stored as '0-3months' and the like. Keys are mapped to
 * plain identifiers for i18n; the tone runs from navy (now) through foam to grey
 * (years away) — one brand scale instead of five unrelated colours.
 */
const TIMELINES: Record<string, { key: string; fallback: string; tone: string }> = {
  immediate: { key: 'immediate', fallback: 'Immediate', tone: 'bg-navy text-white' },
  '0-3months': { key: 'months0to3', fallback: '0-3 months', tone: 'bg-navy/85 text-white' },
  '3-12months': { key: 'months3to12', fallback: '3-12 months', tone: 'bg-foam text-teal-text' },
  '1-3years': { key: 'years1to3', fallback: '1-3 years', tone: 'bg-chip text-meta' },
  '3+years': { key: 'years3plus', fallback: '3+ years', tone: 'bg-chip text-meta' },
};

/** "in_operation" → "In operation", for values with no translation yet. */
function humanize(value: string): string {
  const s = value.replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** A text field that would actually show something: not null, not only spaces. */
function hasText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Whether MarinaDetailsBlock would draw anything. Many verified marinas have a
 * details row with every field empty (41 on 5 Oct 2026): those get no
 * "Marina details" section, no pill in the section bar and no promise of it in
 * the members-only card. Mirrors the block's own conditions — change both
 * together.
 */
function marinaHasContent(d: OrganizationMarinaDetails | null, plans: FuturePlan[]): boolean {
  if (!d) return false;
  return !!(
    d.marina_type ||
    d.berths_count != null ||
    (d.superyacht_berths ?? 0) > 0 ||
    d.longest_berth_meters != null ||
    d.fresh_water_available ||
    d.has_yacht_club ||
    d.has_sailing_school ||
    d.has_boat_yard ||
    d.has_restaurants ||
    d.has_concierge ||
    (d.certifications?.length ?? 0) > 0 ||
    hasText(d.certifications_other) ||
    hasText(d.marina_description) ||
    hasText(d.services_description) ||
    plans.length > 0
  );
}

/**
 * Which section is being read: the first one, in page order, that crosses the
 * band between the sticky bars and the middle of the screen. Between two
 * sections (or over a tall one) it is the last section whose top has passed
 * under the bars. At the very bottom of the page the last sections can never
 * climb that high, so the last one lights up there.
 *
 * An IntersectionObserver on that band says *when* to look (sections entering
 * or leaving it, images loading and shifting the layout); a rAF-throttled
 * scroll listener covers the rest. Each time, the sections are measured afresh
 * rather than tracked from the observer's incremental entries, so a missed or
 * late notification can never leave a stale pill lit.
 *
 * Keyed on a joined string of ids, never on an array, so a re-render does not
 * tear the observer down and rebuild it. The caller passes '' while the page
 * still shows its skeleton: the sections are not in the DOM yet, and the key
 * must change when they arrive so the observer is set up on real elements.
 */
function useActiveSection(idsKey: string): string | null {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const ids = idsKey ? idsKey.split('|') : [];
    if (ids.length === 0) return;
    let offset = spyOffset();
    setActive((current) => (current && ids.includes(current) ? current : ids[0]));

    const pick = () => {
      offset = spyOffset();
      const doc = document.documentElement;
      if (window.innerHeight + window.scrollY >= doc.scrollHeight - 4) {
        setActive(ids[ids.length - 1]);
        return;
      }
      const bandBottom = window.innerHeight * 0.5;
      let inBand: string | null = null;
      let passed: string | null = null;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el || el.offsetHeight === 0) continue; // hidden: never "being read"
        const { top, bottom } = el.getBoundingClientRect();
        if (top <= offset) passed = id;
        if (!inBand && bottom > offset && top < bandBottom) inBand = id;
      }
      setActive(inBand ?? passed ?? ids[0]);
    };

    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => { frame = 0; pick(); });
    };

    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(pick, { rootMargin: `-${offset}px 0px -50% 0px`, threshold: 0 });
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el) observer.observe(el);
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    // Match the current scroll position right away (a restored scroll on Back,
    // a #hash landing), rather than waiting for the first scroll event.
    pick();
    return () => {
      observer?.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [idsKey]);

  return active;
}

export function OrganizationPublicPage() {
  const { slug } = useParams<{ slug: string }>();
  const { t } = useTranslation();
  const seoTr = useSeoTr();
  const { user, profile, organization, isVerified } = useAuth();
  const [org, setOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [marinaDetails, setMarinaDetails] = useState<OrganizationMarinaDetails | null>(null);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [futurePlans, setFuturePlans] = useState<FuturePlan[]>([]);
  const [confirmedReferences, setConfirmedReferences] = useState<ConfirmedReference[]>([]);
  const [loading, setLoading] = useState(true);
  // The read failed (network, timeout, server error): not the same as "no such
  // organization". Such a page must not tell Google to drop it (no noindex).
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  // Connect request state
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectMessage, setConnectMessage] = useState('');
  const [connectSending, setConnectSending] = useState(false);
  const [hasExistingRequest, setHasExistingRequest] = useState(false);

  // Gallery lightbox: index of the open photo, null when closed.
  const [lightbox, setLightbox] = useState<number | null>(null);

  // Visitors: "Sign up to contact …" opens the sign-up form here (and the sign-in form
  // from it), as the article pages do, rather than sending them off the page.
  const navigate = useNavigate();
  const [signupOpen, setSignupOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);

  // ------------------------------------------------------------------ data
  // Keyed on the slug (and the Retry button) only: the auth objects are
  // replaced on every tab refocus and must never re-run this (or blank the
  // page with a skeleton).
  useEffect(() => {
    if (!slug) return;
    let alive = true;
    let found = false;
    const fetchOrg = async () => {
      setLoading(true);
      setLoadFailed(false);
      // Another organization: drop the previous one's data so nothing leaks across.
      setOrg(null);
      setMembers([]);
      setMarinaDetails(null);
      setSectors([]);
      setFuturePlans([]);
      setConfirmedReferences([]);
      setLightbox(null);
      try {
        // Explicit columns, never '*': claim_code is readable by nobody but
        // staff (audit S2), and select=* on organizations is then refused for
        // anon and signed-in visitors alike.
        const { data: orgData, error: orgError } = await supabase
          .from('organizations')
          .select('id, name, slug, primary_domain, organization_type, tier, max_seats, created_by_user_id, owner_user_id, logo_url, description, website, country, city, created_at, updated_at, access_status, onboarding_status, rejection_reason, audience_description, headquarters_country, social_media_links, marina_subtype, auto_approve_domain_joins, banner_url, investment_geographies, investment_size_min, investment_size_max, investment_hold_period, investment_thesis, featured_partner, gallery, is_event_media_partner')
          .eq('slug', slug)
          .single();
        if (!alive) return;

        if (orgError) {
          if (import.meta.env.DEV) console.error('Error fetching organization:', orgError);
          // PGRST116: .single() found no row, so the organization does not
          // exist (for this reader). Anything else is a failed read.
          if (orgError.code !== 'PGRST116') setLoadFailed(true);
          setLoading(false);
          return;
        }

        if (orgData) {
          const o = orgData as Organization;
          found = true;
          setOrg(o);

          // Members with job_title
          const { data: membersData } = await supabase
            .from('organization_members')
            .select('id, organization_id, user_id, role, joined_at, profiles(first_name, last_name, persona, job_title, avatar_url)')
            .eq('organization_id', o.id)
            .order('joined_at', { ascending: true });
          if (!alive) return;
          if (membersData) setMembers(membersData as unknown as MemberRow[]);

          // Marina details if marina org
          if (o.organization_type === 'marina') {
            const { data: marinaData } = await supabase
              .from('organization_marina_details')
              .select('*')
              .eq('organization_id', o.id)
              .maybeSingle();
            if (!alive) return;
            if (marinaData) setMarinaDetails(marinaData as OrganizationMarinaDetails);
          }

          // Sectors (interest for marina/developer/investor, service for partners/media)
          const ot = o.organization_type;
          const sectorTable = (ot === 'marina' || ot === 'developer' || ot === 'investor')
            ? 'organization_interest_sectors'
            : (ot === 'partner' || ot === 'media_partner')
            ? 'organization_service_sectors'
            : null;

          if (sectorTable) {
            const { data: sectorLinks } = await supabase
              .from(sectorTable)
              .select('sector_id, sectors(id, slug, label, is_active, created_at)')
              .eq('organization_id', o.id);
            if (!alive) return;
            if (sectorLinks) {
              setSectors(
                (sectorLinks as unknown as { sector_id: string; sectors: Sector | null }[])
                  .filter((sl) => sl.sectors)
                  .map((sl) => sl.sectors as Sector),
              );
            }
          }

          // Future plans for marinas (slug too, for the French sector names)
          if (o.organization_type === 'marina') {
            const { data: plansData } = await supabase
              .from('organization_future_plans')
              .select('sector_id, timeline, sectors(slug, label)')
              .eq('organization_id', o.id);
            if (!alive) return;
            if (plansData && plansData.length > 0) {
              setFuturePlans(
                (plansData as unknown as { sector_id: string; timeline: string; sectors: { slug: string | null; label: string } | null }[])
                  .filter((p) => p.sectors)
                  .map((p) => ({ sector_slug: p.sectors!.slug ?? null, sector_label: p.sectors!.label, timeline: p.timeline })),
              );
            }
          }

          // Confirmed references for partners (the marinas that recommended them)
          if (o.organization_type === 'partner') {
            const { data: refsData } = await supabase
              .from('reference_requests')
              .select('client_legal_name, client_country, project_name, confirmed_signer_name, confirmed_signer_title, confirmed_at')
              .eq('partner_organization_id', o.id)
              .eq('status', 'confirmed')
              .order('confirmed_at', { ascending: false });
            if (!alive) return;
            if (refsData && refsData.length > 0) setConfirmedReferences(refsData as ConfirmedReference[]);
          }
        }
      } catch (err) {
        if (import.meta.env.DEV) console.error('Error loading organization:', err);
        if (alive && !found) setLoadFailed(true);
      }
      if (alive) setLoading(false);
    };
    fetchOrg();
    return () => { alive = false; };
  }, [slug, loadAttempt]);

  // Existing connect request — keyed on ids, not on the user/org objects. A request
  // is made to the company (marina_organization_id); older rows only name its owner.
  const userId = user?.id ?? null;
  const orgOwnerId = org?.owner_user_id ?? null;
  const targetOrgId = org?.id ?? null;
  useEffect(() => {
    if (!userId || !orgOwnerId || !targetOrgId) {
      setHasExistingRequest(false);
      return;
    }
    let alive = true;
    const checkExisting = async () => {
      const { data } = await supabase
        .from('partner_requests')
        .select('id')
        .eq('partner_user_id', userId)
        .or(`marina_organization_id.eq.${targetOrgId},marina_user_id.eq.${orgOwnerId}`)
        .in('status', ['pending', 'accepted'])
        .limit(1);
      if (alive) setHasExistingRequest(!!data && data.length > 0);
    };
    checkExisting();
    return () => { alive = false; };
  }, [userId, orgOwnerId, targetOrgId]);

  // Team names. RLS on profiles only lets a viewer read their own profile and
  // their co-members', so the members query above comes back with
  // `profiles: null` for anyone outside this organization, and every card read
  // "Team member". The public fields of verified people come from the
  // get_public_profiles RPC instead — the same fallback the marketplace uses.
  // Only fetched for verified viewers, the only ones who see the team.
  const [publicProfiles, setPublicProfiles] = useState<Record<string, MemberProfile>>({});
  const missingProfileIds = members.filter((m) => !m.profiles).map((m) => m.user_id).join(',');
  useEffect(() => {
    if (!isVerified || !missingProfileIds) {
      setPublicProfiles((cur) => (Object.keys(cur).length > 0 ? {} : cur));
      return;
    }
    let alive = true;
    const resolve = async () => {
      const { data, error } = await supabase.rpc('get_public_profiles', { target_user_ids: missingProfileIds.split(',') });
      if (!alive) return;
      if (error) {
        if (import.meta.env.DEV) console.error('Error resolving team profiles:', error);
        return;
      }
      const map: Record<string, MemberProfile> = {};
      for (const p of (data ?? []) as (MemberProfile & { user_id: string })[]) {
        map[p.user_id] = {
          first_name: p.first_name, last_name: p.last_name, persona: p.persona,
          job_title: p.job_title, avatar_url: p.avatar_url,
        };
      }
      setPublicProfiles(map);
    };
    resolve();
    return () => { alive = false; };
  }, [isVerified, missingProfileIds]);

  // Two extra reads once the profile is on screen: articles in this
  // organization's themes, and organizations like it. Best-effort: a failure
  // (or an organization with nothing to relate to) just leaves the section out.
  const [similar, setSimilar] = useState<SimilarOrg[]>([]);
  const [related, setRelated] = useState<RelatedArticle[]>([]);
  const extrasOrgId = org?.id ?? null;
  const extrasType = org?.organization_type ?? null;
  const extrasCountry = org?.country ?? null;
  const sectorSlugsKey = sectors.map((s) => s.slug).sort().join('|');

  useEffect(() => {
    if (loading || !extrasOrgId || !extrasType) {
      setSimilar([]);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const COLS = 'id, slug, name, organization_type, logo_url, city, country, headquarters_country, description, owner_user_id';
        const base = () => supabase
          .from('organizations')
          .select(COLS)
          .eq('access_status', 'verified')
          .eq('organization_type', extrasType)
          .neq('id', extrasOrgId);
        // Members first, then pages with a logo: the cards that look finished lead.
        const rank = (list: SimilarOrg[]) => [...list].sort(
          (a, b) => Number(!!b.owner_user_id) - Number(!!a.owner_user_id) || Number(!!b.logo_url) - Number(!!a.logo_url),
        );
        let sameCountry: SimilarOrg[] = [];
        if (extrasCountry) {
          const { data } = await base().eq('country', extrasCountry).order('created_at', { ascending: false }).limit(12);
          sameCountry = (data ?? []) as SimilarOrg[];
        }
        let rows = rank(sameCountry);
        if (rows.length < 9) {
          const { data } = await base().order('created_at', { ascending: false }).limit(30);
          const seen = new Set(rows.map((r) => r.id));
          rows = [...rows, ...rank(((data ?? []) as SimilarOrg[]).filter((r) => !seen.has(r.id)))];
        }
        if (alive) setSimilar(rows.slice(0, 9));
      } catch {
        if (alive) setSimilar([]);
      }
    })();
    return () => { alive = false; };
  }, [loading, extrasOrgId, extrasType, extrasCountry]);

  useEffect(() => {
    const orgThemes = sectorSlugsKey ? themesForSectors(sectorSlugsKey.split('|')) : [];
    if (loading || !extrasOrgId || orgThemes.length === 0) {
      setRelated([]);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('resources')
          .select('id, title, type, access_level, thumbnail_url, created_at, published_at, resource_sectors(sectors(slug))')
          .eq('published', true)
          .order('published_at', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })
          .limit(40);
        if (error) throw error;
        type Row = Omit<RelatedArticle, 'themes'> & { resource_sectors: { sectors: { slug: string | null } | null }[] | null };
        const wanted = new Set<ThemeKey>(orgThemes);
        const picked = ((data ?? []) as unknown as Row[])
          .map((r): RelatedArticle & { shared: number } => {
            const themes = themesForSectors((r.resource_sectors ?? []).map((rs) => rs.sectors?.slug));
            return { ...r, themes, shared: themes.filter((k) => wanted.has(k)).length };
          })
          .filter((r) => r.shared > 0)
          .sort((a, b) => b.shared - a.shared)
          .slice(0, 3);
        if (alive) setRelated(picked);
      } catch {
        if (alive) setRelated([]);
      }
    })();
    return () => { alive = false; };
  }, [loading, extrasOrgId, sectorSlugsKey]);

  const handleSendConnectRequest = async () => {
    if (!user || !org || !org.owner_user_id) return;
    const uid = await requireFreshSession();
    if (!uid) return;
    setConnectSending(true);
    try {
      // Sector matching gate: marinas and partners must have overlapping
      // sectors of interest / service for the connection to be relevant.
      if (organization?.id && org.id) {
        const match = await checkSectorMatch(organization.id, org.id);
        if (!match.allowed) {
          toast({
            title: t('orgProfile.connectBlockedTitle', 'Connection blocked'),
            description: match.reason || t('orgProfile.connectBlockedBody', 'No overlapping sectors between your organisation and theirs.'),
            variant: 'destructive',
          });
          setConnectSending(false);
          return;
        }
      }
      // To the whole company: marina_organization_id is what every member of it reads
      // and answers from (20261008200000_partner_requests_whole_company.sql). The owner
      // stays marina_user_id, as older clients and the e-mail expect.
      const { error } = await supabase.from('partner_requests').insert({
        partner_user_id: user.id,
        marina_user_id: org.owner_user_id,
        marina_organization_id: org.id,
        partner_organization_id: organization?.id ?? null,
        message: connectMessage.trim() || null,
        sector_id: null,
        status: 'pending',
      });
      if (error) throw error;
      // partner_name must be the REQUESTER's organization (the one initiating contact),
      // not the recipient's org. The email tells the marina who is reaching out.
      const requesterOrgName = organization?.name || [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || 'A member';
      sendNotification({ type: 'partner_request_received', userId: org.owner_user_id!, data: { partner_name: requesterOrgName, message: connectMessage.trim() } });
      toast({
        title: t('orgProfile.connectSentTitle', 'Connection request sent!'),
        description: t('orgProfile.connectSentBodyTeam', 'Your request has been sent to the team of {{name}}.', { name: displayCase(org.name) }),
      });
      setConnectOpen(false);
      setConnectMessage('');
      setHasExistingRequest(true);
    } catch (err: unknown) {
      toast({
        title: t('orgProfile.errorTitle', 'Error'),
        description: err instanceof Error ? err.message : t('orgProfile.errorBody', 'An unexpected error occurred.'),
        variant: 'destructive',
      });
    } finally {
      setConnectSending(false);
    }
  };

  const isMemberOfThisOrg = organization?.id === org?.id;
  const canConnect = user && isVerified && !isMemberOfThisOrg && !hasExistingRequest;
  const canEdit = !!organization && !!org && isMemberOfThisOrg;

  // ------------------------------------------------------------------ sections
  // Which sections this organization has. Worked out before any early return,
  // because the scroll-spy hook below needs the list.
  const orgType = org?.organization_type ?? null;
  const isMarina = orgType === 'marina';

  const gallery = useMemo(
    () => (Array.isArray(org?.gallery) ? org!.gallery : []).filter((u): u is string => typeof u === 'string' && u.trim().length > 0),
    [org],
  );

  // The marina's Smart Marina 2026 texts (tiles). The section, and its pill in the
  // section bar, only exist when there is at least one text.
  const sm26 = useSM26MarinaTexts(isMarina && org ? org.id : null);

  const showInvestment = !!org && orgType === 'investor' && !!(
    org.investment_thesis ||
    (org.investment_geographies && org.investment_geographies.length > 0) ||
    org.investment_size_min != null ||
    org.investment_size_max != null ||
    org.investment_hold_period
  );
  const showSectors = sectors.length > 0;
  const showGallery = gallery.length > 0;
  // A details row can exist with every field empty: only a row with something
  // to show earns a section (and a pill), or a mention in the members-only card.
  const marinaHasDetails = isMarina && marinaHasContent(marinaDetails, futurePlans);
  const showMarina = isVerified && marinaHasDetails;
  const showSustain = isMarina && sm26.items.length > 0;
  const showRefs = orgType === 'partner' && confirmedReferences.length > 0;
  const showTeam = isVerified && members.length > 0;

  const sectionIds: SectionId[] = org
    ? ([
        'about',
        // Facts first (the figures of a marina, an investor's thesis), then the sectors
        // and pictures, then the long texts as tiles.
        showMarina && 'marina',
        showInvestment && 'investment',
        showSectors && 'sectors',
        showGallery && 'gallery',
        showSustain && 'sustainability',
        showRefs && 'recommendations',
        showTeam && 'team',
      ].filter(Boolean) as SectionId[])
    : [];
  const sectionKey = sectionIds.join('|');
  // '' while the skeleton is up: the sections only exist once loading is over.
  const activeSection = useActiveSection(loading ? '' : sectionKey);

  // Keep the lit pill in view inside the sideways-scrolling bar on phones.
  const navScrollerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroller = navScrollerRef.current;
    if (!scroller || !activeSection || scroller.scrollWidth <= scroller.clientWidth) return;
    const link = scroller.querySelector<HTMLElement>(`[data-section="${activeSection}"]`);
    if (!link) return;
    scroller.scrollTo({
      left: Math.max(0, link.offsetLeft - (scroller.clientWidth - link.offsetWidth) / 2),
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }, [activeSection]);

  // A shared link to /organizations/x#gallery lands on the gallery once the
  // section exists (some only appear after auth or a second fetch).
  const hashHandledFor = useRef<string | null>(null);
  useEffect(() => {
    if (loading || !slug || hashHandledFor.current === slug) return;
    let id = '';
    try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { /* malformed hash: ignore it */ }
    if (!id) {
      hashHandledFor.current = slug;
      return;
    }
    if (!sectionKey.split('|').includes(id)) return;
    hashHandledFor.current = slug;
    const el = document.getElementById(id);
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }));
  }, [loading, slug, sectionKey]);

  /** Jump to a section: smooth scroll, shareable hash, and focus for keyboard users. */
  const jumpTo = useCallback((id: SectionId) => (e: ReactMouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    // Keep react-router's own history state; only the hash changes.
    window.history.replaceState(window.history.state, '', `#${id}`);
    el.querySelector<HTMLElement>('[data-section-heading]')?.focus({ preventScroll: true });
  }, []);

  /** Plural strings with an English fallback until the keys land in i18n. */
  const plural = (key: string, count: number, one: string, other: string, extra: Record<string, unknown> = {}): string =>
    t(key, { count, defaultValue: count === 1 ? one : other, ...extra }) as string;

  // The directory is public and lists every organization (/partners only the event
  // sponsors), so everyone goes back to it.
  const back = { to: '/directory', label: t('orgProfile.backToDirectory', 'Back to the directory') };

  // ------------------------------------------------------------------ loading / not found
  if (loading) {
    return (
      <div className="min-h-screen bg-page" aria-busy="true">
        <span className="sr-only" role="status">{t('common.loading', 'Loading...')}</span>
        <div className="h-[208px] animate-pulse bg-navy/90 sm:h-[240px] lg:h-[280px]" />
        <div className="border-b border-rule bg-white">
          <div className={cn(WRAP, 'flex flex-col gap-4 pb-8 sm:flex-row sm:gap-6')}>
            <div className="relative z-10 -mt-12 h-[104px] w-[104px] shrink-0 animate-pulse rounded-field bg-chip ring-4 ring-white sm:-mt-16" />
            <div className="flex-1 space-y-3 sm:pt-5">
              <div className="h-4 w-40 animate-pulse rounded bg-chip" />
              <div className="h-9 w-2/3 max-w-md animate-pulse rounded-lg bg-chip" />
              <div className="h-4 w-1/2 max-w-xs animate-pulse rounded bg-chip/70" />
            </div>
          </div>
        </div>
        <div className={cn(WRAP, 'grid gap-6 py-12 lg:grid-cols-12')}>
          <div className="h-48 animate-pulse rounded-card bg-chip/70 lg:col-span-8" />
          <div className="h-48 animate-pulse rounded-card bg-chip/70 lg:col-span-4" />
        </div>
      </div>
    );
  }

  if (!org && loadFailed) {
    // No <Seo> here: the head the edge function wrote stays as it is, so a
    // passing network error never tells Google to drop a real page.
    return (
      <StateScreen
        title={t('common.loadFailedTitle', 'This page could not be loaded')}
        body={t('common.loadFailedBody', 'The connection may be slow or interrupted. Please try again.')}
      >
        <Button asChild variant="ctaOutline" size="sm">
          <Link to={back.to}>{back.label}</Link>
        </Button>
        <Button variant="ctaNavy" size="sm" onClick={() => setLoadAttempt((n) => n + 1)}>
          {t('common.retry', 'Try again')}
        </Button>
      </StateScreen>
    );
  }

  if (!org) {
    return (
      <StateScreen
        seo={<Seo title={withSiteSuffix(t('orgProfile.notFoundTitle', 'Organisation not found'))} noindex />}
        title={t('orgProfile.notFoundTitle', 'Organisation not found')}
        body={t('orgProfile.notFoundBody', 'This organisation does not exist or has been removed.')}
      >
        <Button asChild variant="ctaOutline" size="sm">
          <Link to={back.to}>{back.label}</Link>
        </Button>
        <Button asChild variant="ctaNavy" size="sm">
          <Link to="/">{t('common.goHome', 'Go to Homepage')}</Link>
        </Button>
      </StateScreen>
    );
  }

  // ------------------------------------------------------------------ derived (org loaded)
  const TypeIcon = (orgType && TYPE_ICON[orgType]) || Building2;
  const typeLabel = orgType && TYPE_FALLBACK[orgType] ? t(`orgProfile.types.${orgType}`, TYPE_FALLBACK[orgType]) : '';
  // Shown as a reader expects: names typed in capitals in title case, countries in English.
  const name = displayCase(org.name) || org.name;
  const country = englishCountryName(org.country);
  const headquarters = englishCountryName(org.headquarters_country);
  const location = [displayCase(org.city), country].filter(Boolean).join(', ');
  const websiteHref = org.website ? externalUrl(org.website) : null;
  const membersLabel = plural('orgProfile.members', members.length, '{{count}} member', '{{count}} members');
  const recommendedLabel = plural(
    'orgProfile.recommendedBy', confirmedReferences.length,
    'Recommended by {{count}} marina', 'Recommended by {{count}} marinas',
  );
  const sectorLabel = (s: { slug: string | null; label: string }) => (s.slug ? t(`sectorNames.${s.slug}`, s.label) : s.label);

  const sectorsTitle = orgType === 'media_partner'
    ? t('orgProfile.sectors.media', 'Coverage areas')
    : orgType === 'partner'
    ? t('orgProfile.sectors.partner', 'Services & sectors')
    : orgType === 'investor'
    ? t('orgProfile.sectors.investor', 'Investment focus sectors')
    : t('orgProfile.sectors.interest', 'Sectors of interest');

  // Sectors grouped under the six themes, in theme order; anything outside a theme last.
  const sectorGroups: { key: string; theme: Theme | null; items: Sector[] }[] = [
    ...THEMES.map((theme) => ({
      key: theme.key,
      theme,
      items: theme.sectors
        .map((slugKey) => sectors.find((s) => s.slug === slugKey))
        .filter((s): s is Sector => !!s),
    })),
    { key: 'other', theme: null, items: sectors.filter((s) => !themeForSector(s.slug)) },
  ].filter((g) => g.items.length > 0);

  const navLabels: Record<SectionId, { label: string; icon: LucideIcon; count?: number }> = {
    about: { label: t('orgProfile.nav.about', 'About'), icon: Info },
    investment: { label: t('orgProfile.nav.investment', 'Investment'), icon: Target },
    sectors: {
      label: orgType === 'partner' ? t('orgProfile.nav.services', 'Services') : t('orgProfile.nav.sectors', 'Sectors'),
      icon: Layers,
      count: sectors.length,
    },
    gallery: { label: t('orgProfile.nav.gallery', 'Gallery'), icon: Camera, count: gallery.length },
    marina: { label: t('orgProfile.nav.marina', 'Marina details'), icon: Anchor },
    sustainability: { label: t('orgProfile.nav.sustainability', 'Sustainability'), icon: Leaf, count: sm26.items.length },
    recommendations: { label: t('orgProfile.nav.recommendations', 'Recommendations'), icon: Award, count: confirmedReferences.length },
    team: { label: t('orgProfile.nav.team', 'Team'), icon: Users, count: members.length },
  };

  // Imported marinas have no owner until the M3 team hands the page over: those
  // are invited to claim and complete it, and are not shown as verified members.
  const claimed = !!org.owner_user_id;
  const verifiedMember = claimed && org.access_status === 'verified';
  const tone = orgTypeTone(orgType);
  const numberOf = (id: SectionId) => String(sectionIds.indexOf(id) + 1).padStart(2, '0');

  // A thin page (a line of description, nothing else to read) used to leave a large
  // empty card under "About". It now says so calmly, with the one useful next step.
  const descriptionLength = org.description?.trim().length ?? 0;
  const thin = descriptionLength < 200 && !showGallery && !showInvestment && !showSustain && !org.audience_description;
  // Unclaimed pages carry the claim invitation: beside the text, or in the thin-page
  // block when there is one (never both).
  const showClaimCard = !claimed && !thin;
  // Claimed pages: beside the text, how to get in touch (or, for its own members,
  // keep the page up to date), so a short description never sits in an empty row.
  const touch: TouchState | null = !claimed
    ? null
    : canEdit
    ? (thin ? null : 'own') // a thin page already asks its members to complete it
    : hasExistingRequest
    ? 'sent'
    : !user
    ? 'visitor'
    : canConnect
    ? 'connect'
    : !isVerified
    ? 'unverified'
    : null;
  const aside: ReactNode = showClaimCard
    ? <ClaimCard name={name} slug={org.slug} isMarina={isMarina} />
    : touch
    ? (
      <TouchCard
        state={touch}
        name={name}
        onSignup={() => setSignupOpen(true)}
        onConnect={() => setConnectOpen(true)}
      />
    )
    : null;

  // At a glance: the identifying facts, in one row under the name (the type is
  // already the line above the name).
  const glance: { key: string; icon: LucideIcon; label: string; value: ReactNode }[] = [];
  if (location) glance.push({ key: 'location', icon: MapPin, label: t('orgProfile.fields.location', 'Location'), value: location });
  if (headquarters && headquarters !== country) {
    glance.push({ key: 'hq', icon: Landmark, label: t('orgProfile.fields.headquarters', 'Headquarters'), value: headquarters });
  }
  if (members.length > 0) glance.push({ key: 'team', icon: Users, label: t('orgProfile.fields.team', 'Team'), value: membersLabel });
  if (sectors.length > 0) {
    glance.push({
      key: 'sectors', icon: Layers, label: navLabels.sectors.label,
      value: plural('orgProfile.fields.sectorCount', sectors.length, '{{count}} sector', '{{count}} sectors'),
    });
  }
  if (showRefs) {
    glance.push({
      key: 'refs', icon: Award, label: t('orgProfile.fields.recommended', 'Recommended'),
      value: (
        <a href="#recommendations" onClick={jumpTo('recommendations')} className="focus-ring rounded-sm underline underline-offset-[3px] hover:text-teal-text">
          {plural('orgProfile.fields.refCount', confirmedReferences.length, 'by {{count}} marina', 'by {{count}} marinas')}
        </a>
      ),
    });
  }
  if (org.investment_size_min != null || org.investment_size_max != null) {
    glance.push({
      key: 'check', icon: Target, label: t('orgProfile.investment.checkSize', 'Check size'),
      value: formatCapitalRange(org.investment_size_min, org.investment_size_max),
    });
  }

  const similarTitle: Record<string, string> = {
    marina: t('orgPage.similar.titleMarina', 'Other marinas'),
    partner: t('orgPage.similar.titlePartner', 'Other service providers'),
    investor: t('orgPage.similar.titleInvestor', 'Other investors'),
    developer: t('orgPage.similar.titleDeveloper', 'Other developers'),
    media_partner: t('orgPage.similar.titleMedia', 'Other media'),
  };

  // What verification would really unlock on THIS profile, built from data the
  // page already has (members and marina details are readable before
  // verification): most marinas have no team and no details, and promising
  // either would be false. No item, no card.
  const membersOnlyItems: { key: string; icon: LucideIcon; label: string }[] = [];
  if (!isVerified) {
    if (marinaHasDetails) {
      membersOnlyItems.push({ key: 'marina', icon: Anchor, label: t('orgProfile.membersOnlyMarina', "The marina's detailed profile") });
    }
    if (members.length > 0) {
      membersOnlyItems.push({ key: 'team', icon: Users, label: t('orgProfile.membersOnlyTeam', 'The team behind {{name}}', { name }) });
    }
    if (org.owner_user_id && !isMemberOfThisOrg) {
      membersOnlyItems.push({ key: 'connect', icon: Link2, label: t('orgProfile.membersOnlyConnect', 'A direct connection request to {{name}}', { name }) });
    }
  }

  // Title ("Name — Type in City, Country", shortened until it fits in 60 characters),
  // description, canonical URL, share card and JSON-LD: the same builder as the
  // edge function that writes them into the HTML for share previews (src/lib/seoMeta.ts).
  const seo = organizationMeta(org, seoTr);

  // The one primary action, by who is reading: a visitor is invited to sign up to
  // contact the company (only a claimed page has someone to contact), a verified
  // member of another company sends a connection request, the company's own members
  // edit the page. The website is a secondary link: it sends people off the platform.
  const primaryAction: ReactNode = canEdit ? (
    <Button asChild variant="cta">
      <Link to={accountHref('organization')}>{t('orgProfile.editPage', 'Edit your company page')}</Link>
    </Button>
  ) : !user && claimed ? (
    <Button variant="cta" onClick={() => setSignupOpen(true)}>
      {t('orgProfile.signupToContact', 'Sign up to contact {{name}}', { name })}
    </Button>
  ) : canConnect && org.owner_user_id ? (
    <Button variant="cta" onClick={() => setConnectOpen(true)}>
      {t('orgProfile.connect', 'Request to connect')}
    </Button>
  ) : null;

  return (
    <div className="min-h-screen bg-page">
      <Seo {...seo} />

      {/* ── Cover: the organization's banner when it is a real picture, else its type's gradient with sounding lines ── */}
      <ProfileCover
        id={org.id}
        name={name}
        bannerUrl={org.banner_url}
        logoUrl={org.logo_url}
        icon={TypeIcon}
        tone={tone}
        back={back}
        alt={t('orgProfile.coverAlt', '{{name}} cover image', { name })}
      />

      {/* ── Identity: logo over the cover, type, verification, the name, every action, then the facts at a glance ── */}
      <header className="border-b border-rule bg-white">
        <div className={cn(WRAP, 'pb-8 lg:pb-10')}>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-7">
            <LogoTile
              src={org.logo_url}
              name={name}
              type={orgType}
              size={112}
              className="relative z-10 -mt-14 ring-4 ring-white shadow-[0_12px_32px_rgba(11,38,83,.16)] sm:-mt-[72px]"
            />

            <div className="min-w-0 flex-1 sm:pt-5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                {typeLabel && (
                  <span className="flex items-center gap-2 text-[13px] font-semibold uppercase leading-4 tracking-[0.08em] text-meta">
                    <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-pill" style={{ background: TYPE_RGB[tone] }} />
                    {typeLabel}
                  </span>
                )}
                {verifiedMember && <VerifiedBadge />}
                {org.access_status === 'pending' && (
                  <span className="inline-flex items-center gap-1 rounded-badge bg-amber-50 px-1.5 py-0.5 text-[12px] font-semibold leading-4 text-amber-900">
                    <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('orgProfile.pending', 'Verification in progress')}
                  </span>
                )}
                <SponsorBadge tier={org.tier as OrgTier} size="md" />
              </div>

              <h1 className="mt-2 break-words text-h1-sm text-navy sm:text-h1">{name}</h1>
              {location && glance.length === 0 && (
                <p className="mt-2 inline-flex items-center gap-1.5 text-[15px] leading-6 text-ink">
                  <MapPin className="h-4 w-4 text-meta" aria-hidden="true" />
                  {location}
                </p>
              )}

              {/* Actions — same permission checks as before. Connecting also needs an
                  owner: an unclaimed organization (no owner_user_id) can never receive
                  a request, so nothing about connecting is shown there at all. */}
              <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
                {primaryAction}
                {hasExistingRequest && (
                  <span className="inline-flex min-h-11 items-center gap-1.5 rounded-pill bg-foam px-4 text-sm font-semibold text-teal-text">
                    <CheckCircle className="h-4 w-4" aria-hidden="true" />
                    {t('orgProfile.requestSent', 'Connection request sent')}
                  </span>
                )}
                <BookmarkButton
                  organizationId={org.id}
                  organizationName={name}
                  variant="full"
                  className="h-11 rounded-pill border-rule px-4 text-navy"
                />
                {websiteHref && (
                  <UnderlineLink href={websiteHref} external className="!text-[15px]">
                    {t('orgProfile.visitWebsite', 'Visit website')}
                  </UnderlineLink>
                )}
              </div>
              {canEdit && (
                <p className="mt-3 text-[13px] leading-[18px] text-meta">{t('orgProfile.ownPage', "This is your organisation's public page.")}</p>
              )}
            </div>
          </div>

          {/* At a glance: the identifying facts in one row. */}
          {glance.length > 0 && (
            <dl
              aria-label={t('orgProfile.atAGlance', 'At a glance')}
              className="mt-8 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-rule pt-6 sm:grid-cols-3 lg:grid-cols-6"
            >
              {glance.map((g) => (
                <div key={g.key} className="min-w-0">
                  <dt className="flex items-center gap-1.5 text-meta-caps">
                    <g.icon className="h-4 w-4 shrink-0 text-teal" aria-hidden="true" />
                    {g.label}
                  </dt>
                  <dd className="mt-1 break-words text-[15px] font-semibold leading-6 text-navy">{g.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </header>

      {/* ── Section bar: sticky under the header (it rises when the header tucks away), sideways on phones ── */}
      {sectionIds.length > 1 && (
        <nav
          aria-label={t('orgProfile.sectionNav', 'Profile sections')}
          className="sticky top-16 z-30 border-b border-rule bg-white/95 backdrop-blur-md"
        >
          <div ref={navScrollerRef} className={cn(WRAP, 'no-scrollbar relative flex gap-1 overflow-x-auto')}>
            {sectionIds.map((id) => {
              const item = navLabels[id];
              const active = activeSection === id;
              return (
                <a
                  key={id}
                  href={`#${id}`}
                  data-section={id}
                  onClick={jumpTo(id)}
                  aria-current={active ? 'location' : undefined}
                  className={cn(
                    'relative inline-flex h-12 shrink-0 items-center gap-2 whitespace-nowrap px-3.5 text-sm transition-colors duration-300',
                    'after:absolute after:inset-x-3.5 after:bottom-0 after:h-0.5 after:origin-left after:scale-x-0 after:bg-gold after:transition-transform after:duration-300',
                    'focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_rgb(11_38_83)]',
                    active ? 'font-semibold text-navy after:scale-x-100' : 'font-medium text-meta hover:text-navy',
                  )}
                >
                  {item.label}
                  {item.count !== undefined && item.count > 0 && (
                    <span className="tabular text-xs font-normal text-meta">{item.count}</span>
                  )}
                </a>
              );
            })}
          </div>
        </nav>
      )}

      {/* ── Body ── */}
      <div className={cn(WRAP, 'flex flex-col gap-16 py-12 md:gap-20 md:py-16')}>
        {/* About */}
        <ProfileSection id="about" number={numberOf('about')} label={navLabels.about.label} title={t('orgProfile.aboutTitle', 'About {{name}}', { name })}>
          <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
            <div className={cn(CARD, 'p-6 md:p-8', aside ? 'lg:col-span-8' : 'lg:col-span-12')}>
              {hasText(org.description) ? (
                <p className="max-w-[72ch] whitespace-pre-wrap text-body text-ink">{org.description}</p>
              ) : (
                <p className="text-meta">{t('orgProfile.noDescription', '{{name}} has not added a description yet.', { name })}</p>
              )}
              {/* Audience description (media organizations) */}
              {org.audience_description && (
                <div className="mt-6 max-w-[72ch] border-t border-rule pt-6">
                  <h3 className="mb-2 text-card-title text-navy">{t('orgProfile.audience', 'Audience')}</h3>
                  <p className="whitespace-pre-wrap text-body text-ink">{org.audience_description}</p>
                </div>
              )}
              {thin && (
                <ThinPageNote
                  name={name}
                  slug={org.slug}
                  own={canEdit}
                  claimed={claimed}
                  isMarina={isMarina}
                />
              )}
            </div>
            {aside && <div className="lg:col-span-4">{aside}</div>}
          </div>
        </ProfileSection>

        {/* Marina details (verified members only): the figures first, then the texts as tiles */}
        {showMarina && marinaDetails && (
          <ProfileSection id="marina" number={numberOf('marina')} label={navLabels.marina.label} title={t('orgProfile.marina.title', 'Marina details')}>
            <MarinaDetailsBlock details={marinaDetails} futurePlans={futurePlans} sectorLabel={sectorLabel} />
          </ProfileSection>
        )}

        {/* Investment — public on investor profiles: the terms first, then the thesis */}
        {showInvestment && (
          <ProfileSection id="investment" number={numberOf('investment')} label={navLabels.investment.label} title={t('orgProfile.investment.title', 'Investment thesis')}>
            <div className={cn(CARD, 'p-6 md:p-8')}>
              {((org.investment_geographies && org.investment_geographies.length > 0) || org.investment_size_min != null || org.investment_size_max != null || org.investment_hold_period) && (
                <dl className={cn('grid gap-6 sm:grid-cols-3', org.investment_thesis && 'mb-6 border-b border-rule pb-6')}>
                  {(org.investment_size_min != null || org.investment_size_max != null) && (
                    <div>
                      <dt className="text-meta-caps mb-2">{t('orgProfile.investment.checkSize', 'Check size')}</dt>
                      <dd className="text-[24px] font-semibold leading-8 text-navy">{formatCapitalRange(org.investment_size_min, org.investment_size_max)}</dd>
                    </div>
                  )}
                  {org.investment_hold_period && (
                    <div>
                      <dt className="text-meta-caps mb-2">{t('orgProfile.investment.holdPeriod', 'Hold period')}</dt>
                      <dd className="text-[24px] font-semibold leading-8 text-navy">
                        {t(
                          `orgProfile.holdPeriods.${org.investment_hold_period}`,
                          HOLD_PERIODS.find((h) => h.value === org.investment_hold_period)?.label ?? org.investment_hold_period,
                        )}
                      </dd>
                    </div>
                  )}
                  {org.investment_geographies && org.investment_geographies.length > 0 && (
                    <div>
                      <dt className="text-meta-caps mb-2">{t('orgProfile.investment.geographies', 'Geographies')}</dt>
                      <dd className="flex flex-wrap gap-1.5">
                        {org.investment_geographies.map((g) => (
                          <span key={g} className="inline-flex h-7 items-center rounded-pill bg-chip px-3 text-[13px] font-medium text-navy">{g}</span>
                        ))}
                      </dd>
                    </div>
                  )}
                </dl>
              )}
              {org.investment_thesis && (
                <p className="max-w-[72ch] whitespace-pre-wrap text-body text-ink">{org.investment_thesis}</p>
              )}
            </div>
          </ProfileSection>
        )}

        {/* Sectors: one chip cloud, a row per theme */}
        {showSectors && (
          <ProfileSection id="sectors" number={numberOf('sectors')} label={navLabels.sectors.label} title={sectorsTitle} count={sectors.length}>
            <ul className={cn(CARD, 'divide-y divide-rule')}>
              {sectorGroups.map((g) => {
                const Icon = g.theme?.icon ?? Tag;
                const label = g.theme ? t(g.theme.labelKey, g.theme.fallback) : t('orgProfile.sectors.other', 'Other sectors');
                return (
                  <li key={g.key} className="flex flex-col gap-3 p-5 md:flex-row md:items-start md:gap-6 md:p-6">
                    <h3 className="flex shrink-0 items-center gap-2.5 text-[15px] font-semibold leading-6 text-navy md:w-64">
                      <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-field bg-foam text-teal">
                        <Icon className="h-4 w-4" />
                      </span>
                      {label}
                    </h3>
                    <ul className="flex flex-wrap gap-2">
                      {g.items.map((s) => (
                        <li key={s.id} className="inline-flex h-8 items-center rounded-pill bg-chip px-3.5 text-sm font-medium text-navy">
                          {sectorLabel(s)}
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </ProfileSection>
        )}

        {/* Gallery */}
        {showGallery && (
          <ProfileSection id="gallery" number={numberOf('gallery')} label={navLabels.gallery.label} title={t('orgProfile.gallery.title', 'Gallery')} count={gallery.length}>
            <div className={cn('grid gap-2 sm:gap-3', gallery.length >= 5 ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4' : 'grid-cols-2 sm:grid-cols-4')}>
              {gallery.slice(0, GALLERY_TILES).map((url, i) => {
                const feature = i === 0 && gallery.length >= 5;
                const moreTile = i === GALLERY_TILES - 1 && gallery.length > GALLERY_TILES;
                const remaining = gallery.length - (GALLERY_TILES - 1);
                return (
                  <button
                    key={`${url}-${i}`}
                    type="button"
                    onClick={() => setLightbox(i)}
                    aria-label={moreTile
                      ? plural('orgProfile.gallery.showAll', gallery.length, 'Show all {{count}} photos', 'Show all {{count}} photos')
                      : t('orgProfile.gallery.open', 'Open photo {{n}} of {{total}}', { n: i + 1, total: gallery.length })}
                    className={cn(
                      'group relative aspect-square overflow-hidden rounded-card bg-chip',
                      'focus:outline-none focus-visible:shadow-focus',
                      feature && 'col-span-2 row-span-2',
                    )}
                  >
                    <CoverImage
                      src={url}
                      alt=""
                      seed={`${org.id}-gallery-${i}`}
                      icon={Camera}
                      aspect="fill"
                      tone="sea"
                      imageClassName="[transition-duration:800ms] ease-out-smc group-hover:scale-105"
                    />
                    {moreTile && (
                      <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center bg-[#0b2653]/70 text-2xl font-semibold text-white">
                        +{remaining}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </ProfileSection>
        )}

        {/* Smart Marina 2026 sustainability texts, as tiles */}
        {showSustain && (
          <ProfileSection
            id="sustainability"
            number={numberOf('sustainability')}
            label={navLabels.sustainability.label}
            title={t('orgProfile.sm26.title', 'Sustainability & innovation')}
            count={sm26.items.length}
          >
            <SM26MarinaSustainability items={sm26.items} />
          </ProfileSection>
        )}

        {/* Recommended by — confirmed marina references for partners */}
        {showRefs && (
          <ProfileSection id="recommendations" number={numberOf('recommendations')} label={navLabels.recommendations.label} title={recommendedLabel}>
            <p className="-mt-2 mb-6 max-w-prose text-[15px] leading-6 text-ink">
              {t('orgProfile.recommendedByDesc', 'These marinas have confirmed working with {{name}} and recommend their services.', { name })}
            </p>
            <ul className="grid gap-4 sm:grid-cols-2">
              {confirmedReferences.map((ref, idx) => (
                <li key={idx} className={cn(CARD, 'flex items-start gap-4 p-5')}>
                  <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-pill bg-foam text-teal">
                    <BadgeCheck className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-card-title text-navy">{displayCase(ref.client_legal_name)}</p>
                    <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-meta">
                      {ref.client_country && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" aria-hidden="true" /> {englishCountryName(ref.client_country)}
                        </span>
                      )}
                      {ref.project_name && (
                        <span>
                          {t('orgProfile.project', 'Project')}: <span className="text-ink">{ref.project_name}</span>
                        </span>
                      )}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </ProfileSection>
        )}

        {/* Team (verified members only): photo, name and job title. People have no page of their own. */}
        {showTeam && (
          <ProfileSection id="team" number={numberOf('team')} label={navLabels.team.label} title={t('orgProfile.team.title', 'Team')} count={members.length}>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4">
              {members.map((member) => {
                const person = member.profiles ?? publicProfiles[member.user_id] ?? null;
                const fullName = displayCase(`${person?.first_name || ''} ${person?.last_name || ''}`.trim());
                return (
                  <li key={member.id} className="flex">
                    <TeamCard
                      name={fullName || t('orgProfile.team.memberFallback', 'Team member')}
                      initialsFrom={fullName}
                      jobTitle={person?.job_title ?? null}
                      avatarUrl={person?.avatar_url ?? null}
                    />
                  </li>
                );
              })}
            </ul>
          </ProfileSection>
        )}

        {/* What a verified member would also get here — only what this profile really has. */}
        {membersOnlyItems.length > 0 && (
          <div className={cn(CARD, 'flex flex-col gap-5 p-6 sm:flex-row sm:items-center md:p-8')}>
            <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-pill bg-foam text-teal">
              <Lock className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-card-title text-navy">{t('orgProfile.membersOnlyTitle', 'More for verified members')}</h2>
              <p className="mt-1 text-sm text-meta">{t('orgProfile.membersOnlyIntro', 'Verified members also get:')}</p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {membersOnlyItems.map((item) => (
                  <li key={item.key} className="inline-flex max-w-full items-center gap-1.5 rounded-pill bg-chip px-3.5 py-1.5 text-sm font-medium text-navy">
                    <item.icon className="h-4 w-4 shrink-0 text-teal" aria-hidden="true" />
                    <span className="min-w-0 break-words">{item.label}</span>
                  </li>
                ))}
              </ul>
            </div>
            {user ? (
              <Button asChild variant="ctaNavy" size="sm" className="shrink-0">
                <Link to={accountHref('dashboard')}>{t('orgProfile.checkStatus', 'Check your account status')}</Link>
              </Button>
            ) : (
              <Button variant="ctaNavy" size="sm" className="shrink-0" onClick={() => setSignupOpen(true)}>
                {t('orgProfile.join', 'Sign up')}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* ── Related articles: the library's latest pieces in this organization's themes ── */}
      {related.length > 0 && (
        <section aria-labelledby="org-related-heading" className="border-t border-rule bg-page pb-16 pt-14 md:pb-24 md:pt-20">
          <div className={WRAP}>
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
              <div>
                <Reveal>
                  <Eyebrow>{t('orgPage.related.eyebrow', 'Reading')}</Eyebrow>
                </Reveal>
                <LineReveal as="h2" id="org-related-heading" className="mt-3 text-h2-sm text-navy md:text-h2">
                  {t('orgPage.related.title', 'Related articles')}
                </LineReveal>
              </div>
              <Reveal delay={120}>
                <UnderlineLink to="/resources">{t('orgPage.related.all', 'All resources')}</UnderlineLink>
              </Reveal>
            </div>
            <RevealGroup as="ul" className="mt-8 grid gap-5 md:grid-cols-3 md:gap-6">
              {related.map((r) => (
                <li key={r.id} className="flex">
                  <ArticleCard resource={r} />
                </li>
              ))}
            </RevealGroup>
          </div>
        </section>
      )}

      {/* ── Similar organizations, as the directory's cards in a carousel ── */}
      {similar.length > 0 && (
        <section aria-labelledby="org-similar-heading" className="border-t border-rule bg-white py-14 md:py-20">
          <div className={WRAP}>
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
              <div>
                <Reveal>
                  <Eyebrow>{t('orgPage.similar.eyebrow', 'Keep exploring')}</Eyebrow>
                </Reveal>
                <LineReveal as="h2" id="org-similar-heading" className="mt-3 text-h2-sm text-navy md:text-h2">
                  {(orgType && similarTitle[orgType]) || t('orgPage.similar.titleOther', 'Similar organisations')}
                </LineReveal>
              </div>
              <Reveal delay={120}>
                <UnderlineLink to={orgType && TYPE_FALLBACK[orgType] ? `/directory?type=${orgType}` : '/directory'}>
                  {t('orgPage.similar.all', 'See them all in the directory')}
                </UnderlineLink>
              </Reveal>
            </div>
            <Reveal className="mt-8">
              <Carousel label={t('orgPage.similar.label', 'Similar organisations')} slideClassName="w-[86%] sm:w-[46%] lg:w-[31.5%]">
                {similar.map((o) => (
                  <OrgCard
                    key={o.id}
                    id={o.id}
                    name={displayCase(o.name) || o.name}
                    href={`/organizations/${o.slug}`}
                    type={o.organization_type}
                    logoUrl={o.logo_url}
                    city={displayCase(o.city) || null}
                    country={englishCountryName(o.country ?? o.headquarters_country) || null}
                    description={o.description}
                    verified={!!o.owner_user_id}
                    className="w-full"
                  />
                ))}
              </Carousel>
            </Reveal>
          </div>
        </section>
      )}

      {/* ── The M3 contact ── */}
      <section aria-labelledby="org-contact-heading" className="bg-page pb-16 pt-14 md:pb-24 md:pt-20">
        <div className={cn(WRAP, 'grid gap-8 lg:grid-cols-12 lg:items-center lg:gap-12')}>
          <div className="lg:col-span-6">
            <Reveal>
              <Eyebrow>{t('brand.contact.eyebrow', 'Contact')}</Eyebrow>
            </Reveal>
            <LineReveal as="h2" id="org-contact-heading" className="mt-3 text-h2-sm text-navy md:text-h2">
              {t('orgPage.contact.title', 'Questions about this page?')}
            </LineReveal>
            <Reveal as="p" delay={120} className="mt-4 max-w-[520px] text-body text-ink">
              {t('orgPage.contact.line', 'Something to correct on this page, or a question about the network? Write to the team.')}
            </Reveal>
          </div>
          <Reveal delay={120} className="lg:col-span-5 lg:col-start-8">
            <ContactCard />
          </Reveal>
        </div>
      </section>

      <GalleryLightbox
        images={gallery}
        index={lightbox}
        onIndex={setLightbox}
        onClose={() => setLightbox(null)}
        name={name}
      />

      {/* Connect Request Dialog */}
      <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
        <DialogContent className="max-w-md rounded-card">
          <DialogHeader>
            <DialogTitle className="text-navy">{t('orgProfile.connectTitle', 'Request to connect')}</DialogTitle>
            <DialogDescription>
              {t('orgProfile.connectDescTeam', 'Your request goes to everyone in the {{name}} team; any of them can answer.', { name })}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="connect-message">{t('orgProfile.connectMessage', 'Message (optional)')}</Label>
              <Textarea
                id="connect-message"
                value={connectMessage}
                onChange={(e) => setConnectMessage(e.target.value)}
                placeholder={t('orgProfile.connectPlaceholder', "Introduce yourself and explain why you'd like to connect...")}
                rows={4}
              />
            </div>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
              <Button variant="ctaOutline" size="sm" arrow={false} onClick={() => setConnectOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
              <Button variant="cta" size="sm" roll={!connectSending} arrow={!connectSending} onClick={handleSendConnectRequest} disabled={connectSending}>
                {connectSending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                {t('orgProfile.connectSend', 'Send request')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Visitors: sign up (or sign in) without leaving the page */}
      <Dialog open={signupOpen} onOpenChange={setSignupOpen}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto rounded-card">
          <DialogHeader>
            <DialogTitle className="text-navy">{t('orgProfile.signupTitle', 'Sign up to contact {{name}}', { name })}</DialogTitle>
            <DialogDescription>
              {t('orgProfile.signupIntro', 'Create your free account. Once the M3 team has checked it, you can send {{name}} a connection request.', { name })}{' '}
              {t('auth.haveAccount', 'Already have an account?')}{' '}
              <button type="button" className="font-semibold text-navy underline underline-offset-[3px]" onClick={() => { setSignupOpen(false); setLoginOpen(true); }}>
                {t('auth.login', 'Log In')}
              </button>
            </DialogDescription>
          </DialogHeader>
          <SignupForm onSuccess={() => { setSignupOpen(false); navigate('/onboarding'); }} />
        </DialogContent>
      </Dialog>
      <Dialog open={loginOpen} onOpenChange={setLoginOpen}>
        <DialogContent className="max-w-md rounded-card">
          <DialogHeader>
            <DialogTitle className="text-navy">{t('auth.login', 'Log In')}</DialogTitle>
            <DialogDescription>
              {t('auth.noAccount', "Don't have an account?")}{' '}
              <button type="button" className="font-semibold text-navy underline underline-offset-[3px]" onClick={() => { setLoginOpen(false); setSignupOpen(true); }}>
                {t('auth.signup', 'Sign up')}
              </button>
            </DialogDescription>
          </DialogHeader>
          <LoginForm onSuccess={() => setLoginOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─── Pieces ─────────────────────────────────────────────────────── */

/** Nothing to show: the page could not be loaded, or the organization does not exist. */
function StateScreen({ seo, title, body, children }: { seo?: ReactNode; title: string; body: string; children: ReactNode }) {
  return (
    <div className="min-h-[70vh] bg-page px-4 py-16 sm:px-6 md:py-24">
      {seo}
      <div className="mx-auto max-w-lg rounded-card border border-rule bg-white px-6 py-12 text-center sm:px-10">
        <span aria-hidden="true" className="mx-auto grid h-16 w-16 place-items-center rounded-pill bg-foam text-teal">
          <Building2 className="h-7 w-7" strokeWidth={1.75} />
        </span>
        <h1 className="mt-6 text-h2-sm text-navy">{title}</h1>
        <p className="mt-2 text-[15px] leading-6 text-meta">{body}</p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">{children}</div>
      </div>
    </div>
  );
}

/** The cover gradient of each organization type, as on the directory's cards. */
const COVER_BG: Record<OrgTypeTone, string> = {
  marina: 'linear-gradient(135deg, #0b2653, #1f7a8c)',
  provider: 'linear-gradient(135deg, #0b2653, #1f7a8c)',
  investor: 'linear-gradient(135deg, #0b2653, #4a6fa5)',
  media: 'linear-gradient(135deg, #1e293b, #64748b)',
};

/** A banner narrower than this is a logo or a thumbnail stretched over the page: not used. */
const MIN_COVER_WIDTH = 960;
/** Nor a square-ish picture (a logo uploaded as a banner): a cover is clearly wider than tall. */
const MIN_COVER_RATIO = 1.3;

/** Same file, whatever the query string (cache busters, signed parameters). */
function sameImage(a: string, b: string): boolean {
  return a.split('?')[0] === b.split('?')[0];
}

/**
 * The banner, only once it has proved to be a real cover picture: loaded, at least
 * MIN_COVER_WIDTH wide and landscape, and not the logo again. Until then (and for
 * good when it fails) the page shows the designed cover of the organisation's type.
 * Ayla Marina's "banner" was its 517 x 312 logo, blown up and blurred across the
 * screen (Victor's audit, Oct 2026).
 */
function useRealCover(bannerUrl: string | null, logoUrl: string | null): string | null {
  const [cover, setCover] = useState<string | null>(null);
  useEffect(() => {
    setCover(null);
    if (!bannerUrl || (logoUrl && sameImage(bannerUrl, logoUrl))) return;
    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      const w = img.naturalWidth;
      const h = Math.max(1, img.naturalHeight);
      if (w >= MIN_COVER_WIDTH && w / h >= MIN_COVER_RATIO) setCover(bannerUrl);
    };
    img.src = bannerUrl;
    return () => {
      alive = false;
      img.onload = null;
    };
  }, [bannerUrl, logoUrl]);
  return cover;
}

/**
 * The top of a profile: the organization's own banner when it is a real cover
 * picture (settling and lagging behind the page like every banner of the site),
 * else its type's gradient with sounding lines drifting slowly and the type's icon
 * watermarked in. A marine veil keeps the breadcrumb readable over any photo, and
 * on phones the way back sits on a solid navy chip (white words over a light
 * photo were hard to read). It registers with the header like PageHero does: the
 * header overlaps it and turns solid on scroll. The logo, name and actions sit on
 * the white band below; the logo straddles the two. Shorter than before (Oct 2026):
 * the name and the facts come sooner.
 */
function ProfileCover({
  id, name, bannerUrl, logoUrl, icon: Icon, tone, back, alt,
}: {
  id: string;
  name: string;
  bannerUrl: string | null;
  logoUrl: string | null;
  icon: LucideIcon;
  tone: OrgTypeTone;
  back: { to: string; label: string };
  alt: string;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLElement>(null);
  const mediaRef = useRef<HTMLDivElement>(null);
  const overlaid = useRegisterHeaderHero(ref, true);
  useParallax(mediaRef, { mode: 'page', max: 40 });
  const seed = seedOf(id);
  const cover = useRealCover(bannerUrl, logoUrl);

  return (
    <section ref={ref} className="relative isolate min-h-[208px] overflow-hidden bg-navy text-white sm:min-h-[240px] lg:min-h-[280px]">
      <div ref={mediaRef} aria-hidden={cover ? undefined : true} className="hero-media-layer absolute inset-x-0 -top-10 bottom-0 -z-30">
        <div className="absolute inset-0" style={{ background: COVER_BG[tone] }}>
          <BathyPattern seed={seed} rings={8} opacity={0.12} drift className="absolute -inset-4" />
          <Icon aria-hidden="true" className="absolute bottom-8 right-[8%] h-36 w-36 text-white/[.08]" strokeWidth={1.25} />
        </div>
        {cover && (
          <CoverImage src={cover} alt={alt} seed={id} icon={Icon} aspect="fill" tone="sea" eager className="absolute inset-0" imageClassName="hero-settle" />
        )}
      </div>
      <div aria-hidden="true" className="absolute inset-0 -z-20 bg-[linear-gradient(180deg,rgba(8,29,64,.82)_0%,rgba(11,38,83,.4)_55%,rgba(11,38,83,.55)_100%)]" />

      <div className={cn(WRAP, 'relative z-10 pb-16', overlaid ? 'pt-[84px] md:pt-[100px]' : 'pt-6')}>
        <nav aria-label={t('orgPage.crumbsLabel', 'Breadcrumb')} className="hidden text-[14px] leading-5 text-white/85 md:block">
          <ol className="flex flex-wrap items-center gap-2">
            <li className="flex items-center gap-2">
              <UnderlineLink to="/" tone="light" plain arrow={false} className="!text-[14px] !font-normal">{t('nav.home', 'Home')}</UnderlineLink>
              <span aria-hidden="true">/</span>
            </li>
            <li className="flex items-center gap-2">
              <UnderlineLink to={back.to} tone="light" plain arrow={false} className="!text-[14px] !font-normal">{t('nav.directory', 'Directory')}</UnderlineLink>
              <span aria-hidden="true">/</span>
            </li>
            <li aria-current="page" className="max-w-[420px] truncate text-white">{name}</li>
          </ol>
        </nav>
        {/* Phones: one link back instead of the whole trail, on a solid chip. */}
        <div className="md:hidden">
          <Link
            to={back.to}
            className="inline-flex min-h-9 items-center gap-1 rounded-pill bg-navy/85 py-1.5 pl-2.5 pr-3.5 text-[14px] font-medium text-white shadow-[0_2px_10px_rgba(8,29,64,.35)] ring-1 ring-inset ring-white/20 backdrop-blur-sm focus:outline-none focus-visible:shadow-focus"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            {back.label}
          </Link>
        </div>
      </div>
    </section>
  );
}

/**
 * "Is this your marina? Claim this page": for organizations the M3 team listed
 * before anyone had an account. The button opens a small request form (name,
 * e-mail, role) that reaches the M3 team through the contact-submit function;
 * the team checks every request before handing the page over.
 */
function ClaimCard({ name, slug, isMarina }: { name: string; slug: string; isMarina: boolean }) {
  const { t } = useTranslation();
  return (
    <aside aria-labelledby="org-claim-heading" className="relative isolate overflow-hidden rounded-[24px] bg-navy p-6 text-white md:p-7">
      <BathyPattern seed={7} drift className="absolute inset-0 -z-10" />
      <Eyebrow tone="onDark">{t('orgPage.claim.eyebrow', 'Listed by M3')}</Eyebrow>
      <h2 id="org-claim-heading" className="mt-3 text-[22px] font-semibold leading-7">
        {isMarina ? t('orgPage.claim.titleMarina', 'Is this your marina? Claim this page') : t('orgPage.claim.titleOther', 'Is this your company? Claim this page')}
      </h2>
      <p className="mt-3 text-[15px] leading-6 text-white/85">
        {isMarina
          ? t('orgPage.claim.bodyMarina', 'The M3 team listed {{name}} before it had an account. Claim the page to complete it and keep it up to date: the M3 team checks every request before handing the page over.', { name })
          : t('orgPage.claim.bodyOther', 'The M3 team listed {{name}} before it had an account. Claim the page to complete it and keep it up to date: the M3 team checks every request before handing it over.', { name })}
      </p>
      <div className="mt-6 flex items-center gap-4">
        <span aria-hidden="true" className="grid h-14 w-14 shrink-0 place-items-center rounded-pill bg-teal text-[18px] font-semibold tracking-[0.02em] text-white shadow-[0_0_0_4px_rgba(255,255,255,.14)]">
          VM
        </span>
        <div>
          <p className="text-base font-semibold leading-[22px]">Victor Meyer</p>
          <p className="mt-0.5 text-sm leading-5 text-white/80">M3 Monaco</p>
        </div>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
        <ClaimRequestButton organization={{ name, slug }} variant="ctaWhite" size="sm">
          {t('orgPage.claim.cta', 'Claim this page')}
        </ClaimRequestButton>
        <UnderlineLink to="/contact" tone="light">{t('orgPage.claim.question', 'Ask a question')}</UnderlineLink>
      </div>
    </aside>
  );
}

/** One article of the library, as on the home page: a 3:2 picture, theme and date, the title, the type. */
function ArticleCard({ resource: r }: { resource: RelatedArticle }) {
  const { t } = useTranslation();
  const theme = getTheme(r.themes[0]);
  const locked = r.access_level && r.access_level !== 'public';
  return (
    <CardShell interactive className="w-full min-w-0 p-4">
      <div className="card-media relative aspect-[3/2] overflow-hidden rounded-[12px]">
        <CoverImage
          src={r.thumbnail_url || theme?.image || null}
          focusY={r.thumbnail_url ? 0.5 : theme?.imageFocusY ?? 0.5}
          alt=""
          seed={r.id}
          icon={theme?.icon ?? Newspaper}
          aspect="fill"
          tone="sea"
        />
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 text-[12px] font-medium uppercase leading-4 tracking-[0.06em] text-meta">
        {theme ? (
          <span className="flex min-w-0 items-center gap-2">
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-teal" />
            <span className="truncate">{t(theme.labelKey, theme.fallback)}</span>
          </span>
        ) : (
          <span />
        )}
        <span className="tabular shrink-0">{boardDate(r.published_at || r.created_at, 'en-GB')}</span>
      </div>
      <h3 lang="en" className="mt-2 text-[18px] font-semibold leading-[26px] text-navy">
        <StretchedLink to={`/resources/${r.id}`} className="line-clamp-3 rounded-sm">
          {r.title}
        </StretchedLink>
      </h3>
      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        <span className="inline-flex h-6 items-center rounded-full bg-chip px-2.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-navy">
          {t(`resources.types.${r.type}`, r.type)}
        </span>
        {locked && (
          <span className="inline-flex h-6 items-center gap-1 rounded-full bg-chip px-2.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-navy">
            <Lock className="h-3 w-3" aria-hidden="true" />
            {t(`resources.accessLevels.${r.access_level}`, r.access_level)}
          </span>
        )}
      </div>
    </CardShell>
  );
}

/**
 * One section of the profile: a numbered eyebrow, the title and the content.
 * scroll-mt-36 (144 px) lands its top just under the header and the section bar
 * after a jump; the heading takes focus then, so keyboard and screen-reader
 * users carry on from where they jumped.
 */
function ProfileSection({
  id, number, label, title, count, children,
}: {
  id: SectionId;
  number: string;
  label: string;
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <Reveal as="section" id={id} aria-labelledby={`${id}-title`} className="scroll-mt-36">
      <Eyebrow number={number}>{label}</Eyebrow>
      <h2
        id={`${id}-title`}
        tabIndex={-1}
        data-section-heading
        className="mt-3 flex min-w-0 flex-wrap items-center gap-x-3 break-words text-h2-sm text-navy focus:outline-none md:text-h2"
      >
        {title}
        {count !== undefined && count > 0 && (
          <span className="tabular inline-flex h-7 items-center rounded-pill bg-chip px-2.5 text-[13px] font-medium text-navy">{count}</span>
        )}
      </h2>
      <div className="mt-6 md:mt-8">{children}</div>
    </Reveal>
  );
}

type TouchState = 'own' | 'sent' | 'visitor' | 'connect' | 'unverified';

/**
 * Beside "About" on a claimed page: how to get in touch with the company, by who is
 * reading. A request reaches everyone in its team (any of them answers), which is
 * said here once. Its own members get the way to keep the page up to date.
 */
function TouchCard({
  state, name, onSignup, onConnect,
}: {
  state: TouchState;
  name: string;
  onSignup: () => void;
  onConnect: () => void;
}) {
  const { t } = useTranslation();
  const copy: Record<TouchState, { title: string; body: string }> = {
    own: {
      title: t('orgProfile.touch.ownTitle', 'Your company page'),
      body: t('orgProfile.touch.ownBody', 'Keep it up to date: description, sectors, photos and team are how other members find you.'),
    },
    sent: {
      title: t('orgProfile.touch.sentTitle', 'Request sent'),
      body: t('orgProfile.touch.sentBody', 'Everyone in the {{name}} team has received your request. When one of them accepts, M3 introduces you by e-mail.', { name }),
    },
    visitor: {
      title: t('orgProfile.touch.title', 'Get in touch with {{name}}', { name }),
      body: t('orgProfile.touch.visitorBody', 'Sign up for free to send a connection request. It reaches everyone in their team, and M3 introduces you by e-mail once they accept.'),
    },
    connect: {
      title: t('orgProfile.touch.title', 'Get in touch with {{name}}', { name }),
      body: t('orgProfile.touch.connectBody', 'Your request reaches everyone in their team; any of them can answer. Once accepted, M3 introduces you by e-mail.'),
    },
    unverified: {
      title: t('orgProfile.touch.title', 'Get in touch with {{name}}', { name }),
      body: t('orgProfile.touch.unverifiedBody', 'Once the M3 team has checked your account, you can send {{name}} a connection request.', { name }),
    },
  };
  const Icon = state === 'own' ? PencilLine : state === 'sent' ? CheckCircle : Link2;
  return (
    <aside aria-labelledby="org-touch-heading" className={cn(CARD, 'p-6 md:p-7')}>
      <span aria-hidden="true" className="grid h-11 w-11 place-items-center rounded-pill bg-foam text-teal">
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <h2 id="org-touch-heading" className="mt-4 text-card-title text-navy">{copy[state].title}</h2>
      <p className="mt-2 text-[15px] leading-6 text-ink">{copy[state].body}</p>
      <div className="mt-5">
        {state === 'own' && (
          <Button asChild variant="ctaNavy" size="sm">
            <Link to={accountHref('organization')}>{t('orgProfile.editPageShort', 'Edit the page')}</Link>
          </Button>
        )}
        {state === 'visitor' && (
          <Button variant="cta" size="sm" onClick={onSignup}>{t('orgProfile.touch.signup', 'Sign up for free')}</Button>
        )}
        {state === 'connect' && (
          <Button variant="cta" size="sm" onClick={onConnect}>{t('orgProfile.connect', 'Request to connect')}</Button>
        )}
        {state === 'unverified' && (
          <UnderlineLink to={accountHref('dashboard')} className="!text-[14px]">{t('orgProfile.checkStatus', 'Check your account status')}</UnderlineLink>
        )}
      </div>
    </aside>
  );
}

/**
 * A page with little more than a line of description: said calmly, with the one
 * useful next step. Its own members complete it; on a page the M3 team listed
 * (no owner yet) anyone can claim it or write to M3; on a claimed page, readers
 * can write to M3.
 */
function ThinPageNote({
  name, slug, own, claimed, isMarina,
}: {
  name: string;
  slug: string;
  own: boolean;
  claimed: boolean;
  isMarina: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-6 flex flex-col gap-4 rounded-field bg-page p-5 sm:flex-row sm:items-center md:p-6">
      <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-pill bg-white text-teal ring-1 ring-inset ring-rule">
        <PencilLine className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[16px] font-semibold leading-6 text-navy">
          {own
            ? t('orgProfile.thin.titleOwn', "Your company's page is not complete yet")
            : t('orgProfile.thin.title', "This company hasn't completed its page yet")}
        </p>
        <p className="mt-1 text-[14px] leading-5 text-meta">
          {own
            ? t('orgProfile.thin.bodyOwn', 'Add a description, your sectors, photos and your team: members find you through them.')
            : claimed
            ? t('orgProfile.thin.body', 'More about {{name}} will appear here as the team completes the page.', { name })
            : isMarina
            ? t('orgProfile.thin.bodyUnclaimedMarina', 'The M3 team listed {{name}}. Is it your marina? Claim the page to complete it.', { name })
            : t('orgProfile.thin.bodyUnclaimed', 'The M3 team listed {{name}}. Is it your company? Claim the page to complete it.', { name })}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-3">
        {own ? (
          <Button asChild variant="ctaNavy" size="sm">
            <Link to={accountHref('organization')}>{t('orgProfile.thin.complete', 'Complete your page')}</Link>
          </Button>
        ) : (
          <>
            {!claimed && (
              <ClaimRequestButton organization={{ name, slug }} variant="ctaNavy" size="sm">
                {t('orgPage.claim.cta', 'Claim this page')}
              </ClaimRequestButton>
            )}
            <UnderlineLink to="/contact" className="!text-[14px]">{t('orgProfile.thin.contact', 'Contact M3')}</UnderlineLink>
          </>
        )}
      </div>
    </div>
  );
}

/** One person of the team: photo (or initials), name, job title. No link: people have no page of their own. */
function TeamCard({
  name, initialsFrom, jobTitle, avatarUrl,
}: {
  name: string;
  initialsFrom: string;
  jobTitle: string | null;
  avatarUrl: string | null;
}) {
  const initials = initialsFrom
    ? initialsFrom.split(/\s+/).filter(Boolean).map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : '';
  return (
    <CardShell as="div" className="w-full items-center p-5 text-center">
      {avatarUrl ? (
        <img src={avatarUrl} alt="" loading="lazy" className="h-20 w-20 shrink-0 rounded-pill object-cover ring-2 ring-rule" />
      ) : (
        <span aria-hidden="true" className="grid h-20 w-20 shrink-0 place-items-center rounded-pill bg-teal text-[22px] font-semibold tracking-[0.02em] text-white">
          {initials || <Users className="h-7 w-7" strokeWidth={1.75} />}
        </span>
      )}
      <p className="mt-4 w-full break-words text-[16px] font-semibold leading-[22px] text-navy">{name}</p>
      {jobTitle && <p className="mt-1 w-full break-words text-sm leading-5 text-meta">{jobTitle}</p>}
    </CardShell>
  );
}

/**
 * The marina's own details (verified members only), facts first: the big figures
 * (berths, superyacht berths, longest berth, certifications) and the status, the
 * certifications and the facilities as chips, then the marina's two texts as tiles
 * (TextTiles: "Read more" opens the full text) and the development plans.
 * marinaHasContent() decides whether this gets rendered at all and mirrors the
 * conditions below — change both together.
 */
function MarinaDetailsBlock({
  details, futurePlans, sectorLabel,
}: {
  details: OrganizationMarinaDetails;
  futurePlans: FuturePlan[];
  sectorLabel: (s: { slug: string | null; label: string }) => string;
}) {
  const { t } = useTranslation();

  const certifications = [
    ...(details.certifications ?? []).filter((c) => hasText(c)),
    ...(hasText(details.certifications_other) ? [details.certifications_other.trim()] : []),
  ];

  // Big figures: only the ones that exist.
  const figures: { key: string; icon: LucideIcon; label: string; value: number; suffix?: string }[] = [];
  if (details.berths_count != null) {
    figures.push({ key: 'berths', icon: Anchor, label: t('orgProfile.marina.berths', 'Berths'), value: details.berths_count });
  }
  if (details.superyacht_berths != null && details.superyacht_berths > 0) {
    figures.push({ key: 'superyacht', icon: Ship, label: t('orgProfile.marina.superyachtBerths', 'Superyacht berths'), value: details.superyacht_berths });
  }
  if (details.longest_berth_meters != null) {
    figures.push({ key: 'longest', icon: Ruler, label: t('orgProfile.marina.longestBerth', 'Longest berth'), value: details.longest_berth_meters, suffix: ' m' });
  }
  if (certifications.length > 0) {
    figures.push({
      key: 'certs', icon: Award, value: certifications.length,
      label: certifications.length === 1 ? t('orgProfile.marina.certification', 'Certification') : t('orgProfile.marina.certificationsCount', 'Certifications'),
    });
  }

  // marina_type holds where the marina stands ("in_operation", "in_project"…): a status.
  const status = details.marina_type ? t(`orgProfile.marinaTypes.${details.marina_type}`, humanize(details.marina_type)) : '';

  const facilities: { key: string; icon: LucideIcon; label: string }[] = [];
  if (details.has_boat_yard) facilities.push({ key: 'yard', icon: Wrench, label: t('orgProfile.marina.boatYard', 'Boat yard') });
  if (details.has_concierge) facilities.push({ key: 'concierge', icon: ConciergeBell, label: t('orgProfile.marina.concierge', 'Concierge service') });
  if (details.has_restaurants) {
    facilities.push({
      key: 'food', icon: UtensilsCrossed,
      label: details.restaurants_count && details.restaurants_count > 1
        ? t('orgProfile.marina.restaurants', 'Restaurants ({{n}})', { n: details.restaurants_count })
        : t('orgProfile.marina.restaurant', 'Restaurant'),
    });
  }
  if (details.fresh_water_available) facilities.push({ key: 'water', icon: Droplets, label: t('orgProfile.marina.freshWater', 'Fresh water') });
  if (details.has_yacht_club) {
    facilities.push({
      key: 'club', icon: Sailboat,
      label: details.yacht_club_members
        ? t('orgProfile.marina.yachtClubMembers', 'Yacht club ({{n}} members)', { n: details.yacht_club_members })
        : t('orgProfile.marina.yachtClub', 'Yacht club'),
    });
  }
  if (details.has_sailing_school) facilities.push({ key: 'school', icon: GraduationCap, label: t('orgProfile.marina.sailingSchool', 'Sailing school') });

  // Sorted by the name the reader sees.
  const planLabel = (p: FuturePlan) => sectorLabel({ slug: p.sector_slug, label: p.sector_label });
  const plans = [...futurePlans].sort((a, b) => planLabel(a).localeCompare(planLabel(b)));

  const texts: TextTileItem[] = [];
  if (hasText(details.marina_description)) {
    texts.push({ key: 'about', title: t('orgProfile.marina.aboutMarina', 'About the marina'), text: details.marina_description, icon: Anchor });
  }
  if (hasText(details.services_description)) {
    texts.push({ key: 'services', title: t('orgProfile.marina.services', 'Services'), text: details.services_description, icon: ClipboardList });
  }

  // Hairlines between the figures, whatever the number of columns (2 on phones).
  const cols = figures.length >= 4 ? 4 : figures.length;
  const figureCell = (i: number) => cn(
    'border-rule p-5 md:p-6',
    i % 2 === 1 && 'border-l',
    i >= 2 && 'border-t',
    cols === 3 && 'sm:border-t-0',
    cols === 3 && i > 0 && 'sm:border-l',
    cols === 4 && 'lg:border-t-0',
    cols === 4 && i > 0 && 'lg:border-l',
  );

  return (
    <div className="flex flex-col gap-6">
      {(figures.length > 0 || status) && (
        <div className={cn(CARD, 'overflow-hidden')}>
          {figures.length > 0 && (
            <ul className={cn('grid grid-cols-2', cols === 3 && 'sm:grid-cols-3', cols === 4 && 'lg:grid-cols-4')}>
              {figures.map((f, i) => (
                <li key={f.key} className={figureCell(i)}>
                  <f.icon className="h-5 w-5 text-teal" aria-hidden="true" />
                  <p className="mt-3 text-[36px] font-semibold leading-10 tracking-[-0.02em] text-navy md:text-[44px] md:leading-[48px]">
                    <Counter value={f.value} suffix={f.suffix} />
                  </p>
                  <p className="mt-1 text-meta-caps">{f.label}</p>
                </li>
              ))}
            </ul>
          )}
          {status && (
            <p className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 px-5 py-3.5 text-[15px] text-ink md:px-6', figures.length > 0 && 'border-t border-rule bg-page')}>
              <CheckCircle className="h-4 w-4 shrink-0 text-teal" aria-hidden="true" />
              <span className="text-meta-caps">{t('orgProfile.marina.status', 'Status')}</span>
              <span className="font-semibold text-navy">{status}</span>
            </p>
          )}
        </div>
      )}

      {(certifications.length > 0 || facilities.length > 0) && (
        <div className={cn('grid gap-6', certifications.length > 0 && facilities.length > 0 && 'lg:grid-cols-2')}>
          {certifications.length > 0 && (
            <div className={cn(CARD, 'p-6')}>
              <h3 className="mb-4 text-card-title text-navy">{t('orgProfile.marina.certifications', 'Certifications')}</h3>
              <ul className="flex flex-wrap gap-2">
                {certifications.map((cert) => (
                  <li key={cert} className="inline-flex items-center gap-1.5 rounded-pill bg-chip px-3.5 py-1.5 text-sm font-medium text-navy">
                    <Award className="h-4 w-4 text-teal" aria-hidden="true" />
                    {cert}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {facilities.length > 0 && (
            <div className={cn(CARD, 'p-6')}>
              <h3 className="mb-4 text-card-title text-navy">{t('orgProfile.marina.facilities', 'Facilities & services')}</h3>
              <ul className="flex flex-wrap gap-2">
                {facilities.map((f) => (
                  <li key={f.key} className="inline-flex items-center gap-2 rounded-pill bg-foam py-1.5 pl-1.5 pr-3.5 text-sm font-medium text-navy">
                    <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-pill bg-white text-teal">
                      <f.icon className="h-4 w-4" />
                    </span>
                    {f.label}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {texts.length > 0 && <TextTiles items={texts} source={t('orgProfile.marina.title', 'Marina details')} className="lg:grid-cols-2" />}

      {plans.length > 0 && (
        <div className={cn(CARD, 'p-6')}>
          <h3 className="mb-4 flex items-center gap-2 text-card-title text-navy">
            <CalendarClock className="h-4 w-4 text-teal" aria-hidden="true" />
            {t('orgProfile.marina.futurePlans', 'Future development plans')}
          </h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {plans.map((plan) => {
              const tl = TIMELINES[plan.timeline];
              return (
                <li key={`${plan.sector_label}-${plan.timeline}`} className="flex items-center justify-between gap-3 rounded-field bg-page px-3 py-2">
                  <span className="min-w-0 text-sm font-medium text-navy">{planLabel(plan)}</span>
                  <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold', tl?.tone ?? 'bg-chip text-meta')}>
                    {tl ? t(`orgProfile.timelines.${tl.key}`, tl.fallback) : plan.timeline}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * The gallery's full-screen viewer: arrows (on screen and on the keyboard),
 * swipe on phones, and a link to the original file, which is what the old
 * grid of plain links offered.
 */
function GalleryLightbox({
  images, index, onIndex, onClose, name,
}: {
  images: string[];
  index: number | null;
  onIndex: (i: number) => void;
  onClose: () => void;
  name: string;
}) {
  const { t } = useTranslation();
  const total = images.length;
  const open = index !== null && total > 0;
  const current = index !== null ? Math.min(Math.max(index, 0), Math.max(total - 1, 0)) : 0;

  const go = useCallback((delta: number) => {
    if (index === null || total < 2) return;
    onIndex((index + delta + total) % total);
  }, [index, total, onIndex]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, go]);

  const touchX = useRef<number | null>(null);
  const onTouchStart = (e: ReactTouchEvent) => { touchX.current = e.touches[0]?.clientX ?? null; };
  const onTouchEnd = (e: ReactTouchEvent) => {
    const start = touchX.current;
    touchX.current = null;
    const end = e.changedTouches[0]?.clientX;
    if (start == null || end == null) return;
    const dx = end - start;
    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
  };

  const src = open ? images[current] : null;
  const closeBtn =
    '[&>button:last-child]:right-2 [&>button:last-child]:top-2 [&>button:last-child]:z-10 [&>button:last-child]:flex ' +
    '[&>button:last-child]:h-10 [&>button:last-child]:w-10 [&>button:last-child]:items-center [&>button:last-child]:justify-center ' +
    '[&>button:last-child]:rounded-full [&>button:last-child]:bg-black/60 [&>button:last-child]:opacity-100 [&>button:last-child]:hover:bg-black/80';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className={cn('w-[calc(100vw-1rem)] max-w-5xl gap-0 overflow-hidden rounded-card border-0 bg-gray-950 p-0 text-white sm:rounded-card', closeBtn)}>
        <DialogTitle className="sr-only">{t('orgProfile.gallery.lightboxTitle', 'Photos of {{name}}', { name })}</DialogTitle>
        <div
          className="relative flex min-h-[40vh] items-center justify-center bg-black"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {src && (
            <img
              key={src}
              src={src}
              alt={t('orgProfile.gallery.photoAlt', '{{name}}, photo {{n}} of {{total}}', { name, n: current + 1, total })}
              className="max-h-[75vh] w-auto max-w-full object-contain"
            />
          )}
          {total > 1 && (
            <>
              <button
                type="button"
                onClick={() => go(-1)}
                aria-label={t('orgProfile.gallery.prev', 'Previous photo')}
                className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <ChevronLeft className="h-6 w-6" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                aria-label={t('orgProfile.gallery.next', 'Next photo')}
                className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <ChevronRight className="h-6 w-6" aria-hidden="true" />
              </button>
            </>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-2 text-sm text-white/80">
          <span className="tabular-nums" aria-live="polite">{current + 1} / {total}</span>
          {src && (
            <a
              href={src}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-white/90 transition-colors hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              {t('orgProfile.gallery.original', 'Open original')}
              <span className="sr-only"> {t('orgProfile.newTab', '(opens in a new tab)')}</span>
            </a>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
