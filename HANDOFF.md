# Smart Marina Connect — Developer Handoff

> Last updated: 2026-05-13.
> Read this **plus `CLAUDE.md`** to get full context. CLAUDE.md has the platform overview; this file has session state, recent work, and open items.

---

## 1. Project at a Glance

| | |
|---|---|
| **Live URL** | https://smartmarinaconnect.com |
| **Hosted on** | Netlify (auto-deploys from GitHub `main`) |
| **Repo** | https://github.com/sebastiensanchez83-stack/M3_Connect (branch: `main`) |
| **Supabase project** | `djjbgzasuomhyfvtlidi` |
| **Supabase URL** | https://djjbgzasuomhyfvtlidi.supabase.co |
| **Email provider** | Resend (via `send-notification` edge function) |
| **Stack** | React 18 + TS + Vite + Supabase + Tailwind + Radix UI |
| **i18n** | English + French (i18next) |
| **Local path (new Windows machine)** | `C:\Users\Victor\M3 Dropbox\Victor Meyer\MONACO MARINA MANAGEMENT\9 M3 Connect\Dev plateform\M3_Connect` |
| **Git Bash path** | `/c/Users/Victor/M3 Dropbox/Victor Meyer/MONACO MARINA MANAGEMENT/9 M3 Connect/Dev plateform/M3_Connect` |

### Admin accounts
- `sebastien@m3monaco.com` (admin)
- `victor@m3monaco.com` (admin)

### Demo marina (for presentations)
- Email: `demo.marina@smartmarinaconnect.com`
- Password: `DemoMarina2026`
- Org: Marina di Porto Azzurro (Portofino, Italy) — fully filled profile

---

## 2. Setting Up the New Computer

```bash
# 1. Make sure Dropbox finishes syncing the project folder (green checkmark on tray icon)

# 2. cd into the project root (Victor's machine path — wrap in double quotes due to spaces)
cd "/c/Users/Victor/M3 Dropbox/Victor Meyer/MONACO MARINA MANAGEMENT/9 M3 Connect/Dev plateform/M3_Connect"

# 4. Install dependencies (Dropbox is empty of node_modules by design)
npm install

# 5. Verify git is happy
git status
git pull   # should already be at the latest commit

# 6. Check Supabase auth (optional — only needed for local edge function deploys)
npx supabase login

# 7. Tools you'll want installed:
#    - Node 20+ and npm
#    - GitHub CLI (`gh`) authenticated
#    - VS Code or your editor of choice
#    - Claude Code CLI
```

### IMPORTANT — Build rules (Dropbox issue)
- **Never run `npm run build` locally.** Dropbox file-locking causes `EPERM` errors. Push to GitHub → Netlify builds automatically.
- **Never run `npm run dev` locally** for the same reason — or accept that hot-reload may flake. Use Netlify deploy previews to test, or quickly verify changes through the Supabase Dashboard for backend pieces.
- Edits to **edge functions** can be deployed directly via Supabase MCP from Claude Code without local Supabase CLI auth.

---

## 3. What Was Built in Recent Sessions (Reverse-Chronological)

### Session of 2026-05-13

Shipped as 7 commits to `main`:

1. ✅ **Marina recommendations are now optional** (commit `ee48316`)
   - Removed the 2-reference gate that blocked partner approval
   - Removed the post-signup "References" step from the Account onboarding checklist
   - References tab → renamed "Recommendations"; no more Required badge / amber banner / bypass flow
   - Confirmed recommendations still display publicly on `/organizations/:slug` ("Recommended by" section)
   - Admin can approve any partner regardless of reference count

2. ✅ **Cleanup of leftover bypass machinery** (commit `b11c379`)
   - `send-notification` edge function v18: drop `bypass_approved` / `bypass_rejected` templates and type union entries; rewrite `partner_onboarding_welcome` body to stop telling new partners they need marina references; refresh `reference_confirmed` / `reference_rejected` copy to match the new "optional feature" framing
   - Pruned dead notification types from `lib/notifications.ts`
   - Dropped `reference_bypass*` columns from `organizations` and the `reference_bypass_requests` table (migration `drop_reference_bypass_schema`)

3. ✅ **Sector matching tightened to a strict gate** (commit `9332187`)
   - Old behavior failed open when either side had no sectors → 83 of 84 marinas had zero sectors, so the gate was disabled for 99% of attempts
   - New rules: (a) the target org must have ≥1 team member; (b) for cross-type connections (interest-side ↔ service-side), both sides must have sectors configured and at least one must overlap
   - Toast title now says "Connection blocked" with a specific reason

