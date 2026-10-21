-- DRY RUN of supabase/migrations/20261021144000_org_type_for_invitation.sql and of its down.
-- NOT A MIGRATION. ONE query text, ONE execute_sql call, BEFORE the file is applied.
-- A snapshot, the migration verbatim, fixtures (a pending partner company with an open invitation,
-- an expired one and an accepted one, inserted in this transaction only), checks as postgres, anon
-- and an account M3 has not validated, then the down verbatim and checks again.
-- Ends with RAISE EXCEPTION 'DRYRUN ...': everything rolls back. Expected: "9 PASS, 0 FAIL".

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
-- public.org_type_for_invitation(p_invitation_id): the type of the company an invitation is for,
-- so the invitation sign-up page picks the right persona without reading organizations signed out
-- (privacy review of 21 Oct 2026, finding 1; go-live runbook P2).
-- Down: supabase/migrations/down/20261021144000_org_type_for_invitation.down.sql
-- Dry run: supabase/dryrun/20261021144000_org_type_for_invitation.dryrun.sql (this file, checks as
-- postgres, anon and an account M3 has not validated, then the down, in one rolled-back
-- transaction).
--
-- ADDITIVE, SAFE FOR MAIN. One read-only SECURITY DEFINER function; nothing existing changes.
--   - The invitation sign-up page (src/pages/JoinPage.tsx, handleSignup) runs signed out, before
--     the account exists, and reads organizations.organization_type of the inviting company to
--     choose the new account's persona. At go-live (held/directory_visitor_basic.sql) a company M3
--     has not validated is invisible to visitors, and the owners of such a company can send
--     invitations (owners_can_create_invitations): the read would find nothing, the page would
--     fall back to the persona 'marina', and accept_org_invitation never corrects it. Once M3
--     validates the person, they would get marina-only rights.
--   - Narrow on purpose: it answers only for an invitation that is still open (status 'pending',
--     not expired), keyed on its id (the secret of the e-mailed link, which
--     get_invitation_for_join already accepts), and returns the company type only, nothing else.
--   - Granted to anon and authenticated (the page runs signed out, and signed in after a login).
--     main does not call it.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if to_regprocedure('public.org_type_for_invitation(uuid)') is not null then
    raise exception 'org_type_for_invitation: the function already exists';
  end if;
  if (select count(*) from information_schema.columns c
       where c.table_schema = 'public'
         and ((c.table_name = 'organization_invitations' and c.column_name in ('id', 'organization_id', 'status', 'expires_at'))
           or (c.table_name = 'organizations' and c.column_name in ('id', 'organization_type')))) <> 6 then
    raise exception 'org_type_for_invitation: a column it reads is missing';
  end if;
end
$pre$;

