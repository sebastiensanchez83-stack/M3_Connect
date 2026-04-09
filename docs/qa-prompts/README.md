# Smart Marina Connect — Pre-Launch QA Prompts for Claude Chrome

This folder contains 11 copy-paste ready QA prompts for running a comprehensive pre-launch audit of https://smartmarinaconnect.com using Claude Chrome.

## How to use

1. Open Claude Chrome in your browser
2. First, paste the **Global Context** block below as your opening message
3. Then paste each prompt (`01-*` through `11-*`) one at a time, in order
4. Wait for each report before moving on — some prompts create test data used by later prompts
5. Collect reports in a single document for the launch go/no-go review

## Global Context (paste this FIRST)

```
You are QAing a pre-launch B2B SaaS platform at https://smartmarinaconnect.com.

RULES for every test:
- Capture screenshots of unexpected states, read console errors, read network tab for 4xx/5xx
- Write a concise report per test using ✅ / ⚠️ / ❌ + details
- Do not modify production data beyond what each test explicitly asks
- Never enter real credit cards, real personal phone numbers, or real passwords
- Use fake test data (mailinator.com addresses are fine for email)
- If something is blocked (captcha, 2FA, email confirmation link on a disabled flow, etc.), pause and tell me
- Only delete/modify items whose title/name contains "QA" or "TEST"

CONTEXT:
- Email confirmation for signup is currently DISABLED for QA testing. Signup should log users in immediately with no "check your email" step. If you see a "check your email" screen during signup, flag it as a BUG.
- Transactional emails (reference verification, approval notifications, status updates) are still enabled and should still send via Resend.
- Expected sender domain: noreply@smartmarinaconnect.com (NOT m3monaco.com — flag if you see the old domain).
- Stripe/payments are disabled/removed — there should be no payment UI.

Acknowledge these rules and wait for the first prompt.
```

## Prompt order & dependencies

| # | File | Purpose | Depends on |
|---|---|---|---|
| 1 | `01-public-pages.md` | Anonymous browsing of all public pages | — |
| 2 | `02-lightweight-webinar-signup.md` | New guest webinar signup feature | Requires ≥1 public webinar in DB |
| 3 | `03-marina-signup.md` | Marina signup → onboarding → pending | — |
| 4 | `04-partner-signup.md` | Partner signup → references | — |
| 5 | `05-event-creation.md` | Admin creates 3 test events | Admin login |
| 6 | `06-admin-user-approval.md` | Approve test users from prompts 3 & 4 | Prompts 3 & 4 done |
| 7 | `07-rfp-consultation-webinar.md` | Verified marina submits RFPs etc. | Prompt 6 done |
| 8 | `08-mobile-responsiveness.md` | Mobile viewports | — |
| 9 | `09-error-resilience.md` | 404s, crashes, stale chunks | — |
| 10 | `10-link-crawl.md` | Full link health crawl | — |
| 11 | `11-admin-panel-audit.md` | Full admin panel audit | Admin login |

## Known blockers Claude Chrome cannot do alone

| Blocker | Workaround |
|---|---|
| Read real email inbox for confirmation/verification links | Use **mailinator.com** temp addresses (public inbox visible in browser) |
| Approve user in admin as a different logged-in session | Run admin prompts in a **separate Chrome profile** |
| Real payment flows | N/A — Stripe removed from platform |
| OAuth/SSO popup flows | Flag and skip |
| Real document uploads | Use **picsum.photos** for images, tiny dummy PDFs |
| CAPTCHA / bot challenges | Pause and alert Sebastien manually |

## Launch checklist reminder (post-QA)

- [ ] **Re-enable email confirmation** in Supabase → Auth → Email provider
- [ ] Verify signup confirmation email arrives from `noreply@smartmarinaconnect.com`
- [ ] Verify confirmation link lands on `https://smartmarinaconnect.com/`
- [ ] Enable **HaveIBeenPwned** password check in Supabase → Auth → Providers → Email
- [ ] Delete QA test users/events/orgs created during this audit
- [ ] Delete Stripe edge functions (`create-payment`, `payment-ipn`) if not already removed
- [ ] Verify Netlify SSL certificate is Active
- [ ] Clean up duplicate DNS records in Netlify (2× `send.` MX, 2× SPF, 2× DKIM)

## Report aggregation template

At the end of the full audit, consolidate findings in this format:

