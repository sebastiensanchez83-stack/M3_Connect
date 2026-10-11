# Rights switch: go-live runbook

The rights per company type (who publishes needs, who sees and answers them, who
writes to companies, who sees Deal flow) are switched on **the day the refonte
replaces main as the live site** (Victor, 11 Oct 2026). Never before: the old
site still decides by the personal profile, and its buttons would meet database
refusals.

Files:

- `supabase/migrations/20261011090000_capabilities_shadow.sql`: the rights table
  and functions, in shadow mode. Applied BEFORE the day (it changes nothing that
  anyone can do). Down: `supabase/migrations/down/20261011090000_capabilities_shadow.down.sql`.
  Dry run: `supabase/dryrun/20261011090000_capabilities_shadow.dryrun.sql`,
  expected **50 PASS, 0 FAIL**.
- `supabase/migrations/held/capabilities_enforce.sql`: the switch. Applied ON the
  day. Down: `supabase/migrations/down/capabilities_enforce.down.sql`. Dry run:
  `supabase/dryrun/capabilities_enforce.dryrun.sql`, expected **32 PASS, 0 FAIL**.

Run each dry run as the WHOLE file in ONE `execute_sql` call. It always ends with
an error that starts with `DRYRUN`: that error is the report. Nothing is kept.

## Decisions this follows (Victor, 11 Oct 2026)

- The switch happens at go-live of the refonte.
- **No e-mail** to the people who gain or lose a right. Nothing in the site, the
  database or the edge functions sends a "rights change" notice; do not add one.
- People confirmed as investors at Smart Marina 2026 keep Deal flow, with its
  data, even without a validated investor company. Built into the shadow
  migration (`capability_sm26_investor`); on 11 Oct 2026 it covers 12 people,
  one of whom has no validated investor company.
- Marinas read other members' needs but do not answer them with "Express
  interest". They can still send a message to the company that published one.

## Before the day

1. Shadow migration in production: run its dry run (50 PASS, 0 FAIL; INFO lines
   on 11 Oct 2026: "128 verified people, 32 gain, 15 lose" and "SM26-confirmed
   investors: 12 (12 verified), 1 of them without a validated investor
   company"), then apply it.
2. Admin > Rights shows the table, the counts, and "Validated companies without
   a type: none". Type any untyped validated company before the day: its members
   would otherwise lose their rights.

## On the day, in this order

1. **Deploy the refonte as the live site** (the refonte becomes main and the
   production deploy). Check that the home page loads and that signing in works.
2. **Run the switch's dry run** (`supabase/dryrun/capabilities_enforce.dryrun.sql`).
   Expected: **32 PASS, 0 FAIL**.
   - T05 fails: the shadow objects in production differ from the file. Stop and
     rebuild the dry run from production.
   - It stops with "the policies to replace changed since 10 Oct 2026": someone
     changed one of the twelve policies. Stop: the switch and its down script
     must be rebuilt from production first.
   - It stops with "RFP(s) and consultation(s) have no organization_id": attach
     those needs to their author's company first.
3. **Apply the switch.** Give the held file a timestamp, move it to
   `supabase/migrations/<YYYYMMDDHHMMSS>_capabilities_enforce.sql`, apply it.
   It runs in one transaction and gives up after 5 seconds waiting for a lock:
   if it does, nothing was applied; run it again a little later.
4. **The flag.** The migration turns `registration_flags.capabilities_enforced`
   on itself, in the same transaction, so the screens and the database change
   together. Check it:

   ```sql
   select value -> 'capabilities_enforced' from public.platform_settings where key = 'registration_flags';  -- true
   ```

   If it is not `true` (it should never happen), set it:

   ```sql
   update public.platform_settings
      set value = jsonb_set(value, '{capabilities_enforced}', 'true'::jsonb, true), updated_at = now()
    where key = 'registration_flags';
   ```

   Open tabs follow within five minutes (the site keeps the flag five minutes);
   a reload follows at once.
5. **Checks.**

   ```sql
   -- 8 policies call has_capability
   select count(*) from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') like '%has_capability%' or coalesce(with_check, '') like '%has_capability%');
   -- who changed (moves with the data; 11 Oct 2026: 128 / 32 / 15)
   select count(*), count(*) filter (where cardinality(gained) > 0), count(*) filter (where cardinality(lost) > 0)
     from public.capability_shadow_report() where person_status = 'verified';
   -- the SM26 investors keep Deal flow (11 Oct 2026: 12 / 12)
   select count(*), count(*) filter (where 'see_dealflow' = any (new_caps))
     from public.capability_shadow_report() where person_status = 'verified' and sm26_investor;
   ```

   On the site:
   - Admin > Rights says "Enforced by the site and the database".
   - A marina member sees the needs of others without "Express interest", and can
     still send a message from a company page.
   - A service provider, an investor, a developer or a media member can press
     "Express interest".
   - Deal flow: a member of a validated investor company sees the board; an SM26
     investor without a validated company sees the board and its companies, with
     no "Express interest" button.
   - A verified person without a validated company sees no Opportunities and no
     Deal flow, and can still propose a webinar.
   - The help centre (/help) describes the new rights (who answers needs, who
     sees Deal flow).

## Rollback

1. Run `supabase/migrations/down/capabilities_enforce.down.sql` (one
   transaction). It puts back the twelve policies exactly as they were, the
   message origin rule, removes the publisher's guard, and turns
   `registration_flags.capabilities_enforced` back to `false`. It refuses to run
   if the switch's policies were edited after it was applied: re-read them and
   update the down script first.
2. Check the flag is `false` (same query as above). If not, set it to `false`
   with the same `update`, writing `'false'::jsonb`.
3. Rows written while the switch was on stay. "Express interest" rows (origin
   `interest`) become origin `null`, as the old rules wrote them.
4. The shadow objects stay; they change nothing. To remove them too, run
   `supabase/migrations/down/20261011090000_capabilities_shadow.down.sql`, only
   after step 1 (it refuses while the switch is on).

The site follows the flag within five minutes, or at once on a reload.
