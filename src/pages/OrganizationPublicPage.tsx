import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { ReactNode, MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet-async';
import type { LucideIcon } from 'lucide-react';
import {
  Anchor, Award, BadgeCheck, Building2, CalendarClock, Camera, CheckCircle, ChevronLeft, ChevronRight,
  Clock, Droplets, ExternalLink, Globe, GraduationCap, HardHat, Info, Landmark, Layers, Leaf, Link2,
  Loader2, Lock, MapPin, Newspaper, Pencil, Ruler, ShieldCheck, Ship, Sparkles, Tag, Target,
  TrendingUp, Users, UtensilsCrossed, Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { CoverImage, LogoBadge } from '@/components/ui/CoverImage';
import { SponsorBadge } from '@/components/ui/SponsorBadge';
import { BookmarkButton } from '@/components/shortlist/BookmarkButton';
import { SM26MarinaSustainability } from '@/components/organization/SM26MarinaSustainability';
import { formatCapitalRange } from '@/components/capital/InvestmentThesisSection';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { requireFreshSession } from '@/lib/session';
import { sendNotification } from '@/lib/notifications';
import { checkSectorMatch } from '@/lib/sector-matching';
import { THEMES, themeForSector, type Theme } from '@/lib/themes';
import { accountHref } from '@/lib/accountNav';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { HOLD_PERIODS } from '@/types/database';
import type { Organization, OrganizationMarinaDetails, Sector, OrgTier } from '@/types/database';

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
 */

/** The navbar is sticky and 64 px tall. */
const NAVBAR_H = 64;
/** The section bar: py-2 around 40 px pills, plus its bottom border. */
const SECTION_NAV_H = 57;
/** Where a section counts as "being read": just under both sticky bars. */
const SPY_OFFSET = NAVBAR_H + SECTION_NAV_H + 8;
/** Same column for the header, the section bar and the body, so their edges line up. */
const WRAP = 'mx-auto w-full max-w-6xl px-4';
const CARD = 'rounded-2xl bg-white shadow-sm ring-1 ring-gray-100';
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
  partner: 'Partner',
  media_partner: 'Media',
  developer: 'Developer',
  investor: 'Investor',
};

/**
 * Future-plan timelines, stored as '0-3months' and the like. Keys are mapped to
 * plain identifiers for i18n; the tone runs from gold (now) through navy to grey
 * (years away) — one brand scale instead of five unrelated colours.
 */
const TIMELINES: Record<string, { key: string; fallback: string; tone: string }> = {
  immediate: { key: 'immediate', fallback: 'Immediate', tone: 'bg-secondary text-primary' },
  '0-3months': { key: 'months0to3', fallback: '0-3 months', tone: 'bg-primary text-white' },
  '3-12months': { key: 'months3to12', fallback: '3-12 months', tone: 'bg-primary/10 text-primary' },
  '1-3years': { key: 'years1to3', fallback: '1-3 years', tone: 'bg-gray-100 text-gray-700' },
  '3+years': { key: 'years3plus', fallback: '3+ years', tone: 'bg-gray-100 text-gray-700' },
};

/** "in_operation" → "In operation", for values with no translation yet. */
function humanize(value: string): string {
  const s = value.replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
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
    setActive((current) => (current && ids.includes(current) ? current : ids[0]));

    const pick = () => {
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
        if (top <= SPY_OFFSET) passed = id;
        if (!inBand && bottom > SPY_OFFSET && top < bandBottom) inBand = id;
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
      observer = new IntersectionObserver(pick, { rootMargin: `-${SPY_OFFSET}px 0px -50% 0px`, threshold: 0 });
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
  const { user, profile, organization, isVerified } = useAuth();
  const [org, setOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [marinaDetails, setMarinaDetails] = useState<OrganizationMarinaDetails | null>(null);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [futurePlans, setFuturePlans] = useState<FuturePlan[]>([]);
  const [confirmedReferences, setConfirmedReferences] = useState<ConfirmedReference[]>([]);
  const [loading, setLoading] = useState(true);

  // Connect request state
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectMessage, setConnectMessage] = useState('');
  const [connectSending, setConnectSending] = useState(false);
  const [hasExistingRequest, setHasExistingRequest] = useState(false);

  // Gallery lightbox: index of the open photo, null when closed.
  const [lightbox, setLightbox] = useState<number | null>(null);

  // ------------------------------------------------------------------ data
  // Keyed on the slug only: the auth objects are replaced on every tab
  // refocus and must never re-run this (or blank the page with a skeleton).
  useEffect(() => {
    if (!slug) return;
    let alive = true;
    const fetchOrg = async () => {
      setLoading(true);
      // Another organization: drop the previous one's data so nothing leaks across.
      setOrg(null);
      setMembers([]);
      setMarinaDetails(null);
      setSectors([]);
      setFuturePlans([]);
      setConfirmedReferences([]);
      setLightbox(null);
      try {
        const { data: orgData, error: orgError } = await supabase
          .from('organizations')
          .select('*')
          .eq('slug', slug)
          .single();
        if (!alive) return;

        if (orgError) {
          if (import.meta.env.DEV) console.error('Error fetching organization:', orgError);
          setLoading(false);
          return;
        }

        if (orgData) {
          const o = orgData as Organization;
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
      }
      if (alive) setLoading(false);
    };
    fetchOrg();
    return () => { alive = false; };
  }, [slug]);

  // Existing connect request — keyed on ids, not on the user/org objects.
  const userId = user?.id ?? null;
  const orgOwnerId = org?.owner_user_id ?? null;
  useEffect(() => {
    if (!userId || !orgOwnerId) {
      setHasExistingRequest(false);
      return;
    }
    let alive = true;
    const checkExisting = async () => {
      const { data } = await supabase
        .from('partner_requests')
        .select('id')
        .eq('partner_user_id', userId)
        .eq('marina_user_id', orgOwnerId)
        .in('status', ['pending', 'accepted'])
        .maybeSingle();
      if (alive) setHasExistingRequest(!!data);
    };
    checkExisting();
    return () => { alive = false; };
  }, [userId, orgOwnerId]);

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
            description: match.reason || t('orgProfile.connectBlockedBody', 'No overlapping sectors between your organization and theirs.'),
            variant: 'destructive',
          });
          setConnectSending(false);
          return;
        }
      }
      const { error } = await supabase.from('partner_requests').insert({
        partner_user_id: user.id,
        marina_user_id: org.owner_user_id,
        message: connectMessage.trim() || null,
        sector_id: null,
        status: 'pending',
      });
      if (error) throw error;
      // partner_name must be the REQUESTER's organization (the one initiating contact),
      // not the recipient's org. The email tells the marina who is reaching out.
      const requesterOrgName = organization?.name || [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || 'A partner';
      sendNotification({ type: 'partner_request_received', userId: org.owner_user_id!, data: { partner_name: requesterOrgName, message: connectMessage.trim() } });
      toast({
        title: t('orgProfile.connectSentTitle', 'Connection request sent!'),
        description: t('orgProfile.connectSentBody', 'Your request has been sent to {{name}}.', { name: org.name }),
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

  // The SM26 sustainability block fetches its own data and renders nothing when
  // there is none. Watching its wrapper tells us whether it drew anything, so
  // the section bar never offers a link to an empty section.
  const [sustainVisible, setSustainVisible] = useState(false);
  const sustainObserver = useRef<MutationObserver | null>(null);
  const sustainRef = useCallback((el: HTMLDivElement | null) => {
    sustainObserver.current?.disconnect();
    sustainObserver.current = null;
    if (!el) {
      setSustainVisible(false);
      return;
    }
    const check = () => setSustainVisible(el.childElementCount > 0);
    check();
    const mo = new MutationObserver(check);
    mo.observe(el, { childList: true });
    sustainObserver.current = mo;
  }, []);

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
  const showSustain = isMarina && sustainVisible;
  const showRefs = orgType === 'partner' && confirmedReferences.length > 0;
  const showTeam = isVerified && members.length > 0;

  const sectionIds: SectionId[] = org
    ? ([
        'about',
        showInvestment && 'investment',
        showSectors && 'sectors',
        showGallery && 'gallery',
        showMarina && 'marina',
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

  // Signed-in members go back to the directory; guests to the public partner list.
  const back = user
    ? { to: '/directory', label: t('orgProfile.backToDirectory', 'Back to the directory') }
    : { to: '/partners', label: t('orgProfile.backToPartners', 'All partners') };

  // ------------------------------------------------------------------ loading / not found
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50" aria-busy="true">
        <span className="sr-only" role="status">{t('common.loading', 'Loading...')}</span>
        <div className="h-36 animate-pulse bg-gray-200 sm:h-48 lg:h-64" />
        <div className="border-b border-gray-200 bg-white">
          <div className={cn(WRAP, 'flex flex-col gap-4 pb-6 sm:flex-row sm:gap-6')}>
            <div className="relative z-10 -mt-10 h-20 w-20 shrink-0 animate-pulse rounded-2xl bg-gray-300 ring-4 ring-white sm:-mt-14 sm:h-28 sm:w-28" />
            <div className="flex-1 space-y-3 sm:pt-4">
              <div className="h-7 w-2/3 max-w-sm animate-pulse rounded-lg bg-gray-200" />
              <div className="h-4 w-1/2 max-w-xs animate-pulse rounded bg-gray-100" />
              <div className="flex gap-2 pt-1">
                <div className="h-10 w-36 animate-pulse rounded-xl bg-gray-100" />
                <div className="h-10 w-28 animate-pulse rounded-xl bg-gray-100" />
              </div>
            </div>
          </div>
        </div>
        <div className={cn(WRAP, 'grid gap-6 py-10 lg:grid-cols-3')}>
          <div className={cn(CARD, 'h-48 animate-pulse lg:col-span-2')} />
          <div className={cn(CARD, 'h-48 animate-pulse')} />
        </div>
      </div>
    );
  }

  if (!org) {
    return (
      <div className="min-h-[60vh] bg-gray-50">
        <div className={cn(WRAP, 'py-20 text-center')}>
          <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-gray-100">
            <Building2 className="h-10 w-10 text-gray-400" aria-hidden="true" />
          </div>
          <h1 className="mb-2 text-2xl font-bold text-gray-900">{t('orgProfile.notFoundTitle', 'Organization not found')}</h1>
          <p className="mb-6 text-gray-600">{t('orgProfile.notFoundBody', 'This organization does not exist or has been removed.')}</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button asChild variant="outline" className="rounded-xl">
              <Link to={back.to}>
                <ChevronLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {back.label}
              </Link>
            </Button>
            <Button asChild className="rounded-xl">
              <Link to="/">{t('common.goHome', 'Go to Homepage')}</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------ derived (org loaded)
  const TypeIcon = (orgType && TYPE_ICON[orgType]) || Building2;
  const typeLabel = orgType && TYPE_FALLBACK[orgType] ? t(`orgProfile.types.${orgType}`, TYPE_FALLBACK[orgType]) : '';
  const location = [org.city, org.country].filter(Boolean).join(', ');
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
    sustainability: { label: t('orgProfile.nav.sustainability', 'Sustainability'), icon: Leaf },
    recommendations: { label: t('orgProfile.nav.recommendations', 'Recommendations'), icon: Award, count: confirmedReferences.length },
    team: { label: t('orgProfile.nav.team', 'Team'), icon: Users, count: members.length },
  };

  const hasFacts = !!(typeLabel || location || org.headquarters_country || org.website || members.length > 0);

  // What verification would really unlock on THIS profile, built from data the
  // page already has (members and marina details are readable before
  // verification): most marinas have no team and no details, and promising
  // either would be false. No item, no card.
  const membersOnlyItems: { key: string; icon: LucideIcon; label: string }[] = [];
  if (!isVerified) {
    if (members.length > 0) {
      membersOnlyItems.push({ key: 'team', icon: Users, label: t('orgProfile.membersOnlyTeam', 'The team behind {{name}}', { name: org.name }) });
    }
    if (marinaHasDetails) {
      membersOnlyItems.push({ key: 'marina', icon: Anchor, label: t('orgProfile.membersOnlyMarina', "The marina's detailed profile") });
    }
    if (org.owner_user_id && !isMemberOfThisOrg) {
      membersOnlyItems.push({ key: 'connect', icon: Link2, label: t('orgProfile.membersOnlyConnect', 'A direct connection request to {{name}}', { name: org.name }) });
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet>
        <title>{org.name} — Smart Marina Connect</title>
        <meta name="description" content={org.description || `${org.name} on Smart Marina Connect — B2B platform for the marina industry.`} />
        <meta property="og:title" content={`${org.name} — Smart Marina Connect`} />
        <meta property="og:description" content={org.description || ''} />
      </Helmet>

      {/* ── Header: cover band, logo, identity, actions ── */}
      <header className="border-b border-gray-200 bg-white">
        <CoverImage
          src={org.banner_url}
          alt={org.banner_url ? t('orgProfile.coverAlt', '{{name}} cover image', { name: org.name }) : ''}
          seed={org.id}
          icon={TypeIcon}
          aspect="fill"
          tone="sea"
          eager
          className="h-36 sm:h-48 lg:h-64"
        >
          <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-[#0b2653]/60 via-[#0b2653]/10 to-[#0b2653]/30" />
          <div className="absolute inset-x-0 top-0">
            <div className={cn(WRAP, 'pt-3 sm:pt-4')}>
              <Link
                to={back.to}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-black/30 px-3.5 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-black/45 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                {back.label}
              </Link>
            </div>
          </div>
        </CoverImage>

        <div className={cn(WRAP, 'pb-6')}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
            <LogoBadge
              src={org.logo_url}
              name={org.name}
              size="lg"
              className="relative z-10 -mt-10 h-20 w-20 rounded-2xl text-2xl shadow-md ring-4 ring-white sm:-mt-14 sm:h-28 sm:w-28 sm:text-3xl"
            />

            <div className="min-w-0 flex-1 sm:pt-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h1 className="break-words text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">{org.name}</h1>
                <SponsorBadge tier={org.tier as OrgTier} size="md" />
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-600">
                {typeLabel && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/5 px-2.5 py-1 text-xs font-semibold text-primary">
                    <TypeIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    {typeLabel}
                  </span>
                )}
                {org.access_status === 'verified' && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('orgProfile.verified', 'Verified organization')}
                  </span>
                )}
                {org.access_status === 'pending' && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
                    <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('orgProfile.pending', 'Verification in progress')}
                  </span>
                )}
                {location && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-4 w-4 text-gray-500" aria-hidden="true" />
                    {location}
                  </span>
                )}
                {members.length > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-4 w-4 text-gray-500" aria-hidden="true" />
                    {membersLabel}
                  </span>
                )}
                {showRefs && (
                  <a
                    href="#recommendations"
                    onClick={jumpTo('recommendations')}
                    className="inline-flex items-center gap-1 rounded font-medium text-gray-800 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <Award className="h-4 w-4 text-secondary-dark" aria-hidden="true" />
                    {recommendedLabel}
                  </a>
                )}
              </div>

              {/* Actions — same permission checks as before. The connect button
                  also needs an owner to send the request to: an unclaimed
                  organization (no owner_user_id) can never receive one, so
                  nothing about connecting is shown there at all. */}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {canConnect && org.owner_user_id && (
                  <Button className="rounded-xl" onClick={() => setConnectOpen(true)}>
                    <Link2 className="mr-2 h-4 w-4" aria-hidden="true" />
                    {t('orgProfile.connect', 'Request to connect')}
                  </Button>
                )}
                {hasExistingRequest && (
                  <span className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-emerald-50 px-3 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200">
                    <CheckCircle className="h-4 w-4" aria-hidden="true" />
                    {t('orgProfile.requestSent', 'Connection request sent')}
                  </span>
                )}
                {org.website && (
                  <Button asChild variant="outline" className="rounded-xl">
                    <a href={org.website} target="_blank" rel="noopener noreferrer">
                      <Globe className="mr-2 h-4 w-4" aria-hidden="true" />
                      {t('orgProfile.visitWebsite', 'Visit website')}
                      <ExternalLink className="ml-1.5 h-3.5 w-3.5 text-gray-500" aria-hidden="true" />
                      <span className="sr-only"> {t('orgProfile.newTab', '(opens in a new tab)')}</span>
                    </a>
                  </Button>
                )}
                <BookmarkButton
                  organizationId={org.id}
                  organizationName={org.name}
                  variant="full"
                  className="h-10 rounded-xl"
                />
                {canEdit && (
                  <Button asChild variant="outline" className="rounded-xl">
                    <Link to={accountHref('organization')}>
                      <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
                      {t('org.editOrg', 'Edit Organization')}
                    </Link>
                  </Button>
                )}
              </div>
              {canEdit && (
                <p className="mt-2 text-xs text-gray-500">{t('orgProfile.ownPage', "This is your organization's public page.")}</p>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ── Section bar: sticky under the 64 px navbar, sideways on phones ── */}
      {sectionIds.length > 1 && (
        <nav
          aria-label={t('orgProfile.sectionNav', 'Profile sections')}
          className="sticky top-16 z-30 border-b border-gray-200 bg-white/95 backdrop-blur"
        >
          <div ref={navScrollerRef} className={cn(WRAP, 'no-scrollbar relative flex gap-1 overflow-x-auto py-2')}>
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
                    'inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-sm font-medium transition-colors',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                    active ? 'bg-primary text-white shadow-sm' : 'text-gray-700 hover:bg-gray-100',
                  )}
                >
                  <item.icon className="h-4 w-4" aria-hidden="true" />
                  {item.label}
                  {item.count !== undefined && item.count > 0 && (
                    <span className={cn('text-xs tabular-nums', active ? 'text-white/80' : 'text-gray-500')}>{item.count}</span>
                  )}
                </a>
              );
            })}
          </div>
        </nav>
      )}

      {/* ── Body ── */}
      <div className={cn(WRAP, 'flex flex-col gap-12 py-8 sm:py-10')}>
        {/* About */}
        <ProfileSection id="about" icon={Info} title={t('orgProfile.aboutTitle', 'About {{name}}', { name: org.name })}>
          <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
            <div className={cn(CARD, 'p-6', hasFacts ? 'lg:col-span-2' : 'lg:col-span-3')}>
              {org.description ? (
                <p className="whitespace-pre-wrap leading-relaxed text-gray-700">{org.description}</p>
              ) : (
                <p className="text-gray-500">{t('orgProfile.noDescription', '{{name}} has not added a description yet.', { name: org.name })}</p>
              )}
              {/* Audience description (media organizations) */}
              {org.audience_description && (
                <div className="mt-6 border-t border-gray-100 pt-6">
                  <h3 className="mb-2 font-semibold text-gray-900">{t('orgProfile.audience', 'Audience')}</h3>
                  <p className="whitespace-pre-wrap leading-relaxed text-gray-700">{org.audience_description}</p>
                </div>
              )}
            </div>

            {hasFacts && (
              <aside className={cn(CARD, 'p-6')} aria-labelledby="org-glance-title">
                <h3 id="org-glance-title" className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  {t('orgProfile.atAGlance', 'At a glance')}
                </h3>
                <ul className="space-y-4">
                  {typeLabel && <Fact icon={TypeIcon} label={t('orgProfile.fields.type', 'Type')}>{typeLabel}</Fact>}
                  {location && <Fact icon={MapPin} label={t('orgProfile.fields.location', 'Location')}>{location}</Fact>}
                  {org.headquarters_country && (
                    <Fact icon={Landmark} label={t('orgProfile.fields.headquarters', 'Headquarters')}>{org.headquarters_country}</Fact>
                  )}
                  {org.website && (
                    <Fact icon={Globe} label={t('orgProfile.fields.website', 'Website')}>
                      <a
                        href={org.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all text-primary underline-offset-2 hover:underline"
                      >
                        {displayUrl(org.website)}
                        <span className="sr-only"> {t('orgProfile.newTab', '(opens in a new tab)')}</span>
                      </a>
                    </Fact>
                  )}
                  {members.length > 0 && <Fact icon={Users} label={t('orgProfile.fields.team', 'Team')}>{membersLabel}</Fact>}
                </ul>
              </aside>
            )}
          </div>
        </ProfileSection>

        {/* Investment thesis — public on investor profiles */}
        {showInvestment && (
          <ProfileSection id="investment" icon={Target} title={t('orgProfile.investment.title', 'Investment thesis')}>
            <div className={cn(CARD, 'p-6')}>
              {org.investment_thesis && (
                <p className="mb-6 whitespace-pre-wrap leading-relaxed text-gray-700">{org.investment_thesis}</p>
              )}
              <dl className="grid gap-5 sm:grid-cols-3">
                {org.investment_geographies && org.investment_geographies.length > 0 && (
                  <div>
                    <dt className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {t('orgProfile.investment.geographies', 'Geographies')}
                    </dt>
                    <dd className="flex flex-wrap gap-1.5">
                      {org.investment_geographies.map((g) => (
                        <span key={g} className="rounded-full bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary">{g}</span>
                      ))}
                    </dd>
                  </div>
                )}
                {(org.investment_size_min != null || org.investment_size_max != null) && (
                  <div>
                    <dt className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {t('orgProfile.investment.checkSize', 'Check size')}
                    </dt>
                    <dd className="font-medium text-gray-900">{formatCapitalRange(org.investment_size_min, org.investment_size_max)}</dd>
                  </div>
                )}
                {org.investment_hold_period && (
                  <div>
                    <dt className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {t('orgProfile.investment.holdPeriod', 'Hold period')}
                    </dt>
                    <dd className="font-medium text-gray-900">
                      {t(
                        `orgProfile.holdPeriods.${org.investment_hold_period}`,
                        HOLD_PERIODS.find((h) => h.value === org.investment_hold_period)?.label ?? org.investment_hold_period,
                      )}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          </ProfileSection>
        )}

        {/* Sectors, grouped by theme */}
        {showSectors && (
          <ProfileSection id="sectors" icon={Layers} title={sectorsTitle} count={sectors.length}>
            <div className="grid gap-4 sm:grid-cols-2">
              {sectorGroups.map((g) => {
                const Icon = g.theme?.icon ?? Tag;
                const label = g.theme ? t(g.theme.labelKey, g.theme.fallback) : t('orgProfile.sectors.other', 'Other sectors');
                return (
                  <div key={g.key} className={cn(CARD, 'overflow-hidden')}>
                    <CoverImage
                      src={g.theme?.image ?? null}
                      focusY={g.theme?.imageFocusY ?? 0.5}
                      alt=""
                      seed={`theme-${g.key}`}
                      icon={Icon}
                      aspect="fill"
                      tone="sea"
                      className="h-24"
                    >
                      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-[#0b2653]/95 via-[#0b2653]/50 to-[#0b2653]/10" />
                      <h3 className="absolute inset-x-0 bottom-0 flex items-center gap-2 p-3 text-sm font-semibold text-white drop-shadow-sm">
                        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        {label}
                      </h3>
                    </CoverImage>
                    <ul className="flex flex-wrap gap-2 p-4">
                      {g.items.map((s) => (
                        <li key={s.id} className="rounded-full bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-800">
                          {sectorLabel(s)}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </ProfileSection>
        )}

        {/* Gallery */}
        {showGallery && (
          <ProfileSection id="gallery" icon={Camera} title={t('orgProfile.gallery.title', 'Gallery')} count={gallery.length}>
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
                      'group relative aspect-square overflow-hidden rounded-xl bg-gray-100',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
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
                      imageClassName="group-hover:scale-105"
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

        {/* Marina details (verified members only) */}
        {showMarina && marinaDetails && (
          <ProfileSection id="marina" icon={Anchor} title={t('orgProfile.marina.title', 'Marina details')}>
            <MarinaDetailsBlock details={marinaDetails} futurePlans={futurePlans} sectorLabel={sectorLabel} />
          </ProfileSection>
        )}

        {/* Smart Marina 2026 sustainability narrative + evidence images (self-hides if none) */}
        {isMarina && (
          <section id="sustainability" aria-label={t('orgProfile.nav.sustainability', 'Sustainability')} className="scroll-mt-36" hidden={!sustainVisible}>
            <div ref={sustainRef}>
              <SM26MarinaSustainability orgId={org.id} />
            </div>
          </section>
        )}

        {/* Recommended by — confirmed marina references for partners */}
        {showRefs && (
          <ProfileSection id="recommendations" icon={Award} title={recommendedLabel}>
            <p className="-mt-1 mb-4 max-w-prose text-sm text-gray-600">
              {t('orgProfile.recommendedByDesc', 'These marinas have confirmed working with {{name}} and recommend their services.', { name: org.name })}
            </p>
            <ul className="grid gap-3 sm:grid-cols-2">
              {confirmedReferences.map((ref, idx) => (
                <li key={idx} className={cn(CARD, 'flex items-start gap-3 p-4')}>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary/15 text-secondary-dark">
                    <BadgeCheck className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-gray-900">{ref.client_legal_name}</p>
                    <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-gray-600">
                      {ref.client_country && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" aria-hidden="true" /> {ref.client_country}
                        </span>
                      )}
                      {ref.project_name && (
                        <span>
                          {t('orgProfile.project', 'Project')}: <span className="text-gray-800">{ref.project_name}</span>
                        </span>
                      )}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </ProfileSection>
        )}

        {/* Team (verified members only) */}
        {showTeam && (
          <ProfileSection id="team" icon={Users} title={t('orgProfile.team.title', 'Team')} count={members.length}>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {members.map((member) => {
                const person = member.profiles ?? publicProfiles[member.user_id] ?? null;
                const fullName = `${person?.first_name || ''} ${person?.last_name || ''}`.trim();
                const displayName = fullName || t('orgProfile.team.memberFallback', 'Team member');
                const initials = fullName
                  ? fullName.split(/\s+/).map((n) => n[0]).join('').slice(0, 2).toUpperCase()
                  : displayName.slice(0, 2).toUpperCase();
                const jobTitle = person?.job_title;
                const avatarUrl = person?.avatar_url ?? null;
                return (
                  <li key={member.id}>
                    <Link
                      to={`/users/${member.user_id}`}
                      className={cn(
                        CARD,
                        'group flex items-center gap-3 p-4 transition hover:shadow-md hover:ring-primary/20',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                      )}
                    >
                      {avatarUrl ? (
                        <img src={avatarUrl} alt="" className="h-12 w-12 shrink-0 rounded-2xl object-cover ring-2 ring-primary/10" />
                      ) : (
                        <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-base font-bold text-primary">
                          {initials || '??'}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-gray-900 group-hover:text-primary">{displayName}</span>
                        {jobTitle && <span className="block truncate text-sm text-gray-500">{jobTitle}</span>}
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-gray-400 group-hover:text-gray-600" aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </ProfileSection>
        )}

        {/* What a verified member would also get here — only what this profile really has. */}
        {membersOnlyItems.length > 0 && (
          <div className={cn(CARD, 'flex flex-col gap-4 p-6 sm:flex-row sm:items-center')}>
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-secondary/15 text-secondary-dark">
              <Lock className="h-6 w-6" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-gray-900">{t('orgProfile.membersOnlyTitle', 'More for verified members')}</h2>
              <p className="mt-1 text-sm text-gray-600">{t('orgProfile.membersOnlyIntro', 'Verified members also get:')}</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {membersOnlyItems.map((item) => (
                  <li key={item.key} className="inline-flex max-w-full items-center gap-1.5 rounded-xl bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-800">
                    <item.icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <span className="min-w-0 break-words">{item.label}</span>
                  </li>
                ))}
              </ul>
            </div>
            <Button asChild className="shrink-0 rounded-xl">
              {user ? (
                <Link to={accountHref('dashboard')}>{t('orgProfile.checkStatus', 'Check your account status')}</Link>
              ) : (
                <Link to="/become-partner">{t('orgProfile.join', 'Join the network')}</Link>
              )}
            </Button>
          </div>
        )}
      </div>

      <GalleryLightbox
        images={gallery}
        index={lightbox}
        onIndex={setLightbox}
        onClose={() => setLightbox(null)}
        name={org.name}
      />

      {/* Connect Request Dialog */}
      <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>{t('orgProfile.connectTitle', 'Request to connect')}</DialogTitle>
            <DialogDescription>{t('orgProfile.connectDesc', 'Send a connection request to {{name}}.', { name: org.name })}</DialogDescription>
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
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setConnectOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
              <Button onClick={handleSendConnectRequest} disabled={connectSending}>
                {connectSending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                {t('orgProfile.connectSend', 'Send request')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─── Pieces ─────────────────────────────────────────────────────── */

/**
 * One section of the profile. scroll-mt-36 (144 px) lands its top just under
 * the navbar and the section bar after a jump; the heading takes focus then,
 * so keyboard and screen-reader users carry on from where they jumped.
 */
function ProfileSection({
  id, icon: Icon, title, count, children,
}: {
  id: SectionId;
  icon: LucideIcon;
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-36">
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/5 text-primary">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <h2
          id={`${id}-title`}
          tabIndex={-1}
          data-section-heading
          className="min-w-0 break-words text-xl font-semibold text-gray-900 focus:outline-none"
        >
          {title}
        </h2>
        {count !== undefined && count > 0 && (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium tabular-nums text-gray-600">{count}</span>
        )}
      </div>
      {children}
    </section>
  );
}

/** A labelled fact in the "At a glance" card. */
function Fact({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/5 text-primary">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
        <div className="break-words font-medium text-gray-900">{children}</div>
      </div>
    </li>
  );
}

/**
 * Berths, facilities, certifications, plans and the marina's own texts.
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

  const stats: { key: string; icon: LucideIcon; label: string; value: string; numeric: boolean }[] = [];
  if (details.marina_type) {
    stats.push({
      key: 'type', icon: Ship, numeric: false,
      label: t('orgProfile.marina.type', 'Type'),
      value: t(`orgProfile.marinaTypes.${details.marina_type}`, humanize(details.marina_type)),
    });
  }
  if (details.berths_count != null) {
    stats.push({ key: 'berths', icon: Anchor, numeric: true, label: t('orgProfile.marina.berths', 'Berths'), value: String(details.berths_count) });
  }
  if (details.superyacht_berths != null && details.superyacht_berths > 0) {
    stats.push({ key: 'superyacht', icon: Ship, numeric: true, label: t('orgProfile.marina.superyachtBerths', 'Superyacht berths'), value: String(details.superyacht_berths) });
  }
  if (details.longest_berth_meters != null) {
    stats.push({ key: 'longest', icon: Ruler, numeric: true, label: t('orgProfile.marina.maxBerth', 'Max berth length'), value: `${details.longest_berth_meters} m` });
  }
  if (details.fresh_water_available) {
    stats.push({ key: 'water', icon: Droplets, numeric: false, label: t('orgProfile.marina.freshWater', 'Fresh water'), value: t('orgProfile.marina.available', 'Available') });
  }

  const facilities: { key: string; icon: LucideIcon; label: string }[] = [];
  if (details.has_yacht_club) {
    facilities.push({
      key: 'club', icon: CheckCircle,
      label: details.yacht_club_members
        ? t('orgProfile.marina.yachtClubMembers', 'Yacht club ({{n}} members)', { n: details.yacht_club_members })
        : t('orgProfile.marina.yachtClub', 'Yacht club'),
    });
  }
  if (details.has_sailing_school) facilities.push({ key: 'school', icon: GraduationCap, label: t('orgProfile.marina.sailingSchool', 'Sailing school') });
  if (details.has_boat_yard) facilities.push({ key: 'yard', icon: Wrench, label: t('orgProfile.marina.boatYard', 'Boat yard') });
  if (details.has_restaurants) {
    facilities.push({
      key: 'food', icon: UtensilsCrossed,
      label: details.restaurants_count && details.restaurants_count > 1
        ? t('orgProfile.marina.restaurants', 'Restaurants ({{n}})', { n: details.restaurants_count })
        : t('orgProfile.marina.restaurant', 'Restaurant'),
    });
  }
  if (details.has_concierge) facilities.push({ key: 'concierge', icon: Sparkles, label: t('orgProfile.marina.concierge', 'Concierge service') });

  const certifications = details.certifications ?? [];
  // Sorted by the name the reader sees, which in French is not the English order.
  const planLabel = (p: FuturePlan) => sectorLabel({ slug: p.sector_slug, label: p.sector_label });
  const plans = [...futurePlans].sort((a, b) => planLabel(a).localeCompare(planLabel(b)));

  const textCards: ReactNode[] = [];
  if (hasText(details.marina_description)) {
    textCards.push(
      <div key="about" className={cn(CARD, 'p-6')}>
        <h3 className="mb-2 font-semibold text-gray-900">{t('orgProfile.marina.aboutMarina', 'About the marina')}</h3>
        <p className="whitespace-pre-wrap leading-relaxed text-gray-700">{details.marina_description}</p>
      </div>,
    );
  }
  if (hasText(details.services_description)) {
    textCards.push(
      <div key="services" className={cn(CARD, 'p-6')}>
        <h3 className="mb-2 font-semibold text-gray-900">{t('orgProfile.marina.services', 'Services')}</h3>
        <p className="whitespace-pre-wrap leading-relaxed text-gray-700">{details.services_description}</p>
      </div>,
    );
  }

  const listCards: ReactNode[] = [];
  if (facilities.length > 0) {
    listCards.push(
      <div key="facilities" className={cn(CARD, 'p-6')}>
        <h3 className="mb-4 font-semibold text-gray-900">{t('orgProfile.marina.facilities', 'Facilities & services')}</h3>
        <ul className="grid gap-3 sm:grid-cols-2">
          {facilities.map((f) => (
            <li key={f.key} className="flex items-center gap-2.5 text-sm text-gray-800">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/5 text-primary">
                <f.icon className="h-4 w-4" aria-hidden="true" />
              </span>
              {f.label}
            </li>
          ))}
        </ul>
      </div>,
    );
  }
  if (certifications.length > 0 || hasText(details.certifications_other)) {
    listCards.push(
      <div key="certs" className={cn(CARD, 'p-6')}>
        <h3 className="mb-3 font-semibold text-gray-900">{t('orgProfile.marina.certifications', 'Certifications')}</h3>
        <ul className="flex flex-wrap gap-2">
          {certifications.map((cert) => (
            <li key={cert} className="inline-flex items-center gap-1.5 rounded-full bg-secondary/15 px-3 py-1.5 text-sm font-medium text-gray-900">
              <Award className="h-3.5 w-3.5 text-secondary-dark" aria-hidden="true" />
              {cert}
            </li>
          ))}
          {hasText(details.certifications_other) && (
            <li className="inline-flex items-center gap-1.5 rounded-full bg-secondary/15 px-3 py-1.5 text-sm font-medium text-gray-900">
              <Award className="h-3.5 w-3.5 text-secondary-dark" aria-hidden="true" />
              {details.certifications_other}
            </li>
          )}
        </ul>
      </div>,
    );
  }
  if (plans.length > 0) {
    listCards.push(
      <div key="plans" className={cn(CARD, 'p-6')}>
        <h3 className="mb-4 flex items-center gap-2 font-semibold text-gray-900">
          <CalendarClock className="h-4 w-4 text-primary" aria-hidden="true" />
          {t('orgProfile.marina.futurePlans', 'Future development plans')}
        </h3>
        <ul className="space-y-2">
          {plans.map((plan) => {
            const tl = TIMELINES[plan.timeline];
            return (
              <li key={`${plan.sector_label}-${plan.timeline}`} className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2">
                <span className="min-w-0 text-sm font-medium text-gray-800">{planLabel(plan)}</span>
                <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold', tl?.tone ?? 'bg-gray-100 text-gray-700')}>
                  {tl ? t(`orgProfile.timelines.${tl.key}`, tl.fallback) : plan.timeline}
                </span>
              </li>
            );
          })}
        </ul>
      </div>,
    );
  }

  return (
    <>
      {stats.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {stats.map((s) => (
            <li key={s.key} className={cn(CARD, 'p-4')}>
              <s.icon className="h-5 w-5 text-secondary-dark" aria-hidden="true" />
              <p className={cn('mt-3 break-words font-bold text-gray-900', s.numeric ? 'text-2xl tabular-nums' : 'text-lg leading-tight')}>{s.value}</p>
              <p className="mt-0.5 text-xs font-medium uppercase tracking-wide text-gray-500">{s.label}</p>
            </li>
          ))}
        </ul>
      )}
      {(textCards.length > 0 || listCards.length > 0) && (
        <div className={cn('grid gap-6', stats.length > 0 && 'mt-6', textCards.length > 0 && listCards.length > 0 && 'lg:grid-cols-2')}>
          {textCards.length > 0 && <div className="space-y-6">{textCards}</div>}
          {listCards.length > 0 && <div className="space-y-6">{listCards}</div>}
        </div>
      )}
    </>
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
      <DialogContent className={cn('w-[calc(100vw-1rem)] max-w-5xl gap-0 overflow-hidden rounded-2xl border-0 bg-gray-950 p-0 text-white sm:rounded-2xl', closeBtn)}>
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
