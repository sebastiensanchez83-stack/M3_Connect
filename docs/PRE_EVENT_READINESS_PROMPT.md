# SMART MARINA CONNECT — PRE-EVENT READINESS AUDIT & HARDENING

**Master prompt. Read this whole file before doing anything.**

---

## 0. Who you are and what this is

You are a senior engineer taking over Smart Marina Connect (SMC) **7 weeks before the
event it has to run**: the *Smart & Sustainable Marina Rendezvous 2026* (SM26), 6th
edition, **20–21 September 2026**, Yacht Club de Monaco, organised by M3 Monaco.
Today's date matters — compute it and work backwards from the event.

The platform has been built fast and broadly over ~4 months. It is feature-rich.
**It has never been operated end to end with real people.** That is the risk.

**The owner's instruction, verbatim in spirit:**

> "I want to spend more time managing the registrations, information and follow-ups
> than changing features and correcting things."

So your job is **not** to add features. Your job is to prove the platform works, close
the gaps that would embarrass or block us during the event, and hand back an
operational system plus a runbook. Any new build must earn its place by removing
manual work or removing a risk — and must be approved before you build it.

**Three questions you are answering:**

1. **Is anything broken or missing that stops the event from running?** (blockers)
2. **Is everything interconnected and tracked** — does an action in one place update
   every other place that depends on it, and can Victor *see* the state of everything
   without opening the database?
3. **What should be deliberately left until after the event?**

---

## 1. Hard ground rules — violate none of these

**Repo & environment**
- Repo: `C:\Users\Victor\M3 Dropbox\Victor Meyer\MONACO MARINA MANAGEMENT\9 M3 Connect\Dev plateform\M3_Connect`
  (French spelling *"Dev plateform"*). It lives **inside Dropbox** — `git pull` before
  editing, keep commits small, a second session may be touching the same checkout.
- Branch policy: **commit and push straight to `main`.** No staging branch, no branch
  deploys. Netlify builds `main` → production.
- Verify with **`npx tsc --noEmit` only**. **Never run `npm run build`** (Dropbox
  EPERM). `npm install` is fine.
- `Glob` fails on this repo's space-containing path — use `Grep` / `ls`.

**Database**
- Supabase project **`djjbgzasuomhyfvtlidi`** ("M3 connect", eu-west-1) is
  **PRODUCTION. There is no staging.** Every migration you apply is live.
- Schema changes must be **additive** and reversible. Never drop or rewrite a column
  holding participant data.
- **Test privileged behaviour with rolled-back impersonation**, e.g.
  `begin; set local role authenticated; set local request.jwt.claims='{"sub":"<uid>","role":"authenticated"}'; <query>; rollback;`
  When testing an org/permission guard, pick a **non-admin** member — M3 Monaco's own
  members are moderators and will sail through every guard, which looks like a bug.
- Any new `SECURITY DEFINER` function: pin `search_path`, and **qualify table
  references** if `RETURNS TABLE` reuses a column name like `id` or `text` (this has
  already caused one live "ambiguous column" bug).

**Frontend landmines**
- **Never add hooks, effects or subscriptions to `AuthContext` / `AuthProvider`.** It
  white-screens the entire app (HMR / Web-Locks fragility). Wire cross-cutting calls
  into leaf components.
- Uploads to the `profile-images` bucket **must** start the path with the uploader's
  `auth.uid()` as the first folder. Other buckets differ — check the policy first.
- The Supabase client is **untyped**; dynamic `.from(tableVar)` compiles. Don't assume
  type safety catches a wrong table name.

**Edge functions**
- Deploy via the Supabase MCP, inlining the **full ASCII** source; preserve the
  existing `verify_jwt` setting; **verify by re-fetching** the deployed source.
- Some repo copies have drifted from the deployed version. Treat the **deployed**
  version as the truth and resync the repo copy when you touch one.
- Prefer a client-side fix over redeploying a large edge function you don't need to
  change.

**Real people — the most important rule**
- The system holds **real registrants, real jurors, real partners** and it sends real
  email through Resend, creates real Zoom meetings, and can create real accounts.
