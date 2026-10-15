# Backups and recovery

> **Résumé en français.**
> 1. La base de données est sauvegardée chaque jour par Supabase (7 jours), mais on peut perdre jusqu'à 24 h de données et la restauration écrase tout le projet.
> 2. Les fichiers (2,6 Go : logos, documents, médias SM26, factures) n'ont AUCUNE sauvegarde ; 7 fonctions déployées n'existent nulle part ailleurs que chez Supabase.
> 3. Les réglages (secrets, Auth, Netlify, Lyra, Resend, DNS) ne sont inventoriés nulle part.
> 4. Ce document donne les procédures de restauration et un export mensuel (20 min) à faire par Victor ou Sébastien, vers un dossier privé chiffré, jamais dans le dépôt public.
> 5. Décisions à prendre en fin de document : récupération à la seconde près (~100 $/mois, ou seulement autour du WYS), copie des fichiers, sauvegarde des 7 fonctions.

State on 15 Oct 2026, read from production (read-only). Project `djjbgzasuomhyfvtlidi`
("M3 connect", eu-west-1, Postgres 17.6), organisation "M3 Monaco" on the **Pro** plan.

## 1. What is protected today, and what is not

| What | Protected by | How far back | Gap |
|---|---|---|---|
| Database: schema, data, `auth.users` (with password hashes), cron jobs, Vault secrets, migration history | Supabase **daily physical backups** (Pro) | last 7 days | Up to ~24 h of changes lost (no point-in-time recovery, see below). Restoring **overwrites the whole project** with downtime. Physical backups **cannot be downloaded**. Deleting the project deletes them. |
| Point-in-time recovery (PITR) | **Almost certainly not enabled** | - | Paid add-on that needs at least Small compute; the database runs Micro settings (60 connections, 224 MB shared buffers). Confirm in Dashboard > Database > Backups > Point in Time. |
| Off-site copy of the database | **None** | - | No `pg_dump` / `supabase db dump` has ever been kept. The database is small (44 MB), so a dump takes seconds. |
| Storage files: 9 buckets, 1,508 files, 2.59 GB | **Nothing.** Database backups hold only the metadata rows, not the files | - | A deleted or overwritten file cannot be recovered from any Supabase backup. |
| Edge function code | git for 42 functions | git history | **7 deployed functions were never in git**: `zoom-verify`, `sm26-rehost`, `sm26-upload`, `sm26-import-up`, `sm26-ecat-designer`, `sm26-media-kit`, `sm26-ecat-change-files`. Their only copy dies with the project. |
| Rollback copies of recent deploys | session scratchpad `deploy-ts/` (a Windows Temp folder) | - | Not durable: copy it to a private folder. It holds e.g. `guest-list.deployed-v6.ts`, `payment-ipn-v13-rollback`, `notify-admins-before-p2`, `registration-before-p2`. |
| Edge function secrets | Supabase project settings only | - | No inventory anywhere. Names read by the code: `RESEND_API_KEY`, `SENDER_EMAIL`, `SITE_URL`, `ACCOUNT_SITE_URL`, `REGISTRATION_SITE_URL`, `SM26_ADMIN_EMAIL`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_ENFORCE`, `LYRA_SHOP_ID`, `LYRA_API_PASSWORD`, `LYRA_API_URL`, `LYRA_MODE`, `LYRA_HMAC_KEY`, `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `MAILCHIMP_API_KEY`, `MAILCHIMP_AUDIENCE_ID`, `MAILCHIMP_SERVER_PREFIX`, `SEND_EMAIL_HOOK_SECRET` (the 7 git-less functions may read others). |
| Auth configuration | Supabase project settings only | - | Site URL, redirect allow-list, the **Send Email hook** (URL of `send-email` + secret), "Confirm email" (off), rate limits, JWT settings, API keys, Storage S3 keys. Auth e-mail texts are in git (`send-email`). `docs/AUDIT_REPORT.md` holds an old Site URL: do not trust it. |
| Netlify | Netlify only | Netlify deploy history | Production variables set in the Netlify UI: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_TURNSTILE_SITE_KEY`, `VITE_SM26_ENABLED`, and the pair read by the `rss`, `seo`, `sitemap` edge functions. |
| Third parties | their own back offices | - | Resend (sending domain DNS, key), Lyra (shop, API password, HMAC key, IPN URL to `payment-ipn`, auto-retry), Zoom app, Mailchimp key and audience, Cloudflare Turnstile, the domain registrar's DNS, GA4. Not inventoried. |
| Schema in git | 67 migration files | - | The database records **390** migrations. The one-time backfill in `supabase/migrations/README.md` was never run: today the full schema exists only in the database and its 7 days of backups. |
| CRM nightly pull (M3 Financial Ops) | another Supabase project, another org | - | Partial and unmanaged (profiles, companies, members, SM26 registrations and attendees, at most 1,000 rows each, as of 6 Oct). **Not a backup.** |

### Storage, bucket by bucket

| Bucket | Files | Size | Replaceable? |
|---|---|---|---|
| `event-media` (private) | 894 | 1.88 GB | **No** for 367 per-registration uploads (860 MB: media kits, architecture entries, decks, uploaded on the platform). Partly for `imported/` (464 files, 963 MB, JotForm imports: Dropbox `Dev plateform/JotForm …` folders hold 300 files / 822 MB, not matched file by file). `invoices/` (42 PDFs): originals presumably in the CRM or accounting. `architecture-pack/`, `letterhead/`: admin uploads. |
| `org-logos` (public) | 425 | 324 MB | No (uploaded by companies) |
| `org-documents` (private) | 19 | 74 MB | No |
| `resource-images` (public) | 64 | 68 MB | Mostly (admin uploads) |
| `site-media` (public) | 1 | 39 MB | Yes (homepage teaser, in Dropbox) |
| `profile-images` (public) | 80 | 37 MB | No |
| `sponsorship-files` (private) | 5 | 30 MB | No |
| `ad-banners` (public) | 20 | 15 MB | Mostly |
| `message-attachments` (private) | 0 | - | - |

The health monitor's `storage.event_media` check fails when files disappear from
`event-media` (see `health-monitor.md`): it detects a loss, it does not prevent it.

### Tables whose loss would hurt most (row counts, 15 Oct)

People and accounts (`auth.users` 155, `profiles` 155), companies (`organizations` 278,
`organization_members` 136, `organization_marina_details` 102, `entitlements` 1,140), rights
(`org_type_capability` 23, `capability_person_grant` 12), `platform_settings` (the
registration switches), the WYS guest list (`gl_event` 3, `gl_guest`, `gl_email_log`), and the
frozen SM26 history (`sm_registration` 201, `sm_attendee` 263, `sm_badge` 247, `sm_payment`
178, `sm_invoice` 41, `sm_review` 287, `sm_criterion_score` 2,256, `sm_checkin` 113,
`sm_email_log` 802 and the rest of `sm_*`).

**The WYS tokens live in `gl_guest.token`.** Every e-mailed QR code and personal link depends
on them. Any restore that keeps the database and the domain `smartmarinaconnect.com` keeps
every QR code working. Never regenerate a token.

## 2. Recovery procedures

Every production write below needs Victor's explicit OK. Rule of thumb: **restore next to
production, then copy back what is needed; never overwrite production unless the platform
is unusable.**

| What broke | First choice | Last resort |
|---|---|---|
| Some rows deleted or damaged | 2.1, rows from a copy | 2.3 whole-project restore |
| A migration went wrong | 2.4, its down script | 2.1 / 2.3 |
| A file deleted from a bucket | 2.2, from the monthly copy | ask the uploader again |
| An edge function deploy went wrong | 2.5, redeploy the previous version | - |
| The project is lost | 2.6, rebuild | - |

### 2.1 Restore one table or some rows

1. Get a copy of the data from before the damage, **without touching production**:
   - **a daily backup restored into a NEW project**: Dashboard > Database > Backups, choose
     the backup, "Restore to a new project" (see the Supabase "Duplicate project" guide). It
     costs the new project's compute by the hour; delete it afterwards; or
   - **the last monthly export** (section 3): load `schema.sql` and `data.sql` into a
     throwaway project or a local Postgres 17.
2. From that copy, export only the table:
   ```bash
   pg_dump "<COPY_CONNECTION_STRING>" --data-only --table=public.<table> --column-inserts > <table>-rows.sql
   ```
3. In production, load it into a side schema, look, then copy back only what is missing,
   in one transaction (example for rows deleted by mistake):
   ```sql
   begin;
   create schema if not exists restore_tmp;
   create table restore_tmp.<table> (like public.<table> including all);
   -- run <table>-rows.sql with "public." replaced by "restore_tmp."
   insert into public.<table>
   select r.* from restore_tmp.<table> r
    where not exists (select 1 from public.<table> t where t.id = r.id);
   -- check the counts, then:
   commit;   -- or rollback;
   drop schema restore_tmp cascade;
   ```
   Never `truncate` a production table to reload it: other rows and foreign keys point at it.
   Triggers fire on the insert (for example the WYS provisioning trigger on `gl_guest`): for
   `gl_*` and `sm_*` tables, ask the technical contact first.

### 2.2 Restore storage files

From the monthly copy (section 3, step 3), copy back **without deleting anything**:

```bash
rclone copy "<BACKUP_FOLDER>/storage/event-media" smc:event-media --ignore-existing --dry-run   # look first
rclone copy "<BACKUP_FOLDER>/storage/event-media" smc:event-media --ignore-existing
```

Never `rclone sync` towards Supabase: it deletes what the copy does not have. Uploading a
file recreates its `storage.objects` row. Files of `event-media/imported/` can also come back
from the Dropbox JotForm folders (partial). Without a copy, a deleted file is gone: ask the
participant again.

### 2.3 Restore the whole project (last resort)

Dashboard > Database > Backups > choose the latest backup **before** the damage > Restore.
The project is unreachable during the restore, every change after that backup is lost
(sign-ups, guest confirmations, check-ins, payments), and Storage is **not** rolled back:
files uploaded after the backup stay, without their rows. Never during the WYS freeze (20-28
Nov) unless the platform is unusable. With PITR enabled, the same screen offers any second
of the last 7 days instead.

### 2.4 Roll back a migration with its down script

1. Find `supabase/migrations/down/<file name>.down.sql`. Read its header: some downs need an
   edge function rolled back first (for example `payment_email_log`).
2. If `supabase/dryrun/<file name>.down.dryrun.sql` exists, run it whole in one
   `execute_sql` call (it ends with `DRYRUN …` and keeps nothing).
3. Apply the down in one transaction (`apply_migration`, or
   `psql "<CONNECTION_STRING>" --single-transaction -v ON_ERROR_STOP=1 -f <down file>`).
4. Check the functions it restores with `select proname, md5(prosrc) from pg_proc …` against
   the pins in the files, and the health report (`select * from ops_health_report();`).
5. Supabase records a migration under its apply timestamp, not the file name: write the
   pair down (file -> recorded version) in `supabase/migrations/APPLIED_MIGRATIONS.md`.

Held files (`supabase/migrations/held/`) have their own downs in the same folder.

### 2.5 Roll back an edge function

1. Get the previous source:
   - from git: `git log --oneline -- supabase/functions/<fn>/index.ts`, then
     `git show <commit>:supabase/functions/<fn>/index.ts > <fn>-rollback.ts`. **guest-list:
     the deployed v6 is commit `446b1c9a`, NOT the branch head**;
   - or from the rollback copies of `deploy-ts/` (`<fn>.deployed-v<N>.ts`,
     `<fn>-before-…`, `payment-ipn-v13-rollback`);
   - for the 7 git-less functions, only from Supabase: `supabase functions download <fn> --project-ref <PROJECT_REF>`.
2. Grep it for a literal backslash-u: the MCP deploy doubles it (it broke the auth e-mail hook
   for 8 minutes on 6 Oct). Rewrite any as described in the deploy rules.
3. Deploy with `verify_jwt` **set explicitly**, to the value the function has today
   (`list_edge_functions` shows it). On 15 Oct these 21 were **false**: `send-email`,
   `claim-code-signup`, `send-notification`, `notify-admins`, `send-status-notification`,
   `send-profile-reminders`, `send-reference-email`, `sm26-register`, `sm26-draft`,
   `sm26-rehost`, `sm26-arch-review`, `zoom-verify`, `payment-ipn`, `create-payment`,
   `guest-webinar-register`, `contact-submit`, `newsletter-subscribe`, `registration`,
   `account-signup`, `accept-invite`, `guest-list`. All the others are true, and so is the
   new `ops-health`.
   ```bash
   supabase functions deploy <fn> --project-ref <PROJECT_REF> --no-verify-jwt   # only for the "false" list
   ```
4. Compare the sha256 of the deployed source (`get_edge_function`) with the file.

**guest-list is never redeployed before 28 Nov**, not even to roll back, unless the technical
contact decides it is the only way to keep the door working.

### 2.6 Rebuild after losing the project

Order: new project in eu-west-1 > `roles.sql`, `schema.sql`, `data.sql` and the migration
history from the last monthly export (Supabase "Backup and restore using the CLI" guide) >
extensions (`pg_cron`, `pg_net`, `pgcrypto`, `pg_trgm`, `unaccent`, `citext`, `moddatetime`,
`uuid-ossp`, `supabase_vault`, `pg_stat_statements`) > Vault secrets `project_url` and
`service_role_key` with the NEW values > cron jobs (compare with `cron_jobs.csv` of the
export) > edge functions (git + the downloaded copies) and their secrets (password manager) >
Auth settings and the Send Email hook > Storage files (`rclone copy` back) > Netlify variables
(new URL and anon key), Lyra IPN URL, the Realtime publication (`conversation_messages`,
`partner_requests`). Users keep their passwords (hashes are in `auth.users`), but every
session must sign in again. QR codes keep working because the tokens are in the data and the
domain does not change.

## 3. Monthly export (Victor or Sébastien, about 20 minutes)

First working day of each month, and on **12 Nov** and **26 Nov** for WYS. Never in the
public repository, never in a shared folder: a private folder, then an encrypted archive.
Secrets go in the password manager, never in a file next to the export.

**Once:** install the Supabase CLI, Docker Desktop (the CLI dumps through Docker), `psql`
(Postgres 17 client), `rclone`, `jq` and 7-Zip. Run `supabase login`. In the dashboard: copy
the **Session pooler** connection string (Connect button), and under Storage > Configuration >
S3, enable the S3 protocol and create an access key (shown once: straight into the password
manager). Configure rclone interactively (`rclone config`, type `s3`, provider `Other`, the
endpoint shown on that page, of the form `https://<PROJECT_REF>.storage.supabase.co/storage/v1/s3`,
region `eu-west-1`) and set an rclone config password so the keys are not stored in clear.

