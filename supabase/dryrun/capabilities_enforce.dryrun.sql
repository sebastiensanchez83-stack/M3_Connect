-- DRY RUN of the switch: supabase/migrations/20261010200000_capabilities_shadow.sql
--        THEN supabase/migrations/held/capabilities_enforce.sql,
--        then its down script supabase/migrations/down/capabilities_enforce.down.sql
-- NOT A MIGRATION: never apply it. NOTHING IS KEPT.
-- (Generated: the two migrations and the down script below are verbatim copies;
-- if any of them changes, rebuild this file.)
--
-- Once the shadow migration is applied in production, its section B below still
-- runs harmlessly (IF NOT EXISTS, OR REPLACE, ON CONFLICT): this file stays valid
-- before and after it.
--
-- How to run: the WHOLE file in ONE execute_sql call (one implicit transaction).
-- Do not add BEGIN/COMMIT and do not run it statement by statement. The last
-- statement ends with RAISE EXCEPTION 'DRYRUN ...': both migrations, every test
-- write and the down script roll back; the error text IS the report ("n PASS,
-- m FAIL" first, then one line per check).
-- Tripwire: if the report says "before-snapshot missing", the statements did NOT
-- run in one transaction: check pg_policies for partner_requests_insert_capable
-- at once, and run supabase/migrations/down/capabilities_enforce.down.sql if it
-- is there.
--
-- Layout
--   A. helpers (pg_temp) and the snapshot;
--   B. the shadow migration, verbatim; then the "mid" snapshot;
--   C. the switch, verbatim;
--   D. checks: T00-T03 structure (exactly 8 policies dropped, 8 added, 4 rewritten
--      in place plus the origin rule, nothing else; the persona functions and the
--      partners directory untouched; origin 'interest'; the flag on), then EVERY
--      ROW OF THE TABLE (M01-M10) against the real policies and triggers: a
--      verified member P is given one company of the row's type (Q, another
--      member, runs a validated marina that published an RFP and a consultation),
--      and twelve things are tried as P, each in its own rolled-back
--      sub-transaction:
--        see the RFP, see the consultation, publish an RFP, publish a
--        consultation, submit a project (through P's company), express interest
--        (origin interest), send a first message (origin message), send an
--        old-site request (origin null), propose a webinar, read the deal flow,
--        edit and delete P's own RFP;
--      M11 two companies (publishing goes through the company that may publish,
--      never under a company P is not in); M12 anonymous;
--   E. the switch's down script, verbatim;
--   F. E1-E4: the twelve policies and the origin rule are back exactly as after
--      B, the flag is off, an origin 'interest' row is kept with origin null, the
--      shadow objects stay; the report.
--
-- Expected matrix (Y allowed, N refused), columns in the order above:
--   M01 marina                         YYYYYNYYYNYY   (sees, read-only: no interest)
--   M02 service provider               YYNNNYYYYNNY
--   M03 investor                       YYNNNYYYYYNY
--   M04 developer                      YYYYYYYYYNYY
--   M05 media                          YYNNNYYYYNNY
--   M06 participant (no company)       NNNNNNNNYNNY   (webinar only)
--   M07 validated company, no type     NNNNNNNNYNNY
--   M08 suspended marina company       NNNNNNNNYNNY
--   M09 person pending review          NNNNNNNNNNNN
--   M10 M3 staff                       YYYYYYYYYYYY
-- Expected: "23 PASS, 0 FAIL".
--
-- Callers, looked up AT RUN TIME (read-only): P and Q = the first two verified
-- non-staff profiles (by id), A = the first verified admin.
--
-- Locks: the switch replaces policies on rfps, consultations, marina_projects,
-- partner_requests, webinar_requests and org_capital_intents and a constraint of
-- partner_requests (ACCESS EXCLUSIVE until the run rolls back). Every read of
-- those tables waits meanwhile: run it at a quiet hour; it gives up after 5 s.


-- ════════════════════════════════════════════════════════════════════════════
-- A. Helpers and snapshot
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Helpers (temporary, gone with the session) ──────────────────────────────
set local lock_timeout = '5s';
set local statement_timeout = '180s';

-- Everything the migrations could touch, as (key, value) lines.
create function pg_temp.dr_snapshot()
returns table (k text, v text)
language sql
as $snap$
  select 'policy ' || tablename || '.' || policyname,
         permissive || '|' || cmd || '|' || roles::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '')
    from pg_policies
   where schemaname = 'public'
  union all
  select 'function ' || p.oid::regprocedure::text,
         md5(p.prosrc) || '|' || coalesce(p.proconfig::text, '') || '|' || p.prosecdef::text || '|'
           || p.provolatile::text || '|' || coalesce(p.proacl::text, '')
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
  union all
  select 'trigger ' || t.tgrelid::regclass::text || '.' || t.tgname, pg_get_triggerdef(t.oid) || '|' || t.tgenabled::text
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
   where not t.tgisinternal and c.relnamespace = 'public'::regnamespace
  union all
  select 'constraint ' || c.conrelid::regclass::text || '.' || c.conname, pg_get_constraintdef(c.oid)
    from pg_constraint c
   where c.connamespace = 'public'::regnamespace
  union all
  select 'table ' || c.oid::regclass::text, coalesce(c.relacl::text, '') || '|' || c.relrowsecurity::text
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v')
  union all
  select 'flags', coalesce((select ps.value::text from public.platform_settings ps where ps.key = 'registration_flags'), '<none>')
$snap$;

-- One report line. A NULL outcome is a FAIL.
create function pg_temp.dr_line(p_ok boolean, p_label text, p_detail text default null)
returns text
language sql
as $line$
  select case when coalesce(p_ok, false) then 'PASS ' else 'FAIL ' end || p_label
         || case when not coalesce(p_ok, false) and p_detail is not null then ' [' || p_detail || ']' else '' end
$line$;

-- Same set of capabilities, whatever the order.
create function pg_temp.dr_same(a text[], b text[])
returns boolean
language sql
as $same$
  select coalesce(a, '{}'::text[]) @> coalesce(b, '{}'::text[]) and coalesce(a, '{}'::text[]) <@ coalesce(b, '{}'::text[])
$same$;

-- Fixtures, written as postgres inside a scenario that is always rolled back.
create function pg_temp.dr_org(p_type text, p_status text)
returns uuid
language plpgsql
as $org$
declare
  v uuid;
begin
  insert into public.organizations (name, slug, organization_type, access_status, onboarding_status)
  values ('DRYRUN capabilities ' || coalesce(p_type, 'untyped'),
          'dryrun-capabilities-' || replace(gen_random_uuid()::text, '-', ''),
          p_type, p_status, 'completed')
  returning id into v;
  return v;
end
$org$;

create function pg_temp.dr_join(p_org uuid, p_user uuid)
returns void
language sql
as $join$
  insert into public.organization_members (organization_id, user_id, role) values (p_org, p_user, 'owner');
$join$;

-- The person belongs to no company (until the scenario adds some).
create function pg_temp.dr_solo(p_user uuid)
returns void
language sql
as $solo$
  delete from public.organization_members where user_id = p_user;
$solo$;

-- The six capabilities the caller has, asked as that person (p_user null = anonymous).
create function pg_temp.dr_caps_as(p_user uuid, p_org uuid default null)
returns text[]
language plpgsql
as $caps$
declare
  v text[];
begin
  if p_user is null then
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    set local role anon;
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    set local role authenticated;
  end if;
  v := array(
    select c
      from unnest(array['publish_needs', 'see_opportunities', 'answer_needs',
                        'message_companies', 'propose_webinar', 'see_dealflow']) c
     where public.has_capability(c, p_org)
     order by c collate "C");
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v;
end
$caps$;

-- Runs one statement as a person (null = anonymous) in its own sub-transaction,
-- always rolled back: 'ok', or the SQLSTATE and message of the refusal.
create function pg_temp.dr_try(p_user uuid, p_sql text)
returns text
language plpgsql
as $try$
begin
  begin
    if p_user is null then
      perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
      set local role anon;
    else
      perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
      set local role authenticated;
    end if;
    execute p_sql;
    raise exception 'dryrun: statement went through' using errcode = 'P0D02';
  exception
    when sqlstate 'P0D02' then
      return 'ok';
    when others then
      return sqlstate || ' ' || sqlerrm;
  end;
end
$try$;

-- Runs one query returning a number as a person, in its own sub-transaction,
-- always rolled back (an UPDATE ... RETURNING counted here leaves nothing behind).
-- Returns -1 when the query itself fails.
create function pg_temp.dr_count(p_user uuid, p_sql text)
returns bigint
language plpgsql
as $cnt$
declare
  v bigint := -1;
