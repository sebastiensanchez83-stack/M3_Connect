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
export type OrgTier = 'member' | 'premium' | 'enterprise';
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
