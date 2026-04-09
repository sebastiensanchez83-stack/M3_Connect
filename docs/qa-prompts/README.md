# Smart Marina Connect — Pre-Launch QA Prompts for Claude Chrome

This folder contains copy-paste ready QA prompts for running a comprehensive pre-launch audit of https://smartmarinaconnect.com using Claude Chrome.

**⚠️ Version 2 (2026-04-09)** — fully rewritten after the audit session. All known root-cause bugs (guest webinar 500, reference-email 401, send-status-notification 401, `registration_type='guest'` check constraint, REQUIRED_REFERENCES enforcement) are fixed. Every prompt now has explicit **🛑 ADMIN CHECKPOINT** markers where Victor must intervene.

## How to use

1. Open Claude Chrome in your browser
2. Paste the **Global Context** block below as your opening message
3. Then paste each prompt one at a time, in order, and wait for each report
4. When you see a **🛑 ADMIN CHECKPOINT**, pause Claude Chrome and do the admin action yourself before telling it to continue
5. Collect reports in a single document for the launch go/no-go review

## Global Context (paste this FIRST)

```
You are QAing a pre-launch B2B SaaS platform at https://smartmarinaconnect.com.

RULES for every test:
- Capture screenshots of unexpected states, read console errors, read network tab for 4xx/5xx
- Write a concise report per test using ✅ / ⚠️ / ❌ + details
- Do not modify production data beyond what each test explicitly asks
- Never enter real credit cards, real personal phone numbers, or real passwords
- Use fake test data. Mailinator addresses (@mailinator.com) are PREFERRED because the public inbox can be read via https://www.mailinator.com/v4/public/inboxes.jsp?to=<handle>
- If something is blocked (captcha, 2FA, email never arrives after 3 min, etc.), pause and tell Victor
- Only delete/modify items whose title/name contains "QA" or "TEST"
- When you hit a 🛑 marker in a prompt, STOP and tell Victor you need his admin action before continuing

CURRENT PLATFORM STATE (2026-04-09):
- Email confirmation for signup is DISABLED for QA. Signup logs users in immediately with NO "check your email" step. Flag as BUG if you see that screen.
- Transactional emails (guest-webinar confirmation with .ics, reference verification, approval/rejection notifications, 24h webinar reminders) ARE enabled and send via Resend.
- Expected sender: noreply@smartmarinaconnect.com (NOT m3monaco.com — flag old domain).
- Stripe/payments are REMOVED — there should be no payment UI anywhere.
- Mailinator is currently ALLOWED as a signup email domain (temporary QA patch in SignupForm.tsx; will be reverted post-QA).
- 10 QA SAMPLE events are seeded in the DB (titles start with "QA SAMPLE —"). Do NOT delete them.
- After signup, users redirect to /account?tab=organization (NOT /onboarding — there is no dedicated /onboarding route).
- Partners need 2 confirmed client references OR an approved bypass request before admin can verify them.
- Admin panel lives at /admin. Victor's admin account is the only user with persona='admin'.

Acknowledge these rules and wait for the first prompt.
```

## Prompt order & dependencies

| # | File | Purpose | Depends on | Admin needed? |
|---|---|---|---|---|
| 1 | `01-public-pages.md` | Anonymous browsing of all public pages + footer crawl | — | No |
| 2 | `02-lightweight-webinar-signup.md` | Guest webinar signup (now fixed) | QA sample events seeded | No |
| 3 | `03-marina-signup.md` | Marina signup → org profile → pending | — | No |
| 4 | `04-partner-signup.md` | Partner signup → references (Path A real refs, Path B bypass) | — | **Yes** (Path B only) |
| 5 | `05-event-verification.md` | Verify 10 seeded QA events + create 1 new to test admin form | Admin login | **Yes** |
| 6 | `06-admin-user-approval.md` | Approve/reject/suspend test users from prompts 3 & 4 | Prompts 3+4 done | **Yes** (this IS the admin flow) |
| 7 | `07-rfp-consultation-webinar.md` | Verified marina submits RFPs, consultations, webinar proposals, projects | Prompt 6 done | **Yes** (mid-test) |
| 8 | `08-mobile-responsiveness.md` | Mobile viewports | — | No |
| 9 | `09-error-resilience.md` | 404s, crashes, stale chunks, offline | — | No |
| 10 | `10-link-crawl.md` | Full link health crawl | — | No |
| 11 | `11-admin-panel-audit.md` | Full admin panel audit | Admin login | **Yes** |
| 12 | `12-b2b-partner-request.md` | Partner→marina contact request flow | Prompts 6 & 7 done | **Yes** (mid-test) |
| 13 | `13-reference-confirm-reject.md` | Click reference confirm/reject links from mailinator | Prompt 4 Path A done | **Yes** (verify admin view) |
| 14 | `14-guest-to-account-upgrade.md` | Guest registers for webinar, then signs up with same email → registration auto-links | — | No |