begin
  begin
    if p_user is null then
      perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
      set local role anon;
    else
      perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
      set local role authenticated;
    end if;
    execute p_sql into v;
    raise exception 'dryrun: counted' using errcode = 'P0D02';
  exception
    when sqlstate 'P0D02' then
      return v;
    when others then
      return -1;
  end;
end
$cnt$;

create temp table _dr_report (n serial, line text) on commit drop;

create temp table _dr_before on commit drop as select * from pg_temp.dr_snapshot();
select set_config('smc_dryrun.before', 'yes', true);


-- ════════════════════════════════════════════════════════════════════════════
-- B. The shadow migration, verbatim: supabase/migrations/20261010200000_capabilities_shadow.sql
-- ════════════════════════════════════════════════════════════════════════════

-- Rights per company type, in SHADOW mode: the table, the functions and the
-- report. Nothing here changes what anyone can do today.
--
-- Victor's decisions: the table of 6-7 Oct 2026 and the answers of 9 Oct 2026
-- (memory "registration-harmonisation-decisions"; report "Droits par type
-- d'entreprise - qui gagne, qui perd - 9 octobre 2026"; spec regspec-en.md §9).
--
-- ════════════════════════════════════════════════════════════════════════════
-- The rule
-- ════════════════════════════════════════════════════════════════════════════
--  A verified person gets the rights of EVERY validated, typed company they belong
--  to (organization_members, owner or collaborator), plus the "participant" set.
--  A company counts only when organizations.access_status = 'verified' and
--  organization_type is set: a suspended, pending, rejected or untyped company
--  counts as no company. Verified M3 staff (admin, moderator) keep everything. A
--  person who is not verified (pending, rejected, payment_pending) gets the
--  "pending" set (empty today); a suspended person gets nothing.
--
--    type            publish  see opps   answer  message    propose  deal
--                    needs               needs   companies  webinar  flow
--    marina          yes      read-only  no      yes        yes      no
--    partner         no       yes        yes     yes        yes      no
--    investor        no       yes        yes     yes        yes      yes
--    developer       yes      yes        yes     yes        yes      no
--    media_partner   no       yes        yes     yes        yes      no
--    participant     no       no         no      no         yes      no
--    pending         -        -          -       -          -        -
--
--  "Answer needs" (express interest in an RFP or a consultation): every type that
--  sees needs except marinas (9 Oct). Webinar proposals: any person M3 verified
--  (9 Oct; the insert policy already says so since 20261009204234). The deal-flow
--  page follows the company type (report §7). Sponsor tiers give no right.
--
-- ════════════════════════════════════════════════════════════════════════════
-- What this migration adds (and nothing else)
-- ════════════════════════════════════════════════════════════════════════════
--  1. public.org_type_capability (org_type, capability), seeded with the table above
--     (23 rows). RLS: any signed-in person reads it; verified admins write it.
--  2. public.capability_set(p_user, p_org default null) returns text[]: the rule
--     above for one person (one company when p_org is given: then the person must
--     be a member of it and the participant set is not added). Internal: no
--     EXECUTE for anon or authenticated (it would tell anyone whether someone is
--     pending or suspended).
--  3. public.has_capability(p_cap, p_org default null) returns boolean, for the
--     caller (auth.uid()). STABLE, SECURITY DEFINER, search_path ''. Verified staff:
--     true for any capability. EXECUTE for anon too: a policy that applies to
--     "public" may call it for an anonymous reader, who simply gets false.
--  4. public.my_capabilities() returns jsonb, for the site:
--       {"person_status": "verified", "is_staff": false,
--        "companies": [{"id", "name", "type", "status", "caps": [...]}, ...],
--        "caps": [...]}
--  5. public.capability_shadow_report(): one row per non-staff person (ids only:
--     no name, no e-mail), their rights today and under the new rule, and what
--     they gain and lose. Staff only (or the service role / SQL console).
--     "Today" = what both live sites and the database allow on 10 Oct 2026:
--       publish_needs      verified, persona marina or developer, member of a
--                          verified company (the pages; the type is not read)
--       see_opportunities  verified, persona marina, partner, media_partner or
--                          developer, or an Individual with the partner_like
--                          entitlement (has_marketplace_access, rfps_select_developer)
--       answer_needs       verified, persona partner (the Express interest button)
--       message_companies  verified (partner_requests_insert_verified)
--       propose_webinar    verified (the database since 20261009204234; the new
--                          site's page from this release; the old site's page
--                          still asks for a validated company until it is replaced)
--       see_dealflow       verified, persona investor (oci_select_verified_investors)
--     Read-only run of the same rule on 10 Oct 2026: 128 verified people, 32 gain,
--     15 lose, 81 unchanged; nobody both gains and loses; the 21 pending or
--     rejected people do not change.
--  6. platform_settings.registration_flags.capabilities_enforced = false. The row
--     is created with every switch of spec §13 at false (the same row, label and
--     description as 20261009200000_registration_prereqs, which then finds it in
--     place) or, when it exists, only the missing key is added.
--
--  NO existing policy, function, trigger or row changes. Nothing reads the new
--  objects until the separate switch migration
--  (supabase/migrations/held/capabilities_enforce.sql) is applied and the flag is
--  on. Both sites keep working exactly as before.
--
-- When Phase 3 adds organizations.archived_at / duplicate_of: capability_set
-- already reads them (through to_jsonb, so this file does not depend on them); an
-- archived or duplicate company will count as no company.
--
-- Checks after applying (read-only):
--   select count(*) from public.org_type_capability;                         -> 23
--   select value -> 'capabilities_enforced' from public.platform_settings
--    where key = 'registration_flags';                                       -> false
--   select has_function_privilege('authenticated', 'public.capability_set(uuid, uuid)', 'execute');  -> false
--   select has_function_privilege('anon', 'public.has_capability(text, uuid)', 'execute');           -> true
--   select count(*), count(*) filter (where cardinality(gained) > 0), count(*) filter (where cardinality(lost) > 0)
--     from public.capability_shadow_report() where person_status = 'verified';
--
-- UNDO: supabase/migrations/down/20261010200000_capabilities_shadow.down.sql
-- Dry run: supabase/dryrun/20261010200000_capabilities_shadow.dryrun.sql

-- ─── 0. Precondition: the columns the rule reads are there ───────────────────
do $pre$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public'
         and ((table_name = 'organizations' and column_name in ('organization_type', 'access_status'))
           or (table_name = 'organization_members' and column_name in ('organization_id', 'user_id'))
           or (table_name = 'profiles' and column_name in ('user_id', 'persona', 'access_status')))) <> 7 then
    raise exception 'capabilities shadow: organizations / organization_members / profiles changed shape; re-read them before applying';
  end if;
  if exists (select 1 from public.platform_settings
              where key = 'registration_flags' and jsonb_typeof(value) <> 'object') then
    raise exception 'capabilities shadow: platform_settings.registration_flags is not a JSON object';
  end if;
end
$pre$;

-- ─── 1. The table ────────────────────────────────────────────────────────────
create table if not exists public.org_type_capability (
  org_type   text not null
    constraint org_type_capability_org_type_check
    check (org_type in ('marina', 'partner', 'investor', 'developer', 'media_partner', 'participant', 'pending')),
  capability text not null
    constraint org_type_capability_capability_check
    check (capability ~ '^[a-z][a-z_]{1,62}$'),
  created_at timestamptz not null default now(),
  primary key (org_type, capability)
);

comment on table public.org_type_capability is
  'Rights per company type (Victor, 6-9 Oct 2026). org_type is an organizations.organization_type, or participant (verified person with no validated typed company) or pending (person not verified). Read by capability_set / has_capability. Enforced only once supabase/migrations/held/capabilities_enforce.sql is applied. 2026-10-10.';

alter table public.org_type_capability enable row level security;

drop policy if exists org_type_capability_read on public.org_type_capability;
create policy org_type_capability_read on public.org_type_capability
  for select
  to authenticated
  using (true);

drop policy if exists org_type_capability_admin_write on public.org_type_capability;
create policy org_type_capability_admin_write on public.org_type_capability
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.org_type_capability from public, anon;
grant select, insert, update, delete on public.org_type_capability to authenticated;
grant all on public.org_type_capability to service_role;