- **Never trigger a broadcast, a jury invitation, a payment reminder, a Zoom session
  or an intro email against real recipients.** Every one of these has a *test /
  preview-to-me* mode — use it, or use rolled-back transactions.
- If a check genuinely cannot be done without emailing someone, **stop and ask.**

---

## 2. What already exists — don't re-discover it, verify it

This is a map, not gospel. **Every claim below must be re-verified against current
code and the live DB before you rely on it.** Where reality differs from this list,
that difference is itself a finding.

**Core SMC:** organisations + members (tiers, claim codes, verification), profiles /
personas (`individual`, `marina`, `partner`, `media_partner`, `investor`, staff),
onboarding, B2B connect/marketplace, resources, webinars, generic events, ad banners,
public org profiles, admin consoles.

**SM26 module (`sm_*` tables, ~40 of them):** registration + per-role assignments
(startup / marina / architect_pro / architect_student / jury / speaker / sponsor /
investor / visitor / media), role-specific data (`sm_startup_profile`,
`sm_architecture_entry`, `sm_marina_extra`, `module_data`), requested-info loop,
editing deadlines, multi-attendee roster with per-attendee badges and check-in,
payments + invoices, e-catalogue round-trip with the Yacht Club, agenda / workshops /
slides / live Q&A, jury (panels, batches, slot×panel timetable, availability-first
emails, assignments, weighted scorecards, rankings), architecture competition file
exchange (blind), awards + public voting, investor portfolio, networking
(badge QR → connection request → admin-facilitated intro), notifications,
feedback, sponsorship fulfilment tracker (`sp_*`).

**Partner consoles:** `/sm26/partner` (Yacht Club de Monaco — dossiers, e-catalogue
design loop, sponsor assets), `/sm26/yv` (Yachting Ventures — innovation jury
panels/batches/timetable), `/account?tab=sponsorship` (sponsor portal).

**Edge functions (~20 live):** `sm26-register`, `sm26-provision`, `sm26-email`
(multi-kind), `sm26-reminders` (+ 2 pg_cron jobs), `sm26-draft`, `sm26-assets`,
`sm26-attendee-invite`, `sm26-badge-email`, `sm26-jury-session`, `sm26-connection`,
`sm26-ecat-change-files`, `sm26-media-kit`, `sm-sponsor-assets`, `sponsor-invite`,
`guest-webinar-*`, `claim-code-signup`, `send-email`, … — **enumerate the real list**.

