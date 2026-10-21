-- DRY RUN of supabase/migrations/20261021142000_org_by_email_domain.sql and of its down.
-- NOT A MIGRATION. ONE query text, ONE execute_sql call, BEFORE the file is applied.
-- A snapshot, the migration verbatim, fixtures (a validated company, a pending one and an archived
-- one, each with its own made-up domain, inserted in this transaction only), checks as postgres,
-- anon and an account M3 has not validated, then the down verbatim and checks again.
-- Ends with RAISE EXCEPTION 'DRYRUN ...': everything rolls back. Expected: "12 PASS, 0 FAIL".

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- A. Snapshot
create temp table _dr_res (n serial, ok boolean, label text) on commit drop;
create temp table _dr_fn on commit drop as
  select p.oid::regprocedure::text as fn, coalesce(array_to_string(p.proacl, ','), '') as acl, md5(p.prosrc) as m
    from pg_proc p where p.pronamespace = 'public'::regnamespace;
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
-- public.org_by_email_domain(p_domain): the sign-up form's "your company is already here", without
-- reading organizations.primary_domain (go-live runbook P2 item 3).
-- Down: supabase/migrations/down/20261021142000_org_by_email_domain.down.sql
-- Dry run: supabase/dryrun/20261021142000_org_by_email_domain.dryrun.sql (this file, checks as
-- postgres, anon and a signed-in account, then the down, in one rolled-back transaction).
--
-- ADDITIVE, SAFE FOR MAIN. One read-only SECURITY DEFINER function; nothing existing changes.
--   - Today the sign-up form filters organizations on primary_domain signed out (refonte
--     SignupForm.tsx checkDomain, main SignupForm.tsx:174-177). At go-live anon loses
--     primary_domain (held/directory_visitor_basic.sql); the redesign calls this instead.
--   - Kept NARROW on purpose, since it answers anon (the form runs before the account exists):
--     exact match only on the lower-cased, trimmed domain (no like, no prefix, no list), a
--     validated company only (not archived, not merged), at most one row, and nothing but its
--     id, name and slug, which its public page already shows. It never returns the domain
--     itself, and an unknown domain answers no row, like a domain nobody uses.
--   - Granted to anon and authenticated (the form is signed out). If the front door stops
--     reaching the sign-up form signed out, revoke it from anon.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if to_regprocedure('public.org_by_email_domain(text)') is not null then
    raise exception 'org_by_email_domain: the function already exists';
  end if;
  if (select count(*) from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = 'organizations'
         and c.column_name in ('id', 'name', 'slug', 'primary_domain', 'access_status', 'archived_at', 'duplicate_of', 'created_at')) <> 8 then
    raise exception 'org_by_email_domain: a column it reads is missing';
  end if;
end
$pre$;