-- ─── 2. The seed (the table of 6-7 Oct and the answers of 9 Oct) ─────────────
insert into public.org_type_capability (org_type, capability) values
  ('marina',        'publish_needs'),
  ('marina',        'see_opportunities'),
  ('marina',        'message_companies'),
  ('marina',        'propose_webinar'),
  ('partner',       'see_opportunities'),
  ('partner',       'answer_needs'),
  ('partner',       'message_companies'),
  ('partner',       'propose_webinar'),
  ('investor',      'see_opportunities'),
  ('investor',      'answer_needs'),
  ('investor',      'message_companies'),
  ('investor',      'propose_webinar'),
  ('investor',      'see_dealflow'),
  ('developer',     'publish_needs'),
  ('developer',     'see_opportunities'),
  ('developer',     'answer_needs'),
  ('developer',     'message_companies'),
  ('developer',     'propose_webinar'),
  ('media_partner', 'see_opportunities'),
  ('media_partner', 'answer_needs'),
  ('media_partner', 'message_companies'),
  ('media_partner', 'propose_webinar'),
  ('participant',   'propose_webinar')
on conflict (org_type, capability) do nothing;

-- ─── 3. capability_set: the rule, for one person ────────────────────────────
create or replace function public.capability_set(p_user uuid, p_org uuid default null)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_persona text;
  v_status  text;
  v_types   text[];
begin
  if p_user is null then
    return '{}'::text[];
  end if;

  select p.persona::text, p.access_status::text
    into v_persona, v_status
    from public.profiles p
   where p.user_id = p_user;
  if not found then
    return '{}'::text[];
  end if;

  -- 1. Verified M3 staff keep everything.
  if v_status = 'verified' and v_persona in ('admin', 'moderator') then
    return array(select distinct c.capability from public.org_type_capability c order by 1);
  end if;

  -- 2. A suspended person: nothing.
  if v_status = 'suspended' then
    return '{}'::text[];
  end if;

  -- 3. Not verified yet (pending, rejected, payment_pending): the 'pending' set.
  if v_status is distinct from 'verified' then
    return array(select c.capability from public.org_type_capability c where c.org_type = 'pending' order by 1);
  end if;

  -- 4. The types of the person's validated, typed companies (only p_org when given).
  --    A suspended, pending, rejected or untyped company counts as none, and so will an
  --    archived or duplicate one once Phase 3 adds those columns (read through to_jsonb
  --    so this function does not depend on them).
  select coalesce(array_agg(distinct o.organization_type), '{}'::text[])
    into v_types
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id
   where m.user_id = p_user
     and (p_org is null or o.id = p_org)
     and o.access_status = 'verified'
     and o.organization_type is not null
     and (to_jsonb(o) ->> 'archived_at') is null
     and (to_jsonb(o) ->> 'duplicate_of') is null;

  -- 5. For the person as a whole, the participant set comes on top.
  if p_org is null then
    v_types := v_types || 'participant'::text;
  end if;

  return array(
    select distinct c.capability
      from public.org_type_capability c
     where c.org_type = any (v_types)
     order by 1);
end
$function$;

comment on function public.capability_set(uuid, uuid) is
  'Rights of one person (p_org given: of that one company of theirs, without the participant set): staff everything, suspended nothing, not verified the pending set, else the participant set plus the org_type_capability rows of every validated (verified, typed, not archived, not duplicate) company they belong to. Internal (no EXECUTE for anon/authenticated). 2026-10-10.';

revoke all on function public.capability_set(uuid, uuid) from public, anon, authenticated;
grant execute on function public.capability_set(uuid, uuid) to service_role;

-- ─── 4. has_capability: the caller ───────────────────────────────────────────
create or replace function public.has_capability(p_cap text, p_org uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    public.is_moderator()
    or p_cap = any (public.capability_set(auth.uid(), p_org)),
    false);
$function$;

comment on function public.has_capability(text, uuid) is
  'Whether the caller has a capability (org_type_capability), for themselves or, with p_org, through that one company of theirs. Verified staff: always true. Anonymous: false. Used by the policies of supabase/migrations/held/capabilities_enforce.sql once applied. 2026-10-10.';

revoke all on function public.has_capability(text, uuid) from public;
grant execute on function public.has_capability(text, uuid) to anon, authenticated, service_role;

-- ─── 5. my_capabilities: what the site reads ─────────────────────────────────
create or replace function public.my_capabilities()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('person_status', null, 'is_staff', false, 'companies', '[]'::jsonb, 'caps', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'person_status', (select p.access_status::text from public.profiles p where p.user_id = v_uid),
    'is_staff', public.is_moderator(),
    'companies', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o.id,
               'name', o.name,
               'type', o.organization_type,
               'status', o.access_status,
               'caps', to_jsonb(public.capability_set(v_uid, o.id)))
             order by o.name, o.id)
        from public.organization_members m
        join public.organizations o on o.id = m.organization_id
       where m.user_id = v_uid), '[]'::jsonb),
    'caps', to_jsonb(public.capability_set(v_uid, null)));
end
$function$;

comment on function public.my_capabilities() is
  'The caller''s rights for the site: person_status, is_staff, companies [{id, name, type, status, caps}], caps (the person as a whole). 2026-10-10.';

revoke all on function public.my_capabilities() from public, anon;
grant execute on function public.my_capabilities() to authenticated, service_role;