**Existing audit artefacts in `docs/` (uncommitted, read them before starting so you
don't repeat work):** `registration-onboarding-audit.md` (52 findings, Jul 21),
`JURY_YV_REVAMP_PROMPT.md`, `JURY_FIX_PROMPT.md`, `JURY_EFFICIENCY_PROMPT.md`,
`JURY_YV_CLEANUP_PROMPT.md`, `sm26-yv-matching-gaps.md`, `media-profile-refactor-BRIEF.md`,
`sm26-import-tool-BRIEF.md`. Also `APPLIED_MIGRATIONS.md` and `HANDOFF.md`.

**Known-deferred items (confirm status, don't silently re-litigate):** incubator
module (post-event), FR/EN i18n (English-only for launch), Jotform webhook
auto-registration (manual CSV import instead), free-text→canonical category
normalisation, org write-back for description/logo/socials, HubSpot sync.

**Known open risk carried forward — verify whether still open:**
- `sm26-assets` (and `sm26-ecat-change-files`, `sm26-media-kit`) sign
  participant-writable storage paths with the **service role** → a participant who
  PATCHes their own `module_data` to another path can read other participants' files.
  Fix requires an allowlist that still permits legit non-uid prefixes such as
  `imported/rehost/…`.
- `requireFreshSession()` is applied to participant-facing writes but **not to the
  admin consoles** — a long-idle admin tab silently fails writes (0-row UPDATEs that
  look like success). Admin consoles are exactly what gets used on-site.
- Entry-QR emails depend on a **third-party QR image API** (`api.qrserver.com`).

---

## 3. PHASE 0 — Ask Victor first (do this before any deep work)

Ask these as a compact numbered list, each with **your recommended default** so he can
answer "defaults except 3 and 7". Do not start Phase 1 until he answers. Add or drop
questions if your first 30 minutes of reading changes what matters.

1. **Scope of this pass** — whole platform (core SMC + SM26 + sponsorship), or SM26
   event-critical only? *(Recommend: whole platform, but everything triaged against
   "does it affect the event".)*
2. **Fix authority** — after the audit, should I fix BLOCKER + HIGH items immediately
   without a second approval round, and hold MEDIUM/LOW for your call?
3. **Freeze date** — what date do you want the platform feature-frozen (only bug fixes
   after)? *(Recommend: ~1 September, so 3 weeks of pure operation + rehearsal.)*
4. **Live-email rehearsal** — jury invitations, payment reminders, entry-QR emails and
   networking intros have never been sent to real inboxes. Do you want a **controlled
   rehearsal** with 2–3 friendly recipients, and who?
5. **Architecture competition** — the submission deadline is set to **19 Aug 2026**.
   Is the competition pack uploaded, do the architects have platform accounts, and is
   that date still correct?
6. **Who else logs in before the event** — is the Yacht Club de Monaco partner user
   provisioned? Gabriella / Yachting Ventures? Sponsors? Jurors? I need the list of
   humans who must be able to log in, and by when.
7. **On-site reality** — what is the network at YCM (venue wifi? 4G? how many staff
   phones?), and do you want a degraded-mode fallback for check-in if connectivity
   drops?
8. **Badges** — are you printing physical badges from the CSV, emailing entry QRs to
   phones, or both? This determines what must work by which date.
9. **Money** — should payment status, invoices and the extra-attendee (€210/person)
   charges be reconcilable *from the platform* (exports), or do you keep that in your
   own accounting and only need status flags here?
10. **Languages** — English-only stays for the event, confirmed? (FR/EN was in the
    original spec.)
11. **What are you already doing manually that you hate?** Name the 3 chores. Those
    are the only new features worth building before the event.
12. **Post-event line** — anything on your wish list you *know* can wait until after
    20–21 September? Say it now and I'll park it explicitly.

---

## 4. PHASE 1 — Read-only audit (no writes, no commits)

Work through every domain below. For each, you must **verify against code AND live
data** — read the component, read the RPC definition (`pg_get_functiondef`), and run a
read-only query against the live DB to see what the data actually looks like today.
"The code supports X" is not a finding; "the code supports X, and 14 of 46 rows are in
a state where X silently does nothing" is a finding.

Record every finding with: **ID · severity · one-sentence defect · concrete failure
scenario (real inputs → wrong outcome) · file/RPC location · fix sketch · effort ·
before-or-after-event**.

**Severity ladder**
- **BLOCKER** — the event cannot run, or data is lost/corrupted, or private data leaks.
- **HIGH** — a real user hits a visible failure or an M3 operator is forced into manual
  DB work.
- **MEDIUM** — degraded experience, missing tracking, avoidable manual effort.
- **LOW / POST-EVENT** — polish, tech debt, nice-to-have.

### Domains

**A. Identity, accounts and access**
Signup, guest registration, claim codes, `sm26-provision`, `sm26-attendee-invite`,
`/welcome` set-password, magic-link redirect allow-list, persona assignment,
`access_status` vs `sm_registration.status` vs `sm_role_assignment.status` (three
status machines — are they ever contradictory today? query it), duplicate
organisations, org membership vs registration ownership, admin impersonation,
privilege-escalation guards. **Count today: how many registrations have no account,
how many attendees have no `user_id`, how many jurors cannot log in.**

**B. Registration data completeness and the information loop**
Per-role required fields vs what's actually filled (produce the real completeness
table across all registrations); the requested-info picker → participant hub →
`info_provided` → admin alert loop; editing deadline and roster deadline behaviour on
the day they expire; billing address / VAT / headcount capture; imported vs
natively-registered rows behaving identically; free-text categories that don't map to
the canonical list.

**C. Assets, files and documents**
The `sm26-assets` resolver and every surface that consumes it; the **service-role
signer path-validation hole**; storage bucket policies (public vs private, per-bucket
path conventions); orphaned files (registration deleted, files remain); files still
pointing at external Jotform URLs; missing previews; the ≤10 MB / ≤50 MB limits;
blind-judging leakage (architecture — filenames, `module_data.hero_image`, company
images, both channels).

**D. Jury and competitions**
Panels / batches / slot×panel timetable → do pairings **materialise into
`sm_jury_assignment`** so rankings and scorecards stay correct? Scorecard template
selection per stage/competition; who hasn't scored; blind architecture end-to-end;
architecture file submission under its own deadline; the 19 Aug architecture deadline
vs today; innovation scoring model weights; `sm_admin_rankings` correctness (recompute
by hand for 2 entries and compare); availability-first email flow; Zoom session
creation, cancellation and the .ics.

**E. Awards and public voting**
6 awards (Innovation jury + public; Architecture pro jury, student jury, public per
category); vote window open/close; eligibility = checked-in attendee, 1 vote per
competition, dedup; tally correctness; ties; the screen/leaderboard view; winner
confirmation and the public showcase. **Trace one full vote as a rolled-back
transaction.**

**F. Agenda, workshops, Q&A**
Are the sessions **published**? Workshop capacity enforcement, the waitlist (does it
exist? the spec asked for one), booking/cancel race conditions, personal calendar and
`.ics`, slide upload and the three flags that gate "Download slides", live Q&A
moderation.

**G. Check-in, badges and on-site operation**
Per-attendee badges and tokens; `sm_ensure_badges` coverage (who would arrive without
a badge?); the QR scanner across iOS Safari / Android Chrome; the third-party QR image
dependency; walk-ins and door sales; name-search fallback; undo/duplicate scans;
multi-window check-in; **what happens when the network drops mid-scan**; the CSV export
the badge printer needs.

**H. Payments, invoices and reconciliation**
Fee schedule vs what's stored (Marina €1,440 / Innovation €720 / Architecture €600 pro,
€120 student / Visitor €480 / extra attendee €210); invoiced vs paid vs waived; the
reminder path; invoices without files and files without invoices; VAT and billing
data; **can you produce a single export that reconciles who owes what?**

