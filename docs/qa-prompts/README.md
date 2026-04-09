# Smart Marina Connect — Pre-Launch QA Prompts for Claude Chrome

This folder contains copy-paste ready QA prompts for running a comprehensive pre-launch audit of https://smartmarinaconnect.com using Claude Chrome.

**⚠️ Version 2 (2026-04-09)** — fully rewritten after the audit session. All known root-cause bugs (guest webinar 500, reference-email 401, send-status-notification 401, `registration_type='guest'` check constraint, REQUIRED_REFERENCES enforcement) are fixed. Every prompt now has explicit **🛑 ADMIN CHECKPOINT** markers where Sebastien must intervene.

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
- If something is blocked (captcha, 2FA, email never arrives after 3 min, etc.), pause and tell Sebastien
- Only delete/modify items whose title/name contains "QA" or "TEST"
- When you hit a 🛑 marker in a prompt, STOP and tell Sebastien you need his admin action before continuing

CURRENT PLATFORM STATE (2026-04-09):
- Email confirmation for signup is DISABLED for QA. Signup logs users in immediately with NO "check your email" step. Flag as BUG if you see that screen.
- Transactional emails (guest-webinar confirmation with .ics, reference verification, approval/rejection notifications, 24h webinar reminders) ARE enabled and send via Resend.
- Expected sender: noreply@smartmarinaconnect.com (NOT m3monaco.com — flag old domain).
- Stripe/payments are REMOVED — there should be no payment UI anywhere.
- Mailinator is currently ALLOWED as a signup email domain (temporary QA patch in SignupForm.tsx; will be reverted post-QA).
- 10 QA SAMPLE events are seeded in the DB (titles start with "QA SAMPLE —"). Do NOT delete them.
- After signup, users redirect to /account?tab=organization (NOT /onboarding — there is no dedicated /onboarding route).
- Partners need 2 confirmed client references OR an approved bypass request before admin can verify them.
- Admin panel lives at /admin. Sebastien's admin account is the only user with persona='admin'.

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
| Read Sebastien's real email inbox | Use **mailinator.com** temp addresses only |
| Approve a user while the pending user is also logged in | Use a **separate Chrome profile** for admin OR log out between steps |
| Real payment flows | N/A — Stripe removed from platform |
| OAuth/SSO popup flows | Flag and skip |
| Real document uploads | Use **picsum.photos** for images, tiny dummy PDFs |
| CAPTCHA / bot challenges | Pause and alert Sebastien manually |
| Clicking "Approve" buttons in admin panel | 🛑 Sebastien does these manually at checkpoints |

## 🛑 Admin Checkpoint legend

When you see this marker in a prompt:

> **🛑 ADMIN CHECKPOINT — Sebastien does this**
> Action: <what Sebastien does>
> Resume after: <signal Claude should receive>

Claude Chrome must stop, report the current state, and wait for Sebastien to confirm completion before continuing.

## Pre-flight (do this ONCE before running any prompt)

Sebastien's checklist before starting QA:

- [ ] Verify mailinator patch is deployed (signup form accepts `@mailinator.com`)
- [ ] Verify 10 QA SAMPLE events exist in /admin/events
- [ ] Open https://smartmarinaconnect.com in Chrome Profile A (QA test profile, logged out)
- [ ] Open https://smartmarinaconnect.com/admin in Chrome Profile B (Sebastien's admin account, logged in)
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
Run by: Sebastien / Claude Chrome

## Summary
- Total prompts run: X / 14
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
