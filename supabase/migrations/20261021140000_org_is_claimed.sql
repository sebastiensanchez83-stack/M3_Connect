-- organizations.is_claimed: "this page has an owner on the platform", readable without
-- owner_user_id (go-live runbook P2 item 1; Victor, 21 Oct 2026: visitors see the basic company
-- facts, the internal columns are closed to them at go-live).
-- Down: supabase/migrations/down/20261021140000_org_is_claimed.down.sql
-- Dry run: supabase/dryrun/20261021140000_org_is_claimed.dryrun.sql (this file, checks as
-- postgres, anon and a signed-in account, then the down, in one rolled-back transaction).
--
-- ADDITIVE, SAFE FOR MAIN. One generated column and its two column grants; nothing else changes.
--   - Every client uses owner_user_id only as "claimed or not" on public pages (the directory's
--     "Verified member" pill, the members-first sort, the ticker's new members, the home page's
--     member marinas). At go-live (held/directory_visitor_basic.sql) anon loses owner_user_id, a
--     person id; this column carries the same yes/no without it.
--   - The grants on organizations are per column (contract 11.6, claim_code is never granted):
--     a new column is readable by nobody until granted. Granted to anon and authenticated like
--     name_search; postgres and service_role read every column through their table grant.
--   - GENERATED ALWAYS ... STORED, like name_search: never written by anyone. A write naming it
--     fails with 428C9; no client writes back a whole organizations row (checked 21 Oct 2026:
--     no update() with a spread row, no SQL function inserts a whole row).
--   - main does not read it: nothing changes for the live site. The redesign reads it when it is
--     there and falls back to owner_user_id while it is not (src/lib/orgVisibility.ts).
--   - Adding a stored column rewrites the table (278 rows on 21 Oct 2026): a brief exclusive lock.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if exists (select 1 from information_schema.columns c
              where c.table_schema = 'public' and c.table_name = 'organizations' and c.column_name = 'is_claimed') then
    raise exception 'org_is_claimed: organizations.is_claimed already exists';
  end if;
  if not exists (select 1 from information_schema.columns c
                  where c.table_schema = 'public' and c.table_name = 'organizations'
                    and c.column_name = 'owner_user_id' and c.data_type = 'uuid') then
    raise exception 'org_is_claimed: organizations.owner_user_id (uuid) is missing';
  end if;
end
$pre$;

alter table public.organizations
  add column is_claimed boolean generated always as (owner_user_id is not null) stored;

comment on column public.organizations.is_claimed is
  'true when the page has an owner on the platform (owner_user_id is set). Generated, never written. Readable by anon and authenticated in place of owner_user_id. 20261021140000.';

grant select (is_claimed) on public.organizations to anon, authenticated;
