-- Accent-insensitive search: folded copies of the names and titles the search
-- suggestions read. 9 Oct 2026.
--
-- NOT APPLIED. Written on branch rf-accents. The dry run is
-- supabase/dryrun/20261009160000_search_fold_columns.dryrun.sql. Apply it
-- BEFORE deploying the front end (see "Order" below).
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
--   public.smc_fold(text): lower(unaccent(NFD(x))), with curly apostrophes and
--     long dashes made plain ("Egypt’s" -> "egypt's", "Marina — 6th" -> "marina
--     - 6th", "Kuşadası" -> "kusadasi", "Straße" -> "strasse", "Майами" ->
--     "маиами"). unaccent already turns ‘ ’ ʼ ′ and ‐ – — into ' and -;
--     translate() adds ` ´ ‑ ‒ ― so the list is the same as the browser's.
--     NFD first: unaccent's fixed rules list leaves some precomposed letters
--     whole (Cyrillic й ї ў ѓ ќ, Latin ǣ ǽ ǿ ẛ, Hangul syllables) that the
--     browser takes apart (NFD, combining marks off); decomposing first gives
--     unaccent the same base letter plus marks, which its rules drop.
--     SQL-standard body (RETURN ..., not a quoted string): Postgres binds
--     unaccent(regdictionary, text) and the dictionary by OID and records the
--     dependency in pg_depend. So:
--       * ALTER EXTENSION unaccent SET SCHEMA ... (the security advisor's lint
--         0014 "extension in public") keeps smc_fold working;
--       * DROP EXTENSION unaccent is refused (2BP01) while smc_fold exists.
--         Never force it with CASCADE: that drops smc_fold AND the three
--         *_search columns, and the search falls back to accent-sensitive.
--       * public.sm_norm_name() still calls unaccent by name with search_path
--         'public': fix it before ever moving the extension.
--     IMMUTABLE although public.unaccent() is STABLE (a generated column needs
--     an immutable expression): the dictionary is bound by OID and the
--     search_path is empty, so the answer depends only on unaccent's rules
--     file, Postgres' Unicode tables (normalize) and the ICU case mapping of
--     the database's default collation (lower). Any of these can change on a
--     Postgres major upgrade, an extension update or an ICU/collation version
--     change; the stored copies would then drift silently. So, after any
--     Postgres major upgrade, ALTER EXTENSION unaccent UPDATE, a "collation
--     version mismatch" warning, or a change to this function: run the three
--     drift counts under "Checks after applying". If any is non-zero, recompute
--     (PG 17+, no row trigger fires, updated_at untouched; each statement
--     rewrites its table under an ACCESS EXCLUSIVE lock for milliseconds):
--       alter table public.organizations alter column name_search set expression as (public.smc_fold(name));
--       alter table public.resources alter column title_search set expression as (public.smc_fold(title));
--       alter table public.events alter column title_search set expression as (public.smc_fold(title));
--     (The no-op updates "set name = name" / "set title = title" also work but
--     fire the row triggers and stamp resources.updated_at.)
--   organizations.name_search, resources.title_search, events.title_search:
--     STORED generated columns, smc_fold(name / title). Never written by anyone
--     (GENERATED ALWAYS: an INSERT or UPDATE that names them fails with 428C9;
--     no client or function does, checked below).
--   The browser folds the search the same way: `fold` in
--   src/lib/searchSuggestions.ts (NFD, combining marks off, lower case, the
--   letters NFD keeps whole: ı ł ø đ ð þ ß æ œ ħ ŧ ŀ ĸ ŋ ſ ĳ ƒ ŉ, then the same
--   apostrophes and dashes). Keep the two in step: a name the database finds
--   but the browser's fold does not is left out of the list (never shown
--   wrongly). Checked on 9 Oct 2026, code point by code point over U+00A0-024F,
--   0300-04FF, 1E00-1EFF, 2000-205E, 2100-218F, 3040-309F, AC00-AC08,
--   FB00-FB06, FF01-FF5E: identical for every accented Latin, Greek and
--   Cyrillic letter and every real name and title. Still different (rare):
--   what unaccent expands but the browser keeps (ƀ ƈ ǆ ǉ ȼ ɇ and other Latin
--   Extended-B letters, ﬁ ﬂ, fullwidth ＡＢＣ, Roman numerals Ⅻ, letterlike ℂ ℕ,
--   © ® « » ½ … “ ”), and the few marks unaccent keeps but the browser drops
--   (U+0363-036F, Cyrillic titlo U+0483-0489, kana voicing marks U+3099/309A).
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
--     so it must stay executable by authenticated and service_role (so must
--     what it calls: unaccent(regdictionary, text) and normalize(text, text)
--     are, checked 9 Oct 2026). postgres'
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
-- MIGRATION FIRST, then the front end. The production front end never names a
-- *_search column and every write names its columns, so the migration is safe
-- under today's client. The new client's fallback is only a safety net: if it
-- ever reaches a database without the columns, a search answered 42703 /
-- PGRST204 about a *_search column re-runs as today's ILIKE on name / title,
-- and that page keeps the old search until it is reloaded (remembered in
-- memory only: a reload asks again).
--
-- ════════════════════════════════════════════════════════════════════════════
-- Checks after applying (read-only)
-- ════════════════════════════════════════════════════════════════════════════
--   select public.smc_fold('Sète'), public.smc_fold('D-Marin Göcek');      -- sete | d-marin gocek
--   select name from public.organizations where name_search like '%gocek%'; -- 3 rows on 9 Oct, D-Marin Göcek included
--   -- the three drift counts (also after a Postgres major upgrade, see "What"): all 0
--   select count(*) from public.organizations where name_search is distinct from public.smc_fold(name);
--   select count(*) from public.resources where title_search is distinct from public.smc_fold(title);
--   select count(*) from public.events where title_search is distinct from public.smc_fold(title);
--   select has_column_privilege('anon', 'public.organizations', 'name_search', 'select'),  -- true
--          has_column_privilege('anon', 'public.organizations', 'claim_code', 'select');   -- false
--   select count(*) from pg_depend where classid = 'pg_proc'::regclass
--      and objid = 'public.smc_fold(text)'::regprocedure
--      and refobjid in ('public.unaccent(regdictionary,text)'::regprocedure::oid, 'public.unaccent'::regdictionary::oid); -- 2
--   (after a move of the extension, name its new schema in the two literals)
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
return pg_catalog.lower(
  pg_catalog.translate(
    public.unaccent('public.unaccent'::regdictionary, pg_catalog.normalize(p, 'NFD')),
    '‘’ʼ`´′‐‑‒–—―',
    $$''''''------$$
  )
);

comment on function public.smc_fold(text) is
  'Search fold: lower(unaccent(NFD(x))), curly apostrophes and long dashes made plain. Source of the *_search generated columns (recompute them if this or unaccent changes); src/lib/searchSuggestions.ts fold() must match it. SQL-standard body: bound to unaccent by OID, so DROP EXTENSION unaccent is refused.';

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
