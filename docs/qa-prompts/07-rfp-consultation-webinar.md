# Prompt 07 — Verified marina flows: RFP, Consultation, Webinar request, Project

**Admin intervention needed:** Yes — mid-test, Sebastien must switch to the admin profile to
approve/reject the submissions, then switch back.

**Background (context for Claude, not to paste):**
Needs the marina from Prompt 03 to have been approved in Prompt 06. The four submission
tables (`rfps`, `consultations`, `webinar_requests`, `projects`) all use RLS: only the
owning marina or admins can read. Admin list pages live at /admin/rfps, /admin/consultations,
/admin/webinars, /admin/projects (or /admin/leads).

## Copy-paste to Claude Chrome

```
Test the verified-marina submission flows on https://smartmarinaconnect.com, then admin review.

=== Pre-requisites ===
- QA marina user from Prompt 03 was approved in Prompt 06.
- You have its credentials: qa-marina-<ts>@mailinator.com / TestQa!2026SecurePass.
- Mailinator tab open.
- Two Chrome profiles available: Profile A (QA marina) and Profile B (Sebastien admin).

=== Part 1: Submit the 4 items as the verified marina ===

1.  In Profile A, log in as the QA marina. Confirm no pending banner.

2.  /submit-rfp:
    - Title: "QA Test RFP — Dredging <ts>"
    - Scope/description (>50 chars): "QA test — dredging, 5000 m³, safe to reject."
    - Sectors: Dredging, Marine Engineering
    - Deadline: 30 days out
    - Submit → ✅ success + pending state

3.  /submit-consultation:
    - Title: "QA Test Consultation <ts>"
    - Description (>50 chars): "QA test — sustainable certification advice."
    - Sector: Sustainability
    - Submit → ✅ success

4.  /request-webinar:
    - Topic: "QA Test Webinar Proposal <ts>"
    - Description (>50 chars): "QA test — marina digitalization trends webinar."
    - Sector tags: 2–3
    - Submit → ✅ success

5.  /submit-project:
    - Title: "QA Test Project — Marina Expansion <ts>"
    - Description (>50 chars): "QA test — 50-berth expansion over 2 years."
    - Sectors: 2
    - Submit → ✅ success

6.  /account — verify all 4 appear under their respective tabs/sections with "Pending review".
    Click into each to confirm the detail view shows the data you submitted.

=== Part 2: 🛑 ADMIN CHECKPOINT — Sebastien reviews in admin ===

Action (Sebastien, in Profile B):
  a. /admin/rfps → open the QA RFP → Approve with notes "QA test approval".
  b. /admin/consultations → open QA consultation → Reject with reason "QA test rejection".
  c. /admin/webinars (or /admin/webinar-requests) → open QA webinar → Approve with notes
     "QA approved". **Do NOT click "Convert to Event"** — we don't want real event rows.
  d. /admin/projects (or /admin/leads) → open QA project → set status "Under review".

Resume after: Sebastien says "admin review done".

=== Part 3: Verify the status updates propagate to the marina ===

7.  Back in Profile A, refresh /account. Verify:
    - RFP            → "Open" or "Approved"
    - Consultation   → "Rejected", reason "QA test rejection" visible to the user
    - Webinar request → "Approved"
    - Project        → "Under review"

8.  Check mailinator for any status-change emails. Status-update emails are optional — if
    missing flag as P2, not P0.

=== Flag ===

P0 — Any form returns 4xx/5xx (capture body)
P0 — Submission succeeds but item doesn't appear in /account
P0 — Admin action doesn't propagate to marina view after refresh
P0 — Rejection reason hidden from user
P1 — Missing validation on required fields
P1 — Date picker allows past dates
P2 — No status-change email; unclear copy

=== Save for cleanup ===
- IDs of the 4 QA submissions so Sebastien can delete them post-QA.

Report format:
| Flow | Submit OK | Admin action OK | Synced to user | Notes |
```
