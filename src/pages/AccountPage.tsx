import { useState, useEffect, useMemo, useRef, useCallback, type ReactNode } from 'react';
import { externalUrl } from '@/lib/externalUrl';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet-async';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle, CalendarDays, CalendarClock, FileText, CheckCircle2, XCircle, Clock, Anchor, Building2,
  Newspaper, ExternalLink, ClipboardList, Radio, Plus, MessageSquare, Eye, ArrowLeft, ArrowRight, Check, X,
  Camera, Upload, Loader2, Pencil, Save, ChevronDown, ChevronRight, ShieldCheck, Ship, Video, MapPin, Play,
  Ticket, Compass, TrendingUp, UserCircle, Users, ImageIcon, Palette, History, KeyRound, Globe,
} from 'lucide-react';
import { MediaArticles } from '@/components/media/MediaArticles';
import { MediaPressRoom } from '@/components/media/MediaPressRoom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LogoBadge } from '@/components/ui/CoverImage';
import { CardShell } from '@/components/brand/CardShell';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import {
  BTN, BTN_OUTLINE, BandPill, FOCUS, MemberBanner, MemberEmpty, MemberHeader, MemberPanel, RowSkeleton, StatusPill, type PillTone,
} from '@/components/member/MemberUI';
import { AddToCalendarButtons } from '@/components/events/AddToCalendarButtons';
import { SM26ParticipationCard } from '@/components/sm26/SM26ParticipationCard';
import { SM26MyRegistrationPage } from '@/pages/SM26MyRegistrationPage';
import { SponsorPortal } from '@/components/sponsorship/SponsorPortal';
import { OrganizationTab } from '@/components/organization/OrganizationTab';
// PaymentForm removed — payment integration deferred
// PreAuditTab archived — will be deployed later
// import { PreAuditTab } from '@/components/preaudit/PreAuditTab';
import { ReferenceRequestForm } from '@/components/references/ReferenceRequestForm';
import { NotificationPreferencesTab } from '@/components/notifications/NotificationPreferencesTab';
import { ShortlistTab } from '@/components/shortlist/ShortlistTab';
import { InboxTab } from '@/components/inbox/InboxTab';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { useEntitlements } from '@/hooks/useEntitlements';
import { resizeImage, fileMeta } from '@/lib/image';
import { requireFreshSession } from '@/lib/session';
import {
  ACCOUNT_GROUPS, ACCOUNT_SECTIONS, accountHref, getAccountSection, type AccountTab,
} from '@/lib/accountNav';
import { cn, type CalendarEventInput } from '@/lib/utils';
import { canCreate } from '@/lib/nav';

/**
 * The member area: /account?tab=…, and /inbox (served here through `forceTab`).
 *
 * Before: one flat sidebar of up to 17 tabs, a horizontal pill strip on phones
 * that ran three screens wide, and every tab dressed differently. Now the menu
 * is the shared model in src/lib/accountNav.ts — four groups, each answering
 * one question (what I take part in, what I asked for, who I represent, how my
 * account is set up) — and every section opens with the same header.
 *
 * What did NOT move: tab values are URLs (notification emails deep-link to
 * /account?tab=<value>), the per-tab visibility rules, the onboarding mode
 * ('complete-registration'), the bare /account → /dashboard redirect, and every
 * read and write below. This is a presentation change.
 */

/* ------------------------------------------------------------------ types */

interface RegisteredEvent {
  id: string;
  title: string;
  description: string | null;
  date_time: string | null;
  end_date_time: string | null;
  is_full_day: boolean | null;
  location: string | null;
  event_type: string | null;
  replay_url: string | null;
  meeting_url: string | null;
  published: boolean | null;
}

interface EventRegistration {
  id: string;
  event_id: string;
  created_at: string;
  payment_status: string;
  registration_type: string;
  amount_due_cents: number | null;
  events: RegisteredEvent | null;
}

interface MarinaProject {
  id: string;
  project_type: string;
  budget_range: string | null;
  timeline: string | null;
  status: string;
  created_at: string;
}

interface WebinarRequest {
  id: string;
  title: string;
  description: string;
  preferred_language: string;
  preferred_timeframe: string | null;
  status: string;
  moderator_notes: string | null;
  created_at: string;
}

interface RFPItem {
  id: string;
  title: string;
  scope: string;
  sector_id: string | null;
  deadline_date: string | null;
  is_open: boolean;
  status: string;
  rejection_reason: string | null;
  created_at: string;
}

interface ConsultationItem {
  id: string;
  title: string;
  description: string;
  sector_id: string | null;
  is_open: boolean;
  status: string;
  rejection_reason: string | null;
  created_at: string;
}

interface PartnerRequestItem {
  id: string;
  partner_user_id: string;
  marina_user_id: string;
  sector_id: string | null;
  message: string;
  status: string;
  created_at: string;
}

/** One entry of the member menu, already resolved for this member. */
interface MenuItem {
  value: string;
  href: string;
  group: string;
  label: string;
  desc: string;
  icon: LucideIcon;
  notifDot?: boolean;
  notifCount?: number;
}

interface MenuGroup {
  key: string;
  label: string;
}

/* ------------------------------------------------------------------ helpers */

/** Format raw budget_range DB values into human-readable labels */
function formatBudgetRange(raw: string, under10kLabel: string): string {
  if (raw === 'under_10k') return under10kLabel;
  // Numeric ranges like "50000-100000"
  const m = raw.match(/^(\d+)-(\d+)$/);
  if (m) {
    const fmt = (n: number) => (n >= 1_000_000 ? `€${n / 1_000_000}M` : `€${(n / 1_000).toFixed(0)}k`);
    return `${fmt(Number(m[1]))} – ${fmt(Number(m[2]))}`;
  }
  // Fallback: replace underscores and capitalize
  return humanize(raw);
}

