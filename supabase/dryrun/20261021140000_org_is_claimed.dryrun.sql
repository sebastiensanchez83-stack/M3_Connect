-- DRY RUN of supabase/migrations/20261021140000_org_is_claimed.sql and of its down.
-- NOT A MIGRATION. ONE query text, ONE execute_sql call, BEFORE the file is applied.
-- A snapshot, the migration verbatim, checks (as postgres, as anon, as a signed-in account), the
-- down verbatim, checks again. Writes nothing that survives: it ends with RAISE EXCEPTION
-- 'DRYRUN ...', so everything rolls back. Expected: "14 PASS, 0 FAIL".

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- A. Snapshot
create temp table _dr_res (n serial, ok boolean, label text) on commit drop;
create temp table _dr_colacl on commit drop as
  select a.attname::text as col,
         coalesce((select string_agg(x.grantee::regrole::text || ':' || x.privilege_type, ',' order by x.grantee::regrole::text, x.privilege_type)
                     from aclexplode(a.attacl) x), '') as acl
    from pg_attribute a
   where a.attrelid = 'public.organizations'::regclass and a.attnum > 0 and not a.attisdropped;
create temp table _dr_orgs on commit drop as
  select md5(string_agg(concat_ws('/', o.id, o.owner_user_id, o.updated_at, o.access_status, o.name), ',' order by o.id)) as m,
         count(*) as n, count(o.owner_user_id) as n_owner,
         count(*) filter (where o.owner_user_id is not null and o.access_status = 'verified') as n_owner_verified
    from public.organizations o;
create temp table _dr_pol on commit drop as
  select md5(string_agg(format('%s|%s|%s|%s|%s|%s', pl.schemaname, pl.tablename, pl.policyname, pl.roles, pl.qual, pl.with_check), ';'
                        order by pl.schemaname, pl.tablename, pl.policyname)) as m
    from pg_policies pl where pl.schemaname in ('public', 'storage');

-- Runs one query (one text column) as anon or as a signed-in account and returns 'ok:<value>' or
-- 'err:<sqlstate>:<message>'. The error is caught around the query only; the caller asserts after.
create function pg_temp.dr_as(p_who text, p_uid uuid, p_sql text) returns text language plpgsql as $f$
declare
  v_out text;
begin
  if p_who = 'anon' then
    perform set_config('request.jwt.claims', '{"role": "anon"}', true);
    set local role anon;
  elsif p_who = 'authenticated' then
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    set local role authenticated;
  else
    raise exception 'dr_as: unknown caller %', p_who;
  end if;
  begin
    execute p_sql into v_out;
    v_out := 'ok:' || coalesce(v_out, 'null');
  exception when others then
    v_out := 'err:' || sqlstate || ':' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  return v_out;
end
$f$;

-- B. The migration, verbatim
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

-- C. Checks after the migration
do $c$
declare
  v_member uuid;
  v_out text;
  v_state text;
  v_main33 constant text := 'id, name, slug, primary_domain, organization_type, tier, max_seats, created_by_user_id, owner_user_id, logo_url, description, website, country, city, created_at, updated_at, access_status, onboarding_status, rejection_reason, audience_description, headquarters_country, social_media_links, marina_subtype, auto_approve_domain_joins, banner_url, investment_geographies, investment_size_min, investment_size_max, investment_hold_period, investment_thesis, featured_partner, gallery, is_event_media_partner';
  v_basic constant text := 'id, name, slug, organization_type, tier, logo_url, banner_url, description, audience_description, website, country, city, headquarters_country, gallery, investment_geographies, investment_size_min, investment_size_max, investment_hold_period, investment_thesis, featured_partner, is_event_media_partner, access_status, archived_at, duplicate_of, created_at, updated_at, is_claimed';
  v_snap record;
