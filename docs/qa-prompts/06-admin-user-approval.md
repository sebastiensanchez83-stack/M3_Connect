# Prompt 06 — Admin user approval flow

**Admin intervention needed:** Yes — this prompt IS the admin flow. Sebastien must be logged in
as admin in THIS Chrome profile for the whole prompt. All approve/reject/suspend clicks are
executed by Claude inside that session.

**Background (context for Claude, not to paste):**
- `send-status-notification` was previously returning 401 at the Supabase gateway. It is now
  redeployed with `verify_jwt: false` and requires the frontend to pass an `x-caller-user-id`
  header. `AdminUsers.tsx` was updated to send it. The function internally verifies that the
  caller has `persona IN ('admin','moderator')` and `access_status='verified'`. So approval /
  rejection / suspend emails should now actually reach Resend.
- Prompts 03 and 04 created pending users. This prompt acts on them.
- The marina created in Prompt 03 has NO references (marinas don't need refs).
- The partner from Prompt 04 Path A should have 2 confirmed references by this point.
  The partner from Path B should have an approved bypass request.

## Copy-paste to Claude Chrome

```
Test admin user approval / rejection / suspend on https://smartmarinaconnect.com/admin/users.

=== Pre-requisites ===
- Sebastien is logged in as admin in THIS Chrome profile.
- Prompts 03 and 04 have been completed (test users exist in Pending state).
- Mailinator tab open.
- Do NOT log out of the admin session until the prompt asks you to.

=== PART A — Approve the QA marina (from Prompt 03) ===

1.  /admin/users → filter Pending.
2.  Find the user whose email starts with "qa-marina-". Open detail page.
3.  Verify fields: name "Marina Tester", org "QA Test Marina ...", persona Marina,
    onboarding info (berths, facilities, sectors) all present.
4.  Click "Approve" → confirm in the dialog.
    ✅ Expected: toast success, status → Verified, row updates.
    ❌ If the network call to send-status-notification returns 401/403 → P0 regression
       (check the x-caller-user-id header in devtools Network tab).
5.  Open mailinator for qa-marina-<ts>. Within 90s expect:
    - Sender: noreply@smartmarinaconnect.com (flag m3monaco.com)
    - Subject: "approved" / "welcome"
    - Body mentions first name + a "Log in" CTA linking to smartmarinaconnect.com

6.  🛑 ADMIN CHECKPOINT — Sebastien does this
    Action: log out of admin (use user menu). Then log in as the QA marina
    (qa-marina-<ts>@mailinator.com / TestQa!2026SecurePass).
    Resume after: Sebastien tells Claude "logged in as marina".

7.  On /account verify:
    - No pending banner
    - /submit-project, /request-webinar, /submit-rfp, /submit-consultation all show the real form
    - Navbar now shows "Submit Project" + "Propose Webinar"

8.  🛑 ADMIN CHECKPOINT — Sebastien logs back in as admin.
    Resume after: "back as admin".

=== PART B — Approve the QA partner (Path A, from Prompt 04) ===

9.  /admin/users → Pending. Find qa-partner-<ts>. Open detail.
10. Verify both references show "confirmed". If either is still pending → P0 (Prompt 04
    bug or reference-click flow broken).
11. Click "Approve". Confirm dialog.
    ✅ Expected: status → Verified, email sent.
12. Check mailinator for approval email (same checks as step 5).

=== PART C — Approve the Path-B partner (bypass) ===

13. Find qa-partner-bypass-<ts>. Open detail.
14. Verify the bypass request is visible and marked "approved" (from Prompt 04 Path B).
15. Click "Approve" user. Confirm.
16. Verify approval email in mailinator.

=== PART D — Reject a test user ===

17. If no additional pending QA user exists, signup a throwaway Marina in a separate tab:
    - qa-reject-<ts>@mailinator.com / TestQa!2026SecurePass / Reject Tester / "QA Reject Test"
    - Fill minimal onboarding fields and log out.
    🛑 ADMIN CHECKPOINT — Sebastien logs back in as admin after creating the reject user.

18. In /admin/users → Pending, open qa-reject-<ts>.
19. Click "Reject". The dialog MUST require a rejection reason (textarea).
    Fill: "QA test rejection — please ignore."
20. Confirm.
    ✅ Expected: status → Rejected, reason saved and visible in admin.
21. Check mailinator for rejection email. Body must mention the rejection reason and an
    "Update my profile" link.

=== PART E — Suspend / Re-activate ===

22. Pick one of the verified QA users from Part A/B/C. Open detail → "Suspend".
23. Confirm dialog.
    ✅ Expected: status → Suspended.
24. Check mailinator for a suspension email (P2 if missing).
25. Click "Re-activate" / "Verify" → status returns to Verified.

=== Flag ===

P0 — Approve/Reject/Suspend action fails or returns 4xx/5xx
P0 — Any email does not arrive within 2 minutes
P0 — Email sender is m3monaco.com
P0 — Approved user still sees pending banner after login
P0 — /submit-project still locked for approved marina
P0 — Rejection reason not persisted or not shown in email
P1 — Email body unstyled or missing personalization
P1 — Suspend error, no re-activate path
P2 — Missing suspension notification email

Report format:
| Action | User | HTTP status | Email received | State updated | Notes |
```
