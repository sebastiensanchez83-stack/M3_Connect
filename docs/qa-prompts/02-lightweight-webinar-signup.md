# Prompt 02 — Lightweight webinar signup (NEW feature)

**Priority test** — this is a brand-new feature added this session.

## Prerequisite

There must be at least one event in the database matching ALL of these criteria:
- `event_type = 'webinar'`
- `access_level = 'public'`
- `published = true`
- `invitation_only = false`

If none exists, Claude Chrome should pause and tell you — you'll need to create one via the admin panel first (see Prompt 05).

## Copy-paste to Claude Chrome

```
Test the new lightweight webinar signup at https://smartmarinaconnect.com/events

CONTEXT: This is a brand-new feature. Anonymous users should be able to register for public webinars with just name+email, no account creation required. Data is stored in event_registrations with user_id=NULL and guest_* fields.

Without logging in:

1. Go to /events and find a webinar (not on-site event) with access level "public". If none exists, STOP and tell me — I need to create one in admin first.

2. Click into the webinar detail page.

3. Verify the registration card shows a form with these fields:
   - First name (required)
   - Last name (required)
   - Email (required)
   - Company (optional)
   - A blue info banner at top saying "Quick signup — no account needed for public webinars"
   - A "Register for Webinar" button
   - Small footer text: "Already have an account? Log in"

4. Test invalid email validation:
   - Fill: First "Test", Last "Guest", Email "not-an-email", Company ""
   - Click submit → expect an error toast about invalid email
   - Form should NOT submit

5. Test happy path:
   - Refresh the page
   - Fill: First "QA", Last "Guest", Email "qa-guest-{timestamp}@mailinator.com", Company "QA Corp"
   - Click submit
   - Expect: green success box "You're registered for this webinar" with the email shown
   - Check console + network for errors

6. Test duplicate prevention:
   - Refresh the page
   - Try to register again with the SAME email
   - Expect: error toast "Already registered" (or similar)
   - Form should NOT create a second registration

7. Test success with a fresh email:
   - Refresh
   - Use qa-guest-2-{timestamp}@mailinator.com
   - Expect: success again

8. Test gating on non-webinar events:
   - Go back to /events
   - Click into an ON-SITE event (if any exist)
   - Verify the lightweight form does NOT appear
   - Instead a "Log in to Register" button should appear
   - Do the same for an invitation-only event if any exist — should show "Log in to Request Invitation"
   - Do the same for a member-only webinar if any exist — should show "Log in to Register"

9. Optional: check mailinator for the qa-guest-{timestamp} address to see if a confirmation email arrived. It's a best-effort send via `send-notification` edge function with type `guest_webinar_confirmation` — may or may not be implemented. If no email arrives, that's not a blocker (feature is optional), but flag it as P2 for follow-up.

SPECIFIC THINGS TO FLAG:
- Form submits with invalid email → BUG (P0)
- Duplicate signup succeeds → BUG (P0)
- Form appears on non-public-webinar events → BUG (P0, data could be corrupted)
- Success state does not show → BUG (P1)
- Any 403 from Supabase REST API on the insert → RLS policy bug (P0)

Report format:
| Step | Expected | Actual | Status |

At the end, summarize with a pass/fail count.
```
