# Prompt 03 — Marina signup & onboarding

**Admin intervention needed:** No (admin approval comes later in Prompt 06)

**Background (context for Claude, not to paste):**
- Email confirmation is DISABLED in Supabase Auth for QA. Signup must log the user in immediately.
- **Post-signup flow:**
  1. Signup (SignupForm on /become-partner) → `navigate('/onboarding')`
  2. `/onboarding` (OnboardingPage) renders persona selection + the full marina form
     (`marina_name`, `country`, `city`, `website`, `marina_type`, `berths_count`,
     `superyacht_berths`, `longest_berth_meters`, certifications, facilities, description, etc.)
  3. Submitting the marina form flips `profile.onboarding_status` from `draft` → `submitted`
  4. `AuthRedirector` then routes to `/account`
  5. AccountPage shows the pending-verification banner + a "complete-registration" tab
     for anything still draft
- Mailinator addresses are temporarily allowed by a patch in `SignupForm.tsx` (post-QA revert).

## Copy-paste to Claude Chrome

```
Test the marina signup + onboarding flow on https://smartmarinaconnect.com.

=== Pre-requisites ===
- Logged OUT (fresh incognito preferred)
- Mailinator tab open
- Note the exact timestamp you start — you'll reuse it in the email + org name

=== Test credentials ===
- Email:       qa2-marina-<timestamp>@mailinator.com
- Password:    TestQa!2026SecurePass
- First name:  Marina
- Last name:   Tester
- Marina name: "QA2 Test Marina <timestamp>"
- Country:     Monaco
- City:        Monaco
- Persona:     Marina

=== Steps ===

1.  From the homepage click "Become a Member" / "Join" → /become-partner.
2.  Click the Marina persona card → the SignupForm opens.
3.  Fill the signup form with the credentials above and submit.
    ✅ Expected: immediate login, auto-redirect to **/onboarding**.
    ❌ If you see any "Check your email to confirm" screen → flag P0 (email confirm should be off).
    ❌ If signup returns 4xx/5xx → flag P0 (capture the response body).

4.  On /onboarding, confirm the Marina persona is already selected (or select it),
    then fill the marina organization form:
    - Marina name: "QA2 Test Marina <ts>"
    - Country: Monaco
    - City: Monaco
    - Website: https://example.com
    - Marina type: pick one
    - Total berths: 250
    - Superyacht berths: 20
    - Longest berth (m): 80
    - Fresh water available: yes
    - Certifications: pick 1–2 (e.g. Blue Flag)
    - Facilities checkboxes: yacht club / sailing school / boat yard / restaurants / concierge
      (pick 3+)
    - Marina description + services description (>50 chars each)
    - Sectors of interest: pick 2–3
    - Future plans: pick 1–2 with timelines
5.  Submit the onboarding form.
    ✅ Expected: success toast, `onboarding_status` flips to `submitted`,
       redirect to /account with a "Pending Verification" banner at the top.
    ❌ If the submit returns 4xx/5xx → P0 (capture body).
    ❌ If /account doesn't show the pending banner → P0.

6.  Gated route checks — for a pending user, verify each of these is locked:
    - /submit-project      → locked / "must be verified" message, NO form shown
    - /request-webinar     → locked
    - /submit-rfp          → locked
    - /submit-consultation → locked
    - /network             → either hidden or read-only with lock icons
    Capture the exact copy of whatever lock message is shown.

7.  Back on /account, evaluate the pending banner:
    - Is it clear what happens next?
    - Does it mention expected review time?
    - Is there a "contact support" link?

8.  Open the navbar user menu:
    - Does it show the pending state (e.g. badge, icon)?
    - Is there a logout action? Log out and confirm redirect to home.

9.  Try to log back in with the same credentials.
    ✅ Expected: you land back on /account in pending state.

=== Things to flag ===

P0 — "Check your email" screen appears; signup returns 4xx/5xx;
     onboarding submit returns 4xx/5xx (capture body);
     pending banner missing after submit;
     any gated route shows the real form instead of the lock.
P1 — Unclear pending-state copy; missing contact/help link; broken validation.
P2 — Styling issues at 1440×900.
P3 — Copy polish.

=== Save for Prompt 06 ===
- Email used: qa2-marina-<timestamp>@mailinator.com
- Marina name: QA2 Test Marina <timestamp>
- User UUID (grab from /account URL or supabase.auth getSession in console if visible)

Report format:
| Step | Expected | Actual | Status |
```