create function public.org_by_email_domain(p_domain text)
returns table (id uuid, name text, slug text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select o.id, o.name, o.slug
    from public.organizations o
   where p_domain is not null
     and length(btrim(p_domain)) between 3 and 253
     and o.primary_domain is not null
     and lower(btrim(o.primary_domain)) = lower(btrim(p_domain))
     and o.access_status = 'verified'
     and o.archived_at is null
     and o.duplicate_of is null
   order by o.created_at, o.id
   limit 1
$fn$;

comment on function public.org_by_email_domain(text) is
  'The validated, listed company whose primary_domain is exactly this e-mail domain (lower-cased, trimmed): id, name, slug, at most one row. For the sign-up form, signed out. 20261021142000.';

revoke all on function public.org_by_email_domain(text) from public;
grant execute on function public.org_by_email_domain(text) to anon, authenticated, service_role;

-- C. Fixtures (this transaction only) and checks
create temp table _dr_ids on commit drop as
  select gen_random_uuid() as v, gen_random_uuid() as p, gen_random_uuid() as a, substr(md5(random()::text), 1, 8) as r8;

do $fx$
declare
  v record;
begin
  select * into v from _dr_ids;
  insert into public.organizations (id, name, slug, access_status, onboarding_status, organization_type, primary_domain)
  values (v.v, 'Dryrun Domain ' || v.r8, 'dryrun-domain-v-' || v.r8, 'verified', 'completed', 'partner', 'dryrun-' || v.r8 || '.example'),
         (v.p, 'Dryrun Domain Pending ' || v.r8, 'dryrun-domain-p-' || v.r8, 'pending', 'submitted', 'partner', 'dryrun-p-' || v.r8 || '.example');
  insert into public.organizations (id, name, slug, access_status, onboarding_status, organization_type, primary_domain, archived_at)
  values (v.a, 'Dryrun Domain Archived ' || v.r8, 'dryrun-domain-a-' || v.r8, 'verified', 'completed', 'partner', 'dryrun-a-' || v.r8 || '.example', now());
end
$fx$;

do $c$
declare
  v record;
  v_pending uuid;
  v_pending_label text;
  v_expect text;
  v_out text;
  v_bad integer;
  v_n integer;
begin
  select * into v from _dr_ids;
  select p.user_id into v_pending from public.profiles p where p.access_status = 'pending' order by p.user_id limit 1;
  v_pending_label := case when v_pending is null then 'an account with no profile' else 'a pending account' end;
  v_pending := coalesce(v_pending, gen_random_uuid());
  v_expect := 'ok:' || v.v || '|Dryrun Domain ' || v.r8 || '|dryrun-domain-v-' || v.r8;

  -- C1 shape
  insert into _dr_res (ok, label) values (
    coalesce((select p.prosecdef and p.provolatile = 's' and p.proretset
                     and array_to_string(p.proconfig, ';') = 'search_path=""'
                     and p.proargnames = array['p_domain', 'id', 'name', 'slug']
                     and p.proargmodes::text = '{i,t,t,t}'
                from pg_proc p where p.oid = to_regprocedure('public.org_by_email_domain(text)')), false),
    'C1 org_by_email_domain(text): SECURITY DEFINER, STABLE, search_path "", returns id, name, slug (never the domain)');

  -- C2 who may call it
  insert into _dr_res (ok, label) values (
    coalesce(has_function_privilege('anon', 'public.org_by_email_domain(text)', 'execute')
      and has_function_privilege('authenticated', 'public.org_by_email_domain(text)', 'execute')
      and has_function_privilege('service_role', 'public.org_by_email_domain(text)', 'execute')
      and not exists (select 1 from aclexplode((select p.proacl from pg_proc p where p.oid = to_regprocedure('public.org_by_email_domain(text)'))) a
                       where a.grantee = 0), false),
    'C2 EXECUTE for anon, authenticated, service_role; none for PUBLIC');

  -- C3 a visitor, the exact domain
  v_out := pg_temp.dr_as('anon', null, format(
    'select string_agg(f.id || ''|'' || f.name || ''|'' || f.slug, '';'') from public.org_by_email_domain(%L) f', 'dryrun-' || v.r8 || '.example'));
  insert into _dr_res (ok, label) values (v_out = v_expect, 'C3 anon, exact domain: the validated company, one row: ' || v_out);

  -- C4 capitals and spaces around it (what a person types)
  v_out := pg_temp.dr_as('anon', null, format(
    'select string_agg(f.id || ''|'' || f.name || ''|'' || f.slug, '';'') from public.org_by_email_domain(%L) f', '  DRYRUN-' || upper(v.r8) || '.Example '));
  insert into _dr_res (ok, label) values (v_out = v_expect, 'C4 anon, capitals and spaces: same row: ' || v_out);

  -- C5 no partial match of any kind
  v_out := pg_temp.dr_as('anon', null, format(
    'select count(*)::text from (select * from public.org_by_email_domain(%L) union all select * from public.org_by_email_domain(%L)'
    || ' union all select * from public.org_by_email_domain(%L) union all select * from public.org_by_email_domain(%L)'
    || ' union all select * from public.org_by_email_domain(%L) union all select * from public.org_by_email_domain(null)) x',
    'dryrun-', v.r8 || '.example', '%' || v.r8 || '%', 'dryrun-' || v.r8 || '.example.org', 'ab'));
  insert into _dr_res (ok, label) values (v_out = 'ok:0', 'C5 anon: a prefix, a suffix, a wildcard, a longer domain, 2 letters and null find nothing: ' || v_out);

  -- C6 a pending company and an archived one are not found
  v_out := pg_temp.dr_as('anon', null, format(
    'select count(*)::text from (select * from public.org_by_email_domain(%L) union all select * from public.org_by_email_domain(%L)) x',
    'dryrun-p-' || v.r8 || '.example', 'dryrun-a-' || v.r8 || '.example'));
  insert into _dr_res (ok, label) values (v_out = 'ok:0', 'C6 anon: the domains of a pending and of an archived company find nothing: ' || v_out);

  -- C7 an account M3 has not validated (the form right after sign-up)
  v_out := pg_temp.dr_as('authenticated', v_pending, format(
    'select string_agg(f.id || ''|'' || f.name || ''|'' || f.slug, '';'') from public.org_by_email_domain(%L) f', 'dryrun-' || v.r8 || '.example'));
  insert into _dr_res (ok, label) values (v_out = v_expect, 'C7 ' || v_pending_label || ': same row: ' || v_out);

  -- C8 every real validated listed company with a domain is found by it, and only those
  select count(*) into v_bad
    from public.organizations o
   where o.primary_domain is not null
     and (select f.id from public.org_by_email_domain(o.primary_domain) f)
         is distinct from (case when o.access_status = 'verified' and o.archived_at is null and o.duplicate_of is null then o.id end);
  select count(*) into v_n from public.organizations o where o.primary_domain is not null;
  insert into _dr_res (ok, label) values (v_bad = 0,
    'C8 the ' || v_n || ' companies with a domain: found by it when validated and listed, never otherwise; ' || v_bad || ' differ');

  -- C9 the direct read it replaces still answers (main and the fallback, until go-live)
  v_out := pg_temp.dr_as('anon', null, format('select count(*)::text from public.organizations where primary_domain = %L', 'dryrun-' || v.r8 || '.example'));
  insert into _dr_res (ok, label) values (v_out = 'ok:1', 'C9 anon: the old primary_domain filter still answers (main unchanged): ' || v_out);

  -- C10 nothing else moved
  insert into _dr_res (ok, label) values (
    not exists ((select f.fn, f.acl, f.m from _dr_fn f)
                except
                (select p.oid::regprocedure::text, coalesce(array_to_string(p.proacl, ','), ''), md5(p.prosrc)
                   from pg_proc p where p.pronamespace = 'public'::regnamespace))
      and (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace) = (select count(*) from _dr_fn) + 1
      and (select md5(string_agg(format('%s|%s|%s|%s|%s|%s', pl.schemaname, pl.tablename, pl.policyname, pl.roles, pl.qual, pl.with_check), ';'
                                 order by pl.schemaname, pl.tablename, pl.policyname))
             from pg_policies pl where pl.schemaname in ('public', 'storage')) = (select p.m from _dr_pol p),
    'C10 every other public function unchanged, one added; every policy unchanged');
end
$c$;

-- D. The down, verbatim
-- DOWN for supabase/migrations/20261021142000_org_by_email_domain.sql
-- Drops org_by_email_domain(text). The redesign's sign-up form then falls back to its direct
-- primary_domain filter (src/components/auth/SignupForm.tsx), which works while anon still reads
-- that column, i.e. until held/directory_visitor_basic.sql is applied. After that, run this down
-- only together with that file's down, or the form simply stops recognising company domains
-- (no error: the account is created all the same).

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
declare
  v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p
   where p.prosrc ilike '%org_by_email_domain%'
     and p.oid is distinct from to_regprocedure('public.org_by_email_domain(text)')
     and p.prolang <> (select l.oid from pg_language l where l.lanname = 'c');
  if v_bad is not null then
    raise exception 'org_by_email_domain down: SQL function(s) call it: %', v_bad;
  end if;
end
$pre$;

drop function if exists public.org_by_email_domain(text);

-- E. Checks after the down, then the report (rolls everything back)
do $e$
declare
  v_txt text;
begin
  insert into _dr_res (ok, label) values (to_regprocedure('public.org_by_email_domain(text)') is null, 'E1 down dropped org_by_email_domain(text)');
  insert into _dr_res (ok, label) values (
    not exists ((select f.fn, f.acl, f.m from _dr_fn f)
                except
                (select p.oid::regprocedure::text, coalesce(array_to_string(p.proacl, ','), ''), md5(p.prosrc)
                   from pg_proc p where p.pronamespace = 'public'::regnamespace))
      and (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace) = (select count(*) from _dr_fn),
    'E2 public functions back to the snapshot (' || (select count(*) from _dr_fn) || ')');
  select string_agg(case when r.ok then 'PASS ' else 'FAIL ' end || r.label, chr(10) order by r.n) into v_txt from _dr_res r;
  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (org_by_email_domain, run %s)',
    (select count(*) from _dr_res where ok), (select count(*) from _dr_res where ok is not true), now()) || chr(10) || v_txt;
end
$e$;
