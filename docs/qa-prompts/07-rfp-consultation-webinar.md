# Prompt 07 — Verified marina flows: RFP, Consultation, Webinar request, Project

## Prerequisites
- Prompt 06 completed: a QA marina user is now verified
- Marina credentials known from Prompt 03

## Copy-paste to Claude Chrome

```
Test the verified marina submission flows at https://smartmarinaconnect.com

CONTEXT:
- Log in as the QA marina user approved in Prompt 06:
  - Email: qa-marina-{timestamp}@mailinator.com
  - Password: TestQa!2026SecurePass

STEPS:

=== PART A: Submit RFP ===

1. Log in as the QA marina.
2. Navigate to /submit-rfp (or via navbar "Submit RFP").
3. Fill:
   - Title: "QA Test RFP — Dredging needed {timestamp}"
   - Scope: "QA test description — looking for dredging services to maintain draft depth at our entrance channel. Estimated volume: 5000 m³. Safe to reject." (must be >50 chars)
   - Sector(s): pick 2 relevant (e.g. "Dredging", "Marine Engineering")
   - Deadline: 30 days from today
   - Any attachments field: leave empty OR upload a tiny dummy PDF if required
4. Submit.
5. EXPECTED: success toast + redirect to /account or /submit-rfp with a "pending review" status.

=== PART B: Submit Consultation ===

6. Navigate to /submit-consultation.
7. Fill:
   - Title: "QA Test Consultation {timestamp}"
   - Description: "QA test — asking for advice about sustainable marina certification process. Safe to reject." (>50 chars)
   - Sector: pick 1 (e.g. "Sustainability")
8. Submit.
9. EXPECTED: success toast + redirect to /account with "pending" state.

=== PART C: Request Webinar ===

10. Navigate to /request-webinar.
11. Fill:
    - Topic: "QA Test Webinar Proposal {timestamp}"
    - Description: "QA test webinar proposal — requesting a webinar on marina digitalization trends. Safe to reject." (>50 chars)
    - Sector tags: pick 2-3
    - Preferred date range (if field exists)
12. Submit.
13. EXPECTED: success toast + redirect to /account with pending state.

=== PART D: Submit Project ===

14. Navigate to /submit-project.
15. Fill:
    - Project title: "QA Test Project — Marina Expansion {timestamp}"
    - Description: "QA test project — expanding capacity by 50 berths over the next 2 years. Safe to reject." (>50 chars)
    - Sectors involved: pick 2
    - Budget range (if field exists)
    - Timeline (if field exists)
16. Submit.
17. EXPECTED: success toast + pending state on /account.

=== PART E: Verify all 4 appear in /account ===

18. Navigate to /account.
19. Verify all 4 submissions are visible:
    - RFP in RFPs tab/section
    - Consultation in Consultations tab/section
    - Webinar request in Webinars or Activity tab
    - Project in Projects tab/section
20. Each should show "Pending review" or similar status.
21. Click into each and verify the detail view shows the data you submitted.

=== PART F: Admin review round-trip ===

22. Open a NEW Chrome profile (or incognito) and log in as Sebastien's admin account.

23. Navigate to /admin/rfps:
    - Find the QA Test RFP
    - Open detail
    - Approve it (add admin notes: "QA test approval")
    - Verify status changes to "Open" or "Approved"

24. Navigate to /admin/consultations:
    - Find the QA Test Consultation
    - Reject it with reason "QA test rejection"
    - Verify status changes to "Rejected"

25. Navigate to /admin/webinars:
    - Find the QA webinar request
    - Review the detail page
    - Look for a "Convert to Event" or "Approve" action
    - Do NOT click convert (it would create real event rows) — just verify the button exists
    - Approve with notes "QA approved"

26. Navigate to /admin/projects (or /admin/leads):
    - Find the QA Test Project
    - Open detail
    - Update status if possible (set to "under review")

=== PART G: Verify user sees status updates ===

27. Log out of admin (or switch back to the other browser profile).

28. Log in as the QA marina.

29. Go to /account.

30. Verify:
    - RFP now shows "Open" or "Approved" status
    - Consultation now shows "Rejected" with reason "QA test rejection" visible
    - Webinar request shows "Approved"
    - Project shows "Under review"

31. For the REJECTED consultation, verify the rejection reason is displayed to the user (not hidden).

32. Check mailinator qa-marina-{timestamp} for any status update emails (may or may not be implemented per status type — flag as P2 if missing).

SPECIFIC THINGS TO FLAG:

- (P0) Any submission form returns 4xx/5xx → capture response
- (P0) Submission succeeds but item doesn't appear in /account
- (P0) Admin approve/reject doesn't propagate to user's /account view
- (P0) Rejection reason not visible to user
- (P1) Any form has missing validation (allows empty required fields)
- (P1) No status update email when a status changes (may be acceptable — flag as P2)
- (P1) Date picker doesn't work or allows past dates for deadlines
- (P2) Copy/wording unclear on pending/approved/rejected states

Report format:
| Flow | Submit OK | Admin action OK | Status sync to user | Issues |

At the end, give pass/fail count. List the IDs of the 4 QA items so Sebastien can clean them up.
```