4. ✅ **Fix: entitlements `ON CONFLICT` bug** (migration only — no code commit)
   - Admin UI upserts entitlements with `onConflict: 'organization_id,feature_key'` but the table only had a unique on `(user_id, feature_key)` → Postgres raised "no unique or exclusion constraint matching" every time
   - Migration `fix_entitlements_unique_constraint`: drop the wrong constraint, add `uq_entitlement_org` on `(organization_id, feature_key)`
   - Toggling feature access (e.g. "Propose Webinars") now succeeds

5. ✅ **Resource image fit standardized to 16:9 / 3:1** (commit `d4afa5c`)
   - `ImageUpload`: resize defaults to 1600×900 (16:9 source) instead of 1200×800; preview is `aspect-video`; guidance text says "Recommended: 1600×900 px (16:9)"
   - `ResourceDetailPage` hero banner: switched from full-width fixed heights (`h-64 sm:h-80 lg:h-96`) to a `max-w-7xl 3:1` panorama — less stretched on desktop, with a `min-h-14rem` mobile floor
   - Same uploaded image now crops predictably in the 16:10 thumbnail cards and the 3:1 hero banner

6. ✅ **Organization cover banner photo** (commit `c3d4160`)
   - New `banner_url` column on `organizations` (migration `add_organization_banner_url`)
   - Upload UI inside the Organization tab — hover overlay ("Upload cover photo" / "Change cover photo") + remove button. Owners only.
   - Renders as a 3:1 panorama above the dark hero on `/organizations/:slug` with a gradient overlay
   - Uses the existing `org-logos` storage bucket (no new policy needed)

7. ✅ **Developer + Investor personas** (commit `615848b`)
   - DB migration `add_developer_investor_org_types`: widen the `organization_type` CHECK constraint
   - `PersonaType` union extended with `developer` and `investor`; helper sets `MARINA_LIKE_PERSONAS`, `INTEREST_SECTOR_PERSONAS`, `SERVICE_SECTOR_PERSONAS` exported from `types/database.ts`
   - **Developer = clone of marina** — same submission features (Projects/RFPs/Consultations), unlimited team seats, marina-level resource access. Uses interest sectors.
   - **Investor = read-heavy network member** — browse Marketplace/Resources/Events, send sector-gated B2B requests, no submissions. Uses interest sectors ("Investment Focus Sectors" on the public profile).
   - 5 persona cards on signup (added HardHat / TrendingUp icons), partner-shaped onboarding form for developer + investor with conditional labels, admin persona dropdowns extended, `sector-matching.ts` generalized to interest-side vs service-side

8. ✅ **Webinar meeting URL field** (this commit)
   - New `meeting_url TEXT` column on `events` (migration `add_events_meeting_url`)
   - Admin event form now has a "Live Meeting URL" field for webinars, alongside the existing "Replay URL" (with clarifying helper text on both)
   - On the EventsPage card and the EventDetailPage sidebar, registered users of an upcoming webinar see a violet "Join the webinar" button that opens the meeting URL in a new tab

### Session of 2026-05-06
1. ✅ **Admin → Sectors page** (`/admin/sectors`)
   - Manage the 17+ industry sectors users pick during onboarding
   - Add / rename / re-slug / toggle active / delete (with usage check)
   - Admin-only, RLS via existing `is_moderator()` policy
   - Files: `src/components/admin/AdminSectors.tsx`, route + sidebar wired in `AdminPage.tsx` + `AdminSidebar.tsx`

2. ✅ **"Recommended by" section on partner public profiles**
   - Shows confirmed marina references on `/organizations/:slug` for partners (NOT media_partners — explicit user request)
   - Each row: marina name, country, project name (no signer name/title — also per user request)
   - Files: `src/pages/OrganizationPublicPage.tsx`
   - New RLS policy `reference_requests_public_select_confirmed` lets anyone read `status='confirmed'` rows

3. ✅ **Sector matching gate on B2B connections**
   - Marina ↔ Partner connections blocked if zero overlap between marina interest sectors and partner service sectors
   - Same-type connections (marina↔marina, partner↔partner) always allowed
   - Fails open if either org has zero sectors configured
   - New helper: `src/lib/sector-matching.ts` → `checkSectorMatch(fromOrgId, toOrgId)`
   - Wired into: `OrganizationPublicPage`, `MarketplacePage` (both flows), `UserProfilePage`

