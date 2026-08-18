<!-- Generated 2026-07-21 by a multi-agent code-grounded audit (8 investigators + adversarial verification + synthesis). Section 4 (Core↔SM26 linkage) was reconstructed by the verifier from live pg_get_functiondef output — tagged confidence: medium inline. -->

# Smart Marina Connect — Registration & Onboarding Audit

Scope: core platform provisioning (`/become-partner` → `SignupForm` → `/onboarding`) and the SM26 event module (`/sm26/register`, `sm26-*` edge functions), plus the identity/status seams between them. All findings below survived adversarial verification; where the verifier corrected a claim, the corrected version is used and tagged.

---

## 1. Executive summary

- **The two systems never share a status axis.** `profiles.access_status` and `sm_registration.status`/`sm_role_assignment.status` are three independent machines with no FK or sync; the only coupling is one-directional (`sm26-provision` force-writes the profile to `verified/completed` but never touches the registration status). Production data already contains a user who is `verified/completed` on core while `under_review` on SM26.
- **SM26 provisioning is a side door around the core verification gate.** `sm26-provision` writes `persona='partner'` + `access_status='verified'` with zero references, and — on an email that already has a core account — *overwrites* an in-progress core identity (down to `persona='individual'`) because the privilege-escalation trigger deliberately trusts service-role writes.
- **Identity linkage between the systems is soft-match only.** SM26 rows connect to core via nullable `user_id`/`organization_id` back-filled by case-insensitive email and normalized-name matching (`sm_autoclaim_by_email`, `sm_claim_registration`, `sm_link_registration_to_account`). There is no uniqueness/FK guarantee, and three parallel claim paths must stay behaviorally consistent.
- **Duplicate organizations are easy to mint.** `sm26-provision` defaults admins to "Create org" and dedupes only on slug; it never calls `sm_org_name_match` (which core onboarding *does* call), so confirming a registrant whose company already exists as a core org creates a second parallel org.
- **Personal/corporate email create-org is a maximum-sunk-cost dead end.** After filling the entire org form, `create_organization` raises on public email domains, and a separate `organizations.primary_domain` UNIQUE index raises on domain collisions — two distinct last-submit crashes, both contradicting the "personal domains now allowed" copy.
- **The domain auto-join subsystem is orphaned.** The onboarding domain-match branch was removed, yet the owner toggle, `request_org_join`/`can_domain_join` RPCs, and a written-but-never-read `detected_org_id` metadata field all remain, promising a "join your team" flow that never runs.
- **The same real-world fields are collected twice into disjoint homes** (name, company, website, country, sector, social links), with SM26's website/country discarded at provisioning and partner/media social links dropped on submit even in core.
- **Event-only `individual` guests fall into core dead states** — a misleading "complete your organization" banner, no onboarding branch, and no reminder/cleanup if they never set a password.

### Findings index

| ID | Area | Sev | One-line |
|---|---|---|---|
| DOM-BLOCK | Core entry | High | Public-email create-org crashes at final submit; also strands already-verified users |
| DOM-UNIQUE | Core entry / UX | High | `organizations.primary_domain` UNIQUE index is a second last-submit crash surface; code/DB disconnect |
| DOM-DEAD | Core entry | High | Domain auto-join subsystem orphaned; toggle + RPCs + handlers unreachable |
| CLAIM-SIGNUP | Core entry | High | `claim-code-signup` creates account but no membership; relies on silent client auto-claim |
| STATUS-INDEP | Persona/status | High | Core and SM26 status machines fully independent; contradictory pairs in prod |
| PROV-VERIFY-BYPASS | Reverify / gaps | High | `sm26-provision` force-verifies (persona=partner, zero references) and clobbers a pre-existing core identity |
| PROV-DUP-ORG | Persona / dup | High | Provision defaults to Create-org without name-match → duplicate organizations |
| IMPORT-COLLISION | Gaps | High | Import + self-register produce duplicate orphan rows; reverse order swallows 23505 |
| DETECTED-ORG | Core entry / linkage | Med | `detected_org_id` written to metadata, consumed nowhere |
| CLAIM-UNVERIFIED | Core entry | Med | Claiming an unverified org leaves claimer unresolved (no review-queue transition) |
| DEMO-USER | Core entry | Med | `create-demo-user` unguarded; yields onboarding-incompatible `individual` |
| MULTI-ORG | Core entry | Med | `create_organization` blocks a 2nd org while claim/invite/join allow it |
| IMPORT-ROLES | SM26 entry | Med | Importer maps only 6 of 11 roles; architect/media/sponsor/vip coerced to visitor |
| JURY-INVESTOR | SM26 entry | Med | Jury import auto-creates an investor assignment (deal-flow over-grant) |
| SOFT-MATCH | Linkage | Med | Email/name soft-match linkage with no uniqueness/FK guarantee |
| THREE-LINK-PATHS | Linkage | Med | Three parallel linkage entry points must stay consistent |
| SPONSOR-LINK | Linkage | Med | `sp_link_from_sm26` adds a third Core↔SM26↔sponsorship coupling |
| PROV-DISCARD | Fields | Med | SM26 website/country discarded when org is provisioned |
| TAXONOMY | Fields | Med | Sector (17 FK) vs SM26 category (11 free strings): incompatible taxonomies |
| SOCIAL-DROP | Fields | Med | Partner/media social links collected in core form, never persisted |
| MARINA-DATA | Fields | Med | SM26 marina never captures berths/facilities/certs (deliberate, but guest orgs get nothing) |
| INVESTOR-COLS | Fields | Med | Dedicated `organizations.investment_*` columns never populated by either intake |
| DEV-INV-FORM | Persona | Med | Developer & Investor silently reuse the Partner form |
| INDIVIDUAL-STRANDED | Persona/friction | Med | SM26 `individual` guest stranded at pending/draft with misleading banner |
| ACCOUNT-TABS | Persona / gap | Med | `/account` shows core & SM26 status on different tabs, no cross-reference |
| PERSONA-MULTIROLE | Persona | Med | Single-valued persona can't represent multi-role SM26 identity (deliberate) |
| REF-GATE-DISJOINT | Reverify | Med | SM26 console gate (`sm_event_partner`) ignores the core 2-reference gate |
| INVITE-SYSTEMS | Dup / linkage | Med | Two disjoint "invite/connection" systems; `sm26-connection` is an intro, not an invite |
| SM26-PLATFORM-HIDDEN | UX / persona | Med | `/sm26/register` doesn't disclose it creates a full SMC account |
| TWO-DOORS | UX / entry | Med | `/become-partner` and `/sm26/register` never cross-link |
| MARINA-FORM | UX / friction | Med | Marina new-org form is one ~30-input all-or-nothing submit, no server draft |
| INVITE-EXPIRY | Reverify | Med | `organization_invitations.expires_at` stored but never enforced |
| PW-PENDING-STRAND | Gaps | Med | `pw_pending` guests never reminded/cleaned; anti-enumeration branch can silently write nothing |
| VALIDATION-CLIENT | Fields / gaps | Med | Company/country + role/scope validated only client-side; no server/DB backstop |
| NOTIF-OVERLAP | Notifications | Med | Core `user_account_approved` can fire alongside SM26 welcome/confirmed with divergent CTAs |
| PERSONA-FALLBACK | Core / persona | Low | Onboarding fallback picker offers 3 of 5 self-serve personas |
| PERSONA-WRITERS | Core entry | Low | Persona set by four independent writers, no single source of truth |
| INDIVIDUAL-DEFAULT | Core entry | Low | `handle_new_user` couples core default to event-only `individual` (sticky) |
| ADMIN-SLEEP | Core entry | Low | `create-admin-user` uses a 1s sleep + non-fatal update → half-provisioned admin |
| GUEST-ORG-NULL | SM26 entry | Low | Guest org-scope role rows carry `organization_id=NULL` until confirm |
| SOCIAL-SHAPE | Fields | Low | Social links modeled 3 ways (text / dropped object / jsonb) |
| COUNTRY-CTRL | Fields | Low | Country is a controlled dropdown in core, free text in SM26 |
| IDENTITY-DUP | Fields | Low | Name/title/email duplicated across `profiles`/`sm_registration`/`sm_attendee` |
| TERMS-TS | Fields | Low | Core records no terms-acceptance timestamp; SM26 does |
| PHONE | Fields | Low | Phone captured by SM26, never by core |
| PERSONA-LABEL | Persona | Low | Account header shows blank label/no icon for developer/investor/individual |
| PROV-NO-DEV | Persona | Low | Provision persona dropdown omits `developer` though the edge fn accepts it |
| UNDER-REVIEW-ENUM | Status | Low | `onboarding_status='under_review'` never written; `payment_pending` renders no badge |
| PW-POLICY | UX | Low | Password strength differs between `SignupForm` and `WelcomePage` for the same account |
| SAVE-DRAFT | UX | Low | "Save & continue later" offered only to guests, not logged-in members |
| CLAIM-SILENT-JOIN | Status | Low | A second claim-code user joins silently as collaborator; owner never notified |

