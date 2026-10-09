-- Accent-insensitive search: folded copies of the names and titles the search
-- suggestions read. 9 Oct 2026.
--
-- NOT APPLIED. Written on branch rf-accents. The dry run is
-- supabase/dryrun/20261009160000_search_fold_columns.dryrun.sql. The front end
-- works before and after it (see "Order" below).
--
-- ════════════════════════════════════════════════════════════════════════════
-- Why
-- ════════════════════════════════════════════════════════════════════════════
-- Victor, 9 Oct 2026: "the search ignores accents: 'sete' finds 'Sète', 'gocek'
-- finds 'Göcek'". The search pill's suggestions (src/lib/searchSuggestions.ts)
-- query PostgREST with ILIKE, which compares letters as typed: on 9 Oct "gocek"
-- found "Setur Gocek Exclusive Marina" and "Setur Gocek Village Port" but not
-- "D-Marin Göcek". pg_trgm is not installed; unaccent 1.1 is (schema public).
--
-- ════════════════════════════════════════════════════════════════════════════
-- What
-- ════════════════════════════════════════════════════════════════════════════
--   public.smc_fold(text): lower(unaccent(x)), with curly apostrophes and long
--     dashes made plain ("Egypt’s" -> "egypt's", "Marina — 6th" -> "marina - 6th",
--     "Kuşadası" -> "kusadasi", "Straße" -> "strasse"). unaccent already turns
--     ‘ ’ ʼ ′ and ‐ – — into ' and -; translate() adds ` ´ ‑ ‒ ― so the list is
--     the same as the browser's.
--     IMMUTABLE although public.unaccent() is STABLE (a generated column needs
--     an immutable expression): the dictionary is named with its schema and the
--     search_path is empty, so the answer depends only on the rules file. If
--     unaccent's rules or this function ever change, recompute the copies:
--       update public.organizations set name = name;
--       update public.resources set title = title;
--       update public.events set title = title;
--   organizations.name_search, resources.title_search, events.title_search:
--     STORED generated columns, smc_fold(name / title). Never written by anyone
--     (GENERATED ALWAYS: an INSERT or UPDATE that names them fails with 428C9;
--     no client or function does, checked below).
--   The browser folds the search the same way: `fold` in
--   src/lib/searchSuggestions.ts (NFD, combining marks off, lower case, the
--   letters NFD keeps whole: ı ł ø đ ð þ ß æ œ ħ ŧ ŀ ĸ ŋ ſ ĳ ƒ ŉ, then the same
--   apostrophes and dashes). Keep the two in step: a name the database finds
--   but the browser's fold does not is left out of the list.
--
-- No index: 278 organizations, 30 resources, 4 events on 9 Oct 2026, and every
-- suggestion query has a '%word%' filter (no btree can serve it); the prefix
-- variants ('word%') are always ANDed with it. A sequential scan of a few
-- hundred rows is cheaper than maintaining an index.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Access (RLS unchanged: the columns follow their table's policies)
-- ════════════════════════════════════════════════════════════════════════════
--   resources, events: anon and authenticated have table-level SELECT, which
--     covers new columns. Nothing to grant.
--   organizations: anon and authenticated have NO table-level SELECT; SELECT is
--     granted column by column (every column but claim_code). A new column is
--     therefore unreadable until granted, and PostgREST would answer 42501 to
--     the search. So: GRANT SELECT (name_search) to anon, authenticated. It is
--     a copy of `name`, which both can already read; nothing else changes
--     (claim_code stays withheld).
--   smc_fold(): writing a name or title runs it AS THE WRITER (a member saving
--     the company name runs it as authenticated, staff saving an article too),
--     so it must stay executable by authenticated and service_role. postgres'
--     default privileges in public already give EXECUTE to anon, authenticated
--     and service_role (and PUBLIC); the GRANT below only restates that, so the
--     migration does not depend on default privileges. It is a pure text
--     function: calling it through /rpc exposes nothing.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Safe to add (checked read-only on production, 9 Oct 2026)
-- ════════════════════════════════════════════════════════════════════════════
--   * Triggers: organizations (guard_org_sensitive_columns,
--     guard_org_insert_sensitive_columns, after_org_insert_entitlements,
--     after_org_tier_update_entitlements), resources
--     (resources_stamp_published_at, set_updated_at), events (none). All assign
--     named columns only; none reads the row as a whole.
--   * No view, materialized view, rule or publication depends on these tables.
--     No function takes or returns their row type or %ROWTYPE; no function
--     SELECT *s them (apply_ops_commercial_event, request_commercial_quote_
--     acceptance, confirm/reject_reference_by_token SELECT * other tables only).
--   * Readers with select=*: the Netlify sitemap (events, anon) gets one more
--     key it does not read; the SEO edge function names its columns. Admin
--     pages AdminEvents, AdminEventDetail, AdminResources and
--     AdminResourceDetail read select('*') but write explicit payloads (no row
--     spread back into insert/update/upsert anywhere in src/ or functions/).
--   * The nightly CRM pull (m3-ops-smc-sync, service role, organizations
--     select=*) gets a new key `name_search`. The CRM's ingest
--     (smc_sync.apply_snapshot_core in project dmxtljtlcfwmcombwypf) reads a
--     mapped shape through jsonb_to_recordset with named fields, so an extra
--     key is ignored there. The worker's own mapping is outside the database
--     (not checked): if it hashes whole rows, every organization looks changed
--     once.
--   * ADD COLUMN ... STORED rewrites each table under an ACCESS EXCLUSIVE lock
--     for a few milliseconds (a few hundred rows). lock_timeout 5s: if a long
--     read holds a table (the 03:15 UTC CRM pull), the migration fails instead
--     of queueing every request behind it. Just run it again.
--
-- Idempotent: CREATE OR REPLACE, ADD COLUMN IF NOT EXISTS, GRANT.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Order
-- ════════════════════════════════════════════════════════════════════════════
-- Any. Before it, the new front end's first search gets 42703 (column does not
-- exist), falls back to today's ILIKE on name / title for the rest of the tab's
-- session (sessionStorage smc.searchfold.missing) and finds what it finds today.
-- After it, a tab that already fell back keeps the old search until it is closed.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Checks after applying (read-only)
-- ════════════════════════════════════════════════════════════════════════════
--   select public.smc_fold('Sète'), public.smc_fold('D-Marin Göcek');      -- sete | d-marin gocek
--   select name from public.organizations where name_search like '%gocek%'; -- 3 rows on 9 Oct, D-Marin Göcek included
--   select count(*) from public.organizations where name_search is distinct from public.smc_fold(name); -- 0
--   select has_column_privilege('anon', 'public.organizations', 'name_search', 'select'),  -- true
--          has_column_privilege('anon', 'public.organizations', 'claim_code', 'select');   -- false
--
-- Undo (the front end falls back by itself on the next 42703):
--   alter table public.organizations drop column if exists name_search;
--   alter table public.resources drop column if exists title_search;
--   alter table public.events drop column if exists title_search;
--   drop function if exists public.smc_fold(text);

