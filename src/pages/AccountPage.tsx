import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { AlertCircle, Calendar, FileText, CheckCircle, XCircle, Clock, Anchor, Building2, Newspaper, ExternalLink, ClipboardList, Radio, Plus, Link2, MessageSquare, BarChart3, Eye, Users, ArrowRight, Check, X, Camera, Upload, Loader2, Pencil, Save, ChevronDown, ChevronRight, ShieldCheck, Bell, Star, Inbox } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Organization } from '@/types/database';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { OrganizationTab } from '@/components/organization/OrganizationTab';
// PaymentForm removed — payment integration deferred
// PreAuditTab archived — will be deployed later
// import { PreAuditTab } from '@/components/preaudit/PreAuditTab';
import { ReferenceRequestForm } from '@/components/references/ReferenceRequestForm';
import { TiersPage } from '@/pages/TiersPage';
import { NotificationPreferencesTab } from '@/components/notifications/NotificationPreferencesTab';
import { ShortlistTab } from '@/components/shortlist/ShortlistTab';
import { InboxTab } from '@/components/inbox/InboxTab';
import { toast } from '@/hooks/use-toast';
import { useEntitlements } from '@/hooks/useEntitlements';
import { resizeImage, fileMeta } from '@/lib/image';

interface EventRegistration {
  id: string;
  event_id: string;
  created_at: string;
  payment_status: string;
  registration_type: string;
  amount_due_cents: number | null;
  events: { title: string; date_time: string } | null;
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

/** Format raw budget_range DB values into human-readable labels */
function formatBudgetRange(raw: string): string {
  if (raw === 'under_10k') return 'Under €10k';
  // Numeric ranges like "50000-100000"
  const m = raw.match(/^(\d+)-(\d+)$/);
  if (m) {
    const fmt = (n: number) => (n >= 1_000_000 ? `€${n / 1_000_000}M` : `€${(n / 1_000).toFixed(0)}k`);
    return `${fmt(Number(m[1]))} – ${fmt(Number(m[2]))}`;
  }
  // Fallback: replace underscores and capitalize
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function AccountPage() {
  const { t } = useTranslation();
  const { user, profile, organization, orgRole, loading: authLoading, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [registrations, setRegistrations] = useState<EventRegistration[]>([]);
  const [projects, setProjects] = useState<MarinaProject[]>([]);
  const [webinarRequests, setWebinarRequests] = useState<WebinarRequest[]>([]);
  const [rfps, setRfps] = useState<RFPItem[]>([]);
  const [consultations, setConsultations] = useState<ConsultationItem[]>([]);
  const [partnerRequests, setPartnerRequests] = useState<PartnerRequestItem[]>([]);
  const [referenceCount, setReferenceCount] = useState<number>(0);
  const [dataLoading, setDataLoading] = useState(false);

  // Submissions tab
  const [submissionsLoading, setSubmissionsLoading] = useState(false);
  const [submissionsFetched, setSubmissionsFetched] = useState(false);
  const [subProjects, setSubProjects] = useState<MarinaProject[]>([]);
  const [subRfps, setSubRfps] = useState<RFPItem[]>([]);
  const [subConsultations, setSubConsultations] = useState<ConsultationItem[]>([]);
  const [subWebinars, setSubWebinars] = useState<WebinarRequest[]>([]);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    projects: true, rfps: true, consultations: true, webinars: true,
  });

  // Event payment dialog
  // eventPaymentReg removed — payment integration deferred

  // Dashboard analytics state
  const [profileViewCount, setProfileViewCount] = useState(0);
  const [connectionRequestCount, setConnectionRequestCount] = useState(0);
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const [feedResources, setFeedResources] = useState<{ id: string; title: string; type: string; summary: string }[]>([]);
  const [feedEvents, setFeedEvents] = useState<{ id: string; title: string; date_time: string }[]>([]);

  const { isFeatureEnabled } = useEntitlements();

  const activeTab = searchParams.get('tab') || 'dashboard';

  // Redirect deprecated tab URLs to the new Inbox so old email links / bookmarks
  // still land in a meaningful place.
  useEffect(() => {
    if (activeTab === 'b2b-requests') {
      setSearchParams({ tab: 'inbox' }, { replace: true });
    }
  }, [activeTab, setSearchParams]);

  // During onboarding (draft), only show completion-related tabs
  const isOnboarding = profile?.onboarding_status === 'draft';

  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Profile editing
  const [editingProfile, setEditingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({ firstName: '', lastName: '', jobTitle: '' });

  // Initialize profile form when profile loads or editing starts
  useEffect(() => {
    if (profile) {
      setProfileForm({
        firstName: profile.first_name || '',
        lastName: profile.last_name || '',
        jobTitle: profile.job_title || '',
      });
    }
  }, [profile]);

  const handleSaveProfile = async () => {
    if (!user) return;
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

      toast({ title: 'Profile updated', description: 'Your personal information has been saved.' });
      setEditingProfile(false);
      await refreshProfile();
    } catch (err: unknown) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed to update profile.', variant: 'destructive' });
    } finally {
      setSavingProfile(false);
    }
  };

