# Claude Code task — Make the SM26 jury workflow maximally efficient

Repo: `C:\Users\Victor\M3 Dropbox\Victor Meyer\MONACO MARINA MANAGEMENT\9 M3 Connect\Dev plateform\M3_Connect`. Read `CLAUDE.md` first.
Stack: React 18 + TS + Vite + Tailwind/Radix, Supabase (Postgres + RLS, Edge Functions/Deno, Resend). Supabase project_id = `djjbgzasuomhyfvtlidi`.

## Goal
The jury feature already works. Optimize it for **throughput and low friction**: fewer clicks to assign jurors, no manual chasing of who hasn't scored, at-a-glance coverage/status, and faster scoring for jurors. Do **not** change the official Awards Score logic, the RLS gates, or break the current flow — these are additive efficiency wins.

## Ground rules
- **Never build locally** (Dropbox → EPERM). Edit, commit to a branch, push, let Netlify build. Show me the diff before pushing.
- **DB changes** via Supabase migration on project `djjbgzasuomhyfvtlidi`. New/edited functions stay `SECURITY DEFINER`, keep `set search_path`, and re-check authorization with `sm_is_yv(p_event_id)` (YV console) or `sm_is_staff()` (admin) exactly like the existing `sm_yv_*` functions.
- **Edge fn deploy**: after editing `supabase/functions/sm26-jury-session/index.ts`, deploy it (dashboard paste or `supabase functions deploy sm26-jury-session`).
- Preserve the `UNIQUE(juror_user_id, entry_role_assignment_id)` dedup guarantee — every assignment path must stay idempotent.
- Read each file before editing; locate by content, not line number.

## Relevant surfaces
- Yachting Ventures console: `src/pages/SM26YVPage.tsx` + RPCs `sm_yv_innovations`, `sm_yv_jurors`, `sm_yv_assignable_jurors`, `sm_yv_assignments`, `sm_yv_assign`, `sm_yv_unassign`.
- Juror scoring: `src/pages/SM26JuryPage.tsx` + `sm_jury_my_entries`, `sm_jury_entry_detail`.
- Admin console: `src/components/admin/AdminSM26Jury.tsx` + `sm_admin_rankings`, `sm_set_jury_scope`.
- Notifications: `supabase/functions/sm26-jury-session/index.ts` (`notify_evaluate`).

---

## A. Bulk & balanced juror assignment — the biggest time saver
Today Gabbi assigns jurors one dropdown at a time (~3 jurors × ~19 innovations ≈ 57 manual picks, each a network round-trip under a shared `busy` lock), and the option shows only a bare name — no way to match by expertise or balance load.

1. **Enrich the assignable list.** Extend `sm_yv_assignable_jurors(p_event_id)` to also return `company`, `domain` (from `sm_registration` / `module_data->>'domain'`), and `current_load` = count of that juror's innovation assignments for the event. Render each dropdown/list option as `Name · Company · N assigned` so Gabbi can pick by expertise and see who's overloaded.
2. **Multi-select per innovation.** Replace the single-pick `<select>` with a compact multi-select (checkbox popover) so several jurors can be added to one innovation in a single action, writing via a new `sm_yv_assign_bulk(p_entry uuid, p_jurors uuid[])` that inserts all pairs idempotently in one call.
3. **Auto-balance button.** Add "Auto-assign N jurors per innovation" (numeric input + Distribute button) backed by a new `sm_yv_autobalance(p_event_id uuid, p_per_entry int)` that round-robins the assignable innovation jurors across every innovation up to `p_per_entry`, always picking the least-loaded eligible jurors first, skipping pairs that already exist, and returning `{created, skipped}`. One click instead of 57. Show a confirm + result toast.
4. **Fast unassign.** Keep the per-pill remove, and add a "Clear" on each innovation row (bulk-delete that entry's assignments) for quick re-do.
5. Batch the writes so the UI isn't disabled between every single pick (optimistic update, then reconcile).

## B. Coverage & live status at a glance
6. **Coverage header** on the "Jury assignments" card: `X of 19 innovations still need a juror · avg N jurors/innovation · Y jurors unused`, computed from `sm_yv_assignments` + `sm_yv_assignable_jurors`.
7. **Per-row signal:** an amber "Unassigned" badge on any innovation with 0 jurors; a small load chip (`3 assigned`) next to each juror in the Innovation-jury table.
8. **Keep all counters in sync.** After any assign/unassign/bulk op, refresh the jurors table + the outstanding-evaluations rollup too (not just `sm_yv_assignments`), or recompute them client-side from the assignments array, so every number on the page moves together without a manual Refresh.

## C. Faster juror scoring (`SM26JuryPage.tsx`)
9. **Prev / Next between assigned entries** inside the scoring view, so a juror moves through their queue without returning to the list each time; show `Entry 3 of 6`.
10. **Keyboard scoring:** number keys `0–5` (or `0–scale_max`) set the focused criterion's score; `Tab`/arrows move between criteria; `Enter` on the last submits if valid. Respect the existing locked/COI/validation rules.
11. **Autosave drafts** (debounced ~1.5s after a change) so nothing is lost; keep the explicit "Submit review", but make "Save draft" redundant with a subtle "Saved" indicator.
12. **Progress + sticky submit:** a `5/8 criteria scored` indicator and a sticky bottom bar with the running `/100` and the Submit button, so long scorecards don't require scrolling to act.
13. **Attention dot + count** on the participant-hub "Jury" subtab (`SM26MyRegistrationPage.tsx`) whenever the juror has unsubmitted assigned entries (reuse the `sm_jury_my_entries` count), so multi-role jurors notice their queue.

## D. Stop the manual chasing
14. **One-click "chase outstanding".** Add a `notify_outstanding` edge action (or extend `notify_evaluate`) that emails **only** jurors who have at least one *assigned* innovation with no submitted review yet, each getting their `/sm26/jury` link and the specific companies still pending. Expose it as a button on the YV console ("Remind jurors who haven't scored — N left"), gated on `sm_is_yv`/staff, with the existing `test_email` dry-run and a `confirm()`.
15. **Avoid double-sends:** record and show `last_notified_at` per juror (or per session) so Gabbi can see who was already reminded and when.

## E. Admin throughput (`AdminSM26Jury.tsx`)
16. **Bulk scope:** alongside "Confirm all pending", add "Set all unscoped → Innovation" (bulk `sm_set_jury_scope`) since the vast majority of jurors are innovation — removes per-juror dropdown fiddling.
17. **Rankings coverage & filter:** have `sm_admin_rankings` seed rows from all non-declined competition entries (LEFT JOIN assignments) so unreviewed entries show as `—`, and add a "needs attention" filter (below review quorum or high dispersion) so the admin can jump straight to what still needs adjudication before awards.

---

## Verify before pushing
1. `sm_yv_autobalance` produces a balanced, idempotent distribution (re-running creates 0 duplicates); `sm_yv_assign_bulk` is idempotent; multi-select and Clear behave.
2. Coverage header + unassigned badges + load chips match the DB; all counters update after every assign/unassign without a manual Refresh.
3. Juror scoring: Prev/Next, keyboard entry, autosave, sticky submit, and the Jury-tab attention dot all work; validation/lock/COI rules unchanged; the official score is unaffected.
4. `notify_outstanding` (test-run) emails only the tester and targets only jurors with unsubmitted assigned entries.
5. Admin bulk-scope and the rankings coverage view work; Awards Score numbers are identical to before for already-scored entries.
6. Confirm the edge function is redeployed. Summarize changes and show the diff; do not push until I confirm.