-- ─── 6. capability_shadow_report: today versus the new rule ──────────────────
create or replace function public.capability_shadow_report()
returns table (
  user_id        uuid,
  person_status  text,
  persona        text,
  company_ids    uuid[],
  company_types  text[],
  current_caps   text[],
  new_caps       text[],
  gained         text[],
  lost           text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  -- Staff only. No JWT at all (SQL console, service role key) passes too.
  if coalesce(auth.role(), '') = 'anon'
     or (auth.uid() is not null and not public.is_moderator()) then
    raise exception 'Only the M3 team can read the rights report'
      using errcode = '42501';
  end if;

  return query
  with compared(cap, ord) as (
    values ('publish_needs', 1), ('see_opportunities', 2), ('answer_needs', 3),
           ('message_companies', 4), ('propose_webinar', 5), ('see_dealflow', 6)
  ),
  people as (
    select p.user_id as uid, p.persona::text as persona, p.access_status::text as status
      from public.profiles p
     where not (p.persona in ('admin', 'moderator') and p.access_status = 'verified')
  ),
  validated as (
    select m.user_id as uid,
           array_agg(o.id order by o.id) as ids,
           coalesce(array_agg(distinct o.organization_type) filter (where o.organization_type is not null), '{}'::text[]) as types
      from public.organization_members m
      join public.organizations o on o.id = m.organization_id
     where o.access_status = 'verified'
     group by m.user_id
  ),
  rows_ as (
    select pe.uid, pe.persona, pe.status,
           coalesce(v.ids, '{}'::uuid[]) as ids,
           coalesce(v.types, '{}'::text[]) as types,
           array_remove(array[
             case when pe.status = 'verified' and pe.persona in ('marina', 'developer') and v.uid is not null
                  then 'publish_needs' end,
             case when pe.status = 'verified'
                   and (pe.persona in ('marina', 'partner', 'media_partner', 'developer')
                        or (pe.persona = 'individual'
                            and exists (select 1 from public.entitlements e
                                         where e.user_id = pe.uid and e.feature_key = 'partner_like' and e.enabled)))
                  then 'see_opportunities' end,
             case when pe.status = 'verified' and pe.persona = 'partner' then 'answer_needs' end,
             case when pe.status = 'verified' then 'message_companies' end,
             case when pe.status = 'verified' then 'propose_webinar' end,
             case when pe.status = 'verified' and pe.persona = 'investor' then 'see_dealflow' end
           ], null) as cur,
           public.capability_set(pe.uid, null) as nxt
      from people pe
      left join validated v on v.uid = pe.uid
  )
  select r.uid, r.status, r.persona, r.ids, r.types,
         array(select c.cap from compared c where c.cap = any (r.cur) order by c.ord),
         array(select c.cap from compared c where c.cap = any (r.nxt) order by c.ord),
         array(select c.cap from compared c where c.cap = any (r.nxt) and not c.cap = any (r.cur) order by c.ord),
         array(select c.cap from compared c where c.cap = any (r.cur) and not c.cap = any (r.nxt) order by c.ord)
    from rows_ r
   order by r.uid;
end
$function$;

comment on function public.capability_shadow_report() is
  'Rights today (both live sites and the database, 10 Oct 2026) versus the company-type rule, per non-staff person: ids, statuses and capability lists only. Staff only. 2026-10-10.';

revoke all on function public.capability_shadow_report() from public, anon;
grant execute on function public.capability_shadow_report() to authenticated, service_role;

-- ─── 7. The switch, off ──────────────────────────────────────────────────────
insert into public.platform_settings (key, value, label, description)
values (
  'registration_flags',
  jsonb_build_object(
    'webinar_v2', false, 'onsite_v2', false, 'front_door', false, 'account_signup_v2', false,
    'password_only_login', false, 'wys_form_v2', false, 'wys_status_edit', false,
    'review_queue', false, 'provisioning', false, 'capabilities_enforced', false, 'turnstile', false),
  'Registration switches',
  'Unified registration rollout switches (spec section 13). Read by the site and the registration edge functions. All off = the current behaviour.')
on conflict (key) do update
  set value = jsonb_build_object('capabilities_enforced', false) || public.platform_settings.value
  where not (public.platform_settings.value ? 'capabilities_enforced');

create temp table _dr_mid on commit drop as select * from pg_temp.dr_snapshot();


-- ════════════════════════════════════════════════════════════════════════════
-- C. The switch, verbatim: supabase/migrations/held/capabilities_enforce.sql
-- ════════════════════════════════════════════════════════════════════════════

-- HELD FOR THE SWITCH. Do not apply with the other migrations, and keep this file
-- out of supabase/migrations/ (where `supabase db push` would pick it up) until
-- Victor has signed off the shadow report and chosen the date. On the day: give
-- it a timestamp (YYYYMMDDHHMMSS_capabilities_enforce.sql), move it to
-- supabase/migrations/, run its dry run (supabase/dryrun/capabilities_enforce.dryrun.sql),
-- then apply it.
--
-- Rights per company type, ENFORCED: the database applies the rule of
-- 20261010200000_capabilities_shadow.sql (which must be applied first), and the
-- site's switch registration_flags.capabilities_enforced turns on in the same
-- transaction, so the screens and the database change together.
--
-- ════════════════════════════════════════════════════════════════════════════
-- What changes (each policy is rewritten explicitly; nothing is blanket-wrapped)
-- ════════════════════════════════════════════════════════════════════════════
--  rfps, consultations (the same four policies each)
--    *_select_marketplace     staff, the author, or has_capability('see_opportunities')
--                             (was: has_marketplace_access(), i.e. persona marina,
--                             partner, media_partner, or Individual + partner_like)
--    *_select_developer       dropped (developers see through their company type)
--    *_write_owner, *_write_owner_developer (FOR ALL, persona marina / developer)
--                             replaced by three policies:
--      *_insert_publisher     the author is the caller, organization_id is set, and
--                             has_capability('publish_needs', organization_id): the
--                             PUBLISHING company must be a validated marina or
--                             developer of theirs (not the persona, not "any company")
--      *_update_owner         the author, while they can publish; the row stays
--                             attached to a company that lets them publish
--      *_delete_owner         the author, while verified (they can always withdraw)
--  marina_projects
--    marina_projects_insert   the author is the caller, organization_id is set, and
--                             has_capability('publish_needs', organization_id)
--                             (was: any signed-in user; only the page checked)
--    select / update / delete unchanged (projects stay visible to their author and M3)
--  partner_requests
--    partner_requests_insert_verified (any verified person) becomes
--    partner_requests_insert_capable, by origin:
--      'message'  (Send a message, company page)  has_capability('message_companies',
--                 partner_organization_id): the sending company must give that right
--      'interest' (Express interest, Opportunities) has_capability('answer_needs')
--      null       (old site: connection requests, Express interest, Deal flow)
--                 has_capability('message_companies')
--    The check constraint now accepts origin 'interest' (the new site sends it for
--    Express interest once the switch is on). Its triggers treat it like null.
--  webinar_requests
--    webinar_requests_insert_owner_eligible: has_capability('propose_webinar')
--    (every verified person has it through the participant set: same people as today)
--  org_capital_intents
--    oci_select_verified_investors (persona investor) becomes oci_select_dealflow:
--    has_capability('see_dealflow') (members of a validated investor company, and staff)
--  platform_settings.registration_flags.capabilities_enforced := true
--
-- NOT changed, on purpose:
--  * has_marketplace_access() and is_partner_like() keep their persona rule. They
--    still serve can_access_resource() (resources and events with access level
--    'members' or anything not public/marina) and partners_select_directory (the
--    legacy partners table). Moving those is a separate decision (they reach people
--    the rights table does not talk about).
--  * Reading company pages, teams and marina details; events; resources.
--  * Receiving messages and requests: the table limits who SENDS, not who receives.
--  * Conversations already open: conversation_messages keeps its own rules.
--
-- Old site (main), if it is still live on the day: its buttons follow the persona.
-- A member the rule refuses gets a database refusal instead of a hidden button:
-- the 4 "Prestataire" persons without a validated company (Express interest), the
-- 15 persons without a validated company (Request to connect), people whose
-- active company cannot publish (Submit an RFP / consultation / project).
-- Apply this switch only once the refonte is the live site.
--
-- UNDO: supabase/migrations/down/capabilities_enforce.down.sql (restores every
-- policy byte for byte, the check constraint, and the flag; 'interest' rows go
-- back to origin null).
-- Dry run: supabase/dryrun/capabilities_enforce.dryrun.sql (applies the shadow
-- migration AND this file in one transaction, tests every row of the table, then
-- the down script).

-- ─── 0. Preconditions ────────────────────────────────────────────────────────
do $pre$
declare
  v_fp text;
begin
  -- a. The shadow migration is applied.
  if to_regclass('public.org_type_capability') is null
     or to_regprocedure('public.has_capability(text, uuid)') is null
     or not exists (select 1 from public.org_type_capability) then
    raise exception 'capabilities switch: apply 20261010200000_capabilities_shadow.sql first';
  end if;
  if not exists (select 1 from public.platform_settings
                  where key = 'registration_flags' and jsonb_typeof(value) = 'object') then
    raise exception 'capabilities switch: platform_settings.registration_flags is missing';
  end if;

  -- b. The twelve policies replaced here are still the ones reviewed on 10 Oct 2026.
  select md5(string_agg(format('%s.%s|%s|%s|%s|%s|%s', tablename, policyname, permissive, cmd, roles,
                               coalesce(qual, ''), coalesce(with_check, '')), ';' order by tablename, policyname))
    into v_fp
    from pg_policies
   where schemaname = 'public'
     and (tablename, policyname) in (
       ('rfps', 'rfps_select_developer'), ('rfps', 'rfps_select_marketplace'),
       ('rfps', 'rfps_write_owner'), ('rfps', 'rfps_write_owner_developer'),
       ('consultations', 'consultations_select_developer'), ('consultations', 'consultations_select_marketplace'),
       ('consultations', 'consultations_write_owner'), ('consultations', 'consultations_write_owner_developer'),
       ('marina_projects', 'marina_projects_insert'),
       ('partner_requests', 'partner_requests_insert_verified'),
       ('webinar_requests', 'webinar_requests_insert_owner_eligible'),
       ('org_capital_intents', 'oci_select_verified_investors'));
  if v_fp is distinct from '346cf3dfbde3b3b4da4f6dc04f7e3b84' then
    raise exception 'capabilities switch: the policies to replace changed since 10 Oct 2026 (fingerprint %); re-read them and rebuild this file and its down script', v_fp;
  end if;

  -- c. The origin rule is the one of 20261009190000_company_messaging.
  if (select pg_get_constraintdef(c.oid) from pg_constraint c
       where c.conrelid = 'public.partner_requests'::regclass and c.conname = 'partner_requests_origin_check')
     is distinct from 'CHECK (((origin IS NULL) OR (origin = ''message''::text)))' then
    raise exception 'capabilities switch: partner_requests_origin_check changed; re-read it';
  end if;
end
$pre$;

-- ─── 1. partner_requests.origin: 'interest' ──────────────────────────────────
alter table public.partner_requests drop constraint partner_requests_origin_check;
alter table public.partner_requests
  add constraint partner_requests_origin_check
  check (origin is null or origin in ('message', 'interest'));

-- ─── 2. rfps ─────────────────────────────────────────────────────────────────
drop policy if exists rfps_select_developer on public.rfps;
drop policy if exists rfps_write_owner on public.rfps;
drop policy if exists rfps_write_owner_developer on public.rfps;
drop policy if exists rfps_select_marketplace on public.rfps;

create policy rfps_select_marketplace on public.rfps
  for select
  to authenticated
  using (
    public.is_moderator()
    or marina_user_id = (select auth.uid())
    or (select public.has_capability('see_opportunities'))
  );

create policy rfps_insert_publisher on public.rfps
  for insert
  to authenticated
  with check (
    marina_user_id = (select auth.uid())
    and organization_id is not null
    and public.has_capability('publish_needs', organization_id)
  );

create policy rfps_update_owner on public.rfps
  for update
  to authenticated
  using (
    marina_user_id = (select auth.uid())
    and (select public.has_capability('publish_needs'))
  )
  with check (
    marina_user_id = (select auth.uid())
    and organization_id is not null
    and public.has_capability('publish_needs', organization_id)
  );

create policy rfps_delete_owner on public.rfps
  for delete
  to authenticated
  using (
    marina_user_id = (select auth.uid())
    and (select public.is_verified(null::public.persona_enum))
  );

-- ─── 3. consultations ────────────────────────────────────────────────────────
drop policy if exists consultations_select_developer on public.consultations;
drop policy if exists consultations_write_owner on public.consultations;
drop policy if exists consultations_write_owner_developer on public.consultations;
drop policy if exists consultations_select_marketplace on public.consultations;

create policy consultations_select_marketplace on public.consultations
  for select
  to authenticated
  using (
    public.is_moderator()
    or marina_user_id = (select auth.uid())
    or (select public.has_capability('see_opportunities'))
  );

create policy consultations_insert_publisher on public.consultations
  for insert
  to authenticated
  with check (
    marina_user_id = (select auth.uid())
    and organization_id is not null
    and public.has_capability('publish_needs', organization_id)
  );

create policy consultations_update_owner on public.consultations
  for update
  to authenticated
  using (
    marina_user_id = (select auth.uid())
    and (select public.has_capability('publish_needs'))
  )
  with check (
    marina_user_id = (select auth.uid())
    and organization_id is not null
    and public.has_capability('publish_needs', organization_id)
  );

create policy consultations_delete_owner on public.consultations
  for delete
  to authenticated
  using (
    marina_user_id = (select auth.uid())
    and (select public.is_verified(null::public.persona_enum))
  );

-- ─── 4. marina_projects ──────────────────────────────────────────────────────
drop policy if exists marina_projects_insert on public.marina_projects;

create policy marina_projects_insert on public.marina_projects
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and organization_id is not null
    and public.has_capability('publish_needs', organization_id)
  );