```
# Smart Marina Connect — Pre-Launch QA Report
Date: YYYY-MM-DD
Run by: Victor Meyer / Claude Chrome

## Summary
- Total prompts run: X / 11
- Blockers (P0): X
- Major issues (P1): X
- Minor issues (P2): X
- Polish items (P3): X
- Go / no-go: ⬜ GO / ⬜ NO-GO

## Findings by prompt
(paste each prompt's report here)
# Public Pages QA Report — smartmarinaconnect.com

**Test date:** 2026-04-09 | **Viewport:** 1440×900 (desktop) | **Auth:** Logged out

---

## Page-by-Page Results

| # | URL | Title | Status | Console errors | 4xx/5xx requests | Broken images | Footer renders | Notes |
|---|-----|-------|--------|---------------|-----------------|---------------|----------------|-------|
| 1 | `/` | Smart Marina Connect — The B2B Platform for the Marina & Yachting Industry | ✅ | N | N | N (4 imgs OK) | ✅ All links present | Clean. No Stripe UI. No old domain refs. |
| 2 | `/about` | Smart Marina Connect — B2B Platform for the Marina Industry | ✅ | N | N | N | ✅ | Clean. No old domain refs. |
| 3 | `/events` | Events — Smart Marina Connect | ⚠️ | N | N | N | ✅ | **Upcoming: 0, Past: 0** — empty state. Cannot test event detail (no events exist). |
| 4 | `/resources` | Resources — Smart Marina Connect | ✅ | N | N | N (8 imgs OK, 2 lazy-loaded) | ✅ | 7 resources found. All images load after scroll. |
| 5 | `/partners` | Smart Marina Connect — B2B Platform… | ✅ | N | N | N | ✅ | 2 partners shown (OceanTech Solutions, M3 Monaco). |
| 6 | `/network` | Network — Smart Marina Connect | ✅ | N | N | N | ✅ | Marketplace loads publicly (not gated). 2 orgs, 4 tabs (Directory, RFPs, Consultations, Projects). |
| 7 | `/join` | 404 — Smart Marina Connect | ❌ | N | N/A | N/A | ✅ (footer on 404 page) | **404 — page does not exist.** Actual "Become a Member" path is `/become-partner`. |
| 7b | `/become-partner` | Become a Member — Smart Marina Connect | ✅ | N | N | N | ✅ | Correct member signup page. No old domain refs. |
| 8 | `/tiers` | Membership & Sponsorship \| Smart Marina Connect | ✅ | N | N | N | ✅ | 4 tiers: Free / Innovation Partner / Associate Partner / Partner. **No Stripe/payment UI** — only "Join for Free" and "Contact Us" CTAs. ✅ |
| 9 | `/contact` | Contact Us — Smart Marina Connect | ✅ | N | N | N | ✅ | Form loads (name, email, subject, message). No old domain refs. |
| 10 | `/terms` | Terms of Use — Smart Marina Connect | ⚠️ | N | N | N | ✅ | **1× old domain: `info@m3monaco.com`** at bottom ("please contact"). |
| 11 | `/privacy` | Privacy Policy — Smart Marina Connect | ⚠️ | N | N | N | ✅ | **4× old domain: `info@m3monaco.com`** — General contact, DPO email, exercise rights, policy contact. |
| 12 | `/cookies` | Cookie Policy — Smart Marina Connect | ⚠️ | N | N | N | ✅ | **1× old domain: `info@m3monaco.com`** at bottom. |
| 13 | `/mentions-legales` | Legal Notice — Smart Marina Connect | ⚠️ | N | N | N | ✅ | **1× old domain: `info@m3monaco.com`** at bottom. |
| 14 | `/conditions-commerciales` | Commercial Terms — Smart Marina Connect | ⚠️ | N | N | N | ✅ | **1× old domain: `info@m3monaco.com`** at bottom. |

---

## Footer Link Verification

| Footer Link | Target URL | Status |
|---|---|---|
| Resources | `/resources` | ✅ |
| Events | `/events` | ✅ |
| Partners | `/partners` | ✅ |
| Become a Member | `/become-partner` | ✅ |
| About | `/about` | ✅ |
| Contact | `/contact` | ✅ |
| Terms of Service | `/terms` | ✅ |
| Privacy Policy | `/privacy` | ✅ |
| Legal Notice | `/mentions-legales` | ✅ |
| Commercial Terms | `/conditions-commerciales` | ✅ |
| Cookie Policy | `/cookies` | ✅ |
| LinkedIn (social) | `linkedin.com/company/monaco-marina-management` | ❌ **"This LinkedIn Page isn't available"** |
| Instagram (social) | `instagram.com/monacomarinamanagement/` | ✅ (resolves, shows consent wall — normal IG behavior) |

---

## Event Detail Test

⚠️ **Could not test** — 0 upcoming events and 0 past events exist. Tested a **resource detail** instead (`/resources/bd643c64-…`) → loads correctly with hero image, speakers, article body. ✅

---

## Summary

| Metric | Count |
|---|---|
| ✅ Pass | 11 pages |
| ⚠️ Warning | 5 (old domain refs on legal pages) |
| ❌ Fail | 2 (`/join` 404 + LinkedIn broken) |
| Total pages tested | 15 (14 requested + `/become-partner`) |

---

## Issues

### ❌ P0 — Critical

1. **LinkedIn footer link is dead.** `linkedin.com/company/monaco-marina-management` returns "This LinkedIn Page isn't available." Every page on the site links to this broken URL via the footer. **Fix: update to the correct LinkedIn company page URL.**

### ❌ P1 — High

2. **`/join` returns 404.** If this URL has been shared externally (emails, docs, marketing), visitors will hit a dead end. The actual path is `/become-partner`. **Fix: add a redirect from `/join` → `/become-partner`.**

3. **Old domain `info@m3monaco.com` appears 8 times across 5 legal pages** (`/terms`, `/privacy`, `/cookies`, `/mentions-legales`, `/conditions-commerciales`). Per project requirements, the old domain should not appear. **Fix: replace with the correct `@smartmarinaconnect.com` contact email on all legal pages.**

### ⚠️ P2 — Medium

4. **Events page is completely empty** (0 upcoming, 0 past). The homepage says "12+ Events/Year" but the events page shows nothing. If this is pre-launch placeholder data, the stat may mislead visitors. Could not verify event detail page functionality.

5. **"Meeting Crew, Guest & Vessel Needs in Modern Marinas" resource card** — no author name displayed (only icon visible), unlike all other resource cards which show authors. Minor data issue.

### ✅ Positive Findings

- No console errors on any page
- No broken images (all Supabase-hosted images load correctly)
- No 4xx/5xx network requests (except the intentional `/join` 404)
- No references to `connect.m3monaco.com` or `m3connect.mc`
- No Stripe/payment UI visible anywhere
- Footer renders consistently on all pages with all legal links
- All pages load in <3 seconds
- Layout is clean at 1440px width on all pages
- Cookie banner appears correctly with Decline/Accept options

# Webinar Guest Signup QA Report

**Test date:** 2026-04-09 | **Viewport:** 1440×900 | **Auth:** Not logged in

---

## Step-by-Step Results

| Step | Expected | Actual | Status |
|------|----------|--------|--------|
| **1. Find a public webinar** | A public webinar exists on /events | Found: "QA SAMPLE — Public Webinar TOMORROW: Sustainability in Marinas" (Public + Webinar badges). 5 upcoming events total (3 webinars, 2 on-site). | ✅ |
| **2. Click into webinar detail** | Detail page loads | Page loads at `/events/35ed58b5-…` with full detail + registration card on right side. | ✅ |
| **3a. Registration form fields** | First name (required), Last name (required), Email (required), Company (optional) | All four fields present with correct labels: "First name *", "Last name *", "Email *", "Company (optional)". Placeholders: John, Doe, you@company.com, Your organization. | ✅ |
| **3b. Blue info banner** | "Quick signup — no account needed for public webinars" | Banner shows: "Quick signup — no account needed for public webinars" | ✅ |
| **3c. Submit button** | "Register for Webinar" button | Button present: "Register for Webinar" | ✅ |
| **3d. Footer text** | "Already have an account? Log in" | Present: "Already have an account? **Log in**" + bonus: "By registering, you agree to receive webinar-related emails from Smart Marina Connect. For full access to the platform, **create an account**." | ✅ |
| **3e. Spot counter** | Shows capacity | "0 / 300 spots" displayed | ✅ |
| **4. Invalid email validation** | Error toast, form does NOT submit | Browser's native HTML5 email validation fires: "Please include an '@' in the email address." Form does NOT submit. No network request made. **Note:** Uses browser-native tooltip, not a custom error toast. | ⚠️ |
| **5. Happy path registration** | Green success box with "You're registered for this webinar" and email shown | **COMPLETE FAILURE.** Form submits, CORS preflight OPTIONS succeeds (200), but the actual POST to `guest-webinar-register` edge function returns **500 Internal Server Error**: `"new row for relation 'event_registrations' violates check constraint 'event_registrations_registration_type_check'"`. **No UI feedback at all** — no success, no error, no loading spinner. Form sits there silently. | ❌ **P0** |
| **5b. Network analysis** | POST 200/201 | POST to edge function returns 500. The edge function receives the data (`first_name`, `last_name`, `email`, `company`, `event_id`) but the DB INSERT fails on a check constraint for `registration_type`. The front-end also sends empty `headers: {}` (no Content-Type). | ❌ **P0** |
| **5c. Error feedback** | N/A (should succeed) | Even on 500, the UI shows absolutely nothing — no error toast, no console errors, no loading state change. Error is silently swallowed. | ❌ **P1** |
| **6. Duplicate prevention** | Error toast "Already registered" | **BLOCKED** — cannot test. Registration never succeeds (Step 5 is broken). | ⏸️ |
| **7. Fresh email success** | Green success box | **BLOCKED** — cannot test. Registration never succeeds. | ⏸️ |
| **8a. On-site free event gating** | No guest form; "Log in to Register" button | Correct: On-site free event shows "Log in to Register" button, "Free", "0/80 spots". **No guest registration form appears.** | ✅ |
| **8b. On-site paid event gating** | No guest form; "Log in to Register" button | Correct: On-site paid event shows "Log in to Register", "From €450 — see packages", "0/1200 spots", registration packages (Standard €450, VIP €950, Day Pass €180). **No guest form.** | ✅ |
| **8c. Invitation-only event** | "Log in to Request Invitation" | **NOT TESTED** — no invitation-only events exist in test data. | ⏸️ |
| **8d. Members-only webinar** | "Log in to Register" | **NOT TESTED** — no members-only events exist in test data. | ⏸️ |
| **9. Confirmation email** | Optional email via `send-notification` | **No email received** (mailinator inbox empty). Expected since the registration itself never completed. | ⏸️ |

---

## Summary

| Result | Count |
|--------|-------|
| ✅ Pass | 8 |
| ⚠️ Warning | 1 |
| ❌ Fail | 3 (2× P0, 1× P1) |
| ⏸️ Blocked | 5 (dependent on P0 fix) |

---

## Issues Found

### ❌ P0 — Registration completely broken (backend)

**Bug:** The `guest-webinar-register` Supabase Edge Function returns **HTTP 500** on every registration attempt.

**Root cause:** DB check constraint `event_registrations_registration_type_check` is violated on INSERT. The edge function is not setting a valid value for the `registration_type` column (likely needs to insert `'guest'` but that value isn't in the constraint's allowed list, or the column is missing from the INSERT entirely).

**Reproduction:**
```
POST /functions/v1/guest-webinar-register
Body: {"event_id":"35ed58b5-...","first_name":"QA","last_name":"Guest",
       "email":"qa-guest-xxx@mailinator.com","company":"QA Corp"}