4. ✅ **Fixed reference confirmation bug** (was completely broken)
   - `confirm_reference_by_token` / `reject_reference_by_token` RPCs had `search_path = 'public'` but `digest()` (pgcrypto) lives in `extensions` schema → every confirmation threw "function digest does not exist"
   - Fixed: set search_path to `'public', 'extensions'`
   - Marina 21 (`vanja.cengic@marina21.com`) can now click their original reference email link and it will work

5. ✅ **Admin user-list onboarding-stage tracking**
   - Summary strip showing In progress / Draft / Submitted counts
   - New "Onboarding" column with stage badges (filling profile / submitted / under review / completed / email unconfirmed)
   - New "Onboarding" filter dropdown
   - Clickable summary cards filter the list instantly
   - File: `src/components/admin/AdminUsers.tsx`

6. ✅ **Admin can grant cross-persona feature access**
   - Admin user detail page now shows ALL features, not just ones matching the user's persona
   - Cross-persona features show an amber "Cross-persona" badge
   - `ProtectedRoute` accepts new `bypassEntitlement` prop — checks if entitlement is enabled for the org and bypasses persona check
   - Admins & moderators always bypass persona checks
   - Files: `src/components/admin/AdminUserDetail.tsx`, `src/components/auth/ProtectedRoute.tsx`, route updates in `App.tsx`

7. ✅ **Admin gets emailed when a new user signs up**
   - New `notify-admins` edge function — fans out to every admin user in DB + `contact@smartmarinaconnect.com`
   - Updated `notifyAdmin()` helper in `src/lib/notifications.ts` to route through it
   - `claim-code-signup` edge function v3 also notifies on claim-code signups
   - Future-proof: promoting a user to admin auto-includes them in notifications

8. ✅ **Partner onboarding welcome email template**
   - New `partner_onboarding_welcome` notification type
   - 3-step onboarding email with direct signup link (email pre-filled)
   - Triggerable from Admin → Users → "Invite Partner" button (new dialog)

9. ✅ **Removed all domain-based signup blocks**
   - Removed public domain blacklist (Gmail, Yahoo, etc. now allowed)
   - Removed the "another org already exists with this domain" block
   - Both early (in resolveOrg) and late (in handleSubmit) checks gone
   - Domain auto-detection still works (informational only)

10. ✅ **Claim-code signup skips email confirmation**
    - New `claim-code-signup` edge function (v3) — validates code, creates user with `email_confirm: true`
    - SignupForm detects `?code=X` URL param → routes through edge function instead of normal `signUp`
    - Green banner shown on signup form: "You've been invited to join an organization"
    - OnboardingPage auto-claims the org on load (reads code from sessionStorage)

11. ✅ **Spam-reducing email improvements (deployed v17)**
    - `send-notification` edge function v17 includes: plain-text alternative, `List-Unsubscribe` headers, `Reply-To: contact@smartmarinaconnect.com`, unsubscribe links in HTML footer
    - User still needs to verify SPF/DKIM/DMARC DNS records in Resend dashboard

12. ✅ **Monaco Smart & Sustainable Marina — 6th Edition event created**
    - 20-21 September 2026, Yacht Club de Monaco
    - Full description, public, on_site type, fees field intentionally left null
    - Event ID: `f55f7b2f-96ac-4c5e-b620-358624e52240`

13. ✅ **Ad banner fixes**
    - Removed `max-h-[120/160px]` constraint that was cropping banners
    - Banner rotation interval shortened from 30s to 8s
    - Updated guidance: 1200×300 px (4:1 ratio), WebP preferred, max 10 MB
    - All 4 placements (homepage, marketplace, resources, events) use same spec

---

## 4. Open Items / Known Issues / Future Work

### 🔴 Action items requiring user (Sebastien) action

| # | Item | Status |
|---|------|--------|
| 1 | **Set up SPF, DKIM, DMARC DNS records in Resend dashboard** for `smartmarinaconnect.com` to stop emails going to spam | Pending — see Resend → Domains |
| 2 | Once #1 is done, monitor deliverability. If still flaky, also add MX `feedback-smtp.eu-west-1.amazonses.com` for Resend tracking | Pending |
| 3 | Tell Marina 21 (`vanja.cengic@marina21.com`) to re-click their reference confirmation link — it works now | Pending (bug was fixed in DB) |

