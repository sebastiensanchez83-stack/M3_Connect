import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
// Filtered navigation helper: builds URL with search params
import {
  Users, UserCheck, FileText, Calendar, Anchor, RefreshCw, Building2,
  Link2, MessageSquare, ChevronRight, FolderOpen,
  CreditCard, TrendingUp, AlertCircle, DollarSign, Ship, Newspaper,
  ArrowUpRight, ArrowDownRight, Clock, CheckCircle, XCircle, Eye,
  BarChart3, Activity, Zap, AlertTriangle, Target, Flame,
  UserX, Star, Lightbulb, TrendingDown, ArrowRight,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
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
  pendingSponsorships: number;
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
  pendingExpositions: number;
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
  marina: '#3b82f6', partner: '#10b981', media_partner: '#8b5cf6',
  individual: '#f59e0b', admin: '#ef4444', moderator: '#ef4444',
};
const STATUS_COLORS: Record<string, string> = {
  verified: '#22c55e', pending: '#eab308',
  rejected: '#ef4444', suspended: '#6b7280',
};
const TIER_CHART_COLORS: Record<string, string> = {
  member: '#9ca3af', innovation_partner: '#3b82f6', associate_partner: '#f59e0b',
  premium_partner: '#f97316', premium_sponsor: '#a855f7', main_sponsor: '#7c3aed',
};
const LEAD_STATUS_COLORS: Record<string, string> = {
  new: '#eab308', qualified: '#3b82f6', in_discussion: '#f97316',
  signed: '#22c55e', rejected: '#ef4444',
};

/* ══════════════════════════════ COMPONENT ══════════════════════════════ */

