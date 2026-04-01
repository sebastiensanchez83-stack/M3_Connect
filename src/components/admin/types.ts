/* ─── Shared Admin Types ─── */

export interface AdminProfile {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  persona: string;
  access_status: string;
  onboarding_status: string;
  rejection_reason: string | null;
  created_at: string;
  org_name: string | null;
  org_id: string | null;
  // Org-level fields (merged from Partners tab)
  org_tier: string | null;
  org_type: string | null;
  org_access_status: string | null;
  org_max_seats: number | null;
  org_website: string | null;
  org_country: string | null;
  org_city: string | null;
  org_description: string | null;
  org_logo_url: string | null;
}

export interface Resource {
  id: string;
  title: string;
  summary: string;
  content: string | null;
  type: string;
  topic: string;
  language: string;
  access_level: string;
  thumbnail_url: string | null;
  file_url: string | null;
  seo_keywords: string | null;
  published: boolean;
}

export interface SpeakerFormRow {
  id?: string;
  profile_id: string | null;
  full_name: string;
  job_title: string;
  company_name: string;
}

export interface ProfileSearchResult {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  persona: string;
  company_name?: string;
}

export interface Event {
  id: string;
  title: string;
  description: string;
  date_time: string;
  location: string | null;
  language: string;
  access_level: string;
  speakers: { name: string; title: string }[];
  replay_url: string | null;
  event_type: string;
}

export interface Partner {
  id: string;
  name: string;
  description: string | null;
  logo_url: string | null;
  website: string | null;
  organization_type: string;
  tier: string;
  max_seats: number;
  country: string | null;
  city: string | null;
  access_status: string;
  onboarding_status: string;
  owner_user_id: string | null;
}

export interface SponsorshipRequestRow {
  id: string;
  organization_id: string;
  requested_by: string;
  requested_tier: string;
  current_tier: string;
  status: string;
  admin_notes: string | null;
  invoice_reference: string | null;
  amount_due: number | null;
  amount_already_paid: number;
  payment_confirmed_at: string | null;
  created_at: string;
  org_name?: string;
  requester_email?: string;
}

export interface MarinaProject {
  id: string;
  user_id: string;
  project_type: string;
  budget_range: string;
  timeline: string;
  description: string;
  status: string;
  admin_notes: string | null;
  created_at: string;
}

export interface PartnerLead {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  company: string;
  website: string | null;
  country: string;
  actor_type: string;
  solutions: string | null;
  goals: string | null;
  engagement_level: string;
  status: string;
  admin_notes: string | null;
  created_at: string;
}

export interface WebinarRequest {
  id: string;
  user_id: string;
  title: string;
  description: string;
  preferred_language: string;
  preferred_timeframe: string | null;
  status: string;
  moderator_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
  // Enriched fields (joined from profiles)
  requester_name?: string;
  requester_email?: string;
}

export interface PartnerRequest {
  id: string;
  partner_user_id: string;
  marina_user_id: string;
  partner_organization_id: string | null;
  marina_organization_id: string | null;
  sector_id: string | null;
  message: string;
  status: string;
  created_at: string;
}

export interface RFP {
  id: string;
  marina_user_id: string;
  title: string;
  scope: string;
  sector_id: string | null;
  deadline_date: string | null;
  is_open: boolean;
  created_at: string;
}

export interface Consultation {
  id: string;
  marina_user_id: string;
  title: string;
  description: string;
  sector_id: string | null;
  is_open: boolean;
  created_at: string;
}

export interface ResourceDraft {
  id: string;
  resource_id: string | null;
  title: string;
  summary: string | null;
  content: string;
  type: string | null;
  topic: string | null;
  language: string | null;
  access_level: string | null;
  thumbnail_url: string | null;
  file_url: string | null;
  status: string;
  created_by: string;
  created_at: string;
  updated_at?: string;
}

export interface EventPricingRow {
  id?: string;
  tier: string;
  price_cents: number;
  max_included_seats: number | null;
  additional_member_price_cents: number;
  discount_pct: number;
}

export const DEFAULT_PRICING: EventPricingRow[] = [
  { tier: 'member', price_cents: 50000, max_included_seats: 1, additional_member_price_cents: 25000, discount_pct: 10 },
  { tier: 'innovation_partner', price_cents: 0, max_included_seats: 5, additional_member_price_cents: 21000, discount_pct: 0 },
  { tier: 'associate_partner', price_cents: 0, max_included_seats: 8, additional_member_price_cents: 21000, discount_pct: 0 },
  { tier: 'premium_partner', price_cents: 0, max_included_seats: 10, additional_member_price_cents: 21000, discount_pct: 0 },
  { tier: 'main_sponsor', price_cents: 0, max_included_seats: 15, additional_member_price_cents: 21000, discount_pct: 0 },
];

/* ─── Admin-only route paths — moderators are blocked from these ─── */
export const ADMIN_ONLY_ROUTES = new Set([
  '/admin/users', '/admin/events',
  '/admin/projects', '/admin/leads', '/admin/partner-requests',
  '/admin/rfps', '/admin/consultations',
  '/admin/sponsorships', '/admin/expositions',
]);
