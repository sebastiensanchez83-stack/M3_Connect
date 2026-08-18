# Claude Code task — Fix the SM26 innovation jury functionality

You are working in the **Smart Marina Connect (M3 Connect)** repo:
`C:\Users\Victor\M3 Dropbox\Victor Meyer\MONACO MARINA MANAGEMENT\9 M3 Connect\Dev plateform\M3_Connect`

Stack: React 18 + TypeScript + Vite + Tailwind/Radix, Supabase (Postgres + RLS, Edge Functions/Deno, Resend email). Supabase project_id = `djjbgzasuomhyfvtlidi`. Read `CLAUDE.md` first.

## Ground rules (do not skip)
- **Never build locally** (the repo is on Dropbox → `npm run build` fails with EPERM). Make the edits, commit, push to GitHub, and let Netlify build.
- **DB changes** go through a Supabase migration (`apply_migration`) against project `djjbgzasuomhyfvtlidi`. Before editing any DB function, dump its current definition with `select pg_get_functiondef('public.<fn>'::regprocedure, ...)` and preserve the existing query verbatim — only add what's specified.
- **Edge function deploy**: after editing `supabase/functions/sm26-jury-session/index.ts`, deploy it (Supabase dashboard paste, or `supabase functions deploy sm26-jury-session` if logged in). Do not assume the local Supabase CLI is authenticated — confirm or tell me to deploy.
- **Read each file before editing.** Line numbers below are from the reviewed version and may have drifted — locate by content, not line number.
- Do **not** change the official Awards Score computation logic (`sm_admin_rankings` `elig` CTE) except where explicitly told.
- Work on a branch, and give me a short summary + the diff before pushing.

## Context: how the jury works today (already correct — don't break)
- Admin confirms jurors and sets each juror's competition scope in `/admin/sm26/jury` (`sm_set_jury_scope`).
- Jurors are assigned to innovations by Yachting Ventures (Gabbi) in `/sm26/yv` or by admin in `/admin/sm26/jury` — both write `sm_jury_assignment` (mandatory, competition='innovation'), dedup-safe.
- A Zoom "jury session" is scheduled from `/sm26/yv` (`sm26-jury-session` edge fn) which emails a `.ics` invite; after the session a "Email jurors to evaluate" button emails each juror their `/sm26/jury` scorecard link.
- Jurors score at `/sm26/jury` (also embedded as the "Jury" subtab of the participant hub). Scores write directly to `sm_review` / `sm_criterion_score` under RLS.

---

## TIER 1 — apply now (fairness + privacy of live scoring)

### 1. Lock down `sm_admin_rankings` (missing authorization)
**Problem:** `public.sm_admin_rankings(uuid,text)` is `SECURITY DEFINER`, executable by `authenticated`, and has **no** internal authorization check (unlike every sibling `sm_*` function). Any logged-in user can call it via RPC and read the live leaderboard (company names ranked by jury score) with RLS bypassed.
**Fix:** recreate the function preserving its exact body, but converted so a staff guard runs first. Add, as the first statement:
`if not sm_is_staff() then raise exception 'Not authorized'; end if;`
Keep `EXECUTE` granted to `authenticated` (the admin console calls it as the admin user). Verify a non-staff session gets `Not authorized` and the admin console Rankings tab still works.

### 2. Give jurors a reliable "please score" trigger (independent of a session)
**Problem:** Assigning a juror sends no email. The only score-nudge is `/sm26/yv`'s "Email jurors to evaluate" button, which is gated by `groupNames.length > 0` (`SM26YVPage.tsx` ~267) and rejected by the edge fn for sessions with no innovations (`sm26-jury-session/index.ts` ~247: "This session has no innovations attached"). So an all-jurors kickoff session offers no way to trigger scoring, and the juror empty-state falsely promises notification.
**Fix (do all three):**
- Edge fn `sm26-jury-session`: add a new action `notify_assigned` that emails **every innovation juror who has at least one `sm_jury_assignment`** for the event a link to `/sm26/jury`, listing the companies they were assigned. Reuse the existing per-juror email builder from `notify_evaluate`. Gate it on `sm_is_yv` / staff like the other actions. Support the existing `test_email` dry-run pattern (send only to the tester).
- `SM26YVPage.tsx`: add a button on the **"Jury assignments"** card header — "Email assigned jurors their scorecards" — that invokes `notify_assigned` (with a `confirm()` and a test-mode option consistent with the session Test-run). Keep the existing per-session "Email jurors to evaluate" button too.
- `SM26JuryPage.tsx` (~line 372) empty-state copy: replace *"M3 assigns jurors to entries and you'll be notified."* with wording that matches the real flow, e.g. *"Yachting Ventures assigns jurors to innovations. Once you're assigned you'll be emailed a link to score here — usually around your jury session."*

