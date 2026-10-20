# Health monitor (ops-health)

> **Résumé en français.**
> 1. Un contrôle automatique vérifie la plateforme (38 points en base + le site, le flux RSS et l'authentification) et n'écrit à M3 que si quelque chose ne va pas ; il ne peut pas signaler sa propre panne : un service externe de « battement de cœur » doit le faire (décision à prendre).
> 2. Le même problème n'est signalé qu'une fois toutes les 6 heures au plus ; un avertissement qui devient une panne part tout de suite.
> 3. Rien n'est installé : migration, fonction et test à blanc sont prêts, rien ne part en production sans ton accord ; une fois installé, il reste éteint jusqu'à ce qu'on l'allume.
> 4. Tant que l'interrupteur « provisioning » est éteint, chaque invité WYS confirmé déclenche un avertissement `reg.provisioning` toutes les 6 heures : décider la date d'allumage avant de lancer le contrôle, ou mettre `reg.provisioning:warn` en sourdine (une vraie panne passe quand même).
> 5. Pendant le WYS, une alerte `wys.*`, `web.site` ou `web.auth` = appeler tout de suite le contact technique ; le reste attend le 28 novembre.

Files (none of them applied or deployed):

| File | Role |
|---|---|
| `supabase/migrations/20261016120000_ops_health_check.sql` | The checks, the report, the monitor's two tables, the settings row, the cron job |
| `supabase/migrations/down/20261016120000_ops_health_check.down.sql` | Removes all of it |
| `supabase/dryrun/20261016120000_ops_health_check.dryrun.sql` | Dry run of the migration AND of the down, about 63 KB, one call |
| `supabase/functions/ops-health/index.ts` | Runs the report and the web probes, e-mails M3, remembers what it sent, pings the heartbeat |

## How it works

```
pg_cron 'ops-health' (every 15 min)
  -> public.invoke_ops_health()          'skipped' while ops_health.enabled is not JSON true
                                          'not due' until interval_minutes have passed (default 60)
                                          'no vault' if the Vault secrets are missing (no call!)
  -> POST /functions/v1/ops-health        with the Vault service key (like registration-cron), via pg_net
       -> public.ops_health_report()      38 database checks, ok / warn / fail
       -> 3 web probes                    site + main bundle, /rss.xml, Supabase Auth health
       -> e-mail to ops_health.recipients ONLY if something is warn or fail, at most once per
                                          problem per realert_hours (6 h minimum)
       -> ops_health_alert, ops_health_run   its own memory (staff can read both)
       -> GET ops_health.heartbeat_url    "I ran, and every problem due was e-mailed" (optional)
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
   `DRYRUN 30 PASS, 0 FAIL`, plus `INFO report rows: 38` and
   `INFO not ok today: security.open_functions:warn`. Once WYS guests are confirmed while the
   switch `provisioning` is off, `reg.provisioning:warn` is expected there too. Another entry
   in "not ok today" is a real finding, not a defect of the files. (A line
   `INFO outbox detection not tested` with 29 PASS only means no account was pending that
   day.) A line `FAIL before-snapshot missing` means the file did not run in one transaction:
   check at once for the cron job `ops-health` and run the down if it exists.
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
4. **Preview, no e-mail.** In the SQL editor, keep the number the first query returns:
   ```sql
   select net.http_post(
     url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/ops-health',
     headers := jsonb_build_object('Content-Type', 'application/json',
       'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
     body := '{"force": true, "send": false}'::jsonb,
     timeout_milliseconds := 60000) as request_id;
   -- a few seconds later, with THAT number (other scheduled calls answer in the same table):
   select status_code, content from net._http_response where id = <request_id>;
   ```
   Expect `200` and `"ok":true` with 41 checks (38 + the 3 web probes).
5. **Check the recipients**, then send a **test e-mail**: same call with
   `'{"force": true, "test": true}'`. The recipients get "Test: Smart Marina Connect health
   monitor". The recipients start as a copy of `review_digest_recipients`. From 26 to 27 Nov
   they must include the on-call technical contact:
   ```sql
   select value -> 'recipients' from public.platform_settings where key = 'ops_health';
   update public.platform_settings
      set value = jsonb_set(value, '{recipients}', '["<address 1>", "<address 2>"]'::jsonb)
    where key = 'ops_health';
   ```
6. **Decide the known noise, BEFORE step 7.** Two warnings are expected:
   - `security.open_functions`, until the two open functions are closed (`backups.md`, section 4).
   - `reg.provisioning` (warn), from the first WYS approval until the switch `provisioning`
     is turned on. Each confirmed guest queues an account job, the job waits while the switch
     is off, and the check warns 15 minutes later, then every `realert_hours`. The
     registration switches are frozen from 20 to 28 Nov, so this could last until after the
     event: four e-mails a day for weeks teaches everyone to ignore the monitor during the
     event it exists for.

   So, first: decide the date the switch `provisioning` goes on (runbook, "The two
   e-mails"). If it is not on before the first approval, mute the WARN level only. A
   failure of the same check (account jobs that failed 5 times, or waiting while the switch
   is on) is still e-mailed:
   ```sql
   update public.platform_settings
      set value = jsonb_set(value, '{mute}', '["security.open_functions", "reg.provisioning:warn"]'::jsonb)
    where key = 'ops_health';
   ```
   Remove `reg.provisioning:warn` from `mute` the day the switch goes on. (Raising
   `realert_hours` to 24 or 48 is the other option, but it slows every alert, not just this one.)
7. **Switch on:**
   ```sql
   update public.platform_settings set value = jsonb_set(value, '{enabled}', 'true'::jsonb) where key = 'ops_health';
   ```
   Within 15 minutes `select * from public.ops_health_run order by run_at desc limit 1;` shows
   the first run.
8. **Heartbeat (recommended; decision for Victor, a free external service).** The monitor
   cannot report its own silence (see "What the monitor cannot see"). Create a heartbeat
   check at an external service (for example healthchecks.io or Better Stack): period = the
   monitor's `interval_minutes` (60 min), grace 30 min, alert by e-mail AND text message to
   Victor and the technical contact. Store its ping address in the staff-only setting, never
   in the repository (whoever holds it can fake a ping):
   ```sql
   update public.platform_settings set value = jsonb_set(value, '{heartbeat_url}', '"https://<ping address>"'::jsonb) where key = 'ops_health';
   ```
   The function pings it after every recorded run, unless a problem was due and no e-mail
   left. The ping is a plain GET: nothing about the platform is sent. When you switch the
   monitor off, pause the heartbeat check too, or it will alert.

**Stop:** `jsonb_set(value, '{enabled}', 'false'::jsonb)` (takes effect at the next quarter
hour; pause the heartbeat check). **Remove:** the down script, then delete the function (or
leave it: nothing calls it).

## Settings (`platform_settings`, key `ops_health`, staff only)

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Only the JSON value `true` switches the monitor on |
| `recipients` | copy of `review_digest_recipients` | Up to 10 addresses |
| `interval_minutes` | `60` | Time between runs, 15 to 300. Never more than 300: pg_net keeps the answers of the scheduled calls 6 hours only |
| `realert_hours` | `6` | Minimum time between two e-mails about the same problem, 6 to 48 |
| `mute` | `[]` | Checks recorded but never e-mailed. `"<check id>"` mutes the check; `"<check id>:warn"` mutes its warn level only, so its fail is still e-mailed |
| `http_checks` | `true` | `false` skips the 3 web probes |
| `heartbeat_url` | `""` | An `https://` ping address of an external heartbeat service; empty = no heartbeat |
| `wys_slug` | `"wys26"` | The guest-list event watched by `wys.event`, `wys.guests_integrity`, `wys.capacity` |
| `freeze` | 20 to 28 Nov 2026 | During the window, any new migration is a warning |
| `pins` | md5 of 13 functions at apply time | See "Re-pin" below |
| `baseline` | SM26 row counts (`sm26`) and event-media file counts per folder group (`event_media`) at apply time | `drift.sm26_archive`, `storage.event_media`; see "Re-baseline" below |

**What "a problem" is.** One check at one level. A warn is e-mailed, then not again for 6
hours while it stays open. If it turns into a fail, that is a new problem and goes at once. A
problem that clears and comes back within 6 hours is not e-mailed again. When the e-mail
cannot be sent (no recipient, Resend refused it), nothing is stamped, the next run tries
again, and the heartbeat is withheld.

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

**Re-baseline after a planned change.** Some staff screens legitimately delete
`event-media` files: the press resources editor, the SM26 invoices, architecture and e-catalogue
admin pages (replacing or removing a file). Opening the SM26 check-in page
(`/admin/sm26/checkin`) runs `sm_ensure_badges`, which can add or remove `sm_badge` rows
(on 15 Oct it would change nothing). After such a change, `storage.event_media` or
`drift.sm26_archive` fails every run until the baseline is taken again (a new SM26 invoice does
not: `sm_invoice` may grow). First make sure the change was planned (who, which screen, which files); then:

```sql
update public.platform_settings ps
   set value = jsonb_set(jsonb_set(ps.value, '{baseline,sm26}', jsonb_build_object(
         'sm_registration', (select count(*) from public.sm_registration),
         'sm_role_assignment', (select count(*) from public.sm_role_assignment),
         'sm_attendee', (select count(*) from public.sm_attendee),
         'sm_badge', (select count(*) from public.sm_badge),
         'sm_payment', (select count(*) from public.sm_payment),
         'sm_invoice', (select count(*) from public.sm_invoice),
         'sm_networking_pass', (select count(*) from public.sm_networking_pass))),
       '{baseline,event_media}', coalesce((select jsonb_object_agg(g.grp, g.cnt) from (
         select case when split_part(o.name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then 'registrations'
                     when position('/' in o.name) = 0 then '(root)' else split_part(o.name, '/', 1) end as grp, count(*) as cnt
           from storage.objects o where o.bucket_id = 'event-media' group by 1) g), '{}'::jsonb))
 where ps.key = 'ops_health';
```

The event-media baseline counts files per folder group (`registrations` = the
per-registration folders of SM26 uploads, then `imported`, `invoices`, `architecture-pack`,
`letterhead`…), so a new upload in one group cannot hide a deletion in another. A deletion
followed by an upload in the SAME group still goes unseen.

## The checks

Status column: what makes it **warn** (W) or **fail** (F). "What to do" is the first move;
when in doubt, call the technical contact (runbook contact sheet). **Manual only** marks a
failure that also stops the monitor itself: the check shows it when someone runs the report
by hand, but no e-mail can go. Only the heartbeat (step 8) reports those.

| Check | Watches | W / F | What to do |
|---|---|---|---|
| `cron.failed_runs` | pg_cron runs that failed in 24 h | F: any | `select * from cron.job_run_details where status = 'failed' order by start_time desc limit 20;` |
| `cron.stale_jobs` | a job whose last run is older than 2 x its interval + 5 min | F: any | the job was unscheduled or keeps failing; check `cron.job`. If pg_cron itself stopped, the monitor stopped too: **manual only** |
| `cron.slow_runs` | runs over 10 s, or stuck over 10 min, in 24 h | W | usually a lock or a slow query |
| `cron.dormant_sm26` | `sm26-remind-7d` / `-1d` still scheduled (they fire on 13 and 19 Sep) | W in Aug-Sep only | unschedule them (decision for Victor) |
| `cron.history_size` | rows in `cron.job_run_details` | W over 200,000 | purge old rows |
| `calls.vault_secrets` | Vault `project_url` and `service_role_key` | F if not both, **manual only** | without them every scheduled call is skipped silently, the monitor's own call included (`invoke_ops_health()` answers `no vault`) |
| `calls.http_errors` | answers of scheduled calls in 6 h that were not 2xx or timed out | F: any | read the function's logs in the dashboard |
| `calls.missing_answers` | reminder runs (webinar reminders, profile reminders) with no answer within 90 s | W: any | the call was skipped (Vault) or lost |
| `calls.answer_errors` | 2xx answers that report an error inside (`ok:false`, `errors`) | W: any | read the answer: `select content from net._http_response order by id desc limit 10;` |
| `calls.queue_backlog` | calls waiting in the pg_net queue | W over 20 | a queue that still drains is reported; a pg_net worker that is stuck also holds the monitor's own call: **manual only** |
| `calls.reminder_volume` | profile reminders sent in 24 h | W over 40 | the cooldown may be broken: spam risk |
| `reg.provisioning` | account jobs (the "choose your password" e-mail) | W: jobs waiting over 15 min, or e-mails overdue, while the switch `provisioning` is OFF (expected until it goes on: see step 6). F: 5 failures, or (only while the switch is ON) jobs waiting or e-mails overdue | see the runbook, "The two e-mails" |
| `reg.confirmed_without_job` | confirmed on-site guests without an account job | F: any | the provisioning trigger failed; tell the technical contact |
| `reg.outbox` | notification outbox rows of the last 7 days that the sender would still send (person still pending, join request still open): unsent after 15 min / with an error / dead | W / F (dead) | the sender is not deployed or failing |
| `pay.emails` | paid payments without their e-mail; e-mail claims stuck 10 min | F | resend by hand, check payment-ipn logs |
| `pay.ipn_review` | payments flagged `ipn_review` / `ipn_mismatch` in the last 48 h (the flag's own time) | F | check the amount with the bank back office (payment-ipn also e-mailed M3 when it flagged it) |
| `pay.stale_pending` | payments pending 24 to 72 h after checkout | W | abandoned, or the bank notification was lost |
| `wys.pass_missing` | confirmed guests (any guest-list event) with no QR e-mail logged after 10 min | F | guest list, tab **Guest list**, the envelope icon on the guest's row (**Resend entry pass**) |
| `wys.emails_missing` | invitations, request acknowledgements, staff notices not logged after 10 min | W | resend the invitation; Resend may be failing |
| `wys.event` | the wys26 event: exists, engine `guest_list_v1`, door `shared`, on-site, not hidden | F | someone edited the event: do not "fix" it during the freeze without the technical contact |
| `wys.guests_integrity` | wys26 tokens present and unique; statuses and sources in the guest-list set | F | never edit tokens; tell the technical contact. It does NOT detect a token replaced by another unique one |
| `wys.capacity` | seats held (confirmed + invited) against the capacity | W when full | decide on over-capacity |
| `wys.door` | `gl_checkin` unchanged; both guest-list triggers enabled | F | the door may not work: technical contact at once |
| `drift.function_pins` | 13 sensitive functions changed since pinned | W | planned change: re-pin; unplanned: investigate |
| `drift.freeze` | migrations applied during the freeze window | W | was it planned? |
| `drift.sm26_archive` | row counts of 7 `sm_*` tables against the baseline; since 20 Oct 2026 (migration `20261020170000`) `sm_invoice` may grow, as M3 still adds SM26 invoices, but fewer invoices or any change in the 6 other tables still fails | F | apart from new invoices the SM26 archive must never change; if the SM26 check-in page was opened, see "Re-baseline" |
| `security.open_functions` | internal functions anyone can call through the API | W | today 2 (their names are in the report); decision in `backups.md`, section 4 |
| `db.connections` | connections in use | W over 80 %, F over 95 % | a leak, or too much traffic for Micro compute |
| `db.long_running` | queries over 5 min, transactions left open over 5 min | W | find them in `pg_stat_activity` |
| `db.replication_slots` | inactive slots, WAL held | W inactive, F over 1 GB | a slot left behind fills the disk |
| `db.wraparound` | oldest transaction id age | W over 150 M, F over 1 B | vacuum |
| `db.size` | database size | W over 4 GB | plan the disk |
| `storage.event_media` | files in `event-media` per folder group against the baseline | F if a group has fewer | files were deleted from a bucket that has NO backup: if planned, re-baseline; if not, restore from the monthly copy |
| `other.contact_inbox` | contact messages saved but not e-mailed after 15 min | W | read them in the admin |
| `other.pulse_snapshot` | the daily KPI snapshot after 07:15 UTC | W | the daily job failed |
| `other.crm_outbox` | CRM bridge events failed, dead or undelivered after 1 h | W | dormant today |
| `other.digest_log` | Friday digests stuck in "sending" over 1 h | W | dormant until go-live |
| `other.invitation_expiry` | team invitations past expiry still pending | W | the expiry job is not running |
| `web.site` | the site and the main bundle its page names, which must come back as JavaScript (checked twice, 5 s apart) | W no bundle named, F no answer or the bundle came back as a page | broken deploy: roll back in Netlify |
| `web.rss` | `/rss.xml`: header `X-SMC-Feed: live` and at least one item | W | the feed fell back |
| `web.auth` | Supabase Auth health | F | sign-in may be down: status.supabase.com |
| `report.unavailable` | the report itself could not run | F | the database or the report function is broken |

### During WYS (20 to 28 Nov): which alert is urgent

| Alert | Means | Do |
|---|---|---|
| `wys.door`, `wys.event`, `wys.guests_integrity` | the door or the guest list may not work | call the technical contact NOW |
| `wys.pass_missing` | a confirmed guest has no QR e-mail | the guest-list manager resends the pass now |
| `web.site`, `web.auth`, `report.unavailable` | the site, sign-in or the database is down | call the technical contact NOW; the door switches to paper if needed (runbook, "Fallback") |
| `wys.emails_missing`, `wys.capacity` | an invitation did not leave; the list is full | guest-list manager, same day |
| heartbeat alarm (external service) | the monitor itself stopped | technical contact, same day |
| anything else | not needed for the door | wait until 28 Nov unless the technical contact says otherwise |

## What the monitor cannot see

- **Its own failure.** The monitor is woken by the database it watches, through pg_cron, the
  Vault secrets and pg_net, and it e-mails through Resend. Each of these failures stops the
  monitor itself, so it can never e-mail about them:
  - a full outage of the database;
  - pg_cron stopped (the `ops-health` job does not run either);
  - the Vault secrets missing (`invoke_ops_health()` answers `no vault` and calls nothing);
  - the pg_net worker stuck (the monitor's call waits in the same queue);
  - the `ops-health` function answering 401 or 500 (key changed, function deleted or broken);
  - `RESEND_API_KEY` missing or refused (the run is recorded, no e-mail leaves).

  The heartbeat (deploy step 8) covers all of them: the external service alarms when the
  pings stop. Without it, only someone running the report by hand, or looking at
  `ops_health_run`, finds out. Add also an external uptime check of
  `https://smartmarinaconnect.com/` (same kind of service): decision for Victor.
- **Logs.** Auth hook errors, function error lines and gateway 5xx live in the log stream,
  which needs the Management API with a personal access token. Not stored, not used.
- **Edge function drift.** Versions and `verify_jwt` of deployed functions also need the
  Management API. Check them by hand before the freeze (list in `backups.md`).
- **E-mail delivery.** Resend accepting a message is all the database records. Bounces and
  spam complaints are in the Resend dashboard.
- **Evidence older than 6 hours.** pg_net keeps the answers of scheduled calls 6 hours: a call
  that failed and was not seen in that window is lost (hence `interval_minutes` at most 300).
- **A replaced guest token.** `wys.guests_integrity` sees missing and duplicated tokens, not
  a token regenerated into another unique one.
