# Prompt 12 — B2B partner → marina contact request flow

**Admin intervention needed:** Yes — mid-test, to review the `partner_requests` entry in admin
and to switch between Chrome profiles.

**Background (context for Claude, not to paste):**
- Requires a verified marina (Prompt 06 Part A) and a verified partner (Prompt 06 Part B).
- Partners browse /network (the public-ish marketplace) and can click "Contact" on a marina card.
- Submitting creates a row in the `partner_requests` table. Admin can view at
  /admin/partner-requests. The marina owner sees the incoming request in /account.
- An optional email notification may be sent via `send-notification`. Flag P2 if missing.

## Copy-paste to Claude Chrome

```
Test the B2B partner → marina contact request flow on https://smartmarinaconnect.com.

=== Pre-requisites ===
- Verified QA partner (from Prompt 06 B or C) — credentials known.
- Verified QA marina (from Prompt 06 A) — credentials known.
- Two Chrome profiles: Profile A (partner), Profile B (marina).
- Mailinator tab open.

=== Part 1: Partner sends a contact request ===

1.  In Profile A, log in as the verified QA partner.
2.  Open /network (the marketplace). Verify marina cards render with sector chips,
    location, and a "Contact" / "Request introduction" CTA.
3.  Search or filter for the QA marina ("QA2 Test Marina <ts>"). Open its card.
4.  Click "Contact" / "Send request".
5.  Fill the request form:
    - Sector of interest: pick one matching both sides
    - Message (>50 chars): "QA test — exploring fuel supply partnership. Safe to reject."
    - Any required checkboxes
6.  Submit.
    ✅ Expected: success toast, form closes, request shows in partner's /account under
    "My Requests" (or similar) with status "Pending".
    ❌ If it returns 4xx/5xx → P0 (capture body).

7.  Attempt to send a 2nd request to the SAME marina in the SAME sector.
    ✅ Expected: blocked or flagged as duplicate.

=== Part 2: Marina receives the request ===

8.  🛑 ADMIN CHECKPOINT — Sebastien switches to Profile B (marina).
    Action: Log in as QA marina in Profile B.
    Resume after: "logged in as marina".

9.  In Profile B on /account, find the incoming partner requests tab/section.
10. Verify the new request is listed with: partner org name, sector, message, status "Pending".
11. Click into the detail. Verify all data matches what the partner submitted.
12. Test the "Accept" action — accept the request.
    ✅ Expected: status → "Accepted", partner contact info (email) now revealed to the marina.
13. Optional: check the QA marina's mailinator inbox for a "new partner interest" notification
    (P2 if missing).

=== Part 3: Partner sees the update ===

14. 🛑 ADMIN CHECKPOINT — Sebastien switches back to Profile A.
15. In Profile A, refresh /account → the request status should now be "Accepted".
16. Optional: check partner's mailinator for a "marina accepted your request" email (P2 if missing).

=== Part 4: Admin visibility ===

17. 🛑 ADMIN CHECKPOINT — Sebastien logs in as admin in a third tab (or Profile B after logout).
18. /admin/partner-requests → verify the QA request appears with status "Accepted" and
    correct sender/recipient/sector/message.

=== Part 5: Reject variant ===

19. Repeat Part 1 briefly with a NEW sector (to avoid duplicate) to create a 2nd request.
20. In Profile B (marina) → reject the new request with reason "QA test rejection".
21. Profile A (partner) → request shows "Rejected" with reason visible.

=== Flag ===

P0 — submit 4xx/5xx; request not visible to marina; accept/reject doesn't propagate;
     contact info leaked to partner BEFORE marina accepts.
P1 — duplicate not prevented; reason hidden from partner on reject.
P2 — missing notification emails.

=== Save for cleanup ===
- IDs of the 2 QA partner_requests rows.

Report format: | Step | Expected | Actual | Status |
```