---

## 2. Entry-point map

Every core account originates from a single `auth.users` insert; the `handle_new_user` trigger (SECURITY DEFINER) synchronously creates the `profiles` row (persona from `raw_user_meta_data->>'persona'`, else `individual`; hardcoded `access_status='pending'`, `onboarding_status='draft'`). Org/membership/verification happen afterward on `/onboarding`.

### Core (non-SM26) entry points

| # | Entry point | Auth/edge/RPC | Tables written | Persona | access/onboarding | Cross-system link |
|---|---|---|---|---|---|---|
| 1 | `/become-partner` → `SignupForm` → `AuthContext.signUp` (`src/contexts/AuthContext.tsx:347`) | `auth.signUp` (metadata persona default `marina`) → `handle_new_user` | `profiles` | metadata / `individual` | `pending`/`draft` | writes `detected_org_id` metadata (never read — DETECTED-ORG) |
| 2 | `/onboarding` persona fallback → `handlePersonaSelect` (`OnboardingPage.tsx:538`, insert `:542`) | direct `profiles.insert` | `profiles` | marina/partner/media only | `pending`/`draft` | none |
| 3 | `/onboarding` invitation → `handleAcceptInvitation` (`OnboardingPage.tsx:360`) | `accept_org_invitation(p_invitation_id)` | `organization_invitations`, `organization_members` | unchanged | verified/`completed` if org verified, else `submitted` | dedicated `/join/:token` redirect target (`AuthContext.tsx:352-353`), distinct from `/onboarding` |
| 4 | `/onboarding` join-request → `handleRequestJoinOrg` (`OnboardingPage.tsx:404`) | `request_org_join(p_organization_id)` | `organization_invitations` [+members in dead auto-approve branch] | unchanged | `submitted` | branch unreachable (DOM-DEAD) |
| 5 | `/onboarding` claim code → `handleClaimOrg`/auto-claim (`OnboardingPage.tsx:557`, `:190`) | `claim_organization(p_claim_code)` | `organization_members`, `organizations.owner_user_id` | org type (only if org verified) | verified/`completed` only if org verified | this is the SM26 pre-created-org join path |
| 6 | `/onboarding` create-org → `handleSubmit` (`OnboardingPage.tsx:599`) | `create_organization(...)` (`p_name,p_organization_type,p_primary_domain,p_website,p_description,p_country,p_city`) + direct writes | `organizations`, `organization_members`, `organization_marina_details`, sector/future-plans tables, `profiles` | unchanged | `submitted` (or `completed` if creator already verified) | none — creates a parallel org even if SM26 already has one |
| 7 | Admin "Create admin" → `AdminUsers.tsx:257` → `create-admin-user` | `auth.admin.createUser` + `profiles.update` | `profiles` | `admin` | `verified`/`completed` | ADMIN-SLEEP |
| 8 | `create-demo-user` (orphaned) | `auth.admin.createUser`, no persona, no auth guard | `profiles` | `individual` | `pending`/`draft` | DEMO-USER dead state |
| 9 | `claim-code-signup` (from `SignupForm.tsx:140`) | `auth.admin.createUser`, no membership write (`index.ts:108`) | `profiles` only | metadata | `pending`/`draft` | CLAIM-SIGNUP — membership only via client auto-claim |

### SM26 entry points

| Entry point | auth/profiles | organizations | `sm_registration.status` | `sm_role_assignment` | Role tables | Link to core |
|---|---|---|---|---|---|---|
| Guest `/sm26/register` → `sm26-register` | created now: `individual`, `pw_pending`, pending (`index.ts:242`; trigger seeds profile) | never | `submitted` (org_id NULL, `:283`) | `self_submitted`, org_id NULL for guests (`:310`) | sm_startup_profile / sm_architecture_entry / sm_marina_extra | new core account created immediately |
| Member `/sm26/register` (client insert) | reused | reused (link) | `submitted` (`SM26RegisterPage.tsx:428`) | `self_submitted`, org_id set for org scope (`:477`) | same three | reuses existing core identity |
| `sm26-import` (admin CSV) | link-only or none (`claim_code`, `index.ts:89`) | never | `submitted`, `source='jotform_import'` (`:92`) | `self_submitted` (`:115`) | sm_startup_profile / sm_marina_extra only | links by email; provisioning deferred |
| `sm26-provision` (confirm) | created/linked, persona set, forced `verified` (`index.ts:135`) | **create/link/none** (`:151`) — only SM26 path that creates an org | (unchanged) | org_id back-filled for scope='org' (`:187`) | none | back-fills `user_id`/`organization_id` |
| `guest-webinar-register` (CORE, **not SM26**) | none (`user_id` NULL) | never | writes core `event_registrations`, `registration_type='guest'` (`index.ts:239`) | n/a | n/a | architecturally unrelated to `sm_*`; invoked from `LightweightWebinarSignup.tsx:50` |

