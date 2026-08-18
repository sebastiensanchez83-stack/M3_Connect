# Claude Code task — Bring the Yachting Ventures console up to the Yacht Club console's design standard

Repo: `C:\Users\Victor\M3 Dropbox\Victor Meyer\MONACO MARINA MANAGEMENT\9 M3 Connect\Dev plateform\M3_Connect`. Read `CLAUDE.md` first.
Stack: React 18 + TS + Vite + Tailwind/Radix, Supabase. Supabase project_id = `djjbgzasuomhyfvtlidi`.

## Goal
Redesign the **Yachting Ventures console** (`src/pages/SM26YVPage.tsx`, Gabbi's page) so it looks and works like the cleaner **Yacht Club console** (`src/pages/SM26PartnerPage.tsx`, Olivia's page). This is a **presentation / information-architecture** pass — reuse the existing RPCs and data, don't change the DB or the assignment logic. The two consoles should feel like one product.

## Ground rules
- **Never build locally** (Dropbox → EPERM). Edit on a branch, push, let Netlify build. Show me the diff before pushing.
- **No DB/RPC changes** required — keep using `sm_yv_innovations`, `sm_yv_jurors`, `sm_yv_assignable_jurors`, `sm_yv_assignments`, `sm_yv_assign`, `sm_yv_unassign`, `sm_jury_sessions_list`, and the `sm26-jury-session` edge fn exactly as they are. (If a small read-only field would help a tile/funnel, add it additively to an existing `sm_yv_*` function, keeping its `SECURITY DEFINER` + `sm_is_yv` gate + `search_path`.)
- Read **`SM26PartnerPage.tsx` first** and mirror its patterns/idioms; where practical, **extract the shared pieces into `src/components/sm26/`** and use them in BOTH consoles so they don't drift.
- Preserve every current capability of the YV page (stats, sessions create/cancel/test-run/notify, assignments, innovations table, jurors table). This is a re-layout, not a feature cut.

## Model to copy — what makes the Yacht Club console "clean"
Study these in `SM26PartnerPage.tsx`:
- **"À faire" dashboard tiles** — the `TILES` array (~line 236), `FilterKey`, `matchFilter` (~246), and the `filter` state: colored stat tiles that count what still needs doing AND act as one-click filters over the list.
- **Segmented progress funnels** — the `Funnel` component (~line 266) and `catFunnel`/`kitFunnel` (`useMemo`).
- **Organized by société with a slide-in drawer** — one row per company; `openReg` / `drawerCompany` open a drawer holding everything for that company in one place.
- **Search + grouping** — the `q` search state and category grouping of rows.
- **Monaco time** — `const TZ = 'Europe/Monaco'` + `fmtTime`/`dayKey` helpers.

## What to build on the YV console

### 1. Header + "à faire" dashboard (top of page)
Replace the current 4 plain stat boxes with the Yacht Club treatment: keep the navy hero, then a row of **clickable "à faire" tiles** that both count and filter. Suggested tiles (derive from the existing RPC data):
- **Innovations sans juré** — innovations with 0 assigned jurors (`sm_yv_assignments` grouped).
- **Évaluations en attente** — jurors with assigned-but-unsubmitted reviews (the existing `incompleteJurors` logic).
- **À confirmer** — innovation entries with `reg_status ≠ confirmed`.
- **Paiement en attente** — innovations with `payment_status` not paid/waived.
- **Sessions à venir** — upcoming non-cancelled `sm_jury_sessions_list`.
Clicking a tile filters the innovation list below to the matching rows (mirror `matchFilter` + `filter` state). Add a small **search box** over innovations/jurors like the Yacht Club `q`.

### 2. Progress funnels
Add one or two segmented `Funnel`s (reuse the component) summarizing the pipeline at a glance:
- **Registration funnel:** submitted → confirmed → paid.
- **Scoring funnel:** assigned → in progress (draft) → submitted.
Extract `Funnel` from `SM26PartnerPage.tsx` into `src/components/sm26/SM26Funnel.tsx` and import it in both pages.

### 3. Organize by innovation (société) with a drawer
Turn the innovation list into **one row per innovation** (company, contact, reg/payment pills, stage, and a compact "N/M jurors submitted" chip). Clicking a row opens a **slide-in drawer** (copy the Yacht Club drawer pattern) that holds everything for that startup in one place:
- the full innovation detail (reuse `sm_jury_entry_detail` or the fields already in `sm_yv_innovations`),
- its **assigned jurors** with green/amber submitted status and inline assign/unassign (move the per-innovation assignment UI into the drawer),
- which **jury session(s)** it belongs to,
- payment / confirmation status.
This replaces the current three separate cards (assignments card + innovations table + jury table) with a single, drill-in "by innovation" view — exactly like the Yacht Club "by société" layout. Keep a compact **jurors** panel/tab for the juror-centric view (load + evaluated counts).

### 4. Sessions section
Keep the jury-sessions card but restyle it to match (same card/pill/spacing idioms, Monaco-time via the shared `TZ`/`fmtTime` helpers instead of raw `toLocaleString()`).

### 5. Consistency polish
- Use the same `Card`, `Badge`, pill, empty-state, and spacing idioms as `SM26PartnerPage.tsx`.
- Same responsive behavior (tables in `overflow-x-auto`, `grid-cols-2` tiles on mobile, drawer full-width on small screens).
- Keep the `denied` and `loading` states.

## Verify before pushing
1. Every existing YV capability still works: schedule/test-run/cancel/notify sessions, assign/unassign jurors (now from the drawer), refresh.
2. Tiles show correct counts and filter the list; search narrows it; funnels reflect the live data.
3. The by-innovation drawer shows detail + jurors + session membership and its assign/unassign writes the same `sm_yv_assign`/`sm_yv_unassign` (dedup intact).
4. `Funnel` is shared between both consoles and the Yacht Club page still renders identically.
5. Responsive + light/dark consistent with the Yacht Club console. Summarize changes and show the diff; do not push until I confirm.