create function public.org_type_for_invitation(p_invitation_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select o.organization_type
    from public.organization_invitations oi
    join public.organizations o on o.id = oi.organization_id
   where oi.id = p_invitation_id
     and oi.status = 'pending'
     and oi.expires_at >= now()
   limit 1
$fn$;

comment on function public.org_type_for_invitation(uuid) is
  'The organization_type of the company an open invitation (status pending, not expired) is for, or null. For the invitation sign-up page, signed out: it chooses the new account''s persona. 20261021144000.';

revoke all on function public.org_type_for_invitation(uuid) from public;
grant execute on function public.org_type_for_invitation(uuid) to anon, authenticated, service_role;

-- C. Fixtures (this transaction only) and checks
create temp table _dr_ids on commit drop as
  select gen_random_uuid() as o, gen_random_uuid() as i_open, gen_random_uuid() as i_expired, gen_random_uuid() as i_accepted,
         substr(md5(random()::text), 1, 8) as r8;

do $fx$
declare
  v record;
begin
  select * into v from _dr_ids;
  insert into public.organizations (id, name, slug, access_status, onboarding_status, organization_type)
  values (v.o, 'Dryrun Invite ' || v.r8, 'dryrun-invite-' || v.r8, 'pending', 'submitted', 'partner');
  insert into public.organization_invitations (id, organization_id, email, status, expires_at)
  values (v.i_open, v.o, 'dryrun-open-' || v.r8 || '@example.invalid', 'pending', now() + interval '10 days'),
         (v.i_expired, v.o, 'dryrun-expired-' || v.r8 || '@example.invalid', 'pending', now() - interval '1 day'),
         (v.i_accepted, v.o, 'dryrun-accepted-' || v.r8 || '@example.invalid', 'accepted', now() + interval '10 days');
end
$fx$;

do $c$
declare
  v record;
  v_pending uuid;
  v_pending_label text;
  v_out text;
begin
  select * into v from _dr_ids;
  select p.user_id into v_pending from public.profiles p where p.access_status = 'pending' order by p.user_id limit 1;
  v_pending_label := case when v_pending is null then 'an account with no profile' else 'a pending account' end;
  v_pending := coalesce(v_pending, gen_random_uuid());

  -- C1 shape
  insert into _dr_res (ok, label) values (
    coalesce((select p.prosecdef and p.provolatile = 's' and not p.proretset
                     and array_to_string(p.proconfig, ';') = 'search_path=""'
                     and p.prorettype = 'text'::regtype
                from pg_proc p where p.oid = to_regprocedure('public.org_type_for_invitation(uuid)')), false),
    'C1 org_type_for_invitation(uuid): SECURITY DEFINER, STABLE, search_path "", returns one text (the type only)');

  -- C2 who may call it
  insert into _dr_res (ok, label) values (
    coalesce(has_function_privilege('anon', 'public.org_type_for_invitation(uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.org_type_for_invitation(uuid)', 'execute')
      and has_function_privilege('service_role', 'public.org_type_for_invitation(uuid)', 'execute')
      and not exists (select 1 from aclexplode((select p.proacl from pg_proc p where p.oid = to_regprocedure('public.org_type_for_invitation(uuid)'))) a
                       where a.grantee = 0), false),
    'C2 EXECUTE for anon, authenticated, service_role; none for PUBLIC');

  -- C3 a visitor, the open invitation of a company M3 has not validated: its type
  v_out := pg_temp.dr_as('anon', null, format('select public.org_type_for_invitation(%L)', v.i_open));
  insert into _dr_res (ok, label) values (v_out = 'ok:partner', 'C3 anon, an open invitation of a pending partner company -> ' || v_out);

  -- C4 an expired invitation, an accepted one, an unknown id, null: nothing
  v_out := pg_temp.dr_as('anon', null, format(
    'select coalesce(public.org_type_for_invitation(%L), ''-'') || ''/'' || coalesce(public.org_type_for_invitation(%L), ''-'') || ''/'' || coalesce(public.org_type_for_invitation(%L), ''-'') || ''/'' || coalesce(public.org_type_for_invitation(null), ''-'')',
    v.i_expired, v.i_accepted, gen_random_uuid()));
  insert into _dr_res (ok, label) values (v_out = 'ok:-/-/-/-', 'C4 anon: expired, accepted, unknown id, null -> ' || v_out);

  -- C5 the same open invitation, signed in (the page after a login)
  v_out := pg_temp.dr_as('authenticated', v_pending, format('select public.org_type_for_invitation(%L)', v.i_open));
  insert into _dr_res (ok, label) values (v_out = 'ok:partner', 'C5 ' || v_pending_label || ': the open invitation -> ' || v_out);

  -- C6 every real open invitation answers its company's type, the others null
  insert into _dr_res (ok, label) values (
    not exists (select 1 from public.organization_invitations oi join public.organizations o on o.id = oi.organization_id
                 where public.org_type_for_invitation(oi.id) is distinct from
                       (case when oi.status = 'pending' and oi.expires_at >= now() then o.organization_type end)),
    'C6 every invitation: the type when open, null otherwise');

  -- C7 nothing else moved
  insert into _dr_res (ok, label) values (
    not exists ((select f.fn, f.acl, f.m from _dr_fn f)
                except
                (select p.oid::regprocedure::text, coalesce(array_to_string(p.proacl, ','), ''), md5(p.prosrc)
                   from pg_proc p where p.pronamespace = 'public'::regnamespace))
      and (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace) = (select count(*) from _dr_fn) + 1
      and (select md5(string_agg(format('%s|%s|%s|%s|%s|%s', pl.schemaname, pl.tablename, pl.policyname, pl.roles, pl.qual, pl.with_check), ';'
                                 order by pl.schemaname, pl.tablename, pl.policyname))
             from pg_policies pl where pl.schemaname in ('public', 'storage')) = (select p.m from _dr_pol p),
    'C7 every other public function unchanged, one added; every policy unchanged');
end
$c$;

-- D. The down, verbatim
-- DOWN for supabase/migrations/20261021144000_org_type_for_invitation.sql
-- Drops org_type_for_invitation(uuid). The redesign's invitation sign-up page then falls back to
-- its direct read of organizations.organization_type (src/pages/JoinPage.tsx), which works while
-- anon still reads every company, i.e. until held/directory_visitor_basic.sql is applied. After
-- that, run this down only together with that file's down: the page would refuse the sign-up of an
-- invitee of a company M3 has not validated ("could not read the company"), never guess a persona.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
declare
  v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p
   where p.prosrc ilike '%org_type_for_invitation%'
     and p.oid is distinct from to_regprocedure('public.org_type_for_invitation(uuid)')
     and p.prolang <> (select l.oid from pg_language l where l.lanname = 'c');
  if v_bad is not null then
    raise exception 'org_type_for_invitation down: SQL function(s) call it: %', v_bad;
  end if;
end
$pre$;

drop function if exists public.org_type_for_invitation(uuid);

-- E. Checks after the down, then the report (rolls everything back)
do $e$
declare
  v_txt text;
begin
  insert into _dr_res (ok, label) values (to_regprocedure('public.org_type_for_invitation(uuid)') is null, 'E1 down dropped org_type_for_invitation(uuid)');
  insert into _dr_res (ok, label) values (
    not exists ((select f.fn, f.acl, f.m from _dr_fn f)
                except
                (select p.oid::regprocedure::text, coalesce(array_to_string(p.proacl, ','), ''), md5(p.prosrc)
                   from pg_proc p where p.pronamespace = 'public'::regnamespace))
      and (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace) = (select count(*) from _dr_fn),
    'E2 public functions back to the snapshot (' || (select count(*) from _dr_fn) || ')');
  select string_agg(case when r.ok then 'PASS ' else 'FAIL ' end || r.label, chr(10) order by r.n) into v_txt from _dr_res r;
  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (org_type_for_invitation, run %s)',
    (select count(*) from _dr_res where ok), (select count(*) from _dr_res where ok is not true), now()) || chr(10) || v_txt;
end
$e$;
