# Prompt 05 — Event verification (10 QA SAMPLE events) + create 1 new

**Admin intervention needed:** Yes — Victor must be logged in as admin for this prompt;
the actual "Create Event" step is executed by Claude in Victor's admin session.

**Background (context for Claude, not to paste):**
10 "QA SAMPLE —" events are already seeded in the DB covering the main variants (webinar/on-site,
public/members, invitation-only, free/paid). We don't need to create them again. Instead this
prompt verifies they are all correctly rendered, and then creates ONE new event to smoke-test
the admin creation form itself.

## Copy-paste to Claude Chrome

```
Audit the 10 seeded QA SAMPLE events on https://smartmarinaconnect.com/admin/events, then
create ONE new event to smoke-test the admin form.

=== Pre-requisites ===
- Victor is logged in as admin in THIS Chrome profile.
- Do NOT delete any QA SAMPLE event.
- Do NOT log out.

=== Part 1: Verify the 10 seeded events ===

1.  Go to /admin/events. Filter or search for "QA SAMPLE —". Confirm there are exactly 10.
    If fewer → 🛑 STOP and tell Victor (seed missing).

2.  For EACH of the 10 events, capture in a table:
    - Title
    - Type (webinar / on-site / hybrid)
    - Access level (public / members / partner-only)
    - Invitation-only (y/n)
    - Published (y/n)
    - Date (and confirm it's in the future)
    - Number of packages (if on-site paid)
    - Badges shown in admin list

3.  Click into each event's admin detail page and verify:
    - All fields are populated (no blanks, no "[object Object]", no "undefined")
    - Sectors are listed
    - Description is non-empty and > 50 chars
    - Hero image loads (no broken-image icon)

4.  Open the public detail page for each event in an incognito tab at /events/<id>. Verify:
    - Page loads, no console errors
    - Correct registration CTA:
        * public webinar  → guest signup form visible
        * members-only    → "Log in to Register"
        * invitation-only → "Log in to Request Invitation"
        * on-site paid    → packages with prices visible
    - Date/time display is correct (flag timezone issues if off by 1h)

5.  Go to /events (public, logged out). All PUBLISHED QA SAMPLE events should appear.
    Any draft ones should NOT appear.

=== Part 2: Create 1 new event to smoke-test the admin form ===

6.  Back in /admin/events click "Create Event".
7.  Fill:
    - Title:         "QA SAMPLE — Admin Smoke Test <timestamp>"
    - Description:   "Created by Prompt 05 smoke test — safe to delete."
    - Type:          Webinar
    - Access level:  Public
    - Date:          30 days from today, 14:00
    - Published:     YES
    - Invitation-only: NO
    - Language:      English
    - Sectors:       pick 2
    - Hero image:    use a picsum.photos URL if asked for one
8.  Save.
    ✅ Expected: event appears in list with correct badges.
9.  Open the public URL in incognito → verify guest signup form renders (reuses Prompt 02's logic).

=== Flag ===

P0 — any QA SAMPLE event fails to open (404/500); draft visible to anonymous users;
     invitation-only event allows direct registration without invitation;
     guest signup form appears on on-site or invitation-only events;
     create-event form returns 4xx/5xx.
P1 — sectors missing; package prices wrong; broken image; timezone off.
P2 — draft visual indicator missing; admin form missing required-field validation.

=== Cleanup note ===
Leave the 10 SEED events intact. The 1 new "Admin Smoke Test" event will be deleted by
Victor post-QA.

Report format:
| # | Title | Type | Admin OK | Public OK | Notes |
```
