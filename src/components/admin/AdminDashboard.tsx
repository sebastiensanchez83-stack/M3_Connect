import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
// Filtered navigation helper: builds URL with search params
import {
  Users, UserCheck, FileText, Calendar, Anchor, RefreshCw, Building2,
  Link2, MessageSquare, ChevronRight, FolderOpen,
  CreditCard, TrendingUp, AlertCircle, DollarSign, Ship, Newspaper,
  ArrowUpRight, ArrowDownRight, Clock, CheckCircle, XCircle, Eye,
  BarChart3, Activity, Zap, AlertTriangle, Target, Flame,
  UserX, Star, Lightbulb, TrendingDown, ArrowRight, Inbox,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import {
  AdminPageHeader, AdminKpiCard, AdminSectionLabel, AdminStatusPill, ADMIN_BTN,
} from './AdminUI';
import { supabase } from '@/lib/supabase';
import { TIER_LABELS, TIER_COLORS, OrgTier } from '@/types/database';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  AreaChart, Area, Legend, LineChart, Line,
} from 'recharts';

/* ══════════════════════════════ TYPES ══════════════════════════════ */

interface DashboardStats {
  totalUsers: number;
  verifiedUsers: number;
  pendingUsers: number;
  rejectedUsers: number;
  suspendedUsers: number;
  marinaCount: number;
  partnerCount: number;
  mediaCount: number;
  individualCount: number;
  // Growth
  signupsThisMonth: number;
  signupsLastMonth: number;
  signupsThisWeek: number;
  signupsLastWeek: number;
  // Orgs
  totalOrgs: number;
  tierBreakdown: Record<string, number>;
  // Revenue
  totalRevenueCents: number;
  revenueThisMonthCents: number;
  pendingPayments: number;
  // Content
  totalResources: number;
  pendingResourceDrafts: number;
  totalEvents: number;
  upcomingEvents: number;
  totalRegistrations: number;
  pendingRegistrations: number;
  // Actions
  newWebinars: number;
  newProjects: number;
  newLeads: number;
  pendingB2B: number;
  openRFPs: number;
  openConsultations: number;
  // Leads pipeline
  qualifiedLeads: number;
  inDiscussionLeads: number;
  signedLeads: number;
  // Aging
  usersWaiting48h: number;
  oldB2BRequests: number;
  oldLeadsNotContacted: number;
}

interface MonthlyPoint { month: string; count: number; }
interface RevenuePoint { month: string; revenue: number; }
interface EventPerf {
  id: string; title: string; date_time: string;
  registrations: number; capacity: number; fillRate: number;
}
interface RecentUser {
  user_id: string; first_name: string | null; last_name: string | null;
  email: string | null; persona: string; access_status: string; created_at: string;
}
interface RecentPayment {
  id: string; amount_cents: number; payment_type: string; status: string;
  created_at: string; user_id: string;
}
interface InsightItem {
  icon: React.ElementType; text: string; type: 'success' | 'warning' | 'danger' | 'info';
}

/* ══════════════════════════════ COLORS ══════════════════════════════ */

const PERSONA_COLORS: Record<string, string> = {
  marina: '#0b2653', partner: '#1f7a8c', media_partner: '#64748b',
  individual: '#d7a647', admin: '#b91c1c', moderator: '#b91c1c',
};
const STATUS_COLORS: Record<string, string> = {
  verified: '#1f7a8c', pending: '#d7a647',
  rejected: '#b91c1c', suspended: '#64748b',
};
const TIER_CHART_COLORS: Record<string, string> = {
  member: '#94a3b8', innovation_partner: '#4a6fa5', associate_partner: '#1f7a8c',
  premium_partner: '#d7a647', premium_sponsor: '#0b2653', main_sponsor: '#081d40',
};
const LEAD_STATUS_COLORS: Record<string, string> = {
  new: '#d7a647', qualified: '#4a6fa5', in_discussion: '#1f7a8c',
  signed: '#0b2653', rejected: '#b91c1c',
};

/* ══════════════════════════════ REVIEW QUEUE CARD ══════════════════════════════ */

/**
 * The figure of "N items to review": admin_review_queue_count() (staff only,
 * migration 20261009230000). null while unknown: function not deployed yet, or
 * any error. Keyed on the user id (auth re-emits the user on every tab refocus).
 */
function useReviewQueueCount(uid: string | undefined): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    supabase.rpc('admin_review_queue_count').then(({ data, error }) => {
      if (alive) setCount(!error && typeof data === 'number' ? data : null);
    });
    return () => { alive = false; };
  }, [uid]);
  return count;
}

