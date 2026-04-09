# Prompt 04 — Partner signup + references (Path A real refs, Path B bypass)

**Admin intervention needed:** Yes — for Path B only (approve bypass request)

**Background (context for Claude, not to paste):**
- Signup email confirmation is OFF for QA.
- Post-signup redirect is `/account?tab=organization` (no /onboarding route).
- Partner onboarding now correctly requires **2 verified references** (previous run advanced
  after only 1 due to AccountPage bug — fixed: `REQUIRED_REFERENCES = 2`).
- Reference verification emails were previously blocked by a 401 on the Supabase gateway.
  Both `send-reference-email` and `send-status-notification` are now redeployed with
  `verify_jwt: false` and the frontend uses `supabase.functions.invoke(...)` instead of raw fetch.
  Emails should now actually reach Resend and land in mailinator.
- Partners who cannot supply real references can request a **bypass** (admin approves/rejects).
- Reference form does NOT hard-block mailinator domains.

## Copy-paste to Claude Chrome — PATH A (real references, no admin needed)

```
Test partner signup with 2 real mailinator references on https://smartmarinaconnect.com.

=== Pre-requisites ===
- Logged OUT
- Mailinator tab open
- A timestamp string (use the same one across all 3 emails below)

=== Test credentials ===
- Partner email:  qa2-partner-<ts>@mailinator.com
- Password:       TestQa!2026SecurePass
- First / Last:   Partner / Tester
- Org name:       "QA2 Partner Services <ts>"
- Persona:        Partner (service provider)

=== Steps ===

1.  /become-partner or "Join" → signup form. Select Partner persona and fill with the
    credentials above.
2.  Submit.
    ✅ Expected: immediate login, redirect to /account?tab=organization. NO email-confirm screen.

3.  Fill the Partner onboarding form on the Organization tab:
    - Company name: "QA2 Partner Services <ts>"
    - 2–3 service sectors (e.g. Fuel & Bunkering, Dredging, IT & Software)
    - Company description (>50 chars)
    - Other required fields
4.  Submit Organization.

5.  Proceed to the References step. Add TWO references:
    - Ref 1: Ref One, qa2-ref1-<ts>@mailinator.com, "QA2 Marina Alpha", Harbour Master
    - Ref 2: Ref Two, qa2-ref2-<ts>@mailinator.com, "QA2 Marina Beta",  General Manager
    Submit Ref 1, then submit Ref 2 (previously the form hid after ref 1 — that is fixed).
    ✅ Expected: both references appear in the list with status "pending".
    ❌ If the form disappears after ref 1 → P0 (regression).

6.  Open both mailinator inboxes:
    - https://www.mailinator.com/v4/public/inboxes.jsp?to=qa2-ref1-<ts>
    - https://www.mailinator.com/v4/public/inboxes.jsp?to=qa2-ref2-<ts>
    For EACH verify within 2 minutes:
    - Email arrives
    - Sender: noreply@smartmarinaconnect.com  (flag old m3monaco.com)
    - Subject mentions Smart Marina Connect + the partner's org name
    - Body contains a "Confirm" / "Reject" link (two CTAs expected)
    - No spam warnings on the mailinator view

7.  Click "Confirm" in Ref 1's email → should land on a confirmation page
    (no crash, clear success message). Leave Ref 2's email untouched for now.

8.  Go back to /account (partner still logged in) and refresh.
    - Ref 1: "confirmed" / "verified"
    - Ref 2: still "pending"
    - Overall status: still pending admin review (2nd reference missing)

9.  Now go back to Ref 2's mailinator inbox and click "Confirm".
    Return to /account → Ref 2 should flip to "confirmed" and the partner's status
    should now read "Awaiting admin review" (not yet verified — admin must approve in Prompt 06).

10. Log out.

=== Flag ===
P0 — email confirmation screen during signup; reference form hides after 1 ref;
     no emails within 2 min (capture function logs); 401/403 on send-reference-email;
     sender is m3monaco.com; confirm/reject links 404 or crash;
     account doesn't update status after confirmations.
P1 — email body missing partner name, broken HTML, landed in spam section.
P2 — template styling unpolished.

=== Save for Prompt 06 ===
- Partner email, org name, which refs were confirmed, partner user id.

Report format: | Step | Expected | Actual | Status |
```

## Copy-paste to Claude Chrome — PATH B (bypass request, admin needed)

```
Test the partner reference-BYPASS flow on https://smartmarinaconnect.com.

=== Test credentials ===
- Partner email:  qa2-partner-bypass-<ts>@mailinator.com
- Password:       TestQa!2026SecurePass
- Org name:       "QA2 Partner Bypass <ts>"

=== Steps ===

1.  Signup as Partner with the credentials above → land on /account?tab=organization.
2.  Fill + submit the Organization form.
3.  At the References step, click "I can't provide references" / "Request bypass" (whatever
    the current CTA is). Fill the bypass form:
    - Reason: "QA test: no clients yet / confidentiality"
    - Supporting info: link to a dummy portfolio (https://example.com)
    - Any required checkboxes
4.  Submit bypass request.
    ✅ Expected: /account shows "Bypass request pending" banner. No references required.

5.  🛑 ADMIN CHECKPOINT — Sebastien does this
    Action:
      a. In Chrome Profile B (admin), go to /admin → "Users" or "Bypass Requests" section.
      b. Find the "QA2 Partner Bypass <ts>" request.
      c. Review it (verify the bypass form data is visible).
      d. Click "Approve bypass".
      e. Confirm the success toast.
    Resume after: Sebastien tells Claude "bypass approved".

6.  Back in Profile A, refresh /account.
    ✅ Expected: banner updates to "Awaiting admin verification" or similar (bypass granted,
       now waiting for the actual approval in Prompt 06).

7.  Optional: check the partner's mailinator inbox for a "bypass approved" notification email.
    Flag as P2 if missing.

8.  Log out.

=== Flag ===
P0 — bypass form submit returns 4xx/5xx; admin panel doesn't show the bypass request;
     after approval /account doesn't reflect new state.
P1 — unclear bypass copy; no notification email.

=== Save for Prompt 06 ===
- Bypass partner email + org name so Sebastien can approve/verify later.

Report format: | Step | Expected | Actual | Status |
```
