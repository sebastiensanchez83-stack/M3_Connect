# Prompt 01 — Public pages & anonymous flows

## Copy-paste to Claude Chrome

```
Test every public page of https://smartmarinaconnect.com without logging in.

Visit in order and verify each loads without console errors, layout is not broken on desktop 1440px width, and all images load:
1. / (home)
2. /about
3. /events (note how many events are shown)
4. /resources
5. /partners
6. /network (marketplace — may be gated)
7. /join (become a member)
8. /tiers (pricing)
9. /contact
10. /terms
11. /privacy
12. /cookies (or /cookie-policy)
13. /mentions-legales
14. /conditions-commerciales

For each page capture:
- Page title (browser tab)
- Any red console errors (y/n + details)
- Any 4xx/5xx network requests (y/n + URLs)
- Whether the footer renders all legal links

IMPORTANT: Click every link in the footer to verify no 404s.

Then click into one event detail and verify the page loads.

SPECIFIC THINGS TO FLAG:
- Any reference to the old domain "connect.m3monaco.com" or "m3connect.mc" — should no longer exist
- Any broken image (404 on the image URL)
- Any page that takes >5 seconds to first paint
- Any page that shows a "Something went wrong" error screen
- Any footer link that 404s

Report format per page:
| URL | Status (✅/⚠️/❌) | Console errors (y/n) | Broken images (y/n) | Notes |

At the end, give a total pass/fail count and list P0/P1 issues.
```