  const uploadImage = async (file: File, type: 'avatar' | 'logo') => {
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Invalid file type', description: 'Please upload an image (JPEG, PNG, WebP)', variant: 'destructive' });
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast({ title: 'File too large', description: 'Maximum 25 MB', variant: 'destructive' });
      return;
    }
    const setter = type === 'avatar' ? setUploadingAvatar : setUploadingLogo;
    setter(true);
    try {
      const meta = await fileMeta(file);
      const blob = await resizeImage(file, 600, 600); // shrink big files; keep PNG/SVG transparency
      const ctype = (blob as Blob).type || file.type;
      const ext = ctype === 'image/svg+xml' ? 'svg' : ctype === 'image/png' ? 'png' : 'jpg';
      const prefix = type === 'avatar' ? 'avatars' : 'logos';
      const fileName = `${prefix}/${user!.id}-${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage.from('profile-images').upload(fileName, blob, { cacheControl: '3600', upsert: true, contentType: ctype });
      if (uploadErr) throw uploadErr;
      const { data: urlData } = supabase.storage.from('profile-images').getPublicUrl(fileName);
      const publicUrl = urlData.publicUrl;

      if (type === 'avatar') {
        await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('user_id', user!.id);
        toast({ title: 'Profile image updated', description: meta });
      } else {
        // Update logo on organization
        if (organization) {
          await supabase.from('organizations').update({ logo_url: publicUrl }).eq('id', organization.id);
        }
        toast({ title: 'Company logo updated', description: meta });
      }
      await refreshProfile();
    } catch (err: unknown) {
      toast({ title: 'Upload failed', description: err instanceof Error ? err.message : 'An unexpected error occurred.', variant: 'destructive' });
    }
    setter(false);
  };

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate('/'); return; }
    // User logged in but no profile → could be new user or a fetch timeout.
    // Don't redirect immediately; the render below shows a retry option.
  }, [user, authLoading, navigate]);

  // Default to 'complete-registration' tab during onboarding if no tab param is set
  useEffect(() => {
    if (profile?.onboarding_status === 'draft' && !searchParams.get('tab')) {
      navigate('/account?tab=complete-registration', { replace: true });
    }
  }, [profile?.onboarding_status, searchParams, navigate]);

  useEffect(() => {
    if (!user || !profile) return;
    setDataLoading(true);

    const fetchData = async () => {
      try {
        const { data: regs } = await supabase
          .from('event_registrations')
          .select('id, event_id, created_at, payment_status, registration_type, amount_due_cents, events(title, date_time)')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });
        if (regs) setRegistrations(regs as unknown as EventRegistration[]);

        if (profile?.persona === 'marina' || profile?.persona === 'developer' || isFeatureEnabled('submit_project')) {
          const { data: proj } = await supabase
            .from('marina_projects')
            .select('id, project_type, budget_range, timeline, status, created_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });
          if (proj) setProjects(proj as MarinaProject[]);
        }

        const { data: webinars } = await supabase
          .from('webinar_requests')
          .select('id, title, description, preferred_language, preferred_timeframe, status, moderator_notes, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });
        if (webinars) setWebinarRequests(webinars as WebinarRequest[]);

        // Fetch RFPs (marina/developer or entitlement-granted)
        if (profile?.persona === 'marina' || profile?.persona === 'developer' || isFeatureEnabled('submit_rfp')) {
          const { data: rfpData } = await supabase
            .from('rfps')
            .select('id, title, scope, sector_id, deadline_date, is_open, status, rejection_reason, created_at')
            .eq('marina_user_id', user.id)
            .order('created_at', { ascending: false });
          if (rfpData) setRfps(rfpData as RFPItem[]);
        }

        if (profile?.persona === 'marina' || profile?.persona === 'developer' || isFeatureEnabled('submit_consultation')) {
          const { data: consultData } = await supabase
            .from('consultations')
            .select('id, title, description, sector_id, is_open, status, rejection_reason, created_at')
            .eq('marina_user_id', user.id)
            .order('created_at', { ascending: false });
          if (consultData) setConsultations(consultData as ConsultationItem[]);
        }

        // Fetch partner requests received (for any user)
        const { data: prData } = await supabase
          .from('partner_requests')
          .select('id, partner_user_id, marina_user_id, sector_id, message, status, created_at')
          .or(`partner_user_id.eq.${user.id},marina_user_id.eq.${user.id}`)
          .order('created_at', { ascending: false });
        if (prData) setPartnerRequests(prData as PartnerRequestItem[]);

        // Fetch recommendation count for partners (informational only)
        if ((profile?.persona === 'partner' || profile?.persona === 'media_partner') && organization?.id) {
          const { count } = await supabase
            .from('reference_requests')
            .select('id', { count: 'exact' })
            .eq('partner_organization_id', organization.id);
          setReferenceCount(count || 0);
        }

        // Dashboard analytics
        // Profile views count
        const { count: viewCount } = await supabase
          .from('profile_views')
          .select('id', { count: 'exact' })
          .eq('viewed_user_id', user.id);
        setProfileViewCount(viewCount || 0);

        // Connection requests
        const allRequests = prData || [];
        setConnectionRequestCount(allRequests.length);
        setPendingRequestCount(allRequests.filter((r) => r.status === 'pending').length);

        // Personalized feed: get user's sectors from org-level tables.
        // Interest-side personas (marina, developer, investor) use interest sectors.
        // Service-side personas (partner, media_partner) use service sectors.
        const orgSectorTable = (profile.persona === 'marina' || profile.persona === 'developer' || profile.persona === 'investor')
          ? 'organization_interest_sectors'
          : (profile.persona === 'partner' || profile.persona === 'media_partner')
          ? 'organization_service_sectors'
          : null;

        // Get org ID from context or membership
        const feedOrgId = organization?.id;

        if (orgSectorTable && feedOrgId) {
          const { data: userSectors } = await supabase
            .from(orgSectorTable)
            .select('sector_id')
            .eq('organization_id', feedOrgId);

          const sectorIds = (userSectors || []).map((s: { sector_id: string }) => s.sector_id);

          if (sectorIds.length > 0) {
            // Resources matching sectors
            const { data: feedRes } = await supabase
              .from('resource_sectors')
              .select('resource_id, resources!inner(id, title, type, summary, published)')
              .in('sector_id', sectorIds)
              .eq('resources.published', true)
              .limit(6);

            if (feedRes) {
              const uniqueResources = new Map<string, { id: string; title: string; type: string; summary: string }>();
              for (const r of feedRes as unknown as { resource_id: string; resources: { id: string; title: string; type: string; summary: string; published: boolean } }[]) {
                if (r.resources && !uniqueResources.has(r.resources.id)) {
                  uniqueResources.set(r.resources.id, {
                    id: r.resources.id,
                    title: r.resources.title,
                    type: r.resources.type,
                    summary: r.resources.summary,
                  });
                }
              }
              setFeedResources(Array.from(uniqueResources.values()).slice(0, 4));
            }

            // Events matching sectors
            const { data: feedEvt } = await supabase
              .from('event_sectors')
              .select('event_id, events!inner(id, title, date_time)')
              .in('sector_id', sectorIds)
              .limit(6);

            if (feedEvt) {
              const uniqueEvents = new Map<string, { id: string; title: string; date_time: string }>();
              for (const e of feedEvt as unknown as { event_id: string; events: { id: string; title: string; date_time: string } }[]) {
                if (e.events && !uniqueEvents.has(e.events.id)) {
                  uniqueEvents.set(e.events.id, {
                    id: e.events.id,
                    title: e.events.title,
                    date_time: e.events.date_time,
                  });
                }
              }
              setFeedEvents(Array.from(uniqueEvents.values()).slice(0, 4));
            }
          }
        }
      } catch (err) {
        if (import.meta.env.DEV) console.error('Error fetching account data:', err);
      } finally {
        setDataLoading(false);
      }
    };

    fetchData();
  }, [user, profile, organization, isFeatureEnabled]);

  // Fetch submissions data when tab is active
  useEffect(() => {
    if (activeTab !== 'submissions' || !user || !profile || submissionsFetched) return;
    const hasProjects = profile.persona === 'marina' || isFeatureEnabled('submit_project');
    const hasRFPs = profile.persona === 'marina' || isFeatureEnabled('submit_rfp');
    const hasConsultations = profile.persona === 'marina' || isFeatureEnabled('submit_consultation');

    setSubmissionsLoading(true);
    const fetchSubmissions = async () => {
      try {
        const [projRes, rfpRes, consultRes, webinarRes] = await Promise.all([
          hasProjects
            ? supabase
                .from('marina_projects')
                .select('id, project_type, budget_range, timeline, status, created_at')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false })
            : Promise.resolve({ data: null }),
          hasRFPs
            ? supabase
                .from('rfps')
                .select('id, title, scope, sector_id, deadline_date, is_open, status, rejection_reason, created_at')
                .eq('marina_user_id', user.id)
                .order('created_at', { ascending: false })
            : Promise.resolve({ data: null }),
          hasConsultations
            ? supabase
                .from('consultations')
                .select('id, title, description, sector_id, is_open, status, rejection_reason, created_at')
                .eq('marina_user_id', user.id)
                .order('created_at', { ascending: false })
            : Promise.resolve({ data: null }),
          supabase
            .from('webinar_requests')
            .select('id, title, description, preferred_language, preferred_timeframe, status, moderator_notes, created_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false }),
        ]);

        if (projRes.data) setSubProjects(projRes.data as MarinaProject[]);
        if (rfpRes.data) setSubRfps(rfpRes.data as RFPItem[]);
        if (consultRes.data) setSubConsultations(consultRes.data as ConsultationItem[]);
        if (webinarRes.data) setSubWebinars(webinarRes.data as WebinarRequest[]);
        setSubmissionsFetched(true);
      } catch (err) {
        if (import.meta.env.DEV) console.error('Error fetching submissions:', err);
      } finally {
        setSubmissionsLoading(false);
      }
    };

    fetchSubmissions();
  }, [activeTab, user, profile, submissionsFetched]);

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const getAccessBadge = () => {
    if (!profile) return null;
    switch (profile.access_status) {
      case 'verified':
        return <Badge className="bg-green-100 text-green-800 border-green-200"><CheckCircle className="h-3 w-3 mr-1" />Verified</Badge>;
      case 'pending':
        return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
      case 'rejected':
        return <Badge className="bg-red-100 text-red-800 border-red-200"><XCircle className="h-3 w-3 mr-1" />Rejected</Badge>;
      case 'suspended':
        return <Badge className="bg-gray-100 text-gray-800 border-gray-200"><XCircle className="h-3 w-3 mr-1" />Suspended</Badge>;
      default:
        return null;
    }
  };

  const getPersonaIcon = () => {
    switch (profile?.persona) {
      case 'marina': return <Anchor className="h-5 w-5" />;
      case 'partner': return <Building2 className="h-5 w-5" />;
      case 'media_partner': return <Newspaper className="h-5 w-5" />;
      default: return null;
    }
  };

  const getPersonaLabel = () => {
    switch (profile?.persona) {
      case 'marina': return 'Marina / Port';
      case 'partner': return 'Partner';
      case 'media_partner': return 'Media Partner';
      case 'moderator': return 'Moderator';
      case 'admin': return 'Administrator';
      default: return '';
    }
  };

  if (authLoading) {
    return <LoadingSkeleton variant="page" />;
  }

  if (!user) return null;

  if (!profile) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <AlertCircle className="h-10 w-10 mx-auto text-amber-500 mb-3" />
        <p className="text-gray-600 mb-2">Could not load your profile.</p>
        <p className="text-sm text-gray-400 mb-4">This may be due to a slow connection. Please try again.</p>
        <div className="flex gap-3 justify-center">
          <Button onClick={() => refreshProfile()}>
            Retry
          </Button>
          <Button variant="outline" onClick={() => navigate('/onboarding')}>
            Go to Onboarding
          </Button>
        </div>
      </div>
    );
  }

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
  const canWebinars = true; // always visible, gated inside
  const canB2B = true; // always visible

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
  const currentOnboardingStep = !org ? 1 : 2;

  // Notification badge counts for tabs
  const orgNeedsAction = profile.onboarding_status === 'draft' || !org;
  const pendingB2B = partnerRequests.filter(r => r.status === 'pending').length;

  const NotifDot = ({ show }: { show: boolean }) => show ? (
    <span className="ml-auto inline-flex items-center justify-center w-2 h-2 rounded-full bg-red-500" />
  ) : null;
  const NotifBadge = ({ count }: { count: number }) => count > 0 ? (
    <span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full bg-red-500 text-white leading-none">{count}</span>
  ) : null;

  // Sidebar nav items
  const navItems: { value: string; label: string; icon: React.ReactNode; show?: boolean; notifDot?: boolean; notifCount?: number }[] = isOnboarding
    ? [{ value: 'complete-registration', label: 'Complete Registration', icon: <ClipboardList className="h-4 w-4" />, notifDot: true }]
    : [
        { value: 'dashboard', label: 'Dashboard', icon: <BarChart3 className="h-4 w-4" /> },
        { value: 'organization', label: t('org.tabTitle'), icon: <Building2 className="h-4 w-4" />, notifDot: orgNeedsAction },
        { value: 'profile', label: 'Profile', icon: <Users className="h-4 w-4" /> },
        { value: 'registrations', label: 'Registrations', icon: <Calendar className="h-4 w-4" /> },
        { value: 'projects', label: 'Projects', icon: <Anchor className="h-4 w-4" />, show: canProjects },
        { value: 'webinars', label: 'Webinars', icon: <Radio className="h-4 w-4" /> },
        { value: 'rfps', label: 'RFPs', icon: <ClipboardList className="h-4 w-4" />, show: canRFPs },
        { value: 'consultations', label: 'Consultations', icon: <MessageSquare className="h-4 w-4" />, show: canConsultations },
        { value: 'references', label: 'Recommendations', icon: <FileText className="h-4 w-4" />, show: isPartnerOrg },
        { value: 'submissions', label: 'My Submissions', icon: <FileText className="h-4 w-4" />, show: canProjects || canRFPs || canConsultations || isPartner },
        { value: 'inbox', label: 'Inbox', icon: <Inbox className="h-4 w-4" />, notifCount: pendingB2B },
        { value: 'shortlist', label: 'Shortlist', icon: <Star className="h-4 w-4" />, show: isMarinaLike || isInvestor },
        { value: 'pricing', label: 'Pricing', icon: <ArrowRight className="h-4 w-4" /> },
        { value: 'notifications', label: 'Notifications', icon: <Bell className="h-4 w-4" /> },
      ].filter(item => item.show !== false);

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      {/* Account Header */}
      <div className="rounded-xl bg-gradient-to-r from-[#0b2653] to-[#143a6b] p-4 sm:p-6 text-white mb-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0 flex-1">
            {/* Avatar */}
            <div className="relative group">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="" className="w-14 h-14 rounded-full object-cover border-2 border-white/30" />
              ) : (
                <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center text-xl font-bold">
                  {(profile?.first_name?.[0] || user?.email?.[0] || '?').toUpperCase()}
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = 'image/jpeg,image/png,image/webp';
                  input.onchange = (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) uploadImage(f, 'avatar'); };
                  input.click();
                }}
                className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
              >
                {uploadingAvatar ? <Loader2 className="h-5 w-5 animate-spin text-white" /> : <Camera className="h-5 w-5 text-white" />}
              </button>
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl sm:text-2xl font-bold truncate">
                {profile?.first_name || profile?.last_name
                  ? `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim()
                  : 'My Account'}
              </h1>
              <div className="flex items-center gap-2 mt-1 text-white/80 text-sm flex-wrap">
                {getPersonaIcon()}
                <span>{getPersonaLabel()}</span>
                {org && <span className="truncate">• {org.name}</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {getAccessBadge()}
          </div>
        </div>
      </div>

      {/* Incomplete onboarding banner — hidden during onboarding since complete-registration tab has guidance */}
      {!isOnboarding && profile.onboarding_status === 'draft' && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start sm:items-center gap-3 min-w-0">
            <ClipboardList className="h-5 w-5 text-blue-600 shrink-0 mt-0.5 sm:mt-0" />
            <p className="text-blue-800 text-sm sm:text-base">Your profile is incomplete. Complete your organization details to be validated by our team.</p>
          </div>
          <Button size="sm" className="shrink-0 w-full sm:w-auto" onClick={() => navigate('/account?tab=complete-registration', { replace: true })}>Complete my profile</Button>
        </div>
      )}