No entry point writes `sm_payment` or `sm_attendee` at registration; fees flow through `create-payment` later and the attendee roster is built in the participant hub.

---

## 3. Persona & field comparison

`persona_enum = {marina, partner, media_partner, moderator, individual, admin, developer, investor}`. Developer and investor are first-class picker cards (`SignupForm.tsx:94-95`) but **silently reuse the partner form** in onboarding (`OnboardingPage.tsx:339-344, 684-724`), differing only in `organization_type` and which sector link table is filled — no developer/investor-specific fields are ever collected (**DEV-INV-FORM**).

### Field-comparison table

| Real-world field | Core form + table.column | SM26 form/role + table.column | Disparity |
|---|---|---|---|
| First / last name | `SignupForm` (`SignupForm.tsx:241,245`) → `profiles.first_name/last_name` | "Your details" (`SM26RegisterPage.tsx:662-663`) → `sm_registration.first_name/last_name` (+ `sm_attendee.*`) | Same field, 3 table homes; guest name never back-fills `profiles` (**IDENTITY-DUP**) |
| Job title | `SignupForm.tsx:250` → `profiles.job_title` | `SM26RegisterPage.tsx:683` → `sm_registration.job_title` (+ `sm_attendee`) | Stored in two places, not synced |
| Phone | not collected | `SM26RegisterPage.tsx:665` → `sm_registration.phone` | **PHONE** — SM26-only |
| Company / org name | `SignupForm.tsx:260` + onboarding → `organizations.name` via `create_organization(p_name)` | `SM26RegisterPage.tsx:668` → `sm_registration.company_name` | Asked in both; SM26→org copies only the name at provision (`sm26-provision/index.ts:145`) |
| Website | `SignupForm` + onboarding → `organizations.website` (`create_organization` p_website) | `SM26RegisterPage.tsx:681` → `sm_registration.website` | Provision creates org with `website:null` (`sm26-provision/index.ts:155`) → SM26 website discarded (**PROV-DISCARD**) |
| Country | Marina dropdown (`OnboardingPage.tsx:1087`) → `organizations.country`; Partner → `organizations.headquarters_country` (also `country` via RPC — same value lands in *both* columns) | Free-text input (`SM26RegisterPage.tsx:682`) → `sm_registration.country` | Dropdown (canonical, 57 values) vs uncontrolled free text (**COUNTRY-CTRL**); country never copied at provision |
| City | `OnboardingPage.tsx:1094` → `organizations.city` | not collected | Core-only |
| Company description | `organizations.description` + `organization_marina_details.marina_description/services_description` | Startup: `sm_startup_profile.*`; Arch: `sm_architecture_entry.company_description`; Marina: none | No mapping between the many homes |
| Marina type / berths / facilities / certifications | `organization_marina_details.marina_type/berths_count/superyacht_berths/longest_berth_meters/has_*/certifications[]` (`OnboardingPage.tsx:643-664`) | not collected — `MarinaFields.tsx:5-8` assumes "core supplies them" | **MARINA-DATA** — guest-provisioned marina orgs get none of it |
| Sustainability narrative | not collected | `MarinaFields.tsx:26-34` → `sm_marina_extra.biodiversity/water/energy/…` | SM26-only |
| Industry sector / category | `sectors` table (17 rows) → `organization_interest_sectors`/`organization_service_sectors` (FK) | Startup: 11 hardcoded strings (`StartupFields.tsx:41-53`) → `sm_startup_profile.categories` (text ARRAY, no FK) | **TAXONOMY** — two incompatible taxonomies, cannot be joined |
| Social media links | Marina: single text → `organizations.social_media_links`; Partner/Media: 4-field object collected (`OnboardingPage.tsx:1332-1344,1400-1412`) but **never persisted** | Structured jsonb `{linkedin,instagram,facebook,twitter}` → `module_data.social_links` / `sm_startup_profile.social_links` / `sm_architecture_entry.social_links` | **SOCIAL-DROP** + **SOCIAL-SHAPE** — three formats, one dropped |
| Investment thesis / ticket / stage | `organizations.investment_thesis/investment_size_min/max/geographies/hold_period` exist but investor onboarding reuses partner form and writes **none** | Investor: `module_data.thesis/ticket/investor_type/categories_interest`; Startup: `sm_startup_profile.investment_stage/type/funds_needed` | **INVESTOR-COLS** — dedicated columns unused by either intake |
| Image/featuring consent | not collected | `sm_registration.image_consent` + `module_data.ecat_consent/social_consent` | SM26-only (GDPR) |
| Terms acceptance | `acceptTerms` checkbox gate only (`SignupForm.tsx:319`), no timestamp | `sm_registration.terms_accepted_at` (timestamptz) | **TERMS-TS** — asymmetric auditability |

---

## 4. Core ↔ SM26 linkage

There is **no FK-enforced identity bridge**. SM26 rows link to core through two nullable columns on `sm_registration` and `sm_role_assignment` — `user_id` (→ `auth.users`/`profiles`) and `organization_id` (→ `organizations`) — back-filled opportunistically, mostly by **case-insensitive email match** and **whitespace-normalized company/org name match**. (Note: the RPC names in the audit brief were wrong — the real names are below.)

Linkage artifacts (all grounded in DB via `pg_get_functiondef`, project `djjbgzasuomhyfvtlidi`):