## Known blockers Claude Chrome cannot do alone

| Blocker | Workaround |
|---|---|
| Read Victor's real email inbox | Use **mailinator.com** temp addresses only |
| Approve a user while the pending user is also logged in | Use a **separate Chrome profile** for admin OR log out between steps |
| Real payment flows | N/A — Stripe removed from platform |
| OAuth/SSO popup flows | Flag and skip |
| Real document uploads | Use **picsum.photos** for images, tiny dummy PDFs |
| CAPTCHA / bot challenges | Pause and alert Victor manually |
| Clicking "Approve" buttons in admin panel | 🛑 Victor does these manually at checkpoints |

## 🛑 Admin Checkpoint legend

When you see this marker in a prompt:

> **🛑 ADMIN CHECKPOINT — Victor does this**
> Action: <what Victor does>
> Resume after: <signal Claude should receive>

Claude Chrome must stop, report the current state, and wait for Victor to confirm completion before continuing.

## Pre-flight (do this ONCE before running any prompt)

Victor's checklist before starting QA:

- [ ] Verify mailinator patch is deployed (signup form accepts `@mailinator.com`)
- [ ] Verify 10 QA SAMPLE events exist in /admin/events
- [ ] **This run uses the `qa2-` prefix** for all new test users / orgs / references (the
      first run already left `qa-marina-*`, `qa-partner-*`, `qa-guest-*` rows in the DB;
      `qa2-` avoids any collision and makes cleanup trivial — one DELETE per prefix)
- [ ] Open https://smartmarinaconnect.com in Chrome Profile A (QA test profile, logged out)
- [ ] Open https://smartmarinaconnect.com/admin in Chrome Profile B (Victor's admin account, logged in)
- [ ] Open https://www.mailinator.com/v4/public/inboxes.jsp in a 3rd tab (for receiving test emails)
- [ ] Have a text buffer open to save timestamps and emails used per prompt

## Launch checklist reminder (post-QA)

- [ ] **Revert `SignupForm.tsx`** — put `'mailinator.com','guerrillamail.com',` back into `PUBLIC_DOMAINS` (look for the `// QA REVERT: add back →` marker)
- [ ] **Re-enable email confirmation** in Supabase → Auth → Email provider
- [ ] Verify signup confirmation email arrives from `noreply@smartmarinaconnect.com`
- [ ] Verify confirmation link lands on `https://smartmarinaconnect.com/`
- [ ] Enable **HaveIBeenPwned** password check in Supabase → Auth → Providers → Email
- [ ] Delete QA test users / events / orgs created during this audit
- [ ] Delete Stripe edge functions (`create-payment`, `payment-ipn`) if still present
- [ ] Verify Netlify SSL certificate is Active
- [ ] Clean up duplicate DNS records in Netlify (2× `send.` MX, 2× SPF, 2× DKIM)
- [ ] Add MX record validation on signup to prevent fake business domains
- [ ] Fix the LinkedIn footer link (currently dead)
- [ ] Replace `info@m3monaco.com` references on all 5 legal pages

## Report aggregation template

At the end of the full audit, consolidate findings in this format:

