# Prompt 11 — Full admin panel audit

**Admin intervention needed:** Yes — Victor must be logged in as admin the entire time.
All dialogs are opened read-only and cancelled without saving.

## Prerequisite
- Victor is already logged in as admin in this Chrome session
- Prompts 03, 04, 05, 06, 07 have been run (so there's QA data in most sections)

## Copy-paste to Claude Chrome

```
You are auditing the admin panel of https://smartmarinaconnect.com

IMPORTANT CONTEXT:
- Victor is already logged in as admin in this Chrome session — do NOT log out.
- Do NOT approve/reject/delete ANY real users, events, resources, or organizations unless the item's title/name explicitly contains "QA" or "TEST". If unsure, read-only.
- Do NOT click "Delete" buttons on production data.
- It's OK to: open any page, apply filters, search, sort, scroll, open detail pages, view modals, and CLOSE them without saving.
- Capture screenshots of anything broken, misaligned, empty when it shouldn't be, or any red console errors.
- For every admin route below, verify:
  (a) page loads without a "Something went wrong" screen
  (b) no red console errors
  (c) no 4xx/5xx network requests (except 406 from Supabase which is normal for empty .maybeSingle() calls)
  (d) the lazy-loaded chunk fetches successfully (watch the Network tab filtered by "Admin" .js files — each route should load a new chunk on first visit)

=== PART 1: Navigation & lazy-loading sanity ===

1. Go to /admin. Note which chunk file loaded (should be small, ~11KB AdminPage chunk + ~445KB AdminDashboard chunk on first visit).

2. Click every sidebar link in order and confirm each navigates + renders:
   - /admin
   - /admin/users
   - /admin/organizations
   - /admin/resources
   - /admin/events
   - /admin/sponsorships
   - /admin/expositions
   - /admin/projects
   - /admin/leads
   - /admin/webinars
   - /admin/partner-requests
   - /admin/rfps
   - /admin/consultations
   - /admin/banners
   - /admin/settings

3. For each, confirm a DIFFERENT JS chunk loads the first time (this validates code-splitting). On second visit it should load from cache instantly.

4. Record any sidebar link that 404s, shows a blank page, throws an error, or takes >3 seconds to render.

=== PART 2: Dashboard (/admin) ===

5. Verify the 8 stat cards render with numeric values (not "NaN" or "undefined"):
   - Pending users, Verified users, Events, Resources, Partners, Projects, Leads, Webinar requests

6. Click any "View all" / drill-down link on each card and verify it navigates to the correct sub-page with a matching filter applied.

7. Scroll the whole dashboard — any charts, recent-activity feeds, or widgets should render. Screenshot if a chart is empty or broken.

=== PART 3: Users (/admin/users) ===

8. Verify the user list loads with at least 1 row.

9. Test the filters: All / Pending / Verified / Rejected / Suspended — counts should change appropriately.

10. Test the search box: type "a" — results should filter.

11. Test sorting by column headers if available.

12. Click any user row → verify /admin/users/:id detail page loads with: profile info, organization, references (if partner), activity, and action buttons (Approve / Reject / Suspend).

13. Open the Approve dialog (DO NOT CONFIRM, just open and cancel). Same for Reject (verify rejection reason textarea works). Same for Suspend.

14. Go back to the list. Click into a partner user specifically — verify references appear and each reference shows its verification status.

15. Report: any missing fields, any empty states that look broken, any actions that fail to open a dialog.

=== PART 4: Organizations (/admin/organizations) ===

16. Verify the org list loads. Check filters by tier, type (marina/partner/media_partner), status.

17. Open 1 marina org detail → check it shows members, sector interests, future plans, invitation history.

18. Open 1 partner org detail → check it shows service sectors and references.

19. Report: any tab that's blank, any broken member list.

=== PART 5: Resources (/admin/resources) ===

20. Verify resource list loads. Test the Drafts tab if present.

21. Click into 1 resource → verify the editor loads without errors (this is the 407KB AdminResourceDetail chunk).

22. Test: open, close without saving. Do NOT publish or delete.

23. Check the "sectors" and "speakers" fields render correctly.

24. Report: editor broken, sectors/speakers missing, save button position weird.

=== PART 6: Events (/admin/events) ===

25. Verify the list loads. Test filters: Type (webinar/on-site), Time (upcoming/past), Status (published/draft).

26. Look for visual cues:
    - draft events should have an amber left border and "Draft" badge
    - invitation-only events should have a purple "Invite Only" badge
    - TBD events should show "TBD" in the date block (amber background)

27. Click into any event (preferably one without "QA" in the title → read-only). Verify the detail page shows:
    - Title, description, date/time, location
    - Event packages (if on-site) with prices
    - Event sectors tags
    - Registration list with count
    - Exposition requests (if on-site)
    - Edit button → opens form (cancel without saving)

28. If a "QA Test" event exists from Prompt 05, open it and verify all fields saved correctly.

29. Report: any missing section on the event detail, any "packages" tab that errors, any broken registration count.

=== PART 7: Sponsorships, Expositions, Projects, Leads ===

30. For each of /admin/sponsorships, /admin/expositions, /admin/projects, /admin/leads:
    - List loads
    - Filters work
    - Click 1 row → detail page loads
    - Status change dialogs open (DO NOT confirm unless the item is a QA test)

31. For Projects and Leads, verify the linked marina/partner shows correctly.

32. Report any page that crashes or shows raw errors.

=== PART 8: Webinar Requests (/admin/webinars) ===

33. List loads with all proposed webinars.

34. Click 1 → detail shows: requester, topic, description, sector tags, status.

35. Verify the "Convert to Event" action is present (do NOT click on production items).

36. Report if conversion button is missing.

=== PART 9: Partner Requests / RFPs / Consultations ===

37. /admin/partner-requests: list loads, filters work (pending/accepted/rejected), click 1 → detail shows requester + target marina + sector + message.

38. /admin/rfps: list loads, filters by status, click 1 → shows scope, deadline, sectors, attachments path, status. Admin notes field editable.

39. /admin/consultations: same as RFPs — shows title, description, sector, status. Admin notes editable.

40. For each of these, try to open the "Approve/Reject/Close" dialog, verify it has a rejection-reason or admin-notes textarea, then cancel.

41. Report: any of the three sections that crashes or has missing fields.

=== PART 10: Banners (/admin/banners) ===

42. List loads with ad banners. Check: image preview, click count, impression count, status (active/inactive), priority.

43. Click 1 → detail loads with image upload field and target URL.

44. Report: broken image previews, missing stats.

=== PART 11: Platform Settings (/admin/settings) ===

45. Page loads with platform config options.

46. Do NOT change any setting. Just verify each field renders.

47. Report: missing settings, crashes.

=== PART 12: Admin Permissions Sanity ===

48. Open DevTools → Application → Cookies. Find the Supabase auth cookie. Don't copy the value, just confirm it exists.

49. Open DevTools → Network tab. Click /admin/users. Find the request to `rest/v1/profiles`. Check the response is 200 with JSON data (not 403).

50. Same for /admin/events → `rest/v1/events`.

51. Report any 403 Forbidden from the REST API on admin routes — that would indicate broken RLS policies for the admin role.

=== PART 13: Mobile admin (bonus) ===

52. Open devtools → iPhone SE emulation.

53. Go to /admin. Verify the hamburger menu button appears top-left.

54. Click it — sidebar should slide in.

55. Click a link — sidebar should close and the page should load.

56. Verify all tables are either scrollable horizontally or reflow to card-style on mobile.

57. Report: sidebar stuck open, content overlapping the sidebar toggle, tables that overflow viewport.

=== FINAL REPORT FORMAT ===

Produce a single table at the end:

| Section | Route | Status | Issues | Priority |
|---------|-------|--------|--------|----------|
| Dashboard | /admin | ✅/⚠️/❌ | description | P0/P1/P2/P3 |
| Users | /admin/users | ... | ... | ... |

Priority scale:
- P0 = blocker, crashes, data exposure
- P1 = major UX issue, broken functionality
- P2 = minor bug, visual glitch
- P3 = nice-to-have polish

Also report:
- Total JS bundle size downloaded during the whole audit (DevTools → Network → filter JS → bottom "transferred" number)
- Any route that took >3 seconds to render first paint
- Any screen with >5 red console errors
- Any 500 error from the Supabase API
- Which JS chunks loaded per route (validates code-splitting)
```