export function AdminDashboard() {
  const { t } = useTranslation();
  const { user, isAdmin, profile } = useAuth();
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
    totalRevenueCents: 0, revenueThisMonthCents: 0, pendingPayments: 0, pendingSponsorships: 0,
    totalResources: 0, pendingResourceDrafts: 0,
    totalEvents: 0, upcomingEvents: 0, totalRegistrations: 0, pendingRegistrations: 0,
    newWebinars: 0, newProjects: 0, newLeads: 0,
    pendingB2B: 0, openRFPs: 0, openConsultations: 0, pendingExpositions: 0,
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
        { count: pendingSponsorships },
        { count: totalResources }, { count: pendingResourceDrafts },
        { count: totalEvents }, { count: upcomingEvents },
        { count: totalRegistrations }, { count: pendingRegistrations },
        { count: newWebinars }, { count: newProjects },
        { count: newLeads }, { count: qualifiedLeads }, { count: inDiscussionLeads }, { count: signedLeads },
        { count: pendingB2B }, { count: openRFPs }, { count: openConsultations }, { count: pendingExpositions },
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
        supabase.from('sponsorship_requests').select('id', { count: 'exact' }).eq('status', 'pending'),
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
        supabase.from('exposition_requests').select('id', { count: 'exact' }).eq('status', 'pending'),
        // Aging queries
        supabase.from('profiles').select('user_id', { count: 'exact' }).eq('access_status', 'pending').lte('created_at', fortyEightHoursAgo),
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

      // Event performance (registrations per upcoming event)
      if (upcomingEventsData && upcomingEventsData.length > 0) {
        const evtPerfs: EventPerf[] = [];
        for (const evt of upcomingEventsData) {
          const { count: regCount } = await supabase.from('event_registrations').select('id', { count: 'exact' }).eq('event_id', evt.id);
          // Get total capacity from event_pricing
          const { data: pricing } = await supabase.from('event_pricing').select('max_included_seats').eq('event_id', evt.id);
          const capacity = (pricing || []).reduce((s: number, p: { max_included_seats: number }) => s + (p.max_included_seats || 0), 0) || 50;
          const regs = regCount || 0;
          evtPerfs.push({
            id: evt.id, title: evt.title, date_time: evt.date_time,
            registrations: regs, capacity, fillRate: capacity > 0 ? Math.round((regs / capacity) * 100) : 0,
          });
        }
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
        pendingSponsorships: pendingSponsorships || 0,
        totalResources: totalResources || 0, pendingResourceDrafts: pendingResourceDrafts || 0,
        totalEvents: totalEvents || 0, upcomingEvents: upcomingEvents || 0,
        totalRegistrations: totalRegistrations || 0, pendingRegistrations: pendingRegistrations || 0,
        newWebinars: newWebinars || 0, newProjects: newProjects || 0,
        newLeads: newLeads || 0, qualifiedLeads: qualifiedLeads || 0,
        inDiscussionLeads: inDiscussionLeads || 0, signedLeads: signedLeads || 0,
        pendingB2B: pendingB2B || 0, openRFPs: openRFPs || 0,
        openConsultations: openConsultations || 0, pendingExpositions: pendingExpositions || 0,
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

  const fmt = (cents: number) => `€${(cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const pctChange = (current: number, previous: number) => {
    if (!previous) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 100);
  };

  const growthMonthly = pctChange(stats.signupsThisMonth, stats.signupsLastMonth);
  const growthWeekly = pctChange(stats.signupsThisWeek, stats.signupsLastWeek);
  const activePct = stats.totalUsers > 0 ? Math.round((stats.verifiedUsers / stats.totalUsers) * 100) : 0;

  const personaBadge = (persona: string) => {
    const s: Record<string, string> = {
      admin: 'bg-red-100 text-red-800', moderator: 'bg-red-100 text-red-800',
      partner: 'bg-emerald-100 text-emerald-800', marina: 'bg-blue-100 text-blue-800',
      media_partner: 'bg-violet-100 text-violet-800', individual: 'bg-amber-100 text-amber-800',
    };
    const l: Record<string, string> = {
      admin: 'Admin', moderator: 'Mod', partner: 'Partner', marina: 'Marina',
      media_partner: 'Media', individual: 'Individual',
    };
    return <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${s[persona] || 'bg-gray-100 text-gray-800'}`}>{l[persona] || persona}</span>;
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
    { name: 'Partners', value: stats.partnerCount, color: PERSONA_COLORS.partner },
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

  const totalUrgent = stats.usersWaiting48h + stats.oldLeadsNotContacted + stats.oldB2BRequests
    + stats.pendingRegistrations;

  /* ══════════════════════════════ MODERATOR DASHBOARD ══════════════════════════════ */

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        {/* ─── Header ─── */}
        <div className="rounded-2xl bg-gradient-to-br from-[#0b2653] via-[#143a6b] to-[#1e4f8f] p-5 text-white shadow-xl relative overflow-hidden">
          <div className="absolute -top-10 -right-10 h-40 w-40 rounded-full bg-white/5" />
          <div className="absolute -bottom-6 -left-6 h-24 w-24 rounded-full bg-white/5" />
          <div className="flex justify-between items-center relative z-10">
            <div>
              <h1 className="text-xl font-bold">Moderator Dashboard</h1>
              <p className="text-white/60 text-xs mt-0.5">
                Welcome back, {profile?.first_name || 'Moderator'} — {new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={loadDashboard} className="text-white hover:bg-white/20 rounded-xl">
              <RefreshCw className="h-4 w-4 mr-2" />Refresh
            </Button>
          </div>
        </div>

        {/* ─── Your Activity Overview ─── */}
        <div>
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <BarChart3 className="h-3.5 w-3.5" /> Your Activity
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Resources Published */}
            <Card className="group hover:shadow-lg transition-all cursor-pointer border-0 shadow-sm bg-gradient-to-br from-purple-50 to-white"
                  onClick={() => nav('/admin/resources')}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="h-9 w-9 rounded-xl bg-purple-100 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <FileText className="h-4.5 w-4.5 text-purple-600" />
                  </div>
                </div>
                <p className="text-2xl font-bold text-gray-900">{stats.totalResources}</p>
                <p className="text-[10px] text-gray-500 font-medium mt-0.5">Published Resources</p>
              </CardContent>
            </Card>

            {/* Pending Drafts */}
            <Card className="group hover:shadow-lg transition-all cursor-pointer border-0 shadow-sm bg-gradient-to-br from-teal-50 to-white"
                  onClick={() => nav('/admin/resources?tab=drafts')}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="h-9 w-9 rounded-xl bg-teal-100 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <FolderOpen className="h-4.5 w-4.5 text-teal-600" />
                  </div>
                  {stats.pendingResourceDrafts > 0 && (
                    <span className="text-[10px] bg-amber-100 text-amber-700 font-bold px-1.5 py-0.5 rounded-full">
                      {stats.pendingResourceDrafts} pending
                    </span>
                  )}
                </div>
                <p className="text-2xl font-bold text-gray-900">{stats.pendingResourceDrafts}</p>
                <p className="text-[10px] text-gray-500 font-medium mt-0.5">Resource Drafts to Review</p>
              </CardContent>
            </Card>

            {/* Webinar Proposals */}
            <Card className="group hover:shadow-lg transition-all cursor-pointer border-0 shadow-sm bg-gradient-to-br from-indigo-50 to-white"
                  onClick={() => nav('/admin/webinars')}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="h-9 w-9 rounded-xl bg-indigo-100 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <MessageSquare className="h-4.5 w-4.5 text-indigo-600" />
                  </div>
                  {stats.newWebinars > 0 && (
                    <span className="text-[10px] bg-amber-100 text-amber-700 font-bold px-1.5 py-0.5 rounded-full">
                      {stats.newWebinars} new
                    </span>
                  )}
                </div>
                <p className="text-2xl font-bold text-gray-900">{stats.newWebinars}</p>
                <p className="text-[10px] text-gray-500 font-medium mt-0.5">Webinar Proposals</p>
              </CardContent>
            </Card>

            {/* Total Events */}
            <Card className="group hover:shadow-lg transition-all border-0 shadow-sm bg-gradient-to-br from-pink-50 to-white">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="h-9 w-9 rounded-xl bg-pink-100 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Calendar className="h-4.5 w-4.5 text-pink-600" />
                  </div>
                  {stats.upcomingEvents > 0 && (
                    <span className="text-[10px] bg-blue-100 text-blue-700 font-bold px-1.5 py-0.5 rounded-full">
                      {stats.upcomingEvents} upcoming
                    </span>
                  )}
                </div>
                <p className="text-2xl font-bold text-gray-900">{stats.totalEvents}</p>
                <p className="text-[10px] text-gray-500 font-medium mt-0.5">Total Events</p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ─── Action Items ─── */}
        {(stats.pendingResourceDrafts > 0 || stats.newWebinars > 0) && (
          <div>
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5" /> Items Needing Your Attention
            </h3>
            <div className="space-y-2">
              {stats.pendingResourceDrafts > 0 && (
                <button onClick={() => nav('/admin/resources?tab=drafts')}
                  className="flex items-center gap-3 w-full rounded-xl px-4 py-3 bg-amber-50 hover:bg-amber-100 border border-amber-200/60 transition-all group text-left">
                  <div className="h-9 w-9 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                    <FolderOpen className="h-4 w-4 text-amber-600" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-800">{stats.pendingResourceDrafts} resource draft{stats.pendingResourceDrafts !== 1 ? 's' : ''} waiting for review</div>
                    <div className="text-xs text-gray-500">Review and approve or provide feedback</div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-amber-400 group-hover:text-amber-600" />
                </button>
              )}
              {stats.newWebinars > 0 && (
                <button onClick={() => nav('/admin/webinars', { status: 'submitted' })}
                  className="flex items-center gap-3 w-full rounded-xl px-4 py-3 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200/60 transition-all group text-left">
                  <div className="h-9 w-9 rounded-xl bg-indigo-100 flex items-center justify-center shrink-0">
                    <MessageSquare className="h-4 w-4 text-indigo-600" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-800">{stats.newWebinars} webinar proposal{stats.newWebinars !== 1 ? 's' : ''} to review</div>
                    <div className="text-xs text-gray-500">Pre-approve proposals matching your sectors</div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-indigo-400 group-hover:text-indigo-600" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* ─── Quick Actions ─── */}
        <div>
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Quick Actions</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Button variant="outline"
                    className="h-auto py-4 flex flex-col gap-2.5 border-0 shadow-sm hover:shadow-md transition-all rounded-xl bg-purple-50 hover:bg-purple-100"
                    onClick={() => nav('/admin/resources')}>
              <FileText className="h-5 w-5 text-purple-600" />
              <span className="text-sm font-medium text-gray-700">Propose Resource</span>
            </Button>
            <Button variant="outline"
                    className="h-auto py-4 flex flex-col gap-2.5 border-0 shadow-sm hover:shadow-md transition-all rounded-xl bg-teal-50 hover:bg-teal-100"
                    onClick={() => nav('/admin/resources?tab=drafts')}>
              <FolderOpen className="h-5 w-5 text-teal-600" />
              <span className="text-sm font-medium text-gray-700">Review Drafts</span>
            </Button>
            <Button variant="outline"
                    className="h-auto py-4 flex flex-col gap-2.5 border-0 shadow-sm hover:shadow-md transition-all rounded-xl bg-indigo-50 hover:bg-indigo-100"
                    onClick={() => nav('/admin/webinars')}>
              <MessageSquare className="h-5 w-5 text-indigo-600" />
              <span className="text-sm font-medium text-gray-700">Webinar Proposals</span>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  /* ══════════════════════════════ ADMIN RENDER ══════════════════════════════ */

  return (
    <div className="space-y-6">

      {/* ═══ TOP: PRIORITY STRIP ═══ */}
      {totalUrgent > 0 && (
        <div className="rounded-2xl bg-gradient-to-r from-red-50 via-amber-50 to-orange-50 border border-red-200/60 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <div className="h-7 w-7 rounded-lg bg-red-100 flex items-center justify-center">
              <AlertTriangle className="h-4 w-4 text-red-600" />
            </div>
            <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wider">Priority Actions Required</h2>
            <Badge variant="destructive" className="ml-auto text-xs">{totalUrgent} urgent</Badge>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-2">
            {stats.usersWaiting48h > 0 && (
              <button onClick={() => nav('/admin/users', { status: 'pending' })}
                className="flex items-center gap-2.5 bg-white/80 hover:bg-white rounded-xl px-3 py-2.5 text-left transition-all hover:shadow-md border border-red-200/50 group">
                <div className="h-8 w-8 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
                  <UserCheck className="h-4 w-4 text-red-600" />
                </div>
                <div className="min-w-0">
                  <div className="text-lg font-bold text-red-700">{stats.usersWaiting48h}</div>
                  <div className="text-[10px] text-red-600/80 font-medium leading-tight">users waiting &gt;48h</div>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-red-300 ml-auto group-hover:text-red-500 transition-colors" />
              </button>
            )}
            {stats.oldLeadsNotContacted > 0 && (
              <button onClick={() => nav('/admin/leads', { status: 'new' })}
                className="flex items-center gap-2.5 bg-white/80 hover:bg-white rounded-xl px-3 py-2.5 text-left transition-all hover:shadow-md border border-red-200/50 group">
                <div className="h-8 w-8 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
                  <Target className="h-4 w-4 text-red-600" />
                </div>
                <div className="min-w-0">
                  <div className="text-lg font-bold text-red-700">{stats.oldLeadsNotContacted}</div>
                  <div className="text-[10px] text-red-600/80 font-medium leading-tight">leads not contacted</div>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-red-300 ml-auto group-hover:text-red-500 transition-colors" />
              </button>
            )}
            {stats.oldB2BRequests > 0 && (
              <button onClick={() => nav('/admin/partner-requests')}
                className="flex items-center gap-2.5 bg-white/80 hover:bg-white rounded-xl px-3 py-2.5 text-left transition-all hover:shadow-md border border-amber-200/50 group">
                <div className="h-8 w-8 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
                  <Link2 className="h-4 w-4 text-amber-600" />
                </div>
                <div className="min-w-0">
                  <div className="text-lg font-bold text-amber-700">{stats.oldB2BRequests}</div>
                  <div className="text-[10px] text-amber-600/80 font-medium leading-tight">B2B unanswered 7d+</div>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-amber-300 ml-auto group-hover:text-amber-500 transition-colors" />
              </button>
            )}
            {stats.pendingRegistrations > 0 && (
              <button onClick={() => nav('/admin/events')}
                className="flex items-center gap-2.5 bg-white/80 hover:bg-white rounded-xl px-3 py-2.5 text-left transition-all hover:shadow-md border border-orange-200/50 group">
                <div className="h-8 w-8 rounded-lg bg-orange-100 flex items-center justify-center shrink-0">
                  <Calendar className="h-4 w-4 text-orange-600" />
                </div>
                <div className="min-w-0">
                  <div className="text-lg font-bold text-orange-700">{stats.pendingRegistrations}</div>
                  <div className="text-[10px] text-orange-600/80 font-medium leading-tight">event approvals</div>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-orange-300 ml-auto group-hover:text-orange-500 transition-colors" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* ═══ HEADER ═══ */}
      <div className="rounded-2xl bg-gradient-to-br from-[#0b2653] via-[#143a6b] to-[#1e4f8f] p-5 text-white shadow-xl relative overflow-hidden">
        <div className="absolute -top-10 -right-10 h-40 w-40 rounded-full bg-white/5" />
        <div className="absolute -bottom-6 -left-6 h-24 w-24 rounded-full bg-white/5" />
        <div className="flex justify-between items-center relative z-10">
          <div>
            <h1 className="text-xl font-bold">{t('admin.dashboard')}</h1>
            <p className="text-white/60 text-xs mt-0.5">
              {new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={loadDashboard} className="text-white hover:bg-white/20 rounded-xl">
            <RefreshCw className="h-4 w-4 mr-2" />Refresh
          </Button>
        </div>
      </div>

      {/* ═══ ROW 1: PERFORMANCE KPIs ═══ */}
      <div>
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <BarChart3 className="h-3.5 w-3.5" /> Performance Snapshot
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Revenue */}
          <Card className="group hover:shadow-lg transition-all cursor-pointer border-0 shadow-sm bg-gradient-to-br from-emerald-50 to-white"
                onClick={() => document.getElementById('revenue-chart')?.scrollIntoView({ behavior: 'smooth' })}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="h-9 w-9 rounded-xl bg-emerald-100 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <DollarSign className="h-4.5 w-4.5 text-emerald-600" />
                </div>
                {stats.revenueThisMonthCents > 0 && (
                  <span className="text-[10px] bg-emerald-100 text-emerald-700 font-bold px-1.5 py-0.5 rounded-full">
                    +{fmt(stats.revenueThisMonthCents)} /mo
                  </span>
                )}
              </div>
              <p className="text-2xl font-bold text-gray-900">{fmt(stats.totalRevenueCents)}</p>
              <p className="text-[10px] text-gray-500 font-medium mt-0.5">Total Revenue</p>
            </CardContent>
          </Card>

          {/* Users */}
          <Card className="group hover:shadow-lg transition-all cursor-pointer border-0 shadow-sm bg-gradient-to-br from-blue-50 to-white"
                onClick={() => nav('/admin/users')}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="h-9 w-9 rounded-xl bg-blue-100 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Users className="h-4.5 w-4.5 text-blue-600" />
                </div>
                <span className="text-[10px] bg-green-100 text-green-700 font-bold px-1.5 py-0.5 rounded-full">
                  {activePct}% active
                </span>
              </div>
              <p className="text-2xl font-bold text-gray-900">{stats.totalUsers}</p>
              <p className="text-[10px] text-gray-500 font-medium mt-0.5">Total Users</p>
            </CardContent>
          </Card>

          {/* Weekly Growth */}
          <Card className="group hover:shadow-lg transition-all cursor-pointer border-0 shadow-sm bg-gradient-to-br from-indigo-50 to-white"
                onClick={() => document.getElementById('signup-chart')?.scrollIntoView({ behavior: 'smooth' })}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="h-9 w-9 rounded-xl bg-indigo-100 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <TrendingUp className="h-4.5 w-4.5 text-indigo-600" />
                </div>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5 ${
                  growthWeekly >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                }`}>
                  {growthWeekly >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                  {growthWeekly >= 0 ? '+' : ''}{growthWeekly}%
                </span>
              </div>
              <p className="text-2xl font-bold text-gray-900">{stats.signupsThisWeek}</p>
              <p className="text-[10px] text-gray-500 font-medium mt-0.5">New This Week</p>
            </CardContent>
          </Card>

          {/* Monthly Growth */}
          <Card className="group hover:shadow-lg transition-all cursor-pointer border-0 shadow-sm bg-gradient-to-br from-violet-50 to-white"
                onClick={() => document.getElementById('signup-chart')?.scrollIntoView({ behavior: 'smooth' })}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="h-9 w-9 rounded-xl bg-violet-100 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Activity className="h-4.5 w-4.5 text-violet-600" />
                </div>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5 ${
                  growthMonthly >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                }`}>
                  {growthMonthly >= 0 ? '+' : ''}{growthMonthly}%
                </span>
              </div>
              <p className="text-2xl font-bold text-gray-900">{stats.signupsThisMonth}</p>
              <p className="text-[10px] text-gray-500 font-medium mt-0.5">New This Month</p>
            </CardContent>
          </Card>

          {/* Orgs */}
          <Card className="group hover:shadow-lg transition-all cursor-pointer border-0 shadow-sm bg-gradient-to-br from-purple-50 to-white"
                onClick={() => nav('/admin/sponsorships')}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="h-9 w-9 rounded-xl bg-purple-100 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Building2 className="h-4.5 w-4.5 text-purple-600" />
                </div>
                {stats.pendingSponsorships > 0 && (
                  <span className="text-[10px] bg-amber-100 text-amber-700 font-bold px-1.5 py-0.5 rounded-full">
                    {stats.pendingSponsorships} reqs
                  </span>
                )}
              </div>
              <p className="text-2xl font-bold text-gray-900">{stats.totalOrgs}</p>
              <p className="text-[10px] text-gray-500 font-medium mt-0.5">Organizations</p>
            </CardContent>
          </Card>

          {/* B2B Connections */}
          <Card className="group hover:shadow-lg transition-all cursor-pointer border-0 shadow-sm bg-gradient-to-br from-cyan-50 to-white"
                onClick={() => nav('/admin/partner-requests')}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="h-9 w-9 rounded-xl bg-cyan-100 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Link2 className="h-4.5 w-4.5 text-cyan-600" />
                </div>
              </div>
              <p className="text-2xl font-bold text-gray-900">{stats.pendingB2B + stats.openRFPs + stats.openConsultations}</p>
              <p className="text-[10px] text-gray-500 font-medium mt-0.5">Active B2B</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ═══ ROW 2: BUSINESS OPPORTUNITIES PIPELINE ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Leads Funnel */}
        <Card className="lg:col-span-3 border-0 shadow-sm hover:shadow-lg transition-all cursor-pointer"
              onClick={() => nav('/admin/leads', { status: 'new' })}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
                <Target className="h-4 w-4 text-orange-500" />
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
                color: 'text-rose-600', bg: 'bg-rose-50', icon: Link2, link: '/admin/partner-requests', params: { status: 'pending' } },
              { label: 'Open RFPs', total: stats.openRFPs, badge: '', color: 'text-blue-600', bg: 'bg-blue-50',
                icon: FileText, link: '/admin/rfps', params: { status: 'open' } },
              { label: 'Consultations', total: stats.openConsultations, badge: '', color: 'text-cyan-600', bg: 'bg-cyan-50',
                icon: MessageSquare, link: '/admin/consultations', params: { status: 'open' } },
              { label: 'Expo Requests', total: stats.pendingExpositions, badge: '', color: 'text-pink-600', bg: 'bg-pink-50',
                icon: Eye, link: '/admin/expositions', params: { status: 'pending' } },
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
        <Card className="border-0 shadow-sm hover:shadow-lg transition-all cursor-pointer" onClick={() => nav('/admin/users')}>
          <CardHeader className="pb-1">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
                <Ship className="h-4 w-4 text-blue-500" />
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
        <Card className="border-0 shadow-sm hover:shadow-lg transition-all cursor-pointer" onClick={() => nav('/admin/users')}>
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
        <Card className="border-0 shadow-sm hover:shadow-lg transition-all">
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
                color: 'text-orange-600', bg: 'bg-orange-50', link: '/admin/users', params: {} },
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
        <Card id="signup-chart" className="border-0 shadow-sm hover:shadow-lg transition-all">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-indigo-500" />
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
        <Card id="revenue-chart" className="border-0 shadow-sm hover:shadow-lg transition-all">
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
      <Card className="border-0 shadow-sm hover:shadow-lg transition-all">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-pink-500" />
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
                <span className="text-blue-600 font-medium">{stats.upcomingEvents} upcoming</span>
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
        <Card className="border-0 shadow-sm hover:shadow-lg transition-all cursor-pointer" onClick={() => nav('/admin/sponsorships')}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-violet-500" />
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
        <Card className="border-0 shadow-sm hover:shadow-lg transition-all bg-gradient-to-br from-slate-50 to-white">
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
                    info: 'bg-blue-50 border-blue-200 text-blue-800',
                  };
                  const iconColors = {
                    danger: 'text-red-500', warning: 'text-amber-500',
                    success: 'text-green-500', info: 'text-blue-500',
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
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5" /> All Action Items
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5">
          {[
            { label: 'Pending Users', value: stats.pendingUsers, icon: UserCheck, gradient: 'from-yellow-500 to-amber-500', bg: 'bg-yellow-50', link: '/admin/users', params: { status: 'pending' } },
            { label: 'Event Approvals', value: stats.pendingRegistrations, icon: Calendar, gradient: 'from-pink-500 to-rose-500', bg: 'bg-pink-50', link: '/admin/events', params: { view: 'registrations' } },
            { label: 'Sponsorships', value: stats.pendingSponsorships, icon: ArrowUpRight, gradient: 'from-purple-500 to-violet-500', bg: 'bg-purple-50', link: '/admin/sponsorships', params: { status: 'pending' } },
            { label: 'Webinar Reqs', value: stats.newWebinars, icon: MessageSquare, gradient: 'from-indigo-500 to-blue-500', bg: 'bg-indigo-50', link: '/admin/webinars', params: { status: 'submitted' } },
            { label: 'Resource Drafts', value: stats.pendingResourceDrafts, icon: FolderOpen, gradient: 'from-teal-500 to-cyan-500', bg: 'bg-teal-50', link: '/admin/resources', params: { tab: 'drafts' } },
            { label: 'New Projects', value: stats.newProjects, icon: Anchor, gradient: 'from-orange-500 to-red-500', bg: 'bg-orange-50', link: '/admin/projects', params: { status: 'new' } },
            { label: 'Expo Requests', value: stats.pendingExpositions, icon: Eye, gradient: 'from-fuchsia-500 to-pink-500', bg: 'bg-fuchsia-50', link: '/admin/expositions', params: { status: 'pending' } },
            { label: 'B2B Requests', value: stats.pendingB2B, icon: Link2, gradient: 'from-rose-500 to-red-500', bg: 'bg-rose-50', link: '/admin/partner-requests', params: { status: 'pending' } },
            { label: 'New Leads', value: stats.newLeads, icon: Target, gradient: 'from-cyan-500 to-blue-500', bg: 'bg-cyan-50', link: '/admin/leads', params: { status: 'new' } },
          ].map((item, i) => {
            const active = item.value > 0;
            return (
              <Card key={i}
                className={`group hover:shadow-lg transition-all cursor-pointer border-0 shadow-sm overflow-hidden ${active ? 'ring-1 ring-gray-200' : ''}`}
                onClick={() => nav(item.link, item.params)}>
                {active && <div className={`h-1 bg-gradient-to-r ${item.gradient}`} />}
                <CardContent className="pt-3.5 pb-3 px-3">
                  <div className="flex flex-col items-center text-center gap-1.5">
                    <div className={`h-9 w-9 rounded-xl ${item.bg} flex items-center justify-center group-hover:scale-110 transition-transform`}>
                      <item.icon className={`h-4 w-4 ${active ? 'text-gray-700' : 'text-gray-400'}`} />
                    </div>
                    <div className={`text-xl font-bold ${active ? 'text-gray-900' : 'text-gray-300'}`}>{item.value}</div>
                    <div className="text-[10px] text-gray-500 leading-tight font-medium">{item.label}</div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* ═══ ROW 8: RECENT ACTIVITY ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent Signups */}
        <Card className="border-0 shadow-sm hover:shadow-lg transition-all">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
                <Users className="h-4 w-4 text-blue-500" /> Recent Signups
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
        <Card className="border-0 shadow-sm hover:shadow-lg transition-all">
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Manage Users', icon: Users, link: '/admin/users', color: 'text-blue-600', bg: 'bg-blue-50 hover:bg-blue-100' },
          { label: 'Add Resource', icon: FileText, link: '/admin/resources', color: 'text-purple-600', bg: 'bg-purple-50 hover:bg-purple-100' },
          { label: 'Add Event', icon: Calendar, link: '/admin/events', color: 'text-pink-600', bg: 'bg-pink-50 hover:bg-pink-100' },
          { label: 'Review Drafts', icon: FolderOpen, link: '/admin/resources?tab=drafts', color: 'text-teal-600', bg: 'bg-teal-50 hover:bg-teal-100' },
        ].map((a, i) => (
          <Button key={i} variant="outline"
                  className={`h-auto py-4 flex flex-col gap-2.5 border-0 shadow-sm hover:shadow-md transition-all rounded-xl ${a.bg}`}
                  onClick={() => nav(a.link)}>
            <a.icon className={`h-5 w-5 ${a.color}`} />
            <span className="text-sm font-medium text-gray-700">{a.label}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
