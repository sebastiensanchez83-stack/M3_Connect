export type PersonaType = 'marina' | 'partner' | 'media_partner' | 'moderator' | 'admin' | 'individual';
export type AccessStatus = 'pending' | 'verified' | 'rejected' | 'suspended';
export type OnboardingStatus = 'draft' | 'submitted' | 'under_review' | 'completed';

export interface Profile {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  persona: PersonaType;
  access_status: AccessStatus;
  onboarding_status: OnboardingStatus;
  rejection_reason: string | null;
  avatar_url: string | null;
  job_title: string | null;
  created_at: string;
  updated_at: string;
}

export interface MarinaProfile {
  user_id: string;
  marina_name: string;
  country: string | null;
  city: string | null;
  website: string | null;
  berths_count: number | null;
  logo_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface PartnerProfile {
  user_id: string;
  company_name: string;
  website: string | null;
  headquarters_country: string | null;
  description: string | null;
  recommendation_proof_path: string | null;
  logo_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface MediaPartnerProfile {
  user_id: string;
  media_name: string;
  website: string | null;
  audience_description: string | null;
  logo_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ModeratorProfile {
  user_id: string;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface Sector {
  id: string;
  slug: string;
  label: string;
  is_active: boolean;
  created_at: string;
}

export interface ResourceSpeaker {
  id: string;
  resource_id: string;
  profile_id: string | null;
  full_name: string;
  job_title: string | null;
  company_name: string | null;
  display_order: number;
  created_at: string;
}

export type UserDetails = MarinaProfile | PartnerProfile | MediaPartnerProfile | ModeratorProfile;

// Organization types
export type OrgTier = 'member' | 'innovation_partner' | 'associate_partner' | 'premium_partner' | 'main_sponsor';
export type OrgMemberRole = 'owner' | 'collaborator';
export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'cancelled';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  primary_domain: string | null;
  organization_type: PersonaType | null;
  tier: OrgTier;
  max_seats: number;
  created_by_user_id: string;
  owner_user_id: string;
  logo_url: string | null;
  description: string | null;
  website: string | null;
  country: string | null;
  city: string | null;
  access_status: AccessStatus;
  onboarding_status: 'draft' | 'submitted' | 'completed';
  rejection_reason: string | null;
  audience_description: string | null;
  headquarters_country: string | null;
  social_media_links: string | null;
  marina_subtype: 'visitor' | 'exhibitor' | null;
  created_at: string;
  updated_at: string;
}

export interface OrganizationMember {
  id: string;
  organization_id: string;
  user_id: string;
  role: OrgMemberRole;
  joined_at: string;
  // Joined data
  profiles?: Pick<Profile, 'first_name' | 'last_name' | 'email' | 'persona'>;
}

export interface OrganizationInvitation {
  id: string;
  organization_id: string;
  email: string;
  normalized_domain: string | null;
  invited_by_user_id: string;
  first_name: string | null;
  last_name: string | null;
  status: InvitationStatus;
  token: string;
  created_at: string;
  expires_at: string;
}

export interface OrganizationAuditLog {
  id: string;
  organization_id: string;
  actor_user_id: string | null;
  event_type: string;
  event_payload: Record<string, unknown>;
  created_at: string;
}

export interface OrgTierConfig {
  tier: OrgTier;
  max_seats: number;
  can_invite: boolean;
  label: string;
}

// Organization marina details (org-level marina-specific data)
export interface OrganizationMarinaDetails {
  organization_id: string;
  marina_type: string | null;
  completion_date: string | null;
  berths_count: number | null;
  superyacht_berths: number | null;
  longest_berth_meters: number | null;
  fresh_water_available: boolean;
  mix_range_boats: boolean;
  mix_range_description: string | null;
  certifications: string[];
  certifications_other: string | null;
  has_yacht_club: boolean;
  yacht_club_members: number | null;
  has_sailing_school: boolean;
  has_boat_yard: boolean;
  has_restaurants: boolean;
  restaurants_count: number | null;
  has_concierge: boolean;
  marina_description: string | null;
  services_description: string | null;
  created_at: string;
  updated_at: string;
}

// Organization-level sector junction types
export interface OrganizationInterestSector {
  organization_id: string;
  sector_id: string;
  created_at: string;
}

export interface OrganizationServiceSector {
  organization_id: string;
  sector_id: string;
  created_at: string;
}

export interface OrganizationFuturePlan {
  organization_id: string;
  sector_id: string;
  timeline: string;
}

// Invitation check result
export interface PendingInvitationResult {
  invitation_id: string;
  organization_id: string;
  organization_name: string;
  invited_by_name: string;
}

// Sponsorship request
export type SponsorshipRequestStatus = 'pending' | 'invoice_sent' | 'paid' | 'approved' | 'rejected';

export interface SponsorshipRequest {
  id: string;
  organization_id: string;
  requested_by: string;
  requested_tier: string;
  current_tier: string;
  status: SponsorshipRequestStatus;
  admin_notes: string | null;
  invoice_reference: string | null;
  amount_due: number | null;
  amount_already_paid: number;
  payment_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
  // Joined data
  organizations?: Pick<Organization, 'id' | 'name' | 'logo_url' | 'tier'>;
}

// Exposition request (marina exhibitor)
export type ExpositionRequestStatus = 'pending' | 'approved' | 'invoice_sent' | 'paid' | 'rejected';

export interface ExpositionRequest {
  id: string;
  organization_id: string;
  event_id: string;
  requested_by: string;
  status: ExpositionRequestStatus;
  admin_notes: string | null;
  invoice_reference: string | null;
  amount_due: number | null;
  payment_confirmed_at: string | null;
  created_at: string;
  // Joined data
  organizations?: Pick<Organization, 'id' | 'name' | 'logo_url'>;
}

// Sponsor tier helpers
export const SPONSOR_TIERS: OrgTier[] = ['innovation_partner', 'associate_partner', 'premium_partner', 'main_sponsor'];
export const isSponsorTier = (tier: OrgTier): boolean => SPONSOR_TIERS.includes(tier);

export const TIER_LABELS: Record<OrgTier, string> = {
  member: 'Member',
  innovation_partner: 'Innovation Partner',
  associate_partner: 'Associate Partner',
  premium_partner: 'Premium Partner',
  main_sponsor: 'Main Sponsor',
};

export const TIER_COLORS: Record<OrgTier, { bg: string; text: string; border: string }> = {
  member: { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200' },
  innovation_partner: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  associate_partner: { bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200' },
  premium_partner: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  main_sponsor: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
};
