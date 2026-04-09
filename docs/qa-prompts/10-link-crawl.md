# Prompt 10 — Full link crawl & health check

**Admin intervention needed:** No (reuses existing sessions, no mutating actions)

**Known baseline issues to confirm fixed or still present:**
- `/join` returns 404 (should redirect to `/become-partner`)
- `info@m3monaco.com` still appears on 5 legal pages
- Footer LinkedIn link points to a dead page
- `connect.m3monaco.com` / `m3connect.mc` should be removed

## Copy-paste to Claude Chrome

```
Perform a link crawl of https://smartmarinaconnect.com to find any 404s, stale references, or broken navigation.

=== PART A: Anonymous crawl ===

Starting from https://smartmarinaconnect.com/ (not logged in):

1. Click EVERY link in the top nav bar. For each:
   - Note the URL, HTTP status, and whether it rendered
   - If not logged in, some links may redirect to login — that's expected

2. Click EVERY link in the footer (both Platform, Company, and Legal columns):
   - Resources, Events, Partners, Become a Member
   - About, Contact
   - Terms of Service, Privacy Policy, Legal Notice, Commercial Terms, Cookie Policy

3. On the homepage, click every CTA button and card link:
   - Hero CTA
   - Feature cards
   - Testimonial links (if any)

4. On /events, click any "View all" or category filter links, then click into 1 event detail.

5. On /resources, same — click into 1 resource detail.

6. On /partners, click into 1 partner profile.

7. Inside each detail page you visit, click any outbound links (back to list, related items, etc.).

=== PART B: Authenticated crawl ===

8. Log in as the verified QA marina from Prompt 06.

9. Click every link in the authenticated nav bar:
   - Home, Resources, Events, Partners, Network
   - My Account dropdown items (Profile, Logout, etc.)
   - Submit Project, Propose Webinar, Submit RFP (should now be unlocked)

10. On /account, click every tab or section link.

11. Log in as admin in a separate profile if possible, and crawl /admin sidebar (covered in Prompt 11).

=== PART C: Text-based references ===

12. On every page visited, use Ctrl+F to search for:
    - "connect.m3monaco.com" — should NOT exist (old domain, was removed this session)
    - "m3connect.mc" — should NOT exist (removed this session)
    - "contact@m3connect.mc" — should NOT exist
    - "lorem ipsum" — should not be in any production copy
    - "TODO" / "FIXME" — should not appear in user-facing text
    - "[object Object]" — indicates a broken variable render
    - "undefined" — should not appear unstyled in the UI
    - "NaN" — indicates a broken number calc

13. Also check visible dates and times — any obviously wrong date like "Invalid Date" or "1970-01-01" is a bug.

=== PART D: External links sanity ===

14. Any external link (e.g. social media in footer, "learn more about X" links) should:
    - Open in a new tab (target="_blank")
    - Have rel="noopener noreferrer" (check with Elements inspector)
    - Point to the correct destination

=== PART E: Produce the crawl report ===

Produce a table for EVERY unique URL visited:

| URL | Auth required | HTTP status | Rendered OK | Notes |
|-----|---------------|-------------|-------------|-------|

Then a separate table of all broken references found:

| Type | Location | Description | Priority |

SPECIFIC THINGS TO FLAG:

- (P0) Any 404 on a page that should exist (e.g. legal pages, footer links)
- (P0) Any reference to connect.m3monaco.com or m3connect.mc still visible
- (P0) Any hardcoded http:// link (should all be https://)
- (P1) External links missing rel="noopener" (security)
- (P1) External links opening in same tab (UX issue)
- (P1) Any "undefined" or "[object Object]" rendered in UI
- (P2) Placeholder/lorem ipsum text in production
- (P2) Obviously-wrong dates
- (P3) Broken social media links in footer

At the end, summarize:
- Total unique URLs visited: X
- 200 OK: X
- 4xx: X (list them)
- 5xx: X (list them)
- Old-domain references found: X
```
