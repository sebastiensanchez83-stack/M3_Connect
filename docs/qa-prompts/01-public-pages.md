# Prompt 01 — Public pages & anonymous flows

**Admin intervention needed:** No

## Copy-paste to Claude Chrome

```
Test every public page of https://smartmarinaconnect.com while logged OUT.

Visit in order and verify each loads without console errors, layout is not broken at desktop 1440×900, and all images load:

1.  /                            (home)
2.  /about
3.  /events                      (should show ≥10 upcoming events — QA samples exist)
4.  /resources
5.  /partners
6.  /network                     (public marketplace)
7.  /become-partner              (signup entry — NOT /join, see step 14)
8.  /tiers
9.  /contact
10. /terms
11. /privacy
12. /cookies
13. /mentions-legales
14. /conditions-commerciales

For each page record:
- Page title (browser tab)
- Red console errors (y/n + details)
- 4xx/5xx network requests (y/n + URLs)
- Whether the footer renders with all legal links
- Screenshot any broken layout

=== Known baseline issues (verify whether they're fixed) ===

Flag the following explicitly — if any are STILL present, report them; if FIXED, note that too:

a) `/join` returns 404 → it should ideally redirect to `/become-partner`. Visit /join and confirm.
b) `info@m3monaco.com` appears on 5 legal pages (/terms, /privacy, /cookies, /mentions-legales, /conditions-commerciales). Search each page with Ctrl+F and count occurrences.
c) Footer LinkedIn link points to `linkedin.com/company/monaco-marina-management` which returns "Page isn't available". Click it to confirm.
d) Resource card "Meeting Crew, Guest & Vessel Needs in Modern Marinas" had no author shown. Check the Resources page.

=== Event detail smoke test ===

15. On /events, click into any event whose title starts with "QA SAMPLE —" (these are seeded test events, safe to view).
16. Verify the detail page renders hero image, title, date, description, and registration card.
17. Try one webinar type and one on-site type to cover both layouts.

=== Footer link health ===

18. On the homepage, click EVERY link in the footer (Platform, Legal, Social columns). For each:
    - Note HTTP status
    - Note if it's same-tab vs new-tab
    - For external links, verify target="_blank" + rel="noopener noreferrer" (use Elements inspector)

=== Page-level text search ===

On every page visited, search with Ctrl+F for:
- "connect.m3monaco.com"  → should NOT exist (old domain)
- "m3connect.mc"           → should NOT exist
- "lorem ipsum"            → should NOT exist
- "[object Object]"        → should NOT exist (broken render)
- "undefined" (unstyled)   → should NOT exist
- "NaN"                    → should NOT exist

=== Report format ===

| # | URL | Title | Status ✅/⚠️/❌ | Console err | 4xx/5xx | Footer OK | Notes |

At the end, summarize:
- Total pages: X
- ✅ Pass / ⚠️ Warn / ❌ Fail counts
- P0 issues (with fix suggestion)
- P1 issues
- Confirm which of the 4 baseline issues (a-d) are still present vs fixed
```
