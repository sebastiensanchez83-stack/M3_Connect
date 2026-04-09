# Prompt 09 — Error resilience & edge cases

**Admin intervention needed:** No

**Note:** One of the baseline bugs is that `/join` returns a 404 (it should redirect to
`/become-partner`). This prompt intentionally uses `/become-partner` for all signup-related
tests; the `/join` redirect gap is tested separately in Prompt 01.

## Copy-paste to Claude Chrome

```
Test the platform's robustness and error handling at https://smartmarinaconnect.com

CONTEXT: There is a brand-new "lazyWithRetry" + enhanced ErrorBoundary system (added this session) that should auto-recover from stale-chunk errors after deploys. Part of this test validates that fix.

=== PART A: 404 / not-found handling ===

1. Go to https://smartmarinaconnect.com/events/00000000-0000-0000-0000-000000000000
   - EXPECTED: clean "Event not found" or 404 page, NOT a white screen or raw error
   - Should NOT crash into the ErrorBoundary

2. Go to https://smartmarinaconnect.com/resources/nonexistent-id
   - Same expectation

3. Go to https://smartmarinaconnect.com/organizations/not-a-real-org
   - Should show a clean not-found state

4. Go to https://smartmarinaconnect.com/totally-fake-url
   - Should show the NotFoundPage (custom 404 styled page, not raw Netlify 404)

5. Go to https://smartmarinaconnect.com/admin/fake-subpage
   - As anonymous: should redirect to login or show 404
   - As logged-in non-admin: should show an access-denied or redirect

=== PART B: Hard refresh stress test ===

6. Go to /events. Hard-refresh (Ctrl+Shift+R) 5 times in a row with ~1 second gaps.
   - EXPECTED: works every time, no "Something went wrong" error, no console errors from chunk loading

7. Do the same on /admin (if logged in as admin).

8. Do the same on /account (if logged in as a user).

=== PART C: Lazy chunk loading (validates the new fix) ===

9. Open DevTools → Network tab. Check "Preserve log" and filter by `.js`.

10. Go to /events (anonymous).

11. Navigate to /admin (will require auth — skip if not logged in, otherwise proceed).

12. Note how many new JS chunks load on the navigation. The new code-split should load:
    - A small AdminPage chunk (~11 KB)
    - An AdminDashboard chunk (~445 KB — larger because of charts)
    - The vendor chunks if not already cached

13. Click around to /admin/users, /admin/events, /admin/resources.
    - EXPECTED: each click loads a new small chunk for that sub-page
    - EXPECTED: no 404s on any .js file
    - EXPECTED: no MIME type errors like "Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of 'text/html'"

14. If you see ANY chunk error:
    - Capture the full error message
    - Capture the failing URL
    - Note if the page auto-recovered (reloaded once) or stayed broken
    - This is a P0 finding

=== PART D: Stale-chunk simulated test (advanced, optional) ===

15. Open DevTools → Application → Storage → Session Storage. Delete the `smc:chunk-reload-attempted` key if it exists.

16. Open DevTools → Network. Enable request blocking for a URL pattern like `*AdminDashboard*.js`.

17. While on /admin, try to navigate to the dashboard.
    - EXPECTED: the failed chunk triggers an auto-reload of the page (sessionStorage flag set, window.location.reload called)
    - After reload, the block is still in place, but sessionStorage flag prevents infinite loop
    - The ErrorBoundary should then show the user-friendly error screen
    - This proves the "reload once then show error" behavior works

18. Disable the block and refresh → normal behavior should resume.

=== PART E: Network failure handling ===

19. Go to /become-partner (signup form).

20. Open DevTools → Network → set throttling to "Offline".

21. Try to submit the signup form.
    - EXPECTED: a clear error toast or inline error, NOT a crash
    - The form should NOT lose the data the user typed

22. Set throttling back to "No throttling". Submit again.
    - EXPECTED: succeeds this time

=== PART F: Slow network handling ===

23. Set throttling to "Slow 3G".

24. Go to /events.
    - EXPECTED: a loading skeleton or spinner appears while chunks load
    - No flash of blank content
    - Page eventually renders

25. Set back to normal.

=== PART G: Protected route handling ===

26. Log out if logged in.

27. Try to access /admin directly.
    - EXPECTED: redirect to login or a "must be logged in" message, NOT a crash or blank page

28. Try to access /submit-project as an anonymous user.
    - EXPECTED: either redirect to login, OR show a "log in to submit projects" message

29. Log in as a user whose status is "pending" (the qa-marina if not yet approved).

30. Try to access /submit-project.
    - EXPECTED: shows a "locked — pending verification" message, NOT the actual form

=== PART H: Form validation errors ===

31. Go to /become-partner. Submit the form with:
    - Empty email → expect inline error
    - Invalid email format → expect inline error
    - Password < 8 chars → expect inline error
    - Password with only letters → expect warning if strength checker exists

32. Each validation should be CLEAR and INLINE (not just a generic toast).

SPECIFIC THINGS TO FLAG:

- (P0) Any URL produces a blank white screen
- (P0) Any URL crashes into the ErrorBoundary on normal use
- (P0) Hard refresh 5 times causes any error
- (P0) Chunk loading error "MIME type text/html" appears (means stale cache issue not fixed)
- (P0) ErrorBoundary does NOT auto-reload on simulated chunk failure (means new code didn't ship)
- (P0) Protected route leaks content to unauthorized users
- (P1) Offline form submit crashes the app
- (P1) Slow network shows blank instead of skeleton
- (P1) Form validation is only on submit, not inline
- (P1) Form loses user input on failed submit
- (P2) Generic error messages instead of specific ones

Report format:
| Test | Expected | Actual | Status |

At the end, summarize: how many P0 / P1 issues found, did the auto-reload fix work correctly.
```
