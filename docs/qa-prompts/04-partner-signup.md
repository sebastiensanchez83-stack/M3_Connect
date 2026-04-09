# Prompt 04 — Partner signup with references

## Copy-paste to Claude Chrome

```
Test the partner signup flow at https://smartmarinaconnect.com

CONTEXT:
- Email confirmation for signup itself is DISABLED (user goes straight to onboarding, no "check your email" screen).
- However, the REFERENCE verification emails sent after onboarding submission are a SEPARATE system (edge function `send-reference-email`) and SHOULD still arrive in mailinator.
- Reference emails should come from noreply@smartmarinaconnect.com (NOT m3monaco.com — flag if old domain).

Use these test credentials (replace {timestamp} with the current unix timestamp):
- Email: qa-partner-{timestamp}@mailinator.com
- Password: TestQa!2026SecurePass
- First name: Partner
- Last name: Tester
- Organization name: "QA Partner Services {timestamp}"
- Country: Monaco
- Persona: Partner (service provider)

STEPS:

1. From the homepage, click "Become a Member" or "Join".

2. Complete signup with credentials above. Select persona "Partner".

3. Submit → EXPECTED: immediate login, auto-redirect to /onboarding (NO email verification step).

4. On the onboarding page fill partner-specific fields:
   - Company name: "QA Partner Services {timestamp}"
   - Select 2-3 service sectors (e.g. "Fuel & Bunkering", "Dredging", "IT & Software")
   - Company description (any text >50 chars)
   - Any other required fields

5. Reach the References section. Add 2 references:
   - Reference 1: First "Ref", Last "One", Email "ref1-{timestamp}@mailinator.com", Company "QA Marina Alpha", Role "Harbour Master"
   - Reference 2: First "Ref", Last "Two", Email "ref2-{timestamp}@mailinator.com", Company "QA Marina Beta", Role "General Manager"

6. Submit onboarding.

7. EXPECTED: redirect to /account with a status banner showing "Awaiting references" or similar.

8. On /account, verify both references are listed with status "pending" (or "awaiting response").

9. Open a new tab. Check BOTH reference mailboxes at:
   - https://www.mailinator.com/v4/public/inboxes.jsp?to=ref1-{timestamp}
   - https://www.mailinator.com/v4/public/inboxes.jsp?to=ref2-{timestamp}

10. For EACH mailbox verify:
    - A reference verification email arrived within 2 minutes
    - Sender: `noreply@smartmarinaconnect.com` (NOT m3monaco.com)
    - Subject mentions Smart Marina Connect and references
    - Body contains a clickable verification link
    - Body mentions the partner's name "QA Partner Services {timestamp}"

11. Click the verification link in Ref 1's email → should land on a page confirming the reference was received.

12. Leave Ref 2's email unclicked (we'll test the "still pending" state in prompt 06).

13. Go back to /account — after a page refresh, Ref 1 should show "verified" or "confirmed", Ref 2 still "pending".

14. Verify the partner still has pending/awaiting-review status (not yet approved).

15. Log out.

SPECIFIC THINGS TO FLAG:

- (P0) "Check your email" screen appears for the partner's own signup → bug
- (P0) Reference emails don't arrive within 2 minutes → Resend/DNS/edge-function issue. Check Supabase function logs if accessible.
- (P0) Reference email sender is NOT @smartmarinaconnect.com → sender domain bug
- (P0) Reference email lands in Spam folder in mailinator → DNS/SPF/DKIM issue
- (P0) Verification link returns 404 or a crash
- (P1) Email body has broken formatting or missing partner name
- (P1) After clicking verify, /account doesn't reflect the updated ref status on refresh
- (P1) Reference list on /account doesn't show sent status
- (P2) Email design looks unprofessional or has unstyled HTML

SAVE THESE FOR PROMPT 06:
- Partner email: qa-partner-{timestamp}@mailinator.com
- Partner org name: "QA Partner Services {timestamp}"
- Which reference was verified (Ref 1) and which was not (Ref 2)

Report format:
| Step | Expected | Actual | Status |

At the end, give pass/fail count and list P0/P1 issues.
```