      {/* Pending validation banner */}
      {profile.onboarding_status === 'submitted' && profile.access_status === 'pending' && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-yellow-600 shrink-0 mt-0.5" />
          <p className="text-yellow-800">
            Your profile is being reviewed by our team. You will receive a confirmation email.{' '}
            <Link to="/contact" className="underline font-medium hover:text-yellow-900">Contact support</Link>{' '}
            if you have questions.
          </p>
        </div>
      )}

      {/* Payment banners removed — member tier is free, sponsor upgrades handled via contact */}

      {/* Rejected account banner */}
      {profile.access_status === 'rejected' && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 space-y-2">
          <div className="flex items-center gap-3">
            <XCircle className="h-5 w-5 text-red-600 shrink-0" />
            <p className="text-red-800 font-medium">Your access request has been rejected.</p>
          </div>
          {profile.rejection_reason && (
            <p className="text-red-700 text-sm ml-8">Reason: {profile.rejection_reason}</p>
          )}
          <div className="ml-8">
            <Button size="sm" variant="outline" onClick={() => navigate('/onboarding')}>
              Edit and Resubmit
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-6">
        {/* ── Sidebar Navigation ── */}
        <aside className="hidden md:block w-56 shrink-0">
          <nav className="sticky top-24 space-y-1">
            {navItems.map((item) => (
              <button
                key={item.value}
                onClick={() => navigate(`/account?tab=${item.value}`, { replace: true })}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === item.value
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                <span className={activeTab === item.value ? 'text-white' : 'text-gray-400'}>{item.icon}</span>
                <span className="truncate">{item.label}</span>
                {item.notifDot && <NotifDot show />}
                {(item.notifCount ?? 0) > 0 && <NotifBadge count={item.notifCount!} />}
              </button>
            ))}
          </nav>
        </aside>

        {/* Mobile tabs (visible on small screens only) */}
        <div className="md:hidden w-full mb-4 overflow-x-auto">
          <div className="flex gap-1 pb-2">
            {navItems.map((item) => (
              <button
                key={item.value}
                onClick={() => navigate(`/account?tab=${item.value}`, { replace: true })}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  activeTab === item.value
                    ? 'bg-primary text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {item.label}
                {(item.notifCount ?? 0) > 0 && <NotifBadge count={item.notifCount!} />}
              </button>
            ))}
          </div>
        </div>

        {/* ── Main Content ── */}
        <div className="flex-1 min-w-0">
      <Tabs value={activeTab} onValueChange={(val) => navigate(`/account?tab=${val}`, { replace: true })}>
        <TabsList className="hidden">
          {navItems.map((item) => (
            <TabsTrigger key={item.value} value={item.value}>{item.label}</TabsTrigger>
          ))}
        </TabsList>

        {/* ── DASHBOARD ── */}
        <TabsContent value="dashboard">
          <div className="space-y-6">
            {/* Payment banners removed — member tier is free */}

            {/* Analytics Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Link to="/account?tab=inbox" className="block">
                <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-blue-500">
                  <CardContent className="pt-5 pb-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-500">Profile Views</p>
                        <p className="text-3xl font-bold text-gray-900">{profileViewCount}</p>
                      </div>
                      <div className="h-12 w-12 rounded-full bg-blue-50 flex items-center justify-center">
                        <Eye className="h-6 w-6 text-blue-600" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
              <Link to="/account?tab=inbox" className="block">
                <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-green-500">
                  <CardContent className="pt-5 pb-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-500">Connection Requests</p>
                        <p className="text-3xl font-bold text-gray-900">{connectionRequestCount}</p>
                      </div>
                      <div className="h-12 w-12 rounded-full bg-green-50 flex items-center justify-center">
                        <Users className="h-6 w-6 text-green-600" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
              <Link to="/account?tab=inbox" className="block">
                <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-amber-500">
                  <CardContent className="pt-5 pb-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-500">Pending Requests</p>
                        <p className="text-3xl font-bold text-gray-900">{pendingRequestCount}</p>
                      </div>
                      <div className="h-12 w-12 rounded-full bg-amber-50 flex items-center justify-center">
                        <Clock className="h-6 w-6 text-amber-600" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </div>

            {/* Personalized Feed */}
            <div className="grid md:grid-cols-2 gap-6">
              {/* Recommended Resources */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileText className="h-4 w-4 text-primary" />
                    Recommended Resources
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  {feedResources.length === 0 ? (
                    <p className="text-sm text-gray-400 py-4 text-center">No resources matching your sectors yet.</p>
                  ) : (
                    <div className="divide-y">
                      {feedResources.map(r => (
                        <Link key={r.id} to={`/resources/${r.id}`} className="block py-3 hover:bg-gray-50 -mx-2 px-2 rounded transition-colors">
                          <div className="flex items-start gap-2">
                            <Badge variant="outline" className="text-xs shrink-0 mt-0.5">{r.type}</Badge>
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-gray-900 truncate">{r.title}</div>
                              <div className="text-xs text-gray-500 truncate">{r.summary}</div>
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                  <Link to="/resources" className="text-xs text-primary hover:underline flex items-center gap-1 mt-3">
                    View all resources <ArrowRight className="h-3 w-3" />
                  </Link>
                </CardContent>
              </Card>

              {/* Upcoming Events */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-primary" />
                    Upcoming Events for You
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  {feedEvents.length === 0 ? (
                    <p className="text-sm text-gray-400 py-4 text-center">No events matching your sectors yet.</p>
                  ) : (
                    <div className="divide-y">
                      {feedEvents.map(e => (
                        <Link key={e.id} to={`/events/${e.id}`} className="block py-3 hover:bg-gray-50 -mx-2 px-2 rounded transition-colors">
                          <div className="flex items-center gap-3">
                            <div className="bg-primary/10 rounded-lg p-2 text-center min-w-[48px] shrink-0">
                              <div className="text-lg font-bold text-primary leading-none">{new Date(e.date_time).getDate()}</div>
                              <div className="text-[10px] text-gray-600">{new Date(e.date_time).toLocaleString('default', { month: 'short' })}</div>
                            </div>
                            <div className="text-sm font-medium text-gray-900 truncate">{e.title}</div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                  <Link to="/events" className="text-xs text-primary hover:underline flex items-center gap-1 mt-3">
                    View all events <ArrowRight className="h-3 w-3" />
                  </Link>
                </CardContent>
              </Card>
            </div>

            {/* Quick Activity */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  Quick Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                  <Link to="/account?tab=registrations" className="p-3 bg-gray-50 rounded-lg hover:bg-primary/5 transition-colors cursor-pointer">
                    <div className="text-xl font-bold text-primary">{registrations.length}</div>
                    <div className="text-xs text-gray-500">Event Registrations</div>
                  </Link>
                  <Link to="/account?tab=webinars" className="p-3 bg-gray-50 rounded-lg hover:bg-primary/5 transition-colors cursor-pointer">
                    <div className="text-xl font-bold text-primary">{webinarRequests.length}</div>
                    <div className="text-xs text-gray-500">Webinar Requests</div>
                  </Link>
                  {canProjects && (
                    <Link to="/account?tab=projects" className="p-3 bg-gray-50 rounded-lg hover:bg-primary/5 transition-colors cursor-pointer">
                      <div className="text-xl font-bold text-primary">{projects.length}</div>
                      <div className="text-xs text-gray-500">Projects</div>
                    </Link>
                  )}
                  {(canRFPs || canConsultations) && (
                    <Link to="/account?tab=rfps" className="p-3 bg-gray-50 rounded-lg hover:bg-primary/5 transition-colors cursor-pointer">
                      <div className="text-xl font-bold text-primary">{rfps.length + consultations.length}</div>
                      <div className="text-xs text-gray-500">RFPs & Consultations</div>
                    </Link>
                  )}
                </div>
              </CardContent>
            </Card>

          </div>
        </TabsContent>

        {/* ── COMPLETE REGISTRATION (onboarding step-by-step wizard) ── */}
        {isOnboarding && (
          <TabsContent value="complete-registration">
            <div className="space-y-6">
              {/* Step indicator — always visible */}
              <Card>
                <CardContent className="p-6">
                  <h2 className="text-lg font-bold mb-4">Complete Your Registration</h2>
                  <p className="text-sm text-gray-500 mb-6">
                    {currentOnboardingStep === 1 && 'Fill in your organization details to get started.'}
                    {currentOnboardingStep === 2 && 'Your profile is submitted for review.'}
                  </p>
                  <div className="flex items-center gap-3 mb-2">
                    {/* Step 1: Organization */}
                    <div className="flex items-center gap-2">
                      <div className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        currentOnboardingStep > 1 ? 'bg-green-100 text-green-700' : 'bg-primary/10 text-primary'
                      }`}>
                        {currentOnboardingStep > 1 ? <Check className="h-4 w-4" /> : '1'}
                      </div>
                      <span className={`text-sm font-medium ${
                        currentOnboardingStep > 1 ? 'text-green-700' : 'text-primary'
                      }`}>Organization</span>
                    </div>
                    <div className={`h-px flex-1 ${currentOnboardingStep > 1 ? 'bg-green-300' : 'bg-gray-200'}`} />
                    {/* Step 2: Admin Review */}
                    <div className="flex items-center gap-2">
                      <div className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        currentOnboardingStep === 2 ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-gray-400'
                      }`}>
                        2
                      </div>
                      <span className={`text-sm font-medium ${
                        currentOnboardingStep === 2 ? 'text-primary' : 'text-gray-400'
                      }`}>Admin Review</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* ── Step 1: Organization Details ── */}
              {currentOnboardingStep === 1 && (
                <OrganizationTab />
              )}

              {/* ── Step 2: Admin Review ── */}
              {currentOnboardingStep === 2 && (
                <Card className="border-primary/20">
                  <CardContent className="pt-8 pb-8">
                    <div className="text-center space-y-4">
                      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 mx-auto">
                        <ShieldCheck className="h-8 w-8 text-green-600" />
                      </div>
                      <h3 className="text-xl font-bold text-gray-900">Profile Submitted for Review</h3>
                      <p className="text-gray-600 max-w-md mx-auto">
                        Thank you for completing your registration! Our team reviews profiles very quickly —
                        you will receive a confirmation email as soon as your account is approved.
                      </p>
                      <div className="flex items-center justify-center gap-3 text-sm text-gray-500 mt-2">
                        <Clock className="h-4 w-4" />
                        <span>Typical review time: less than 24 hours</span>
                      </div>
                      <div className="pt-4">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={() => navigate('/account?tab=organization', { replace: true })}
                        >
                          <Pencil className="h-4 w-4" />
                          Edit my registration
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>
        )}

        {/* ── ORGANIZATION ── */}
        <TabsContent value="organization">
          <OrganizationTab />
        </TabsContent>

        {/* ── PROFILE ── */}
        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {profile.first_name || profile.last_name
                      ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim()
                      : user.email?.split('@')[0] || 'My Profile'}
                  </CardTitle>
                  <div className="flex items-center gap-2 mt-1">
                    {profile.job_title && <span className="text-sm text-gray-500">{profile.job_title}</span>}
                    {profile.job_title && <span className="text-gray-300">·</span>}
                    <Badge variant="outline" className="text-xs">{getPersonaIcon()} <span className="ml-1">{getPersonaLabel()}</span></Badge>
                  </div>
                </div>
                {!editingProfile ? (
                  <Button variant="outline" size="sm" onClick={() => setEditingProfile(true)} className="gap-2">
                    <Pencil className="h-4 w-4" />
                    Edit Profile
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => {
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
                      Cancel
                    </Button>
                    <Button size="sm" onClick={handleSaveProfile} disabled={savingProfile} className="gap-2">
                      {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Save
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Profile Image Upload */}
              <div className="flex items-center gap-4">
                <div className="relative group">
                  {profile.avatar_url ? (
                    <img src={profile.avatar_url} alt="Avatar" className="w-20 h-20 rounded-full object-cover border-2 border-gray-200" />
                  ) : (
                    <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xl border-2 border-gray-200">
                      {(profile.first_name?.[0] || '').toUpperCase()}{(profile.last_name?.[0] || '').toUpperCase()}
                    </div>
                  )}
                  <label className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                    {uploadingAvatar ? (
                      <Loader2 className="h-5 w-5 animate-spin text-white" />
                    ) : (
                      <Camera className="h-5 w-5 text-white" />
                    )}
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => { if (e.target.files?.[0]) uploadImage(e.target.files[0], 'avatar'); }} disabled={uploadingAvatar} />
                  </label>
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900">{profile.first_name} {profile.last_name}</div>
                  <div className="text-sm text-gray-500">{user.email}</div>
                  <label className="mt-2 inline-flex items-center gap-1.5 cursor-pointer rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
                    {uploadingAvatar ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    {profile.avatar_url ? 'Change photo' : 'Upload photo'}
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => { if (e.target.files?.[0]) uploadImage(e.target.files[0], 'avatar'); }} disabled={uploadingAvatar} />
                  </label>
                  <div className="text-[11px] text-gray-400 mt-1">Square JPG, PNG or WebP · up to 25&nbsp;MB. Large photos are optimised automatically.</div>
                </div>
              </div>

              {/* Personal Information */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">Personal Information</h3>
                {editingProfile ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-firstName">First Name</Label>
                      <Input
                        id="edit-firstName"
                        value={profileForm.firstName}
                        onChange={(e) => setProfileForm(prev => ({ ...prev, firstName: e.target.value }))}
                        placeholder="First name"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-lastName">Last Name</Label>
                      <Input
                        id="edit-lastName"
                        value={profileForm.lastName}
                        onChange={(e) => setProfileForm(prev => ({ ...prev, lastName: e.target.value }))}
                        placeholder="Last name"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-email">Email</Label>
                      <Input id="edit-email" value={user.email || ''} disabled className="bg-gray-50" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-jobTitle">Job Title</Label>
                      <Input
                        id="edit-jobTitle"
                        value={profileForm.jobTitle}
                        onChange={(e) => setProfileForm(prev => ({ ...prev, jobTitle: e.target.value }))}
                        placeholder="Job title"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500 block">First Name</span>
                      <span className="font-medium">{profile.first_name || '—'}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 block">Last Name</span>
                      <span className="font-medium">{profile.last_name || '—'}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 block">Email</span>
                      <span className="font-medium">{user.email}</span>
                    </div>
                    {profile.job_title && (
                      <div>
                        <span className="text-gray-500 block">Job Title</span>
                        <span className="font-medium">{profile.job_title}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Account Details */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">Account Details</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500 block">Persona</span>
                    <span className="font-medium">{getPersonaLabel()}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block">Status</span>
                    <span className="font-medium capitalize">{profile.access_status}</span>
                  </div>
                  {orgRole && (
                    <div>
                      <span className="text-gray-500 block">Organization Role</span>
                      <span className="font-medium capitalize">{orgRole}</span>
                    </div>
                  )}
                  <div>
                    <span className="text-gray-500 block">Registered</span>
                    <span className="font-medium">{new Date(profile.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                  </div>
                </div>
              </div>

              {/* Organization details (from org context) */}
              {org && (
                <div className="pt-4 border-t space-y-3">
                  {/* Org Info */}
                  <div className="flex items-center gap-3">
                    {org.logo_url ? (
                      <img src={org.logo_url} alt="Organization logo" className="w-14 h-14 rounded-lg object-cover border" />
                    ) : (
                      <div className="w-14 h-14 rounded-lg bg-gray-100 flex items-center justify-center border">
                        {isMarina ? <Anchor className="h-6 w-6 text-gray-300" /> : profile.persona === 'partner' ? <Building2 className="h-6 w-6 text-gray-300" /> : <Newspaper className="h-6 w-6 text-gray-300" />}
                      </div>
                    )}
                    <div className="text-sm">
                      <div className="font-medium text-gray-900">{org.name || '—'}</div>
                      <Link to="/account?tab=organization" className="text-xs text-primary hover:underline">Manage organization &rarr;</Link>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    {org.country && (
                      <div>
                        <span className="text-gray-500 block">Country</span>
                        <span className="font-medium">{org.country}</span>
                      </div>
                    )}
                    {org.city && (
                      <div>
                        <span className="text-gray-500 block">City</span>
                        <span className="font-medium">{org.city}</span>
                      </div>
                    )}
                    {org.headquarters_country && (
                      <div>
                        <span className="text-gray-500 block">Headquarters Country</span>
                        <span className="font-medium">{org.headquarters_country}</span>
                      </div>
                    )}
                  </div>
                  {org.description && (
                    <div className="text-sm">
                      <span className="text-gray-500 block mb-1">Description</span>
                      <p className="text-gray-700">{org.description}</p>
                    </div>
                  )}
                  {org.audience_description && (
                    <div className="text-sm">
                      <span className="text-gray-500 block mb-1">Audience</span>
                      <p className="text-gray-700">{org.audience_description}</p>
                    </div>
                  )}
                  {org.website && (
                    <a href={org.website} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                      <ExternalLink className="h-3 w-3" />
                      {org.website}
                    </a>
                  )}
                </div>
              )}

              {profile.onboarding_status === 'draft' && (
                <div className="pt-4">
                  <Button onClick={() => navigate('/account?tab=organization', { replace: true })} variant="outline">
                    Complete my profile
                  </Button>
                </div>
              )}

              {/* Security */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">Security</h3>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={async () => {
                    if (!user?.email) return;
                    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
                      redirectTo: `${window.location.origin}/account?tab=profile`,
                    });
                    if (error) {
                      toast({ title: 'Error', description: error.message, variant: 'destructive' });
                    } else {
                      toast({ title: 'Password reset email sent', description: 'Check your inbox for a link to reset your password.' });
                    }
                  }}
                >
                  <ShieldCheck className="h-4 w-4" />
                  Change Password
                </Button>
              </div>

              {/* Preview profile button */}
              <div className="pt-4 border-t">
                <Button variant="outline" onClick={() => setPreviewOpen(true)} className="gap-2">
                  <Eye className="h-4 w-4" />
                  Preview my profile
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── REGISTRATIONS ── */}
        <TabsContent value="registrations">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>My Event Registrations</CardTitle>
              <Link to="/events">
                <Button variant="outline" size="sm">
                  <Calendar className="h-4 w-4 mr-2" />
                  Browse Events
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              {dataLoading ? (
                <LoadingSkeleton variant="inline" />
              ) : registrations.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Calendar className="h-8 w-8 mx-auto mb-3 text-gray-300" />
                  <p>No registrations yet.</p>
                  <p className="text-sm mt-1">Browse upcoming events and register to attend.</p>
                  <Link to="/events" className="inline-block mt-3">
                    <Button variant="outline" size="sm">Browse Events</Button>
                  </Link>
                </div>
              ) : (
                <div className="space-y-4">
                  {registrations.map((reg) => {
                    const isPaid = reg.payment_status === 'paid' || reg.payment_status === 'free';
                    const needsPayment = reg.payment_status === 'pending_payment';
                    const isPendingApproval = reg.payment_status === 'pending_approval';
                    return (
                      <div key={reg.id} className={`flex items-center gap-4 p-4 border rounded-lg hover:bg-gray-50 transition-colors ${needsPayment ? 'border-amber-300 bg-amber-50/30' : ''}`}>
                        <Link to={`/events/${reg.event_id}`} className="flex items-center gap-4 flex-1 min-w-0">
                          <Calendar className="h-5 w-5 text-gray-400 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{reg.events?.title ?? '—'}</div>
                            {reg.events?.date_time && (
                              <div className="text-sm text-gray-500">
                                {new Date(reg.events.date_time).toLocaleDateString('en-US', {
                                  year: 'numeric', month: 'long', day: 'numeric',
                                })}
                              </div>
                            )}
                          </div>
                          {/* Payment status badge */}
                          {isPaid && <Badge className="bg-green-100 text-green-800 border-green-200 text-xs shrink-0"><CheckCircle className="h-3 w-3 mr-1" />Confirmed</Badge>}
                          {isPendingApproval && <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 text-xs shrink-0"><Clock className="h-3 w-3 mr-1" />Pending Approval</Badge>}
                          {needsPayment && <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-xs shrink-0"><AlertCircle className="h-3 w-3 mr-1" />Payment Due</Badge>}
                        </Link>
                        <div className="flex items-center gap-2 shrink-0">
                          {/* Event payment button removed — payment integration deferred */}
                          {/* Allow self-cancel for everything except registrations that
                              were actually paid for (those need a refund flow). */}
                          {reg.payment_status !== 'paid' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-red-500 hover:text-red-700 hover:bg-red-50"
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (!confirm('Are you sure you want to unregister from this event?')) return;
                                const { error } = await supabase
                                  .from('event_registrations')
                                  .delete()
                                  .eq('id', reg.id);
                                if (error) {
                                  toast({ title: 'Failed to unregister', description: error.message, variant: 'destructive' });
                                } else {
                                  toast({ title: 'Unregistered from event' });
                                  setRegistrations(prev => prev.filter(r => r.id !== reg.id));
                                }
                              }}
                            >
                              <X className="h-4 w-4 mr-1" />
                              Unregister
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── PROJECTS (marina or entitlement-granted) ── */}
        {canProjects && (
          <TabsContent value="projects">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>My Projects</CardTitle>
                <Button size="sm" onClick={() => navigate('/submit-project')}>
                  Submit a Project
                </Button>
              </CardHeader>
              <CardContent>
                {dataLoading ? (
                  <LoadingSkeleton variant="inline" />
                ) : projects.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">No projects submitted yet.</p>
                ) : (
                  <div className="space-y-4">
                    {projects.map((project) => (
                      <div key={project.id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="flex items-center gap-4">
                          <FileText className="h-5 w-5 text-gray-400 shrink-0" />
                          <div>
                            <div className="font-medium">{project.project_type}</div>
                            <div className="text-sm text-gray-500">
                              {new Date(project.created_at).toLocaleDateString('en-US')}
                              {project.budget_range && ` • ${formatBudgetRange(project.budget_range)}`}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {project.status === 'new' && (
                            <Button variant="outline" size="sm" onClick={() => navigate(`/submit-project/${project.id}`)}>
                              <Pencil className="h-3 w-3 mr-1" />Edit
                            </Button>
                          )}
                          <SubmissionStatusBadge status={project.status} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
        {/* ── WEBINAR REQUESTS ── */}
        <TabsContent value="webinars">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>My Webinar Requests</CardTitle>
              {profile?.access_status === 'verified' && (organization?.tier !== 'member' || profile?.persona !== 'partner') && (
                <Button size="sm" onClick={() => navigate('/request-webinar')}>
                  <Plus className="h-4 w-4 mr-2" />Propose a Webinar
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {profile?.access_status !== 'verified' ? (
                <div className="text-center py-8 text-gray-500">
                  <Clock className="h-8 w-8 mx-auto mb-3 text-amber-400" />
                  <p className="font-medium text-gray-700">Account Pending Approval</p>
                  <p className="text-sm mt-1">You'll be able to propose webinars once your profile is verified by our team.</p>
                </div>
              ) : (organization?.tier === 'member' && profile?.persona === 'partner') ? (
                <div className="text-center py-8 text-gray-500">
                  <Radio className="h-8 w-8 mx-auto mb-3 text-gray-300" />
                  <p className="font-medium text-gray-700">Upgrade Required</p>
                  <p className="text-sm mt-1 max-w-md mx-auto">Webinar proposals are available starting from the Innovation Partner tier. Upgrade your membership to unlock this feature.</p>
                  <Button className="mt-4" size="sm" variant="outline" onClick={() => navigate('/tiers')}>
                    View Membership Plans
                  </Button>
                </div>
              ) : dataLoading ? (
                <LoadingSkeleton variant="inline" />
              ) : webinarRequests.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Radio className="h-8 w-8 mx-auto mb-3 text-gray-300" />
                  <p>No webinar requests submitted.</p>
                  <Button className="mt-4" size="sm" onClick={() => navigate('/request-webinar')}>
                    Propose a Topic
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {webinarRequests.map((req) => (
                    <div key={req.id} className="p-4 border rounded-lg space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium">{req.title}</div>
                        <WebinarStatusBadge status={req.status} />
                      </div>
                      <div className="text-sm text-gray-500">
                        {req.preferred_language === 'EN' ? 'English' : 'Français'}
                        {req.preferred_timeframe && ` · ${req.preferred_timeframe}`}
                        {' · '}{new Date(req.created_at).toLocaleDateString('en-US')}
                      </div>
                      {req.moderator_notes && (
                        <div className="text-sm bg-blue-50 border border-blue-100 rounded p-3 text-blue-800">
                          <span className="font-medium">Team Note:</span>
                          {req.moderator_notes}
                        </div>
                      )}
                      {req.status === 'submitted' && (
                        <div className="flex gap-2 pt-1">
                          <Button variant="outline" size="sm" onClick={() => navigate(`/request-webinar?edit=${req.id}`)}>
                            Edit
                          </Button>
                          <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700 hover:bg-red-50" onClick={async () => {
                            if (!confirm('Withdraw this webinar request?')) return;
                            await supabase.from('webinar_requests').delete().eq('id', req.id);
                            setWebinarRequests(prev => prev.filter(r => r.id !== req.id));
                            toast({ title: 'Request deleted' });
                          }}>
                            <X className="h-4 w-4 mr-1" />Withdraw
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── RFPs (marina or entitlement-granted) ── */}
        {canRFPs && (
          <TabsContent value="rfps">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <ClipboardList className="h-5 w-5" />
                  My RFPs
                </CardTitle>
                <Button size="sm" onClick={() => navigate('/submit-rfp')}>
                  <Plus className="h-4 w-4 mr-2" />Submit an RFP
                </Button>
              </CardHeader>
              <CardContent>
                {dataLoading ? (
                  <LoadingSkeleton variant="inline" />
                ) : rfps.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <ClipboardList className="h-8 w-8 mx-auto mb-3 text-gray-300" />
                    <p>No RFPs submitted.</p>
                    <Button className="mt-4" size="sm" onClick={() => navigate('/submit-rfp')}>
                      Create an RFP
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {rfps.map((rfp) => (
                      <div key={rfp.id} className="p-4 border rounded-lg space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-medium">{rfp.title}</div>
                          <SubmissionStatusBadge status={rfp.status || (rfp.is_open ? 'open' : 'closed')} />
                        </div>
                        {rfp.rejection_reason && rfp.status === 'rejected' && (
                          <p className="text-sm text-red-600 mt-1">
                            <span className="font-medium">Reason:</span> {rfp.rejection_reason}
                          </p>
                        )}
                        <p className="text-sm text-gray-600 line-clamp-2">{rfp.scope}</p>
                        <div className="text-sm text-gray-500">
                          {rfp.deadline_date && `Deadline:${new Date(rfp.deadline_date).toLocaleDateString('en-US')} · `}
                          Created {new Date(rfp.created_at).toLocaleDateString('en-US')}
                        </div>
                        <div className="flex gap-2 pt-1">
                          {(rfp.status === 'submitted' || rfp.status === 'rejected') && (
                            <Button variant="outline" size="sm" onClick={() => navigate(`/submit-rfp/${rfp.id}`)}>
                              <Pencil className="h-3 w-3 mr-1" />Edit
                            </Button>
                          )}
                          <Button variant="outline" size="sm" onClick={async () => {
                            const newOpen = !rfp.is_open;
                            await supabase.from('rfps').update({ is_open: newOpen }).eq('id', rfp.id);
                            setRfps(prev => prev.map(r => r.id === rfp.id ? { ...r, is_open: newOpen } : r));
                            toast({ title: newOpen ? 'RFP reopened' : 'RFP closed' });
                          }}>
                            {rfp.is_open ? 'Close' : 'Reopen'}
                          </Button>
                          <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700 hover:bg-red-50" onClick={async () => {
                            if (!confirm('Delete this RFP?')) return;
                            await supabase.from('rfps').delete().eq('id', rfp.id);
                            setRfps(prev => prev.filter(r => r.id !== rfp.id));
                            toast({ title: 'RFP deleted' });
                          }}>
                            <X className="h-4 w-4 mr-1" />Delete
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* ── CONSULTATIONS (marina or entitlement-granted) ── */}
        {canConsultations && (
          <TabsContent value="consultations">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="h-5 w-5" />
                  My Consultations
                </CardTitle>
                <Button size="sm" onClick={() => navigate('/submit-consultation')}>
                  <Plus className="h-4 w-4 mr-2" />New Consultation
                </Button>
              </CardHeader>
              <CardContent>
                {dataLoading ? (
                  <LoadingSkeleton variant="inline" />
                ) : consultations.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <MessageSquare className="h-8 w-8 mx-auto mb-3 text-gray-300" />
                    <p>No consultations submitted.</p>
                    <Button className="mt-4" size="sm" onClick={() => navigate('/submit-consultation')}>
                      Ask a Question
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {consultations.map((c) => (
                      <div key={c.id} className="p-4 border rounded-lg space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-medium">{c.title}</div>
                          <SubmissionStatusBadge status={c.status || (c.is_open ? 'open' : 'closed')} />
                        </div>
                        {c.rejection_reason && c.status === 'rejected' && (
                          <p className="text-sm text-red-600 mt-1">
                            <span className="font-medium">Reason:</span> {c.rejection_reason}
                          </p>
                        )}
                        <p className="text-sm text-gray-600 line-clamp-2">{c.description}</p>
                        <div className="text-sm text-gray-500">
                          Created {new Date(c.created_at).toLocaleDateString('en-US')}
                        </div>
                        <div className="flex gap-2 pt-1">
                          {(c.status === 'submitted' || c.status === 'rejected') && (
                            <Button variant="outline" size="sm" onClick={() => navigate(`/submit-consultation/${c.id}`)}>
                              <Pencil className="h-3 w-3 mr-1" />Edit
                            </Button>
                          )}
                          <Button variant="outline" size="sm" onClick={async () => {
                            const newOpen = !c.is_open;
                            await supabase.from('consultations').update({ is_open: newOpen }).eq('id', c.id);
                            setConsultations(prev => prev.map(x => x.id === c.id ? { ...x, is_open: newOpen } : x));
                            toast({ title: newOpen ? 'Consultation reopened' : 'Consultation closed' });
                          }}>
                            {c.is_open ? 'Close' : 'Reopen'}
                          </Button>
                          <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700 hover:bg-red-50" onClick={async () => {
                            if (!confirm('Delete this consultation?')) return;
                            await supabase.from('consultations').delete().eq('id', c.id);
                            setConsultations(prev => prev.filter(x => x.id !== c.id));
                            toast({ title: 'Consultation deleted' });
                          }}>
                            <X className="h-4 w-4 mr-1" />Delete
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* S3 Pre-Audit archived — will be deployed later */}

        {/* ── RECOMMENDATIONS (gated on org type, not user persona, so
            admin/moderator/owner of a partner org all have access) ── */}
        {isPartnerOrg && (
          <TabsContent value="references">
            <ReferenceRequestForm onReferenceSubmitted={refreshOnboardingState} />
          </TabsContent>
        )}

        {/* ── MY SUBMISSIONS ── */}
        {(isMarina || isPartner) && (
          <TabsContent value="submissions">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  My Submissions
                </CardTitle>
                <p className="text-sm text-gray-500">Track the status of everything you have submitted across the platform.</p>
              </CardHeader>
              <CardContent>
                {submissionsLoading ? (
                  <LoadingSkeleton variant="inline" />
                ) : (
                  <div className="space-y-4">
                    {/* ── Projects Section ── */}
                    {canProjects && (
                      <div className="border rounded-lg">
                        <button
                          type="button"
                          onClick={() => toggleSection('projects')}
                          className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex items-center gap-2 font-medium">
                            <Anchor className="h-4 w-4 text-gray-500" />
                            My Projects
                            <Badge variant="secondary" className="ml-1 text-xs">{subProjects.length}</Badge>
                          </div>
                          {expandedSections.projects ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                        </button>
                        {expandedSections.projects && (
                          <div className="border-t px-4 pb-4">
                            {subProjects.length === 0 ? (
                              <div className="text-center py-6 text-gray-500">
                                <p className="text-sm">No projects submitted yet.</p>
                                <Link to="/submit-project" className="text-sm text-primary hover:underline mt-1 inline-block">Submit a project</Link>
                              </div>
                            ) : (
                              <div className="divide-y">
                                {subProjects.map((p) => (
                                  <div key={p.id} className="py-3 flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="font-medium text-sm">{p.project_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</div>
                                      <div className="text-xs text-gray-500">
                                        {new Date(p.created_at).toLocaleDateString('en-US')}
                                        {p.budget_range && ` · ${formatBudgetRange(p.budget_range)}`}
                                        {p.timeline && ` · ${p.timeline.replace(/_/g, ' ')}`}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {p.status === 'new' && (
                                        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => navigate(`/submit-project/${p.id}`)}>
                                          <Pencil className="h-3 w-3" />
                                        </Button>
                                      )}
                                      <SubmissionStatusBadge status={p.status} />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── RFPs Section ── */}
                    {canRFPs && (
                      <div className="border rounded-lg">
                        <button
                          type="button"
                          onClick={() => toggleSection('rfps')}
                          className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex items-center gap-2 font-medium">
                            <ClipboardList className="h-4 w-4 text-gray-500" />
                            My RFPs
                            <Badge variant="secondary" className="ml-1 text-xs">{subRfps.length}</Badge>
                          </div>
                          {expandedSections.rfps ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                        </button>
                        {expandedSections.rfps && (
                          <div className="border-t px-4 pb-4">
                            {subRfps.length === 0 ? (
                              <div className="text-center py-6 text-gray-500">
                                <p className="text-sm">No RFPs submitted yet.</p>
                                <Link to="/submit-rfp" className="text-sm text-primary hover:underline mt-1 inline-block">Submit an RFP</Link>
                              </div>
                            ) : (
                              <div className="divide-y">
                                {subRfps.map((r) => (
                                  <div key={r.id} className="py-3 flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="font-medium text-sm">{r.title}</div>
                                      <p className="text-xs text-gray-500 line-clamp-1">{r.scope}</p>
                                      <div className="text-xs text-gray-400">
                                        {r.deadline_date && `Deadline: ${new Date(r.deadline_date).toLocaleDateString('en-US')} · `}
                                        Created {new Date(r.created_at).toLocaleDateString('en-US')}
                                      </div>
                                      {r.rejection_reason && r.status === 'rejected' && (
                                        <p className="text-xs text-red-600 mt-1">
                                          <span className="font-medium">Reason:</span> {r.rejection_reason}
                                        </p>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {(r.status === 'submitted' || r.status === 'rejected') && (
                                        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => navigate(`/submit-rfp/${r.id}`)}>
                                          <Pencil className="h-3 w-3" />
                                        </Button>
                                      )}
                                      <SubmissionStatusBadge status={r.status || (r.is_open ? 'open' : 'closed')} />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── Consultations Section ── */}
                    {canConsultations && (
                      <div className="border rounded-lg">
                        <button
                          type="button"
                          onClick={() => toggleSection('consultations')}
                          className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex items-center gap-2 font-medium">
                            <MessageSquare className="h-4 w-4 text-gray-500" />
                            My Consultations
                            <Badge variant="secondary" className="ml-1 text-xs">{subConsultations.length}</Badge>
                          </div>
                          {expandedSections.consultations ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                        </button>
                        {expandedSections.consultations && (
                          <div className="border-t px-4 pb-4">
                            {subConsultations.length === 0 ? (
                              <div className="text-center py-6 text-gray-500">
                                <p className="text-sm">No consultations submitted yet.</p>
                                <Link to="/submit-consultation" className="text-sm text-primary hover:underline mt-1 inline-block">Start a consultation</Link>
                              </div>
                            ) : (
                              <div className="divide-y">
                                {subConsultations.map((c) => (
                                  <div key={c.id} className="py-3 flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="font-medium text-sm">{c.title}</div>
                                      <p className="text-xs text-gray-500 line-clamp-1">{c.description}</p>
                                      <div className="text-xs text-gray-400">
                                        Created {new Date(c.created_at).toLocaleDateString('en-US')}
                                      </div>
                                      {c.rejection_reason && c.status === 'rejected' && (
                                        <p className="text-xs text-red-600 mt-1">
                                          <span className="font-medium">Reason:</span> {c.rejection_reason}
                                        </p>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {(c.status === 'submitted' || c.status === 'rejected') && (
                                        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => navigate(`/submit-consultation/${c.id}`)}>
                                          <Pencil className="h-3 w-3" />
                                        </Button>
                                      )}
                                      <SubmissionStatusBadge status={c.status || (c.is_open ? 'open' : 'closed')} />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── Webinar Requests Section (all users) ── */}
                    <div className="border rounded-lg">
                      <button
                        type="button"
                        onClick={() => toggleSection('webinars')}
                        className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex items-center gap-2 font-medium">
                          <Radio className="h-4 w-4 text-gray-500" />
                          My Webinar Requests
                          <Badge variant="secondary" className="ml-1 text-xs">{subWebinars.length}</Badge>
                        </div>
                        {expandedSections.webinars ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                      </button>
                      {expandedSections.webinars && (
                        <div className="border-t px-4 pb-4">
                          {subWebinars.length === 0 ? (
                            <div className="text-center py-6 text-gray-500">
                              <p className="text-sm">No webinar requests submitted yet.</p>
                              <Link to="/request-webinar" className="text-sm text-primary hover:underline mt-1 inline-block">Propose a webinar</Link>
                            </div>
                          ) : (
                            <div className="divide-y">
                              {subWebinars.map((w) => (
                                <div key={w.id} className="py-3 flex items-center justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="font-medium text-sm">{w.title}</div>
                                    <div className="text-xs text-gray-500">
                                      {w.preferred_language === 'EN' ? 'English' : 'Francais'}
                                      {' · '}{new Date(w.created_at).toLocaleDateString('en-US')}
                                    </div>
                                  </div>
                                  <SubmissionStatusBadge status={w.status} />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Summary if everything is empty */}
                    {subProjects.length === 0 && subRfps.length === 0 && subConsultations.length === 0 && subWebinars.length === 0 && (
                      <div className="text-center py-6 text-gray-500">
                        <FileText className="h-10 w-10 mx-auto mb-3 text-gray-300" />
                        <p className="font-medium">No submissions yet</p>
                        <p className="text-sm mt-1">Start by submitting a project, RFP, consultation, or webinar request.</p>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* ── INBOX (unified) ── */}
        <TabsContent value="inbox">
          <InboxTab />
        </TabsContent>

        {/* ── PRICING ── */}
        <TabsContent value="pricing">
          <TiersPage embedded />
        </TabsContent>

        {/* ── SHORTLIST (marina + developer + investor) ── */}
        {(isMarinaLike || isInvestor) && (
          <TabsContent value="shortlist">
            <ShortlistTab />
          </TabsContent>
        )}

        {/* ── NOTIFICATIONS ── */}
        <TabsContent value="notifications">
          <NotificationPreferencesTab />
        </TabsContent>

      </Tabs>
        </div>{/* end main content */}
      </div>{/* end flex sidebar layout */}

      {/* ── PROFILE PREVIEW DIALOG ── */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-center">Profile Preview</DialogTitle>
            <p className="text-xs text-gray-500 text-center">This is how other users see your profile</p>
          </DialogHeader>

          <div className="space-y-6 pt-2">
            {/* Avatar + Name + Persona */}
            <div className="flex flex-col items-center text-center gap-3">
              {profile.avatar_url ? (
                <img src={profile.avatar_url} alt="Avatar" className="w-24 h-24 rounded-full object-cover border-2 border-primary/20 shadow" />
              ) : (
                <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-2xl border-2 border-primary/20 shadow">
                  {(profile.first_name?.[0] || '').toUpperCase()}{(profile.last_name?.[0] || '').toUpperCase()}
                </div>
              )}
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {profile.first_name} {profile.last_name}
                </h3>
                <Badge variant="outline" className="mt-1 gap-1">
                  {getPersonaIcon()} {getPersonaLabel()}
                </Badge>
              </div>
            </div>

            {/* Organization Card */}
            {org && (
              <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                {/* Logo + Org Name */}
                <div className="flex items-center gap-3">
                  {org.logo_url ? (
                    <img src={org.logo_url} alt="Logo" className="w-12 h-12 rounded-lg object-contain border bg-white p-0.5" />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-white flex items-center justify-center border">
                      {isMarina ? <Anchor className="h-5 w-5 text-gray-300" /> : profile.persona === 'partner' ? <Building2 className="h-5 w-5 text-gray-300" /> : <Newspaper className="h-5 w-5 text-gray-300" />}
                    </div>
                  )}
                  <div className="font-semibold text-gray-900">{org.name}</div>
                </div>

                {/* Details grid */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {(org.city || org.country) && (
                    <div>
                      <span className="text-gray-500 text-xs">Location</span>
                      <div className="text-gray-800">{[org.city, org.country].filter(Boolean).join(', ')}</div>
                    </div>
                  )}
                  {org.headquarters_country && (
                    <div>
                      <span className="text-gray-500 text-xs">Headquarters</span>
                      <div className="text-gray-800">{org.headquarters_country}</div>
                    </div>
                  )}
                  {profile.job_title && (
                    <div>
                      <span className="text-gray-500 text-xs">Position</span>
                      <div className="text-gray-800">{profile.job_title}</div>
                    </div>
                  )}
                </div>

                {/* Description / Audience */}
                {org.description && (
                  <div className="text-sm">
                    <span className="text-gray-500 text-xs block mb-1">About</span>
                    <p className="text-gray-700 line-clamp-3">{org.description}</p>
                  </div>
                )}
                {org.audience_description && (
                  <div className="text-sm">
                    <span className="text-gray-500 text-xs block mb-1">Audience</span>
                    <p className="text-gray-700 line-clamp-3">{org.audience_description}</p>
                  </div>
                )}

                {/* Website */}
                {org.website && (
                  <a href={org.website} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                    <ExternalLink className="h-3 w-3" />
                    {org.website}
                  </a>
                )}
              </div>
            )}

            <div className="flex justify-center pt-2">
              <Button variant="outline" size="sm" onClick={() => setPreviewOpen(false)}>
                Close preview
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Event Payment Dialog removed — payment integration deferred */}
    </div>
  );
}

function WebinarStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    submitted: { label: 'Submitted', className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
    under_review: { label: 'Under Review', className: 'bg-blue-100 text-blue-800 border-blue-200' },
    accepted: { label: 'Accepted', className: 'bg-green-100 text-green-800 border-green-200' },
    rejected: { label: 'Rejected', className: 'bg-red-100 text-red-800 border-red-200' },
  };
  const s = map[status] ?? { label: status, className: 'bg-gray-100 text-gray-800' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${s.className}`}>
      {s.label}
    </span>
  );
}

function SubmissionStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    // Project / generic statuses
    submitted: { label: 'Submitted', className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
    pending: { label: 'Pending', className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
    under_review: { label: 'Under Review', className: 'bg-blue-100 text-blue-800 border-blue-200' },
    in_progress: { label: 'In Progress', className: 'bg-blue-100 text-blue-800 border-blue-200' },
    accepted: { label: 'Accepted', className: 'bg-green-100 text-green-800 border-green-200' },
    approved: { label: 'Approved', className: 'bg-green-100 text-green-800 border-green-200' },
    completed: { label: 'Completed', className: 'bg-green-100 text-green-800 border-green-200' },
    active: { label: 'Active', className: 'bg-green-100 text-green-800 border-green-200' },
    open: { label: 'Open', className: 'bg-green-100 text-green-800 border-green-200' },
    rejected: { label: 'Rejected', className: 'bg-red-100 text-red-800 border-red-200' },
    closed: { label: 'Closed', className: 'bg-gray-100 text-gray-700 border-gray-200' },
    cancelled: { label: 'Cancelled', className: 'bg-gray-100 text-gray-700 border-gray-200' },
  };
  const s = map[status] ?? { label: status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), className: 'bg-gray-100 text-gray-800' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border shrink-0 ${s.className}`}>
      {s.label}
    </span>
  );
}