-- ─── 5. partner_requests ─────────────────────────────────────────────────────
drop policy if exists partner_requests_insert_verified on public.partner_requests;

-- Runs after the BEFORE INSERT triggers: partner_organization_id is already the
-- sender's own company (partner_request_user_org), never one they are not in.
create policy partner_requests_insert_capable on public.partner_requests
  for insert
  to authenticated
  with check (
    (partner_user_id = (select auth.uid()) or marina_user_id = (select auth.uid()))
    and case origin
          when 'message'  then public.has_capability('message_companies', partner_organization_id)
          when 'interest' then (select public.has_capability('answer_needs'))
          else (select public.has_capability('message_companies'))
        end
  );

-- ─── 6. webinar_requests ─────────────────────────────────────────────────────
drop policy if exists webinar_requests_insert_owner_eligible on public.webinar_requests;

create policy webinar_requests_insert_owner_eligible on public.webinar_requests
  for insert
  to public
  with check (
    (user_id = (select auth.uid()) and (select public.has_capability('propose_webinar')))
    or public.is_moderator()
  );

-- ─── 7. org_capital_intents (Deal flow) ──────────────────────────────────────
drop policy if exists oci_select_verified_investors on public.org_capital_intents;

create policy oci_select_dealflow on public.org_capital_intents
  for select
  to public
  using ((select public.has_capability('see_dealflow')));

-- ─── 8. The site follows ─────────────────────────────────────────────────────
update public.platform_settings
   set value = jsonb_set(value, '{capabilities_enforced}', 'true'::jsonb, true),
       updated_at = now()
 where key = 'registration_flags';

-- ─── 9. Postcondition ────────────────────────────────────────────────────────
do $post$
begin
  if (select count(*) from pg_policies
       where schemaname = 'public'
         and (coalesce(qual, '') like '%has_capability%' or coalesce(with_check, '') like '%has_capability%')) <> 10 then
    raise exception 'capabilities switch: expected 10 policies calling has_capability';
  end if;
  if (select value -> 'capabilities_enforced' from public.platform_settings where key = 'registration_flags')
     is distinct from 'true'::jsonb then
    raise exception 'capabilities switch: the flag did not turn on';
  end if;
end
$post$;

-- ════════════════════════════════════════════════════════════════════════════
-- D. Checks of the switch: every row of the table, against the real policies
-- ════════════════════════════════════════════════════════════════════════════

