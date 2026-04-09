# Prompt 02 — Guest webinar signup (lightweight, anonymous)

**Admin intervention needed:** No

**Background (context for Claude, not to paste):**
The previous run hit a P0 bug: `guest-webinar-register` returned HTTP 500 with
`event_registrations_registration_type_check` violation. The DB constraint did not allow
`registration_type='guest'`. This is now fixed (migration `add_guest_to_registration_type_check`).
The edge function inserts the guest row and then calls `send-guest-webinar-confirmation`, which
emails via Resend from `noreply@smartmarinaconnect.com` with an .ics calendar attachment.

## Copy-paste to Claude Chrome

```
Test the anonymous "Join webinar as guest" flow on https://smartmarinaconnect.com.

Pre-requisites (verify before starting):
- You are LOGGED OUT (open incognito or clear cookies)
- At least one upcoming event with "QA SAMPLE —" in the title exists on /events
- Mailinator tab open: https://www.mailinator.com/v4/public/inboxes.jsp

=== Test 1: Happy path ===

1.  Go to /events and pick an upcoming WEBINAR whose title starts with "QA SAMPLE —".
    Note the title, date, and event ID (from URL).
2.  Open the event detail page. Verify:
    - Blue info banner "Quick signup — no account needed for public webinars"
    - Fields: First name, Last name, Email, Company (optional)
    - "Register for Webinar" CTA
    - Small "Already have an account? Log in" footer
3.  Fill:
    - First: QA
    - Last: GuestOne
    - Email: qa-guest-<timestamp>@mailinator.com (write it down)
    - Company: QA Test Co
4.  Submit and capture:
    - HTTP status of POST to /functions/v1/guest-webinar-register
      → MUST be 200 (the old 500 check-constraint bug is fixed)
    - Any red console errors
    - Success UI: "You're registered for this webinar"
5.  Open Mailinator (public inbox for that handle) and verify within 90s:
    - Email from noreply@smartmarinaconnect.com (flag if old m3monaco.com domain)
    - Subject mentions the event title
    - Body contains date/time and a "Join webinar" link
    - An .ics attachment is present — download and open it; must show correct date/time
6.  Screenshot the success state + the received email.

=== Test 2: Duplicate prevention ===

7.  Without clearing cookies, re-submit the same email on the same event.
    Expected: friendly "Already registered" error, NO 500.
    Capture the HTTP status and message.

=== Test 3: Validation ===

8.  Try these and capture behavior:
    - Empty first name → inline error, submit blocked
    - Invalid email "notanemail" → inline error, submit blocked
    - Disposable non-mailinator domain (foo@guerrillamail.com) → should be BLOCKED
      (mailinator is a temporary QA exception; all other disposables stay blocked)
    - Missing consent / empty required field → submit disabled

=== Test 4: Rate limiting ===

9.  In a fresh incognito window (same IP), register 6 different mailinator emails
    (qa-guest-rate-1..6@mailinator.com) on any QA SAMPLE webinar as fast as possible.
    Expected: 6th call is rate-limited (5/IP/hour). Capture status + message.
10. Separately, try 4 different QA SAMPLE webinars with the SAME email within 1h.
    Expected: 4th call rate-limited (3/email/hour).

=== Test 5: Gating on non-webinar events ===

11. On an on-site QA SAMPLE event: the guest form must NOT appear; instead "Log in to Register".
12. On an invitation-only event (if any): "Log in to Request Invitation".
13. On a member-only webinar (if any): "Log in to Register".

=== Report format ===

| # | Test | HTTP status | Email received | .ics valid | Result ✅/⚠️/❌ | Notes |

P0 = any 500, no email received, .ics missing/broken, form appears on non-public-webinar
P1 = duplicate not prevented, rate limit not enforced
P2 = validation messaging unclear
P3 = copy polish

At the end, list:
- Every mailinator address you used
- Every event ID you registered against
(so Sebastien can clean them up post-QA)
```