/** "N items to review": the way into /admin/review. Not shown while the count is unknown. */
function ReviewQueueCard({ count, isAdmin }: { count: number | null; isAdmin: boolean }) {
  const { t } = useTranslation();
  if (count === null) return null;
  const waiting = count > 0;
  return (
    <Link
      to="/admin/review"
      className={`group flex items-center gap-4 rounded-card border bg-white p-4 transition-[box-shadow,border-color] duration-200 hover:shadow-hover focus:outline-none focus-visible:shadow-focus motion-reduce:transition-none sm:p-5 ${
        waiting ? 'border-gold/60 hover:border-gold' : 'border-rule hover:border-navy/25'
      }`}
    >
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${waiting ? 'bg-gold/25' : 'bg-chip'} text-navy`}>
        {waiting ? <Inbox className="h-5 w-5" aria-hidden="true" /> : <CheckCircle className="h-5 w-5" aria-hidden="true" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[18px] font-semibold leading-6 tabular-nums text-navy">
          {waiting
            ? t('adminReview.card.count', { count, defaultValue_one: '{{count}} item to review', defaultValue_other: '{{count}} items to review' })
            : t('adminReview.card.none', 'Nothing to review')}
        </span>
        <span className="block text-[13px] leading-5 text-meta">
          {waiting
            ? (isAdmin
              ? t('adminReview.card.body', 'People, companies, event requests and content waiting for a decision from M3.')
              : t('adminReview.card.bodyModerator', 'Reported conversations, webinar proposals and article drafts waiting for review.'))
            : t('adminReview.card.noneBody', 'Everything waiting for M3 has been handled.')}
        </span>
      </span>
      <span className="hidden shrink-0 items-center gap-1 text-[14px] font-semibold text-navy sm:inline-flex">
        {t('adminReview.card.open', 'Open the list')}
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-meta sm:hidden" aria-hidden="true" />
    </Link>
  );
}

/* ══════════════════════════════ COMPONENT ══════════════════════════════ */

export function AdminDashboard() {
  const { t } = useTranslation();
  const { user, isAdmin, profile } = useAuth();
  const reviewCount = useReviewQueueCount(user?.id);
  const navigate = useNavigate();
  /** Navigate to admin sub-page with pre-set URL filters */
  const nav = (path: string, params?: Record<string, string | undefined>) => {
    if (params) {
      // Filter out undefined values
      const clean: Record<string, string> = {};
      Object.entries(params).forEach(([k, v]) => { if (v) clean[k] = v; });
      const qs = Object.keys(clean).length > 0 ? '?' + new URLSearchParams(clean).toString() : '';
      navigate(`${path}${qs}`);
    } else {
      navigate(path);
    }
  };
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats>({
    totalUsers: 0, verifiedUsers: 0, pendingUsers: 0,
    rejectedUsers: 0, suspendedUsers: 0,
    marinaCount: 0, partnerCount: 0, mediaCount: 0, individualCount: 0,
    signupsThisMonth: 0, signupsLastMonth: 0, signupsThisWeek: 0, signupsLastWeek: 0,
    totalOrgs: 0, tierBreakdown: {},
    totalRevenueCents: 0, revenueThisMonthCents: 0, pendingPayments: 0,
    totalResources: 0, pendingResourceDrafts: 0,
    totalEvents: 0, upcomingEvents: 0, totalRegistrations: 0, pendingRegistrations: 0,
    newWebinars: 0, newProjects: 0, newLeads: 0,
    pendingB2B: 0, openRFPs: 0, openConsultations: 0,
    qualifiedLeads: 0, inDiscussionLeads: 0, signedLeads: 0,
    usersWaiting48h: 0, oldB2BRequests: 0, oldLeadsNotContacted: 0,
  });
  const [monthlySignups, setMonthlySignups] = useState<MonthlyPoint[]>([]);
  const [monthlyRevenue, setMonthlyRevenue] = useState<RevenuePoint[]>([]);
  const [eventPerf, setEventPerf] = useState<EventPerf[]>([]);
  const [recentUsers, setRecentUsers] = useState<RecentUser[]>([]);
  const [recentPayments, setRecentPayments] = useState<RecentPayment[]>([]);
  const [inactiveUsers, setInactiveUsers] = useState<number>(0);
  const [notActivatedUsers, setNotActivatedUsers] = useState<number>(0);

  useEffect(() => { loadDashboard(); }, []);

  /* ─── DATA LOADING ─── */

  const loadDashboard = async () => {
    setLoading(true);
    try {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
      const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString();
      const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString();
      // Week boundaries
      const dayOfWeek = now.getDay() || 7;
      const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - dayOfWeek + 1); startOfWeek.setHours(0,0,0,0);
      const startOfLastWeek = new Date(startOfWeek); startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);
      const endOfLastWeek = new Date(startOfWeek); endOfLastWeek.setMilliseconds(-1);
      // Aging thresholds
      const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

      const [
        { count: totalUsers }, { count: verifiedUsers }, { count: pendingUsers },
        { count: rejectedUsers }, { count: suspendedUsers },
        { count: marinaCount }, { count: partnerCount }, { count: mediaCount }, { count: individualCount },
        { count: signupsThisMonth }, { count: signupsLastMonth },
        { count: signupsThisWeek }, { count: signupsLastWeek },
        { data: orgTiers },
        { data: paidPayments }, { data: monthPayments }, { count: pendingPaymentCount },
        { count: totalResources }, { count: pendingResourceDrafts },
        { count: totalEvents }, { count: upcomingEvents },
        { count: totalRegistrations }, { count: pendingRegistrations },
        { count: newWebinars }, { count: newProjects },
        { count: newLeads }, { count: qualifiedLeads }, { count: inDiscussionLeads }, { count: signedLeads },
        { count: pendingB2B }, { count: openRFPs }, { count: openConsultations },
        // Aging
        { count: usersWaiting48h }, { count: oldB2BRequests }, { count: oldLeadsNotContacted },
        // Trends
        { data: signupTrend }, { data: revenueTrend },
        // Recent
        { data: recent }, { data: recentPay },
        // Events with registrations
        { data: upcomingEventsData },
        // Inactive / not-activated
        { count: inactiveCount },
        { count: notActivatedCount },
      ] = await Promise.all([
        // Core user counts
        supabase.from('profiles').select('user_id', { count: 'exact' }),
        supabase.from('profiles').select('user_id', { count: 'exact' }).eq('access_status', 'verified'),
        supabase.from('profiles').select('user_id', { count: 'exact' }).eq('access_status', 'pending'),
        supabase.from('profiles').select('user_id', { count: 'exact' }).eq('access_status', 'rejected'),
        supabase.from('profiles').select('user_id', { count: 'exact' }).eq('access_status', 'suspended'),
        supabase.from('profiles').select('user_id', { count: 'exact' }).eq('persona', 'marina'),
        supabase.from('profiles').select('user_id', { count: 'exact' }).eq('persona', 'partner'),
        supabase.from('profiles').select('user_id', { count: 'exact' }).eq('persona', 'media_partner'),
        supabase.from('profiles').select('user_id', { count: 'exact' }).eq('persona', 'individual'),
        // Growth
        supabase.from('profiles').select('user_id', { count: 'exact' }).gte('created_at', startOfMonth),
        supabase.from('profiles').select('user_id', { count: 'exact' }).gte('created_at', startOfLastMonth).lte('created_at', endOfLastMonth),
        supabase.from('profiles').select('user_id', { count: 'exact' }).gte('created_at', startOfWeek.toISOString()),
        supabase.from('profiles').select('user_id', { count: 'exact' }).gte('created_at', startOfLastWeek.toISOString()).lte('created_at', endOfLastWeek.toISOString()),
        // Orgs
        supabase.from('organizations').select('tier'),
        // Revenue
        supabase.from('payments').select('amount_cents').eq('status', 'paid'),
        supabase.from('payments').select('amount_cents').eq('status', 'paid').gte('paid_at', startOfMonth),
        supabase.from('payments').select('id', { count: 'exact' }).eq('status', 'pending'),
        // The old sponsorship_requests and exposition_requests queues are no longer
        // counted here: both tables were empty when they were archived (8 Oct 2026),
        // nothing feeds them any more, and their pages stay under Archives in the menu.
        // Content
        supabase.from('resources').select('id', { count: 'exact' }),
        supabase.from('resource_drafts').select('id', { count: 'exact' }).eq('status', 'submitted'),
        supabase.from('events').select('id', { count: 'exact' }),
        supabase.from('events').select('id', { count: 'exact' }).gte('date_time', now.toISOString()),
        supabase.from('event_registrations').select('id', { count: 'exact' }),
        supabase.from('event_registrations').select('id', { count: 'exact' }).eq('payment_status', 'pending_approval'),
        // Actions
        supabase.from('webinar_requests').select('id', { count: 'exact' }).eq('status', 'submitted'),
        supabase.from('marina_projects').select('id', { count: 'exact' }).eq('status', 'new'),
        // Leads pipeline
        supabase.from('partner_leads').select('id', { count: 'exact' }).eq('status', 'new'),
        supabase.from('partner_leads').select('id', { count: 'exact' }).eq('status', 'qualified'),
        supabase.from('partner_leads').select('id', { count: 'exact' }).eq('status', 'in_discussion'),
        supabase.from('partner_leads').select('id', { count: 'exact' }).eq('status', 'signed'),
        // B2B
        supabase.from('partner_requests').select('id', { count: 'exact' }).eq('status', 'pending'),
        supabase.from('rfps').select('id', { count: 'exact' }).eq('is_open', true),
        supabase.from('consultations').select('id', { count: 'exact' }).eq('is_open', true),
        // Aging queries (users waiting: form sent, not a draft, the same rule as /admin/review)
        supabase.from('profiles').select('user_id', { count: 'exact' }).eq('access_status', 'pending').neq('onboarding_status', 'draft').lte('created_at', fortyEightHoursAgo),
        supabase.from('partner_requests').select('id', { count: 'exact' }).eq('status', 'pending').lte('created_at', sevenDaysAgo),
        supabase.from('partner_leads').select('id', { count: 'exact' }).eq('status', 'new').lte('created_at', fortyEightHoursAgo),
        // Trends
        supabase.from('profiles').select('created_at').gte('created_at', sixMonthsAgo).order('created_at', { ascending: true }),
        supabase.from('payments').select('amount_cents, paid_at').eq('status', 'paid').gte('paid_at', sixMonthsAgo).order('paid_at', { ascending: true }),
        // Recent
        supabase.from('profiles').select('user_id, first_name, last_name, email, persona, access_status, created_at').order('created_at', { ascending: false }).limit(7),
        supabase.from('payments').select('id, amount_cents, payment_type, status, created_at, user_id').order('created_at', { ascending: false }).limit(7),
        // Upcoming events with registration counts
        supabase.from('events').select('id, title, date_time').gte('date_time', now.toISOString()).order('date_time', { ascending: true }).limit(8),
        // Inactive users (verified but not updated in 30+ days)
        supabase.from('profiles').select('user_id', { count: 'exact' }).eq('access_status', 'verified').lte('updated_at', thirtyDaysAgo),
        // Not activated (pending + onboarding still draft after 48h)
        supabase.from('profiles').select('user_id', { count: 'exact' }).eq('onboarding_status', 'draft').lte('created_at', fortyEightHoursAgo),
      ]);

      // Tier breakdown
      const tierBreakdown: Record<string, number> = {};
      (orgTiers || []).forEach((o: { tier: string }) => { tierBreakdown[o.tier] = (tierBreakdown[o.tier] || 0) + 1; });

      // Revenue
      const totalRevenueCents = (paidPayments || []).reduce((s: number, p: { amount_cents: number }) => s + p.amount_cents, 0);
      const revenueThisMonthCents = (monthPayments || []).reduce((s: number, p: { amount_cents: number }) => s + p.amount_cents, 0);

      // Monthly signup trend
      const signupsByMonth: Record<string, number> = {};
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        signupsByMonth[d.toLocaleDateString('en-US', { month: 'short' })] = 0;
      }
      (signupTrend || []).forEach((s: { created_at: string }) => {
        const key = new Date(s.created_at).toLocaleDateString('en-US', { month: 'short' });
        if (key in signupsByMonth) signupsByMonth[key]++;
      });
      setMonthlySignups(Object.entries(signupsByMonth).map(([month, count]) => ({ month, count })));

      // Monthly revenue trend
      const revenueByMonth: Record<string, number> = {};
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        revenueByMonth[d.toLocaleDateString('en-US', { month: 'short' })] = 0;
      }
      (revenueTrend || []).forEach((p: { amount_cents: number; paid_at: string }) => {
        if (!p.paid_at) return;
        const key = new Date(p.paid_at).toLocaleDateString('en-US', { month: 'short' });
        if (key in revenueByMonth) revenueByMonth[key] += p.amount_cents / 100;
      });
      setMonthlyRevenue(Object.entries(revenueByMonth).map(([month, revenue]) => ({ month, revenue })));

      // Event performance (registrations per upcoming event) — parallel fetch
      if (upcomingEventsData && upcomingEventsData.length > 0) {
        const evtIds = upcomingEventsData.map((e: { id: string }) => e.id);
        const [{ data: allRegs }, { data: allPricing }, { data: smLinked }] = await Promise.all([
          supabase.from('event_registrations').select('event_id').in('event_id', evtIds),
          supabase.from('event_pricing').select('event_id, max_included_seats').in('event_id', evtIds),
          supabase.from('sm_event').select('legacy_event_id').in('legacy_event_id', evtIds),
        ]);
        // SM26 on-site events use a separate registration system (sm_registration) and
        // have their own Smart 26 -> Event Health dashboard, so exclude them from this
        // fill-rate card where event_registrations would show a misleading ~0%.
        const smEventIds = new Set(((smLinked || []) as { legacy_event_id: string | null }[]).map(s => s.legacy_event_id).filter(Boolean) as string[]);
        const regCounts: Record<string, number> = {};
        (allRegs || []).forEach((r: { event_id: string }) => { regCounts[r.event_id] = (regCounts[r.event_id] || 0) + 1; });
        const capCounts: Record<string, number> = {};
        (allPricing || []).forEach((p: { event_id: string; max_included_seats: number }) => { capCounts[p.event_id] = (capCounts[p.event_id] || 0) + (p.max_included_seats || 0); });
        const evtPerfs: EventPerf[] = upcomingEventsData
          .filter((evt: { id: string }) => !smEventIds.has(evt.id))
          .map((evt: { id: string; title: string; date_time: string }) => {
            const regs = regCounts[evt.id] || 0;
            const capacity = capCounts[evt.id] || 50;
            return { id: evt.id, title: evt.title, date_time: evt.date_time, registrations: regs, capacity, fillRate: capacity > 0 ? Math.round((regs / capacity) * 100) : 0 };
          });
        setEventPerf(evtPerfs);
      }

      setInactiveUsers(inactiveCount || 0);
      setNotActivatedUsers(notActivatedCount || 0);

      setStats({
        totalUsers: totalUsers || 0, verifiedUsers: verifiedUsers || 0,
        pendingUsers: pendingUsers || 0,
        rejectedUsers: rejectedUsers || 0, suspendedUsers: suspendedUsers || 0,
        marinaCount: marinaCount || 0, partnerCount: partnerCount || 0,
        mediaCount: mediaCount || 0, individualCount: individualCount || 0,
        signupsThisMonth: signupsThisMonth || 0, signupsLastMonth: signupsLastMonth || 0,
        signupsThisWeek: signupsThisWeek || 0, signupsLastWeek: signupsLastWeek || 0,
        totalOrgs: (orgTiers || []).length, tierBreakdown,
        totalRevenueCents, revenueThisMonthCents, pendingPayments: pendingPaymentCount || 0,
        totalResources: totalResources || 0, pendingResourceDrafts: pendingResourceDrafts || 0,
        totalEvents: totalEvents || 0, upcomingEvents: upcomingEvents || 0,
        totalRegistrations: totalRegistrations || 0, pendingRegistrations: pendingRegistrations || 0,
        newWebinars: newWebinars || 0, newProjects: newProjects || 0,
        newLeads: newLeads || 0, qualifiedLeads: qualifiedLeads || 0,
        inDiscussionLeads: inDiscussionLeads || 0, signedLeads: signedLeads || 0,
        pendingB2B: pendingB2B || 0, openRFPs: openRFPs || 0,
        openConsultations: openConsultations || 0,
        usersWaiting48h: usersWaiting48h || 0, oldB2BRequests: oldB2BRequests || 0,
        oldLeadsNotContacted: oldLeadsNotContacted || 0,
      });
      setRecentUsers((recent || []) as RecentUser[]);
      setRecentPayments((recentPay || []) as RecentPayment[]);
    } catch (error) {
      if (import.meta.env.DEV) console.error('Dashboard load error:', error);
    }
    setLoading(false);
  };

  /* ─── HELPERS ─── */

  const fmt = (cents: number) => `€${(cents / 100).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const pctChange = (current: number, previous: number) => {
    if (!previous) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 100);
  };

  const growthMonthly = pctChange(stats.signupsThisMonth, stats.signupsLastMonth);
  const growthWeekly = pctChange(stats.signupsThisWeek, stats.signupsLastWeek);
  const activePct = stats.totalUsers > 0 ? Math.round((stats.verifiedUsers / stats.totalUsers) * 100) : 0;

  const personaBadge = (persona: string) => {
    const s: Record<string, string> = {
      admin: 'bg-red-50 text-red-800', moderator: 'bg-red-50 text-red-800',
      partner: 'bg-foam text-teal-text', marina: 'bg-chip text-navy',
      media_partner: 'bg-chip text-meta', individual: 'bg-amber-50 text-amber-900',
    };
    const l: Record<string, string> = {
      admin: 'Admin', moderator: 'Mod', partner: 'Provider', marina: 'Marina',
      media_partner: 'Media', individual: 'Individual',
    };
    return <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${s[persona] || 'bg-chip text-meta'}`}>{l[persona] || persona}</span>;
  };

  const statusDot = (status: string) => {
    const c: Record<string, string> = { verified: 'bg-green-500', pending: 'bg-yellow-500', rejected: 'bg-red-500', suspended: 'bg-gray-500' };
    return <span className={`inline-block h-2 w-2 rounded-full ${c[status] || 'bg-gray-400'}`} title={status} />;
  };

  /* ─── INSIGHTS ENGINE ─── */

  const insights = useMemo<InsightItem[]>(() => {
    const items: InsightItem[] = [];
    if (stats.usersWaiting48h > 0)
      items.push({ icon: AlertTriangle, text: `${stats.usersWaiting48h} user${stats.usersWaiting48h > 1 ? 's' : ''} waiting >48h for approval`, type: 'danger' });
    if (stats.oldLeadsNotContacted > 0)
      items.push({ icon: Target, text: `${stats.oldLeadsNotContacted} lead${stats.oldLeadsNotContacted > 1 ? 's' : ''} not contacted after 48h`, type: 'danger' });
    if (stats.oldB2BRequests > 0)
      items.push({ icon: Link2, text: `${stats.oldB2BRequests} B2B request${stats.oldB2BRequests > 1 ? 's' : ''} unanswered for 7+ days`, type: 'danger' });
    if (growthMonthly > 20)
      items.push({ icon: TrendingUp, text: `+${growthMonthly}% user growth this month — momentum is strong`, type: 'success' });
    if (growthMonthly < -10)
      items.push({ icon: TrendingDown, text: `${growthMonthly}% signup decline this month — review acquisition`, type: 'warning' });
    if (activePct < 50 && stats.totalUsers > 5)
      items.push({ icon: Activity, text: `Only ${activePct}% of users are active — engagement needs work`, type: 'warning' });
    if (inactiveUsers > 3)
      items.push({ icon: UserX, text: `${inactiveUsers} verified users inactive for 30+ days`, type: 'warning' });
    if (notActivatedUsers > 0)
      items.push({ icon: Zap, text: `${notActivatedUsers} user${notActivatedUsers > 1 ? 's' : ''} signed up but never completed onboarding`, type: 'info' });
    const atRiskEvents = eventPerf.filter(e => e.fillRate < 25 && e.fillRate >= 0);
    if (atRiskEvents.length > 0)
      items.push({ icon: Calendar, text: `${atRiskEvents.length} upcoming event${atRiskEvents.length > 1 ? 's' : ''} with <25% capacity filled`, type: 'warning' });
    if (stats.signedLeads > 0)
      items.push({ icon: CheckCircle, text: `${stats.signedLeads} lead${stats.signedLeads > 1 ? 's' : ''} converted to signed partner${stats.signedLeads > 1 ? 's' : ''}`, type: 'success' });
    const marinaRatio = stats.totalUsers > 0 ? stats.marinaCount / stats.totalUsers : 0;
    if (marinaRatio < 0.15 && stats.totalUsers > 10)
      items.push({ icon: Ship, text: `Marina representation is only ${Math.round(marinaRatio * 100)}% — consider targeted acquisition`, type: 'info' });
    return items.slice(0, 6);
  }, [stats, eventPerf, inactiveUsers, notActivatedUsers, growthMonthly, activePct]);

  /* ─── CHART DATA ─── */

  const personaPieData = [
    { name: 'Marinas', value: stats.marinaCount, color: PERSONA_COLORS.marina },
    { name: 'Service providers', value: stats.partnerCount, color: PERSONA_COLORS.partner },
    { name: 'Media', value: stats.mediaCount, color: PERSONA_COLORS.media_partner },
    { name: 'Individuals', value: stats.individualCount, color: PERSONA_COLORS.individual },
  ].filter(d => d.value > 0);

  const statusPieData = [
    { name: 'Verified', value: stats.verifiedUsers, color: STATUS_COLORS.verified },
    { name: 'Pending', value: stats.pendingUsers, color: STATUS_COLORS.pending },
    { name: 'Rejected', value: stats.rejectedUsers, color: STATUS_COLORS.rejected },
    { name: 'Suspended', value: stats.suspendedUsers, color: STATUS_COLORS.suspended },
  ].filter(d => d.value > 0);

  const tierOrder: OrgTier[] = ['member', 'innovation_partner', 'associate_partner', 'premium_partner', 'premium_sponsor', 'main_sponsor'];
  const tierBarData = tierOrder.map(t => ({
    name: TIER_LABELS[t], count: stats.tierBreakdown[t] || 0, fill: TIER_CHART_COLORS[t],
  })).filter(d => d.count > 0);

  const leadsPipelineData = [
    { stage: 'New', count: stats.newLeads, fill: LEAD_STATUS_COLORS.new },
    { stage: 'Qualified', count: stats.qualifiedLeads, fill: LEAD_STATUS_COLORS.qualified },
    { stage: 'Discussion', count: stats.inDiscussionLeads, fill: LEAD_STATUS_COLORS.in_discussion },
    { stage: 'Signed', count: stats.signedLeads, fill: LEAD_STATUS_COLORS.signed },
  ];
  const totalPipeline = stats.newLeads + stats.qualifiedLeads + stats.inDiscussionLeads + stats.signedLeads;
  const pipelineConversion = totalPipeline > 0 ? Math.round((stats.signedLeads / totalPipeline) * 100) : 0;

  /* ─── TOOLTIPS ─── */

  const ChartTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-white/95 backdrop-blur-sm border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs">
        <p className="font-semibold text-gray-700 mb-1">{label}</p>
        {payload.map((e: any, i: number) => (
          <p key={i} style={{ color: e.color || e.fill }} className="font-medium">
            {e.name}: {e.value}
          </p>
        ))}
      </div>
    );
  };
  const PieTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0];
    return (
      <div className="bg-white/95 backdrop-blur-sm border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs">
        <p className="font-semibold" style={{ color: d.payload?.color }}>{d.name}: {d.value}</p>
      </div>
    );
  };

  /* ─── LOADING ─── */

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <RefreshCw className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
        <p className="text-sm text-gray-500">Loading dashboard...</p>
      </div>
    </div>
  );

  // People waiting are counted once: by the review card when its figure is known, else here.
  const usersInStrip = reviewCount === null ? stats.usersWaiting48h : 0;
  const totalUrgent = usersInStrip + stats.oldLeadsNotContacted + stats.oldB2BRequests
    + stats.pendingRegistrations;

  /* ══════════════════════════════ MODERATOR DASHBOARD ══════════════════════════════ */

  if (!isAdmin) {
    const attention = [
      stats.pendingResourceDrafts > 0 && {
        key: 'drafts', icon: FolderOpen, tone: 'warning' as const,
        title: `${stats.pendingResourceDrafts} resource draft${stats.pendingResourceDrafts !== 1 ? 's' : ''} waiting for review`,
        hint: 'Review and approve or provide feedback',
        onClick: () => nav('/admin/resources?tab=drafts'),
      },
      stats.newWebinars > 0 && {
        key: 'webinars', icon: MessageSquare, tone: 'info' as const,
        title: `${stats.newWebinars} webinar proposal${stats.newWebinars !== 1 ? 's' : ''} to review`,
        hint: 'Pre-approve proposals matching your sectors',
        onClick: () => nav('/admin/webinars', { status: 'submitted' }),
      },
    ].filter(Boolean) as { key: string; icon: React.ElementType; tone: 'warning' | 'info'; title: string; hint: string; onClick: () => void }[];

    return (
      <div className="space-y-8">
        {/* ─── Header ─── */}
        <AdminPageHeader
          className="mb-0"
          title="Moderator Dashboard"
          description={t('adminUi.pages.moderatorDashboard')}
          meta={<span>Welcome back, {profile?.first_name || 'Moderator'} — {new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>}
          actions={
            <Button variant="outline" size="sm" className={ADMIN_BTN} onClick={loadDashboard}>
              <RefreshCw className="h-4 w-4 mr-2" />Refresh
            </Button>
          }
        />

        <ReviewQueueCard count={reviewCount} isAdmin={false} />

        {/* ─── Your Activity Overview ─── */}
        <div>
          <AdminSectionLabel icon={BarChart3}>Your Activity</AdminSectionLabel>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <AdminKpiCard icon={FileText} label="Published Resources" value={stats.totalResources} onClick={() => nav('/admin/resources')} />
            <AdminKpiCard
              icon={FolderOpen}
              label="Resource Drafts to Review"
              value={stats.pendingResourceDrafts}
              tone={stats.pendingResourceDrafts > 0 ? 'attention' : 'default'}
              badge={stats.pendingResourceDrafts > 0 ? <AdminStatusPill tone="warning">{stats.pendingResourceDrafts} pending</AdminStatusPill> : undefined}
              onClick={() => nav('/admin/resources?tab=drafts')}
            />
            <AdminKpiCard
              icon={MessageSquare}
              label="Webinar Proposals"
              value={stats.newWebinars}
              tone={stats.newWebinars > 0 ? 'attention' : 'default'}
              badge={stats.newWebinars > 0 ? <AdminStatusPill tone="warning">{stats.newWebinars} new</AdminStatusPill> : undefined}
              onClick={() => nav('/admin/webinars')}
            />
            <AdminKpiCard
              icon={Calendar}
              label="Total Events"
              value={stats.totalEvents}
              badge={stats.upcomingEvents > 0 ? <AdminStatusPill tone="info">{stats.upcomingEvents} upcoming</AdminStatusPill> : undefined}
            />
          </div>
        </div>

        {/* ─── Action Items ─── */}
        {attention.length > 0 && (
          <div>
            <AdminSectionLabel icon={AlertCircle}>Items Needing Your Attention</AdminSectionLabel>
            <div className="space-y-2">
              {attention.map(a => (
                <button
                  key={a.key}
                  type="button"
                  onClick={a.onClick}
                  className={`group flex w-full items-center gap-3 rounded-card border px-4 py-3 text-left transition-colors focus:outline-none focus-visible:shadow-focus ${
                    a.tone === 'warning' ? 'border-amber-200 bg-amber-50 hover:border-amber-300' : 'border-teal/25 bg-foam hover:border-teal/50'
                  }`}
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-navy">
                    <a.icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold text-navy">{a.title}</span>
                    <span className="block text-[13px] text-meta">{a.hint}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 text-meta transition-colors group-hover:text-navy" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ─── Quick Actions ─── */}
        <div>
          <AdminSectionLabel>Quick Actions</AdminSectionLabel>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className={ADMIN_BTN} onClick={() => nav('/admin/resources')}>
              <FileText className="h-4 w-4 mr-2" />Propose Resource
            </Button>
            <Button variant="outline" size="sm" className={ADMIN_BTN} onClick={() => nav('/admin/resources?tab=drafts')}>
              <FolderOpen className="h-4 w-4 mr-2" />Review Drafts
            </Button>
            <Button variant="outline" size="sm" className={ADMIN_BTN} onClick={() => nav('/admin/webinars')}>
              <MessageSquare className="h-4 w-4 mr-2" />Webinar Proposals
            </Button>
          </div>
        </div>
      </div>
    );
  }

  /* ══════════════════════════════ ADMIN RENDER ══════════════════════════════ */

  const priorityItems = [
    { key: 'users', icon: UserCheck, count: usersInStrip, label: 'users waiting >48h', onClick: () => nav('/admin/users', { status: 'pending' }) },
    { key: 'leads', icon: Target, count: stats.oldLeadsNotContacted, label: 'leads not contacted', onClick: () => nav('/admin/leads', { status: 'new' }) },
    { key: 'b2b', icon: Link2, count: stats.oldB2BRequests, label: 'B2B unanswered 7d+', onClick: () => nav('/admin/partner-requests') },
    { key: 'events', icon: Calendar, count: stats.pendingRegistrations, label: 'event approvals', onClick: () => nav('/admin/events') },
  ].filter(i => i.count > 0);

  const growthPill = (pct: number, withArrow: boolean) => (
    <AdminStatusPill tone={pct >= 0 ? 'success' : 'danger'} icon={withArrow ? (pct >= 0 ? ArrowUpRight : ArrowDownRight) : undefined}>
      {pct >= 0 ? '+' : ''}{pct}%
    </AdminStatusPill>
  );

  return (
    <div className="space-y-8">

      {/* ═══ TOP: PRIORITY STRIP ═══ */}
      {totalUrgent > 0 && (
        <section aria-labelledby="admin-priority" className="rounded-card border border-amber-200 bg-amber-50 p-4">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-700" aria-hidden="true" />
            <h2 id="admin-priority" className="text-[15px] font-semibold leading-5 text-navy">Priority Actions Required</h2>
            <AdminStatusPill tone="danger" className="ml-auto">{totalUrgent} urgent</AdminStatusPill>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {priorityItems.map(item => (
              <button
                key={item.key}
                type="button"
                onClick={item.onClick}
                className="group flex items-center gap-3 rounded-xl border border-amber-200 bg-white px-3 py-2.5 text-left transition-colors hover:border-navy/30 focus:outline-none focus-visible:shadow-focus"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gold/25 text-navy">
                  <item.icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[20px] font-semibold leading-6 tabular-nums text-navy">{item.count}</span>
                  <span className="block text-[12px] leading-4 text-meta">{item.label}</span>
                </span>
                <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-meta transition-colors group-hover:text-navy" aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ═══ HEADER ═══ */}
      <AdminPageHeader
        className="mb-0"
        title={t('admin.dashboard')}
        description={t('adminUi.pages.dashboard')}
        meta={<span>{new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>}
        actions={
          <Button variant="outline" size="sm" className={ADMIN_BTN} onClick={loadDashboard}>
            <RefreshCw className="h-4 w-4 mr-2" />Refresh
          </Button>
        }
      />

      {/* ═══ EVERYTHING WAITING FOR M3 (/admin/review) ═══ */}
      <ReviewQueueCard count={reviewCount} isAdmin />

      {/* ═══ ROW 1: PERFORMANCE KPIs ═══ */}
      <div>
        <AdminSectionLabel icon={BarChart3}>Performance Snapshot</AdminSectionLabel>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <AdminKpiCard
            icon={DollarSign}
            label="Total Revenue"
            value={fmt(stats.totalRevenueCents)}
            badge={stats.revenueThisMonthCents > 0 ? <AdminStatusPill tone="success">+{fmt(stats.revenueThisMonthCents)} /mo</AdminStatusPill> : undefined}
            onClick={() => document.getElementById('revenue-chart')?.scrollIntoView({ behavior: 'smooth' })}
          />
          <AdminKpiCard
            icon={Users}
            label="Total Users"
            value={stats.totalUsers}
            badge={<AdminStatusPill tone="success">{activePct}% active</AdminStatusPill>}
            onClick={() => nav('/admin/users')}
          />
          <AdminKpiCard
            icon={TrendingUp}
            label="New This Week"
            value={stats.signupsThisWeek}
            badge={growthPill(growthWeekly, true)}
            onClick={() => document.getElementById('signup-chart')?.scrollIntoView({ behavior: 'smooth' })}
          />
          <AdminKpiCard
            icon={Activity}
            label="New This Month"
            value={stats.signupsThisMonth}
            badge={growthPill(growthMonthly, false)}
            onClick={() => document.getElementById('signup-chart')?.scrollIntoView({ behavior: 'smooth' })}
          />
          <AdminKpiCard
            icon={Building2}
            label="Organizations"
            value={stats.totalOrgs}
            onClick={() => nav('/admin/sponsorships')}
          />
          <AdminKpiCard
            icon={Link2}
            label="Active B2B"
            value={stats.pendingB2B + stats.openRFPs + stats.openConsultations}
            onClick={() => nav('/admin/partner-requests')}
          />
        </div>
      </div>

      {/* ═══ ROW 2: BUSINESS OPPORTUNITIES PIPELINE ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Leads Funnel */}
        <Card className="lg:col-span-3 border-0 shadow-sm cursor-pointer"
              onClick={() => nav('/admin/leads', { status: 'new' })}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
                <Target className="h-4 w-4 text-amber-700" />
                Opportunities Pipeline
              </CardTitle>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">Conversion: <span className="font-bold text-gray-700">{pipelineConversion}%</span></span>
                <ChevronRight className="h-4 w-4 text-gray-300" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {totalPipeline === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No leads yet</p>
            ) : (
              <div className="space-y-4">
                {/* Funnel visualization */}
                <div className="h-[140px]" style={{ minWidth: 1 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={leadsPipelineData} margin={{ left: -20, right: 8, top: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="stage" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="count" name="Leads" radius={[6, 6, 0, 0]} barSize={40}>
                        {leadsPipelineData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {/* Pipeline summary strip */}
                <div className="flex items-center gap-1">
                  {leadsPipelineData.map((stage, i) => {
                    const width = totalPipeline > 0 ? Math.max((stage.count / totalPipeline) * 100, 5) : 25;
                    return (
                      <div key={i} className="relative group/bar" style={{ width: `${width}%` }}>
                        <div className="h-3 rounded-full transition-all" style={{ backgroundColor: stage.fill }} />
                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-[9px] px-1.5 py-0.5 rounded opacity-0 group-hover/bar:opacity-100 transition-opacity whitespace-nowrap">
                          {stage.stage}: {stage.count}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Unified Opportunities Summary */}
        <Card className="lg:col-span-2 border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-500" />
              Business Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2.5">
            {[
              { label: 'Partner Leads', total: stats.newLeads + stats.qualifiedLeads + stats.inDiscussionLeads,
                badge: `${stats.newLeads} new`, color: 'text-amber-600', bg: 'bg-amber-50', icon: Target,
                link: '/admin/leads', params: {} },
              { label: 'B2B Requests', total: stats.pendingB2B, badge: stats.oldB2BRequests > 0 ? `${stats.oldB2BRequests} urgent` : '',
                color: 'text-amber-700', bg: 'bg-amber-50', icon: Link2, link: '/admin/partner-requests', params: { status: 'pending' } },
              { label: 'Open RFPs', total: stats.openRFPs, badge: '', color: 'text-teal', bg: 'bg-chip',
                icon: FileText, link: '/admin/rfps', params: {} },
              { label: 'Consultations', total: stats.openConsultations, badge: '', color: 'text-teal', bg: 'bg-chip',
                icon: MessageSquare, link: '/admin/consultations', params: {} },
            ].map((item, i) => (
              <button key={i} onClick={() => nav(item.link, item.params)}
                className="flex items-center gap-3 w-full rounded-xl px-3 py-2.5 hover:bg-gray-50 transition-all group text-left">
                <div className={`h-8 w-8 rounded-lg ${item.bg} flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform`}>
                  <item.icon className={`h-4 w-4 ${item.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-gray-700 font-medium">{item.label}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {item.badge && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                      item.badge.includes('urgent') ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                    }`}>{item.badge}</span>
                  )}
                  <span className="text-lg font-bold text-gray-900">{item.total}</span>
                  <ChevronRight className="h-3.5 w-3.5 text-gray-300 group-hover:text-gray-500" />
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* ═══ ROW 3: USER INTELLIGENCE ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Persona Donut */}
        <Card className="border-0 shadow-sm cursor-pointer" onClick={() => nav('/admin/users')}>
          <CardHeader className="pb-1">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
                <Ship className="h-4 w-4 text-teal" />
                Ecosystem Breakdown
              </CardTitle>
              <ChevronRight className="h-4 w-4 text-gray-300" />
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {personaPieData.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No users yet</p>
            ) : (
              <div className="flex items-center gap-3">
                <div className="w-[130px] h-[130px] shrink-0" style={{ minWidth: 1 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={personaPieData} cx="50%" cy="50%" innerRadius={35} outerRadius={60}
                           paddingAngle={3} dataKey="value" strokeWidth={0}>
                        {personaPieData.map((e, i) => <Cell key={i} fill={e.color} />)}
                      </Pie>
                      <Tooltip content={<PieTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 space-y-1.5">
                  {personaPieData.map((d) => {
                    const pct = stats.totalUsers > 0 ? Math.round((d.value / stats.totalUsers) * 100) : 0;
                    return (
                      <div key={d.name} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                          <span className="text-xs text-gray-600">{d.name}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-gray-900">{d.value}</span>
                          <span className="text-[10px] text-gray-400">({pct}%)</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Status Donut */}
        <Card className="border-0 shadow-sm cursor-pointer" onClick={() => nav('/admin/users')}>
          <CardHeader className="pb-1">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
                <Activity className="h-4 w-4 text-green-500" />
                User Status
              </CardTitle>
              <ChevronRight className="h-4 w-4 text-gray-300" />
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {statusPieData.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No users yet</p>
            ) : (
              <div className="flex items-center gap-3">
                <div className="w-[130px] h-[130px] shrink-0" style={{ minWidth: 1 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={statusPieData} cx="50%" cy="50%" innerRadius={35} outerRadius={60}
                           paddingAngle={3} dataKey="value" strokeWidth={0}>
                        {statusPieData.map((e, i) => <Cell key={i} fill={e.color} />)}
                      </Pie>
                      <Tooltip content={<PieTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 space-y-1.5">
                  {statusPieData.map((d) => (
                    <div key={d.name} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                        <span className="text-xs text-gray-600">{d.name}</span>
                      </div>
                      <span className="text-xs font-bold text-gray-900">{d.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* User Engagement Segments */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
              <Star className="h-4 w-4 text-amber-500" />
              User Engagement
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {[
              { icon: CheckCircle, label: 'Active Users', value: stats.verifiedUsers, sub: `${activePct}% of total`,
                color: 'text-green-600', bg: 'bg-green-50', link: '/admin/users', params: { status: 'verified' } },
              { icon: Flame, label: 'New This Week', value: stats.signupsThisWeek, sub: `vs ${stats.signupsLastWeek} last week`,
                color: 'text-amber-700', bg: 'bg-amber-50', link: '/admin/users', params: {} },
              { icon: UserX, label: 'Inactive (30d+)', value: inactiveUsers, sub: 'verified but dormant',
                color: 'text-gray-500', bg: 'bg-gray-50', link: '/admin/users', params: { status: 'verified', activity: 'inactive' } },
              { icon: Zap, label: 'Not Activated', value: notActivatedUsers, sub: 'no onboarding completed',
                color: 'text-amber-600', bg: 'bg-amber-50', link: '/admin/users', params: { onboarding: 'draft' } },
            ].map((seg, i) => (
              <button key={i} onClick={() => nav(seg.link, seg.params)}
                className="flex items-center gap-3 w-full rounded-xl px-2.5 py-2 hover:bg-gray-50 transition-all group text-left">
                <div className={`h-8 w-8 rounded-lg ${seg.bg} flex items-center justify-center shrink-0`}>
                  <seg.icon className={`h-4 w-4 ${seg.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-gray-700">{seg.label}</div>
                  <div className="text-[10px] text-gray-400">{seg.sub}</div>
                </div>
                <span className="text-lg font-bold text-gray-900">{seg.value}</span>
              </button>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* ═══ ROW 4: TREND CHARTS ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Signup Trend */}
        <Card id="signup-chart" className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-teal" />
              Signup Trend (6 months)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-[180px]" style={{ minWidth: 1 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthlySignups} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="signupGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="count" name="Signups" stroke="#6366f1" strokeWidth={2.5}
                        fill="url(#signupGrad)" dot={{ r: 4, fill: '#6366f1', stroke: '#fff', strokeWidth: 2 }}
                        activeDot={{ r: 6, stroke: '#6366f1', strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Revenue Trend */}
        <Card id="revenue-chart" className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-emerald-500" />
              Revenue Trend (6 months)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-[180px]" style={{ minWidth: 1 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthlyRevenue} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false}
                         tickFormatter={(v) => `€${v}`} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#10b981" strokeWidth={2.5}
                        fill="url(#revGrad)" dot={{ r: 4, fill: '#10b981', stroke: '#fff', strokeWidth: 2 }}
                        activeDot={{ r: 6, stroke: '#10b981', strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ═══ ROW 5: EVENTS PERFORMANCE ═══ */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-teal" />
              Events Performance
            </CardTitle>
            <Button variant="ghost" size="sm" className="text-xs text-primary h-7 hover:bg-primary/5 rounded-lg"
                    onClick={() => nav('/admin/events')}>
              All Events <ChevronRight className="h-3 w-3 ml-0.5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {eventPerf.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No upcoming events</p>
          ) : (
            <div className="space-y-2.5">
              {/* Summary bar */}
              <div className="flex items-center gap-4 text-xs text-gray-500 mb-1">
                <span>{stats.totalEvents} total events</span>
                <span className="text-teal font-medium">{stats.upcomingEvents} upcoming</span>
                <span>{stats.totalRegistrations} total registrations</span>
              </div>
              {eventPerf.map((evt) => {
                const isAtRisk = evt.fillRate < 25;
                const isGood = evt.fillRate >= 60;
                return (
                  <button key={evt.id} onClick={() => nav('/admin/events')}
                    className="flex items-center gap-3 w-full rounded-xl px-3 py-2.5 hover:bg-gray-50 transition-all group text-left">
                    <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${
                      isAtRisk ? 'bg-red-50' : isGood ? 'bg-green-50' : 'bg-amber-50'
                    }`}>
                      <Calendar className={`h-4 w-4 ${
                        isAtRisk ? 'text-red-500' : isGood ? 'text-green-500' : 'text-amber-500'
                      }`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-800 truncate">{evt.title}</div>
                      <div className="text-[10px] text-gray-400">
                        {new Date(evt.date_time).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {/* Fill rate bar */}
                      <div className="w-24 hidden sm:block">
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${
                            isAtRisk ? 'bg-red-400' : isGood ? 'bg-green-400' : 'bg-amber-400'
                          }`} style={{ width: `${Math.min(evt.fillRate, 100)}%` }} />
                        </div>
                      </div>
                      <span className={`text-sm font-bold min-w-[3rem] text-right ${
                        isAtRisk ? 'text-red-600' : isGood ? 'text-green-600' : 'text-amber-600'
                      }`}>{evt.fillRate}%</span>
                      <span className="text-[10px] text-gray-400 min-w-[4rem] text-right">
                        {evt.registrations}/{evt.capacity}
                      </span>
                      {isAtRisk && <AlertTriangle className="h-3.5 w-3.5 text-red-400" />}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══ ROW 6: TIER DISTRIBUTION + INSIGHTS ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Tier Distribution */}
        <Card className="border-0 shadow-sm cursor-pointer" onClick={() => nav('/admin/sponsorships')}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-teal" />
                Tier Distribution
              </CardTitle>
              <ChevronRight className="h-4 w-4 text-gray-300" />
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {tierBarData.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No organizations yet</p>
            ) : (
              <div className="h-[160px]" style={{ minWidth: 1 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={tierBarData} layout="vertical" margin={{ left: 10, right: 16, top: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                    <XAxis type="number" hide />
                    <YAxis dataKey="name" type="category" width={110} tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="count" name="Organizations" radius={[0, 6, 6, 0]} barSize={18}>
                      {tierBarData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* AI Insights Widget */}
        <Card className="border-0 shadow-sm bg-gradient-to-br from-slate-50 to-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              Insights & Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {insights.length === 0 ? (
              <div className="text-center py-8">
                <CheckCircle className="h-8 w-8 text-green-400 mx-auto mb-2" />
                <p className="text-sm text-gray-500">All clear — no issues detected</p>
              </div>
            ) : (
              <div className="space-y-2">
                {insights.map((insight, i) => {
                  const colors = {
                    danger: 'bg-red-50 border-red-200 text-red-800',
                    warning: 'bg-amber-50 border-amber-200 text-amber-800',
                    success: 'bg-green-50 border-green-200 text-green-800',
                    info: 'bg-chip border-blue-200 text-navy',
                  };
                  const iconColors = {
                    danger: 'text-red-500', warning: 'text-amber-500',
                    success: 'text-green-500', info: 'text-teal',
                  };
                  return (
                    <div key={i} className={`flex items-start gap-2.5 rounded-xl px-3 py-2.5 border text-xs ${colors[insight.type]}`}>
                      <insight.icon className={`h-4 w-4 shrink-0 mt-0.5 ${iconColors[insight.type]}`} />
                      <span className="font-medium leading-relaxed">{insight.text}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ═══ ROW 7: ACTION ITEMS GRID ═══ */}
      <div>
        <AdminSectionLabel icon={AlertCircle}>All Action Items</AdminSectionLabel>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {[
            { label: 'Pending accounts, unfinished included', value: stats.pendingUsers, icon: UserCheck, link: '/admin/users', params: { status: 'pending' } },
            { label: 'Event Approvals', value: stats.pendingRegistrations, icon: Calendar, link: '/admin/events', params: {} },
            { label: 'Webinar Reqs', value: stats.newWebinars, icon: MessageSquare, link: '/admin/webinars', params: { status: 'submitted' } },
            { label: 'Resource Drafts', value: stats.pendingResourceDrafts, icon: FolderOpen, link: '/admin/resources', params: { tab: 'drafts' } },
            { label: 'New Projects', value: stats.newProjects, icon: Anchor, link: '/admin/projects', params: { status: 'new' } },
            { label: 'B2B Requests', value: stats.pendingB2B, icon: Link2, link: '/admin/partner-requests', params: { status: 'pending' } },
            { label: 'New Leads', value: stats.newLeads, icon: Target, link: '/admin/leads', params: { status: 'new' } },
          ].map((item, i) => (
            <AdminKpiCard
              key={i}
              icon={item.icon}
              label={item.label}
              value={item.value}
              tone={item.value > 0 ? 'attention' : 'default'}
              onClick={() => nav(item.link, item.params)}
            />
          ))}
        </div>
      </div>

      {/* ═══ ROW 8: RECENT ACTIVITY ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent Signups */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
                <Users className="h-4 w-4 text-teal" /> Recent Signups
              </CardTitle>
              <Button variant="ghost" size="sm" className="text-xs text-primary h-7 hover:bg-primary/5 rounded-lg"
                      onClick={() => nav('/admin/users')}>
                View all <ChevronRight className="h-3 w-3 ml-0.5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="divide-y divide-gray-50">
              {recentUsers.map((u) => (
                <div key={u.user_id} onClick={() => nav('/admin/users')}
                     className="flex items-center justify-between py-2.5 hover:bg-gray-50/80 -mx-2 px-2 rounded-xl transition-all cursor-pointer group">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-xs font-bold text-gray-600 shrink-0">
                      {(u.first_name?.[0] || u.email?.[0] || '?').toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {u.first_name || u.last_name ? `${u.first_name || ''} ${u.last_name || ''}`.trim() : u.email?.split('@')[0] || '\u2014'}
                      </div>
                      <div className="text-[10px] text-gray-400 truncate">{u.email || '\u2014'}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {personaBadge(u.persona)}
                    {statusDot(u.access_status)}
                    <span className="text-[10px] text-gray-300 hidden sm:inline">
                      {new Date(u.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                    </span>
                  </div>
                </div>
              ))}
              {recentUsers.length === 0 && <p className="py-4 text-center text-sm text-gray-400">No users yet</p>}
            </div>
          </CardContent>
        </Card>

        {/* Recent Payments */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-emerald-500" /> Recent Payments
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="divide-y divide-gray-50">
              {recentPayments.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className={`h-8 w-8 rounded-xl flex items-center justify-center shrink-0 ${
                      p.status === 'paid' ? 'bg-green-50' : p.status === 'failed' ? 'bg-red-50' : 'bg-yellow-50'
                    }`}>
                      {p.status === 'paid' ? <CheckCircle className="h-4 w-4 text-green-600" /> :
                       p.status === 'failed' ? <XCircle className="h-4 w-4 text-red-500" /> :
                       <Clock className="h-4 w-4 text-yellow-600" />}
                    </div>
                    <div>
                      <div className="text-sm font-bold text-gray-900">{fmt(p.amount_cents)}</div>
                      <div className="text-[10px] text-gray-400 capitalize">{p.payment_type.replace(/_/g, ' ')}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      p.status === 'paid' ? 'bg-green-100 text-green-700' :
                      p.status === 'failed' ? 'bg-red-100 text-red-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>{p.status}</span>
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      {new Date(p.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}
                    </div>
                  </div>
                </div>
              ))}
              {recentPayments.length === 0 && <p className="py-4 text-center text-sm text-gray-400">No payments yet</p>}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ═══ QUICK ACTIONS ═══ */}
      <div>
        <AdminSectionLabel>Quick Actions</AdminSectionLabel>
        <div className="flex flex-wrap gap-2">
          {[
            { label: 'Manage Users', icon: Users, link: '/admin/users' },
            { label: 'Add Resource', icon: FileText, link: '/admin/resources/new' },
            { label: 'Add Event', icon: Calendar, link: '/admin/events/new' },
            { label: 'Review Drafts', icon: FolderOpen, link: '/admin/resources?tab=drafts' },
          ].map((a, i) => (
            <Button key={i} variant="outline" size="sm" className={ADMIN_BTN} onClick={() => nav(a.link)}>
              <a.icon className="h-4 w-4 mr-2" />{a.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