begin
  select * into v_snap from _dr_orgs;
  -- A validated member who is not M3 staff (signed-in reads).
  select p.user_id into v_member from public.profiles p
   where p.access_status = 'verified' and p.persona::text not in ('admin', 'moderator')
   order by p.user_id limit 1;

  -- C1 the column
  insert into _dr_res (ok, label) values (
    coalesce((select c.data_type = 'boolean' and c.is_generated = 'ALWAYS' and c.generation_expression = '(owner_user_id IS NOT NULL)'
                     and a.attgenerated = 's'
                from information_schema.columns c
                join pg_attribute a on a.attrelid = 'public.organizations'::regclass and a.attname = c.column_name
               where c.table_schema = 'public' and c.table_name = 'organizations' and c.column_name = 'is_claimed'), false),
    'C1 organizations.is_claimed: boolean, GENERATED ALWAYS AS (owner_user_id IS NOT NULL) STORED');

  -- C2 its values
  insert into _dr_res (ok, label) values (
    not exists (select 1 from public.organizations o where o.is_claimed is distinct from (o.owner_user_id is not null))
      and (select count(*) from public.organizations o where o.is_claimed) = v_snap.n_owner,
    'C2 is_claimed = (owner_user_id is not null) on every row: ' || v_snap.n_owner || ' claimed of ' || v_snap.n);

  -- C3 the grants: anon and authenticated on the new column, every other column as before
  insert into _dr_res (ok, label) values (
    coalesce((select x.acl = 'anon:SELECT,authenticated:SELECT'
                from (select coalesce((select string_agg(e.grantee::regrole::text || ':' || e.privilege_type, ',' order by e.grantee::regrole::text, e.privilege_type)
                                         from aclexplode(a.attacl) e), '') as acl
                        from pg_attribute a where a.attrelid = 'public.organizations'::regclass and a.attname = 'is_claimed') x), false)
      and not exists ((select s.col, s.acl from _dr_colacl s)
                      except
                      (select a.attname::text, coalesce((select string_agg(e.grantee::regrole::text || ':' || e.privilege_type, ',' order by e.grantee::regrole::text, e.privilege_type)
                                                          from aclexplode(a.attacl) e), '')
                         from pg_attribute a where a.attrelid = 'public.organizations'::regclass and a.attnum > 0 and not a.attisdropped)),
    'C3 is_claimed granted to anon and authenticated (SELECT only); every other column privilege unchanged');

  -- C4 anon reads the redesign's visitor list with is_claimed, and it says the same as owner_user_id
  v_out := pg_temp.dr_as('anon', null,
    'select count(*) filter (where x.is_claimed)::text || ''/'' || count(*) filter (where o.owner_user_id is not null)::text'
    || ' from (select ' || v_basic || ' from public.organizations) x join public.organizations o on o.id = x.id');
  insert into _dr_res (ok, label) values (
    v_out ~ '^ok:[0-9]+/[0-9]+$' and split_part(substr(v_out, 4), '/', 1) = split_part(substr(v_out, 4), '/', 2),
    'C4 anon: the visitor column list + is_claimed reads, claimed = owner set: ' || v_out);

  -- C5 main's 33 columns, signed out: unchanged
  v_out := pg_temp.dr_as('anon', null, 'select count(*)::text from (select ' || v_main33 || ' from public.organizations) x');
  insert into _dr_res (ok, label) values (v_out = 'ok:' || v_snap.n, 'C5 anon: main''s 33-column read still answers every row: ' || v_out);

  -- C6 a signed-in account reads it
  v_out := pg_temp.dr_as('authenticated', v_member, 'select count(*) filter (where is_claimed)::text from public.organizations');
  insert into _dr_res (ok, label) values (v_member is not null and v_out = 'ok:' || v_snap.n_owner,
    'C6 signed-in validated member: is_claimed readable, ' || v_out || ' claimed (postgres: ' || v_snap.n_owner || ')');

  -- C7 the filter the lists use (eq is_claimed true), signed out
  v_out := pg_temp.dr_as('anon', null, 'select count(*)::text from public.organizations where is_claimed = true and access_status = ''verified''');
  insert into _dr_res (ok, label) values (v_out = 'ok:' || v_snap.n_owner_verified,
    'C7 anon: is_claimed = true and verified -> ' || v_out || ' (owner set and verified: ' || v_snap.n_owner_verified || ')');

  -- C8 nobody writes it (428C9), even postgres
  v_state := null;
  begin
    update public.organizations set is_claimed = true where false;
    v_state := 'no error';
  exception when others then
    v_state := sqlstate;
  end;
  insert into _dr_res (ok, label) values (v_state = '428C9', 'C8 a write naming is_claimed is refused: ' || coalesce(v_state, 'null'));

  -- C9 no data changed by the rewrite
  insert into _dr_res (ok, label) values (
    (select md5(string_agg(concat_ws('/', o.id, o.owner_user_id, o.updated_at, o.access_status, o.name), ',' order by o.id)) from public.organizations o) = v_snap.m,
    'C9 organizations rows unchanged (id, owner, status, name, updated_at)');

  -- C10 no policy changed
  insert into _dr_res (ok, label) values (
    (select md5(string_agg(format('%s|%s|%s|%s|%s|%s', pl.schemaname, pl.tablename, pl.policyname, pl.roles, pl.qual, pl.with_check), ';'
                           order by pl.schemaname, pl.tablename, pl.policyname))
       from pg_policies pl where pl.schemaname in ('public', 'storage')) = (select p.m from _dr_pol p),
    'C10 every policy unchanged');
