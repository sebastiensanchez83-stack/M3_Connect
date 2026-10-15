# Health monitor (ops-health)

> **Résumé en français.**
> 1. Un contrôle automatique vérifie la plateforme (38 points en base + le site, le flux RSS et l'authentification) et n'écrit un e-mail à M3 que si quelque chose ne va pas.
> 2. Le même problème n'est signalé qu'une fois toutes les 6 heures au plus. Un avertissement qui devient une panne est signalé tout de suite.
> 3. Rien n'est installé : la migration, la fonction et le test à blanc sont prêts, mais rien ne part en production sans ton accord.
> 4. Une fois installé, il reste éteint (`enabled: false`) jusqu'à ce qu'on l'allume, et on l'éteint en une ligne.
> 5. Le premier e-mail signalera sans doute deux fonctions ouvertes au public (connu, à corriger ou à mettre en sourdine).

Files (none of them applied or deployed):

| File | Role |
|---|---|
| `supabase/migrations/20261016120000_ops_health_check.sql` | The checks, the report, the monitor's two tables, the settings row, the cron job |
| `supabase/migrations/down/20261016120000_ops_health_check.down.sql` | Removes all of it |
| `supabase/dryrun/20261016120000_ops_health_check.dryrun.sql` | Dry run of the migration AND of the down, 58 KB, one call |
| `supabase/functions/ops-health/index.ts` | Runs the report and the web probes, e-mails M3, remembers what it sent |

## How it works

```
pg_cron 'ops-health' (every 15 min)
  -> public.invoke_ops_health()          'skipped' while ops_health.enabled is not JSON true
                                          'not due' until interval_minutes have passed (default 60)
  -> POST /functions/v1/ops-health        with the Vault service key (like registration-cron)
       -> public.ops_health_report()      38 database checks, ok / warn / fail
       -> 3 web probes                    site + main bundle, /rss.xml, Supabase Auth health
       -> e-mail to ops_health.recipients ONLY if something is warn or fail, at most once per
                                          problem per realert_hours (6 h minimum)
       -> ops_health_alert, ops_health_run   its own memory (staff can read both)
```

Nothing in the platform is changed by the monitor. It reads, e-mails, and writes its own two
tables. The e-mail names checks, counts, job names and function names, never a guest, an
address or a token.

**Run the report by hand** (any time, staff or the SQL editor):

```sql
select * from public.ops_health_report();          -- worst first
select * from public.ops_health_run order by run_at desc limit 20;
select * from public.ops_health_alert order by last_seen_at desc;
```

## Deploy order (each step needs Victor's OK)

Best before 13 Nov (the WYS hotfix-only freeze). The migration only reads `gl_*` tables, it
changes none of them, and it does not touch guest-list, gl_checkin or any WYS setting.

1. **Dry run.** Run the WHOLE `supabase/dryrun/20261016120000_ops_health_check.dryrun.sql`
   in ONE `execute_sql` call. It always ends with an error that starts with `DRYRUN`: that
   error is the report, and nothing is kept. Expected:
   `DRYRUN 29 PASS, 0 FAIL`, plus `INFO report rows: 38` and
   `INFO not ok today: security.open_functions:warn`. Another entry in "not ok today" is a
   real finding, not a defect of the files. A line `FAIL before-snapshot missing` means the
   file did not run in one transaction: check at once for the cron job `ops-health` and run
   the down if it exists.
2. **Apply** `supabase/migrations/20261016120000_ops_health_check.sql` with
   `apply_migration` (name `ops_health_check`), text byte for byte. Then check:
   - the stored statement md5 equals the file md5 (Supabase records the apply timestamp, not
     the file name);
   - `select * from public.ops_health_report();` gives 38 rows;
   - `select public.invoke_ops_health();` answers `skipped`;
   - `select jobname, schedule, active from cron.job where jobname = 'ops-health';` gives one row.
3. **Deploy** `supabase/functions/ops-health/index.ts` as `ops-health` with
   **verify_jwt = true, set explicitly**. Before: grep the file for a literal backslash-u
   (there is none; `node scripts/email-previews.mjs --check` checks it). After: compare the
   sha256 of `get_edge_function` with the file. No new secret: it reads `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` (provided by Supabase), `RESEND_API_KEY`
   and `SITE_URL` (already set for the other functions).
4. **Preview, no e-mail.** In the SQL editor:
   ```sql
   select net.http_post(
     url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/ops-health',
     headers := jsonb_build_object('Content-Type', 'application/json',
       'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
     body := '{"force": true, "send": false}'::jsonb,
     timeout_milliseconds := 60000);
   -- a few seconds later:
   select status_code, content from net._http_response order by id desc limit 1;
   ```
   Expect `200` and `"ok":true` with 41 checks (38 + the 3 web probes).
5. **Check the recipients**, then send a **test e-mail**: same call with
   `'{"force": true, "test": true}'`. The recipients get "Test: Smart Marina Connect health
   monitor". The recipients start as a copy of `review_digest_recipients`:
   ```sql
   select value -> 'recipients' from public.platform_settings where key = 'ops_health';
   update public.platform_settings
      set value = jsonb_set(value, '{recipients}', '["<address 1>", "<address 2>"]'::jsonb)
    where key = 'ops_health';
   ```
6. **Mute** what Victor accepts as known (optional), for example while the two open functions
   are not fixed:
   ```sql
   update public.platform_settings set value = jsonb_set(value, '{mute}', '["security.open_functions"]'::jsonb) where key = 'ops_health';
   ```
7. **Switch on:**
   ```sql
   update public.platform_settings set value = jsonb_set(value, '{enabled}', 'true'::jsonb) where key = 'ops_health';
   ```
   Within 15 minutes `select * from public.ops_health_run order by run_at desc limit 1;` shows
   the first run.

**Stop:** `jsonb_set(value, '{enabled}', 'false'::jsonb)` (takes effect at the next quarter
hour). **Remove:** the down script, then delete the function (or leave it: nothing calls it).

## Settings (`platform_settings`, key `ops_health`, staff only)

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Only the JSON value `true` switches the monitor on |
| `recipients` | copy of `review_digest_recipients` | Up to 10 addresses |
| `interval_minutes` | `60` | Time between runs, 15 to 300. Never more than 300: pg_net keeps the answers of the scheduled calls 6 hours only |
| `realert_hours` | `6` | Minimum time between two e-mails about the same problem, 6 to 48 |
| `mute` | `[]` | Check ids that are recorded but never e-mailed |
| `http_checks` | `true` | `false` skips the 3 web probes |
| `wys_slug` | `"wys26"` | The guest-list event watched by `wys.event`, `wys.guests_integrity`, `wys.capacity` |
| `freeze` | 20 to 28 Nov 2026 | During the window, any new migration is a warning |
| `pins` | md5 of 13 functions at apply time | See "Re-pin" below |
| `baseline` | SM26 row counts and the event-media file count at apply time | `drift.sm26_archive`, `storage.event_media` |

**What "a problem" is.** One check at one level. A warn is e-mailed, then not again for 6
hours while it stays open. If it turns into a fail, that is a new problem and goes at once. A
problem that clears and comes back within 6 hours is not e-mailed again. When the e-mail
cannot be sent (no recipient, Resend refused it), nothing is stamped and the next run tries
again.

**Re-pin after a planned change** (for example when registration Phase 3 changes
`invoke_registration_cron`, or the rights switch changes `has_capability`):

```sql
update public.platform_settings ps
   set value = jsonb_set(ps.value, '{pins}', (
     select jsonb_object_agg(k.fn, (select case when count(*) = 1 then min(md5(p.prosrc))
                                             else md5(string_agg(md5(p.prosrc), ',' order by md5(p.prosrc))) end
                                      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = k.fn))
       from jsonb_object_keys(ps.value -> 'pins') as k(fn)))
 where ps.key = 'ops_health';
```

The door function `gl_checkin` is checked separately against its frozen md5
(`e2a63a98dcb1f5625b24d71f0cda3a62`) by `wys.door`, and re-pinning does not change that.

## The checks

Status column: what makes it **warn** (W) or **fail** (F). "What to do" is the first move;
when in doubt, call the technical contact (runbook contact sheet).

| Check | Watches | W / F | What to do |
|---|---|---|---|
| `cron.failed_runs` | pg_cron runs that failed in 24 h | F: any | `select * from cron.job_run_details where status = 'failed' order by start_time desc limit 20;` |
| `cron.stale_jobs` | a job whose last run is older than 2 x its interval + 5 min | F: any | pg_cron stopped or the job was unscheduled; check `cron.job` |
| `cron.slow_runs` | runs over 10 s, or stuck over 10 min, in 24 h | W | usually a lock or a slow query |
| `cron.dormant_sm26` | `sm26-remind-7d` / `-1d` still scheduled (they fire on 13 and 19 Sep) | W in Aug-Sep only | unschedule them (decision for Victor) |
| `cron.history_size` | rows in `cron.job_run_details` | W over 200,000 | purge old rows |
| `calls.vault_secrets` | Vault `project_url` and `service_role_key` | F if not both | without them every scheduled call is skipped silently |
| `calls.http_errors` | answers of scheduled calls in 6 h that were not 2xx or timed out | F: any | read the function's logs in the dashboard |
| `calls.missing_answers` | reminder runs (webinar reminders, profile reminders) with no answer within 90 s | W: any | the call was skipped (Vault) or lost |
| `calls.answer_errors` | 2xx answers that report an error inside (`ok:false`, `errors`) | W: any | read the answer: `select content from net._http_response order by id desc limit 10;` |
| `calls.queue_backlog` | calls waiting in the pg_net queue | W over 20 | pg_net worker stuck |
| `calls.reminder_volume` | profile reminders sent in 24 h | W over 40 | the cooldown may be broken: spam risk |
| `reg.provisioning` | account jobs (the "choose your password" e-mail) | W: waiting while the switch `provisioning` is off; F: waiting with it on, overdue e-mails, or 5 failures | see the runbook, "second e-mail" |
| `reg.confirmed_without_job` | confirmed on-site guests without an account job | F: any | the provisioning trigger failed; tell the technical contact |
| `reg.outbox` | notification outbox rows unsent after 15 min / with an error / dead | W / F (dead) | the sender is not deployed or failing |
| `pay.emails` | paid payments without their e-mail; e-mail claims stuck 10 min | F | resend by hand, check payment-ipn logs |
| `pay.ipn_review` | payments of 14 days flagged `ipn_review` / `ipn_mismatch` | F | check the amount with the bank back office |
| `pay.stale_pending` | payments pending 24 to 72 h after checkout | W | abandoned, or the bank notification was lost |
| `wys.pass_missing` | confirmed guests (any guest-list event) with no QR e-mail logged after 10 min | F | guest list > guest > **Resend entry pass** |
| `wys.emails_missing` | invitations, request acknowledgements, staff notices not logged after 10 min | W | resend the invitation; Resend may be failing |
| `wys.event` | the wys26 event: exists, engine `guest_list_v1`, door `shared`, on-site, not hidden | F | someone edited the event: do not "fix" it during the freeze without the technical contact |
| `wys.guests_integrity` | wys26 tokens present and unique; statuses and sources in the guest-list set | F | never edit tokens; tell the technical contact |
| `wys.capacity` | seats held (confirmed + invited) against the capacity | W when full | decide on over-capacity |
| `wys.door` | `gl_checkin` unchanged; both guest-list triggers enabled | F | the door may not work: technical contact at once |
| `drift.function_pins` | 13 sensitive functions changed since pinned | W | planned change: re-pin; unplanned: investigate |
| `drift.freeze` | migrations applied during the freeze window | W | was it planned? |
| `drift.sm26_archive` | row counts of 7 `sm_*` tables against the baseline | F | the SM26 archive must never change |
| `security.open_functions` | internal functions anyone can call through the API | W | today: `cleanup_guest_rate_limits`, `invoke_guest_webinar_reminders` (decision) |
| `db.connections` | connections in use | W over 80 %, F over 95 % | a leak, or too much traffic for Micro compute |
| `db.long_running` | queries over 5 min, transactions left open over 5 min | W | find them in `pg_stat_activity` |
| `db.replication_slots` | inactive slots, WAL held | W inactive, F over 1 GB | a slot left behind fills the disk |
| `db.wraparound` | oldest transaction id age | W over 150 M, F over 1 B | vacuum |
| `db.size` | database size | W over 4 GB | plan the disk |
| `storage.event_media` | files in `event-media` against the baseline | F if fewer | files were deleted from a bucket that has NO backup: restore from the monthly copy |
| `other.contact_inbox` | contact messages saved but not e-mailed after 15 min | W | read them in the admin |
| `other.pulse_snapshot` | the daily KPI snapshot after 07:15 UTC | W | the daily job failed |
| `other.crm_outbox` | CRM bridge events failed, dead or undelivered after 1 h | W | dormant today |
| `other.digest_log` | Friday digests stuck in "sending" over 1 h | W | dormant until go-live |
| `other.invitation_expiry` | team invitations past expiry still pending | W | the expiry job is not running |
| `web.site` | the site and the main bundle its page names (checked twice, 5 s apart) | W no bundle named, F no answer | broken deploy: roll back in Netlify |
| `web.rss` | `/rss.xml`: header `X-SMC-Feed: live` and at least one item | W | the feed fell back |
| `web.auth` | Supabase Auth health | F | sign-in may be down: status.supabase.com |
| `report.unavailable` | the report itself could not run | F | the database or the report function is broken |

## What the monitor cannot see

- **A full outage of the database.** The monitor is woken by the database it watches. If the
  database is down, nothing runs and nothing is e-mailed. Add an external uptime check (any
  free uptime service hitting `https://smartmarinaconnect.com/` and the RSS feed): decision
  for Victor.
- **Logs.** Auth hook errors, function error lines and gateway 5xx live in the log stream,
  which needs the Management API with a personal access token. Not stored, not used.
- **Edge function drift.** Versions and `verify_jwt` of deployed functions also need the
  Management API. Check them by hand before the freeze (list in `backups.md`).
- **E-mail delivery.** Resend accepting a message is all the database records. Bounces and
  spam complaints are in the Resend dashboard.
- **Evidence older than 6 hours.** pg_net keeps the answers of scheduled calls 6 hours: a call
  that failed and was not seen in that window is lost (hence `interval_minutes` at most 300).
