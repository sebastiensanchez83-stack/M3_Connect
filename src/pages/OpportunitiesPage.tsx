import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Seo } from '@/components/seo/Seo';
import type { LucideIcon } from 'lucide-react';
import {
  Anchor, ArrowRight, Briefcase, Calendar, CheckCircle2, Clock, Coins, Hourglass,
  Loader2, Lock, MessageSquare, Ship, Tag, Wrench, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { PageHero } from '@/components/ui/PageHero';
import { CoverImage } from '@/components/ui/CoverImage';
import { AdBanner } from '@/components/ui/AdBanner';
import { useAuth } from '@/contexts/AuthContext';
import { useEntitlements } from '@/hooks/useEntitlements';
import { supabase } from '@/lib/supabase';
import { requireFreshSession } from '@/lib/session';
import { toast } from '@/hooks/use-toast';
import { sendNotification } from '@/lib/notifications';
import { checkSectorMatch } from '@/lib/sector-matching';
import { THEMES, getTheme, themeForSector, type Theme, type ThemeKey } from '@/lib/themes';
import { SITE_IMAGES } from '@/lib/siteMedia';
import { CREATE_ACTIONS, canCreate, type CreateAction, type CreateCapability } from '@/lib/nav';
import { cn } from '@/lib/utils';
import { withSiteSuffix } from '@/lib/seoText';
import { scrollTopUnderBars } from '@/lib/scrollTarget';
import { BgRevealPanel } from '@/components/brand/BgRevealPanel';
import { CardShell } from '@/components/brand/CardShell';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { LogoTile } from '@/components/brand/OrgCard';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { BathyPattern } from '@/components/motion/BathyPattern';
import { registerOrgRefonteStrings } from '@/i18n/refonte-org';

registerOrgRefonteStrings();

/**
 * Open business published by verified marinas: RFPs, consultation requests and
 * marina projects, served at /opportunities.
 *
 * This used to be three tabs of the old /network screen (MarketplacePage),
 * sharing a file with the organization directory. Same data, same rules, same
 * express-interest flow — only the presentation changed:
 *   - the kind is a chip with its count, in the URL (?kind=rfps|consultations|projects);
 *   - once there is data, each item's sector maps to one of the six themes
 *     (src/lib/themes.ts) and the themes present become chips (?theme=);
 *   - every kind has an empty state that tells marinas how to publish (only
 *     when they are allowed to) and suppliers what happens next.
 *
 * Production has no RFP, consultation or project yet, so the empty states are
 * what most people will see first; they are written as the page, not as an
 * error.
 *
 * Refonte v2 (Oct 2026), the directory's design: the compact banner with the
 * publish buttons, a sticky toolbar (kinds as a segmented control, themes as
 * pills) that rises with the header, opportunity cards on the shared card shell
 * (picture zoom, lift, gold title line), and for everyone who is not a verified
 * member a navy lock panel that shows what is behind the door. Gates, data,
 * URL params (?kind=, ?theme=) and the express-interest flow are unchanged.
 */

/* ------------------------------------------------------------------ types */

type Kind = 'rfps' | 'consultations' | 'projects';

interface SectorRef {
  id: string;
  label: string;
  slug: string | null;
}

/** Who published the item, resolved from the publishing user's membership. */
interface Publisher {
  name: string | null;
  orgId: string | null;
  slug: string | null;
  logo: string | null;
}

interface PublisherFields {
  marina_name: string | null;
  marina_slug: string | null;
  marina_logo: string | null;
}

interface RfpCard extends PublisherFields {
  kind: 'rfps';
  id: string;
  title: string;
  scope: string | null;
  deadline_date: string | null;
  is_open: boolean;
  created_at: string;
  marina_user_id: string;
  marina_organization_id: string | null;
  sector_id: string | null;
  sector: SectorRef | null;
  theme: ThemeKey | null;
}

interface ConsultationCard extends PublisherFields {
  kind: 'consultations';
  id: string;
  title: string;
  description: string | null;
  is_open: boolean;
  created_at: string;
  marina_user_id: string;
  marina_organization_id: string | null;
  sector_id: string | null;
  sector: SectorRef | null;
  theme: ThemeKey | null;
}

interface ProjectCard extends PublisherFields {
  kind: 'projects';
  id: string;
  project_type: string | null;
  budget_range: string | null;
  timeline: string | null;
  description: string | null;
  status: string | null;
  created_at: string | null;
  user_id: string | null;
  theme: ThemeKey | null;
}

type Opportunity = RfpCard | ConsultationCard | ProjectCard;

interface InterestTarget {
  type: 'rfp' | 'consultation';
  id: string;
  title: string;
  marina_user_id: string;
  marina_organization_id: string | null;
  sector_id: string | null;
}

type RawRfp = {
  id: string; title: string; scope: string | null; deadline_date: string | null; is_open: boolean;
  created_at: string; marina_user_id: string; sector_id: string | null; sectors: SectorRef | null;
};
type RawConsultation = {
  id: string; title: string; description: string | null; is_open: boolean;
  created_at: string; marina_user_id: string; sector_id: string | null; sectors: SectorRef | null;
};
type RawProject = {
  id: string; project_type: string | null; budget_range: string | null; timeline: string | null;
  description: string | null; status: string | null; created_at: string | null; user_id: string | null;
};

/* ------------------------------------------------------------------ constants */

const KIND_KEYS: Kind[] = ['rfps', 'consultations', 'projects'];

const KIND_META: Record<Kind, {
  icon: LucideIcon;
  capability: CreateCapability;
  label: string;
  one: string;
  title: string;
  desc: string;
}> = {
  rfps: {
    icon: Ship,
    capability: 'submit_rfp',
    label: 'RFPs',
    one: 'RFP',
    title: 'Requests for proposals',
    desc: 'A marina describes a need, sets a deadline and invites service providers to send a proposal.',
  },
  consultations: {
    icon: MessageSquare,
    capability: 'submit_consultation',
    label: 'Consultations',
    one: 'Consultation',
    title: 'Consultation requests',
    desc: 'A marina asks a precise question and looks for expert advice.',
  },
  projects: {
    icon: Wrench,
    capability: 'submit_project',
    label: 'Projects',
    one: 'Project',
    title: 'Marina projects',
    desc: 'A marina project in energy, digital, infrastructure or services, looking for the right service providers.',
  },
};

/**
 * Projects carry a project type instead of a sector. Four of the five types
 * name a theme outright; "other" stays unthemed and shows under every chip-less view.
 */
const PROJECT_TYPE_THEME: Record<string, ThemeKey> = {
  energy: 'energy',
  digital: 'digital',
  infrastructure: 'infrastructure',
  services: 'operations',
};

/** marina_projects.status as a reader would say it. Only approved and in_progress are fetched. */
const PROJECT_STATUS_FALLBACK: Record<string, string> = {
  approved: 'Open',
  in_progress: 'In progress',
  completed: 'Completed',
};

/** The sticky filter bar's height when it cannot be measured; the header's 64 px are added on the way up only (scrollTopUnderBars). */
const FILTER_BAR_H = 68;

const EMPTY_ITEMS: { rfps: RfpCard[]; consultations: ConsultationCard[]; projects: ProjectCard[] } = {
  rfps: [],
  consultations: [],
  projects: [],
};

/* ------------------------------------------------------------------ helpers */

/** A `date` column ('2026-11-04') is a calendar day: parse it locally, never as UTC midnight. */
function parseDay(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
}

function formatDate(value: string | null, locale: string): string {
  if (!value) return '';
  return parseDay(value).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Whole days from today to the deadline: 0 is today, negative is past. */
function daysUntil(day: string): number {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d = parseDay(day);
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/** The key existingInterests is built from: one interest per marina and sector. */
function interestKey(marinaUserId: string, sectorId: string | null): string {
  return `${marinaUserId}::${sectorId || ''}`;
}

function humanize(value: string | null): string {
  return (value ?? '').replace(/_/g, ' ');
}

function projectTypeLabel(t: TFunction, type: string | null): string {
  if (!type) return '';
  return t(`submitProject.projectTypes.${type}`, humanize(type));
}

function itemTitle(item: Opportunity, t: TFunction): string {
  if (item.kind !== 'projects') return item.title;
  const type = projectTypeLabel(t, item.project_type);
  return type ? t('opportunities.projectTitle', '{{type}} project', { type }) : t('opportunities.kindOne.projects', 'Project');
}

function itemExcerpt(item: Opportunity): string | null {
  if (item.kind === 'rfps') return item.scope;
  return item.description;
}

function sectorLabel(t: TFunction, sector: SectorRef | null): string {
  if (!sector) return '';
  return sector.slug ? t(`sectorNames.${sector.slug}`, sector.label) : sector.label;
}

async function safeFetch<T>(label: string, fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch (err) {
    if (import.meta.env.DEV) console.error(`Error fetching ${label}:`, err);
    return [];
  }
}

async function fetchRfps(): Promise<RawRfp[]> {
  const { data, error } = await supabase
    .from('rfps')
    .select('id, title, scope, deadline_date, is_open, created_at, marina_user_id, sector_id, sectors(id, label, slug)')
    .eq('status', 'approved')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as unknown as RawRfp[];
}

async function fetchConsultations(): Promise<RawConsultation[]> {
  const { data, error } = await supabase
    .from('consultations')
    .select('id, title, description, is_open, created_at, marina_user_id, sector_id, sectors(id, label, slug)')
    .eq('status', 'approved')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as unknown as RawConsultation[];
}

async function fetchProjects(): Promise<RawProject[]> {
  const { data, error } = await supabase
    .from('marina_projects')
    .select('id, project_type, budget_range, timeline, description, status, created_at, user_id')
    .in('status', ['approved', 'in_progress'])
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as RawProject[];
}

/**
 * Publishing marina for each user: organization name (and now its slug and
 * logo) via organization_members, falling back to the person's name through
 * get_public_profiles. Same resolution as the old page — a later membership
 * row overrides an earlier one — done once for the three kinds together.
 */
async function resolvePublishers(userIds: string[]): Promise<Map<string, Publisher>> {
  const map = new Map<string, Publisher>();
  if (userIds.length === 0) return map;

  const { data: memberOrgs } = await supabase
    .from('organization_members')
    .select('user_id, organization_id, organizations(name, slug, logo_url)')
    .in('user_id', userIds);
  for (const m of (memberOrgs || []) as unknown as {
    user_id: string;
    organization_id: string | null;
    organizations: { name: string | null; slug: string | null; logo_url: string | null } | null;
  }[]) {
    const prev = map.get(m.user_id) ?? { name: null, orgId: null, slug: null, logo: null };
    const org = m.organizations;
    map.set(m.user_id, {
      name: org?.name ? org.name : prev.name,
      slug: org?.name ? org.slug ?? null : prev.slug,
      logo: org?.name ? org.logo_url ?? null : prev.logo,
      orgId: m.organization_id ? m.organization_id : prev.orgId,
    });
  }

  const missingIds = userIds.filter((uid) => !map.get(uid)?.name);
  if (missingIds.length > 0) {
    const { data: profiles } = await supabase.rpc('get_public_profiles', { target_user_ids: missingIds });
    for (const p of (profiles || []) as { user_id: string; first_name: string | null; last_name: string | null }[]) {
      const name = [p.first_name, p.last_name].filter(Boolean).join(' ');
      const prev = map.get(p.user_id) ?? { name: null, orgId: null, slug: null, logo: null };
      map.set(p.user_id, { ...prev, name: name || null });
    }
  }
  return map;
}

/** Open items first, then newest first (the fetch order is kept inside each group). */
function openFirst<T extends { is_open: boolean }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => Number(b.is_open) - Number(a.is_open));
}

/** Theme chips are only worth showing when they can actually narrow the list. */
function themeChoices(list: Opportunity[]): { options: Theme[]; counts: Record<string, number>; show: boolean } {
  const counts: Record<string, number> = {};
  let unthemed = false;
  for (const item of list) {
    if (item.theme) counts[item.theme] = (counts[item.theme] ?? 0) + 1;
    else unthemed = true;
  }
  const options = THEMES.filter((th) => (counts[th.key] ?? 0) > 0);
  return { options, counts, show: options.length > 1 || (options.length === 1 && unthemed) };
}

/* ========== page ========== */

export function OpportunitiesPage() {
  const { t, i18n } = useTranslation();
  const { user, profile, isVerified, organization, loading: authLoading } = useAuth();
  const { isFeatureEnabled } = useEntitlements();
  const [params, setParams] = useSearchParams();

  /* --- data --- */
  const [items, setItems] = useState(EMPTY_ITEMS);
  const [loading, setLoading] = useState(true);
  const firstLoad = useRef(true);

  /* --- detail dialog --- */
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<Opportunity | null>(null);

  /* --- express interest dialog --- */
  const [interestOpen, setInterestOpen] = useState(false);
  const [interestMessage, setInterestMessage] = useState('');
  const [interestSending, setInterestSending] = useState(false);
  const [interestTarget, setInterestTarget] = useState<InterestTarget | null>(null);
  const [existingInterests, setExistingInterests] = useState<Set<string>>(new Set());

  // Keyed on ids and flags, never on the user/profile/organization objects:
  // auth-js hands over a new user object on every tab refocus.
  const uid = user?.id;
  const persona = profile?.persona as string | undefined;
  const orgVerified = organization?.access_status === 'verified';
  const isPartner = persona === 'partner' && isVerified;
  const isMarinaLike = persona === 'marina' || persona === 'developer';
  const locale = i18n.language?.startsWith('fr') ? 'fr-FR' : 'en-GB';

  /* ---- existing partner interests (to mark "already expressed") ---- */
  useEffect(() => {
    if (!uid || !isPartner) return;
    let alive = true;
    supabase
      .from('partner_requests')
      .select('marina_user_id, sector_id')
      .eq('partner_user_id', uid)
      .then(({ data, error }) => {
        if (error) { console.error('[Opportunities] Failed to fetch partner interests:', error); return; }
        if (alive && data) {
          setExistingInterests(new Set(
            (data as { marina_user_id: string; sector_id: string | null }[]).map((r) => interestKey(r.marina_user_id, r.sector_id)),
          ));
        }
      });
    return () => { alive = false; };
  }, [uid, isPartner]);

  /* ---- RFPs, consultations and projects: verified members only ---- */
  useEffect(() => {
    if (!isVerified) return;
    let alive = true;

    (async () => {
      if (firstLoad.current) setLoading(true);
      const [rfpRows, consultRows, projectRows] = await Promise.all([
        safeFetch('RFPs', fetchRfps),
        safeFetch('consultations', fetchConsultations),
        safeFetch('projects', fetchProjects),
      ]);

      const userIds = [...new Set([
        ...rfpRows.map((r) => r.marina_user_id),
        ...consultRows.map((c) => c.marina_user_id),
        ...projectRows.map((p) => p.user_id).filter((id): id is string => !!id),
      ])];
      let publishers = new Map<string, Publisher>();
      try {
        publishers = await resolvePublishers(userIds);
      } catch (err) {
        if (import.meta.env.DEV) console.error('Error resolving publishing marinas:', err);
      }
      if (!alive) return;

      const pub = (userId: string | null): PublisherFields & { orgId: string | null } => {
        const p = userId ? publishers.get(userId) : undefined;
        return { marina_name: p?.name ?? null, marina_slug: p?.slug ?? null, marina_logo: p?.logo ?? null, orgId: p?.orgId ?? null };
      };

      setItems({
        rfps: openFirst(rfpRows.map((r): RfpCard => {
          const p = pub(r.marina_user_id);
          return {
            kind: 'rfps',
            id: r.id,
            title: r.title,
            scope: r.scope,
            deadline_date: r.deadline_date,
            is_open: r.is_open,
            created_at: r.created_at,
            marina_user_id: r.marina_user_id,
            marina_name: p.marina_name,
            marina_slug: p.marina_slug,
            marina_logo: p.marina_logo,
            marina_organization_id: p.orgId,
            sector_id: r.sector_id || null,
            sector: r.sectors ? { id: r.sectors.id, label: r.sectors.label, slug: r.sectors.slug ?? null } : null,
            theme: themeForSector(r.sectors?.slug),
          };
        })),
        consultations: openFirst(consultRows.map((c): ConsultationCard => {
          const p = pub(c.marina_user_id);
          return {
            kind: 'consultations',
            id: c.id,
            title: c.title,
            description: c.description,
            is_open: c.is_open,
            created_at: c.created_at,
            marina_user_id: c.marina_user_id,
            marina_name: p.marina_name,
            marina_slug: p.marina_slug,
            marina_logo: p.marina_logo,
            marina_organization_id: p.orgId,
            sector_id: c.sector_id || null,
            sector: c.sectors ? { id: c.sectors.id, label: c.sectors.label, slug: c.sectors.slug ?? null } : null,
            theme: themeForSector(c.sectors?.slug),
          };
        })),
        projects: projectRows.map((r): ProjectCard => {
          const p = pub(r.user_id);
          return {
            kind: 'projects',
            id: r.id,
            project_type: r.project_type,
            budget_range: r.budget_range,
            timeline: r.timeline,
            description: r.description,
            status: r.status,
            created_at: r.created_at,
            user_id: r.user_id,
            marina_name: p.marina_name,
            marina_slug: p.marina_slug,
            marina_logo: p.marina_logo,
            theme: r.project_type ? PROJECT_TYPE_THEME[r.project_type] ?? null : null,
          };
        }),
      });
      firstLoad.current = false;
      setLoading(false);
    })();

    return () => { alive = false; };
  }, [isVerified]);

  /* ---- Express interest ---- */
  const openInterestDialog = (type: 'rfp' | 'consultation', item: RfpCard | ConsultationCard) => {
    setInterestTarget({
      type,
      id: item.id,
      title: item.title,
      marina_user_id: item.marina_user_id,
      marina_organization_id: item.marina_organization_id,
      sector_id: item.sector_id,
    });
    setInterestMessage('');
    setInterestOpen(true);
  };

  const handleExpressInterest = async () => {
    if (!user || !interestTarget) return;
    const freshUid = await requireFreshSession();
    if (!freshUid) return;
    setInterestSending(true);
    try {
      // Sector matching gate
      if (organization?.id && interestTarget.marina_organization_id) {
        const match = await checkSectorMatch(organization.id, interestTarget.marina_organization_id);
        if (!match.allowed) {
          toast({
            title: t('opportunities.connectionBlocked', 'Connection blocked'),
            description: match.reason || t('opportunities.noSectorOverlap', 'No overlapping sectors with this marina.'),
            variant: 'destructive',
          });
          setInterestSending(false);
          return;
        }
      }
      // What is written and notified stays exactly as it was on the old page.
      const { error } = await supabase.from('partner_requests').insert({
        partner_user_id: user.id,
        marina_user_id: interestTarget.marina_user_id,
        partner_organization_id: organization?.id || null,
        marina_organization_id: interestTarget.marina_organization_id,
        sector_id: interestTarget.sector_id,
        message: interestMessage.trim() || `Expressed interest in ${interestTarget.type === 'rfp' ? 'RFP' : 'consultation'}: ${interestTarget.title}`,
        status: 'pending',
      });

      if (error) throw error;

      // Notify the marina owner
      const partnerName = organization?.name || [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || 'A partner';
      sendNotification({
        type: 'partner_request_received',
        userId: interestTarget.marina_user_id,
        data: {
          partner_name: partnerName,
          message: interestMessage.trim() || `Interest in ${interestTarget.type === 'rfp' ? 'RFP' : 'consultation'}: ${interestTarget.title}`,
        },
      });

      // Track locally so the button is disabled immediately (composite key)
      setExistingInterests((prev) => new Set([...prev, interestKey(interestTarget.marina_user_id, interestTarget.sector_id)]));

      toast({
        title: t('opportunities.interestSent', 'Interest expressed successfully'),
        description: t('opportunities.interestSentDesc', 'The marina has been notified of your interest.'),
      });
      setInterestOpen(false);
    } catch (err: unknown) {
      toast({
        title: t('opportunities.error', 'Error'),
        description: err instanceof Error ? err.message : t('opportunities.errorSending', 'Failed to send request'),
        variant: 'destructive',
      });
    } finally {
      setInterestSending(false);
    }
  };

  const hasSentInterest = (item: Opportunity) =>
    item.kind !== 'projects' && existingInterests.has(interestKey(item.marina_user_id, item.sector_id));

  const openDetail = (item: Opportunity) => {
    setSelected(item);
    setDetailOpen(true);
  };

  /* ---- URL state ---- */
  const update = (changes: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace });
  };

  const ready = isVerified && !loading;
  const counts: Record<Kind, number> = {
    rfps: items.rfps.length,
    consultations: items.consultations.length,
    projects: items.projects.length,
  };

  const kindParam = params.get('kind');
  const requestedKind = KIND_KEYS.includes(kindParam as Kind) ? (kindParam as Kind) : null;
  // No kind in the URL: open on the first kind that has something to show.
  const kind: Kind = requestedKind ?? (ready ? KIND_KEYS.find((k) => counts[k] > 0) ?? 'rfps' : 'rfps');
  const meta = KIND_META[kind];

  const kindItems: Opportunity[] = items[kind];
  const choices = useMemo(() => themeChoices(kindItems), [kindItems]);
  const showThemeChips = ready && choices.show;
  // A theme that has no chip on screen is ignored rather than applied invisibly.
  const requestedTheme = getTheme(params.get('theme'));
  const activeTheme = showThemeChips && requestedTheme && choices.options.some((o) => o.key === requestedTheme.key)
    ? requestedTheme
    : null;
  const filtered = activeTheme ? kindItems.filter((i) => i.theme === activeTheme.key) : kindItems;

  const selectKind = (next: Kind) => {
    if (next === kind) return;
    // Keep the theme only if the other kind offers it as a chip too.
    const nextChoices = themeChoices(items[next]);
    const keepTheme = activeTheme && nextChoices.show && nextChoices.options.some((o) => o.key === activeTheme.key);
    update({ kind: next, theme: keepTheme ? activeTheme.key : null });
  };

  // Changing a filter from the sticky bar deep in the list brings the top of
  // the list back under the bar — only when the reader is below it.
  const resultsRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const filterKey = `${kind}|${activeTheme?.key ?? ''}`;
  const lastFilterKey = useRef(filterKey);
  useEffect(() => {
    if (filterKey === lastFilterKey.current) return;
    lastFilterKey.current = filterKey;
    const el = resultsRef.current;
    if (!el) return;
    const top = scrollTopUnderBars(el, barRef.current?.offsetHeight ?? FILTER_BAR_H, 0);
    if (window.scrollY > top) window.scrollTo({ top, behavior: 'smooth' });
  }, [filterKey]);

  /* ---- who may publish what ---- */
  const createCtx = { isVerified, orgVerified, persona, isFeatureEnabled };
  const createActionFor = (k: Kind): CreateAction | null => {
    const action = CREATE_ACTIONS.find((a) => a.capability === KIND_META[k].capability);
    return action && canCreate(action.capability, createCtx) ? action : null;
  };
  const heroActions = KIND_KEYS
    .map((k) => ({ kind: k, action: createActionFor(k) }))
    .filter((x): x is { kind: Kind; action: CreateAction } => x.action !== null);
  const currentCreate = createActionFor(kind);

  /* ========== render ========== */

  if (authLoading) {
    return <LoadingSkeleton variant="page" />;
  }

  const kindLabel = (k: Kind) => t(`opportunities.kinds.${k}`, KIND_META[k].label);
  const publishLabel = (k: Kind) => t(`opportunities.publish.${k}`, k === 'rfps' ? 'Publish an RFP' : k === 'consultations' ? 'Request a consultation' : 'Submit a project');

  // The hero's second sentence speaks to the reader, with the same audiences
  // as the empty state below: whoever may publish, a marina still waiting for
  // its organization to be verified, a supplier. Anyone else gets the
  // definition alone rather than a promise that does not apply to them.
  const heroLead = t(
    'opportunities.subtitle',
    'An opportunity is a verified marina asking the network for help: a request for proposals, a question for an expert, or a project looking for service providers.',
  );
  const heroAudience = heroActions.length > 0
    ? t('opportunities.subtitleCreator', 'Publish one and verified service providers in the matching sector can answer you.')
    : isMarinaLike
      ? t('opportunities.subtitlePending', 'You can publish one as soon as your organization is verified.')
      : persona === 'partner'
        ? t('opportunities.subtitleSupplier', 'Express interest in an RFP or a consultation and the marina receives your company profile.')
        : '';

  const seoTitle = withSiteSuffix(t('seo.opportunities.title', 'Marina tenders, RFPs and projects'));
  const seoDescription = t('seo.opportunities.description', 'Where marinas publish their needs: tenders, expert questions and projects, open to companies checked by M3. Sign up to read and answer them.');

  return (
    <div className="min-h-screen bg-page">
      <Seo title={seoTitle} description={seoDescription} path="/opportunities" />

      <PageHero
        image={SITE_IMAGES.opportunitiesHero}
        seed="opportunities-hero"
        icon={Briefcase}
        eyebrow={t('opportunities.heroTag', 'Open business')}
        title={t('opportunities.title', 'Opportunities')}
        subtitle={heroAudience ? `${heroLead} ${heroAudience}` : heroLead}
      >
        {heroActions.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            {heroActions.map(({ kind: k, action }, i) => (
              <Button key={action.href} asChild variant={i === 0 ? 'ctaOnDark' : 'ctaLight'}>
                <Link to={action.href}>{publishLabel(k)}</Link>
              </Button>
            ))}
          </div>
        )}
      </PageHero>

      {/* ── Kind, then theme. Sticks under the header and rises with it when it tucks away. ── */}
      {isVerified && (
        <div
          ref={barRef}
          role="region"
          aria-label={t('oppRefonte.toolbarLabel', 'Filter the opportunities')}
          className="sticky top-16 z-30 border-b border-rule bg-page/95 backdrop-blur-md"
        >
          <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
            <div
              role="group"
              aria-label={t('oppRefonte.kindsLabel', 'Kind of opportunity')}
              className="no-scrollbar -mx-4 max-w-[100vw] overflow-x-auto px-4 sm:mx-0 sm:max-w-full sm:px-0"
            >
              <div className="relative inline-flex h-11 items-center rounded-pill bg-[#e9edf3] p-1">
                {KIND_KEYS.map((k) => {
                  const selected = kind === k;
                  const KindIcon = KIND_META[k].icon;
                  return (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => selectKind(k)}
                      className={cn(
                        'inline-flex h-9 items-center gap-[7px] whitespace-nowrap rounded-pill px-3.5 text-sm transition-[background-color,color,box-shadow] duration-300 focus-visible:shadow-focus focus-visible:outline-none',
                        selected ? 'bg-white font-semibold text-navy shadow-[0_1px_3px_rgba(11,38,83,.10)]' : 'font-medium text-[#374151] hover:text-navy',
                      )}
                    >
                      <KindIcon className="h-4 w-4" aria-hidden="true" />
                      {kindLabel(k)}
                      {ready && <span className="tabular font-normal text-meta">{counts[k]}</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {showThemeChips && (
              <>
                <span className="hidden h-6 w-px shrink-0 bg-rule md:block" aria-hidden="true" />
                <ul className="no-scrollbar -mx-4 flex min-w-0 gap-2 overflow-x-auto px-4 py-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
                  {choices.options.map((th) => {
                    const selected = activeTheme?.key === th.key;
                    return (
                      <li key={th.key} className="shrink-0">
                        <button
                          type="button"
                          aria-pressed={selected}
                          onClick={() => update({ theme: selected ? null : th.key })}
                          className={cn(
                            'inline-flex min-h-10 items-center gap-2 whitespace-nowrap rounded-pill border px-3.5 text-[13px] font-medium transition-colors duration-300 focus-visible:shadow-focus focus-visible:outline-none md:min-h-9',
                            selected ? 'border-navy bg-navy text-white' : 'border-rule bg-white text-navy hover:border-navy/40',
                          )}
                        >
                          <th.icon className="h-3.5 w-3.5" aria-hidden="true" />
                          {t(th.labelKey, th.fallback)}
                          <span className={cn('tabular font-normal', selected ? 'text-white/80' : 'text-meta')}>{choices.counts[th.key]}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        </div>
      )}

      <div ref={resultsRef} className="mx-auto w-full max-w-7xl px-4 pb-16 pt-8 sm:px-6 md:pb-24 md:pt-10">
        <AdBanner placement="marketplace" className="mb-6" />

        {!isVerified ? (
          <LockPanel signedIn={!!user} pending={profile?.access_status === 'pending'} />
        ) : (
          <>
            {/* ── What this kind is, how many, and the way to publish one ── */}
            <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0">
                <Eyebrow>{kindLabel(kind)}</Eyebrow>
                <h2 className="mt-2 text-h2-sm text-navy md:text-[28px] md:leading-9">{t(`opportunities.kindTitles.${kind}`, meta.title)}</h2>
                <p className="mt-2 max-w-2xl text-[15px] leading-6 text-ink">{t(`opportunities.kindDesc.${kind}`, meta.desc)}</p>
                <div className="mt-3 flex min-h-9 flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-navy" aria-live="polite">
                    {/* Nothing to count yet: the empty card below says it better than "0". */}
                    {ready && kindItems.length > 0
                      ? t('opportunities.results', {
                        count: filtered.length,
                        defaultValue: filtered.length === 1 ? '{{count}} opportunity' : '{{count}} opportunities',
                      })
                      : ''}
                  </span>
                  {activeTheme && (
                    <button
                      type="button"
                      onClick={() => update({ theme: null })}
                      aria-label={t('opportunities.removeTheme', 'Remove the filter {{theme}}', { theme: t(activeTheme.labelKey, activeTheme.fallback) })}
                      className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-pill bg-navy px-3.5 text-sm font-medium text-white transition-colors duration-300 hover:bg-navy-deep"
                    >
                      <activeTheme.icon className="h-3.5 w-3.5" aria-hidden="true" />
                      {t(activeTheme.labelKey, activeTheme.fallback)}
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
              {ready && kindItems.length > 0 && currentCreate && (
                <Button asChild variant="cta" size="sm" className="shrink-0 self-start sm:self-auto">
                  <Link to={currentCreate.href}>{publishLabel(kind)}</Link>
                </Button>
              )}
            </div>

            {/* ── Results ── */}
            {loading ? (
              <div aria-hidden="true" className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                {[0, 1, 2].map((i) => <div key={i} className="h-[380px] animate-pulse rounded-card bg-chip/70" />)}
              </div>
            ) : kindItems.length === 0 ? (
              <EmptyKind
                kind={kind}
                createAction={currentCreate}
                publishLabel={publishLabel(kind)}
                audience={currentCreate ? 'creator' : isMarinaLike ? 'marinaPending' : persona === 'partner' ? 'supplier' : 'other'}
              />
            ) : filtered.length === 0 ? (
              <div className="rounded-card border border-rule bg-white px-6 py-12 text-center">
                <p className="text-meta">{t('opportunities.noMatch', 'Nothing in this theme for now.')}</p>
                <Button variant="ctaOutline" size="sm" arrow={false} className="mt-5" onClick={() => update({ theme: null })}>
                  {t('opportunities.clearFilters', 'Clear filters')}
                </Button>
              </div>
            ) : (
              <ul aria-label={t('oppRefonte.listLabel', 'Open opportunities')} className="grid gap-5 md:grid-cols-2 md:gap-6 xl:grid-cols-3">
                {filtered.map((item) => (
                  <li key={`${item.kind}-${item.id}`} className="flex">
                    <OpportunityCard
                      item={item}
                      locale={locale}
                      isPartner={isPartner}
                      interestSent={hasSentInterest(item)}
                      onOpen={() => openDetail(item)}
                      onInterest={item.kind === 'projects'
                        ? undefined
                        : () => openInterestDialog(item.kind === 'rfps' ? 'rfp' : 'consultation', item)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {/* ====== Detail dialog (RFP, consultation or project) ====== */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-card sm:max-w-lg">
          {selected && (
            <DetailBody
              item={selected}
              locale={locale}
              isPartner={isPartner}
              interestSent={hasSentInterest(selected)}
              onClose={() => setDetailOpen(false)}
              onInterest={() => {
                if (selected.kind === 'projects') return;
                setDetailOpen(false);
                openInterestDialog(selected.kind === 'rfps' ? 'rfp' : 'consultation', selected);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* ====== Express interest dialog ====== */}
      <Dialog open={interestOpen} onOpenChange={setInterestOpen}>
        <DialogContent className="rounded-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('opportunities.expressInterest', 'Express interest')}</DialogTitle>
            <DialogDescription>
              {interestTarget?.type === 'rfp'
                ? t('opportunities.expressInterestRfpDesc', 'Let the marina know you are interested in this RFP. Your organization profile will be shared.')
                : t('opportunities.expressInterestConsultDesc', 'Let the marina know you can help with this consultation. Your organization profile will be shared.')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {interestTarget && (
              <div className="rounded-field bg-page p-3 text-sm text-ink">
                <span className="font-medium text-navy">{interestTarget.title}</span>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="opportunity-interest-message">{t('opportunities.interestMessage', 'Message (optional)')}</Label>
              <Textarea
                id="opportunity-interest-message"
                value={interestMessage}
                onChange={(e) => setInterestMessage(e.target.value)}
                rows={4}
                placeholder={t('opportunities.interestMessagePlaceholder', 'Describe your relevant experience or interest...')}
              />
            </div>

            <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:items-center sm:justify-end">
              <Button variant="ctaOutline" size="sm" arrow={false} onClick={() => setInterestOpen(false)} disabled={interestSending}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button variant="cta" size="sm" roll={!interestSending} arrow={!interestSending} onClick={handleExpressInterest} disabled={interestSending}>
                {interestSending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />{t('opportunities.sending', 'Sending...')}</>
                ) : (
                  t('opportunities.sendInterest', 'Send interest')
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

/** A small white pill, in the directory's badge style: the kind of opportunity, or its status. */
const BADGE = 'inline-flex h-[22px] shrink-0 items-center gap-[5px] whitespace-nowrap rounded-badge px-2 text-[11px] font-semibold uppercase leading-none tracking-[0.05em]';

/** Deadline, open/closed or project status, as one short badge. */
function StatusBadge({ item, onPhoto = false }: { item: Opportunity; onPhoto?: boolean }) {
  const { t } = useTranslation();
  let tone: 'urgent' | 'calm' | 'muted' = 'calm';
  let text = '';
  let Icon: LucideIcon = Hourglass;

  if (item.kind === 'projects') {
    Icon = Clock;
    text = item.status
      ? t(`opportunities.projectStatus.${item.status}`, PROJECT_STATUS_FALLBACK[item.status] ?? humanize(item.status))
      : '';
  } else if (!item.is_open) {
    tone = 'muted';
    Icon = Lock;
    text = item.kind === 'rfps'
      ? t('opportunities.rfpClosed', 'Closed')
      : t('opportunities.consultClosed', 'Closed');
  } else if (item.kind === 'rfps' && item.deadline_date) {
    const days = daysUntil(item.deadline_date);
    if (days < 0) {
      tone = 'muted';
      text = t('opportunities.deadlinePassed', 'Deadline passed');
    } else if (days === 0) {
      tone = 'urgent';
      text = t('opportunities.closesToday', 'Closes today');
    } else {
      tone = days <= 7 ? 'urgent' : 'calm';
      text = t('opportunities.daysLeft', { count: days, defaultValue: days === 1 ? '{{count}} day left' : '{{count}} days left' });
    }
  } else {
    Icon = CheckCircle2;
    text = item.kind === 'rfps'
      ? t('opportunities.rfpOpen', 'Open')
      : t('opportunities.consultOpen', 'Open');
  }
  if (!text) return null;

  return (
    <span
      className={cn(
        BADGE,
        tone === 'urgent' && 'bg-amber-100 text-amber-900',
        tone === 'calm' && (onPhoto ? 'bg-white text-navy' : 'bg-foam text-teal-text'),
        tone === 'muted' && (onPhoto ? 'bg-white text-meta' : 'bg-chip text-meta'),
      )}
    >
      <Icon className={cn('h-3 w-3', tone === 'calm' && onPhoto && 'text-teal')} aria-hidden="true" />
      {text}
    </span>
  );
}

/** The publishing marina: logo (or initials) and name, linked when its profile is known. */
function PublisherRow({ item, locale }: { item: Opportunity; locale: string }) {
  const { t } = useTranslation();
  const name = item.marina_name ?? t('opportunities.unknownMarina', 'A verified marina');
  return (
    <div className="flex min-w-0 items-center gap-3">
      {item.marina_name ? (
        <LogoTile src={item.marina_logo} name={item.marina_name} type="marina" size={40} />
      ) : (
        <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-field bg-org-marina text-white">
          <Anchor className="h-4 w-4" />
        </span>
      )}
      <div className="min-w-0">
        {item.marina_slug ? (
          <Link
            to={`/organizations/${item.marina_slug}`}
            className="focus-ring relative z-10 block truncate rounded-sm text-sm font-semibold text-navy underline-offset-[3px] hover:underline"
          >
            {name}
          </Link>
        ) : (
          <span className="block truncate text-sm font-semibold text-navy">{name}</span>
        )}
        {item.created_at && (
          <span className="block text-[13px] leading-[18px] text-meta">
            {t('opportunities.posted', 'Posted {{date}}', { date: formatDate(item.created_at, locale) })}
          </span>
        )}
      </div>
    </div>
  );
}

function OpportunityCard({
  item, locale, isPartner, interestSent, onOpen, onInterest,
}: {
  item: Opportunity;
  locale: string;
  isPartner: boolean;
  interestSent: boolean;
  onOpen: () => void;
  onInterest?: () => void;
}) {
  const { t } = useTranslation();
  const meta = KIND_META[item.kind];
  const theme = getTheme(item.theme);
  const title = itemTitle(item, t);
  const excerpt = itemExcerpt(item);
  const canRespond = isPartner && item.kind !== 'projects' && !!onInterest;
  // A closed item keeps the dialog's button (as before), but is not pushed as the card's main action.
  const respondFromCard = item.kind !== 'projects' && item.is_open && canRespond;
  // The sector is what a supplier scans for, so it is always named on the card
  // (as on the old page); the theme's icon in front keeps the theme readable.
  // Projects have no sector and show their theme instead.
  const sector = item.kind !== 'projects' ? item.sector : null;
  const themeLabel = theme ? t(theme.labelKey, theme.fallback) : '';
  const chipText = sector ? sectorLabel(t, sector) : themeLabel;
  const ChipIcon: LucideIcon = theme?.icon ?? Tag;

  return (
    <CardShell interactive className="h-full w-full min-w-0">
      <div className="card-media relative h-36 shrink-0 overflow-hidden">
        <CoverImage
          src={theme?.image ?? null}
          focusY={theme?.imageFocusY}
          alt=""
          seed={item.id}
          icon={theme?.icon ?? meta.icon}
          aspect="fill"
          tone="sea"
        />
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-[#081d40]/85 via-[#0b2653]/30 to-[#0b2653]/10" />
        <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
          <span className={cn(BADGE, 'bg-white text-navy')}>
            <meta.icon className="h-3 w-3 text-teal" aria-hidden="true" />
            {t(`opportunities.kindOne.${item.kind}`, meta.one)}
          </span>
          <StatusBadge item={item} onPhoto />
        </div>
        {chipText && (
          <span
            className="absolute bottom-3 left-3 inline-flex max-w-[85%] items-center gap-1.5 rounded-pill bg-white/95 px-2.5 py-1 text-xs font-medium text-navy"
            title={sector && themeLabel ? `${chipText} · ${themeLabel}` : chipText}
          >
            <ChipIcon className="h-3 w-3 shrink-0 text-teal" aria-hidden="true" />
            <span className="truncate">{chipText}</span>
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col px-5 pb-4 pt-5">
        <h3 className="text-card-title text-navy">
          <button type="button" onClick={onOpen} className="stretched-link line-clamp-3 block rounded-sm text-left">
            <span className="card-ul">{title}</span>
            <ArrowRight className="card-arrow" strokeWidth={2.25} aria-hidden="true" />
          </button>
        </h3>
        {excerpt && <p className="mt-2 line-clamp-3 text-sm leading-5 text-[#374151]">{excerpt}</p>}

        {item.kind === 'rfps' && item.deadline_date && (
          <p className="mt-3 flex items-center gap-1.5 text-[13px] leading-[18px] text-meta">
            <Calendar className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t('opportunities.deadline', 'Deadline: {{date}}', { date: formatDate(item.deadline_date, locale) })}
          </p>
        )}
        {item.kind === 'projects' && (item.budget_range || item.timeline) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {item.budget_range && (
              <span className="inline-flex h-6 items-center gap-1 rounded-pill bg-chip px-2.5 text-[12px] font-medium text-navy">
                <Coins className="h-3 w-3" aria-hidden="true" />
                {t(`submitProject.budgets.${item.budget_range}`, humanize(item.budget_range))}
              </span>
            )}
            {item.timeline && (
              <span className="inline-flex h-6 items-center gap-1 rounded-pill bg-chip px-2.5 text-[12px] font-medium text-navy">
                <Clock className="h-3 w-3" aria-hidden="true" />
                {t(`submitProject.timelines.${item.timeline}`, humanize(item.timeline))}
              </span>
            )}
          </div>
        )}

        <div className="mt-auto pt-5">
          <PublisherRow item={item} locale={locale} />
        </div>
      </div>

      {/* Above the card's stretched link, so these act on their own. */}
      <footer className="relative z-10 flex min-h-[60px] flex-wrap items-center justify-end gap-x-4 gap-y-2 border-t border-rule px-5 py-3">
        {canRespond && interestSent && (
          <span className="mr-auto inline-flex items-center gap-1.5 text-[13px] font-medium text-teal-text">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {t('opportunities.interestSentBadge', 'Interest sent')}
          </span>
        )}
        {respondFromCard && !interestSent ? (
          <>
            <UnderlineLink onClick={onOpen} className="text-sm">
              {t('opportunities.viewDetails', 'View details')}
            </UnderlineLink>
            <Button variant="ctaNavy" size="sm" onClick={onInterest}>
              {t('opportunities.expressInterest', 'Express interest')}
            </Button>
          </>
        ) : (
          <UnderlineLink onClick={onOpen} className="text-sm">
            {t('opportunities.viewDetails', 'View details')}
          </UnderlineLink>
        )}
      </footer>
    </CardShell>
  );
}

function DetailBody({
  item, locale, isPartner, interestSent, onClose, onInterest,
}: {
  item: Opportunity;
  locale: string;
  isPartner: boolean;
  interestSent: boolean;
  onClose: () => void;
  onInterest: () => void;
}) {
  const { t } = useTranslation();
  const meta = KIND_META[item.kind];
  const theme = getTheme(item.theme);
  const sector = item.kind !== 'projects' ? item.sector : null;
  const name = item.marina_name ?? t('opportunities.unknownMarina', 'A verified marina');
  const body = itemExcerpt(item);

  return (
    <>
      <DialogHeader>
        <span className={cn(BADGE, 'w-fit bg-foam text-teal-text')}>
          <meta.icon className="h-3 w-3" aria-hidden="true" />
          {t(`opportunities.kindOne.${item.kind}`, meta.one)}
        </span>
        <DialogTitle className="text-xl leading-snug text-navy">{itemTitle(item, t)}</DialogTitle>
        <DialogDescription className="flex items-center gap-2 pt-1">
          <Anchor className="h-4 w-4 shrink-0" aria-hidden="true" />
          {name}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 pt-2">
        {/* Status, sector and theme */}
        <div className="flex flex-wrap gap-2">
          <StatusBadge item={item} />
          {sector && (
            <span className="inline-flex h-[22px] items-center rounded-pill bg-chip px-2.5 text-xs font-medium text-navy">
              {sectorLabel(t, sector)}
            </span>
          )}
          {theme && (
            <span className="inline-flex h-[22px] items-center gap-1 rounded-pill bg-chip px-2.5 text-xs font-medium text-navy">
              <theme.icon className="h-3 w-3 text-teal" aria-hidden="true" />
              {t(theme.labelKey, theme.fallback)}
            </span>
          )}
        </div>

        {/* Deadline */}
        {item.kind === 'rfps' && item.deadline_date && (
          <div className="flex items-center gap-2 text-sm text-ink">
            <Calendar className="h-4 w-4 shrink-0 text-meta" aria-hidden="true" />
            {t('opportunities.deadline', 'Deadline: {{date}}', { date: formatDate(item.deadline_date, locale) })}
          </div>
        )}

        {/* Budget and timeline */}
        {item.kind === 'projects' && (
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {item.budget_range && (
              <div className="rounded-field bg-page p-3">
                <dt className="flex items-center gap-1.5 text-xs font-medium text-meta">
                  <Coins className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('opportunities.budget', 'Budget')}
                </dt>
                <dd className="mt-1 font-medium text-navy">{t(`submitProject.budgets.${item.budget_range}`, humanize(item.budget_range))}</dd>
              </div>
            )}
            {item.timeline && (
              <div className="rounded-field bg-page p-3">
                <dt className="flex items-center gap-1.5 text-xs font-medium text-meta">
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('opportunities.timeline', 'Timeline')}
                </dt>
                <dd className="mt-1 font-medium text-navy">{t(`submitProject.timelines.${item.timeline}`, humanize(item.timeline))}</dd>
              </div>
            )}
          </dl>
        )}

        {/* Posted */}
        {item.created_at && (
          <div className="flex items-center gap-2 text-sm text-meta">
            <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
            {t('opportunities.posted', 'Posted {{date}}', { date: formatDate(item.created_at, locale) })}
          </div>
        )}

        {/* Full text */}
        {body && (
          <div className="space-y-1.5">
            <p className="text-sm font-semibold text-navy">
              {item.kind === 'rfps' ? t('opportunities.scope', 'Scope') : t('opportunities.description', 'Description')}
            </p>
            <p className="whitespace-pre-wrap rounded-field bg-page p-4 text-sm leading-relaxed text-ink">{body}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col-reverse gap-3 border-t border-rule pt-4 sm:flex-row sm:items-center sm:justify-end">
          {item.marina_slug && (
            <UnderlineLink to={`/organizations/${item.marina_slug}`} className="text-sm sm:mr-auto">
              {t('opportunities.viewMarina', "View the marina's profile")}
            </UnderlineLink>
          )}
          <Button variant="ctaOutline" size="sm" arrow={false} onClick={onClose}>
            {t('common.close', 'Close')}
          </Button>
          {isPartner && item.kind !== 'projects' && (
            interestSent ? (
              <Button variant="ctaNavy" size="sm" roll={false} arrow={false} disabled>
                {t('opportunities.interestAlreadySent', 'Interest already sent')}
              </Button>
            ) : (
              <Button variant="cta" size="sm" onClick={onInterest}>
                {t('opportunities.expressInterest', 'Express interest')}
              </Button>
            )
          )}
        </div>
      </div>
    </>
  );
}

/**
 * Not a verified member: the same message and the same two ways out as before,
 * on a navy panel with the three kinds of opportunity set out beside it, so a
 * visitor sees what is behind the door.
 */
function LockPanel({ signedIn, pending }: { signedIn: boolean; pending: boolean }) {
  const { t } = useTranslation();
  return (
    <BgRevealPanel
      as="section"
      bathy
      bathySeed={13}
      aria-labelledby="opp-lock-heading"
      className="mx-0 px-6 py-10 md:mx-0 md:px-12 md:py-14"
    >
      <div className="grid gap-10 lg:grid-cols-12 lg:items-center lg:gap-12">
        <div className="lg:col-span-6">
          <span aria-hidden="true" className="grid h-12 w-12 place-items-center rounded-pill bg-white/10 text-gold ring-1 ring-inset ring-white/20">
            <Lock className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <Eyebrow tone="onDark" className="mt-6">{t('oppRefonte.lock.eyebrow', 'Members only')}</Eyebrow>
          <h2 id="opp-lock-heading" className="mt-3 text-[26px] font-semibold leading-8 tracking-[-0.01em] md:text-[34px] md:leading-[42px]">
            {t('opportunities.gateTitle', 'Where marinas publish their needs')}
          </h2>
          <p className="mt-4 max-w-[520px] text-[15px] leading-6 text-white/85">
            {!signedIn
              ? t('opportunities.verifiedOnly', 'Tenders, expert questions and projects, visible to companies checked by M3. Sign up: once your company is checked, you can read them and, depending on your profile, answer.')
              : pending
                ? t('opportunities.gatePending', 'Your account is being reviewed. Opportunities open as soon as it is verified.')
                : t('opportunities.gateSignedIn', 'Tenders, expert questions and projects are visible to companies checked by M3. Your account status shows what is still missing.')}
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3">
            {!signedIn ? (
              <>
                <Button asChild variant="ctaOnDark">
                  <Link to="/become-partner">{t('opportunities.signUp', 'Sign up')}</Link>
                </Button>
                <UnderlineLink to="/become-partner" tone="light">
                  {t('opportunities.gateMarina', 'Run a marina? Publish your first need.')}
                </UnderlineLink>
              </>
            ) : (
              <Button asChild variant="ctaWhite">
                <Link to="/account">{t('opportunities.viewAccountStatus', 'View account status')}</Link>
              </Button>
            )}
          </div>
        </div>

        <ul aria-label={t('oppRefonte.lock.kindsLabel', 'What opportunities contain')} className="grid gap-4 lg:col-span-6">
          {KIND_KEYS.map((k) => {
            const KindIcon = KIND_META[k].icon;
            return (
              <CardShell key={k} as="li" tone="glass" className="flex-row items-start gap-4 p-5">
                <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-field bg-white/10 text-gold">
                  <KindIcon className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <div className="min-w-0">
                  <p className="text-[17px] font-semibold leading-6">{t(`opportunities.kindTitles.${k}`, KIND_META[k].title)}</p>
                  <p className="mt-1 text-sm leading-5 text-white/80">{t(`opportunities.kindDesc.${k}`, KIND_META[k].desc)}</p>
                </div>
              </CardShell>
            );
          })}
        </ul>
      </div>
    </BgRevealPanel>
  );
}

/**
 * Nothing published in this kind yet. Says what the kind is for, then speaks
 * to the reader: a marina that may publish gets the button, a marina still in
 * review is told when it can, a supplier learns what happens next.
 */
function EmptyKind({
  kind, createAction, publishLabel, audience,
}: {
  kind: Kind;
  createAction: CreateAction | null;
  publishLabel: string;
  audience: 'creator' | 'marinaPending' | 'supplier' | 'other';
}) {
  const { t } = useTranslation();
  const meta = KIND_META[kind];

  const emptyTitle: Record<Kind, string> = {
    rfps: 'No open RFPs yet',
    consultations: 'No open consultations yet',
    projects: 'No active projects yet',
  };
  const creatorText: Record<Kind, string> = {
    rfps: 'Be the first: describe your need and set a deadline. Verified service providers in the matching sector will see it here and can answer you.',
    consultations: 'Ask your question: experts from the network will see it here and can offer their help.',
    projects: 'Describe your project, budget and timeline; the M3 team will put you in touch with the right service providers.',
  };
  const supplierText: Record<Kind, string> = {
    rfps: 'When a marina publishes an RFP, it appears here and on your dashboard. Express interest in one click and the marina receives your company profile.',
    consultations: 'When a marina asks for advice, the request appears here and on your dashboard. Offer your help in one click and the marina receives your company profile.',
    projects: 'When a marina submits a project, the M3 team matches it with service providers in the relevant sectors.',
  };

  let text: string;
  if (audience === 'creator') text = t(`opportunities.emptyCreator.${kind}`, creatorText[kind]);
  else if (audience === 'marinaPending') text = t('opportunities.emptyMarinaPending', 'You can publish here as soon as your organization is verified.');
  else if (audience === 'supplier') text = t(`opportunities.emptySupplier.${kind}`, supplierText[kind]);
  else text = t('opportunities.emptyOther', 'New opportunities appear here as soon as the M3 team approves them.');

  return (
    <div className="overflow-hidden rounded-card border border-rule bg-white">
      <div className="grid md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div
          aria-hidden="true"
          className="relative isolate grid min-h-[168px] place-items-center overflow-hidden md:min-h-[280px]"
          style={{ background: 'linear-gradient(135deg, #0b2653, #1f7a8c)' }}
        >
          <BathyPattern seed={kind === 'rfps' ? 21 : kind === 'consultations' ? 34 : 55} rings={7} opacity={0.12} drift className="absolute -inset-4" />
          <span className="relative grid h-16 w-16 place-items-center rounded-pill bg-white/10 text-gold ring-1 ring-inset ring-white/25">
            <meta.icon className="h-7 w-7" strokeWidth={1.75} />
          </span>
        </div>

        <div className="p-6 sm:p-8 md:p-10">
          <Eyebrow>{t('oppRefonte.empty.eyebrow', 'Nothing here yet')}</Eyebrow>
          <h3 className="mt-3 text-h2-sm text-navy md:text-[26px] md:leading-8">{t(`opportunities.empty.${kind}`, emptyTitle[kind])}</h3>
          <p className="mt-3 max-w-prose text-[15px] leading-6 text-ink">{text}</p>

          {audience === 'creator' && createAction ? (
            <>
              <p className="mt-2 text-[13px] leading-[18px] text-meta">
                {t('opportunities.emptyCreatorReviewed', 'Each request is reviewed by the M3 team before it is published.')}
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
                <Button asChild variant="cta">
                  <Link to={createAction.href}>{publishLabel}</Link>
                </Button>
                <UnderlineLink to="/directory">{t('opportunities.browseDirectory', 'Browse the directory')}</UnderlineLink>
              </div>
            </>
          ) : (
            <>
              {audience !== 'marinaPending' && (
                <p className="mt-3 max-w-prose text-[15px] leading-6 text-ink">
                  {t('opportunities.meanwhile', 'Meanwhile, the directory lists the marinas and service providers already on the platform.')}
                </p>
              )}
              <div className="mt-6">
                <Button asChild variant="ctaOutline">
                  <Link to="/directory">{t('opportunities.browseDirectory', 'Browse the directory')}</Link>
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