/** snake_case → "Snake Case", for raw values that have no label of their own. */
function humanize(raw: string): string {
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** As the calendar links assume: an event without an end time lasts an hour. */
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

/** When an event starts and ends, in ms. A full day without an end runs 24 h. */
function eventWindow(e: Pick<RegisteredEvent, 'date_time' | 'end_date_time' | 'is_full_day'>): { start: number; end: number } | null {
  if (!e.date_time) return null;
  const start = new Date(e.date_time).getTime();
  const end = e.end_date_time
    ? new Date(e.end_date_time).getTime()
    : start + (e.is_full_day ? 24 * 3600 * 1000 : DEFAULT_DURATION_MS);
  return { start, end };
}

const PERSONA_META: Record<string, { key: string; fallback: string; icon: LucideIcon }> = {
  marina: { key: 'accountArea.persona.marina', fallback: 'Marina / Port', icon: Anchor },
  developer: { key: 'accountArea.persona.developer', fallback: 'Marina developer', icon: Anchor },
  partner: { key: 'accountArea.persona.partner', fallback: 'Service provider', icon: Building2 },
  media_partner: { key: 'accountArea.persona.media_partner', fallback: 'Media', icon: Newspaper },
  investor: { key: 'accountArea.persona.investor', fallback: 'Investor', icon: TrendingUp },
  individual: { key: 'accountArea.persona.individual', fallback: 'Individual', icon: UserCircle },
  moderator: { key: 'accountArea.persona.moderator', fallback: 'Moderator', icon: ShieldCheck },
  admin: { key: 'accountArea.persona.admin', fallback: 'Administrator', icon: ShieldCheck },
};

const ACCESS_META: Record<string, { key: string; fallback: string; icon: LucideIcon; className: string }> = {
  verified: { key: 'accountArea.access.verified', fallback: 'Verified', icon: CheckCircle2, className: 'bg-green-100 text-green-800 ring-green-200' },
  pending: { key: 'accountArea.access.pending', fallback: 'Pending', icon: Clock, className: 'bg-yellow-100 text-yellow-800 ring-yellow-200' },
  rejected: { key: 'accountArea.access.rejected', fallback: 'Rejected', icon: XCircle, className: 'bg-red-100 text-red-800 ring-red-200' },
  suspended: { key: 'accountArea.access.suspended', fallback: 'Suspended', icon: XCircle, className: 'bg-chip text-ink ring-rule' },
};

const REGISTRATION_TYPE_LABELS: Record<string, { key: string; fallback: string }> = {
  visitor: { key: 'accountArea.events.regType.visitor', fallback: 'Visitor' },
  sponsor_included: { key: 'accountArea.events.regType.sponsor_included', fallback: 'Sponsor seat' },
  member_discount: { key: 'accountArea.events.regType.member_discount', fallback: 'Member rate' },
  package: { key: 'accountArea.events.regType.package', fallback: 'Package' },
  marina_package: { key: 'accountArea.events.regType.marina_package', fallback: 'Marina package' },
  invitation_request: { key: 'accountArea.events.regType.invitation_request', fallback: 'Invitation request' },
  exhibitor: { key: 'accountArea.events.regType.exhibitor', fallback: 'Exhibitor' },
};

/** Card look shared by every block of the member area. */
const CARD = 'rounded-card border border-rule bg-white';

/* ------------------------------------------------------------------ page */

/**
 * `forceTab` lets a tab be served at a clean URL of its own: the Inbox is a
 * top-level destination in the navigation now (/inbox), not tab 14 of
 * /account. (The Dashboard went further and became its own page.) Every other
 * tab still lives at /account?tab=…, which is where the notification emails
 * deep-link, so those links keep working untouched.
 */
export function AccountPage({ forceTab }: { forceTab?: string } = {}) {
  const { t, i18n } = useTranslation();
  const { user, profile, organization, orgRole, loading: authLoading, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [registrations, setRegistrations] = useState<EventRegistration[]>([]);
  const [projects, setProjects] = useState<MarinaProject[]>([]);
  const [webinarRequests, setWebinarRequests] = useState<WebinarRequest[]>([]);
  const [rfps, setRfps] = useState<RFPItem[]>([]);
  const [consultations, setConsultations] = useState<ConsultationItem[]>([]);
  const [partnerRequests, setPartnerRequests] = useState<PartnerRequestItem[]>([]);
  // Informational only (kept in step with ReferenceRequestForm's callbacks).
  const [, setReferenceCount] = useState<number>(0);
  const [dataLoading, setDataLoading] = useState(true);
  const firstDataLoad = useRef(true);

  // Submissions tab
  // Starts true so a first visit shows a skeleton, never an empty list.
  const [submissionsLoading, setSubmissionsLoading] = useState(true);
  // The rights (fetchKey below) the lists were last fetched with; null = never.
  const [submissionsFetchedKey, setSubmissionsFetchedKey] = useState<string | null>(null);
  const [subProjects, setSubProjects] = useState<MarinaProject[]>([]);
  const [subRfps, setSubRfps] = useState<RFPItem[]>([]);
  const [subConsultations, setSubConsultations] = useState<ConsultationItem[]>([]);
  const [subWebinars, setSubWebinars] = useState<WebinarRequest[]>([]);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    projects: true, rfps: true, consultations: true, webinars: true,
  });

  // Event payment dialog
  // eventPaymentReg removed — payment integration deferred

  // The three sections whose visibility is decided by a query. `null` means
  // "not known yet", so a deep link to one of them waits instead of flashing
  // "not available".
  const [hasSM26, setHasSM26] = useState<boolean | null>(null);
  // Press room is open to any media on the platform: the media_partner persona,
  // a member of a media organisation, or press accredited for an event. That
  // rule lives in is_media_user() so the UI and the data agree.
  const [isMedia, setIsMedia] = useState<boolean | null>(null);
  const [sponsorIds, setSponsorIds] = useState<string[] | null>(null);

  const { isFeatureEnabled, isLoading: entLoading } = useEntitlements();

  const activeTab = forceTab ?? (searchParams.get('tab') || 'dashboard');

  // One canonical URL per destination: the two promoted tabs go to their own
  // routes, so the menu, the mobile switcher and the nav bar can never
  // disagree about where "Inbox" lives. (Same mapping as accountHref.)
  const tabHref = (value: string) =>
    value === 'dashboard' ? '/dashboard'
      : value === 'inbox' ? '/inbox'
        : `/account?tab=${value}`;

  // Effects below are keyed on ids and primitives, never on the user / profile
  // / organization objects: auth-js hands over a new user object on every tab
  // refocus, and re-running a load on each one blanked the screen.
  const uid = user?.id;
  const hasUser = !!user;
  const hasProfile = !!profile;
  const persona = profile?.persona as string | undefined;
  const orgId = organization?.id;
  const entProject = isFeatureEnabled('submit_project');
  const entRfp = isFeatureEnabled('submit_rfp');
  const entConsult = isFeatureEnabled('submit_consultation');
  const personaMarinaLike = persona === 'marina' || persona === 'developer';

  // Feature grants load after the organization, so for anyone who is not a
  // marina they are "not known yet" for a moment. While they are, sections
  // that depend on them wait instead of saying "not available" or showing an
  // empty list. The hook's isLoading can still read false for the one render
  // in which the organization arrives (its fetch starts in an effect), so we
  // also remember which organization the grants were last settled for.
  const [entSettledOrg, setEntSettledOrg] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!entLoading) setEntSettledOrg(orgId ?? null);
  }, [entLoading, orgId]);
  const entPending = !personaMarinaLike && (entLoading || entSettledOrg !== (orgId ?? null));

  // Which kinds of request this account can see, as one primitive: the data
  // loads below record the key they ran with, so a list fetched before the
  // grants arrived is never shown as final.
  const fetchKey = `${personaMarinaLike || entProject ? 1 : 0}${personaMarinaLike || entRfp ? 1 : 0}${personaMarinaLike || entConsult ? 1 : 0}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  // Show the "Event hub" section if the signed-in user can access an SM26
  // registration — their own, or their organisation's.
  useEffect(() => {
    if (!uid) { setHasSM26(false); return; }
    let active = true;
    (async () => {
      try {
        const { data: ev } = await supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle();
        if (!active) return;
        if (!ev) { setHasSM26(false); return; }
        const { data } = await supabase.from('sm_registration').select('id').eq('event_id', (ev as { id: string }).id).limit(1);
        if (active) setHasSM26(!!(data && data.length));
      } catch {
        if (active) setHasSM26(false);
      }
    })();
    return () => { active = false; };
  }, [uid]);

  // Press room visibility — the server decides who counts as media.
  useEffect(() => {
    if (!uid) { setIsMedia(false); return; }
    let active = true;
    (async () => {
      try {
        const { data } = await supabase.rpc('is_media_user');
        if (active) setIsMedia(data === true);
      } catch {
        if (active) setIsMedia(false);
      }
    })();
    return () => { active = false; };
  }, [uid]);

  // Show the "Sponsorship" section if this account has been linked to a sponsor
  // (per-person, via sp_sponsor_user — set by an admin/YCM manager).
  useEffect(() => {
    if (!uid) { setSponsorIds([]); return; }
    let active = true;
    (async () => {
      try {
        const { data } = await supabase.from('sp_sponsor_user').select('sponsor_id').eq('user_id', uid);
        if (active) setSponsorIds(((data || []) as { sponsor_id: string }[]).map(x => x.sponsor_id));
      } catch {
        if (active) setSponsorIds([]);
      }
    })();
    return () => { active = false; };
  }, [uid]);

  // Redirect deprecated tab URLs to the new Inbox so old email links / bookmarks
  // still land in a meaningful place.
  useEffect(() => {
    if (activeTab === 'b2b-requests') {
      navigate('/inbox', { replace: true });
    }
  }, [activeTab, navigate]);

  // During onboarding (draft), only show completion-related tabs
  const isOnboarding = profile?.onboarding_status === 'draft';

  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [, setUploadingLogo] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Profile editing
  const [editingProfile, setEditingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({ firstName: '', lastName: '', jobTitle: '' });

  // Initialize the profile form when the profile loads or its values change —
  // keyed on the values, so a refocus can't wipe what is being typed.
  const pFirst = profile?.first_name || '';
  const pLast = profile?.last_name || '';
  const pJob = profile?.job_title || '';
  useEffect(() => {
    if (!hasProfile) return;
    setProfileForm({ firstName: pFirst, lastName: pLast, jobTitle: pJob });
  }, [hasProfile, pFirst, pLast, pJob]);

  const handleSaveProfile = async () => {
    if (!user) return;
    const freshUid = await requireFreshSession();
    if (!freshUid) return;
    setSavingProfile(true);
    try {
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          first_name: profileForm.firstName.trim(),
          last_name: profileForm.lastName.trim(),
          job_title: profileForm.jobTitle.trim() || null,
        })
        .eq('user_id', user.id);

      if (updateError) throw updateError;

      toast({ title: t('accountArea.toast.profileUpdated', 'Profile updated'), description: t('accountArea.toast.profileUpdatedDesc', 'Your personal information has been saved.') });
      setEditingProfile(false);
      await refreshProfile();
    } catch (err: unknown) {
      toast({ title: t('accountArea.toast.error', 'Error'), description: err instanceof Error ? err.message : t('accountArea.toast.profileUpdateFailed', 'Failed to update profile.'), variant: 'destructive' });
    } finally {
      setSavingProfile(false);
    }
  };

  const uploadImage = async (file: File, type: 'avatar' | 'logo') => {
    if (!file.type.startsWith('image/')) {
      toast({ title: t('accountArea.toast.invalidFile', 'Invalid file type'), description: t('accountArea.toast.invalidFileDesc', 'Please upload an image (JPEG, PNG, WebP)'), variant: 'destructive' });
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast({ title: t('accountArea.toast.fileTooLarge', 'File too large'), description: t('accountArea.toast.fileTooLargeDesc', 'Maximum 25 MB'), variant: 'destructive' });
      return;
    }
    const freshUid = await requireFreshSession();
    if (!freshUid) return;
    const setter = type === 'avatar' ? setUploadingAvatar : setUploadingLogo;
    setter(true);
    try {
      const meta = await fileMeta(file);
      const blob = await resizeImage(file, 600, 600); // shrink big files; keep PNG/SVG transparency
      const ctype = (blob as Blob).type || file.type;
      const ext = ctype === 'image/svg+xml' ? 'svg' : ctype === 'image/png' ? 'png' : 'jpg';
      const prefix = type === 'avatar' ? 'avatar' : 'logo';
      // The storage RLS policy requires the first path segment to be the user's
      // id (…/foldername[1] = auth.uid()). Keep the uid as the folder.
      const fileName = `${user!.id}/${prefix}-${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage.from('profile-images').upload(fileName, blob, { cacheControl: '3600', upsert: true, contentType: ctype });
      if (uploadErr) throw uploadErr;
      const { data: urlData } = supabase.storage.from('profile-images').getPublicUrl(fileName);
      const publicUrl = urlData.publicUrl;

      if (type === 'avatar') {
        await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('user_id', user!.id);
        toast({ title: t('accountArea.toast.avatarUpdated', 'Profile image updated'), description: meta });
      } else {
        // Update logo on organization
        if (organization) {
          await supabase.rpc('update_org_branding', { p_org_id: organization.id, p_field: 'logo', p_url: publicUrl });
        }
        toast({ title: t('accountArea.toast.logoUpdated', 'Company logo updated'), description: meta });
      }
      await refreshProfile();
    } catch (err: unknown) {
      toast({ title: t('accountArea.toast.uploadFailed', 'Upload failed'), description: err instanceof Error ? err.message : t('accountArea.toast.unexpected', 'An unexpected error occurred.'), variant: 'destructive' });
    }
    setter(false);
  };

  useEffect(() => {
    if (authLoading) return;
    if (!hasUser) { navigate('/'); return; }
    // User logged in but no profile → could be new user or a fetch timeout.
    // Don't redirect immediately; the render below shows a retry option.
  }, [hasUser, authLoading, navigate]);

  // Default to 'complete-registration' tab during onboarding if no tab param is set
  useEffect(() => {
    if (profile?.onboarding_status === 'draft' && !searchParams.get('tab')) {
      navigate('/account?tab=complete-registration', { replace: true });
    }
  }, [profile?.onboarding_status, searchParams, navigate]);

  useEffect(() => {
    if (!uid || !hasProfile) return;
    let alive = true;
    const runKey = `${persona === 'marina' || persona === 'developer' || entProject ? 1 : 0}${persona === 'marina' || persona === 'developer' || entRfp ? 1 : 0}${persona === 'marina' || persona === 'developer' || entConsult ? 1 : 0}`;
    // Only the first load shows a skeleton; later refreshes swap data in place.
    if (firstDataLoad.current) setDataLoading(true);

    const fetchData = async () => {
      try {
        const { data: regs } = await supabase
          .from('event_registrations')
          .select('id, event_id, created_at, payment_status, registration_type, amount_due_cents, events(id, title, description, date_time, end_date_time, is_full_day, location, event_type, replay_url, meeting_url, published)')
          .eq('user_id', uid)
          .order('created_at', { ascending: false });
        if (!alive) return;
        if (regs) setRegistrations(regs as unknown as EventRegistration[]);

        if (persona === 'marina' || persona === 'developer' || entProject) {
          const { data: proj } = await supabase
            .from('marina_projects')
            .select('id, project_type, budget_range, timeline, status, created_at')
            .eq('user_id', uid)
            .order('created_at', { ascending: false });
          if (alive && proj) setProjects(proj as MarinaProject[]);
        }

        const { data: webinars } = await supabase
          .from('webinar_requests')
          .select('id, title, description, preferred_language, preferred_timeframe, status, moderator_notes, created_at')
          .eq('user_id', uid)
          .order('created_at', { ascending: false });
        if (alive && webinars) setWebinarRequests(webinars as WebinarRequest[]);

        // Fetch RFPs (marina/developer or entitlement-granted)
        if (persona === 'marina' || persona === 'developer' || entRfp) {
          const { data: rfpData } = await supabase
            .from('rfps')
            .select('id, title, scope, sector_id, deadline_date, is_open, status, rejection_reason, created_at')
            .eq('marina_user_id', uid)
            .order('created_at', { ascending: false });
          if (alive && rfpData) setRfps(rfpData as RFPItem[]);
        }

        if (persona === 'marina' || persona === 'developer' || entConsult) {
          const { data: consultData } = await supabase
            .from('consultations')
            .select('id, title, description, sector_id, is_open, status, rejection_reason, created_at')
            .eq('marina_user_id', uid)
            .order('created_at', { ascending: false });
          if (alive && consultData) setConsultations(consultData as ConsultationItem[]);
        }

        // Fetch partner requests received (for any user)
        const { data: prData } = await supabase
          .from('partner_requests')
          .select('id, partner_user_id, marina_user_id, sector_id, message, status, created_at')
          .or(`partner_user_id.eq.${uid},marina_user_id.eq.${uid}`)
          .order('created_at', { ascending: false });
        if (alive && prData) setPartnerRequests(prData as PartnerRequestItem[]);

        // Fetch recommendation count for partners (informational only)
        if ((persona === 'partner' || persona === 'media_partner') && orgId) {
          const { count } = await supabase
            .from('reference_requests')
            .select('id', { count: 'exact' })
            .eq('partner_organization_id', orgId);
          if (alive) setReferenceCount(count || 0);
        }
      } catch (err) {
        if (import.meta.env.DEV) console.error('Error fetching account data:', err);
      } finally {
        if (alive) {
          firstDataLoad.current = false;
          setDataLoading(false);
          setLoadedKey(runKey);
        }
      }
    };

    fetchData();
    return () => { alive = false; };
  }, [uid, hasProfile, persona, orgId, entProject, entRfp, entConsult]);

  // Fetch submissions data when tab is active. The three kinds follow the
  // same rule as the menu (developers count as marinas), so a section that is
  // shown is never silently empty. It runs once per set of rights: it waits
  // for feature grants to settle, and runs again if they change afterwards,
  // so a grant that arrives late is never left with an empty list.
  useEffect(() => {
    if (activeTab !== 'submissions' || !uid || !hasProfile || entPending) return;
    if (submissionsFetchedKey === fetchKey) return;
    const runKey = fetchKey;
    const hasProjects = runKey[0] === '1';
    const hasRFPs = runKey[1] === '1';
    const hasConsultations = runKey[2] === '1';
    let alive = true;

    setSubmissionsLoading(true);
    const fetchSubmissions = async () => {
      try {
        const [projRes, rfpRes, consultRes, webinarRes] = await Promise.all([
          hasProjects
            ? supabase
                .from('marina_projects')
                .select('id, project_type, budget_range, timeline, status, created_at')
                .eq('user_id', uid)
                .order('created_at', { ascending: false })
            : Promise.resolve({ data: null }),
          hasRFPs
            ? supabase
                .from('rfps')
                .select('id, title, scope, sector_id, deadline_date, is_open, status, rejection_reason, created_at')
                .eq('marina_user_id', uid)
                .order('created_at', { ascending: false })
            : Promise.resolve({ data: null }),
          hasConsultations
            ? supabase
                .from('consultations')
                .select('id, title, description, sector_id, is_open, status, rejection_reason, created_at')
                .eq('marina_user_id', uid)
                .order('created_at', { ascending: false })
            : Promise.resolve({ data: null }),
          supabase
            .from('webinar_requests')
            .select('id, title, description, preferred_language, preferred_timeframe, status, moderator_notes, created_at')
            .eq('user_id', uid)
            .order('created_at', { ascending: false }),
        ]);

        if (!alive) return;
        if (!hasProjects) setSubProjects([]);
        else if (projRes.data) setSubProjects(projRes.data as MarinaProject[]);
        if (!hasRFPs) setSubRfps([]);
        else if (rfpRes.data) setSubRfps(rfpRes.data as RFPItem[]);
        if (!hasConsultations) setSubConsultations([]);
        else if (consultRes.data) setSubConsultations(consultRes.data as ConsultationItem[]);
        if (webinarRes.data) setSubWebinars(webinarRes.data as WebinarRequest[]);
        setSubmissionsFetchedKey(runKey);
      } catch (err) {
        if (import.meta.env.DEV) console.error('Error fetching submissions:', err);
      } finally {
        if (alive) setSubmissionsLoading(false);
      }
    };

    fetchSubmissions();
    return () => { alive = false; };
  }, [activeTab, uid, hasProfile, entPending, submissionsFetchedKey, fetchKey]);

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const locale = i18n.language?.startsWith('fr') ? 'fr-FR' : 'en-GB';
  const fmtDate = (iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) =>
    new Date(iso).toLocaleDateString(locale, opts);

  /* ------------------------------------------------------------ early exits */

  if (authLoading) {
    return <LoadingSkeleton variant="page" />;
  }

  if (!user) return null;

  if (!profile) {
    return (
      <div className="min-h-[60vh] bg-page px-4 py-16">
        <div className={cn(CARD, 'mx-auto max-w-md p-8 text-center')}>
          <AlertCircle className="mx-auto mb-3 h-10 w-10 text-amber-500" aria-hidden="true" />
          <p className="font-semibold text-navy">{t('accountArea.loadError.title', 'Could not load your profile.')}</p>
          <p className="mt-1 text-sm text-meta">{t('accountArea.loadError.body', 'This may be due to a slow connection. Please try again.')}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Button variant="ctaNavy" size="sm" onClick={() => refreshProfile()}>
              {t('accountArea.loadError.retry', 'Retry')}
            </Button>
            <Button variant="outline" className={BTN_OUTLINE} onClick={() => navigate('/onboarding')}>
              {t('accountArea.loadError.onboarding', 'Go to Onboarding')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // The dashboard is a page of its own now (DashboardPage). A bare /account —
  // which two notification emails link to — and old ?tab=dashboard bookmarks
  // land there. Drafts are left alone: the effect above sends them to
  // complete-registration, and finishing signup comes first.
  if (!forceTab && profile.onboarding_status !== 'draft') {
    const tab = searchParams.get('tab');
    if (!tab || tab === 'dashboard') return <Navigate to="/dashboard" replace />;
  }

  // ?tab=pricing was the level comparison ("Plan & billing", then "Membership
  // & sponsorship"), retired because the platform is free. Six send-notification
  // e-mails still link to it ("View Pricing & Payments", "Retry Payment" on
  // invoice / payment / sponsorship updates), so it lands where amounts due
  // and payment status actually are: the sponsor portal for an account linked
  // to a sponsor (sp_sponsor_user), otherwise My registrations. Mid-signup it
  // goes to the step to finish. Every hook is above this point, so waiting for
  // sponsorIds with an early return is safe.
  if (!forceTab && searchParams.get('tab') === 'pricing') {
    if (profile.onboarding_status === 'draft') {
      return <Navigate to="/account?tab=complete-registration" replace />;
    }
    if (sponsorIds === null) return <LoadingSkeleton variant="page" />;
    return <Navigate to={sponsorIds.length ? '/account?tab=sponsorship' : '/account?tab=registrations'} replace />;
  }

  /* ------------------------------------------------------------ derived */

  const isMarina = profile.persona === 'marina';
  const isDeveloper = profile.persona === 'developer';
  const isInvestor = profile.persona === 'investor';
  const isMarinaLike = isMarina || isDeveloper;
  const isPartnerOnly = profile.persona === 'partner';
  const isMediaPartner = profile.persona === 'media_partner';
  const isPartner = isPartnerOnly || isMediaPartner; // either partner type (for shared UI like B2B tabs)
  const org = organization;

  // The Recommendations feature is org-driven, not persona-driven:
  // admins/moderators/owners of a partner org all need access. Only
  // gate by the org's type, not by the caller's profile persona.
  const isPartnerOrg = organization?.organization_type === 'partner';

  // Entitlement-aware feature access: native persona access OR admin-granted.
  // Developers get the same submission features as marinas. Investors are
  // read-only by default but can have features granted via entitlement.
  const canProjects = isMarinaLike || isFeatureEnabled('submit_project');
  const canRFPs = isMarinaLike || isFeatureEnabled('submit_rfp');
  const canConsultations = isMarinaLike || isFeatureEnabled('submit_consultation');
  // Seeing a tab is not the same as being allowed to publish from it: the forms open only once the account AND the
  // organization are verified (the same rule as the Create menu). Until then the buttons that lead to them are
  // replaced by a line pointing to the dashboard, where the review status is explained.
  const createCtx = {
    isVerified: profile.access_status === 'verified',
    orgVerified: organization?.access_status === 'verified',
    persona: profile.persona,
    isFeatureEnabled,
  };
  const mayPublish = {
    project: canCreate('submit_project', createCtx),
    rfp: canCreate('submit_rfp', createCtx),
    consultation: canCreate('submit_consultation', createCtx),
    webinar: canCreate('request_webinar', createCtx),
  };
  const publishWhenVerified = t('accountArea.publishWhenVerified', 'You can publish once your organization is verified');
  const publishPendingLink = (
    <Link to="/dashboard" className="inline-flex min-h-10 items-center text-sm font-medium text-primary underline-offset-2 hover:underline">
      {publishWhenVerified}
    </Link>
  );
  // The project / RFP / consultation lists come from the main data load; they
  // are only final once that load ran with the current rights (a feature
  // grant that arrives late triggers a second load).
  const requestListsLoading = dataLoading || loadedKey !== fetchKey;

  // Refresh recommendation count (called from ReferenceRequestForm callbacks)
  const refreshOnboardingState = async () => {
    if (!organization?.id) return;
    const { count } = await supabase
      .from('reference_requests')
      .select('id', { count: 'exact' })
      .eq('partner_organization_id', organization.id);
    setReferenceCount(count || 0);
  };

  // Onboarding wizard step calculation
  // Step 1: Organization Details — complete when org exists
  // Step 2: Admin Review — waiting for admin approval
  // A member whose registration was just submitted (and is not yet reviewed)
  // is past step 1 whatever the organization state.
  const awaitingReview = profile.onboarding_status === 'submitted' && profile.access_status === 'pending';
  const currentOnboardingStep = isOnboarding && !org ? 1 : 2;

  // Notification badge counts for the menu
  const orgNeedsAction = profile.onboarding_status === 'draft' || !org;
  const pendingB2B = partnerRequests.filter(r => r.status === 'pending').length;

  const personaMeta = PERSONA_META[profile.persona as string];
  const personaLabel = personaMeta ? t(personaMeta.key, personaMeta.fallback) : '';
  const PersonaIcon = personaMeta?.icon ?? null;
  const accessMeta = ACCESS_META[profile.access_status];
  const displayName = profile.first_name || profile.last_name
    ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim()
    : '';
  const initials = `${(profile.first_name?.[0] || '').toUpperCase()}${(profile.last_name?.[0] || '').toUpperCase()}`
    || (user.email?.[0] || '?').toUpperCase();

  /* ------------------------------------------------------------ menu */

  // Who sees which section. Same rules as the old flat sidebar, one per tab.
  const sectionVisible: Record<AccountTab, boolean> = {
    registrations: true,
    event: hasSM26 === true,
    inbox: true,
    shortlist: isMarinaLike || isInvestor,
    projects: canProjects,
    rfps: canRFPs,
    consultations: canConsultations,
    webinars: true,
    submissions: canProjects || canRFPs || canConsultations || isPartner,
    organization: true,
    references: isPartnerOrg,
    sponsorship: (sponsorIds?.length ?? 0) > 0,
    press: isMedia === true,
    profile: true,
    notifications: true,
  };

  const onboardingMeta = {
    icon: ClipboardList,
    label: t('accountArea.onboarding.navLabel', 'Complete registration'),
    desc: t('accountArea.onboarding.navDesc', 'Two steps to join the network'),
    groupLabel: t('accountArea.menu.gettingStarted', 'Getting started'),
  };

  const menuItems: MenuItem[] = isOnboarding
    ? [{
        value: 'complete-registration', href: accountHref('complete-registration'), group: 'onboarding',
        label: onboardingMeta.label, desc: onboardingMeta.desc, icon: ClipboardList, notifDot: true,
      }]
    : ACCOUNT_SECTIONS.filter((s) => sectionVisible[s.value]).map((s) => ({
        value: s.value,
        href: accountHref(s.value),
        group: s.group,
        label: t(s.labelKey, s.fallback),
        desc: t(s.descKey, s.descFallback),
        icon: s.icon,
        notifDot: s.value === 'organization' && orgNeedsAction,
        notifCount: s.value === 'inbox' ? pendingB2B : 0,
      }));

  const menuGroups: MenuGroup[] = isOnboarding
    ? [{ key: 'onboarding', label: onboardingMeta.groupLabel }]
    : ACCOUNT_GROUPS
        .filter((g) => menuItems.some((i) => i.group === g.key))
        .map((g) => ({ key: g.key, label: t(g.labelKey, g.fallback) }));

  // What the header and the mobile switcher say about the open section.
  const accountSection = getAccountSection(activeTab);
  const currentMeta: { icon: LucideIcon; label: string; desc: string; groupLabel: string } | null =
    activeTab === 'complete-registration'
      ? onboardingMeta
      : accountSection
        ? {
            icon: accountSection.icon,
            label: t(accountSection.labelKey, accountSection.fallback),
            desc: t(accountSection.descKey, accountSection.descFallback),
            groupLabel: (() => {
              const g = ACCOUNT_GROUPS.find((x) => x.key === accountSection.group);
              return g ? t(g.labelKey, g.fallback) : '';
            })(),
          }
        : null;

  /* ------------------------------------------------------------ actions */

  // Allow self-cancel for everything except registrations that were actually
  // paid for (those need a refund flow) — the condition lives on the card.
  const handleUnregister = async (reg: EventRegistration) => {
    if (!confirm(t('accountArea.events.unregisterConfirm', 'Are you sure you want to unregister from this event?'))) return;
    const { error } = await supabase
      .from('event_registrations')
      .delete()
      .eq('id', reg.id);
    if (error) {
      toast({ title: t('accountArea.events.unregisterFailed', 'Failed to unregister'), description: error.message, variant: 'destructive' });
    } else {
      toast({ title: t('accountArea.events.unregistered', 'Unregistered from event') });
      setRegistrations(prev => prev.filter(r => r.id !== reg.id));
    }
  };

  const pickAvatar = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.onchange = (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) uploadImage(f, 'avatar'); };
    input.click();
  };

  const langLabel = (code: string) => code === 'EN'
    ? t('accountArea.lang.en', 'English')
    : t('accountArea.lang.fr', 'French');
  const under10k = t('accountArea.budgetUnder10k', 'Under €10k');

  /* ------------------------------------------------------------ sections */

  const unavailable = (
    <Panel>
      <EmptyState
        icon={Compass}
        title={t('accountArea.unavailable.title', "This section isn't available")}
        body={t('accountArea.unavailable.body', 'It may not apply to your account, or the link you followed is out of date.')}
        action={(
          <Button asChild variant="ctaNavy" size="sm">
            <Link to={isOnboarding ? accountHref('complete-registration') : '/dashboard'}>
              {isOnboarding
                ? t('accountArea.unavailable.toOnboarding', 'Continue my registration')
                : t('accountArea.unavailable.toDashboard', 'Back to the dashboard')}
            </Link>
          </Button>
        )}
      />
    </Panel>
  );
  const waiting = <Panel><RowSkeleton rows={2} /></Panel>;

  let content: ReactNode = null;
  let headerActions: ReactNode = null;
  let showHeader = true;

  switch (activeTab) {
    /* ── COMPLETE REGISTRATION (onboarding step-by-step wizard) ── */
    case 'complete-registration': {
      // Saving the organization during the wizard turns the draft into
      // 'submitted' while the URL stays here. That member has just finished
      // signing up, so they get the wizard's own "submitted for review" step,
      // not an error. Anyone else (verified, rejected) has nothing left to do
      // here and goes to the dashboard, which handles each status.
      if (!isOnboarding && !awaitingReview) {
        content = <Navigate to="/dashboard" replace />;
        showHeader = false;
        break;
      }
      content = (
        <div className="space-y-6">
          {/* Step indicator — always visible */}
          <Panel>
            <div className="p-5 sm:p-6">
              <p className="text-sm text-meta">
                {currentOnboardingStep === 1 && t('accountArea.onboarding.step1Intro', 'Fill in your organization details to get started.')}
                {currentOnboardingStep === 2 && t('accountArea.onboarding.step2Intro', 'Your profile is submitted for review.')}
              </p>
              <ol className="mt-5 flex items-center gap-3">
                {/* Step 1: Organization */}
                <li className="flex items-center gap-2">
                  <span className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold',
                    currentOnboardingStep > 1 ? 'bg-foam text-teal-text' : 'bg-navy text-white',
                  )}>
                    {currentOnboardingStep > 1 ? <Check className="h-4 w-4" aria-hidden="true" /> : '1'}
                  </span>
                  <span className={cn('text-[15px] font-semibold', currentOnboardingStep > 1 ? 'text-teal-text' : 'text-navy')}>
                    {t('accountArea.onboarding.stepOrganization', 'Organization')}
                  </span>
                </li>
                <li aria-hidden="true" className={cn('h-px flex-1', currentOnboardingStep > 1 ? 'bg-teal/40' : 'bg-rule')} />
                {/* Step 2: Admin Review */}
                <li className="flex items-center gap-2" aria-current={currentOnboardingStep === 2 ? 'step' : undefined}>
                  <span className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold',
                    currentOnboardingStep === 2 ? 'bg-navy text-white' : 'bg-chip text-meta',
                  )}>
                    2
                  </span>
                  <span className={cn('text-[15px] font-semibold', currentOnboardingStep === 2 ? 'text-navy' : 'text-meta')}>
                    {t('accountArea.onboarding.stepReview', 'Admin review')}
                  </span>
                </li>
              </ol>
            </div>
          </Panel>

          {/* ── Step 1: Organization Details ── */}
          {currentOnboardingStep === 1 && (
            <OrganizationTab />
          )}

          {/* ── Step 2: Admin Review ── */}
          {currentOnboardingStep === 2 && (
            <Panel>
              <div className="px-5 py-10 text-center">
                <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-foam">
                  <ShieldCheck className="h-8 w-8 text-teal" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-h3 text-navy">{t('accountArea.onboarding.submittedTitle', 'Profile submitted for review')}</h3>
                <p className="mx-auto mt-2 max-w-md text-meta">
                  {t('accountArea.onboarding.submittedBody', 'Thank you for completing your registration! Our team reviews profiles very quickly — you will receive a confirmation email as soon as your account is approved.')}
                </p>
                <p className="mt-3 flex items-center justify-center gap-2 text-sm text-meta">
                  <Clock className="h-4 w-4" aria-hidden="true" />
                  {t('accountArea.onboarding.reviewTime', 'Typical review time: less than 24 hours')}
                </p>
                <div className="flex flex-col items-center gap-2 pt-5">
                  <Button
                    variant="outline"
                    className={cn(BTN, 'gap-2')}
                    onClick={() => navigate('/account?tab=organization', { replace: true })}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                    {t('accountArea.onboarding.editRegistration', 'Edit my registration')}
                  </Button>
                  {/* The amber "being reviewed" banner is folded into this
                      step on this view, so its support link moves here. */}
                  {awaitingReview && (
                    <Link to="/contact" className="inline-flex min-h-10 items-center rounded text-sm font-medium text-primary underline underline-offset-2 hover:text-primary/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
                      {t('accountArea.banner.contactSupport', 'Questions? Contact support')}
                    </Link>
                  )}
                </div>
              </div>
            </Panel>
          )}
        </div>
      );
      break;
    }

    /* ── ORGANIZATION ── */
    case 'organization':
      content = <OrganizationWorkspace />;
      break;

    /* ── PROFILE ── */
    case 'profile': {
      content = (
        <div className="space-y-6">
          {/* Photo + identity */}
          <Panel>
            <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
              <div className="group relative w-fit shrink-0">
                {profile.avatar_url ? (
                  <img src={profile.avatar_url} alt={t('accountArea.profile.avatarAlt', 'Your profile photo')} className="h-20 w-20 rounded-full border-2 border-rule object-cover" />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-rule bg-chip text-xl font-bold text-primary">
                    {(profile.first_name?.[0] || '').toUpperCase()}{(profile.last_name?.[0] || '').toUpperCase()}
                  </div>
                )}
                <label className="absolute inset-0 flex cursor-pointer items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                  {uploadingAvatar ? (
                    <Loader2 className="h-5 w-5 animate-spin text-white" aria-hidden="true" />
                  ) : (
                    <Camera className="h-5 w-5 text-white" aria-hidden="true" />
                  )}
                  <span className="sr-only">{t('accountArea.profile.changePhoto', 'Change photo')}</span>
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => { if (e.target.files?.[0]) uploadImage(e.target.files[0], 'avatar'); }} disabled={uploadingAvatar} />
                </label>
              </div>
              <div className="min-w-0">
                <p className="text-lg font-semibold text-navy">
                  {displayName || user.email?.split('@')[0] || t('accountArea.profile.myProfile', 'My Profile')}
                </p>
                <p className="break-all text-sm text-meta">{user.email}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {profile.job_title && <span className="text-sm text-meta">{profile.job_title}</span>}
                  {personaLabel && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-chip px-2.5 py-0.5 text-xs font-medium text-primary">
                      {PersonaIcon && <PersonaIcon className="h-3.5 w-3.5" aria-hidden="true" />}
                      {personaLabel}
                    </span>
                  )}
                </div>
                <label className="mt-3 inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-xl border border-rule bg-white px-3 text-sm font-medium text-ink hover:bg-page focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2">
                  {uploadingAvatar ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
                  {profile.avatar_url ? t('accountArea.profile.changePhoto', 'Change photo') : t('accountArea.profile.uploadPhoto', 'Upload photo')}
                  <input type="file" accept="image/*" className="sr-only" onChange={(e) => { if (e.target.files?.[0]) uploadImage(e.target.files[0], 'avatar'); }} disabled={uploadingAvatar} />
                </label>
                <p className="mt-1.5 text-xs text-meta">{t('accountArea.profile.photoHelp', 'Square JPG, PNG or WebP · up to 25 MB. Large photos are optimised automatically.')}</p>
              </div>
            </div>
          </Panel>

          {/* Personal Information */}
          <Panel
            title={t('accountArea.profile.personalInfo', 'Personal information')}
            icon={UserCircle}
            actions={!editingProfile ? (
              <Button variant="outline" size="sm" onClick={() => setEditingProfile(true)} className={cn(BTN_OUTLINE, 'gap-2')}>
                <Pencil className="h-4 w-4" aria-hidden="true" />
                {t('accountArea.profile.edit', 'Edit profile')}
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className={BTN_OUTLINE} onClick={() => {
                  setEditingProfile(false);
                  // Reset form to current profile values
                  if (profile) {
                    setProfileForm({
                      firstName: profile.first_name || '',
                      lastName: profile.last_name || '',
                      jobTitle: profile.job_title || '',
                    });
                  }
                }}>
                  {t('common.cancel', 'Cancel')}
                </Button>
                <Button size="sm" onClick={handleSaveProfile} disabled={savingProfile} className={cn(BTN, 'gap-2')}>
                  {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                  {t('common.save', 'Save')}
                </Button>
              </div>
            )}
          >
            <div className="p-5">
              {editingProfile ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-firstName">{t('accountArea.profile.firstName', 'First name')}</Label>
                    <Input
                      id="edit-firstName"
                      value={profileForm.firstName}
                      onChange={(e) => setProfileForm(prev => ({ ...prev, firstName: e.target.value }))}
                      placeholder={t('accountArea.profile.firstName', 'First name')}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-lastName">{t('accountArea.profile.lastName', 'Last name')}</Label>
                    <Input
                      id="edit-lastName"
                      value={profileForm.lastName}
                      onChange={(e) => setProfileForm(prev => ({ ...prev, lastName: e.target.value }))}
                      placeholder={t('accountArea.profile.lastName', 'Last name')}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-email">{t('accountArea.profile.email', 'Email')}</Label>
                    <Input id="edit-email" value={user.email || ''} disabled className="bg-page" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-jobTitle">{t('accountArea.profile.jobTitle', 'Job title')}</Label>
                    <Input
                      id="edit-jobTitle"
                      value={profileForm.jobTitle}
                      onChange={(e) => setProfileForm(prev => ({ ...prev, jobTitle: e.target.value }))}
                      placeholder={t('accountArea.profile.jobTitle', 'Job title')}
                    />
                  </div>
                </div>
              ) : (
                <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label={t('accountArea.profile.firstName', 'First name')}>{profile.first_name || '—'}</Field>
                  <Field label={t('accountArea.profile.lastName', 'Last name')}>{profile.last_name || '—'}</Field>
                  <Field label={t('accountArea.profile.email', 'Email')}>{user.email}</Field>
                  {profile.job_title && (
                    <Field label={t('accountArea.profile.jobTitle', 'Job title')}>{profile.job_title}</Field>
                  )}
                </dl>
              )}
            </div>
          </Panel>

          {/* Account Details */}
          <Panel title={t('accountArea.profile.accountDetails', 'Account details')} icon={ShieldCheck}>
            <dl className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
              <Field label={t('accountArea.profile.persona', 'Profile type')}>{personaLabel || '—'}</Field>
              <Field label={t('accountArea.profile.status', 'Status')}>
                {accessMeta ? t(accessMeta.key, accessMeta.fallback) : humanize(profile.access_status)}
              </Field>
              {orgRole && (
                <Field label={t('accountArea.profile.orgRole', 'Organization role')}>{t(`org.${orgRole}`, humanize(orgRole))}</Field>
              )}
              <Field label={t('accountArea.profile.registered', 'Member since')}>
                {fmtDate(profile.created_at, { year: 'numeric', month: 'long', day: 'numeric' })}
              </Field>
            </dl>
          </Panel>

          {/* Organization details (from org context) */}
          {org && (
            <Panel
              title={t('accountArea.profile.organization', 'Organization')}
              icon={Building2}
              actions={(
                <Link to="/account?tab=organization" className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-primary hover:underline underline-offset-2">
                  {t('accountArea.profile.manageOrg', 'Manage organization')}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              )}
            >
              <div className="space-y-4 p-5">
                <div className="flex items-center gap-3">
                  <LogoBadge src={org.logo_url} name={org.name || '—'} size="lg" />
                  <p className="font-semibold text-navy">{org.name || '—'}</p>
                </div>
                {(org.country || org.city || org.headquarters_country) && (
                  <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    {org.country && <Field label={t('accountArea.profile.country', 'Country')}>{org.country}</Field>}
                    {org.city && <Field label={t('accountArea.profile.city', 'City')}>{org.city}</Field>}
                    {org.headquarters_country && <Field label={t('accountArea.profile.hqCountry', 'Headquarters country')}>{org.headquarters_country}</Field>}
                  </dl>
                )}
                {org.description && (
                  <div className="text-sm">
                    <p className="mb-1 text-xs font-medium text-meta">{t('accountArea.profile.description', 'Description')}</p>
                    <p className="text-ink">{org.description}</p>
                  </div>
                )}
                {org.audience_description && (
                  <div className="text-sm">
                    <p className="mb-1 text-xs font-medium text-meta">{t('accountArea.profile.audience', 'Audience')}</p>
                    <p className="text-ink">{org.audience_description}</p>
                  </div>
                )}
                {org.website && (
                  <a href={externalUrl(org.website) ?? undefined} target="_blank" rel="noopener noreferrer"
                    className="inline-flex min-h-10 items-center gap-1.5 break-all text-sm text-primary hover:underline">
                    <Globe className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {org.website}
                  </a>
                )}
              </div>
            </Panel>
          )}

          {profile.onboarding_status === 'draft' && (
            <div>
              <Button onClick={() => navigate('/account?tab=organization', { replace: true })} variant="outline" className={BTN_OUTLINE}>
                {t('accountArea.banner.completeProfile', 'Complete my profile')}
              </Button>
            </div>
          )}

          {/* Security */}
          <Panel title={t('accountArea.profile.security', 'Security')} icon={KeyRound}>
            <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-meta">{t('accountArea.profile.securityHelp', "We'll email you a link to choose a new password.")}</p>
              <Button
                variant="outline"
                className={cn(BTN, 'shrink-0 gap-2')}
                onClick={async () => {
                  if (!user?.email) return;
                  // /reset-password is the page that redeems the e-mailed link (any
                  // device) and shows the new-password form; `next` brings them back
                  // here afterwards, still signed in.
                  const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
                    redirectTo: `${window.location.origin}/reset-password?next=${encodeURIComponent('/account?tab=profile')}`,
                  });
                  if (error) {
                    toast({ title: t('accountArea.toast.error', 'Error'), description: error.message, variant: 'destructive' });
                  } else {
                    toast({ title: t('accountArea.toast.passwordReset', 'Password reset email sent'), description: t('accountArea.toast.passwordResetDesc', 'Check your inbox for a link to reset your password.') });
                  }
                }}
              >
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                {t('accountArea.profile.changePassword', 'Change password')}
              </Button>
            </div>
          </Panel>

          {/* Preview profile button */}
          <div>
            <Button variant="outline" onClick={() => setPreviewOpen(true)} className={cn(BTN_OUTLINE, 'gap-2')}>
              <Eye className="h-4 w-4" aria-hidden="true" />
              {t('accountArea.profile.preview', 'Preview my profile')}
            </Button>
          </div>
        </div>
      );
      break;
    }

    /* ── MY EVENTS ── */
    case 'registrations':
      headerActions = (
        <Button asChild variant="outline" className={cn(BTN_OUTLINE, 'gap-2')}>
          <Link to="/events">
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            {t('accountArea.events.browse', 'Browse events')}
          </Link>
        </Button>
      );
      content = (
        <MyEvents
          uid={uid ?? null}
          registrations={registrations}
          loading={dataLoading}
          locale={locale}
          onUnregister={handleUnregister}
        />
      );
      break;

    /* ── PROJECTS (marina or entitlement-granted) ── */
    case 'projects':
      if (!canProjects) {
        if (entPending) content = waiting;
        else { content = unavailable; showHeader = false; }
        break;
      }
      headerActions = mayPublish.project ? (
        <Button variant="cta" size="sm" onClick={() => navigate('/submit-project')}>{t('accountArea.projects.submit', 'Submit a project')}</Button>
      ) : publishPendingLink;
      content = (
        <Panel>
          {requestListsLoading ? (
            <RowSkeleton rows={2} />
          ) : projects.length === 0 ? (
            <EmptyState icon={Anchor} title={t('accountArea.projects.empty', 'No projects submitted yet.')} body={t('accountArea.projects.emptyBody', 'Describe a need and the right service providers come to you.')} />
          ) : (
            <ul className="divide-y divide-rule">
              {projects.map((project) => (
                <ItemRow
                  key={project.id}
                  icon={Anchor}
                  title={humanize(project.project_type)}
                  meta={[
                    fmtDate(project.created_at),
                    project.budget_range ? formatBudgetRange(project.budget_range, under10k) : null,
                  ]}
                  aside={(
                    <>
                      {project.status === 'new' && (
                        <Button variant="outline" size="sm" className={BTN_OUTLINE} onClick={() => navigate(`/submit-project/${project.id}`)}>
                          <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" />{t('common.edit', 'Edit')}
                        </Button>
                      )}
                      <SubmissionStatusBadge status={project.status} />
                    </>
                  )}
                />
              ))}
            </ul>
          )}
        </Panel>
      );
      break;

    /* ── WEBINAR REQUESTS ── */
    case 'webinars':
      // Every verified member can propose a webinar (the tier gating is gone, as the proposal form itself says).
      if (profile?.access_status === 'verified') {
        headerActions = mayPublish.webinar ? (
          <Button variant="cta" size="sm" onClick={() => navigate('/request-webinar')}>{t('accountArea.webinars.propose', 'Propose a webinar')}</Button>
        ) : publishPendingLink;
      }
      content = (
        <Panel>
          {profile?.access_status !== 'verified' ? (
            <EmptyState
              icon={Clock}
              tone="amber"
              title={t('accountArea.webinars.pendingTitle', 'Account pending approval')}
              body={t('accountArea.webinars.pendingBody', "You'll be able to propose webinars once your profile is verified by our team.")}
            />
          ) : dataLoading ? (
            <RowSkeleton rows={2} />
          ) : webinarRequests.length === 0 ? (
            <EmptyState
              icon={Radio}
              title={t('accountArea.webinars.empty', 'No webinar requests submitted.')}
              action={!mayPublish.webinar ? undefined : (
                <Button variant="ctaNavy" size="sm" onClick={() => navigate('/request-webinar')}>
                  {t('accountArea.webinars.proposeTopic', 'Propose a topic')}
                </Button>
              )}
            />
          ) : (
            <ul className="divide-y divide-rule">
              {webinarRequests.map((req) => (
                <ItemRow
                  key={req.id}
                  icon={Radio}
                  title={req.title}
                  meta={[langLabel(req.preferred_language), req.preferred_timeframe, fmtDate(req.created_at)]}
                  aside={<WebinarStatusBadge status={req.status} />}
                  footer={(
                    <>
                      {req.moderator_notes && (
                        <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
                          <span className="font-medium">{t('accountArea.webinars.teamNote', 'Team note:')}</span>{' '}
                          {req.moderator_notes}
                        </div>
                      )}
                      {req.status === 'submitted' && (
                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" size="sm" className={BTN_OUTLINE} onClick={() => navigate(`/request-webinar?edit=${req.id}`)}>
                            <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" />{t('common.edit', 'Edit')}
                          </Button>
                          <Button variant="ghost" size="sm" className={cn(BTN, 'text-red-600 hover:bg-red-50 hover:text-red-700')} onClick={async () => {
                            if (!confirm(t('accountArea.webinars.withdrawConfirm', 'Withdraw this webinar request?'))) return;
                            await supabase.from('webinar_requests').delete().eq('id', req.id);
                            setWebinarRequests(prev => prev.filter(r => r.id !== req.id));
                            toast({ title: t('accountArea.webinars.deleted', 'Request deleted') });
                          }}>
                            <X className="mr-1 h-4 w-4" aria-hidden="true" />{t('accountArea.webinars.withdraw', 'Withdraw')}
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                />
              ))}
            </ul>
          )}
        </Panel>
      );
      break;

    /* ── RFPs (marina or entitlement-granted) ── */
    case 'rfps':
      if (!canRFPs) {
        if (entPending) content = waiting;
        else { content = unavailable; showHeader = false; }
        break;
      }
      headerActions = mayPublish.rfp ? (
        <Button variant="cta" size="sm" onClick={() => navigate('/submit-rfp')}>{t('accountArea.rfps.submit', 'Submit an RFP')}</Button>
      ) : publishPendingLink;
      content = (
        <Panel>
          {requestListsLoading ? (
            <RowSkeleton rows={2} />
          ) : rfps.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title={t('accountArea.rfps.empty', 'No RFPs submitted.')}
              action={!mayPublish.rfp ? undefined : (
                <Button variant="ctaNavy" size="sm" onClick={() => navigate('/submit-rfp')}>
                  {t('accountArea.rfps.create', 'Create an RFP')}
                </Button>
              )}
            />
          ) : (
            <ul className="divide-y divide-rule">
              {rfps.map((rfp) => (
                <ItemRow
                  key={rfp.id}
                  icon={ClipboardList}
                  title={rfp.title}
                  description={rfp.scope}
                  meta={[
                    rfp.deadline_date ? t('accountArea.rfps.deadline', { date: fmtDate(rfp.deadline_date), defaultValue: 'Deadline: {{date}}' }) : null,
                    t('accountArea.common.created', { date: fmtDate(rfp.created_at), defaultValue: 'Created {{date}}' }),
                  ]}
                  rejection={rfp.status === 'rejected' ? rfp.rejection_reason : null}
                  aside={<SubmissionStatusBadge status={rfp.status || (rfp.is_open ? 'open' : 'closed')} />}
                  footer={(
                    <div className="flex flex-wrap gap-2">
                      {(rfp.status === 'submitted' || rfp.status === 'rejected') && (
                        <Button variant="outline" size="sm" className={BTN_OUTLINE} onClick={() => navigate(`/submit-rfp/${rfp.id}`)}>
                          <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" />{t('common.edit', 'Edit')}
                        </Button>
                      )}
                      <Button variant="outline" size="sm" className={BTN_OUTLINE} onClick={async () => {
                        const newOpen = !rfp.is_open;
                        await supabase.from('rfps').update({ is_open: newOpen }).eq('id', rfp.id);
                        setRfps(prev => prev.map(r => r.id === rfp.id ? { ...r, is_open: newOpen } : r));
                        toast({ title: newOpen ? t('accountArea.rfps.reopened', 'RFP reopened') : t('accountArea.rfps.closed', 'RFP closed') });
                      }}>
                        {rfp.is_open ? t('accountArea.common.close', 'Close') : t('accountArea.common.reopen', 'Reopen')}
                      </Button>
                      <Button variant="ghost" size="sm" className={cn(BTN, 'text-red-600 hover:bg-red-50 hover:text-red-700')} onClick={async () => {
                        if (!confirm(t('accountArea.rfps.deleteConfirm', 'Delete this RFP?'))) return;
                        await supabase.from('rfps').delete().eq('id', rfp.id);
                        setRfps(prev => prev.filter(r => r.id !== rfp.id));
                        toast({ title: t('accountArea.rfps.deleted', 'RFP deleted') });
                      }}>
                        <X className="mr-1 h-4 w-4" aria-hidden="true" />{t('common.delete', 'Delete')}
                      </Button>
                    </div>
                  )}
                />
              ))}
            </ul>
          )}
        </Panel>
      );
      break;

    /* ── CONSULTATIONS (marina or entitlement-granted) ── */
    case 'consultations':
      if (!canConsultations) {
        if (entPending) content = waiting;
        else { content = unavailable; showHeader = false; }
        break;
      }
      headerActions = mayPublish.consultation ? (
        <Button variant="cta" size="sm" onClick={() => navigate('/submit-consultation')}>{t('accountArea.consultations.new', 'New consultation')}</Button>
      ) : publishPendingLink;
      content = (
        <Panel>
          {requestListsLoading ? (
            <RowSkeleton rows={2} />
          ) : consultations.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              title={t('accountArea.consultations.empty', 'No consultations submitted.')}
              action={!mayPublish.consultation ? undefined : (
                <Button variant="ctaNavy" size="sm" onClick={() => navigate('/submit-consultation')}>
                  {t('accountArea.consultations.ask', 'Ask a question')}
                </Button>
              )}
            />
          ) : (
            <ul className="divide-y divide-rule">
              {consultations.map((c) => (
                <ItemRow
                  key={c.id}
                  icon={MessageSquare}
                  title={c.title}
                  description={c.description}
                  meta={[t('accountArea.common.created', { date: fmtDate(c.created_at), defaultValue: 'Created {{date}}' })]}
                  rejection={c.status === 'rejected' ? c.rejection_reason : null}
                  aside={<SubmissionStatusBadge status={c.status || (c.is_open ? 'open' : 'closed')} />}
                  footer={(
                    <div className="flex flex-wrap gap-2">
                      {(c.status === 'submitted' || c.status === 'rejected') && (
                        <Button variant="outline" size="sm" className={BTN_OUTLINE} onClick={() => navigate(`/submit-consultation/${c.id}`)}>
                          <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" />{t('common.edit', 'Edit')}
                        </Button>
                      )}
                      <Button variant="outline" size="sm" className={BTN_OUTLINE} onClick={async () => {
                        const newOpen = !c.is_open;
                        await supabase.from('consultations').update({ is_open: newOpen }).eq('id', c.id);
                        setConsultations(prev => prev.map(x => x.id === c.id ? { ...x, is_open: newOpen } : x));
                        toast({ title: newOpen ? t('accountArea.consultations.reopened', 'Consultation reopened') : t('accountArea.consultations.closed', 'Consultation closed') });
                      }}>
                        {c.is_open ? t('accountArea.common.close', 'Close') : t('accountArea.common.reopen', 'Reopen')}
                      </Button>
                      <Button variant="ghost" size="sm" className={cn(BTN, 'text-red-600 hover:bg-red-50 hover:text-red-700')} onClick={async () => {
                        if (!confirm(t('accountArea.consultations.deleteConfirm', 'Delete this consultation?'))) return;
                        await supabase.from('consultations').delete().eq('id', c.id);
                        setConsultations(prev => prev.filter(x => x.id !== c.id));
                        toast({ title: t('accountArea.consultations.deleted', 'Consultation deleted') });
                      }}>
                        <X className="mr-1 h-4 w-4" aria-hidden="true" />{t('common.delete', 'Delete')}
                      </Button>
                    </div>
                  )}
                />
              ))}
            </ul>
          )}
        </Panel>
      );
      break;

    /* S3 Pre-Audit archived — will be deployed later */

    /* ── RECOMMENDATIONS (gated on org type, not user persona, so
        admin/moderator/owner of a partner org all have access) ── */
    case 'references':
      if (!isPartnerOrg) { content = unavailable; showHeader = false; break; }
      content = <ReferenceRequestForm onReferenceSubmitted={refreshOnboardingState} />;
      break;

    /* ── MY SUBMISSIONS ── */
    case 'submissions': {
      if (!sectionVisible.submissions) {
        if (entPending) content = waiting;
        else { content = unavailable; showHeader = false; }
        break;
      }
      const nothingYet = subProjects.length === 0 && subRfps.length === 0 && subConsultations.length === 0 && subWebinars.length === 0;
      content = submissionsLoading || entPending ? waiting : (
        <div className="space-y-4">
          {/* Summary if everything is empty */}
          {nothingYet && (
            <Panel>
              <EmptyState
                icon={FileText}
                title={t('accountArea.submissions.emptyTitle', 'No submissions yet')}
                body={t('accountArea.submissions.emptyBody', 'Start by submitting a project, RFP, consultation, or webinar request.')}
              />
            </Panel>
          )}

          {/* ── Projects Section ── */}
          {canProjects && (
            <SubmissionGroup
              id="projects"
              icon={Anchor}
              title={t('accountArea.submissions.projects', 'My projects')}
              count={subProjects.length}
              open={expandedSections.projects}
              onToggle={() => toggleSection('projects')}
            >
              {subProjects.length === 0 ? (
                <GroupEmpty text={t('accountArea.submissions.noProjects', 'No projects submitted yet.')} linkTo={mayPublish.project ? '/submit-project' : '/dashboard'} linkLabel={mayPublish.project ? t('accountArea.projects.submit', 'Submit a project') : publishWhenVerified} />
              ) : (
                <ul className="divide-y divide-rule">
                  {subProjects.map((p) => (
                    <CompactRow
                      key={p.id}
                      title={humanize(p.project_type)}
                      meta={[
                        fmtDate(p.created_at),
                        p.budget_range ? formatBudgetRange(p.budget_range, under10k) : null,
                        p.timeline ? p.timeline.replace(/_/g, ' ') : null,
                      ]}
                      editLabel={t('common.edit', 'Edit')}
                      onEdit={p.status === 'new' ? () => navigate(`/submit-project/${p.id}`) : undefined}
                      status={p.status}
                    />
                  ))}
                </ul>
              )}
            </SubmissionGroup>
          )}

          {/* ── RFPs Section ── */}
          {canRFPs && (
            <SubmissionGroup
              id="rfps"
              icon={ClipboardList}
              title={t('accountArea.submissions.rfps', 'My RFPs')}
              count={subRfps.length}
              open={expandedSections.rfps}
              onToggle={() => toggleSection('rfps')}
            >
              {subRfps.length === 0 ? (
                <GroupEmpty text={t('accountArea.submissions.noRfps', 'No RFPs submitted yet.')} linkTo={mayPublish.rfp ? '/submit-rfp' : '/dashboard'} linkLabel={mayPublish.rfp ? t('accountArea.rfps.submit', 'Submit an RFP') : publishWhenVerified} />
              ) : (
                <ul className="divide-y divide-rule">
                  {subRfps.map((r) => (
                    <CompactRow
                      key={r.id}
                      title={r.title}
                      description={r.scope}
                      meta={[
                        r.deadline_date ? t('accountArea.rfps.deadline', { date: fmtDate(r.deadline_date), defaultValue: 'Deadline: {{date}}' }) : null,
                        t('accountArea.common.created', { date: fmtDate(r.created_at), defaultValue: 'Created {{date}}' }),
                      ]}
                      rejection={r.status === 'rejected' ? r.rejection_reason : null}
                      editLabel={t('common.edit', 'Edit')}
                      onEdit={(r.status === 'submitted' || r.status === 'rejected') ? () => navigate(`/submit-rfp/${r.id}`) : undefined}
                      status={r.status || (r.is_open ? 'open' : 'closed')}
                    />
                  ))}
                </ul>
              )}
            </SubmissionGroup>
          )}

          {/* ── Consultations Section ── */}
          {canConsultations && (
            <SubmissionGroup
              id="consultations"
              icon={MessageSquare}
              title={t('accountArea.submissions.consultations', 'My consultations')}
              count={subConsultations.length}
              open={expandedSections.consultations}
              onToggle={() => toggleSection('consultations')}
            >
              {subConsultations.length === 0 ? (
                <GroupEmpty text={t('accountArea.submissions.noConsultations', 'No consultations submitted yet.')} linkTo={mayPublish.consultation ? '/submit-consultation' : '/dashboard'} linkLabel={mayPublish.consultation ? t('accountArea.submissions.startConsultation', 'Start a consultation') : publishWhenVerified} />
              ) : (
                <ul className="divide-y divide-rule">
                  {subConsultations.map((c) => (
                    <CompactRow
                      key={c.id}
                      title={c.title}
                      description={c.description}
                      meta={[t('accountArea.common.created', { date: fmtDate(c.created_at), defaultValue: 'Created {{date}}' })]}
                      rejection={c.status === 'rejected' ? c.rejection_reason : null}
                      editLabel={t('common.edit', 'Edit')}
                      onEdit={(c.status === 'submitted' || c.status === 'rejected') ? () => navigate(`/submit-consultation/${c.id}`) : undefined}
                      status={c.status || (c.is_open ? 'open' : 'closed')}
                    />
                  ))}
                </ul>
              )}
            </SubmissionGroup>
          )}

          {/* ── Webinar Requests Section (all users) ── */}
          <SubmissionGroup
            id="webinars"
            icon={Radio}
            title={t('accountArea.submissions.webinars', 'My webinar requests')}
            count={subWebinars.length}
            open={expandedSections.webinars}
            onToggle={() => toggleSection('webinars')}
          >
            {subWebinars.length === 0 ? (
              <GroupEmpty text={t('accountArea.submissions.noWebinars', 'No webinar requests submitted yet.')} linkTo={mayPublish.webinar ? '/request-webinar' : '/dashboard'} linkLabel={mayPublish.webinar ? t('accountArea.webinars.propose', 'Propose a webinar') : publishWhenVerified} />
            ) : (
              <ul className="divide-y divide-rule">
                {subWebinars.map((w) => (
                  <CompactRow
                    key={w.id}
                    title={w.title}
                    meta={[langLabel(w.preferred_language), fmtDate(w.created_at)]}
                    status={w.status}
                  />
                ))}
              </ul>
            )}
          </SubmissionGroup>
        </div>
      );
      break;
    }

    /* ── INBOX (unified) ── */
    case 'inbox':
      content = <InboxTab />;
      break;

    /* ── SHORTLIST (marina + developer + investor) ── */
    case 'shortlist':
      if (!(isMarinaLike || isInvestor)) { content = unavailable; showHeader = false; break; }
      content = <ShortlistTab />;
      break;

    /* ── NOTIFICATIONS ── */
    case 'notifications':
      content = <NotificationPreferencesTab />;
      break;

    /* ── PRESS ROOM ── */
    case 'press':
      content = (
        <div className="space-y-6">
          <MediaPressRoom />
          <MediaArticles />
        </div>
      );
      break;

    /* ── EVENT HUB (SM26) ── */
    case 'event':
      if (hasSM26 === null) { content = waiting; break; }
      if (!hasSM26) { content = unavailable; showHeader = false; break; }
      content = <SM26MyRegistrationPage embedded />;
      break;

    /* ── SPONSORSHIP ── */
    case 'sponsorship':
      if (sponsorIds === null) { content = waiting; break; }
      if (sponsorIds.length === 0) { content = unavailable; showHeader = false; break; }
      content = <SponsorPortal sponsorIds={sponsorIds} />;
      break;

    /* ── Deprecated: the effect above forwards it to /inbox ── */
    case 'b2b-requests':
      showHeader = false;
      break;

    default:
      showHeader = false;
      // A draft with no tab yet is being forwarded to complete-registration.
      content = isOnboarding && !forceTab && !searchParams.get('tab') ? null : unavailable;
  }

  const pageTitle = currentMeta && showHeader ? currentMeta.label : t('accountArea.title', 'My account');

  /* ------------------------------------------------------------ render */

  return (
    <div className="min-h-screen bg-page pb-20">
      <Helmet>
        <title>{`${pageTitle} — Smart Marina Connect`}</title>
      </Helmet>

      {/* ── Header band: the organization's cover when it has one, the sea-toned gradient otherwise ── */}
      <MemberHeader
        image={org?.banner_url ? { src: org.banner_url, focusY: 0.5 } : null}
        seed={orgId ?? uid ?? 'member'}
        icon={Ship}
        eyebrow={t('accountArea.header.eyebrow', 'Member area')}
        title={displayName || t('accountArea.title', 'My account')}
        leading={(
          /* Avatar: the whole circle is the upload button */
          <button
            type="button"
            onClick={pickAvatar}
            className="group relative h-16 w-16 shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-navy md:h-[72px] md:w-[72px]"
            aria-label={t('accountArea.header.changePhoto', 'Change your profile photo')}
          >
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt="" className="h-full w-full rounded-full border-2 border-white/60 object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center rounded-full border-2 border-white/40 bg-white/15 text-xl font-semibold">
                {initials}
              </span>
            )}
            <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              {uploadingAvatar ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
            </span>
            <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-white text-navy ring-2 ring-navy">
              {uploadingAvatar ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
            </span>
          </button>
        )}
      >
        {personaLabel && (
          <span className="inline-flex items-center gap-1.5">
            {PersonaIcon && <PersonaIcon className="h-4 w-4 shrink-0" aria-hidden="true" />}
            {personaLabel}
          </span>
        )}
        {org && (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <Building2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="[overflow-wrap:anywhere]">{org.name}</span>
          </span>
        )}
        {accessMeta && (
          <BandPill tone={profile.access_status === 'rejected' ? 'danger' : profile.access_status === 'pending' ? 'warning' : 'neutral'} icon={accessMeta.icon}>
            {t(accessMeta.key, accessMeta.fallback)}
          </BandPill>
        )}
      </MemberHeader>

      <div className="mx-auto w-full max-w-7xl px-4 pt-6 sm:px-6 sm:pt-8 md:pt-10">
        {/* Incomplete onboarding banner — hidden during onboarding since complete-registration tab has guidance */}
        {!isOnboarding && profile.onboarding_status === 'draft' && (
          <StatusBanner
            tone="blue"
            icon={ClipboardList}
            title={t('accountArea.banner.incomplete', 'Your profile is incomplete. Complete your organization details to be validated by our team.')}
            action={(
              <Button size="sm" className={cn(BTN, 'w-full sm:w-auto')} onClick={() => navigate('/account?tab=complete-registration', { replace: true })}>
                {t('accountArea.banner.completeProfile', 'Complete my profile')}
              </Button>
            )}
          />
        )}

        {/* Pending validation banner — on the registration view the
            "submitted for review" step says the same thing, so it is not repeated */}
        {awaitingReview && activeTab !== 'complete-registration' && (
          <StatusBanner
            tone="amber"
            icon={AlertCircle}
            title={t('accountArea.banner.pendingTitle', 'Your profile is being reviewed by our team.')}
            body={t('accountArea.banner.pendingBody', 'You will receive a confirmation email.')}
            action={(
              <Link to="/contact" className="inline-flex min-h-10 items-center font-medium underline underline-offset-2 hover:text-yellow-950">
                {t('accountArea.banner.contactSupport', 'Questions? Contact support')}
              </Link>
            )}
          />
        )}

        {/* Payment banners removed — member tier is free, sponsor upgrades handled via contact */}

        {/* Rejected account banner */}
        {profile.access_status === 'rejected' && (
          <StatusBanner
            tone="red"
            icon={XCircle}
            title={t('accountArea.banner.rejectedTitle', 'Your access request has been rejected.')}
            body={profile.rejection_reason ? t('accountArea.banner.rejectedReason', { reason: profile.rejection_reason, defaultValue: 'Reason: {{reason}}' }) : undefined}
            action={(
              <Button size="sm" variant="outline" className={BTN_OUTLINE} onClick={() => navigate('/onboarding')}>
                {t('accountArea.banner.resubmit', 'Edit and resubmit')}
              </Button>
            )}
          />
        )}

        {/* The sidebar starts at lg: below that, a 240 px column would squeeze
            the embedded forms (organization, plans), so tablets get the same
            compact switcher as phones and the full width. */}
        <div className="lg:grid lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-10">
          {/* ── Desktop menu ── */}
          <aside className="hidden lg:block">
            <nav
              aria-label={t('accountArea.menu.label', 'Member area')}
              className={cn(CARD, 'sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto p-3')}
            >
              {!isOnboarding && <BackToDashboard />}
              <MenuList groups={menuGroups} items={menuItems} activeTab={activeTab} />
            </nav>
          </aside>

          <div className="min-w-0">
            {/* ── Phone & tablet: current section + the grouped list behind one button ── */}
            <div className="mb-5 lg:hidden">
              {!isOnboarding && <BackToDashboard compact />}
              <MobileSectionSwitcher
                current={currentMeta && showHeader ? currentMeta : null}
                groups={menuGroups}
                items={menuItems}
                activeTab={activeTab}
              />
            </div>

            {showHeader && currentMeta && (
              <SectionHeader eyebrow={currentMeta.groupLabel} title={currentMeta.label} description={currentMeta.desc} actions={headerActions} />
            )}

            {content}
          </div>
        </div>
      </div>

      {/* ── PROFILE PREVIEW DIALOG ── */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-center">{t('accountArea.previewDialog.title', 'Profile preview')}</DialogTitle>
            <p className="text-center text-xs text-meta">{t('accountArea.previewDialog.subtitle', 'This is how other users see your profile')}</p>
          </DialogHeader>

          <div className="space-y-6 pt-2">
            {/* Avatar + Name + Persona */}
            <div className="flex flex-col items-center gap-3 text-center">
              {profile.avatar_url ? (
                <img src={profile.avatar_url} alt="" className="h-24 w-24 rounded-full border-2 border-primary/20 object-cover shadow" />
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-primary/20 bg-chip text-2xl font-bold text-primary shadow">
                  {(profile.first_name?.[0] || '').toUpperCase()}{(profile.last_name?.[0] || '').toUpperCase()}
                </div>
              )}
              <div>
                <h3 className="text-lg font-semibold text-navy">
                  {profile.first_name} {profile.last_name}
                </h3>
                {personaLabel && (
                  <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-rule px-2.5 py-0.5 text-xs font-medium text-ink">
                    {PersonaIcon && <PersonaIcon className="h-3.5 w-3.5" aria-hidden="true" />} {personaLabel}
                  </span>
                )}
              </div>
            </div>

            {/* Organization Card */}
            {org && (
              <div className="space-y-3 rounded-card bg-page p-4">
                {/* Logo + Org Name */}
                <div className="flex items-center gap-3">
                  <LogoBadge src={org.logo_url} name={org.name || '—'} size="md" />
                  <div className="font-semibold text-navy">{org.name}</div>
                </div>

                {/* Details grid */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {(org.city || org.country) && (
                    <div>
                      <span className="text-xs text-meta">{t('accountArea.previewDialog.location', 'Location')}</span>
                      <div className="text-ink">{[org.city, org.country].filter(Boolean).join(', ')}</div>
                    </div>
                  )}
                  {org.headquarters_country && (
                    <div>
                      <span className="text-xs text-meta">{t('accountArea.previewDialog.headquarters', 'Headquarters')}</span>
                      <div className="text-ink">{org.headquarters_country}</div>
                    </div>
                  )}
                  {profile.job_title && (
                    <div>
                      <span className="text-xs text-meta">{t('accountArea.previewDialog.position', 'Position')}</span>
                      <div className="text-ink">{profile.job_title}</div>
                    </div>
                  )}
                </div>

                {/* Description / Audience */}
                {org.description && (
                  <div className="text-sm">
                    <span className="mb-1 block text-xs text-meta">{t('accountArea.previewDialog.about', 'About')}</span>
                    <p className="line-clamp-3 text-ink">{org.description}</p>
                  </div>
                )}
                {org.audience_description && (
                  <div className="text-sm">
                    <span className="mb-1 block text-xs text-meta">{t('accountArea.profile.audience', 'Audience')}</span>
                    <p className="line-clamp-3 text-ink">{org.audience_description}</p>
                  </div>
                )}

                {/* Website */}
                {org.website && (
                  <a href={externalUrl(org.website) ?? undefined} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 break-all text-sm text-primary hover:underline">
                    <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                    {org.website}
                  </a>
                )}
              </div>
            )}

            <div className="flex justify-center pt-2">
              <Button variant="outline" className={BTN_OUTLINE} onClick={() => setPreviewOpen(false)}>
                {t('accountArea.previewDialog.close', 'Close preview')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Event Payment Dialog removed — payment integration deferred */}
    </div>
  );
}

/* ================================================================== menu */

function BackToDashboard({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  return (
    <Link
      to="/dashboard"
      className={cn(
        'inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium text-primary transition-colors hover:bg-chip focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        compact ? '-ml-3 mb-2' : 'mb-1 w-full',
      )}
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {t('nav.dashboard', 'Dashboard')}
    </Link>
  );
}

function NotifMarks({ item, inverted = false }: { item: MenuItem; inverted?: boolean }) {
  const { t } = useTranslation();
  const count = item.notifCount ?? 0;
  return (
    <>
      {item.notifDot && (
        <>
          <span aria-hidden="true" className={cn('h-2 w-2 shrink-0 rounded-full bg-red-500', inverted && 'ring-2 ring-white')} />
          <span className="sr-only">{t('accountArea.menu.needsAttention', '(needs your attention)')}</span>
        </>
      )}
      {count > 0 && (
        <>
          <span aria-hidden="true" className="inline-flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold leading-none text-white">
            {count}
          </span>
          <span className="sr-only">{t('accountArea.menu.pending', { count, defaultValue: '({{count}} pending)' })}</span>
        </>
      )}
    </>
  );
}

/** The grouped list — compact in the sidebar, with one-line descriptions on phones. */
function MenuList({
  groups,
  items,
  activeTab,
  detailed = false,
  onPick,
}: {
  groups: MenuGroup[];
  items: MenuItem[];
  activeTab: string;
  detailed?: boolean;
  onPick?: () => void;
}) {
  return (
    <div className="space-y-1">
      {groups.map((g) => {
        const groupItems = items.filter((i) => i.group === g.key);
        if (groupItems.length === 0) return null;
        const headingId = `account-menu-${detailed ? 'm' : 'd'}-${g.key}`;
        return (
          <div key={g.key}>
            <p id={headingId} className="px-3 pb-1 pt-4 text-meta-caps first:pt-1">
              {g.label}
            </p>
            <ul aria-labelledby={headingId} className="space-y-0.5">
              {groupItems.map((item) => {
                const active = activeTab === item.value;
                const Icon = item.icon;
                return (
                  <li key={item.value}>
                    <Link
                      to={item.href}
                      onClick={onPick}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'group relative flex min-h-10 items-center gap-3 rounded-xl px-3 py-2 text-[15px] font-medium transition-colors focus:outline-none focus-visible:shadow-focus',
                        active
                          ? 'bg-chip font-semibold text-navy before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-pill before:bg-gold'
                          : 'text-ink hover:bg-page hover:text-navy',
                      )}
                    >
                      <span className={cn(
                        'flex shrink-0 items-center justify-center',
                        detailed && 'h-9 w-9 rounded-lg',
                        detailed && (active ? 'bg-white' : 'bg-chip'),
                      )}>
                        <Icon className={cn('h-4 w-4', active ? 'text-navy' : 'text-meta group-hover:text-navy')} aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{item.label}</span>
                        {detailed && (
                          <span className="block truncate text-[13px] font-normal text-meta">
                            {item.desc}
                          </span>
                        )}
                      </span>
                      <NotifMarks item={item} inverted={active} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Phones: one button naming the open section; it unfolds the grouped list in
 * place (no overlay to dismiss, nothing to scroll sideways). A red dot on the
 * button says something is waiting elsewhere.
 */
function MobileSectionSwitcher({
  current,
  groups,
  items,
  activeTab,
}: {
  current: { icon: LucideIcon; label: string; groupLabel: string } | null;
  groups: MenuGroup[];
  items: MenuItem[];
  activeTab: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  // A new section closes the list.
  useEffect(() => { setOpen(false); }, [activeTab]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const Icon = current?.icon ?? Compass;
  const elsewhere = items.some((i) => i.value !== activeTab && (i.notifDot || (i.notifCount ?? 0) > 0));

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="account-section-list"
        onClick={() => setOpen((o) => !o)}
        className={cn(CARD, 'flex min-h-14 w-full items-center gap-3 px-3 py-2.5 text-left focus:outline-none focus-visible:shadow-focus')}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-chip text-primary">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-meta-caps">
            {current?.groupLabel || t('accountArea.menu.label', 'Member area')}
          </span>
          <span className="block truncate text-[15px] font-semibold text-navy">
            {current?.label ?? t('accountArea.menu.choose', 'Choose a section')}
          </span>
        </span>
        {elsewhere && (
          <>
            <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-500" />
            <span className="sr-only">{t('accountArea.menu.somethingWaiting', 'Something needs your attention in another section')}</span>
          </>
        )}
        <span className="shrink-0 text-[13px] font-semibold text-navy">{t('accountArea.menu.switch', 'Sections')}</span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-meta transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {open && (
        <nav
          id="account-section-list"
          aria-label={t('accountArea.menu.label', 'Member area')}
          className={cn(CARD, 'mt-2 max-h-[70vh] overflow-y-auto p-2 shadow-drawer')}
        >
          <MenuList groups={groups} items={items} activeTab={activeTab} detailed onPick={() => setOpen(false)} />
        </nav>
      )}
    </div>
  );
}

/* ================================================================== building blocks */

function SectionHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <Eyebrow className="hidden lg:flex">{eyebrow}</Eyebrow>}
        <h2 className={cn('text-h2-sm text-navy [overflow-wrap:anywhere]', eyebrow && 'lg:mt-2')}>{title}</h2>
        {description && <p className="mt-1.5 max-w-2xl text-[15px] leading-6 text-meta">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-3">{actions}</div>}
    </header>
  );
}
function Panel({
  title,
  icon: _icon,
  count,
  actions,
  children,
  className,
}: {
  title?: string;
  icon?: LucideIcon;
  count?: number;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <MemberPanel title={title} count={count} actions={actions} className={className}>
      {children}
    </MemberPanel>
  );
}
function EmptyState({
  icon,
  title,
  body,
  action,
  tone = 'navy',
}: {
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: ReactNode;
  tone?: 'navy' | 'amber';
}) {
  return <MemberEmpty icon={icon} title={title} body={body} action={action} tone={tone === 'amber' ? 'warning' : 'default'} />;
}
function StatusBanner({
  tone,
  icon,
  title,
  body,
  action,
}: {
  tone: 'blue' | 'amber' | 'red';
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <MemberBanner
      tone={tone === 'blue' ? 'info' : tone === 'amber' ? 'warning' : 'danger'}
      icon={icon}
      title={title}
      body={body}
      action={action}
    />
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] font-medium leading-5 text-meta">{label}</dt>
      <dd className="mt-0.5 break-words text-[15px] font-semibold leading-6 text-navy">{children}</dd>
    </div>
  );
}

/** One request in a list (project, RFP, consultation, webinar proposal). */
function ItemRow({
  icon: Icon,
  title,
  description,
  meta,
  rejection,
  aside,
  footer,
}: {
  icon: LucideIcon;
  title: string;
  description?: string | null;
  meta: (string | null | undefined)[];
  rejection?: string | null;
  aside?: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  const metaLine = meta.filter(Boolean).join(' · ');
  return (
    <li className="p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-chip text-primary">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-navy">{title}</p>
            {rejection && (
              <p className="mt-1 text-sm text-red-700">
                <span className="font-medium">{t('accountArea.common.reason', 'Reason:')}</span> {rejection}
              </p>
            )}
            {description && <p className="mt-1 line-clamp-2 text-sm text-meta">{description}</p>}
            {metaLine && <p className="mt-1 text-xs text-meta">{metaLine}</p>}
          </div>
        </div>
        {aside && <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{aside}</div>}
      </div>
      {footer && <div className="mt-3 space-y-3 sm:pl-[52px]">{footer}</div>}
    </li>
  );
}

/** A collapsible block of the "All submissions" view. */
function SubmissionGroup({
  id,
  icon: Icon,
  title,
  count,
  open,
  onToggle,
  children,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const panelId = `submissions-${id}`;
  return (
    <section className={cn(CARD, 'overflow-hidden')}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex min-h-14 w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-page focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      >
        <span className="flex items-center gap-3 font-semibold text-navy">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-chip text-primary">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
          {title}
          <span className="rounded-full bg-chip px-2 py-0.5 text-xs font-medium tabular-nums text-ink">{count}</span>
        </span>
        {open
          ? <ChevronDown className="h-4 w-4 text-meta" aria-hidden="true" />
          : <ChevronRight className="h-4 w-4 text-meta" aria-hidden="true" />}
      </button>
      {open && <div id={panelId} className="border-t border-rule">{children}</div>}
    </section>
  );
}

function GroupEmpty({ text, linkTo, linkLabel }: { text: string; linkTo: string; linkLabel: string }) {
  return (
    <div className="px-5 py-6 text-center">
      <p className="text-sm text-meta">{text}</p>
      <Link to={linkTo} className="mt-1 inline-flex min-h-10 items-center text-sm font-medium text-primary hover:underline underline-offset-2">
        {linkLabel}
      </Link>
    </div>
  );
}

function CompactRow({
  title,
  description,
  meta,
  rejection,
  onEdit,
  editLabel,
  status,
}: {
  title: string;
  description?: string | null;
  meta: (string | null | undefined)[];
  rejection?: string | null;
  onEdit?: () => void;
  editLabel?: string;
  status: string;
}) {
  const { t } = useTranslation();
  const metaLine = meta.filter(Boolean).join(' · ');
  return (
    <li className="flex items-center justify-between gap-3 px-5 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-navy">{title}</p>
        {description && <p className="line-clamp-1 text-xs text-meta">{description}</p>}
        {metaLine && <p className="text-xs text-meta">{metaLine}</p>}
        {rejection && (
          <p className="mt-1 text-xs text-red-700">
            <span className="font-medium">{t('accountArea.common.reason', 'Reason:')}</span> {rejection}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {onEdit && (
          <Button variant="ghost" size="sm" className="h-10 w-10 p-0" onClick={onEdit} aria-label={`${editLabel ?? 'Edit'} — ${title}`}>
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        )}
        <SubmissionStatusBadge status={status} />
      </div>
    </li>
  );
}

/* ================================================================== my events */

/**
 * The member's own participation: what is coming (with the calendar and, for
 * a webinar, the joining link) and what is over (with the replay). The SM26
 * card and the self-cancel action are unchanged from the old list.
 */
function MyEvents({
  uid,
  registrations,
  loading,
  locale,
  onUnregister,
}: {
  uid: string | null;
  registrations: EventRegistration[];
  loading: boolean;
  locale: string;
  onUnregister: (reg: EventRegistration) => void;
}) {
  const { t } = useTranslation();
  const now = Date.now();
  const FAR = 8.64e15;

  const upcoming: EventRegistration[] = [];
  const past: EventRegistration[] = [];
  for (const reg of registrations) {
    const w = reg.events ? eventWindow(reg.events) : null;
    // No date (or the event can't be read) stays with "upcoming": it isn't over.
    if (w && w.end < now) past.push(reg); else upcoming.push(reg);
  }
  const startOf = (r: EventRegistration) => (r.events?.date_time ? new Date(r.events.date_time).getTime() : FAR);
  upcoming.sort((a, b) => startOf(a) - startOf(b));
  past.sort((a, b) => startOf(b) - startOf(a));

  return (
    <div className="space-y-6">
      {uid && <SM26ParticipationCard userId={uid} variant="self" />}

      <p className="sr-only" aria-live="polite">
        {loading ? '' : t('accountArea.events.summary', {
          upcoming: upcoming.length,
          past: past.length,
          defaultValue: '{{upcoming}} upcoming, {{past}} past',
        })}
      </p>

      {loading ? (
        <Panel><RowSkeleton rows={2} /></Panel>
      ) : registrations.length === 0 ? (
        <Panel>
          <EmptyState
            icon={CalendarDays}
            title={t('accountArea.events.emptyTitle', 'No registrations yet.')}
            body={t('accountArea.events.emptyBody', 'Browse upcoming events and register to attend.')}
            action={(
              <Button asChild variant="ctaNavy" size="sm">
                <Link to="/events">{t('accountArea.events.browse', 'Browse events')}</Link>
              </Button>
            )}
          />
        </Panel>
      ) : (
        <>
          <Panel title={t('accountArea.events.upcomingTitle', 'Upcoming')} icon={CalendarClock} count={upcoming.length}>
            {upcoming.length === 0 ? (
              <div className="flex flex-wrap items-center gap-x-2 px-5 py-6 text-sm text-meta">
                <span>{t('accountArea.events.noUpcoming', 'You have no upcoming events.')}</span>
                <Link to="/events" className="inline-flex min-h-10 items-center font-medium text-primary hover:underline underline-offset-2">
                  {t('accountArea.events.browse', 'Browse events')}
                </Link>
              </div>
            ) : (
              <ul className="divide-y divide-rule">
                {upcoming.map((reg) => (
                  <RegistrationCard key={reg.id} reg={reg} past={false} now={now} locale={locale} onUnregister={onUnregister} />
                ))}
              </ul>
            )}
          </Panel>

          {past.length > 0 && (
            <Panel title={t('accountArea.events.pastTitle', 'Past events')} icon={History} count={past.length}>
              <ul className="divide-y divide-rule">
                {past.map((reg) => (
                  <RegistrationCard key={reg.id} reg={reg} past now={now} locale={locale} onUnregister={onUnregister} />
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

function formatWhen(ev: RegisteredEvent, locale: string, allDay: string, tbc: string): string {
  if (!ev.date_time) return tbc;
  const start = new Date(ev.date_time);
  const end = ev.end_date_time ? new Date(ev.end_date_time) : null;
  const multiDay = !!end && end.toDateString() !== start.toDateString();
  const day = (d: Date) => d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const time = (d: Date, zone = false) => d.toLocaleTimeString(locale, {
    hour: '2-digit', minute: '2-digit', ...(zone ? { timeZoneName: 'short' as const } : {}),
  });
  if (multiDay) return `${day(start)} – ${day(end!)}${ev.is_full_day ? '' : ` · ${time(start, true)}`}`;
  // A full-day event has no meaningful start time — "00:00" would read as midnight.
  if (ev.is_full_day) return `${day(start)} · ${allDay}`;
  return end ? `${day(start)} · ${time(start)} – ${time(end, true)}` : `${day(start)} · ${time(start, true)}`;
}

/** The date as a tile: the event's own brand gradient while it is ahead, grey once it is over. */
function DateChip({ ev, seed: _seed, locale, past }: { ev: RegisteredEvent | null; seed: string; locale: string; past: boolean }) {
  if (!ev?.date_time) {
    return (
      <span aria-hidden="true" className="flex h-16 w-16 shrink-0 items-center justify-center rounded-card bg-chip text-meta">
        <CalendarClock className="h-6 w-6" />
      </span>
    );
  }
  const start = new Date(ev.date_time);
  const end = ev.end_date_time ? new Date(ev.end_date_time) : null;
  const multi = !!end && end.toDateString() !== start.toDateString();
  const sameMonth = !!end && end.getMonth() === start.getMonth() && end.getFullYear() === start.getFullYear();
  const day = multi && sameMonth ? `${start.getDate()}–${end!.getDate()}` : String(start.getDate());
  const month = start.toLocaleDateString(locale, { month: 'short' }).replace('.', '');
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-card text-center',
        past ? 'bg-chip text-meta' : 'bg-navy text-white',
      )}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wide">{month}</span>
      <span className={cn('font-signage font-semibold leading-tight tabular-nums', day.length > 2 ? 'text-lg' : 'text-2xl')}>{day}</span>
    </span>
  );
}

function PaymentStatusPill({ status }: { status: string }) {
  const { t } = useTranslation();
  const map: Record<string, { label: string; tone: PillTone; icon: LucideIcon }> = {
    free: { label: t('accountArea.events.payment.free', 'Confirmed'), tone: 'success', icon: CheckCircle2 },
    paid: { label: t('accountArea.events.payment.paid', 'Confirmed · paid'), tone: 'success', icon: CheckCircle2 },
    pending_approval: { label: t('accountArea.events.payment.pending_approval', 'Pending approval'), tone: 'warning', icon: Clock },
    pending_payment: { label: t('accountArea.events.payment.pending_payment', 'Payment due'), tone: 'warning', icon: AlertCircle },
    rejected: { label: t('accountArea.events.payment.rejected', 'Declined'), tone: 'danger', icon: XCircle },
  };
  const s = map[status] ?? { label: humanize(status || ''), tone: 'neutral' as PillTone, icon: Ticket };
  if (!s.label) return null;
  return <StatusPill tone={s.tone} icon={s.icon}>{s.label}</StatusPill>;
}
function RegistrationCard({
  reg,
  past,
  now,
  locale,
  onUnregister,
}: {
  reg: EventRegistration;
  past: boolean;
  now: number;
  locale: string;
  onUnregister: (reg: EventRegistration) => void;
}) {
  const { t } = useTranslation();
  const ev = reg.events;
  const w = ev ? eventWindow(ev) : null;
  const live = !!w && w.start <= now && now <= w.end;
  const isWebinar = ev?.event_type === 'webinar';
  const declined = reg.payment_status === 'rejected';
  const needsPayment = reg.payment_status === 'pending_payment';
  // Same rule as the event page: a registered attendee sees the joining link
  // of a webinar that hasn't ended. (A declined registration is not one.)
  const joinUrl = !past && isWebinar && !declined ? ev?.meeting_url ?? null : null;
  const calendarEvent: CalendarEventInput | null = !past && !declined && ev?.date_time ? {
    title: ev.title,
    description: ev.description,
    date_time: ev.date_time,
    end_date_time: ev.end_date_time,
    location: ev.location,
    url: ev.meeting_url,
  } : null;

  const typeInfo = REGISTRATION_TYPE_LABELS[reg.registration_type];
  const typeLabel = typeInfo
    ? t(typeInfo.key, typeInfo.fallback)
    : reg.registration_type ? humanize(reg.registration_type) : t('accountArea.events.regType.standard', 'Standard');
  const amountDue = (reg.payment_status === 'pending_payment' || reg.payment_status === 'pending_approval') && (reg.amount_due_cents ?? 0) > 0
    ? new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format((reg.amount_due_cents ?? 0) / 100)
    : null;

  const title = ev?.title ?? t('accountArea.events.untitled', 'Event details unavailable');

  return (
    <li className={cn('p-4 sm:p-5', needsPayment && 'bg-amber-50/40')}>
      <div className="flex gap-4">
        <DateChip ev={ev} seed={reg.event_id} locale={locale} past={past} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {ev && (
              <StatusPill tone="neutral" icon={isWebinar ? Video : MapPin}>
                {isWebinar ? t('accountArea.events.typeWebinar', 'Webinar') : t('accountArea.events.typeOnSite', 'On-site')}
              </StatusPill>
            )}
            {live && (
              <span className="inline-flex items-center gap-1 rounded-pill bg-red-600 px-2.5 py-0.5 text-[12px] font-semibold leading-5 text-white">
                <Radio className="h-3.5 w-3.5" aria-hidden="true" />
                {t('accountArea.events.live', 'Happening now')}
              </span>
            )}
            <PaymentStatusPill status={reg.payment_status} />
          </div>
          <h4 className="group mt-1.5 text-[17px] font-semibold leading-6 text-navy">
            <Link to={`/events/${reg.event_id}`} className={cn('rounded', FOCUS)}>
              <span className="card-ul">{title}</span>
            </Link>
          </h4>
          <ul className="mt-1.5 space-y-1 text-sm text-meta">
            {ev && (
              <li className="flex items-start gap-1.5">
                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{formatWhen(ev, locale, t('accountArea.events.allDay', 'All day'), t('accountArea.events.dateTbc', 'Date to be announced'))}</span>
              </li>
            )}
            {ev && (
              <li className="flex items-start gap-1.5">
                {isWebinar
                  ? <Video className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  : <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                <span>{isWebinar ? t('accountArea.events.online', 'Online') : (ev.location || t('accountArea.events.venueTbc', 'Venue to be confirmed'))}</span>
              </li>
            )}
            <li className="flex items-start gap-1.5">
              <Ticket className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                {t('accountArea.events.registeredAs', { type: typeLabel, defaultValue: 'Registered as {{type}}' })}
                {amountDue && ` · ${t('accountArea.events.amountDue', { amount: amountDue, defaultValue: '{{amount}} due' })}`}
              </span>
            </li>
          </ul>
        </div>
      </div>

      <div className="mt-4 space-y-3 sm:pl-20">
        {joinUrl && (
          <Button asChild variant="cta" size="sm" className="w-full justify-between sm:w-auto">
            <a href={joinUrl} target="_blank" rel="noopener noreferrer">
              {live ? t('accountArea.events.joinNow', 'Join now') : t('accountArea.events.joinWebinar', 'Join the webinar')}
            </a>
          </Button>
        )}
        {!past && isWebinar && !declined && !ev?.meeting_url && (
          <p className="text-xs text-meta">{t('accountArea.events.joinLater', 'The joining link will appear here before the webinar starts.')}</p>
        )}

        {calendarEvent && !live && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-meta">{t('events.addToCalendar', 'Add to calendar')}</p>
            <AddToCalendarButtons event={calendarEvent} />
          </div>
        )}

        {past && (ev?.replay_url ? (
          <Button asChild variant="ctaNavy" size="sm" className="w-full justify-between sm:w-auto">
            <a href={ev.replay_url} target="_blank" rel="noopener noreferrer">
              {t('events.watchReplay', 'Watch replay')}
            </a>
          </Button>
        ) : isWebinar ? (
          <p className="text-xs text-meta">{t('accountArea.events.noReplay', 'No replay has been published for this webinar yet.')}</p>
        ) : null)}

        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm" className={BTN_OUTLINE}>
            <Link to={`/events/${reg.event_id}`}>
              {t('accountArea.events.eventPage', 'Event page')}
              <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          {/* Event payment button removed — payment integration deferred */}
          {/* Allow self-cancel for everything except registrations that
              were actually paid for (those need a refund flow). */}
          {reg.payment_status !== 'paid' && (
            <Button
              variant="ghost"
              size="sm"
              className={cn(BTN, 'text-red-600 hover:bg-red-50 hover:text-red-700')}
              onClick={(e) => {
                e.stopPropagation();
                onUnregister(reg);
              }}
            >
              <X className="mr-1 h-4 w-4" aria-hidden="true" />
              {t('accountArea.events.unregister', 'Unregister')}
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

/* ================================================================== organization */

/**
 * The organization tab is one long component (OrganizationTab) with no
 * anchors of its own, so this wraps it with a jump bar: logo & cover, product
 * images, company details, team & invitations (where the domain auto-join
 * setting lives), documents, and capital raise / investment thesis.
 *
 * Nothing is hidden or reordered — the bar only scrolls — so every existing
 * control stays exactly where it was. Sections are found by explicit
 * `data-org-section="<key>"` markers when OrganizationTab carries them, and
 * otherwise by its current headings; a section that can't be found simply
 * gets no chip. `?section=<key>` deep-links to one (e.g. from a dashboard
 * nudge); an unknown value is ignored.
 */
type OrgSectionKey = 'branding' | 'gallery' | 'details' | 'team' | 'documents' | 'capital' | 'thesis';
const ORG_SECTION_ORDER: OrgSectionKey[] = ['branding', 'gallery', 'details', 'team', 'documents', 'capital', 'thesis'];
/** The site navbar the bar sticks under (h-16). */
const NAVBAR_HEIGHT = 64;

function findOrgSections(host: HTMLElement, labels: { members: string[]; details: string[] }): Map<OrgSectionKey, HTMLElement> {
  const found = new Map<OrgSectionKey, HTMLElement>();

  // 1. Explicit markers win.
  host.querySelectorAll<HTMLElement>('[data-org-section]').forEach((el) => {
    const key = el.dataset.orgSection as OrgSectionKey;
    if (ORG_SECTION_ORDER.includes(key) && !found.has(key)) found.set(key, el);
  });
  if (found.size > 0) return found;

  // 2. OrganizationTab's current markup: a stack of cards.
  const stack = host.firstElementChild;
  if (!stack) return found;
  const blocks = Array.from(stack.children).filter((el): el is HTMLElement => el instanceof HTMLElement);
  const textOf = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  const blockTitled = (titles: string[]) =>
    blocks.find((b) => Array.from(b.querySelectorAll('h3')).some((h) => titles.includes(textOf(h))));

  // The team card only exists once there is an organization; without it the
  // tab shows the creation form and there is nothing to navigate.
  const team = blockTitled(labels.members);
  if (!team) return found;

  const profileCard = blocks[0];
  if (profileCard && profileCard !== team) {
    found.set('branding', profileCard);
    const h4s = Array.from(profileCard.querySelectorAll('h4'));
    const galleryHeading = h4s.find((h) => textOf(h) === 'Product images');
    const gallery = galleryHeading?.parentElement?.parentElement ?? null;
    if (gallery && gallery !== profileCard && profileCard.contains(gallery)) found.set('gallery', gallery);
    // Read-only details or the edit form, whichever is open, follow the gallery.
    const detailsHeading = h4s.find((h) => labels.details.includes(textOf(h)));
    const details = (gallery?.nextElementSibling as HTMLElement | null) ?? detailsHeading?.parentElement ?? null;
    if (details && profileCard.contains(details)) found.set('details', details);
  }
  found.set('team', team);
  const docs = blockTitled(['Documents']);
  if (docs) found.set('documents', docs);
  const capital = blockTitled(['Capital raise']);
  if (capital) found.set('capital', capital);
  const thesis = blockTitled(['Investment thesis']);
  if (thesis) found.set('thesis', thesis);
  return found;
}

function OrganizationWorkspace() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const hostRef = useRef<HTMLDivElement>(null);
  const targetsRef = useRef<Map<OrgSectionKey, HTMLElement>>(new Map());
  const appliedRef = useRef<string | null>(null);
  const [keys, setKeys] = useState<OrgSectionKey[]>([]);
  const [active, setActive] = useState<OrgSectionKey | null>(null);
  const requested = searchParams.get('section');
  const navRef = useRef<HTMLElement>(null);
  // Where a section's top should land: under the navbar and under this bar,
  // whatever height it wraps to.
  const stickyOffset = useCallback(() => NAVBAR_HEIGHT + (navRef.current?.offsetHeight ?? 56) + 12, []);

  const membersLabel = t('org.members', 'Members');
  const detailsLabel = t('org.generalDetails', 'General Details');

  // The same element across renders, so a scroll-spy update never re-renders
  // the (large) organization form.
  const organizationTab = useMemo(() => <OrganizationTab />, []);

  // Find the sections, and find them again whenever the tab's DOM changes
  // (it loads, the edit form opens, a section appears).
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let frame = 0;
    const detect = () => {
      frame = 0;
      const found = findOrgSections(host, {
        members: Array.from(new Set([membersLabel, 'Members'])),
        details: Array.from(new Set([detailsLabel, 'General Details'])),
      });
      targetsRef.current = found;
      const next = ORG_SECTION_ORDER.filter((k) => found.has(k));
      setKeys((prev) => (prev.join() === next.join() ? prev : next));
    };
    detect();
    const observer = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(detect); });
    observer.observe(host, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [membersLabel, detailsLabel]);

  // Scroll-spy: the chip of the section under the bar is the current one.
  useEffect(() => {
    if (keys.length === 0) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      let current: OrgSectionKey = keys[0];
      const line = stickyOffset() + 8;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (atBottom) {
        current = keys[keys.length - 1];
      } else {
        for (const k of keys) {
          const el = targetsRef.current.get(k);
          if (el && el.getBoundingClientRect().top <= line) current = k;
        }
      }
      setActive(current);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [keys, stickyOffset]);

  // On a phone the bar scrolls sideways: keep the current chip in view.
  const chipsRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const list = chipsRef.current;
    if (!list || !active || list.scrollWidth <= list.clientWidth) return;
    const chip = list.querySelector<HTMLElement>(`[data-org-chip="${active}"]`);
    if (!chip) return;
    // The list is `relative`, so offsetLeft is measured from its own edge.
    const left = chip.offsetLeft;
    if (left < list.scrollLeft || left + chip.offsetWidth > list.scrollLeft + list.clientWidth) {
      list.scrollTo({ left: Math.max(0, left - 16) });
    }
  }, [active]);

  const jumpTo = useCallback((key: OrgSectionKey, behavior: ScrollBehavior) => {
    const el = targetsRef.current.get(key);
    if (!el) return;
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const top = el.getBoundingClientRect().top + window.scrollY - stickyOffset();
    window.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : behavior });
    setActive(key);
  }, [stickyOffset]);

  // A deep link (?section=team) is honoured once its section exists.
  useEffect(() => {
    if (!requested || appliedRef.current === requested) return;
    if (!keys.includes(requested as OrgSectionKey)) return;
    appliedRef.current = requested;
    jumpTo(requested as OrgSectionKey, 'auto');
  }, [requested, keys, jumpTo]);

  const pick = (key: OrgSectionKey) => {
    appliedRef.current = key;
    jumpTo(key, 'smooth');
    // Shareable, but a scroll position is not worth a history entry.
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('section', key);
      return next;
    }, { replace: true });
  };

  const meta: Record<OrgSectionKey, { label: string; icon: LucideIcon }> = {
    branding: { label: t('accountArea.org.branding', 'Logo & cover'), icon: Palette },
    gallery: { label: t('accountArea.org.gallery', 'Product images'), icon: ImageIcon },
    details: { label: t('accountArea.org.details', 'Company details'), icon: Building2 },
    team: { label: t('accountArea.org.team', 'Team & invitations'), icon: Users },
    documents: { label: t('accountArea.org.documents', 'Documents'), icon: FileText },
    capital: { label: t('accountArea.org.capital', 'Capital raise'), icon: TrendingUp },
    thesis: { label: t('accountArea.org.thesis', 'Investment thesis'), icon: TrendingUp },
  };

  return (
    <div>
      {keys.length > 1 && (
        <nav
          ref={navRef}
          aria-label={t('accountArea.org.subnavLabel', 'Organization sections')}
          className="sticky top-16 z-20 -mx-4 mb-4 border-b border-rule bg-page/95 px-3 py-1 backdrop-blur-sm md:mx-0 md:rounded-card md:border md:border-rule md:bg-white/95 md:px-1"
        >
          {/* One scrolling row on touch screens; wraps from lg, where a mouse
              can't easily scroll a row sideways. The padding keeps focus rings
              from being clipped by the scroll box. */}
          <ul ref={chipsRef} className="no-scrollbar relative flex gap-2 overflow-x-auto p-1 lg:flex-wrap lg:overflow-visible">
            {keys.map((k) => {
              const Icon = meta[k].icon;
              const isActive = active === k;
              return (
                <li key={k} data-org-chip={k} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => pick(k)}
                    aria-current={isActive ? 'true' : undefined}
                    className={cn(
                      'inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-pill px-3.5 text-[14px] font-medium transition-colors',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                      isActive ? 'bg-navy text-white' : 'bg-white text-ink ring-1 ring-rule hover:bg-chip md:bg-chip md:ring-0 md:hover:bg-rule',
                    )}
                  >
                    {/* Decorative; dropped where the sidebar leaves the bar narrow, so it stays one row. */}
                    <Icon className="h-3.5 w-3.5 shrink-0 lg:hidden xl:block" aria-hidden="true" />
                    {meta[k].label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
      <div ref={hostRef}>{organizationTab}</div>
    </div>
  );
}

/* ================================================================== status badges */

function WebinarStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const map: Record<string, { label: string; tone: PillTone }> = {
    submitted: { label: t('accountArea.status.submitted', 'Submitted'), tone: 'warning' },
    under_review: { label: t('accountArea.status.under_review', 'Under review'), tone: 'info' },
    accepted: { label: t('accountArea.status.accepted', 'Accepted'), tone: 'success' },
    rejected: { label: t('accountArea.status.rejected', 'Rejected'), tone: 'danger' },
  };
  const s = map[status] ?? { label: status, tone: 'neutral' as PillTone };
  return <StatusPill tone={s.tone}>{s.label}</StatusPill>;
}
function SubmissionStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const map: Record<string, { label: string; tone: PillTone }> = {
    // Project / generic statuses
    new: { label: t('accountArea.status.new', 'New'), tone: 'neutral' },
    submitted: { label: t('accountArea.status.submitted', 'Submitted'), tone: 'warning' },
    pending: { label: t('accountArea.status.pending', 'Pending'), tone: 'warning' },
    under_review: { label: t('accountArea.status.under_review', 'Under review'), tone: 'info' },
    in_progress: { label: t('accountArea.status.in_progress', 'In progress'), tone: 'info' },
    accepted: { label: t('accountArea.status.accepted', 'Accepted'), tone: 'success' },
    approved: { label: t('accountArea.status.approved', 'Approved'), tone: 'success' },
    completed: { label: t('accountArea.status.completed', 'Completed'), tone: 'success' },
    active: { label: t('accountArea.status.active', 'Active'), tone: 'success' },
    open: { label: t('accountArea.status.open', 'Open'), tone: 'success' },
    rejected: { label: t('accountArea.status.rejected', 'Rejected'), tone: 'danger' },
    closed: { label: t('accountArea.status.closed', 'Closed'), tone: 'neutral' },
    cancelled: { label: t('accountArea.status.cancelled', 'Cancelled'), tone: 'neutral' },
  };
  const s = map[status] ?? { label: humanize(status), tone: 'neutral' as PillTone };
  return <StatusPill tone={s.tone}>{s.label}</StatusPill>;
}