**I. Communications and tracking**
Inventory **every** outbound message: kind → trigger → recipient → template →
idempotency → where it's logged. Then answer the owner's real question: *can Victor
see who has been emailed what, and who never opened/replied?* Check Resend domain
auth (SPF/DKIM/DMARC for the sending domain), bounce visibility, the
transactional-vs-marketing unsubscribe split, the pg_cron reminder jobs and their
dates, in-app notifications, and whether any trigger can double-send or storm.

**J. Partners, sponsors and the e-catalogue**
YCM console access and scoping (what can they see that they shouldn't — emails,
phones, fees?); YV console; sponsor portal and `sp_*` entitlement fulfilment;
the e-catalogue round trip (export → design → upload → participant approval →
publish) end-to-end for one real page; who among these partners actually **has a
working login today**.

**K. Public surface**
`/events`, the event detail page, programme, speakers, the SM26 feature flag state on
production, dead links and 404s, the register → confirm → hub path for a brand-new
visitor, home-page partners, share/OG metadata, mobile layout of the pages a
participant will actually open on their phone at the venue.

**L. Security and privacy**
RLS coverage sweep across **all** tables (any table with RLS on but no policy — is
that intentional RPC-only, or an accident?); `SECURITY DEFINER` functions without a
pinned `search_path`; anon-executable RPCs; consent flags default state (opt-in, not
pre-ticked); GDPR erasure path and retention; PII exposure in RPC payloads (email,
phone) per audience; secrets in the repo; the storage-policy blanket-read class of bug.

**M. Reliability and operations**
Error monitoring (is there any?); Supabase backup / PITR settings and whether a
restore has ever been rehearsed; migration manifest vs live DB drift; edge-function
repo drift; Netlify env vars and build health; pg_cron job status; rate limits
(Supabase, Resend, Zoom); what the rollback plan is if a bad deploy lands on the
morning of 20 September.

**N. Operator experience — the "management" the owner actually wants**
Pretend you are Victor on a Tuesday in September. Can you, **without touching SQL**:
see who registered this week; who hasn't paid; who hasn't completed their info; who
hasn't confirmed their attendee list; which jurors haven't scored; which e-cat pages
are stuck; which sessions are unpublished; who checked in yesterday; which
introductions are pending? For each "no", that's a finding — and the fix is usually a
list + a filter + an export, not a new subsystem.

