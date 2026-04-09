# Prompt 13 — Reference confirm / reject deep test

**Admin intervention needed:** Yes — to verify the admin sees the updated reference states.

**Background (context for Claude, not to paste):**
- Reference emails are now sent through `send-reference-email` (verify_jwt=false redeployed).
- Each reference email has two CTAs: "Confirm" and "Reject". Both land on a page that
  updates `reference_requests.status` via a signed token.
- Prompt 04 Path A already tested the happy "Confirm" path. This prompt hammers the edge
  cases: reject, expired token, double-click, tampered token.

## Copy-paste to Claude Chrome

```
Deep-test the reference confirm/reject links on https://smartmarinaconnect.com.

=== Pre-requisites ===
- A fresh QA partner signup (NOT the one from Prompt 04 — we want clean references).
- Mailinator tab open.

=== Steps ===

1.  Signup a NEW partner with:
    - Email: qa2-partner-refs-<ts>@mailinator.com
    - Org:   "QA2 Partner Refs <ts>"
    Fill onboarding, add 3 references:
      - qa2-ref-confirm-<ts>@mailinator.com
      - qa2-ref-reject-<ts>@mailinator.com
      - qa2-ref-tamper-<ts>@mailinator.com

2.  Confirm all 3 emails arrive in their mailinator inboxes (sender noreply@smartmarinaconnect.com).

=== Test A: Happy confirm ===

3.  Open ref-confirm's email → click "Confirm".
    ✅ Expected: landing page with clear "Thanks, reference confirmed" message.
4.  Reload the landing page.
    ✅ Expected: idempotent — either same confirmation message, or a friendly "already confirmed"
    (NOT a crash, NOT a 500).

=== Test B: Reject path ===

5.  Open ref-reject's email → click "Reject".
    ✅ Expected: landing page asks for an optional reason, then shows a "reference rejected"
    confirmation.
6.  Reload the landing page.
    ✅ Expected: idempotent — no crash.

=== Test C: Tampered token ===

7.  Open ref-tamper's email. Copy the confirm link. In a new tab, modify the last few chars
    of the token and open it.
    ✅ Expected: clear "Invalid or expired link" error page, NOT a 500 or blank screen.
    Do NOT attempt to brute-force the token.

=== Test D: Old/expired token (if expiry exists) ===

8.  If the link includes an expiry timestamp parameter, try loading the unmodified link after
    a simulated time skip (skip if not easily testable — just document the behavior).

=== Test E: Admin visibility ===

9.  🛑 ADMIN CHECKPOINT — Sebastien logs in as admin in Profile B.
10. /admin/users → find qa2-partner-refs-<ts>. Open detail → references section.
    ✅ Expected:
      - ref-confirm → "Confirmed"
      - ref-reject  → "Rejected"
      - ref-tamper  → still "Pending"
    Partner overall status: still pending (only 1 confirmed ref, needs 2).

=== Test F: Partner view ===

11. Log in as the partner. /account → verify the same reference statuses are shown to the
    partner (confirmed/rejected/pending visible with consistent labels).

=== Flag ===

P0 — 500 on confirm/reject landing; tampered token returns 500; crash on double-click;
     statuses don't persist in DB.
P1 — idempotency broken; rejection reason not captured.
P2 — landing page styling inconsistent with the rest of the app.

Report format: | Test | Expected | Actual | Status |
```