end
$c$;

-- D. The down, verbatim
-- DOWN for supabase/migrations/20261021140000_org_is_claimed.sql
-- Drops organizations.is_claimed (its column grants go with it). The redesign falls back to
-- owner_user_id when the column is missing (src/lib/orgVisibility.ts), so its pages keep working
-- as long as anon still reads owner_user_id.
-- NEVER run this while supabase/migrations/held/directory_visitor_basic.sql is applied: that file
-- takes owner_user_id away from anon, so the fallback would fail and the directory, the home page
-- and every company page would break for visitors. Run that file's down first.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
declare
  v_bad text;
begin
  -- The held file leaves anon without owner_user_id: refuse.
  if exists (select 1 from information_schema.columns c
              where c.table_schema = 'public' and c.table_name = 'organizations' and c.column_name = 'owner_user_id')
     and not has_column_privilege('anon', 'public.organizations', 'owner_user_id', 'select') then
    raise exception 'org_is_claimed down: anon cannot read owner_user_id (held/directory_visitor_basic.sql is applied); run its down first';
  end if;
  -- Nothing in the database may depend on the column (a view, a policy, a function body).
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prosrc ilike '%is_claimed%'
     and p.prolang <> (select l.oid from pg_language l where l.lanname = 'c');
  if v_bad is not null then
    raise exception 'org_is_claimed down: function(s) read is_claimed: %', v_bad;
  end if;
  if exists (select 1 from pg_policies pl where pl.schemaname = 'public'
              and (coalesce(pl.qual, '') ilike '%is_claimed%' or coalesce(pl.with_check, '') ilike '%is_claimed%')) then
    raise exception 'org_is_claimed down: a policy reads is_claimed';
  end if;
end
$pre$;

alter table public.organizations drop column if exists is_claimed;

-- E. Checks after the down, then the report (rolls everything back)
do $e$
declare
  v_txt text;
  v_out text;
  v_main33 constant text := 'id, name, slug, primary_domain, organization_type, tier, max_seats, created_by_user_id, owner_user_id, logo_url, description, website, country, city, created_at, updated_at, access_status, onboarding_status, rejection_reason, audience_description, headquarters_country, social_media_links, marina_subtype, auto_approve_domain_joins, banner_url, investment_geographies, investment_size_min, investment_size_max, investment_hold_period, investment_thesis, featured_partner, gallery, is_event_media_partner';
begin
  insert into _dr_res (ok, label) values (
    not exists (select 1 from information_schema.columns c
                 where c.table_schema = 'public' and c.table_name = 'organizations' and c.column_name = 'is_claimed'),
    'E1 down dropped organizations.is_claimed');
  insert into _dr_res (ok, label) values (
    not exists ((select s.col, s.acl from _dr_colacl s)
                except
                (select a.attname::text, coalesce((select string_agg(e.grantee::regrole::text || ':' || e.privilege_type, ',' order by e.grantee::regrole::text, e.privilege_type)
                                                    from aclexplode(a.attacl) e), '')
                   from pg_attribute a where a.attrelid = 'public.organizations'::regclass and a.attnum > 0 and not a.attisdropped))
      and not exists ((select a.attname::text, coalesce((select string_agg(e.grantee::regrole::text || ':' || e.privilege_type, ',' order by e.grantee::regrole::text, e.privilege_type)
                                                          from aclexplode(a.attacl) e), '')
                         from pg_attribute a where a.attrelid = 'public.organizations'::regclass and a.attnum > 0 and not a.attisdropped)
                      except
                      (select s.col, s.acl from _dr_colacl s)),
    'E2 column privileges of organizations back to the snapshot');
  v_out := pg_temp.dr_as('anon', null, 'select count(*)::text from (select ' || v_main33 || ' from public.organizations) x');
  insert into _dr_res (ok, label) values (v_out = 'ok:' || (select n from _dr_orgs), 'E3 anon: main''s 33-column read answers every row: ' || v_out);
  insert into _dr_res (ok, label) values (
    (select md5(string_agg(concat_ws('/', o.id, o.owner_user_id, o.updated_at, o.access_status, o.name), ',' order by o.id)) from public.organizations o) = (select m from _dr_orgs),
    'E4 organizations rows unchanged');
  select string_agg(case when r.ok then 'PASS ' else 'FAIL ' end || r.label, chr(10) order by r.n) into v_txt from _dr_res r;
  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (org_is_claimed, run %s)',
    (select count(*) from _dr_res where ok), (select count(*) from _dr_res where ok is not true), now()) || chr(10) || v_txt;
end
$e$;