Response: 500 {"error":"Could not register","details":"new row for relation 
           \"event_registrations\" violates check constraint 
           \"event_registrations_registration_type_check\""}
```

**Fix needed:** Update the `event_registrations_registration_type_check` constraint to include `'guest'` as a valid type, OR update the edge function to set the correct `registration_type` value.

### ❌ P0 — No error handling / silent failure (frontend)

**Bug:** When the edge function returns 500 (or 400), the UI shows **zero feedback** — no error toast, no console error, no loading state. The user clicks "Register for Webinar" and nothing visibly happens. This also means the front-end isn't catching or displaying the error response.

**Fix needed:** Add try/catch around the fetch call, display an error toast on non-2xx responses, and add a loading/disabled state to the button while the request is in flight.

### ⚠️ P2 — Missing Content-Type header on POST

**Observation:** The front-end sends `headers: {}` (empty) on the POST request to the edge function. While the edge function still parses the JSON body, best practice is to send `Content-Type: application/json`. This could cause issues with different deployment environments or middleware.

### ⚠️ P2 — Email validation uses browser-native only

**Observation:** Invalid email validation relies solely on HTML5 `type="email"` browser validation (tooltip popup). The spec expected an "error toast" for invalid email. Consider adding app-level validation with a toast for consistency and for cases where browsers don't enforce HTML5 validation.

### ℹ️ Note — Missing test data

No invitation-only or members-only events exist in the test data. Steps 8c and 8d could not be tested. Please create test events with these access levels for a follow-up test.

### ℹ️ Note — Paid event pricing visible

The on-site paid event (Monaco Smart Marina Conference 2026) shows euro pricing (€180/€450/€950). Context says Stripe/payments are disabled/removed. The pricing display alone may be intentional (informational), but confirm there's no payment flow behind "Log in to Register" for paid events.


## Action items before launch
| # | Priority | Description | Owner |
|---|---|---|---|
```
