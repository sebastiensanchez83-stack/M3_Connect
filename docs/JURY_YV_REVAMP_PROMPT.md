# Claude Code task — Master jury prompt: fix, then rebuild the Yachting Ventures jury console around Gabbi's real group/panel/timetable workflow

Repo: `C:\Users\Victor\M3 Dropbox\Victor Meyer\MONACO MARINA MANAGEMENT\9 M3 Connect\Dev plateform\M3_Connect`. Read `CLAUDE.md` first.
Stack: React 18 + TS + Vite + Tailwind/Radix, Supabase (Postgres + RLS, Edge Functions/Deno, Resend). Supabase project_id = `djjbgzasuomhyfvtlidi`.

## How to run this — do the phases IN ORDER, one at a time
Run each phase as its own effort: complete it, show me the diff, let me review & push, THEN start the next. Do not attempt all phases in one pass.
- **PHASE 0 — Correctness & security fixes.** Small, safe, independent of the revamp; protects the live scoring being used now. **Do this first.**
- **PHASE 1 — YV console revamp** (panels / batches / timetable / availability-first emails / clean UI). The big build.
- **PHASE 2 — Architecture competition fixes.** Needed before the architecture jury cycle (not the innovation one).
- **PHASE 3 — Remaining polish/hardening.**

Ground rules (apply to every phase):
- **Never build locally** (Dropbox → EPERM). Branch, push, let Netlify build. Show me the diff before pushing.
- DB changes via Supabase migration on `djjbgzasuomhyfvtlidi`; before editing a DB function dump it with `pg_get_functiondef` and preserve its query verbatim, only adding what's specified. New functions `SECURITY DEFINER`, `set search_path`, gated with `sm_is_yv(event)` / `sm_is_staff()` like the existing `sm_*`.
- Edge fn deploy after editing `supabase/functions/sm26-jury-session/index.ts` (dashboard paste or `supabase functions deploy sm26-jury-session`).
- Read files before editing; locate by content, not line number. Never change the official Awards Score math except where told.

---

# PHASE 0 — Correctness & security fixes (do first)

### 0.1 Lock down `sm_admin_rankings` + show full coverage
`public.sm_admin_rankings(uuid,text)` is `SECURITY DEFINER`, executable by `authenticated`, with **no** authorization check — any logged-in user can read the live leaderboard once scores exist. In ONE function rewrite (preserve the existing query): (a) add `if not sm_is_staff() then raise exception 'Not authorized'; end if;` as the first statement, keep EXECUTE for `authenticated`; (b) seed the row set from **all non-declined competition entries** (LEFT JOIN assignments) so un-reviewed entries show as `—` instead of being absent — letting the admin confirm full coverage before awards. Verify a non-staff RPC call is rejected and the admin Rankings tab still works.

### 0.2 Fix stage → scorecard routing (`sm_jury_my_entries`)
The `template_key` CASE expects stage strings that don't match the live data, so ~15 of 19 innovations fall through to the generic "General" card instead of the pre/post-revenue cards. First run `select distinct sp.stage from sm_role_assignment ra join sm_startup_profile sp on sp.role_assignment_id=ra.id where ra.role='startup' and ra.event_id=(select id from sm_event where slug='sm26');` then update the CASE to map: **pre_revenue** ← Idea/Prototype/Pilot/Pre-revenue/Pre-seed stage/Seed stage/Early stage; **post_revenue** ← Early revenue/Scaling revenue/Scale-up / Established/Growth stage/Expansion stage; else **general**. Keep the `architecture% → 'architecture'` branch. **Confirm the mapping with Victor before applying** (the card locks per review once scoring starts). Verify every innovation resolves to an active template.

### 0.3 Fix the juror empty-state copy
`SM26JuryPage.tsx` (~line 372) promises *"M3 assigns jurors to entries and you'll be notified."* — reword to match the real flow, e.g. *"Yachting Ventures will invite you to a jury session, then you'll be asked to score each startup here."* (Phase 1 replaces the notification machinery, so no other notify change is needed in Phase 0.)

Verify Phase 0, show the diff, push, then proceed to Phase 1.

---

# PHASE 1 — YV console revamp

## Why this exists — how Gabbi (Yachting Ventures) really runs the jury
Gabbi does NOT assign one juror to one startup. She works in **panels, startup batches, and a rotation timetable** (sources: her planning workbook "MAIN - Smart Marina 2026 - M3 x YV" and her jury-confirmation email, quoted verbatim in Part 3).

