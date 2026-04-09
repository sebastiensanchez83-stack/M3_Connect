# Prompt 03 — Marina signup & onboarding

## Copy-paste to Claude Chrome

```
Test the marina signup flow at https://smartmarinaconnect.com

CONTEXT: Email confirmation is currently DISABLED for QA. Signup should log the user in immediately with NO email verification step. If you see a "Check your email" screen during this flow, flag it as a BUG.

Use these test credentials (replace {timestamp} with the current unix timestamp):
- Email: qa-marina-{timestamp}@mailinator.com
- Password: TestQa!2026SecurePass
- First name: Marina
- Last name: Tester
- Organization name: "QA Test Marina {timestamp}"
- Country: Monaco
- Persona: Marina

STEPS:

1. From the homepage, click "Become a Member" or "Join" in the nav.

2. Complete the signup form with the credentials above. Select persona "Marina".

3. Submit the form.

4. EXPECTED: immediate login, auto-redirect to /onboarding (no email verification step, no "check your email" screen).

5. On the onboarding page, fill in all required marina fields:
   - Number of berths (pick a realistic number, e.g. 250)
   - Length range (e.g. min 10m, max 80m)
   - Services offered (select 3+ checkboxes)
   - Sectors of interest (select 2-3)
   - Future plans (pick 1-2 if available)
   - Any other required fields

6. Submit onboarding.

7. EXPECTED: redirect to /account with a "Pending Verification" (or similar) banner at the top.

8. Navigate to /submit-project:
   - EXPECTED: shows a locked/pending state or a message like "Your account must be verified to submit projects"
   - Should NOT crash or show the project form

9. Navigate to /request-webinar:
   - EXPECTED: same locked/pending state

10. Navigate to /submit-rfp:
    - EXPECTED: same locked/pending state

11. Go back to /account. Read the pending banner text carefully:
    - Is it clear what the user needs to do next?
    - Is there a "contact support" link?
    - Does it mention how long verification takes?

12. Log out via the user menu in the navbar.

SPECIFIC THINGS TO FLAG:

- (P0) "Check your email" screen appears → email confirmation is supposed to be off for QA
- (P0) Signup form rejects valid input with generic error
- (P0) Onboarding submission returns 4xx/5xx → capture the response body
- (P0) After onboarding, /account doesn't show pending banner
- (P0) /submit-project or /request-webinar shows the actual form (not locked) for a pending user
- (P1) Pending banner text is unclear or missing actions
- (P1) Any field validation is confusing or fails to give feedback
- (P2) Form styling is broken on desktop 1440px

SAVE THESE FOR PROMPT 06:
- The test email used: qa-marina-{timestamp}@mailinator.com
- The test organization name: "QA Test Marina {timestamp}"

Report format:
| Step | Expected | Actual | Status (✅/⚠️/❌) |

At the end, give pass/fail count and list any P0/P1 issues.
```
