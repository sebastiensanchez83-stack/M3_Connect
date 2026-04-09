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

## Action items before launch
| # | Priority | Description | Owner |
|---|---|---|---|
```