**The canonical session format (from Gabbi's confirmation email — authoritative):** one session = **1 hour**, in which **3 jurors** hear **6 startups** pitch (each: 5-min pitch + 5-min Q&A), then each juror submits a short feedback form (scorecard) on each of the 6. So:
- **Startup Groups (SG1, SG2, …)** — a batch of **6 startups** reviewed together in one session. e.g. SG1 = Seares, SAMMY PC, Metarina, Effeto Venturi, Lika, Mediterranean Algae.
- **Jury panels (JG1, JG2, …)** — a panel of **3 jurors**, deliberately **balanced by juror type**. Every juror has a **Type** (`Angel` / `VC` / `Corporate`) and a **relationship owner** (`YV` or `M3`), plus onboarding status (contacted, JotForm complete/pending). e.g. JG1 = Bernard d'Alessandri (Corp), Violeta Balaguer (VC), Greg Chiappini (Angel).
- **Timetable** — panels are scheduled into one-hour time slots (09:00–10:00, 10:00–11:00, …), each panel meeting one startup batch. Each filled cell = one Zoom pitch session.
- Treat **6 startups / 3 jurors / 60 min** as the configurable default — don't hardcode; let Gabbi override per session.

**Availability-first flow (critical — the current platform lacks this):** Gabbi does NOT send the Zoom invite first. She emails each juror to *ask if they're available* for a proposed slot; only once the juror confirms does she send the Zoom invitation. So the pipeline is: **build panels & batches → propose a slot to a panel → email each juror an availability request → jurors RSVP (available / not) → once the panel is confirmed, send the Zoom invite → session runs → jurors score.**

The current console (`src/pages/SM26YVPage.tsx`) only supports ad-hoc per-innovation assignment + immediate-Zoom sessions. **Rebuild it so the console mirrors this model**, while keeping the existing scoring/rankings machinery intact underneath. Also bring its look up to the cleaner **Yacht Club console** (`src/pages/SM26PartnerPage.tsx`) standard.

> DATES: Gabbi's email template still reads "5th edition … 21-22 September 2024" — that is stale. The event is **2026**. Pull the edition label, venue and dates from the `sm_event` record (do not hardcode), and confirm the exact dates with Victor (CLAUDE.md notes 20–21 Sep 2026; the email says 21–22 Sep). Times are **Europe/Monaco** (CET/CEST) — display a clear tz label.

## Phase 1 specifics (in addition to the shared ground rules above)
- **Backward-compatible scoring:** the official Awards Score, `sm_admin_rankings`, `sm_review`, `sm_criterion_score`, and the juror page must keep working. Group assignment must **materialize into `sm_jury_assignment` rows** (every juror in a JG ↔ every startup in the SG they review) so scoring and rankings are unchanged. Keep `UNIQUE(juror_user_id, entry_role_assignment_id)` idempotency.
- Read `SM26PartnerPage.tsx` and reuse its idioms/components (tiles, `Funnel`, drawer) — extract shared pieces into `src/components/sm26/`.

---

## Part 1 — Data model (additive)
Add these tables + read/write RPCs (all event-scoped, YV/staff-gated):
- `sm_jury_group` — `id, event_id, code ('JG1'…), name, created_by`. A panel.
- `sm_jury_group_member` — `group_id, juror_user_id` (the juror's account) `+ jury_role_assignment_id`. UNIQUE(group_id, juror_user_id).
- `sm_startup_group` — `id, event_id, code ('SG1'…), name`. A batch of startups.
- `sm_startup_group_member` — `group_id, entry_role_assignment_id` (the startup's role assignment). UNIQUE(group_id, entry_role_assignment_id).
- Extend `sm_jury_session` (already exists) to optionally reference `jury_group_id` and `startup_group_id` and a `slot_label` (e.g. "09:00–10:00 CEST"), so a session = one JG × one SG × one slot. Keep the existing `sm_jury_session_entry` join (populated from the SG's members) so the Zoom-invite/attendee logic keeps working unchanged. Add a `zoom_sent` boolean / `zoom_sent_at` so the Zoom invite is a deliberate second step, not automatic on create.
- `sm_jury_session_juror` — per-juror **availability RSVP** for a session: `session_id, juror_user_id, status ∈ {invited, available, unavailable, confirmed}, responded_at, token`. This is what powers the availability-first flow.
- Store juror **Type** and **owner** on the jury role: `module_data.jury_type` ∈ {angel, vc, corporate} and `module_data.jury_owner` ∈ {yv, m3}. Add a staff/YV RPC `sm_yv_set_juror_meta(role_assignment_id, type, owner)`.
- **RSVP RPCs (reuse the platform's existing tokenized confirm/reject pattern — see `confirm_reference_by_token`):** `sm_jury_availability_by_token(token, answer)` so a juror can click Confirm / Not available in the email without logging in; it updates `sm_jury_session_juror.status`. A juror can also RSVP in-app from their `/sm26/jury` schedule.

RPCs to add (mirror existing `sm_yv_*` style, return rich rows for the UI):
- `sm_yv_jury_groups(event)` / `sm_yv_startup_groups(event)` — groups with their members (names, and for jurors their type/owner/status; for startups their company/stage/category/reg+payment status).
- `sm_yv_group_create/rename/delete`, `sm_yv_group_add_member/remove_member` for both group kinds.
- `sm_yv_timetable(event)` — returns the JG×SG×slot sessions with Zoom links + scoring progress per cell.
- **`sm_yv_materialize_assignments(session_id or jury_group_id, startup_group_id)`** — idempotently inserts `sm_jury_assignment` (competition='innovation', mandatory=true) for every juror×startup in the pairing, so scoring works. Call this whenever a JG is paired with an SG.

## Part 2 — YV console UI (rebuild `SM26YVPage.tsx`, Yacht-Club-clean)
Adopt the Yacht Club design language: a top **dashboard of clickable "à faire" tiles** that also filter, **progress `Funnel`s**, a **search box**, and **row → slide-in drawer** detail. Organize the page as tabs or stacked sections:

1. **Dashboard** — tiles (count + click-to-filter): *Startups not grouped*, *Jurors not in a panel*, *Panels missing a type mix*, *Sessions unscheduled*, *Evaluations outstanding*, *Payment pending*. Funnels: registration (submitted→confirmed→paid) and scoring (assigned→draft→submitted).
2. **Jury panels (Jury Groups)** — create/name panels (JG1…); add jurors via a picker that shows each juror's **Type (Angel/VC/Corporate)**, owner (YV/M3) and status; show each panel's **type mix** (e.g. "1 Angel · 2 VC · 1 Corp") and warn if unbalanced. Reuse the enriched assignable-juror data.
3. **Startup groups** — create/name groups (SG1…); add startups (6 each by default) via a picker showing company, stage (Pre/Post-Revenue), category, reg + payment status. Show "N startups not yet grouped".
4. **Timetable / scheduler** — the centrepiece: a grid of **time slots × jury panels** (or a per-panel schedule) where Gabbi drops a Startup Group into a slot for a panel. This is a **staged** flow, not one-click-Zoom:
   - **(a) Create the cell** → creates the `sm_jury_session` for that JG+SG+slot (status `draft`, **no Zoom yet**) and materializes the juror↔startup `sm_jury_assignment` rows. Each panel juror gets a `sm_jury_session_juror` row (`invited`).
   - **(b) "Send availability request"** → emails each panel juror the **availability email** (Part 3, action `notify_availability`) with Confirm / Not-available buttons. Cell shows RSVP progress (e.g. "2/3 available").
   - **(c) "Send Zoom invite"** → enabled once the panel is confirmed; NOW creates the Zoom meeting (reuse `sm26-jury-session` create/Zoom logic) and sends the `.ics` to the confirmed jurors + the SG's startups, and sets `zoom_sent`.
   - Support **Test-run** (real Zoom / emails only the tester) and **cancel** at every stage. Show each cell's state: draft → availability sent → confirmed → invited → scored (green/amber progress).
   Also offer a fast **auto-build**: given the panels, batches and a set of slots, propose a full rotation timetable Gabbi can review and adjust before sending anything.
5. **By-innovation drawer** — one row per startup; click opens a drawer with its full detail (reuse `sm_jury_entry_detail`), which **Startup Group** it's in, which **panels** review it and when, each assigned juror's submitted/pending status, and reg/payment. Move inline assign/unassign here for exceptions.
6. Keep a compact **jurors** view (per-juror: panel, type, assigned count, evaluated count).
7. Consistency: same Card/Badge/pill/spacing as `SM26PartnerPage.tsx`; Monaco-time via shared `TZ`/`fmtTime`; responsive (tables `overflow-x-auto`, tiles `grid-cols-2` mobile, full-width drawer on mobile); keep denied/loading states.

## Part 3 — Emails (three steps, matching Gabbi's real sequence)
All new actions live in `supabase/functions/sm26-jury-session`, YV/staff-gated, each with a `test_email` dry-run that sends only to the tester. Use the standard SM26 sender/branding. Pull edition/venue/dates from `sm_event` (do NOT hardcode "2024").

**Step 1 — `notify_availability` (the confirmation/availability email).** Sent per juror when Gabbi clicks "Send availability request" on a timetable cell. Reproduce Gabbi's exact wording (below), personalised, with **Confirm availability** / **Not available** buttons linking to `sm_jury_availability_by_token`. Template variables in `{{…}}` come from the session/event/panel:

> Subject: Your jury session — Smart Marina Rendezvous
>
> Dear {{juror_first_name}},
>
> Thanks once again for agreeing to participate as a jury member in the {{edition_ordinal}} edition of the Smart Marina Rendezvous, which will take place at the Yacht Club de Monaco on {{event_dates}}.
>
> We are now scheduling the jury sessions and would like to ask whether you're available on **{{session_day}} from {{session_time}} {{tz_label}}** for your session?
>
> During this hour, you will hear a pitch from **{{startup_count}} of the chosen startups** ({{pitch_minutes}} minute pitch per startup, followed by {{qa_minutes}} minutes Q&A). You will also be joined on the call by **{{co_juror_count}} other jury members**, and you will be asked to submit a short feedback form on each of the {{startup_count}} startups after the call.
>
> Please let me know if that works for you, and we will send you a zoom invitation.
>
> [ Confirm availability ]   [ Not available ]

Keep the friendly "please let me know" line AND the buttons — a reply still works, but the buttons let the console track RSVP automatically. Defaults: `startup_count`=6, `pitch_minutes`=5, `qa_minutes`=5, `co_juror_count`= panel size − 1 (=2). Record `last_availability_email_at` so Gabbi doesn't double-send.

**Step 2 — Zoom invite (existing `create` logic, now gated on confirmation).** Reuse the current `.ics` Zoom invite, but only send it when Gabbi clicks "Send Zoom invite" after the panel is confirmed — to the confirmed jurors + the SG's startups + the always-invite organisers.

**Step 3 — post-session "please score" (existing `notify_evaluate`).** Keep it; each juror gets their `/sm26/jury` link listing the {{startup_count}} startups they reviewed.

Optionally add a per-juror **full-schedule** summary (`notify_schedule`) for jurors on multiple panels: their slots, Zoom links and startups in one email. Record `last_scheduled_email_at`.

## Part 4 — Ripple (small)
- Juror scoring page (`SM26JuryPage.tsx`) + participant hub "Jury" tab: above the scorecards show the juror their **panel + schedule** (their sessions/slots, co-panelists, and the startups per slot) and an **in-app availability RSVP** for any slot still `invited`, plus the Zoom link once sent — so a juror sees "when do I judge, whom, and am I confirmed".
- Admin jury console (`AdminSM26Jury.tsx`): expose juror Type/owner and let admin see/override panels, groups and the timetable, and see RSVP status (staff can do everything YV can).

## PHASE 1 — Verify before pushing
1. Gabbi can, unaided: create panels of 3 (balanced by type), create startup batches of 6, drop a batch into a panel's slot → a `draft` session + materialized juror↔startup assignments (visible in the drawer, countable in `sm_yv_jurors`) — with **no Zoom sent yet**.
2. Availability-first flow works: "Send availability request" emails each juror the confirmation email with working Confirm / Not-available buttons; RSVPs update `sm_jury_session_juror` and the cell shows "N/3 available"; "Send Zoom invite" is gated until confirmed, then sends the `.ics`.
3. Scoring still works end-to-end: an assigned juror sees the right 6 startups + scorecard at `/sm26/jury`, submits, and it appears in `/admin/sm26/jury` → Rankings (Awards Score math unchanged).
4. Tiles count + filter; funnels reflect live data; drawer shows batch + panel + per-juror RSVP/score status; search narrows.
5. `notify_availability` (test-run) emails only the tester with the exact copy above, correct variables (6 startups, 5+5 min, 2 co-jurors, Monaco time, event dates from `sm_event`), and functioning tokened buttons.
6. `Funnel`/tiles shared with the Yacht Club console, which still renders identically. Responsive + light/dark. Idempotent group ops (no duplicate assignments on re-pair).
7. Summarize changes and show the diff; do not push until I confirm.

---

# PHASE 2 — Architecture competition fixes (before the architecture jury cycle; not needed for the innovation sessions)

### 2.1 Architecture scoring never finds its scorecard
Architecture assignments carry `competition = 'architecture_pro' | 'architecture_student'` (`AdminSM26Jury.tsx` ~70, inserted ~148), but the only architecture template has `competition = 'architecture'`, so `templateFor` (`SM26JuryPage.tsx:76`) matches nothing and every architecture entry shows "No scorecard configured" with no way to submit. **Fix:** normalize the family in `templateFor` — `const fam = e.competition.startsWith('architecture') ? 'architecture' : e.competition;` then match `t.competition === fam && t.key === e.template_key`. Don't touch the innovation path.

### 2.2 Architecture anonymity leak (logo + company image)
`supabase/functions/sm26-assets/index.ts` (~152-157) pushes the architecture entry's **logo** and **company image** unconditionally (only "proof" is gated by the juror `blind` flag), so a juror sees the firm's branding — breaking blind judging. **Fix:** gate the logo & company-image pushes behind `if (!blind) { … }`, like proof. Keep the project-render boards (the scored assets).

Verify: an assigned architecture juror can open an entry and see a scorecard with no logo/company-image tile. Show the diff; push.

---

# PHASE 3 — Remaining polish / hardening (batch when convenient)
Apply the edge-fn items as part of Phase 1 if that function is still open; otherwise here.
- **Email delivery honesty** (`sm26-jury-session`): send helpers swallow Resend errors so `create`/`cancel` report success even if 0 delivered. Return delivered/failed counts, surface "invited N, M failed", and add the `if (!RESEND_API_KEY) return 500` guard the other actions have.
- **Test-session safety:** add `if (session.is_test) return` to `notify_evaluate`/`notify_availability`; have the sessions list return `is_test` so the UI can hide send/cancel controls on `[TEST]` rows.
- **Orphan Zoom cleanup:** if the session insert fails after `zoomCreate`, call `zoomDelete(ztoken, meeting.id)` before returning 500.
- **.ics attendee privacy:** the attached `.ics` lists every attendee's email to every recipient — build a per-recipient `.ics` (organiser + that recipient) or drop the ATTENDEE lines, so grouped startups don't see each other's contacts.
- **Admin duplicate-assign** (`AdminSM26Jury.tsx` ~151): catch Postgres `23505` and show "Already assigned — refresh" instead of the raw error.
- **Admin entries filter:** exclude `registration.status = 'cancelled'` (not just 'declined') so the assign tab matches what rankings will rank.
- **Draft "X/100" preview** (`SM26JuryPage.tsx:105`): divide by the full template weight (or label "partial") so a partly-scored draft doesn't read 100/100.
- **Juror UI i18n:** the scoring UI is English-only on an EN/FR platform; at minimum show the "scoring is in English" note in the embedded account view too.

Verify each item you apply; show the diff; push.

```
Reference — Gabbi's workbook structure (for the implementer):
• Sheet "Jury Members": NAME, TYPE (Angel/VC/Corporate), MAIN CONTACT (YV/M3), CONTACTED (Yes/No), JOTFORM (Complete/Pending), EMAIL.
• Sheet "Jury Sessions": Startup Code (S1…) + Startup Name grouped into Startup Groups (SG1…SG6, ~4 each); Jury Name grouped into Jury Groups (JG1…JG8, ~3–4 each); a Slot × Jury-Group × Startup-Group timetable (slots 09:00–10:00 … 14:00–15:00).
• Sheet "Companies": the sourcing pipeline (STATUS: Sent Info→Chasing→Form Completed→Payment Made; SELECTION; STAGE Pre/Post-Revenue; INNOVATION CATEGORY) — background only; the platform's registered innovations are the source of truth for who to group.
```
