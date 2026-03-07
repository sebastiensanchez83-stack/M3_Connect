# M3 Connect: Organization-Centric Restructure

## Goal
Organizations become the main showcased entity. Users are members of organizations. The onboarding flow creates the organization profile (not a user-level persona profile).

## Key Decisions
- Marina matching: **invite-only** (no domain detection for marinas)
- Partner/media: domain detection auto-join (already works)
- Persona profile tables → **thin** (deprecated, keep in DB but stop writing)
- Admin validation changes → **later (not this phase)**
- Invited members from verified org → **auto-validated**

---

## Phase 1 — DB Migrations (via Supabase MCP)

**Migration 1: Enrich `organizations` table**
- Add `access_status` TEXT (pending/verified/rejected/suspended) DEFAULT 'pending'
- Add `onboarding_status` TEXT (draft/submitted/completed) DEFAULT 'draft'
- Add `rejection_reason` TEXT
- Add `audience_description` TEXT (for media orgs)
- Add `headquarters_country` TEXT (for partner orgs)
- Add `social_media_links` TEXT

**Migration 2: Create `organization_marina_details`**
- PK = organization_id (FK → organizations)
- All marina fields: marina_type, berths_count, superyacht_berths, longest_berth_meters, fresh_water_available, mix_range_boats, mix_range_description, certifications[], certifications_other, has_yacht_club, yacht_club_members, has_sailing_school, has_boat_yard, has_restaurants, restaurants_count, has_concierge, marina_description, services_description, completion_date
- RLS: public read for verified orgs, org owner + mod write

**Migration 3: Create org-level sector tables**
- `organization_interest_sectors` (org_id, sector_id) — replaces marina_interest_sectors
- `organization_service_sectors` (org_id, sector_id) — replaces partner_service_sectors
- `organization_future_plans` (org_id, sector_id, timeline) — replaces marina_future_plans

**Migration 4: Add `job_title` to `profiles`**

**Migration 5: Create `accept_org_invitation()` function**
- Adds user as collaborator to org
- If org is verified → auto-sets user access_status='verified', onboarding_status='completed'

**Migration 6: Create `check_pending_invitation()` function**
- Returns pending invitation info for an email

**Migration 7: Update `handle_new_user` trigger**
- Now stores `job_title` from signup metadata into profiles

**Migration 8: Data migration**
- For existing marina_profiles users NOT in an org → create org + marina_details + migrate sectors
- For existing partner_profiles users → create org + migrate sectors
- For existing media_partner_profiles users → create org
- Skip users already in organizations

---

## Phase 2 — TypeScript Types (`src/types/database.ts`)
- Add `OrganizationMarinaDetails` interface
- Update `Organization` with new columns (access_status, onboarding_status, etc.)
- Add `job_title` to `Profile`
- Add org-level sector interfaces

## Phase 3 — AuthContext (`src/contexts/AuthContext.tsx`)
- Add to context: `organization: Organization | null`, `orgRole`, `hasOrganization`
- `fetchUserData` also loads org membership + org data
- `signUp` accepts `jobTitle` param, passes in metadata

## Phase 4 — SignupForm (`src/components/auth/SignupForm.tsx`)
- Add `jobTitle` field to form (between lastName and email)
- Pass to `signUp()`

## Phase 5 — OnboardingPage Rewrite (`src/pages/OnboardingPage.tsx`)
**New multi-step flow:**
- Step 0: Persona selection (if no profile — rare with trigger)
- Step 1: Organization resolution
  - Check for pending invitation → accept → auto-join → done
  - Check for domain match (partner/media only) → auto-join → done
  - No match → Step 2
- Step 2: Create Organization + fill persona-specific org details
  - Pre-fill name/website from signup metadata
  - Marina: full marina form → saves to organizations + organization_marina_details + organization_interest_sectors + organization_future_plans
  - Partner: description, HQ country, sectors → saves to organizations + organization_service_sectors
  - Media: audience_description → saves to organizations
- Step 3: Confirmation → redirect to /account

## Phase 6 — AccountPage (`src/pages/AccountPage.tsx`)
- Profile tab reads org data from context (not persona profile tables)
- Show org status badges
- Profile preview uses org data

## Phase 7 — OrganizationTab (`src/components/organization/OrganizationTab.tsx`)
- Show org access_status badge
- Skip domain enforcement on invites for marina orgs (invite-only)
- Allow editing org-level details

## Phase 8 — MarketplacePage (`src/pages/MarketplacePage.tsx`)
- Replace `partner_profiles` queries → `organizations` queries
- Fetch `organization_service_sectors` instead of `partner_service_sectors`
- Cards link to `/organizations/:slug`
- Show ALL org types (marina, partner, media) not just partners

## Phase 9 — OrganizationPublicPage (`src/pages/OrganizationPublicPage.tsx`)
- Fetch marina_details for marina orgs
- Show org-level sectors
- Show member job titles

## Phase 10 — HomePage personalized feed update
- Sector-based feed reads from org-level sector tables instead of user-level

---

## Implementation Order
1. DB Migrations (Phase 1)
2. TypeScript types (Phase 2)
3. AuthContext (Phase 3)
4. SignupForm (Phase 4)
5. OnboardingPage rewrite (Phase 5)
6. AccountPage (Phase 6)
7. OrganizationTab (Phase 7)
8. MarketplacePage (Phase 8)
9. OrganizationPublicPage (Phase 9)
10. HomePage feed update (Phase 10)
11. Build verification + commit

## Files Modified
1. `src/types/database.ts`
2. `src/contexts/AuthContext.tsx`
3. `src/components/auth/SignupForm.tsx`
4. `src/pages/OnboardingPage.tsx` (full rewrite)
5. `src/pages/AccountPage.tsx`
6. `src/components/organization/OrganizationTab.tsx`
7. `src/pages/MarketplacePage.tsx`
8. `src/pages/OrganizationPublicPage.tsx`
9. `src/pages/HomePage.tsx`