set local lock_timeout = '5s';

create or replace function public.smc_fold(p text)
returns text
language sql
immutable
strict
parallel safe
set search_path to ''
as $fn$
  select pg_catalog.lower(
    pg_catalog.translate(
      public.unaccent('public.unaccent'::regdictionary, p),
      '‘’ʼ`´′‐‑‒–—―',
      $$''''''------$$
    )
  );
$fn$;

comment on function public.smc_fold(text) is
  'Search fold: lower(unaccent(x)), curly apostrophes and long dashes made plain. Source of the *_search generated columns; src/lib/searchSuggestions.ts fold() must match it.';

grant execute on function public.smc_fold(text) to anon, authenticated, service_role;

alter table public.organizations
  add column if not exists name_search text generated always as (public.smc_fold(name)) stored;
alter table public.resources
  add column if not exists title_search text generated always as (public.smc_fold(title)) stored;
alter table public.events
  add column if not exists title_search text generated always as (public.smc_fold(title)) stored;

comment on column public.organizations.name_search is
  'smc_fold(name), generated: what the search compares (accents, case and apostrophe kinds ignored).';
comment on column public.resources.title_search is
  'smc_fold(title), generated: what the search compares (accents, case and apostrophe kinds ignored).';
comment on column public.events.title_search is
  'smc_fold(title), generated: what the search compares (accents, case and apostrophe kinds ignored).';

-- organizations is read column by column (claim_code withheld): the copy of `name` is readable like `name`.
grant select (name_search) on public.organizations to anon, authenticated;
