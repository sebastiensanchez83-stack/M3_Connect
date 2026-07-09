# Database migrations

**Current reality:** the schema has been evolved through **187 migrations** applied
directly to the live Supabase project (`djjbgzasuomhyfvtlidi`) via the Supabase
MCP / dashboard. The full SQL for those migrations lives in the project's
`supabase_migrations.schema_migrations` history table — **not yet in this repo**.

That's a disaster-recovery gap: if the project were lost, the schema could not be
rebuilt from source control. [`APPLIED_MIGRATIONS.md`](./APPLIED_MIGRATIONS.md) in
this folder is the authoritative **manifest** of every applied migration (version +
name, in order) so the history is at least recorded and auditable in git.

## One-time backfill — pull the full SQL into this folder

Run on a machine with the Supabase CLI authenticated (it needs the DB password /
an access token — this cannot be done from the sandbox that maintains this repo):

```bash
# 1. Install + log in (once)
#    npm i -g supabase   |or|   scoop/brew install supabase
supabase login

# 2. Link this repo to the project
supabase link --project-ref djjbgzasuomhyfvtlidi

# 3a. Pull the remote migration history into supabase/migrations/*.sql
supabase migration fetch          # writes each remote migration as a local file
#     — or, if you prefer a single reproducible baseline snapshot instead:
# 3b. supabase db dump --schema public,storage -f supabase/migrations/00000000000000_baseline.sql
```

Then commit the generated `*.sql` files. After that, `APPLIED_MIGRATIONS.md` and the
`*.sql` files should agree (cross-check against the manifest).

> ⚠️ The repo lives on Dropbox — do **not** run `supabase db push`/`npm run build`
> from inside the Dropbox folder (file-locking / EPERM). Pull/dump only, then commit.

## Going forward

Every new schema change should land here as a `YYYYMMDDHHMMSS_description.sql` file,
committed alongside the code that depends on it, and applied with
`supabase db push` (or the MCP `apply_migration`, which also records it in the
history table — keep the two in sync).
