# Prompt 05 — Admin event creation (3 event types)

## Prerequisite

You must be logged in to https://smartmarinaconnect.com as an admin user. Sebastien will already have the session active in this Chrome profile.

## Copy-paste to Claude Chrome

```
Test admin event creation at https://smartmarinaconnect.com/admin/events

CONTEXT: Sebastien is already logged in as admin in this session. Do NOT log out. Do NOT delete any existing events that don't start with "QA Test".

You will create 3 test events to exercise all event variants. All titles must start with "QA Test" so Sebastien can clean them up later.

STEPS:

1. Navigate to /admin/events. Verify the list loads with existing events.

2. Click "Create Event" button.

=== EVENT 1: Public Webinar ===

3. Fill:
   - Title: "QA Test Webinar {timestamp}"
   - Description: "QA test webinar — safe to delete. This tests the lightweight signup flow."
   - Type: Webinar
   - Access level: Public
   - Date: 30 days from today at 14:00
   - Full-day: NO
   - Published: YES
   - Invitation-only: NO
   - Language: English
   - Sectors: pick 2 (e.g. "Sustainability", "Technology")
   - Fees: Free
4. Save.
5. EXPECTED: event appears in /admin/events list with "Published" status and "Webinar" + "Public" badges.

6. Open the event detail in admin (/admin/events/:id). Verify all fields saved correctly.

7. Open the public event detail page in an incognito/new tab: https://smartmarinaconnect.com/events/{id}
8. EXPECTED: the lightweight webinar signup form appears (because not logged in + public + webinar). This is what Prompt 02 tested.

=== EVENT 2: On-Site Paid Event ===

9. Go back to /admin/events, click "Create Event".

10. Fill:
    - Title: "QA Test On-Site {timestamp}"
    - Description: "QA test on-site event — safe to delete"
    - Type: On-Site
    - Access level: Members (or whatever requires login)
    - Date: 45 days from today, 09:00
    - End date/time: same day 18:00
    - Full-day: YES
    - Location: "Monaco Yacht Club, Quai Louis II, 98000 Monaco"
    - Published: YES
    - Invitation-only: NO
    - Sectors: pick 2
11. BEFORE SAVING, if there's a Packages section, add 2 packages:
    - Package 1: Name "Early Bird", Description "Save 50 EUR until 2 weeks before event", Price 100 EUR, Max seats 50, Display order 1
    - Package 2: Name "Standard", Description "Standard attendance package", Price 150 EUR, Max seats 100, Display order 2
12. Save.
13. EXPECTED: event appears in list with "On-Site" + "Members" badges, draft NOT shown (it's published).

14. Open public URL in incognito: /events/{id}
15. EXPECTED:
    - Page shows the event details
    - Packages section shows BOTH packages with prices
    - Registration card says "Log in to Register" (since not logged in)
    - Lightweight signup form does NOT appear

=== EVENT 3: Invitation-only Event ===

16. Create another event:
    - Title: "QA Test Invite {timestamp}"
    - Type: On-Site
    - Access level: Members
    - Date: 60 days from today
    - Location: "Test Venue"
    - Invitation-only: YES
    - Published: YES
17. Save.
18. EXPECTED: admin list shows "Invite Only" purple badge.

19. Open public URL in incognito: /events/{id}
20. EXPECTED:
    - Registration card button says "Log in to Request Invitation" (not "Log in to Register")
    - Lightweight signup form does NOT appear (invitation-only blocks it)
    - An invitation-only banner/notice is visible

=== DRAFT EVENT TEST ===

21. Create a 4th event:
    - Title: "QA Test Draft {timestamp}"
    - Type: Webinar
    - Published: NO (save as draft)
22. Save.
23. EXPECTED: in /admin/events list, draft has amber left border and "Draft" badge.

24. In incognito tab, try /events — the draft should NOT appear in the public list (only published events visible to non-admins).
25. Try navigating directly to /events/{draft-id} in incognito — should either 404 or show a "not available" message. Must NOT show the draft content to anonymous users.

=== CLEANUP NOTES ===

Leave all 4 QA Test events in the database. Sebastien will review and delete them manually.

SPECIFIC THINGS TO FLAG:

- (P0) Any event fails to save with a 5xx error → capture response body
- (P0) Published event does not appear in public /events list
- (P0) Draft event IS visible to anonymous users → data leak
- (P0) Invitation-only event allows direct registration without invitation → bug
- (P0) Lightweight signup form appears on on-site or invitation-only events → bug
- (P1) Packages don't save or don't display on public page
- (P1) Event sectors don't save
- (P1) Date display wrong on public page (e.g. timezone off by 1 hour)
- (P2) Admin form validation missing for required fields
- (P2) Draft visual indicator missing

Report format per event:
| Event | Created OK | Admin display | Public display | Issues |

At the end, list the 4 event IDs so Sebastien can find them easily for cleanup.
```