1. **`sm_autoclaim_by_email()`** (SECURITY DEFINER) — claims unclaimed `sm_registration` rows where email matches `auth.uid()`'s email, then sets `organization_id` when the caller's org name matches `company_name` (or company blank and user in exactly one org). Called best-effort client-side at `SM26ParticipationCard.tsx:58`, `SM26RegisterPage.tsx:162`, `SM26MyRegistrationPage.tsx:146`. (Brief's `sm26_autoclaim_by_email` does not exist.)
2. **`sm_claim_registration(p_code text)`** — code-based claim, throttled (10 fails/15 min via `sm_claim_attempt`); sets `user_id=auth.uid()` and mirrors the org-interconnect logic of #1. Called at `SM26ClaimPage.tsx:31`. (Brief's `sm26_claim_links_organization` does not exist; org-linking is embedded here.)
3. **`sm_link_registration_to_account(p_registration_id uuid)`** (staff-only) — admin/manual linkage matching `sm_registration.email` → `profiles.email`. Called at `AdminSM26.tsx:296`.
4. **`sm_attendee_link_user()`** (BEFORE trigger) — populates `sm_attendee.user_id` from `profiles.email`.
5. **`sm_link_primary_attendee()`** (trigger) — propagates `sm_registration.user_id` to the primary `sm_attendee` row.
6. **`sm_org_name_match(p_name text)`** — the one genuine Core→SM26 crossover, called from **core** onboarding at `OnboardingPage.tsx:160` to find an existing organization by normalized name. Confirms both systems share `organizations` for name dedupe. (citation to confirm for its use elsewhere — it is *not* consulted by `sm26-provision`, see PROV-DUP-ORG.)
7. **`sm_user_id_by_email` / `sm_account_status_for_email`** — auth/profile lookups supporting provisioning decisions.
8. **`sp_link_from_sm26(p_registration_id uuid)`** (sponsorship-manager-only) — a **third** linkage target bridging `sm_registration` into the sponsorship system (`sp_sponsor`, `organizations.featured_partner/organization_type`, `sp_sponsor_user`) — an additional Core↔SM26↔sponsorship coupling (**SPONSOR-LINK**).

**Individual → marina upgrade path:** there is none that is automatic. A guest provisioned as `individual` is only "upgraded" when an admin runs `sm26-provision` and picks an org-capable persona, which force-writes `persona` + `verified` and creates/links an org (**PROV-VERIFY-BYPASS**, **PROV-DUP-ORG**). Self-service, an `individual` reaching `/onboarding` gets no persona prefill branch and no matching `handleSubmit` branch, yet lines `758-761` still mark them `submitted`/`completed` with no org (**INDIVIDUAL-STRANDED**).

**Existing verified core user hits `/sm26/register`:** if logged in, the member path reuses their identity and writes no new account/org (correct). If they register as a guest (logged out) with the same email, `sm26-register` returns the anti-enumeration `ok` and — where an auth user exists — can create a second `sm_registration` that later fails to auto-link (**IMPORT-COLLISION** / **PW-PENDING-STRAND**). If an admin later provisions that registration against the existing profile, `sm26-provision` **overwrites** the verified core identity down to `individual`/re-`verified` (**PROV-VERIFY-BYPASS**).

Assessment (confidence: medium — this dimension was un-investigated; findings are the verifier's grounded reconstruction): the email-string match has no uniqueness/FK guarantee (duplicate profiles/emails could mislink — **SOFT-MATCH**); org auto-link heuristics can silently attach a registration to an org; and the three parallel entry points (self autoclaim, code claim, admin link) must stay behaviorally consistent (**THREE-LINK-PATHS**).

---

## 5. Duplicate-entry & re-verification

- **PROV-DUP-ORG (High).** `SM26ProvisionDialog.suggestProvision` (`:53`) returns `orgMode='create'` whenever a company name is present and no `organization_id` — it never calls `sm_org_name_match`. `sm26-provision` create mode (`index.ts:149-165`) dedupes only on slug collision (23505 → random suffix), so a second `organizations` row with the same name and a different slug is minted alongside a pre-existing claim-code org. Core onboarding, by contrast, *does* run `sm_org_name_match` (`OnboardingPage.tsx:156-165`, warning banner `:1017-1034`). Note there are three separate admin org-link surfaces doing their own free-text search (`SM26ProvisionDialog.tsx:136-140` link mode, plus standalone `SM26CompanyLink`), none sharing a single reconciliation primitive.
- **IMPORT-COLLISION (High).** `sm26-import` dedupes on `(email, source='jotform_import')` (`index.ts:87`); `sm26-register` dedupes on `(event_id, user_id)` (`index.ts:279`). The unique index `sm_registration_event_user_uq` is partial (`WHERE user_id IS NOT NULL`). Path A: an unclaimed import row (`user_id NULL` + `claim_code`) does not block a later guest self-registration → two live rows; `sm_autoclaim_by_email`'s `not exists(r2 … user_id=v_uid)` guard then refuses to adopt the orphan. Reinforcing detail: `sm26-register` never sets `source`, so self rows fall to the default and evade `sm_registration_event_email_import_uq`. Path B (self then import): the import insert violates `sm_registration_event_user_uq` → 23505 caught by the generic try/catch (`index.ts:139`) and surfaced as a vague `errors[]` entry.
- **SM26 self-register + claim never merge into pre-created claim-code orgs.** `sm26-register` inserts `organization_id:null` (`:288`) and stores only `company_name` text; `sm_claim_registration`/`sm_autoclaim_by_email` only *link* when the user is already a member of a name-matching org, never attach to an unclaimed claim-code org. `sm26-register` also inserts child `sm_marina` detail rows with `organization_id:null` (`index.ts:350`), extending the null-org problem beyond `sm_registration`. Convergence otherwise requires the manual `SM26CompanyLink` control (**deliberate** — provision-at-confirm; confidence: medium).
- **REF-GATE-DISJOINT (Med, deliberate).** Core partner standing requires 2 confirmed references (`confirm_reference_by_token`) or admin bypass. SM26 consoles are gated by `sm_is_event_partner` (`kind='yacht_club'`) and `sm_is_yv` (`sm_is_staff() OR kind='yachting_ventures'`) — neither consults references. `sm_event_partner` is read in 7 places (`sm26-assets/index.ts:103` et al.) but inserted nowhere in the repo → grants are hand-applied out-of-band. Document the gate; do not wire references into it.
- **PROV-VERIFY-BYPASS (High).** `sm26-provision` writes `persona` (default `individual`, `:90`) + `access_status='verified'` + `onboarding_status='completed'` for any non-staff target (`:134-137`) with no reference/bypass check, and the org it creates is `access_status:'verified'` (`:153`). On an email that already has a core account it *overwrites* the existing profile — a mid-onboarding `partner` can be demoted to `individual` and force-verified. The `prevent_profile_privilege_escalation` trigger only reverts when `current_user='authenticated'`, and its own comment states service-role/SECURITY-DEFINER writes are trusted — so **the defect is in `sm26-provision` guarding logic, not the trigger**. The fix must live in the function.
- **INVITE-SYSTEMS (Med, deliberate).** Core team membership flows through `organization_invitations` + `accept_org_invitation`. SM26 has no org-invite; `sm26-connection` (`index.ts:97`) is a networking *introduction* (emails both parties, stamps `sm_connection.introduced_at`), despite the name echoing core B2B invites. SM26 membership is instead derived via `sm_org_member_candidates(p_registration_id)` → `sm_attendee`. None touch `organization_invitations`, so core invites and SM26 attendees never reconcile.

---

## 6. Status-machine consistency

- **STATUS-INDEP (High).** Core `access_status {pending, verified, rejected, suspended, payment_pending}` + `onboarding_status {draft, submitted, under_review, completed}` vs SM26 `sm_registration.status {submitted, under_review, confirmed, waitlist, declined, cancelled}` (`AdminSM26.tsx:32`) and `sm_role_assignment.status {self_submitted, admin_added, needs_info, info_provided, confirmed, declined}` (`AdminSM26.tsx:101`) are three separate machines with no linking column. The only coupling: `sm26-provision` forces the profile `verified/completed` (`index.ts:134-139`) but leaves `sm_registration.status` untouched — confirming a registration and verifying the account are two independent admin actions (**deliberate** coupling gap). Live query (project `djjbgzasuomhyfvtlidi`, join on `user_id`) returns contradictory pairs, including `individual/verified/completed` with `sm_status=under_review` and `partner/pending/submitted` with `sm_status=under_review` — a person with full core access whose event registration is still under review.
- **ACCOUNT-TABS (Med).** `/account`'s always-visible header badge shows only core `access_status` (`getAccessBadge`, `AccountPage.tsx:506-520`, rendered `:680`); `SM26ParticipationCard` shows only SM26 status and only inside the Dashboard tab (`:786`), even hiding `declined` rows on the self view (`SM26ParticipationCard.tsx:81`). They can openly disagree with no linking text. `/sm26/me` shows only SM26 status.
- **INDIVIDUAL-STRANDED (Med).** SM26 guests are `individual`/`pending`/`draft` (`sm26-register/index.ts:249`); at `/account` they see "Pending" plus the draft banner "Your profile is incomplete. Complete your organization details to be validated" (`AccountPage.tsx:686-694`) — nonsensical for an org-less attendee — and the onboarding guards push them toward org creation. `resolveOrg` has no `individual` prefill branch and `handleSubmit` has no `individual` branch, yet still writes `onboarding_status` `submitted`/`completed`.
- **UNDER-REVIEW-ENUM (Low).** `onboarding_status_enum` defines `under_review`, never written by app code (only read/filtered in `AdminUsers.tsx:287,293,346,525`) — dead on the write path and semantically colliding with the SM26 registration stage of the same name. Separately `access_status='payment_pending'` has no branch in `getAccessBadge` (`AccountPage.tsx:506-519`) so it renders no badge.
- **CLAIM-SILENT-JOIN (Low).** `claim_organization` correctly rejects re-claims and only assigns owner when none exists; but a second user entering a still-valid code for an already-owned org is silently added as `collaborator` with no owner notification (unlike invitation/join-request flows).

---

## 7. Onboarding friction (ranked by likely impact)

1. **DOM-BLOCK (High).** `OnboardingPage.handleSubmit` passes the user's own email domain as `p_primary_domain` unconditionally (`:611-612`, used at `:625/:700/:735`); `create_organization` raises "Public email domains cannot be used as organization domain" when `is_public_email_domain` is true (`gmail.com`→true). A gmail/outlook user fills the entire long marina form and is thrown a cryptic error at the final click, org never created — directly contradicting `SignupForm.tsx:37` and the `OnboardingPage.tsx:607-610` comment. **Amplifier:** the check runs *before* the "creator already verified → auto-verify org" branch, so an M3-vetted / SM26-provisioned `verified` user with a personal address is thrown the same exception, defeating the `alreadyVerified` design (`OnboardingPage.tsx:98-102, 755-761`).
2. **DOM-UNIQUE (High).** A UNIQUE index `organizations_primary_domain_key` on `organizations.primary_domain` is a *second* last-submit crash surface: a corporate-email user (so DOM-BLOCK's raise doesn't fire) whose domain matches an existing org's `primary_domain` still crashes on the `create_organization` INSERT with a duplicate-key violation — another maximum-sunk-cost dead end. It also means the `OnboardingPage.tsx:607-610` "domain is still stored for reference … no longer used to block" comment is a code/DB disconnect: the app dropped its guard but the DB still hard-blocks two orgs sharing a domain.
3. **MARINA-FORM (Med).** The marina branch renders 4 stacked cards in one `<form>` with a single submit (`OnboardingPage.tsx:1071-1281`, submit `:1421`), ~30 inputs incl. a 17-row future-plans grid (`:1256-1275`), but only 4 required (`:615`). No progress indicator, no per-section save, no server-side draft (unlike SM26's `saveDraft`/resume, `SM26RegisterPage.tsx:249`). Country (Select) and marina_type (RadioGroup) lack native `required`, surfacing only via a post-scroll toast.
4. **SM26-PLATFORM-HIDDEN (Med).** The guest CTA says "No account needed — we'll create your workspace…" (`SM26RegisterPage.tsx:809`) while `sm26-register` provisions a real `profiles` account and `WelcomePage` then brands it "Your Smart Marina Connect account is ready" (`WelcomePage.tsx:128`). (Line `810` does mention SMC, but only in the "already have an account?" branch — the "we're creating one" framing is still absent; confidence: medium.)
5. **TWO-DOORS (Med).** `/become-partner` is 100% platform-framed with zero SM26 reference (`BecomePartnerPage.tsx:53`, routes to `/onboarding` at `:168`), funneling event-only users into heavy org onboarding; `/sm26/register` never points platform-seekers back. Persona vocabularies differ (5 vs 11) with no bridge.
6. **PW-PENDING-STRAND (Med).** `pw_pending` guests get one magic-link email (`sm26-register/index.ts:371`); `sm26-reminders` targets only `status='confirmed'` (`index.ts:126`), and `/welcome` routing only fires *after* login (`AuthRedirector.tsx:56`). No resend, no cleanup, no admin surfacing. Second silent-stranding path: the anti-enumeration branch returns `{status:"ok"}` when an auth user exists without a profile (`index.ts:272`) *without* writing any registration.
7. **PW-POLICY (Low).** Core enforces ≥8 + uppercase + symbol (`SignupForm.tsx:32-34`); SM26's `WelcomePage` checks only length ≥ 8 (`:36`) for the same auth account.
8. **SAVE-DRAFT (Low).** "Save & continue later" (server draft via `sm26-draft`) is gated to `{!user}` (`SM26RegisterPage.tsx:818`); logged-in members get only localStorage autosave (`:243`) — the higher-value user gets the weaker save story.
9. **PERSONA-FALLBACK (Low).** The onboarding fallback picker offers only marina/partner/media (`OnboardingPage.tsx:74-78`); a signup-time developer/investor hitting it is forced into one of three.

---

## 8. Other gaps

- **DOM-DEAD (High).** `resolveOrg` removed the domain-match step (`OnboardingPage.tsx:328-331`); `detectedOrg` is set only in the pre-existing `join_requested` branch (`:319-324`) which never sets `auto_approve`, making the auto-approve branch (`:409-453`), the Join/Request UI (`:970-975`), `handleRequestJoinOrg`, and `handleJoinDetectedOrg` (`:494`) all unreachable. Meanwhile `request_org_join` and `can_domain_join` RPCs exist, `organizations.auto_approve_domain_joins` has an owner toggle (`OrganizationTab.tsx:781-786`, `:1794`) and admin read-out (`AdminOrganizationDetail.tsx:474`), and CLAUDE.md still documents domain-match as onboarding step 2. Owners can toggle a setting no signup path consumes.
- **DETECTED-ORG (Med).** `SignupForm.checkDomain` detects an org by `primary_domain` and threads `detectedOrg?.id` → `signUp` → `detected_org_id` metadata (`AuthContext.tsx:361`), which `handle_new_user` never reads. The literal `detected_org_id` occurs once in the repo (the write site). A user signing up on an existing org's exact domain is never offered "join your team."
- **CLAIM-SIGNUP (High).** `claim-code-signup` creates the user (`index.ts:108`) and returns `organization_id` (`:141`) with no `organization_members` insert and no `claim_organization` call; membership depends entirely on `SignupForm.tsx:165` sign-in + the `OnboardingPage.tsx:190-212` auto-claim effect, whose failure is swallowed with `console.warn` (`:206-208`). Sign-in/RPC failure or a closed tab leaves a confirmed account at pending/draft with no membership.
- **CLAIM-UNVERIFIED (Med).** In `claim_organization`, membership is always inserted, but the persona + `verified/completed` updates are gated on `IF v_org.access_status='verified'` with no else branch — claiming an unverified org leaves the claimer at pending/draft with a membership but no review-queue transition.
- **INVITE-EXPIRY (Med).** `organization_invitations.expires_at` defaults to `now()+30 days` (NOT NULL) but `accept_org_invitation` guards only `status='pending'` and `check_pending_invitation` returns pending rows with no expiry filter — a 30-day-stale invite is still acceptable and still surfaces as pending. No cron/trigger marks invites expired.
- **VALIDATION-CLIENT (Med).** Company/country are required for org roles only client-side (`SM26RegisterPage.tsx:404-408`); `sm26-register` validates only email+name+role+terms (`index.ts:227-229`) and `sm_registration.company_name/country` are nullable with no CHECK — a direct POST (the fn is `verify_jwt=false`) creates incomplete e-catalogue/badge/invoice records. Likewise role/scope are unvalidated server-side: role accepted as any non-empty string, scope derived from client payload (`index.ts:215-216`), no CHECK on `sm_role_assignment.role`.
- **DEMO-USER (Med).** `create-demo-user` has no auth guard (contrast `create-admin-user/index.ts:51`) and sets no persona, yielding an `individual` with no onboarding branch and (because a profile exists) a skipped persona picker — a core dead state. Orphaned in `src`.
- **MULTI-ORG (Med).** `create_organization` raises "already a member" if *any* `organization_members` row exists, while `claim_organization`, `accept_org_invitation`, and `approve_join_request` allow additional memberships — inconsistent with CLAUDE.md's "a user can belong to multiple organizations."
- **IMPORT-ROLES (Med).** `sm26-import`'s PARTICIPATE map covers 5 Jotform labels → 6 roles; the other 5 self-select roles (architect_pro/architect_student/media/sponsor/vip) are coerced to `visitor` (`index.ts:106`), and the importer never writes `sm_architecture_entry` — architecture role data is lost on import.
- **JURY-INVESTOR (Med).** `PARTICIPATE['Jury member']=['jury','investor']` (`index.ts:37`) auto-creates an investor assignment ("Derived from jury registration", `:111`) — investor = portfolio/deal-flow access (`SM26RegisterPage.tsx:45`), an over-grant vs the human-decision onboarding model. Both land `self_submitted`, so full access requires later human confirmation (confidence: medium — interpretation against the onboarding-model memory, not a hard code guarantee).
- **NOTIF-OVERLAP (Med).** Verifying a dual-identity user via the core Users flow fires `user_account_approved` → `/account` (`send-notification`; triggered from `AdminUserDetail.tsx:236`), while SM26 sends welcome → `/welcome` (`sm26-provision/index.ts:194`) and `confirmed` → `/sm26/me` (`sm26-email/index.ts:67`). Both are legitimate "you're approved" mails with divergent CTAs; neither suppresses the other, and `sm26-provision`'s force-verify emits no core notification.
- **PERSONA-WRITERS / INDIVIDUAL-DEFAULT / ADMIN-SLEEP / PROV-NO-DEV / PERSONA-LABEL (Low).** Persona is written by four uncoordinated writers (`handle_new_user`, `handlePersonaSelect` `:542`, `claim_organization`, `create-admin-user/index.ts:91`). `handle_new_user` coalesces blank persona to the event-only `individual` and `ON CONFLICT` keeps it sticky. `create-admin-user` relies on a 1s sleep (`:87`) and a non-fatal profile update (`:100`) — a failed update leaves a non-functional `admin` stuck pending (`isAdmin` requires verified, `AuthContext.tsx:60`). `PROVISION_PERSONAS` omits `developer` though the edge fn accepts it (`sm26-provision/index.ts:27`). `getPersonaLabel/getPersonaIcon` return blank/null for developer/investor/individual (`AccountPage.tsx:522-540`), and the onboarding description ternary (`OnboardingPage.tsx:1012`) falls through to Media for developer/investor.

---

## 9. Recommendations

One concrete minimal fix per finding. Ordered quick wins → structural, favoring changes that make the two systems read as one continuous identity.

### Tier 1 — quick wins (small, localized, high leverage)
1. **DOM-BLOCK** — In `handleSubmit`, pass `p_primary_domain` only when the domain is corporate (mirror `is_public_email_domain` client-side; pass `null` otherwise) so the final submit never rejects.
2. **DOM-UNIQUE** — Before the `create_organization` INSERT, look up any org sharing the domain and either offer it as a "join your team" org or pass `null`; treat the `organizations_primary_domain_key` violation as a "possible duplicate" handoff, not a crash. Fix the misleading `:607-610` comment.
3. **PROV-DISCARD** — In `sm26-provision` org-create, populate `organizations.website`/`country` from `reg.website`/`reg.country` instead of `website:null`.
4. **INDIVIDUAL-STRANDED** — Treat `persona='individual'` as a terminal core state: suppress the draft banner (`AccountPage.tsx:686`) and the org-creation guard for individuals.
5. **PERSONA-FALLBACK / PROV-NO-DEV / PERSONA-LABEL** — Add developer + investor to `personaCards` and `PROVISION_PERSONAS`, and add developer/investor/individual cases to `getPersonaLabel`/`getPersonaIcon` and the onboarding description switch.
6. **VALIDATION-CLIENT** — In `sm26-register`, reject org roles with blank company/country and validate `role` against an explicit allowlist, deriving `scope` from the role; optionally add a CHECK on `sm_role_assignment.role`.
7. **INVITE-EXPIRY** — Add `AND expires_at > now()` to `check_pending_invitation` and raise "Invitation has expired" in `accept_org_invitation`.
8. **CLAIM-UNVERIFIED** — Add an else branch in `claim_organization` setting `onboarding_status='submitted'` when the claimed org is not verified.
9. **UNDER-REVIEW-ENUM / PW-POLICY** — Add a `payment_pending` case to `getAccessBadge`; either use or drop `onboarding_status='under_review'`; share one password validator between `SignupForm` and `WelcomePage`.
10. **DEMO-USER / ADMIN-SLEEP** — Add an `is_moderator` guard (or remove `create-demo-user`) and set an explicit persona; in `create-admin-user`, return non-200 on the profile-update failure and drop the sleep.

### Tier 2 — identity continuity (make the two systems feel like one)
11. **PROV-DUP-ORG** — In `suggestProvision`/`sm26-provision`, call `sm_org_name_match(company_name)` and default to `link` (or surface a duplicate warning) before allowing Create.
12. **IMPORT-COLLISION** — In `sm26-import`, look up any existing `sm_registration` for `(event_id, lower(email))` regardless of source and link/skip; treat the `sm_registration_event_user_uq` 23505 as "already registered." Set `source` explicitly on `sm26-register` self rows.
13. **STATUS-INDEP / ACCOUNT-TABS** — Surface SM26 registration/role status inside `/account` (e.g. a registrations tab reading `sm_registration`) and the core account status inside the SM26 card, and document the intended mapping (reg `confirmed` ⇒ ensure core verified) with a reconciliation flag in `AdminSM26`.
14. **PROV-VERIFY-BYPASS** — When linking to a pre-existing profile, do not downgrade persona or force `access_status`; only elevate when currently unset/pending and the chosen persona matches, else raise a "core account already exists" conflict (as already done for the auth-user-without-profile case).
15. **DETECTED-ORG / DOM-DEAD** — Either restore a domain-match "join your team" card in `resolveOrg` (consuming `detected_org_id` / `auto_approve_domain_joins`) or retire the toggle, `request_org_join`, `can_domain_join`, `detected_org_id`, and the dead handlers so the UI stops promising an unrunnable feature.
16. **CLAIM-SIGNUP** — Have `claim-code-signup` perform the membership insert and persona/status resolution server-side (service role) atomically, instead of a best-effort client RPC.
17. **PW-PENDING-STRAND** — Add a reminder kind (or cron) targeting `status='submitted'` rows whose auth user still has `pw_pending=true`, re-issue the magic link after N days, and surface the count to admins; also write a registration in the anti-enumeration no-profile branch.
18. **NOTIF-OVERLAP** — Gate core account/verification notifications for `persona='individual'` accounts, or have `sm26-provision` set a flag the core notifier checks, so each account gets exactly one "approved/ready" email with one CTA.
19. **TWO-DOORS / SM26-PLATFORM-HIDDEN** — Cross-link the doors (a "Here for the Sep 2026 Rendezvous?" banner on `/become-partner`, a "Looking for year-round membership?" link on `/sm26/register`) and add one line to the guest note stating a free SMC account is created.

### Tier 3 — data model & taxonomy (shared shapes)
20. **TAXONOMY** — Map `SM_CATEGORIES` to `sectors` rows and store `sm_startup_profile.categories` as sector FKs so both systems share one taxonomy.
21. **SOCIAL-DROP / SOCIAL-SHAPE** — Persist partner/media social links in the partner/media submit branches, and standardize on one structured jsonb shape across `organizations` and `sm_*`.
22. **COUNTRY-CTRL** — Reuse the shared `countries[]` list as a Select in `SM26RegisterPage`.
23. **INVESTOR-COLS** — Either drop the unused `organizations.investment_*` columns or add an investor-specific onboarding section that populates them, mapping SM26 investor `module_data` into the same columns.
24. **MARINA-DATA** — For SM26-only marina orgs, surface (or prompt post-provision for) the core `organization_marina_details` fields so the `MarinaFields` assumption holds.
25. **IDENTITY-DUP / PROV-NO-CITY, etc.** — Treat `profiles` as source of truth for logged-in registrants and reference it rather than storing independent name/title/email copies.
26. **DEV-INV-FORM** — Add a short investor/developer field set, or fold them into partner sub-types so captured data matches the promised differentiation.
27. **PERSONA-WRITERS / INDIVIDUAL-DEFAULT** — Centralize persona resolution in one RPC/trigger so downstream steps refine a single documented value; make callers always send an explicit persona.
28. **MULTI-ORG** — Decide the multi-org policy once and apply it uniformly (if multi-org is intended, scope or drop the blanket guard in `create_organization`).
29. **MARINA-FORM / SAVE-DRAFT** — Make the long marina facility/sector/future-plans sections a collapsible optional block (or save-as-you-go), and offer the `sm26-draft` save/resume link to logged-in members.

### Tier 4 — document-and-decide (deliberate splits, mostly non-code)
30. **REF-GATE-DISJOINT** — Document that `sm_event_partner` membership is the sole SM26-console gate and is manually provisioned.
31. **INVITE-SYSTEMS** — Rename `sm26-connection` to reflect "introduction," and if desired have `sm_org_member_candidates`/`sm_attendee` reuse `organization_members` as the single team-membership source.
32. **PERSONA-MULTIROLE** — Surface SM26 roles alongside the core persona on the profile rather than relying on persona alone.
33. **GUEST-ORG-NULL** — Accept as inherent to provision-at-confirm; ensure consumers of `sm_role_assignment` tolerate `organization_id=NULL` until confirm.
34. **JURY-INVESTOR / IMPORT-ROLES** — Import jury only as `jury` (let admins add investor at confirm), and extend PARTICIPATE (+ an `sm_architecture_entry` branch) before importing any architect/media/sponsor batch, else document those roles as self-register-only.
35. **CLAIM-SILENT-JOIN** — Optionally emit an owner notification (or require approval) when a claim code is used on an already-owned org.
36. **SPONSOR-LINK / SOFT-MATCH / THREE-LINK-PATHS** — Consolidate email/name reconciliation behind a single primitive and add a uniqueness safeguard so the three claim paths and `sp_link_from_sm26` cannot mislink duplicate emails/orgs.

---

## 10. Product decisions — converging the two intakes (22 July 2026)

Decided after reading this audit. **These decisions supersede parts of §9**; every superseded item is named explicitly below. Nothing here is implemented yet.

### 10.1 Premise correction — who actually collects more

The starting assumption was that SM26 collects a richer company profile than core signup. That is only half true, and the other half changes the design:

| Dimension | Richer in **core** | Richer in **SM26** |
|---|---|---|
| Structural company facts | berths, superyacht berths, longest berth, marina type, facilities, certifications, city, expansion plans (`organization_marina_details`) | — |
| Sector referential | 17-row `sectors` table with real FKs | 11 hardcoded strings (`StartupFields.tsx:41-53`) |
| Narrative / storytelling | — | 8 open questions (`MarinaFields.tsx` `FIELDS`), company description, portfolio, references |
| Files | logo only, via a separate upload in `OrganizationTab` | logo, deck, product images, pitch media |
| Compliance | — | image / e-catalogue / social consents + `terms_accepted_at` |
| Misc | — | phone, structured jsonb social links |

Critically, `MarinaFields.tsx:5-8` documents the omission as **deliberate**: *"Core marina facts (berths, facilities) come from the organisation profile; this captures the SM26 sustainability/architecture narrative."* SM26 **assumes core already holds the structural facts**. Moving the SM26 questionnaire wholesale into signup would therefore *lose* structural data and break SM26's own stated assumption.

Data at 22 Jul 2026: 17 sectors; 100 orgs with an `organization_marina_details` row, of which 55 have berth data; 28 interest-sector links; 55 service-sector links.

### 10.2 Decisions

**D1 — Enriched signup, adopting SM26's depth.** Core signup takes on the richer SM26-style questions rather than staying minimal. The progressive-profiling alternative was explicitly **rejected**.

> **Assumed risk + mandatory mitigation.** §7 already ranks `MARINA-FORM` as a drop-off risk (~30 inputs, one submit, only 4 required). Enriching it makes that worse **unless** the added fields are **optional and non-blocking**, the form is **staged into steps**, and **save-and-resume** exists. D4.2 makes non-blocking the explicit rule. Ship D1 *together with* §9.29 — not after it.

**D2 — Two sector taxonomies + a mapping table.** Core keeps its 17-row `sectors` referential; SM26 keeps its 11 categories; a correspondence table joins them. **Supersedes §9.20**, which proposed collapsing SM26 onto `sectors` FKs.

> Consequence: any cross-system query (matchmaking, directory filters, reporting) must route through the mapping table, and an unmapped category must fail loudly rather than silently drop a company from results.

**D3 — SM26 → organization write-back, fill-missing only.** Company data captured in SM26 (website, country, logo, social links, description…) populates the organization profile **when that org field is empty**, and **never overwrites** a value the client already provided. **Generalises §9.3 (`PROV-DISCARD`)** from website/country to the whole overlapping field set.

**D4 — Marina facts: role-scoped, optional, and surfaced.**
1. **Role-scoped** — only the `marina` role is asked for structural marina facts. Innovations (startups) and architects are not.
2. **Never blocking** — if a marina does not fill them in SM26, the fields stay empty. No chasing, no reminder, no incomplete-profile gate.
3. **Surfaced on the org profile** — what *is* captured in SM26 must appear on the SMC organization profile and enrich it. This is a **display requirement**, not only storage.

> **Refines §9.24**, which proposed prompting post-provision to close the gap. The decision is instead to accept empty fields and make captured data visible.

### 10.3 Effect on existing findings

| Finding | §9 recommendation | Status after these decisions |
|---|---|---|
| `TAXONOMY` | §9.20 — one taxonomy, SM26 → `sectors` FK | **Superseded by D2** — two taxonomies + mapping table |
| `MARINA-DATA` | §9.24 — prompt post-provision | **Refined by D4** — marina role only, optional, must surface on the org profile |
| `PROV-DISCARD` | §9.3 — copy website/country at provisioning | **Generalised by D3** — fill-missing write-back across all overlapping fields |
| `MARINA-FORM` / `SAVE-DRAFT` | §9.29 — optional/collapsible + save-resume | **Promoted from Tier 3 to a prerequisite of D1** |
| `SOCIAL-DROP` / `SOCIAL-SHAPE` | §9.21 — persist + one jsonb shape | **Unchanged, reinforced** — D3 needs a single shape to write into |
| `COUNTRY-CTRL` | §9.22 — shared country Select in SM26 | **Unchanged, now a prerequisite of D3** — free text cannot fill a controlled column |
| `IDENTITY-DUP` | §9.25 — `profiles` as source of truth | **Unchanged** |
| `PHONE`, `TERMS-TS` | — | **Pulled into D1** — enriched signup gains phone and a terms timestamp |
| `INVESTOR-COLS`, `DEV-INV-FORM` | §9.23, §9.26 | **Unchanged** — not covered by these decisions |

### 10.4 Prefill — the second requirement

Whether a company arrives via SM26 or via the platform, known data must be **prefilled in both directions**:

- an already-verified org registering for SM26 sees its organization profile prefilled instead of a blank form (today it fills a wholly separate form — see §4);
- a person who registered for the event first and then completes core onboarding sees their `sm_registration` answers prefilled.

Prefill is a **read** of the canonical profile; **D3 governs the write back**. The two must not be conflated: prefilling a field must never silently overwrite the canonical value (D3 = fill-missing only).

### 10.5 Still open

- The field-level list of what actually moves into the enriched signup, per persona (marina / partner / media_partner / developer / investor).
- The content of the D2 mapping table (which of the 11 SM26 categories map to which of the 17 `sectors`, and the handling of unmapped ones).
- Where SM26 narrative appears on the org profile — public profile, private profile, or both. D4.3 requires visibility but not the location.
- Whether enriched signup ships for all personas at once or starts with `marina` only.