### 3. Fix the stage → scorecard routing (`sm_jury_my_entries`)
**Problem:** The `template_key` CASE in `sm_jury_my_entries` expects stage strings (`Idea/Prototype/Pre-revenue/Scaling revenue/...`) that don't match the live data, so ~15 of 19 innovations fall through to the generic **General** card instead of the pre/post-revenue cards. Safe to change now (0 reviews exist; the card locks per review once scoring starts).
**Fix:** First run `select distinct sp.stage from sm_role_assignment ra join sm_startup_profile sp on sp.role_assignment_id=ra.id where ra.role='startup' and ra.event_id=(select id from sm_event where slug='sm26');` to get the authoritative stage list. Then update the CASE to this mapping (extend if new stages appear):
- **pre_revenue:** `Idea`, `Prototype`, `Pilot`, `Pre-revenue`, `Pre-seed stage`, `Seed stage`, `Early stage`
- **post_revenue:** `Early revenue`, `Scaling revenue`, `Scale-up / Established`, `Growth stage`, `Expansion stage`
- **else:** `general`
Keep the `architecture% → 'architecture'` branch untouched. **Confirm this mapping with Victor before applying** — he may want specific stages judged on a specific card. Verify afterward that all innovation entries still resolve to an *active* template (no entry should hit "No scorecard configured").

---

## TIER 2 — before the architecture jury runs (NOT needed for the innovation session)

### 4. Architecture scoring never finds its scorecard
**Problem:** Architecture assignments carry `competition = 'architecture_pro' | 'architecture_student'` (`AdminSM26Jury.tsx` ~70, inserted at ~148), but the only architecture template has `competition = 'architecture'`. `templateFor` (`SM26JuryPage.tsx:76`) requires an exact `t.competition === e.competition` match → returns null → juror sees "No scorecard configured" and cannot submit.
**Fix:** normalize the family in `templateFor`, e.g. `const fam = e.competition.startsWith('architecture') ? 'architecture' : e.competition;` then match `t.competition === fam && t.key === e.template_key`. (Mirrors what `sm_jury_my_entries` already does for `template_key`.) Do not change the innovation path.

### 5. Architecture anonymity leak (logo + company image)
**Problem:** In `supabase/functions/sm26-assets/index.ts` (~line 152-157), the architecture entry's **logo** and **company image** are pushed unconditionally, not gated by the juror `blind` flag (only "proof" is gated). A juror scoring an architecture entry would see the firm's branding — breaking blind judging. All architecture entries have both populated.
**Fix:** gate the logo and company-image pushes behind `if (!blind) { ... }`, exactly like the proof asset. Keep the project-render boards (the assets meant to be scored).

---

## TIER 3 — robustness hardening (batch when convenient)
- **Email delivery honesty** (`sm26-jury-session`): `sendInvite`/`sendMail` swallow Resend errors, so `create`/`cancel` report success even if 0 delivered. Make them return a boolean, count delivered vs failed, return `{ invited, failed }`, and add the `if (!RESEND_API_KEY) return 500` guard that `notify_evaluate` already has. Surface "invited N, M failed" in the toast.
- **Test-session safety** (`sm26-jury-session` `notify_evaluate`, ~237): add `if (session.is_test) return` and have `sm_jury_sessions_list` return `is_test` so the UI can hide notify/cancel on `[TEST]` rows.
- **Orphan Zoom cleanup** (`sm26-jury-session` create, ~190-198): if the `sm_jury_session` insert fails after `zoomCreate`, call `zoomDelete(ztoken, meeting.id)` before returning 500.
- **Rankings coverage** (`sm_admin_rankings`): seed rows from all non-declined competition entries (LEFT JOIN assignments) so unassigned/unscored entries show as "—" instead of being absent — lets admin confirm full coverage before awards.
- **Admin duplicate-assign** (`AdminSM26Jury.tsx` ~151): catch Postgres `23505` and show "Already assigned — refresh to see the latest" instead of the raw error.
- **.ics attendee privacy** (`sm26-jury-session` ~73, 208): the attached `.ics` lists every attendee's email to every recipient. If jury/startup contacts shouldn't see each other, build a per-recipient `.ics` (organizer + that recipient only) or drop the ATTENDEE lines.
- **Polish:** draft "X/100" preview divides by scored-only weights (`SM26JuryPage.tsx:105`) — divide by full template weight or label "partial"; add an attention dot on the participant-hub "Jury" subtab when the juror has unscored assigned entries; show session time in Monaco time (not only UTC) in the invite email body.

---

## Verification before you push
1. DB functions: `pg_get_functiondef` shows the guard/mapping changes; a non-staff RPC call to `sm_admin_rankings` raises `Not authorized`; every innovation entry resolves to an active template.
2. Edge fn deployed; run a **session Test-run** (creates a real Zoom, emails only the tester) to confirm Zoom + Resend still work end-to-end, then cancel it.
3. `notify_assigned` test-run emails only the tester and links to `/sm26/jury`.
4. Innovation juror flow unaffected: assign → juror sees the entry + correct scorecard → save draft → submit → score appears in admin Rankings.
5. Architecture juror (Tier 2) can now open an assigned entry and see a scorecard, with no logo/company-image tile.
6. Summarize changes and show the diff; do not push until I confirm.
