# Prompt 06 — Admin user approval flow

## Prerequisites
- Prompts 03 and 04 completed (creates 1 pending marina user + 1 pending partner user)
- Admin logged in as Sebastien's admin account

## Copy-paste to Claude Chrome

```
Test the admin user approval flow at https://smartmarinaconnect.com/admin/users

CONTEXT:
- Sebastien is logged in as admin.
- From Prompt 03 there is a pending marina user with email starting with "qa-marina-".
- From Prompt 04 there is a pending partner user with email starting with "qa-partner-".
- The Partner has Reference 1 verified and Reference 2 still pending.
- Approve and Reject emails are sent via edge function `send-status-notification` — these DO still send even though signup confirmation is off.

STEPS:

=== PART A: Approve the QA marina ===

1. Go to /admin/users. Apply filter "Pending" to narrow the list.

2. Find the user whose email starts with "qa-marina-" (from Prompt 03). Click into their detail page.

3. Verify the detail page shows:
   - Correct name "Marina Tester"
   - Organization "QA Test Marina {timestamp}"
   - Persona: Marina
   - Status: Pending
   - All onboarding info (berths, services, sectors)

4. Click the "Approve" (or "Verify") button.

5. A dialog should open with a confirmation message. Confirm.

6. EXPECTED:
   - Success toast
   - User's status updates to "Verified"
   - Page auto-refreshes or shows the new status

7. Open a new tab and go to https://www.mailinator.com/v4/public/inboxes.jsp?to=qa-marina-{timestamp}

8. EXPECTED: within 1 minute, an approval email arrives.
   - Sender: noreply@smartmarinaconnect.com
   - Subject contains "approved" or "welcome"
   - Body mentions the user's first name
   - Body has a "Log in" button linking to https://smartmarinaconnect.com

9. Log out as admin.

10. Log in as the QA marina with password "TestQa!2026SecurePass".

11. Verify:
    - /account no longer shows the pending banner
    - /submit-project is now accessible (shows the form, not locked state)
    - /request-webinar is now accessible
    - /submit-rfp is now accessible
    - Navbar shows "Submit Project" + "Propose Webinar" links

12. Log out.

=== PART B: Reject a test user (create one first if needed) ===

13. Log back in as admin.

14. Go to /admin/users. Look for another pending QA user. If there's no second pending QA user, go to /join and quickly create one:
    - Email: qa-reject-{timestamp}@mailinator.com
    - Password: TestQa!2026SecurePass
    - Name: Reject Tester
    - Persona: Marina
    - Org: "QA Reject Test"
    - Complete onboarding with minimal fields
    - Log out
    - Log back in as admin

15. In /admin/users find the qa-reject- user. Click their row.

16. Click "Reject".

17. A dialog should open with a REQUIRED rejection reason textarea. Fill: "QA test rejection — please ignore."

18. Confirm rejection.

19. EXPECTED:
    - Success toast
    - User status updates to "Rejected"
    - Rejection reason saved and visible in admin

20. Check mailinator at qa-reject-{timestamp}:
    - Rejection email arrived
    - Sender: noreply@smartmarinaconnect.com
    - Body mentions the rejection reason
    - Body has an "Update my profile" or similar link

=== PART C: Partner approval with pending references ===

21. Log in as admin. Go to /admin/users → Pending.

22. Find the qa-partner- user from Prompt 04. Click their detail page.

23. Verify the references section shows:
    - Reference 1: verified ✅
    - Reference 2: pending ⏳

24. Try to click "Approve".

25. The admin should see either:
    - (A) An approve button that works (admin can force-approve even with pending refs), OR
    - (B) A warning that refs are incomplete, with an option to override

    Either behavior is acceptable — note which one you see.

26. If you can approve, do so. Check mailinator qa-partner-{timestamp} for the approval email.

27. Log out as admin, log in as the QA partner, verify /account no longer shows pending.

=== PART D: Suspend test ===

28. Log back in as admin.

29. Go to /admin/users, find any VERIFIED user whose email starts with "qa-" (prefer one of the ones you just approved).

30. Click their detail page. Click "Suspend".

31. Dialog should open with confirmation. Confirm.

32. EXPECTED: status changes to "Suspended".

33. Check mailinator for a suspension email (may or may not be implemented — flag if missing as P2).

34. Click "Re-activate" or "Verify" to restore the user.

SPECIFIC THINGS TO FLAG:

- (P0) Approval does not update the user's status
- (P0) Approval email does not arrive within 2 minutes
- (P0) Approval email sender is m3monaco.com (wrong domain)
- (P0) Approved user still sees pending banner on /account after login
- (P0) /submit-project is still locked for the approved marina
- (P0) Rejection reason not saved in DB or not shown in email
- (P1) Email body is unstyled or missing personalization
- (P1) Suspend action does not work or shows error
- (P2) Missing "reactivate" path for suspended users

Report format:
| Action | User | Email arrived (y/n) | User state updated | Issues |

At the end, list pass/fail count and P0 issues.
```