### 🟡 Minor / cosmetic

| # | Item | Notes |
|---|------|-------|
| 1 | Console error: `400 djjbgzasuomhyfvtlidi…%2Caccepted%29` on some pages | Non-critical PostgREST `.in('status', ['pending','accepted'])` race condition; UI works fine; investigated thoroughly, no user-facing impact |
| 2 | `OnboardingPage.tsx` line ~1 has an orphaned snippet at the top of the file | Cosmetic only; works correctly |

### 🟦 Planned features — scope locked, awaiting build

Order is the recommended build sequence; each becomes its own commit. Notification preferences ships first since the other email-driven features depend on it.

| # | Feature | Personas | Locked scope notes |
|---|---|---|---|
| 1 | **Notification preferences** | All | Per-category toggle in account settings (B2B / RFPs / recommendations / system / marketing). `send-notification` consults prefs before sending. Default = all on. Foundational for everything else email-driven. |
| 2 | **Vendor shortlist + private notes** | Marina + Developer | Star button on every partner card → new "Shortlist" tab on the Account page. Each entry has a private note field. New `org_bookmarks(user_id, organization_id, note)` table. Optional PDF export of the shortlist. |
| 3 | **"Seeking capital" toggle** | Marina, Developer, **Partner** (incl. innovation vendors looking for investment) | New `seeking_capital` boolean + free-text fields (capital type, range, stage, use of funds) on `organizations`. Toggle in OrganizationTab. **Visible to verified Investor accounts only** — not public on the org profile. Media partners excluded. |
| 4 | **Investment thesis profile** | Investor | Structured fields on the investor org: focus sectors (already captured), geographies, deal size range, hold period, free-text thesis. New section in OrganizationTab. Public on the investor's `/organizations/:slug` so marinas/devs can self-assess fit. |
| 5 | **Deal flow board** | Investor | New `/investments` page listing every org with `seeking_capital = true`, filtered by overlap with the investor's investment-focus sectors + country. Cards show org, location, capital range, sectors. "Pin to watchlist" + "Express interest" actions. |
| 6 | **Project pipeline view** | Developer | New `developer_projects` table with phase enum (feasibility → permitting → financing → construction → operations). Kanban-style view in the Account tab. Each project can attach RFPs/partners scoped to a phase. Phase visible on the public org profile, optional. |
| 7 | **Unified Inbox** | All | **Hard replace** of the scattered tabs (B2B Requests, References, Join Requests, Team Invitations). New `/account?tab=inbox` becomes canonical; old URLs redirect with a pre-applied filter (so email links don't break). Inline accept/reject buttons per item. Filter categories map 1:1 to notification preferences. |
| 8 | **Industry Pulse dashboard** | **Admin only** (`/admin/pulse`) | Strategic dashboard for the M3 team — not user-facing. Sections: weekly snapshot, signup→verified funnel, sector heat-map with supply gaps, geographic distribution, top movers, deal-flow visibility (capital-seeking orgs), sector × geography targeting matrix. Nightly aggregation job into `pulse_snapshots`. No anonymization (admin can see real names). |
| 9 | **Incomplete-profile reminder runner** | All (driven by state) | Nightly `pg_cron` + edge function `send-profile-reminders`. Four reminder types: signup-stalled (3d + 10d), onboarding-incomplete (5d + 14d), pending-review-followup (7d), verified-but-thin (14d). Respects notification preferences + a new `notification_sends` log table for dedupe. |

### 🟢 Nice-to-have / next ideas (not promised, just brainstorms)

- Auto-archive expired reference requests (>30 days unresponded)
- Bulk-add sectors via CSV in admin
- Sector autocomplete during onboarding instead of huge multi-select
- Show "Recommended by" count as a badge on the partner card in marketplace listings
- Soft-delete sectors (archive rather than hard-delete) to preserve historical data
- Admin can re-send the partner onboarding email to existing pending users in bulk
- Make `connectMessage` mandatory on partner→marina connections (currently optional)
- "Webinar starting in 1h" reminder email with the meeting URL (now that `events.meeting_url` exists)
- Calendar export (.ics) for events — one-click "add to calendar" on registration confirmation

### ⛔️ Explicitly **out of scope** — do NOT propose

- **Stripe / subscriptions / payment processing** — doesn't work for Monaco companies; invoicing is manual
- **CMS (content_items / content_drafts / content_approvals)** — was scoped out, never built
- **Adding gmail.com / yahoo.com / etc. back to a public-domain blacklist** — explicitly removed by user request

---

## 5. Recent Discussions / User Preferences Captured

These are things the user (Sebastien) explicitly asked for or rejected — keep them in mind:

| Topic | User preference |
|---|---|
| Email banners | 1200×300 px (4:1), WebP, work on all 4 placements |
| Onboarding "Save" buttons | NOT needed — flow is all-or-nothing submit + references handled separately on Account page |
| Domain restrictions on signup | None — anyone can sign up with any email; multiple orgs can share a domain |
| References on profile | Show on partner profiles **only**, not media_partners; show marina name + country + project, **not** signer name/title |
| Sector matching for connections | Strict: target org must have ≥1 member; cross-type (interest-side ↔ service-side) requires both sides have sectors and ≥1 overlap. Updated 2026-05-13 from fail-open to fail-closed. |
| Marina recommendations | Optional feature, not a gate. Partners are approvable without any references; confirmed recommendations only appear on the public profile. Tab renamed "Recommendations". |
| Persona model | 5 personas: marina, developer, investor, partner, media_partner. Developer = clone of marina (interest sectors, all submissions). Investor = read-heavy network member (interest sectors, no submissions). |
| "Seeking capital" toggle scope | Available to marina + developer + **partner** (innovation vendors looking for investment too). Media partners excluded. Visible to verified Investor accounts only — not public. |
| Industry Pulse dashboard | **Admin-only** intelligence dashboard at `/admin/pulse`. Not a user-facing surface. |
| Unified Inbox rollout | Hard replace of B2B Requests / References / Join Requests tabs. Old URLs redirect to `?tab=inbox` with a pre-applied filter so email links still work. |
| Admin notifications | Should reach all admins (sebastien + victor), not just `contact@` |
| Cross-persona features | Admin can grant any user access to any feature regardless of persona |
| Push workflow | User commits straight to `main` (no feature branches, no PRs) — Netlify deploys on push |

---

## 6. Key Files / Where Things Live

```
src/
├── pages/
│   ├── HomePage.tsx                  Landing page
│   ├── OnboardingPage.tsx            Big multi-step org onboarding
│   ├── AccountPage.tsx               User account with 8 tabs (?tab=)
│   ├── OrganizationPublicPage.tsx    Public org profile (with Recommended by)
│   ├── UserProfilePage.tsx
│   ├── MarketplacePage.tsx           B2B network browser (sector gates here)
│   ├── ReferenceConfirmPage.tsx      Marina clicks confirm link from email
│   ├── ReferenceRejectPage.tsx
│   └── AdminPage.tsx                 Routes all /admin/* pages
├── components/
│   ├── admin/
│   │   ├── AdminUsers.tsx            List + onboarding stage filtering
│   │   ├── AdminUserDetail.tsx       Feature toggles + reference bypass
│   │   ├── AdminOrganizations.tsx
│   │   ├── AdminOrganizationDetail.tsx (Send Connect Link button)
│   │   ├── AdminSectors.tsx          NEW — manage industry sectors
│   │   ├── AdminSidebar.tsx
│   │   └── ... (16+ admin sections)
│   ├── auth/
│   │   ├── SignupForm.tsx            Auto-fills email/code from URL param
│   │   ├── LoginForm.tsx
│   │   └── ProtectedRoute.tsx        bypassEntitlement prop
│   └── ui/                           shadcn-style primitives
├── contexts/
│   └── AuthContext.tsx               useAuth() — user, profile, organization, isAdmin, isModerator, isVerified
├── lib/
│   ├── supabase.ts                   Module-level auth listener (avoids Web Locks deadlock)
│   ├── notifications.ts              sendNotification(), notifyAdmin()
│   ├── sector-matching.ts            NEW — checkSectorMatch()
│   └── entitlements.ts
└── hooks/
    └── useEntitlements.ts            isFeatureEnabled(), getQuota(), getUsage()

supabase/functions/
├── send-notification/        v17 — 48+ email types via Resend
├── send-reference-email/     v10 — reference confirmation tokens
├── claim-code-signup/        v3  — bypass email confirmation via claim code
├── notify-admins/            v1  — fan-out admin notifications
├── create-admin-user/        Admin-only user creation
└── create-demo-user/         v2  — temp helper, can be deleted

scripts/                      One-off SQL seeding / migration helpers
```

---

## 7. Important Database Functions (RPCs)

| Function | Purpose |
|---|---|
| `claim_organization(p_claim_code)` | Marina manager claims pre-created org by code |
| `confirm_reference_by_token(p_reference_id, p_token)` | Marina confirms partner reference (was broken, now fixed) |
| `reject_reference_by_token(p_reference_id, p_token, p_reason)` | Marina rejects reference |
| `check_pending_invitation(p_email)` | Used by onboarding to detect email invites |
| `accept_org_invitation(p_invitation_id)` | Join via team invitation |
| `request_org_join(p_organization_id)` | Domain-match request to join |
| `approve_join_request(p_id)` / `reject_join_request(p_id)` | Owner manages join requests |
| `create_organization(name, type, domain)` | Self-service org creation |
| `transfer_org_ownership(org_id, new_owner)` | Owner change |
| `get_public_profile(user_id)` | Safe public-profile lookup (SECURITY DEFINER) |
| `is_moderator()` | True for `admin` OR `moderator` persona — used in lots of RLS policies |

---

## 8. Notification Types (49 total now)

The full list lives in `supabase/functions/send-notification/index.ts` (type union at the top + switch cases). Categories:

- **Webinar** — accepted / rejected / moderator_approved
- **RFP** — submitted (→admin) / approved / rejected / closed
- **Consultation** — same set
- **Exposition** — approved / invoice_sent / paid / rejected
- **Sponsorship** — invoice_sent / paid / approved / rejected
- **B2B** — partner_request_received / accepted / rejected
- **References** — confirmed / rejected / bypass_approved / bypass_rejected
- **Account** — user_account_approved / rejected
- **Join requests** — received / approved / rejected
- **Team** — invitation / invitation_reminder
- **Payments** — confirmed / failed / membership_payment_received
- **Org** — `org_claim_code` (admin sends connect link with email + code in URL)
- **Partner onboarding** — `partner_onboarding_welcome` (3-step guide email)
- **Project** — rejected / status_updated
- **Event** — registration_confirmed
- **Admin generic** — `admin_new_submission` (fanned out via `notify-admins`)

All emails now include `List-Unsubscribe` header + plain-text alt + footer unsubscribe link (spam-reduction).

---

## 9. Workflow Conventions (Important for new Claude session)

1. **Commit directly to `main`** — no feature branches, no PRs, no review. User pushes straight to production via Netlify auto-deploy.
2. **CLAUDE.md is gitignored** — local to each machine (but synced via Dropbox).
3. **Never build locally** — push to GitHub, Netlify builds.
4. **Never expose secrets** — service role key, API keys live in Supabase env, never in code.
5. **Edge function deploys** — use Supabase MCP tool `deploy_edge_function` directly. Pass full file content inline.
6. **Database schema changes** — use Supabase MCP tool `apply_migration`. RLS-aware, atomic.
7. **One feature per commit** — short, descriptive commit messages.
8. **Don't ask permission for small fixes** — if something's clearly broken (like the reference token bug), just fix it and tell the user.
9. **Ask permission for big rewrites or new dependencies.**
10. **Always sanity-check Dropbox sync** if a file appears "missing" — files may take seconds to sync between machines.

---

## 10. Quick "Start Here" Prompt for the New Claude Session

Paste this into Claude Code on the new computer to bootstrap:

> Read CLAUDE.md and HANDOFF.md at the project root. Confirm you understand:
> 1. The platform overview (target users, tech stack, key workflows)
> 2. The recent work done in the last sessions (especially the open items list in HANDOFF.md)
> 3. The workflow conventions (commit to main, never build locally, use Supabase MCP for edge functions / SQL)
>
> Then briefly summarize what's pending action from me (Sebastien) so I can plan next steps.

---

## 11. Sensitive Info (NOT in this file)

The following must come from the Supabase dashboard / your password manager:
- `RESEND_API_KEY` — already set as Supabase env var
- `SUPABASE_SERVICE_ROLE_KEY` — already set
- `SENDER_EMAIL` — already set
- Anon key for the client app — already in `.env` (gitignored)

If `.env` didn't sync via Dropbox to the new machine, copy these from Supabase Dashboard → Settings → API:
- `VITE_SUPABASE_URL=https://djjbgzasuomhyfvtlidi.supabase.co`
- `VITE_SUPABASE_ANON_KEY=<from dashboard>`

---

*End of handoff. Welcome to the new machine. 🚀*