**Each month** (Git Bash or any bash; replace the `<…>` placeholders, type secrets at the prompt):

```bash
read -s -p "Database URL (session pooler, with password): " SMC_DB_URL; echo
REF=<PROJECT_REF>
D="smc-backup-$(date +%Y-%m-%d)"; mkdir -p "$D/storage" && cd "$D"

# 1. Database: roles, schema, data, migration history, cron jobs
supabase db dump --db-url "$SMC_DB_URL" -f roles.sql --role-only
supabase db dump --db-url "$SMC_DB_URL" -f schema.sql
supabase db dump --db-url "$SMC_DB_URL" -f data.sql --use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes"
supabase db dump --db-url "$SMC_DB_URL" -f history_schema.sql --schema supabase_migrations
supabase db dump --db-url "$SMC_DB_URL" -f history_data.sql --use-copy --data-only --schema supabase_migrations
psql "$SMC_DB_URL" -c "\copy (select jobname, schedule, command, active from cron.job order by jobname) to 'cron_jobs.csv' csv header"
psql "$SMC_DB_URL" -c "\copy (select bucket_id, count(*) as files, sum((metadata->>'size')::bigint) as bytes from storage.objects group by 1 order by 1) to 'storage_counts.csv' csv header"

# 2. Edge functions: the deployed source of every function (the 7 git-less ones included)
mkdir functions && (cd functions && for fn in $(supabase functions list --project-ref "$REF" -o json | jq -r '.[].slug'); do
  supabase functions download "$fn" --project-ref "$REF"; done)

# 3. Storage: every bucket ("copy" never deletes on the backup side either)
for b in event-media org-logos org-documents resource-images site-media profile-images sponsorship-files ad-banners message-attachments; do
  rclone copy "smc:$b" "storage/$b" --transfers 8
done

# 4. Check, then encrypt and remove the clear copy
ls -la; grep -c '^COPY ' data.sql; du -sh storage/*
cd .. && 7z a -p -mhe=on "$D.7z" "$D" && rm -rf "$D"
unset SMC_DB_URL
```