```
# Smart Marina Connect — Pre-Launch QA Report
Date: YYYY-MM-DD
Run by: Victor / Claude Chrome

## Summary
- Total prompts run: X / 14
- Blockers (P0): X
- Major issues (P1): X
- Minor issues (P2): X
- Polish items (P3): X
- Go / no-go: ⬜ GO / ⬜ NO-GO

## Findings by prompt
# Public Page QA Report — smartmarinaconnect.com (Logged Out, 1440×900)

## Page-by-Page Results

| # | URL | Browser Tab Title | Status | Console Err | 4xx/5xx | Footer OK | Notes |
|---|-----|------------------|--------|------------|---------|-----------|-------|
| 1 | `/` | Smart Marina Connect — The B2B Platform for the Marina & Yachting Industry | ✅ | No | No | Yes (13 links) | Clean layout, all images load, no forbidden strings |
| 2 | `/about` | Smart Marina Connect — B2B Platform for the Marina Industry | ⚠️ | No | No | Yes | Generic page title (not page-specific) — minor SEO issue |
| 3 | `/events` | Events — Smart Marina Connect | ⚠️ | No | No | Yes | Only **5 upcoming** + 1 past = 6 total. Spec says ≥10 upcoming. 4 of 10 seeded QA events may be members-only or lack dates |
| 4 | `/resources` | Resources — Smart Marina Connect | ⚠️ | No | No | Yes | **Baseline (d) STILL PRESENT:** "Meeting Crew, Guest & Vessel Needs in Modern Marinas" card has no author. All other cards show authors. Images lazy-load fine. |
| 5 | `/partners` | Smart Marina Connect — B2B Platform for the Marina Industry | ⚠️ | No | No | Yes | Generic page title (not page-specific) — minor SEO issue |
| 6 | `/network` | Network — Smart Marina Connect | ✅ | No | No | Yes | Marketplace loads with 3 orgs, sector filters, 4 tabs |
| 7 | `/become-partner` | Become a Member — Smart Marina Connect | ✅ | No | No | Yes | Clean how-it-works layout, no payment UI |
| 8 | `/tiers` | Membership & Sponsorship \| Smart Marina Connect | ✅ | No | No | Yes | No Stripe/payment UI ✅. CTAs are "Join for Free" / "Contact Us" |
| 9 | `/contact` | Smart Marina Connect — B2B Platform for the Marina Industry | ⚠️ | No | No | Yes | Generic page title (not page-specific) — minor SEO issue |
| 10 | `/terms` | Terms of Use — Smart Marina Connect | ❌ | No | No | Yes | **`info@m3monaco.com` × 1 occurrence** (baseline b) |
| 11 | `/privacy` | Privacy Policy — Smart Marina Connect | ❌ | No | No | Yes | **`info@m3monaco.com` × 4 occurrences** (General contact + Data protection officer fields — baseline b) |
| 12 | `/cookies` | Cookie Policy — Smart Marina Connect | ❌ | No | No | Yes | **`info@m3monaco.com` × 1 occurrence** (baseline b) |
| 13 | `/mentions-legales` | Legal Notice — Smart Marina Connect | ❌ | No | No | Yes | **`info@m3monaco.com` × 1 occurrence** (baseline b) |
| 14 | `/conditions-commerciales` | Commercial Terms — Smart Marina Connect | ❌ | No | No | Yes | **`info@m3monaco.com` × 1 occurrence** (baseline b) |

---

## Event Detail Smoke Test (Steps 15–17)

| Event Type | Title | Hero | Title | Date | Description | Registration Card | Status |
|-----------|-------|------|-------|------|-------------|-------------------|--------|
| **Webinar** | QA SAMPLE — Public Webinar TOMORROW: Sustainability in Marinas | Navy banner (no uploaded image) | ✅ | ✅ Fri 10 Apr 2026, 11:07–12:07 | ✅ | ✅ Guest quick signup form (0/300 spots) | ✅ |
| **On-site** | QA SAMPLE — On-Site Free Event: Marina Operators Meetup Nice | Navy banner (no uploaded image) | ✅ | ✅ Wed 29 Apr 2026, 11:07–14:07 | ✅ | ✅ "Log in to Register" (0/80 spots, Free) | ✅ |

Both layouts render correctly with all required elements. Speaker info shown on webinar. Location shown on on-site.

---

## Footer Link Health (Step 18)

| Link Text | URL | Target | rel | HTTP Status | Notes |
|-----------|-----|--------|-----|-------------|-------|
| LinkedIn | linkedin.com/company/monaco-marina-management | `_blank` | `noopener noreferrer` | ❌ **Redirects to /company/unavailable/** | **Baseline (c) STILL PRESENT** |
| Instagram | instagram.com/monacomarinamanagement/ | `_blank` | `noopener noreferrer` | ✅ 200 (GDPR consent screen) | OK |
| Resources | /resources | `_self` | — | ✅ 200 | Same-tab |
| Events | /events | `_self` | — | ✅ 200 | Same-tab |
| Partners | /partners | `_self` | — | ✅ 200 | Same-tab |
| Become a Member | /become-partner | `_self` | — | ✅ 200 | Same-tab |
| About | /about | `_self` | — | ✅ 200 | Same-tab |
| Contact | /contact | `_self` | — | ✅ 200 | Same-tab |
| Terms of Service | /terms | `_self` | — | ✅ 200 | Same-tab |
| Privacy Policy | /privacy | `_self` | — | ✅ 200 | Same-tab |
| Legal Notice | /mentions-legales | `_self` | — | ✅ 200 | Same-tab |
| Commercial Terms | /conditions-commerciales | `_self` | — | ✅ 200 | Same-tab |
| Cookie Policy | /cookies | `_self` | — | ✅ 200 | Same-tab |

External links correctly use `target="_blank"` + `rel="noopener noreferrer"` ✅

---

## Page-Level Text Search Results

All 14 pages + /join were searched. **No matches found** for: `connect.m3monaco.com`, `m3connect.mc`, `lorem ipsum`, `[object Object]`, standalone `undefined`, standalone `NaN`.

**`info@m3monaco.com`** found on 5 legal pages (8 total occurrences):
- `/terms` → 1
- `/privacy` → 4
- `/cookies` → 1
- `/mentions-legales` → 1
- `/conditions-commerciales` → 1

---

## Baseline Issues Status

| ID | Issue | Status | Details |
|----|-------|--------|---------|
| **(a)** | `/join` returns 404 instead of redirecting to `/become-partner` | ❌ **STILL PRESENT** | Shows custom 404 page. No redirect configured. |
| **(b)** | `info@m3monaco.com` on 5 legal pages | ❌ **STILL PRESENT** | 8 total occurrences across all 5 legal pages. Should be updated to the correct smartmarinaconnect.com email. |
| **(c)** | Footer LinkedIn → "Page isn't available" | ❌ **STILL PRESENT** | `linkedin.com/company/monaco-marina-management` redirects to `/company/unavailable/`. Need to update to correct LinkedIn company URL. |
| **(d)** | "Meeting Crew, Guest & Vessel Needs" resource card missing author | ❌ **STILL PRESENT** | All other resource cards display author(s); this one shows an empty placeholder icon with no name. |

---

## Summary

- **Total pages tested:** 14 (+1 /join = 15 URLs visited, + 2 event detail pages = 17 total)
- ✅ **Pass:** 5 (`/`, `/network`, `/become-partner`, `/tiers`, event details)
- ⚠️ **Warn:** 4 (`/about`, `/events`, `/partners`, `/contact` — SEO/content warnings)
- ❌ **Fail:** 5 (`/terms`, `/privacy`, `/cookies`, `/mentions-legales`, `/conditions-commerciales` — old email domain)

---

## P0 Issues (Fix before launch)

1. **`info@m3monaco.com` on all 5 legal pages (8 occurrences).** Users contacting this email will reach the wrong domain. **Fix:** Global find-and-replace in legal page content, replacing `info@m3monaco.com` with the correct `@smartmarinaconnect.com` address.

2. **Footer LinkedIn link is dead.** Every page links to a nonexistent LinkedIn company page. **Fix:** Update the href to the correct Smart Marina Connect LinkedIn company page URL in the shared Footer component.

## P1 Issues

3. **`/join` returns 404 with no redirect.** Old links or bookmarks will break. **Fix:** Add a redirect rule (`/join` → `/become-partner`) in the router or hosting config (Netlify `_redirects`).

4. **"Meeting Crew, Guest & Vessel Needs in Modern Marinas" resource card has no author.** Inconsistent with all other cards. **Fix:** Add the missing author(s) in the CMS/database for this resource.

5. **Only 5 upcoming events visible (spec says ≥10).** 10 QA events are seeded but only 5+1 show publicly. Some may be members-only or lack scheduled dates. **Fix:** Verify event visibility settings; ensure all 10 QA SAMPLE events are set to `public` with future dates, or clarify the expected count.

6. **Generic browser tab titles** on `/about`, `/partners`, `/contact` — all show "Smart Marina Connect — B2B Platform for the Marina Industry" instead of page-specific titles. **Fix:** Add unique `<title>` tags (e.g., "About — Smart Marina Connect", "Our Partners — Smart Marina Connect", "Contact Us — Smart Marina Connect").

# Guest Webinar Registration QA Report

## Test Results

| # | Test | HTTP Status | Email Received | .ics Valid | Result | Notes |
|---|------|------------|----------------|-----------|--------|-------|
| **1** | Happy path — register `qa-guest-1775737404821@mailinator.com` on QA SAMPLE Webinar TOMORROW | **200** ✅ (inferred from success UI) | ❌ **Not received** after 5+ min | N/A | ❌ | UI shows "You're registered for this webinar" + "We sent webinar details to…" — but **no email arrived at Mailinator**. Registration itself succeeded (spot counter went 0→1). |
| **2** | Duplicate prevention — same email, same event | **409** ✅ | N/A | N/A | ⚠️ | API returns `{"error":"This email is already registered for this webinar.","code":"DUPLICATE"}` — correct! But **UI does not display the error** — form sits silently with no feedback after submit. |
| **3a** | Validation: empty first name | N/A (blocked) | N/A | N/A | ✅ | Browser native "Please fill in this field." — submit blocked. |
| **3b** | Validation: invalid email "notanemail" | N/A (blocked) | N/A | N/A | ✅ | Browser native "Please include an '@'…" — submit blocked. |
| **3c** | Validation: disposable `foo@guerrillamail.com` | **200** ❌ | N/A | N/A | ❌ | **Registration succeeded!** guerrillamail.com was NOT blocked. UI showed success confirmation. |
| **3c+** | Validation: disposable `foo2@yopmail.com` (API) | **200** ❌ | N/A | N/A | ❌ | Also succeeded. **No disposable email filtering is active server-side** (except mailinator which is allowed). |
| **3d** | Validation: empty last name | N/A (blocked) | N/A | N/A | ✅ | Browser native validation blocks submit. |
| **4a** | Rate limit: 5/IP/hour — 6 rapid registrations | All 6 → **429** ✅ | N/A | N/A | ✅ | All returned `RATE_LIMIT_IP` because we already consumed 5 slots in earlier tests. Rate limiting is active. |
| **4b** | Rate limit: 3/email/hour — 4 different events, same email | All 4 → **429** | N/A | N/A | ⚠️ | **Untestable** from same IP — IP rate limit (5/hr) triggered first, masking the per-email limit. Would need a separate IP or a reset. |
| **5a** | On-site event: guest form must NOT appear | N/A | N/A | N/A | ✅ | Shows "Log in to Register" — no guest form. Correct. |
| **5b** | Paid on-site event gating | N/A | N/A | N/A | ✅ | Shows "Log in to Register" with "From €450 — see packages". No guest form. |
| **5c** | Invitation-only / member-only events | N/A | N/A | N/A | ⚠️ | **No invitation-only or member-only events visible** in the public event list. Cannot test — all 5 upcoming events are tagged "Public". |

---

## Pre-requisite Verification

| Check | Result |
|-------|--------|
| Logged out | ✅ Nav shows "Login" / "Sign Up" |
| ≥1 upcoming QA SAMPLE webinar exists | ✅ 3 webinars visible (TOMORROW, Smart Marina Trends, TBD) |
| Mailinator tab open | ✅ |

## Step 2 — Form UI Verification

| Element | Present | Notes |
|---------|---------|-------|
| Blue info banner "Quick signup — no account needed for public webinars" | ✅ | Light blue/gray banner with icon |
| First name * field | ✅ | Placeholder "John" |
| Last name * field | ✅ | Placeholder "Doe" |
| Email * field | ✅ | type="email", placeholder "you@company.com" |
| Company (optional) field | ✅ | Placeholder "Your organization" |
| "Register for Webinar" CTA | ✅ | Button with envelope icon |
| "Already have an account? Log in" | ✅ | Below CTA |
| Consent text | ✅ | "By registering, you agree to receive webinar-related emails…" |

---

## P0 Issues (Block launch)

**1. Confirmation email not delivered to Mailinator** — Registration via `qa-guest-1775737404821@mailinator.com` succeeded (200, success UI shown, spot counter incremented), but no email arrived in Mailinator's public inbox after 5+ minutes. Possible causes: Resend not triggering the send, mailinator being silently rejected by Resend/DNS, or the edge function not calling the email service. **Fix:** Check Resend dashboard logs for send status; verify the edge function actually calls the email API on success; test with a non-mailinator address to isolate.

**2. Disposable email domains not blocked** — `guerrillamail.com` and `yopmail.com` both return 200 and register successfully. The spec says only mailinator is the QA exception; other disposable domains should be blocked. **Fix:** Implement a disposable email domain blocklist in the `guest-webinar-register` edge function, with mailinator.com on the allowlist during QA.

## P1 Issues

**3. Duplicate registration — 409 response not shown in UI** — The API correctly returns 409 with `"This email is already registered for this webinar."`, but the frontend silently swallows it. The form just sits there with no error toast, inline error, or feedback. The user would have no idea the duplicate was rejected. **Fix:** Handle 409 in the frontend submit handler and display the error message from the response.

**4. Registration counter inconsistency** — After successful registration showing "1 / 300 spots", navigating away and back shows "0 / 300 spots" again. The count doesn't persist properly across page loads for anonymous users. **Fix:** Ensure the registration count query returns the correct current count on each page load.

## P2 Issues

**5. Per-email rate limit (3/email/hour) untestable** — The IP rate limit (5/IP/hr) fires first, making it impossible to verify the email rate limit from a single IP. Consider testing from a different IP or temporarily raising the IP limit.

**6. No invitation-only or member-only webinar events to test** — All 5 public upcoming events are tagged "Public". Cannot verify "Log in to Request Invitation" or member-only gating. Consider seeding test events with these access levels.

## P3 Issues

**7. Event pricing display on paid events** — The paid on-site event shows €450/€950/€180 pricing cards. While these are informational (not checkout), confirm this is intentional given Stripe/payments are removed. No actual payment flow exists — just "Log in to Register."

---

## Mailinator Addresses Used

| Email | Event | Purpose |
|-------|-------|---------|
| `qa-guest-1775737404821@mailinator.com` | `35ed58b5-…` (Webinar TOMORROW) | Test 1: Happy path |
| `qa-guest-test2-1775737974834@mailinator.com` | `35ed58b5-…` | API verification of 200 status |
| `foo@guerrillamail.com` | `35ed58b5-…` | Test 3c: Disposable domain (should have been blocked) |
| `foo2@yopmail.com` | `35ed58b5-…` | Test 3c+: Disposable domain (should have been blocked) |
| `qa-guest-rate-1@mailinator.com` through `qa-guest-rate-6@mailinator.com` | `35ed58b5-…` | Test 4a: Rate limiting (all 429'd — none registered) |
| `qa-guest-emailrate@mailinator.com` | Multiple | Test 4b: Email rate limit (all 429'd — none registered) |

## Event IDs Registered Against

| Event ID | Event Title | Registrations |
|----------|------------|---------------|
| `35ed58b5-e182-4655-adff-1ff9651ca5bf` | QA SAMPLE — Public Webinar TOMORROW: Sustainability in Marinas | `qa-guest-1775737404821@mailinator.com`, `qa-guest-test2-1775737974834@mailinator.com`, `foo@guerrillamail.com`, `foo2@yopmail.com` |


## Action items before launch
| # | Priority | Description | Owner |
|---|---|---|---|
```