-- 'ok' -> Y, a refusal (42501: RLS or the messaging trigger's "company not
-- validated") -> N, anything else -> E (unexpected).
create function pg_temp.dr_class(p_res text)
returns text
language sql
as $cls$
  select case when p_res = 'ok' then 'Y' when p_res like '42501%' then 'N' else 'E' end
$cls$;

-- The twelve things a person may or may not do, tried one by one (each rolled
-- back on its own, so no attempt changes the next), compared with p_exp
-- (12 characters, Y / N, '-' = not checked).
create function pg_temp.dr_matrix(p_label text, p_user uuid, p_q uuid, p_ot uuid, p_om uuid,
                                  p_rfp uuid, p_consult uuid, p_own uuid, p_exp text)
returns text
language plpgsql
as $mx$
declare
  names constant text[] := array[
    'sees an RFP', 'sees a consultation', 'publishes an RFP', 'publishes a consultation',
    'submits a project', 'expresses interest (origin interest)', 'sends a first message (origin message)',
    'sends an old-site request (origin null)', 'proposes a webinar', 'reads the deal flow',
    'edits their own RFP', 'deletes their own RFP'];
  got text[] := array[]::text[];
  raw text[] := array[]::text[];
  res text;
  n bigint;
  i int;
  want text;
  bad text := '';
begin
  -- 1-2 what they see
  n := pg_temp.dr_count(p_user, format('select count(*) from public.rfps where id = %L', p_rfp));
  got := got || case when n = 1 then 'Y' when n = 0 then 'N' else 'E' end; raw := raw || n::text;
  n := pg_temp.dr_count(p_user, format('select count(*) from public.consultations where id = %L', p_consult));
  got := got || case when n = 1 then 'Y' when n = 0 then 'N' else 'E' end; raw := raw || n::text;
  -- 3-5 what they publish (through p_ot, their company in the scenario)
  res := pg_temp.dr_try(p_user, format(
    'insert into public.rfps (marina_user_id, title, scope, organization_id) values (%L, %L, %L, %L)',
    p_user, 'DRYRUN capabilities', 'DRYRUN', p_ot));
  got := got || pg_temp.dr_class(res); raw := raw || res;
  res := pg_temp.dr_try(p_user, format(
    'insert into public.consultations (marina_user_id, title, description, organization_id) values (%L, %L, %L, %L)',
    p_user, 'DRYRUN capabilities', 'DRYRUN', p_ot));
  got := got || pg_temp.dr_class(res); raw := raw || res;
  res := pg_temp.dr_try(p_user, format(
    'insert into public.marina_projects (user_id, description, organization_id) values (%L, %L, %L)',
    p_user, 'DRYRUN capabilities', p_ot));
  got := got || pg_temp.dr_class(res); raw := raw || res;
  -- 6-8 what they send to the publishing company
  res := pg_temp.dr_try(p_user, format(
    'insert into public.partner_requests (partner_user_id, marina_user_id, partner_organization_id, marina_organization_id, message, status, origin) values (%L, %L, %L, %L, %L, %L, %L)',
    p_user, p_q, p_ot, p_om, 'DRYRUN capabilities', 'pending', 'interest'));
  got := got || pg_temp.dr_class(res); raw := raw || res;
  res := pg_temp.dr_try(p_user, format(
    'insert into public.partner_requests (partner_user_id, marina_user_id, partner_organization_id, marina_organization_id, message, status, origin) values (%L, %L, %L, %L, %L, %L, %L)',
    p_user, p_q, p_ot, p_om, 'DRYRUN capabilities', 'pending', 'message'));
  got := got || pg_temp.dr_class(res); raw := raw || res;
  res := pg_temp.dr_try(p_user, format(
    'insert into public.partner_requests (partner_user_id, marina_user_id, partner_organization_id, marina_organization_id, message, status) values (%L, %L, %L, %L, %L, %L)',
    p_user, p_q, p_ot, p_om, 'DRYRUN capabilities', 'pending'));
  got := got || pg_temp.dr_class(res); raw := raw || res;
  -- 9 webinar
  res := pg_temp.dr_try(p_user, format(
    'insert into public.webinar_requests (user_id, title, description) values (%L, %L, %L)',
    p_user, 'DRYRUN capabilities', 'DRYRUN'));
  got := got || pg_temp.dr_class(res); raw := raw || res;
  -- 10 deal flow (their scenario company has no capital intent: any row seen comes from the right)
  n := pg_temp.dr_count(p_user, 'select count(*) from public.org_capital_intents');
  got := got || case when n > 0 then 'Y' when n = 0 then 'N' else 'E' end; raw := raw || n::text;
  -- 11-12 their own RFP (filed as postgres under p_ot)
  n := pg_temp.dr_count(p_user, format(
    'with u as (update public.rfps set title = %L where id = %L returning 1) select count(*) from u', 'DRYRUN edited', p_own));
  got := got || case when n = 1 then 'Y' when n = 0 then 'N' else 'E' end; raw := raw || n::text;
  n := pg_temp.dr_count(p_user, format(
    'with d as (delete from public.rfps where id = %L returning 1) select count(*) from d', p_own));
  got := got || case when n = 1 then 'Y' when n = 0 then 'N' else 'E' end; raw := raw || n::text;

  for i in 1 .. 12 loop
    want := substr(p_exp, i, 1);
    if want <> '-' and got[i] is distinct from want then
      bad := bad || case when bad = '' then '' else '; ' end
             || names[i] || ': expected ' || want || ', got ' || coalesce(got[i], '?') || ' (' || left(coalesce(raw[i], ''), 120) || ')';
    end if;
  end loop;

  return pg_temp.dr_line(bad = '', p_label || '  ' || array_to_string(got, ''), nullif(bad, ''));
end
$mx$;

-- One row of the table: P belongs to one company of p_type (or none) with
-- p_org_status, Q to a validated marina that published an RFP and a consultation.
-- Called inside a block that is always rolled back.
create function pg_temp.dr_scenario(p_label text, p_user uuid, p_q uuid, p_type text, p_org_status text,
                                    p_person_status text, p_exp text)
returns text
language plpgsql
as $scn$
declare
  v_om uuid;
  v_ot uuid;
  v_rfp uuid;
  v_consult uuid;
  v_own uuid;
begin
  perform pg_temp.dr_solo(p_user);
  perform pg_temp.dr_solo(p_q);
  v_om := pg_temp.dr_org('marina', 'verified');
  perform pg_temp.dr_join(v_om, p_q);
  insert into public.rfps (marina_user_id, title, scope, organization_id)
  values (p_q, 'DRYRUN capabilities', 'DRYRUN', v_om) returning id into v_rfp;
  insert into public.consultations (marina_user_id, title, description, organization_id)
  values (p_q, 'DRYRUN capabilities', 'DRYRUN', v_om) returning id into v_consult;

  if p_type is distinct from 'none' then
    v_ot := pg_temp.dr_org(nullif(p_type, 'untyped'), p_org_status);
    perform pg_temp.dr_join(v_ot, p_user);
  end if;
  if p_person_status is not null then
    update public.profiles set access_status = p_person_status::public.access_status_enum where user_id = p_user;
  end if;
  insert into public.rfps (marina_user_id, title, scope, organization_id)
  values (p_user, 'DRYRUN own', 'DRYRUN', v_ot) returning id into v_own;

  return pg_temp.dr_matrix(p_label, p_user, p_q, v_ot, v_om, v_rfp, v_consult, v_own, p_exp);
end
$scn$;

do $tests$
declare
  nl constant text := chr(10);
  r text := '';
  v_p uuid;
  v_q uuid;
  v_a uuid;
  v_n bigint;
  v_n2 bigint;
  v_t text;
  v_t2 text;
  v_b boolean;
  v_df text;           -- deal flow column: '-' when the table is empty (nothing to see)
  v_om uuid;
  v_ot uuid;
  v_ot2 uuid;
  v_res text[];
  v_id uuid;
begin
  select p.user_id into v_p from public.profiles p
   where p.access_status = 'verified' and p.persona not in ('admin', 'moderator')
   order by p.user_id limit 1;
  select p.user_id into v_q from public.profiles p
   where p.access_status = 'verified' and p.persona not in ('admin', 'moderator') and p.user_id <> v_p
   order by p.user_id limit 1;
  select p.user_id into v_a from public.profiles p
   where p.access_status = 'verified' and p.persona = 'admin'
   order by p.user_id limit 1;
  if v_p is null or v_q is null or v_a is null then
    raise exception 'dryrun: not enough verified people to test with';
  end if;

  -- T00 one transaction
  r := pg_temp.dr_line(current_setting('smc_dryrun.before', true) = 'yes', 'T00 before-snapshot present (one transaction)');

  -- T01 exactly the expected policies were dropped, added and rewritten; nothing else moved
  select string_agg(x.k, ',' order by x.k collate "C") into v_t from (
    select m.k from _dr_mid m where m.k like 'policy %'
    except
    select s.k from pg_temp.dr_snapshot() s where s.k like 'policy %') x;
  r := r || nl || pg_temp.dr_line(v_t = 'policy consultations.consultations_select_developer,policy consultations.consultations_write_owner,policy consultations.consultations_write_owner_developer,policy org_capital_intents.oci_select_verified_investors,policy partner_requests.partner_requests_insert_verified,policy rfps.rfps_select_developer,policy rfps.rfps_write_owner,policy rfps.rfps_write_owner_developer',
         'T01 the 8 persona policies are gone', v_t);
  select string_agg(x.k, ',' order by x.k collate "C") into v_t from (
    select s.k from pg_temp.dr_snapshot() s where s.k like 'policy %'
    except
    select m.k from _dr_mid m where m.k like 'policy %') x;
  r := r || nl || pg_temp.dr_line(v_t = 'policy consultations.consultations_delete_owner,policy consultations.consultations_insert_publisher,policy consultations.consultations_update_owner,policy org_capital_intents.oci_select_dealflow,policy partner_requests.partner_requests_insert_capable,policy rfps.rfps_delete_owner,policy rfps.rfps_insert_publisher,policy rfps.rfps_update_owner',
         'T01 the 8 capability policies are there', v_t);
  select string_agg(x.k, ',' order by x.k collate "C") into v_t from (
    select s.k, s.v from pg_temp.dr_snapshot() s where s.k <> 'flags'
    except
    select m.k, m.v from _dr_mid m where m.k <> 'flags') x
   where x.k in (select m.k from _dr_mid m);
  r := r || nl || pg_temp.dr_line(v_t = 'constraint partner_requests.partner_requests_origin_check,policy consultations.consultations_select_marketplace,policy marina_projects.marina_projects_insert,policy rfps.rfps_select_marketplace,policy webinar_requests.webinar_requests_insert_owner_eligible',
         'T01 rewritten in place: the two marketplace reads, the project insert, the webinar insert, the origin rule; nothing else changed', v_t);

  -- T02 what stays on the persona rule, on purpose
  select count(*) into v_n from (
    select m.k, m.v from _dr_mid m
     where m.k in ('function has_marketplace_access()', 'function is_partner_like()', 'function can_access_resource(text)',
                   'policy partners.partners_select_directory')
    intersect
    select s.k, s.v from pg_temp.dr_snapshot() s) x;
  r := r || nl || pg_temp.dr_line(v_n = 4, 'T02 has_marketplace_access, is_partner_like, can_access_resource and the partners directory policy are untouched', v_n || ' of 4');

  -- T03 origin 'interest' accepted; the site's switch is on
  select pg_get_constraintdef(c.oid) into v_t from pg_constraint c
   where c.conrelid = 'public.partner_requests'::regclass and c.conname = 'partner_requests_origin_check';
  r := r || nl || pg_temp.dr_line(v_t = 'CHECK (((origin IS NULL) OR (origin = ANY (ARRAY[''message''::text, ''interest''::text]))))',
         'T03 partner_requests.origin accepts null, message and interest', v_t);
  select ps.value ->> 'capabilities_enforced' into v_t from public.platform_settings ps where ps.key = 'registration_flags';
  r := r || nl || pg_temp.dr_line(v_t = 'true', 'T03 registration_flags.capabilities_enforced is true', v_t);

  -- The deal-flow column can only be checked when there is something to see.
  select count(*) into v_n from public.org_capital_intents;
  v_df := case when v_n > 0 then '' else '-' end;
  if v_n = 0 then
    r := r || nl || 'INFO org_capital_intents is empty: the deal-flow column is not checked';
  end if;

  -- ── Every row of the table. Columns: see RFP, see consultation, publish RFP,
  --    publish consultation, submit project, express interest, first message,
  --    old-site request, webinar, deal flow, edit own RFP, delete own RFP. ──
  begin
    r := r || nl || pg_temp.dr_scenario('M01 marina', v_p, v_q, 'marina', 'verified', null,
                                        'YYYYYNYYY' || coalesce(nullif(v_df, ''), 'N') || 'YY');
    raise exception 'dryrun: scenario rolled back' using errcode = 'P0D01';
  exception
    when sqlstate 'P0D01' then null;
    when others then r := r || nl || 'FAIL M01 marina: ' || sqlstate || ' ' || sqlerrm;
  end;
  begin
    r := r || nl || pg_temp.dr_scenario('M02 service provider', v_p, v_q, 'partner', 'verified', null,
                                        'YYNNNYYYY' || coalesce(nullif(v_df, ''), 'N') || 'NY');
    raise exception 'dryrun: scenario rolled back' using errcode = 'P0D01';
  exception
    when sqlstate 'P0D01' then null;
    when others then r := r || nl || 'FAIL M02 service provider: ' || sqlstate || ' ' || sqlerrm;
  end;
  begin
    r := r || nl || pg_temp.dr_scenario('M03 investor', v_p, v_q, 'investor', 'verified', null,
                                        'YYNNNYYYY' || coalesce(nullif(v_df, ''), 'Y') || 'NY');
    raise exception 'dryrun: scenario rolled back' using errcode = 'P0D01';
  exception
    when sqlstate 'P0D01' then null;
    when others then r := r || nl || 'FAIL M03 investor: ' || sqlstate || ' ' || sqlerrm;
  end;
  begin
    r := r || nl || pg_temp.dr_scenario('M04 developer', v_p, v_q, 'developer', 'verified', null,
                                        'YYYYYYYYY' || coalesce(nullif(v_df, ''), 'N') || 'YY');
    raise exception 'dryrun: scenario rolled back' using errcode = 'P0D01';
  exception
    when sqlstate 'P0D01' then null;
    when others then r := r || nl || 'FAIL M04 developer: ' || sqlstate || ' ' || sqlerrm;
  end;
  begin
    r := r || nl || pg_temp.dr_scenario('M05 media', v_p, v_q, 'media_partner', 'verified', null,
                                        'YYNNNYYYY' || coalesce(nullif(v_df, ''), 'N') || 'NY');
    raise exception 'dryrun: scenario rolled back' using errcode = 'P0D01';
  exception
    when sqlstate 'P0D01' then null;
    when others then r := r || nl || 'FAIL M05 media: ' || sqlstate || ' ' || sqlerrm;
  end;
  begin
    r := r || nl || pg_temp.dr_scenario('M06 participant (verified, no company)', v_p, v_q, 'none', null, null,
                                        'NNNNNNNNY' || coalesce(nullif(v_df, ''), 'N') || 'NY');
    raise exception 'dryrun: scenario rolled back' using errcode = 'P0D01';
  exception
    when sqlstate 'P0D01' then null;
    when others then r := r || nl || 'FAIL M06 participant: ' || sqlstate || ' ' || sqlerrm;
  end;
  begin
    r := r || nl || pg_temp.dr_scenario('M07 validated company without a type', v_p, v_q, 'untyped', 'verified', null,
                                        'NNNNNNNNY' || coalesce(nullif(v_df, ''), 'N') || 'NY');
    raise exception 'dryrun: scenario rolled back' using errcode = 'P0D01';
  exception
    when sqlstate 'P0D01' then null;
    when others then r := r || nl || 'FAIL M07 untyped company: ' || sqlstate || ' ' || sqlerrm;
  end;
  begin
    r := r || nl || pg_temp.dr_scenario('M08 suspended marina company', v_p, v_q, 'marina', 'suspended', null,
                                        'NNNNNNNNY' || coalesce(nullif(v_df, ''), 'N') || 'NY');
    raise exception 'dryrun: scenario rolled back' using errcode = 'P0D01';
  exception
    when sqlstate 'P0D01' then null;
    when others then r := r || nl || 'FAIL M08 suspended company: ' || sqlstate || ' ' || sqlerrm;
  end;
  begin
    r := r || nl || pg_temp.dr_scenario('M09 person pending review, in a validated marina', v_p, v_q, 'marina', 'verified', 'pending',
                                        'NNNNNNNNN' || coalesce(nullif(v_df, ''), 'N') || 'NN');
    raise exception 'dryrun: scenario rolled back' using errcode = 'P0D01';
  exception
    when sqlstate 'P0D01' then null;
    when others then r := r || nl || 'FAIL M09 pending person: ' || sqlstate || ' ' || sqlerrm;
  end;
  begin
    r := r || nl || pg_temp.dr_scenario('M10 M3 staff (admin, in a service provider)', v_a, v_q, 'partner', 'verified', null,
                                        'YYYYYYYYY' || coalesce(nullif(v_df, ''), 'Y') || 'YY');
    raise exception 'dryrun: scenario rolled back' using errcode = 'P0D01';
  exception
    when sqlstate 'P0D01' then null;
    when others then r := r || nl || 'FAIL M10 staff: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- M11 two companies (a marina and a service provider): publishing goes through the
  --     company that may publish; a need cannot be filed under someone else's company
  begin
    perform pg_temp.dr_solo(v_p);
    perform pg_temp.dr_solo(v_q);
    v_om := pg_temp.dr_org('marina', 'verified');
    perform pg_temp.dr_join(v_om, v_q);
    v_ot := pg_temp.dr_org('marina', 'verified');
    v_ot2 := pg_temp.dr_org('partner', 'verified');
    perform pg_temp.dr_join(v_ot, v_p);
    perform pg_temp.dr_join(v_ot2, v_p);
    v_res := array[
      pg_temp.dr_try(v_p, format('insert into public.rfps (marina_user_id, title, scope, organization_id) values (%L, %L, %L, %L)', v_p, 'DRYRUN', 'DRYRUN', v_ot)),
      pg_temp.dr_try(v_p, format('insert into public.rfps (marina_user_id, title, scope, organization_id) values (%L, %L, %L, %L)', v_p, 'DRYRUN', 'DRYRUN', v_ot2)),
      pg_temp.dr_try(v_p, format('insert into public.rfps (marina_user_id, title, scope, organization_id) values (%L, %L, %L, %L)', v_p, 'DRYRUN', 'DRYRUN', v_om)),
      pg_temp.dr_try(v_p, format('insert into public.partner_requests (partner_user_id, marina_user_id, partner_organization_id, marina_organization_id, message, status, origin) values (%L, %L, %L, %L, %L, %L, %L)', v_p, v_q, v_ot, v_om, 'DRYRUN', 'pending', 'interest')),
      pg_temp.dr_try(v_p, format('insert into public.partner_requests (partner_user_id, marina_user_id, partner_organization_id, marina_organization_id, message, status, origin) values (%L, %L, %L, %L, %L, %L, %L)', v_p, v_q, v_ot2, v_om, 'DRYRUN', 'pending', 'message'))];
    r := r || nl || pg_temp.dr_line(
           v_res[1] = 'ok' and v_res[2] like '42501%' and v_res[3] like '42501%' and v_res[4] = 'ok' and v_res[5] = 'ok',
           'M11 marina + service provider: publishes through the marina only, never under a company they are not in; answers and writes',
           array_to_string(v_res, ' | '));
    raise exception 'dryrun: scenario rolled back' using errcode = 'P0D01';
  exception
    when sqlstate 'P0D01' then null;
    when others then r := r || nl || 'FAIL M11 two companies: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- M12 anonymous: reads nothing, sends nothing, and no error from has_capability
  begin
    v_n := pg_temp.dr_count(null, 'select count(*) from public.rfps');
    v_n2 := pg_temp.dr_count(null, 'select count(*) from public.org_capital_intents');
    v_t := pg_temp.dr_try(null, format('insert into public.webinar_requests (user_id, title, description) values (%L, %L, %L)', v_p, 'DRYRUN', 'DRYRUN'));
    r := r || nl || pg_temp.dr_line(v_n = 0 and v_n2 = 0 and v_t like '42501%',
           'M12 anonymous: no RFP, no capital intent (and no error), no webinar proposal', v_n || ' / ' || v_n2 || ' / ' || v_t);
  exception
    when others then r := r || nl || 'FAIL M12 anonymous: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- For the down script: one Express interest row (origin 'interest') between the two
  -- real people as they are. Kept until the end (the final RAISE rolls it back).
  insert into public.partner_requests (partner_user_id, marina_user_id, message, status, origin)
  values (v_p, v_q, 'DRYRUN capabilities: interest row for the down script', 'pending', 'interest')
  returning id into v_id;
  perform set_config('smc_dryrun.interest_id', v_id::text, true);

  insert into _dr_report (line) values (r);
end
$tests$;


-- ════════════════════════════════════════════════════════════════════════════
-- E. The switch's down script, verbatim: supabase/migrations/down/capabilities_enforce.down.sql
-- ════════════════════════════════════════════════════════════════════════════

-- UNDO of supabase/migrations/held/capabilities_enforce.sql (the switch).
--
-- Puts back, byte for byte, the twelve policies it replaced (as they were on
-- 10 Oct 2026), the partner_requests origin rule, and turns the site's switch
-- registration_flags.capabilities_enforced off. Rows written while the switch was
-- on stay; Express interest rows (origin 'interest') go back to origin null, which
-- is what they would have been without the switch. The shadow objects stay (undo
-- them with down/20261010200000_capabilities_shadow.down.sql if wanted).
-- Idempotent: safe to run twice.

-- ─── 1. partner_requests.origin ──────────────────────────────────────────────
update public.partner_requests set origin = null where origin = 'interest';

alter table public.partner_requests drop constraint if exists partner_requests_origin_check;
alter table public.partner_requests
  add constraint partner_requests_origin_check
  check (origin is null or origin = 'message');

-- ─── 2. rfps ─────────────────────────────────────────────────────────────────
drop policy if exists rfps_select_marketplace on public.rfps;
drop policy if exists rfps_insert_publisher on public.rfps;
drop policy if exists rfps_update_owner on public.rfps;
drop policy if exists rfps_delete_owner on public.rfps;
drop policy if exists rfps_select_developer on public.rfps;
drop policy if exists rfps_write_owner on public.rfps;
drop policy if exists rfps_write_owner_developer on public.rfps;

create policy rfps_select_developer on public.rfps
  as permissive for select to authenticated
  using ((select public.is_verified('developer'::public.persona_enum)));
create policy rfps_select_marketplace on public.rfps
  as permissive for select to authenticated
  using (public.is_moderator() or marina_user_id = (select auth.uid()) or public.has_marketplace_access());
create policy rfps_write_owner on public.rfps
  as permissive for all to authenticated
  using (marina_user_id = (select auth.uid()) and public.is_verified('marina'::public.persona_enum))
  with check (marina_user_id = (select auth.uid()) and public.is_verified('marina'::public.persona_enum));
create policy rfps_write_owner_developer on public.rfps
  as permissive for all to authenticated
  using (marina_user_id = (select auth.uid()) and public.is_verified('developer'::public.persona_enum))
  with check (marina_user_id = (select auth.uid()) and public.is_verified('developer'::public.persona_enum));

-- ─── 3. consultations ────────────────────────────────────────────────────────
drop policy if exists consultations_select_marketplace on public.consultations;
drop policy if exists consultations_insert_publisher on public.consultations;
drop policy if exists consultations_update_owner on public.consultations;
drop policy if exists consultations_delete_owner on public.consultations;
drop policy if exists consultations_select_developer on public.consultations;
drop policy if exists consultations_write_owner on public.consultations;
drop policy if exists consultations_write_owner_developer on public.consultations;

create policy consultations_select_developer on public.consultations
  as permissive for select to authenticated
  using ((select public.is_verified('developer'::public.persona_enum)));
create policy consultations_select_marketplace on public.consultations
  as permissive for select to authenticated
  using (public.is_moderator() or marina_user_id = (select auth.uid()) or public.has_marketplace_access());
create policy consultations_write_owner on public.consultations
  as permissive for all to authenticated
  using (marina_user_id = (select auth.uid()) and public.is_verified('marina'::public.persona_enum))
  with check (marina_user_id = (select auth.uid()) and public.is_verified('marina'::public.persona_enum));
create policy consultations_write_owner_developer on public.consultations
  as permissive for all to authenticated
  using (marina_user_id = (select auth.uid()) and public.is_verified('developer'::public.persona_enum))
  with check (marina_user_id = (select auth.uid()) and public.is_verified('developer'::public.persona_enum));

-- ─── 4. marina_projects ──────────────────────────────────────────────────────
drop policy if exists marina_projects_insert on public.marina_projects;
create policy marina_projects_insert on public.marina_projects
  as permissive for insert to authenticated
  with check (user_id = (select auth.uid()));

-- ─── 5. partner_requests ─────────────────────────────────────────────────────
drop policy if exists partner_requests_insert_capable on public.partner_requests;
drop policy if exists partner_requests_insert_verified on public.partner_requests;
create policy partner_requests_insert_verified on public.partner_requests
  as permissive for insert to authenticated
  with check (
    ((partner_user_id = (select auth.uid())) or (marina_user_id = (select auth.uid())))
    and exists (select 1 from public.profiles
                 where profiles.user_id = (select auth.uid())
                   and profiles.access_status = 'verified'::public.access_status_enum)
  );

-- ─── 6. webinar_requests ─────────────────────────────────────────────────────
drop policy if exists webinar_requests_insert_owner_eligible on public.webinar_requests;
create policy webinar_requests_insert_owner_eligible on public.webinar_requests
  as permissive for insert to public
  with check (
    ((user_id = (select auth.uid()))
      and exists (select 1 from public.profiles p
                   where p.user_id = (select auth.uid()) and p.access_status = 'verified'::public.access_status_enum))
    or public.is_moderator()
  );

-- ─── 7. org_capital_intents ──────────────────────────────────────────────────
drop policy if exists oci_select_dealflow on public.org_capital_intents;
drop policy if exists oci_select_verified_investors on public.org_capital_intents;
create policy oci_select_verified_investors on public.org_capital_intents
  as permissive for select to public
  using (exists (select 1 from public.profiles
                  where profiles.user_id = auth.uid()
                    and profiles.persona = 'investor'::public.persona_enum
                    and profiles.access_status = 'verified'::public.access_status_enum));

-- ─── 8. The site's switch, off ───────────────────────────────────────────────
update public.platform_settings
   set value = jsonb_set(value, '{capabilities_enforced}', 'false'::jsonb, true),
       updated_at = now()
 where key = 'registration_flags'
   and jsonb_typeof(value) = 'object';

-- ════════════════════════════════════════════════════════════════════════════
-- F. After the switch's down script: the report
-- ════════════════════════════════════════════════════════════════════════════
do $final$
declare
  nl constant text := chr(10);
  r text;
  v_n bigint;
  v_n2 bigint;
  v_t text;
  v_b boolean;
  v_pass int;
  v_fail int;
begin
  select string_agg(d.line, nl order by d.n) into r from _dr_report d;
  r := coalesce(r, 'FAIL the checks block left no report');

  -- E1 every policy, function, trigger, constraint and table as right after the
  --    shadow migration (the twelve policies byte for byte, the origin rule)
  select count(*), string_agg(x.k, ', ' order by x.k) into v_n, v_t from (
    select m.k, m.v from _dr_mid m where m.k <> 'flags'
    except
    select s.k, s.v from pg_temp.dr_snapshot() s where s.k <> 'flags') x;
  select count(*) into v_n2 from (
    select s.k, s.v from pg_temp.dr_snapshot() s where s.k <> 'flags'
    except
    select m.k, m.v from _dr_mid m where m.k <> 'flags') x;
  r := r || nl || pg_temp.dr_line(v_n = 0 and v_n2 = 0,
         'E1 down script: the twelve policies and the origin rule are back exactly; nothing else differs',
         v_n || ' missing or changed (' || coalesce(v_t, '-') || '), ' || v_n2 || ' extra');

  -- E2 the site's switch is off again
  select ps.value ->> 'capabilities_enforced' into v_t from public.platform_settings ps where ps.key = 'registration_flags';
  r := r || nl || pg_temp.dr_line(v_t = 'false', 'E2 down script: registration_flags.capabilities_enforced is false', v_t);

  -- E3 the Express interest row went back to origin null
  select count(*) into v_n from public.partner_requests pr
   where pr.id = nullif(current_setting('smc_dryrun.interest_id', true), '')::uuid and pr.origin is null;
  r := r || nl || pg_temp.dr_line(v_n = 1, 'E3 down script: an origin ''interest'' row is kept, with origin null', v_n::text);

  -- E4 the shadow objects are still there (only the switch was undone)
  v_b := to_regclass('public.org_type_capability') is not null
     and to_regprocedure('public.has_capability(text, uuid)') is not null
     and to_regprocedure('public.my_capabilities()') is not null
     and to_regprocedure('public.capability_shadow_report()') is not null;
  r := r || nl || pg_temp.dr_line(v_b, 'E4 the shadow table and functions stay after undoing the switch');

  select count(*) filter (where l like 'PASS %'), count(*) filter (where l like 'FAIL %')
    into v_pass, v_fail
    from regexp_split_to_table(r, nl) l;
  raise exception 'DRYRUN %', v_pass || ' PASS, ' || v_fail || ' FAIL' || nl || r;
end
$final$;