Run step 2 in the export folder, never inside the repository: `download` writes into
`supabase/functions/` of the current folder and would overwrite the repository's sources.

**Check before deleting the clear copy:** the five `.sql` files are not empty; the number of
files per bucket on disk matches `storage_counts.csv`; `functions/` holds one folder per
deployed function (47 on 15 Oct, 48 once `ops-health` is deployed). Keep the last 12 monthly archives and the two WYS ones.
Write one line per export in a private log: date, who, archive size.

**Configuration inventory (with the first export, then when something changes):** in the
password manager, one entry per secret listed in section 1 (name, value, where it is set),
plus the Auth settings (screenshot of Authentication > URL configuration, Hooks and Rate
limits), the Netlify production variables, and the Lyra, Resend, Zoom, Mailchimp, Turnstile
and DNS logins.

**Once a quarter, a restore test:** create a throwaway project, run the restore of the
"Backup and restore using the CLI" guide with the latest export, count a few tables
(`auth.users`, `gl_guest`, `sm_registration`), delete the project. It proves the export works
and gives the real recovery time.

## 4. Decisions for Victor

1. **Point-in-time recovery?** Restores to any second of the last 7 days instead of losing up
   to a day. Cost: **about $100 per month** for 7 days ($0.137 per hour, billed by the hour,
   not covered by the spend cap), plus the move from Micro to **Small compute** (about $15
   instead of $10 a month; the change restarts the database, a few minutes offline). Options:
   (a) no; (b) only around WYS, for example 10 Nov to 1 Dec (about $70 plus compute), switched
   on before the 13 Nov freeze because of the restart; (c) permanently. Daily backups stop
   while PITR is on (PITR replaces them). Recommended: (b) at least.
2. **Copy the files now** (S3 key + `rclone`, section 3 step 3): 2.6 GB that exist nowhere
   else, including 367 SM26 uploads. Recommended this week.
3. **Save the 7 git-less functions** (`supabase functions download`) and commit them after a
   secrets check. Recommended before 13 Nov.
4. **Who runs the monthly export, and where it is kept** (Victor or Sébastien; a private,
   encrypted place).
5. **Rehearse one restore into a throwaway project** before 20 Nov (a few dollars).
6. **The two functions anyone can call** (`cleanup_guest_rate_limits` empties the sign-up
   rate limit, `invoke_guest_webinar_reminders` triggers reminder runs): close them with a
   one-line revoke migration, or mute the monitor's warning.
7. **The two SM26 reminder jobs** (`sm26-remind-7d`, `sm26-remind-1d`) fire again in
   September 2027: unschedule them.
8. **Organisation access:** who can delete the Supabase project (that deletes every backup
   too), and is two-factor sign-in on for every member?
