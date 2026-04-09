# Prompt 14 — Guest-to-account registration upgrade

**Admin intervention needed:** No

**Background (context for Claude, not to paste):**
- Guest webinar registrations are stored with `user_id=NULL` and `guest_email` set.
- When a user later signs up with the same email, a DB trigger on `profiles` INSERT should
  backfill the prior `event_registrations` rows, setting `user_id` and clearing the guest
  fields, so the upgraded user sees their past registration in /account.
- This prompt verifies that the trigger exists and works end-to-end.

## Copy-paste to Claude Chrome

```
Test the guest-to-account upgrade path on https://smartmarinaconnect.com.

=== Pre-requisites ===
- Logged OUT, fresh incognito.
- Mailinator tab open.
- A QA SAMPLE public webinar exists on /events.

=== Steps ===

1.  As a guest (logged out), register for a QA SAMPLE webinar with:
    - Email: qa2-upgrade-<ts>@mailinator.com
    - Name:  Upgrade Tester
    - Company: QA2 Upgrade Co
    ✅ Expected: success, confirmation email with .ics.
2.  Note the event title + date.

3.  Without clearing cookies, go to /become-partner and signup with the SAME email:
    - Email:    qa2-upgrade-<ts>@mailinator.com
    - Password: TestQa!2026SecurePass
    - First/Last: Upgrade / Tester
    - Persona:  Marina (any is fine)
    - Org:      "QA2 Upgrade Org <ts>"
4.  Submit signup.
    ✅ Expected: signup succeeds without "email already in use" (guest registrations should
       not block auth signup — they only hold `guest_email`, no auth user). Immediate login.

5.  Land on /onboarding. Fill the persona + org form minimally and submit → redirect to /account.

6.  Go to /account → Events / Registrations tab.
    ✅ Expected: the prior guest webinar registration is now visible and linked to the
       new user account (same event + date).
    ❌ If it's missing → DB trigger didn't fire; P0. Check Supabase logs.

7.  Open the event detail page. It should now show the user as "Registered" (not offering
    the guest signup form).

8.  Cross-check in the Supabase DB (if Sebastien can run a quick SQL):
    SELECT id, user_id, guest_email, registration_type FROM event_registrations
    WHERE guest_email = 'qa2-upgrade-<ts>@mailinator.com' OR user_id = '<new_user_id>';
    ✅ Expected: row's user_id is now populated, guest_email is either preserved or nulled
       per schema, registration_type may flip from 'guest' to something else depending on
       logic.

=== Flag ===

P0 — signup rejected because email "already registered" (guest registrations shouldn't
     claim the email);
P0 — registration not linked to the new account;
P1 — event detail still shows guest form to the logged-in user;
P2 — confirmation emails re-sent on upgrade (should NOT re-send).

Report format: | Step | Expected | Actual | Status |
```
