# Day-D smoke tests (after the switch to the new site)

Run these in order right after the production deploy of the refonte. Each step says who, where,
what to do, what you should see, and what to do if it fails. Stop at the first red WYS or e-mail
check: those two are never left broken.

Accounts: use three test logins prepared before day D (visitor = not signed in, pending = an
account M3 has not validated yet, member = a validated account) plus Victor's admin login.
Never create accounts on production during the checks other than the sign-up test in step 10.

## 0. Automated part (2 minutes, anyone)

```
node scripts/smoke-day-d.mjs https://smartmarinaconnect.com --production
```

Anonymous read-only GETs: every public page answers with the app, private/token pages
(`/wys26/guest`, `/account`, `/admin`) carry `X-Robots-Tag: noindex`, the home page is **not**
noindex, robots.txt points at the sitemap, the sitemap has 50+ URLs, both RSS feeds answer and
still carry every guid saved in `scripts/smoke-day-d.guids.json`, an old `/resources/<id>` URL and a
slug URL both open, a company page opens, old links (`/become-partner`, `/network`,
`/marketplace`) are still served.

- The guid baseline was saved from the old live site on 21 Oct. Re-save it on the morning of day D,
  **before** the switch: `node scripts/smoke-day-d.mjs https://smartmarinaconnect.com --save-guids`.
- If it fails: read the FAIL line. Noindex still on the home page = the production deploy picked up the
  preview header rule (check `scripts/preview-noindex.mjs` ran with the production context) - fix
  before announcing. A missing guid = m3monaco.com / s3monaco.com would re-import or lose an
  article: roll back (runbook) or restore the item before WordPress polls.

## Manual checks

| # | Who / where | Steps | Expected | If it fails |
|---|---|---|---|---|
| 1 | Visitor, `/` (desktop + phone) | Open home, scroll | Sky-blue accent, live figures, no gold, no console error | Hard refresh; if still broken, roll back |
| 2 | Visitor, `/directory` | Search "marina", open a marina and a company | List loads, search returns results, pages open with logo | Check Supabase status / health monitor |
| 3 | Pending, `/directory`, a company page | Sign in as pending | Same visibility rules as decided (no member-only data), banner "waiting for validation" | Note it, fix same day (not blocking) |
| 4 | Member, `/directory`, a company page | Sign in as member | Contacts and "Message" button visible | Blocking for messaging only |
| 5 | Visitor, search box in the header | Type a company name and an article word | Both found | Not blocking, fix same day |
| 6 | Visitor, `/resources` | Open an article by its slug URL, then an old `/resources/<id>` link from an old e-mail | Both open the same article | Blocking (old links in e-mails and WordPress) |
| 7 | Visitor, `/events` | Open the WYS event | Event page loads | See WYS doc |
| 8 | Victor, WYS door | Follow **[docs/operations/wys-door-day-d.md](./wys-door-day-d.md)** in full (guest links, QR, tokens unchanged) | Everything in that doc green | **Stop, roll back** - WYS is never left broken |
| 9 | Visitor, `/sm26`, `/sm26/vote` | Open | Pages load (SM26 frozen, unchanged) | Roll back the affected route |
| 10 | New person, `/signup` | Sign up with a real mailbox you own | Account created, "waiting for validation" shown, welcome e-mail arrives (English) | Blocking: check send-email logs |
| 11 | Member, sign-in | Sign out, sign in with password | Lands on the dashboard (home for signed-in users) | Blocking |
| 12 | Member, Forgot password | Request a reset, follow the e-mail link, set a new password | E-mail arrives within 2 min, link opens `/reset-password`, new password works | Blocking: check Supabase auth redirect URLs include the domain |
| 13 | Member, messages (`/inbox`) | Send a short message to the test company | Thread appears both sides; no instant e-mail (Friday digest only) | Not blocking for launch, fix same day |
| 14 | Member, dashboard `/` | Look at cards and the account menu | Own company, registrations, messages counters | Not blocking |
| 15 | Member, `/opportunities` | Open list and one item | Loads; verified marina/developer sees "Submit" | Not blocking |
| 16 | Victor, `/admin` | Review queue, companies, people, invitations (WYS module), articles editor, health | Every screen loads; review queue counts plausible | Blocking for the review queue and WYS invitations |
| 17 | Anyone, `https://smartmarinaconnect.com/rss.xml` and `/rss-s3.xml` | Open, then check m3monaco.com and s3monaco.com next import | Same items, no duplicates on WordPress | Restore guids (step 0) |
| 18 | Anyone, `/sitemap.xml`, `/robots.txt` | Open | Sitemap lists pages on smartmarinaconnect.com; robots has no Disallow-all; view-source of home has no `noindex` | Blocking for SEO, fix same day |
| 19 | Victor, analytics | Open the analytics dashboard | Visits from day D appear | Not blocking |
| 20 | Victor, `/admin` health monitor | Run the checks | All OK (see [health-monitor.md](./health-monitor.md)) | Act on the red line |
| 21 | Victor, mailbox | Confirm e-mails from steps 10 and 12 arrived (and admin "new sign-up" notice) | All received, English, links point to smartmarinaconnect.com | **Stop** - e-mails are never left broken |

Not part of day D: the Friday messages digest cron stays in `supabase/migrations/held/` until it is
deliberately scheduled after go-live.
