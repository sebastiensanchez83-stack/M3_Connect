# Prompt 03 — Marina signup & onboarding

**Admin intervention needed:** No (admin approval comes later in Prompt 06)

**Background (context for Claude, not to paste):**
- Email confirmation is DISABLED in Supabase Auth for QA. Signup must log the user in immediately.
- The post-signup redirect is `/account?tab=organization`, NOT `/onboarding` (there is no
  standalone /onboarding route anymore).
- Mailinator addresses are temporarily allowed by a patch in `SignupForm.tsx` (post-QA revert).
- The marina onboarding is a multi-section form rendered inside the Organization tab of
  AccountPage. The correct field labels are "Total Berths", "Longest Berth", "Facilities",
  "Sectors of Interest", "Future Plans".

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
- Org name:    "QA2 Test Marina <timestamp>"
- Country:     Monaco
- Persona:     Marina

=== Steps ===

1.  From the homepage click "Become a Member" / "Join" in the nav.
2.  Pick "Marina" persona and fill the signup form with the credentials above.
3.  Submit.
    ✅ Expected: immediate login, auto-redirect to /account?tab=organization.
    ❌ If you see any "Check your email to confirm" screen → flag P0 (email confirm should be off).
    ❌ If you're redirected to /onboarding (old route) → flag P0.

4.  On the Organization tab, fill the marina onboarding form:
    - Total Berths: 250
    - Longest Berth (m): 80
    - Facilities: pick 3+ checkboxes (fuel, water, electricity, etc.)
    - Sectors of Interest: pick 2–3 sectors
    - Future Plans: pick 1–2 items if available
    - Any other required fields (website, contact phone, description…)
5.  Submit the Organization form.
    ✅ Expected: success toast, page stays on /account?tab=organization, and a
       "Pending Verification" (or equivalent) banner is now visible at the top of AccountPage.

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

P0 — "Check your email" screen appears; signup returns 4xx/5xx; redirect goes to /onboarding;
     organization submit returns 4xx/5xx (capture body); pending banner missing after submit;
     any gated route shows the real form instead of the lock.
P1 — Unclear pending-state copy; missing contact/help link; broken validation.
P2 — Styling issues at 1440×900.
P3 — Copy polish.

=== Save for Prompt 06 ===
- Email used: qa2-marina-<timestamp>@mailinator.com
- Org name:   QA2 Test Marina <timestamp>
- User UUID (grab from /account URL or supabase.auth getSession in console if visible)

Report format:
| Step | Expected | Actual | Status |
```