### Phase 1 output

Write **`docs/PRE_EVENT_AUDIT.md`** containing:
1. A one-page executive summary — *is the platform ready, yes/no, and what's in the
   way* — written for Victor, not for an engineer.
2. The findings table, severity-ranked.
3. A **journey matrix**: for each persona (new visitor, imported startup, juror,
   architect, marina exhibitor, speaker, sponsor, YCM, Yachting Ventures, attendee on
   a company roster, M3 admin) — every step from first email to post-event, marked
   ✅ verified / ⚠️ works-but-untested-with-real-users / ❌ broken / ➖ n/a.
4. An **interconnection map**: for each core entity (registration, role, attendee,
   badge, payment, invoice, e-cat page, jury assignment, review, vote, connection),
   who writes it, who reads it, and what breaks when its status changes. Include the
   orphan/consistency queries you ran and their results.
5. The **countdown**: dated milestones between today and 21 September, and what must
   be true by each one.

---

## 5. PHASE 2 — Recommend, then wait

Present, in chat and in the doc:

- **Must fix before the event** (BLOCKER + HIGH), with effort estimates.
- **Worth building before the event** — only things that remove recurring manual work
  or a real risk. Justify each in one line: *"this saves Victor X per week"* or
  *"without this, Y fails on the day"*. Rank them.
- **Explicitly park until after the event** — and say why it's safe to park.
- **Anything you found that Victor should decide, not you** — ask it as a question with
  a recommended default.

**Then stop and wait for approval.** Do not start building.

---

## 6. PHASE 3 — Execute

Once approved, work in **priority order**, and for each item:

1. State what you're changing and what could break.
2. Make the smallest change that fully fixes it.
3. `npx tsc --noEmit` clean.
4. Verify behaviourally — rolled-back impersonation for anything permission- or
   data-shaped; a real read-only query proving the data now looks right; a re-fetch
   proving an edge deploy took.
5. Commit with a message describing the user-visible effect, push to `main`.
6. Report: what changed, what you verified, what you could **not** verify and why.

Never mark something done that you could not verify. Say "shipped, unverified because
it would email 46 real people" — that's a legitimate and useful answer.

---

## 7. PHASE 4 — Hand back an operable system

Final deliverables, in the repo:

1. **`docs/PRE_EVENT_AUDIT.md`** — updated with what was fixed, what remains, and the
   honest residual-risk list.
2. **`docs/EVENT_RUNBOOK.md`** — the operator's manual, written for Victor and any M3
   colleague:
   - **Now → 20 September**, week by week: what to send, what to check, which admin
     screen, which button.
   - **Day-of, hour by hour**: doors open, check-in, voting window open/close, award
     reveal, what to do when the wifi dies, what to do when someone arrives without a
     badge, who to call.
   - **After**: feedback, results, portfolio, introductions, invoices, data retention.
   - For every step: the exact URL and button, and how to tell it worked.
3. **`docs/KNOWN_LIMITATIONS.md`** — everything deliberately not fixed, with the
   workaround, so nobody is surprised at the venue.
4. **`docs/POST_EVENT_BACKLOG.md`** — the parked list, ready to pick up on 22 September.

---

## 8. How to work

- **Evidence over assumption.** Every claim in your report must be traceable to a file,
  an RPC definition, or a query result you actually ran.
- **Be adversarial with your own findings.** Before you report a bug, try to prove it
  isn't one. Several past "bugs" here were false alarms (role strings that matched
  fine, architects that imported correctly). A wrong finding costs Victor's time.
- **Be adversarial with prior work too**, including everything asserted in section 2.
  It was true when written; it may not be true now.
- **Report what you skipped.** If you sampled 10 of 46 registrations, say so.
- **Don't gold-plate.** A missing CSV export beats a new dashboard. The event is in
  7 weeks and the owner wants to run it, not test it.
- **Ask when the answer changes the work.** Otherwise pick the sensible default, state
  it, and keep going.
