-- DRY RUN of supabase/migrations/20261010200000_capabilities_shadow.sql
--        and of its down script supabase/migrations/down/20261010200000_capabilities_shadow.down.sql
-- NOT A MIGRATION: never apply it. NOTHING IS KEPT.
-- (Generated: the migration and the down script below are verbatim copies; if
-- either file changes, rebuild this one.)
--
-- How to run: the WHOLE file in ONE execute_sql call (one implicit transaction).
-- Do not add BEGIN/COMMIT and do not run it statement by statement. The last
-- statement ends with RAISE EXCEPTION 'DRYRUN ...': the migration, every test
-- write and the down script roll back; the error text IS the report ("n PASS,
-- m FAIL" first, then one line per check; INFO lines are not counted).
-- Tripwire: if the report says "before-snapshot missing", the statements did NOT
-- run in one transaction and the migration may have been committed: check
-- to_regclass('public.org_type_capability') at once, and run the down script if
-- it is there.
--
-- Layout
--   A. helpers (pg_temp) and the snapshot of every public policy, function,
--      trigger, constraint and table, plus registration_flags;
--   B. the migration, verbatim;
--   C. checks: T00-T06 structure (seed, RLS, function settings, privileges,
--      nothing existing changed, the flag), then scenarios S01-S18, each in its
--      own sub-transaction that is always rolled back (one test never sees
--      another's writes): a verified member P is given exactly one company of
--      each type (or none, an untyped, suspended or pending one, two companies),
--      or is made pending / rejected / suspended, and asked as P
--      (set local role authenticated + request.jwt.claims); a verified admin;
--      anonymous; the table's own rights; the shadow report;
--   D. the down script, verbatim;
--   E. D1-D3: the objects are gone, everything else is as in A; the report.
--
-- Callers, looked up AT RUN TIME (read-only, as postgres), so no account id is
-- written in this public repository: P = the first verified non-staff profile
-- (by id), A = the first verified admin.
--
-- Expected: "42 PASS, 0 FAIL", and the INFO line
--   "shadow report: 128 verified people, 32 gain, 15 lose" (10 Oct 2026 data;
--   these figures move with the data, the PASS lines do not).
--
-- Locks: creating the table and functions takes no lock on existing tables; the
-- scenarios write fixture rows (organizations, organization_members, profiles of
-- P) inside sub-transactions. Run at a quiet hour; it gives up after 5 s waiting.


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
-- B. The migration, verbatim: supabase/migrations/20261010200000_capabilities_shadow.sql
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

-- ════════════════════════════════════════════════════════════════════════════
-- C. Checks of the shadow migration
-- ════════════════════════════════════════════════════════════════════════════
do $tests$
declare
  nl constant text := chr(10);
  r text := '';
  v_p uuid;            -- a verified member, not staff (reshaped in each scenario)
  v_a uuid;            -- a verified admin (M3 staff)
  v_o1 uuid;
  v_o2 uuid;
  v_caps text[];
  v_caps2 text[];
  v_n bigint;
  v_n2 bigint;
  v_n3 bigint;
  v_b boolean;
  v_t text;
  v_j jsonb;
  v_before text;
  v_try text;
  c_all constant text[] := array['publish_needs', 'see_opportunities', 'answer_needs', 'message_companies', 'propose_webinar', 'see_dealflow'];
  c_marina constant text[] := array['publish_needs', 'see_opportunities', 'message_companies', 'propose_webinar'];
  c_partner constant text[] := array['see_opportunities', 'answer_needs', 'message_companies', 'propose_webinar'];
  c_investor constant text[] := array['see_opportunities', 'answer_needs', 'message_companies', 'propose_webinar', 'see_dealflow'];
  c_developer constant text[] := array['publish_needs', 'see_opportunities', 'answer_needs', 'message_companies', 'propose_webinar'];
  c_media constant text[] := array['see_opportunities', 'answer_needs', 'message_companies', 'propose_webinar'];
  c_participant constant text[] := array['propose_webinar'];
  c_none constant text[] := '{}'::text[];
begin
  -- Callers, looked up at run time (no account id in this public repository).
  select p.user_id into v_p from public.profiles p
   where p.access_status = 'verified' and p.persona not in ('admin', 'moderator')
   order by p.user_id limit 1;
  select p.user_id into v_a from public.profiles p
   where p.access_status = 'verified' and p.persona = 'admin'
   order by p.user_id limit 1;
  if v_p is null or v_a is null then
    raise exception 'dryrun: no verified member or no verified admin to test with';
  end if;

  -- T00 one transaction
  r := pg_temp.dr_line(current_setting('smc_dryrun.before', true) = 'yes', 'T00 before-snapshot present (one transaction)');

  -- T01 the seed
  select count(*), md5(string_agg(c.org_type || ':' || c.capability, ',' order by c.org_type collate "C", c.capability collate "C"))
    into v_n, v_t
    from public.org_type_capability c;
  r := r || nl || pg_temp.dr_line(v_n = 23 and v_t = '241ff73fc33da222998f777e602d1272',
         'T01 org_type_capability holds exactly the 23 rows of the decided table', v_n || ' rows, md5 ' || coalesce(v_t, '-'));

  -- T02 RLS on, two policies (read: signed in; write: admins)
  select c.relrowsecurity into v_b from pg_class c where c.oid = 'public.org_type_capability'::regclass;
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'org_type_capability'
     and policyname in ('org_type_capability_read', 'org_type_capability_admin_write');
  r := r || nl || pg_temp.dr_line(v_b and v_n = 2, 'T02 org_type_capability: RLS on, read and admin-write policies');

  -- T03 the four functions: SECURITY DEFINER, STABLE, search_path ''
  select count(*) into v_n from pg_proc p
   where p.oid in ('public.capability_set(uuid, uuid)'::regprocedure, 'public.has_capability(text, uuid)'::regprocedure,
                   'public.my_capabilities()'::regprocedure, 'public.capability_shadow_report()'::regprocedure)
     and p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=""'];
  r := r || nl || pg_temp.dr_line(v_n = 4, 'T03 the four functions are SECURITY DEFINER, STABLE, search_path ''''', v_n || ' of 4');

  -- T04 privileges
  v_b := not has_function_privilege('anon', 'public.capability_set(uuid, uuid)', 'execute')
     and not has_function_privilege('authenticated', 'public.capability_set(uuid, uuid)', 'execute')
     and has_function_privilege('anon', 'public.has_capability(text, uuid)', 'execute')
     and has_function_privilege('authenticated', 'public.has_capability(text, uuid)', 'execute')
     and not has_function_privilege('anon', 'public.my_capabilities()', 'execute')
     and has_function_privilege('authenticated', 'public.my_capabilities()', 'execute')
     and not has_function_privilege('anon', 'public.capability_shadow_report()', 'execute')
     and has_function_privilege('authenticated', 'public.capability_shadow_report()', 'execute')
     and not has_table_privilege('anon', 'public.org_type_capability', 'select')
     and has_table_privilege('authenticated', 'public.org_type_capability', 'select');
  r := r || nl || pg_temp.dr_line(v_b, 'T04 privileges: capability_set internal; has_capability for anon and signed-in; my_capabilities and the report for signed-in only; the table not for anon');

  -- T05 nothing that existed changed (policies, functions, triggers, constraints, tables)
  select count(*) into v_n from (
    select b.k, b.v from _dr_before b where b.k <> 'flags'
    except
    select s.k, s.v from pg_temp.dr_snapshot() s where s.k <> 'flags') x;
  select count(*), string_agg(x.k, ', ' order by x.k) into v_n2, v_t from (
    select s.k, s.v from pg_temp.dr_snapshot() s where s.k <> 'flags'
    except
    select b.k, b.v from _dr_before b where b.k <> 'flags') x;
  select count(*) into v_n3 from (
    select s.k from pg_temp.dr_snapshot() s where s.k <> 'flags'
    except
    select b.k from _dr_before b where b.k <> 'flags') x
   where not (x.k like '%org_type_capability%'
           or x.k in ('function capability_set(uuid,uuid)', 'function has_capability(text,uuid)',
                      'function my_capabilities()', 'function capability_shadow_report()'));
  r := r || nl || pg_temp.dr_line(v_n = 0 and v_n3 = 0,
         'T05 no existing policy, function, trigger, constraint or table changed; only new objects added',
         v_n || ' changed or missing, ' || v_n3 || ' unexpected new; new: ' || coalesce(v_t, '-'));

  -- T06 the flag: capabilities_enforced false, every other switch as it was
  select ps.value into v_j from public.platform_settings ps where ps.key = 'registration_flags';
  select b.v into v_before from _dr_before b where b.k = 'flags';
  if v_before = '<none>' then
    v_b := v_j = jsonb_build_object(
      'webinar_v2', false, 'onsite_v2', false, 'front_door', false, 'account_signup_v2', false,
      'password_only_login', false, 'wys_form_v2', false, 'wys_status_edit', false,
      'review_queue', false, 'provisioning', false, 'capabilities_enforced', false, 'turnstile', false);
  else
    v_b := (v_j - 'capabilities_enforced') = (v_before::jsonb - 'capabilities_enforced')
       and v_j -> 'capabilities_enforced' = coalesce(v_before::jsonb -> 'capabilities_enforced', 'false'::jsonb);
  end if;
  r := r || nl || pg_temp.dr_line(v_b and v_j -> 'capabilities_enforced' = 'false'::jsonb,
         'T06 registration_flags.capabilities_enforced is false and the other switches are untouched',
         coalesce(v_j::text, 'no row'));

  -- ── Scenarios: P is reshaped as postgres, asked as P, then everything rolls back ──

  -- S01 marina
  begin
    perform pg_temp.dr_solo(v_p);
    v_o1 := pg_temp.dr_org('marina', 'verified');
    perform pg_temp.dr_join(v_o1, v_p);
    v_caps := pg_temp.dr_caps_as(v_p);
    v_caps2 := pg_temp.dr_caps_as(v_p, v_o1);
    r := r || nl || pg_temp.dr_line(pg_temp.dr_same(v_caps, c_marina),
           'S01 marina company: publish needs, see opportunities (read-only), message companies, propose a webinar; no answer, no deal flow',
           array_to_string(v_caps, ','));
    r := r || nl || pg_temp.dr_line(pg_temp.dr_same(v_caps2, c_marina),
           'S01 the same through that company (p_org): no participant set added, same rights', array_to_string(v_caps2, ','));
    raise exception 'dryrun: scenario rolled back' using errcode = 'P0D01';
  exception
    when sqlstate 'P0D01' then null;
    when others then r := r || nl || 'FAIL S01 marina: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- S02 partner (service provider)
  begin
    perform pg_temp.dr_solo(v_p);
    v_o1 := pg_temp.dr_org('partner', 'verified');
    perform pg_temp.dr_join(v_o1, v_p);
    v_caps := pg_temp.dr_caps_as(v_p);
    r := r || nl || pg_temp.dr_line(pg_temp.dr_same(v_caps, c_partner),
           'S02 service provider company: see, answer, message, webinar; no publishing', array_to_string(v_caps, ','));
    raise exception 'dryrun: scenario rolled back' using errcode = 'P0D01';
  exception
    when sqlstate 'P0D01' then null;
    when others then r := r || nl || 'FAIL S02 partner: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- S03 investor
  begin
    perform pg_temp.dr_solo(v_p);
    v_o1 := pg_temp.dr_org('investor', 'verified');
    perform pg_temp.dr_join(v_o1, v_p);
    v_caps := pg_temp.dr_caps_as(v_p);
    r := r || nl || pg_temp.dr_line(pg_temp.dr_same(v_caps, c_investor),
           'S03 investor company: see, answer, message, webinar, deal flow; no publishing', array_to_string(v_caps, ','));
    raise exception 'dryrun: scenario rolled back' using errcode = 'P0D01';
  exception
    when sqlstate 'P0D01' then null;
    when others then r := r || nl || 'FAIL S03 investor: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- S04 developer
  begin
    perform pg_temp.dr_solo(v_p);
    v_o1 := pg_temp.dr_org('developer', 'verified');
    perform pg_temp.dr_join(v_o1, v_p);
    v_caps := pg_temp.dr_caps_as(v_p);
    r := r || nl || pg_temp.dr_line(pg_temp.dr_same(v_caps, c_developer),
           'S04 developer company: publish, see, answer, message, webinar', array_to_string(v_caps, ','));
    raise exception 'dryrun: scenario rolled back' using errcode = 'P0D01';
  exception
    when sqlstate 'P0D01' then null;
    when others then r := r || nl || 'FAIL S04 developer: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- S05 media
  begin
    perform pg_temp.dr_solo(v_p);
    v_o1 := pg_temp.dr_org('media_partner', 'verified');
    perform pg_temp.dr_join(v_o1, v_p);
    v_caps := pg_temp.dr_caps_as(v_p);
    r := r || nl || pg_temp.dr_line(pg_temp.dr_same(v_caps, c_media),
           'S05 media company: see, answer, message, webinar; no publishing', array_to_string(v_caps, ','));
    raise exception 'dryrun: scenario rolled back' using errcode = 'P0D01';
  exception
    when sqlstate 'P0D01' then null;
    when others then r := r || nl || 'FAIL S05 media: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- S06 participant: verified, no company
  begin
    perform pg_temp.dr_solo(v_p);
    v_o2 := pg_temp.dr_org('marina', 'verified');      -- a company P is NOT in
    v_caps := pg_temp.dr_caps_as(v_p);
    v_caps2 := pg_temp.dr_caps_as(v_p, v_o2);
    r := r || nl || pg_temp.dr_line(pg_temp.dr_same(v_caps, c_participant),
           'S06 participant (verified, no company): propose a webinar only', array_to_string(v_caps, ','));
    r := r || nl || pg_temp.dr_line(pg_temp.dr_same(v_caps2, c_none),
           'S06 nothing through a company the person is not a member of', array_to_string(v_caps2, ','));
    raise exception 'dryrun: scenario rolled back' using errcode = 'P0D01';
  exception
    when sqlstate 'P0D01' then null;
    when others then r := r || nl || 'FAIL S06 participant: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- S07 a validated company without a type counts as none
  begin
    perform pg_temp.dr_solo(v_p);
    v_o1 := pg_temp.dr_org(null, 'verified');
    perform pg_temp.dr_join(v_o1, v_p);
    v_caps := pg_temp.dr_caps_as(v_p);
    v_caps2 := pg_temp.dr_caps_as(v_p, v_o1);
    r := r || nl || pg_temp.dr_line(pg_temp.dr_same(v_caps, c_participant) and pg_temp.dr_same(v_caps2, c_none),
           'S07 validated company without a type: participant rights only, nothing through it',
           array_to_string(v_caps, ',') || ' / ' || array_to_string(v_caps2, ','));
    raise exception 'dryrun: scenario rolled back' using errcode = 'P0D01';
  exception
    when sqlstate 'P0D01' then null;
    when others then r := r || nl || 'FAIL S07 untyped: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- S08 a suspended company counts as none
  begin
    perform pg_temp.dr_solo(v_p);
    v_o1 := pg_temp.dr_org('marina', 'suspended');
    perform pg_temp.dr_join(v_o1, v_p);
    v_caps := pg_temp.dr_caps_as(v_p);
    v_caps2 := pg_temp.dr_caps_as(v_p, v_o1);
    r := r || nl || pg_temp.dr_line(pg_temp.dr_same(v_caps, c_participant) and pg_temp.dr_same(v_caps2, c_none),
           'S08 suspended marina company: participant rights only, nothing through it',
           array_to_string(v_caps, ',') || ' / ' || array_to_string(v_caps2, ','));
    raise exception 'dryrun: scenario rolled back' using errcode = 'P0D01';
  exception
    when sqlstate 'P0D01' then null;
    when others then r := r || nl || 'FAIL S08 suspended company: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- S09 a company still pending review counts as none
  begin
    perform pg_temp.dr_solo(v_p);
    v_o1 := pg_temp.dr_org('partner', 'pending');
    perform pg_temp.dr_join(v_o1, v_p);
    v_caps := pg_temp.dr_caps_as(v_p);
    r := r || nl || pg_temp.dr_line(pg_temp.dr_same(v_caps, c_participant),
           'S09 service provider company pending review: participant rights only', array_to_string(v_caps, ','));
    raise exception 'dryrun: scenario rolled back' using errcode = 'P0D01';
  exception
    when sqlstate 'P0D01' then null;
    when others then r := r || nl || 'FAIL S09 pending company: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- S10 a person pending review, in a validated marina: nothing (the pending set is empty)
  begin
    perform pg_temp.dr_solo(v_p);
    v_o1 := pg_temp.dr_org('marina', 'verified');
    perform pg_temp.dr_join(v_o1, v_p);
    update public.profiles set access_status = 'pending' where user_id = v_p;
    v_caps := pg_temp.dr_caps_as(v_p);
    v_caps2 := pg_temp.dr_caps_as(v_p, v_o1);
    r := r || nl || pg_temp.dr_line(pg_temp.dr_same(v_caps, c_none) and pg_temp.dr_same(v_caps2, c_none),
           'S10 person pending review (validated marina): no right, webinar included',
           array_to_string(v_caps, ',') || ' / ' || array_to_string(v_caps2, ','));
    raise exception 'dryrun: scenario rolled back' using errcode = 'P0D01';
  exception
    when sqlstate 'P0D01' then null;
    when others then r := r || nl || 'FAIL S10 pending person: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- S11 a person rejected, in a validated service provider: nothing
  begin
    perform pg_temp.dr_solo(v_p);
    v_o1 := pg_temp.dr_org('partner', 'verified');
    perform pg_temp.dr_join(v_o1, v_p);
    update public.profiles set access_status = 'rejected' where user_id = v_p;
    v_caps := pg_temp.dr_caps_as(v_p);
    r := r || nl || pg_temp.dr_line(pg_temp.dr_same(v_caps, c_none),
           'S11 person rejected (validated service provider): no right', array_to_string(v_caps, ','));
    raise exception 'dryrun: scenario rolled back' using errcode = 'P0D01';
  exception
    when sqlstate 'P0D01' then null;
    when others then r := r || nl || 'FAIL S11 rejected person: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- S12 a suspended person, in a validated investor: nothing
  begin
    perform pg_temp.dr_solo(v_p);
    v_o1 := pg_temp.dr_org('investor', 'verified');
    perform pg_temp.dr_join(v_o1, v_p);
    update public.profiles set access_status = 'suspended' where user_id = v_p;
    v_caps := pg_temp.dr_caps_as(v_p);
    r := r || nl || pg_temp.dr_line(pg_temp.dr_same(v_caps, c_none),
           'S12 suspended person (validated investor): no right', array_to_string(v_caps, ','));
    raise exception 'dryrun: scenario rolled back' using errcode = 'P0D01';
  exception
    when sqlstate 'P0D01' then null;
    when others then r := r || nl || 'FAIL S12 suspended person: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- S13 two companies, a marina and a service provider: the rights of both;
  --     through one company, only that company's
  begin
    perform pg_temp.dr_solo(v_p);
    v_o1 := pg_temp.dr_org('marina', 'verified');
    v_o2 := pg_temp.dr_org('partner', 'verified');
    perform pg_temp.dr_join(v_o1, v_p);
    perform pg_temp.dr_join(v_o2, v_p);
    v_caps := pg_temp.dr_caps_as(v_p);
    r := r || nl || pg_temp.dr_line(pg_temp.dr_same(v_caps, array['publish_needs', 'see_opportunities', 'answer_needs', 'message_companies', 'propose_webinar']),
           'S13 marina + service provider: the rights of both (publish and answer)', array_to_string(v_caps, ','));
    v_caps := pg_temp.dr_caps_as(v_p, v_o1);
    v_caps2 := pg_temp.dr_caps_as(v_p, v_o2);
    r := r || nl || pg_temp.dr_line(pg_temp.dr_same(v_caps, c_marina) and pg_temp.dr_same(v_caps2, c_partner),
           'S13 through the marina: publish, no answer; through the service provider: answer, no publish',
           array_to_string(v_caps, ',') || ' / ' || array_to_string(v_caps2, ','));
    -- my_capabilities as P
    perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
    set local role authenticated;
    v_j := public.my_capabilities();
    reset role;
    perform set_config('request.jwt.claims', '', true);
    v_b := v_j ->> 'person_status' = 'verified'
       and v_j -> 'is_staff' = 'false'::jsonb
       and jsonb_typeof(v_j -> 'companies') = 'array'
       and jsonb_array_length(v_j -> 'companies') = 2
       and (select count(*) from jsonb_array_elements(v_j -> 'companies') e
             where e ->> 'id' = v_o1::text and e ->> 'type' = 'marina' and e ->> 'status' = 'verified'
               and (e -> 'caps') @> '["publish_needs"]'::jsonb and not ((e -> 'caps') @> '["answer_needs"]'::jsonb)) = 1
       and (select count(*) from jsonb_array_elements(v_j -> 'companies') e
             where e ->> 'id' = v_o2::text and e ->> 'type' = 'partner'
               and (e -> 'caps') @> '["answer_needs"]'::jsonb and not ((e -> 'caps') @> '["publish_needs"]'::jsonb)) = 1
       and (v_j -> 'caps') @> '["publish_needs", "answer_needs", "propose_webinar"]'::jsonb
       and jsonb_array_length(v_j -> 'caps') = 5;
    r := r || nl || pg_temp.dr_line(v_b, 'S13 my_capabilities: person status, not staff, both companies with their own rights, the union for the person',
           left(coalesce(v_j::text, 'null'), 400));
    raise exception 'dryrun: scenario rolled back' using errcode = 'P0D01';
  exception
    when sqlstate 'P0D01' then null;
    when others then r := r || nl || 'FAIL S13 two companies: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- S14 a pending company is listed by my_capabilities, with no right through it
  begin
    perform pg_temp.dr_solo(v_p);
    v_o1 := pg_temp.dr_org('marina', 'pending');
    perform pg_temp.dr_join(v_o1, v_p);
    perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
    set local role authenticated;
    v_j := public.my_capabilities();
    reset role;
    perform set_config('request.jwt.claims', '', true);
    v_b := jsonb_array_length(v_j -> 'companies') = 1
       and v_j -> 'companies' -> 0 ->> 'status' = 'pending'
       and v_j -> 'companies' -> 0 -> 'caps' = '[]'::jsonb
       and v_j -> 'caps' = '["propose_webinar"]'::jsonb;
    r := r || nl || pg_temp.dr_line(v_b, 'S14 my_capabilities lists a pending company with no right through it; the person keeps the participant set',
           left(coalesce(v_j::text, 'null'), 300));
    raise exception 'dryrun: scenario rolled back' using errcode = 'P0D01';
  exception
    when sqlstate 'P0D01' then null;
    when others then r := r || nl || 'FAIL S14 pending company listed: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- S15 M3 staff keep everything, any capability, any company
  begin
    v_o2 := pg_temp.dr_org('partner', 'verified');      -- a company the admin is not in
    v_caps := pg_temp.dr_caps_as(v_a);
    v_caps2 := pg_temp.dr_caps_as(v_a, v_o2);
    perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
    set local role authenticated;
    v_b := public.has_capability('a_capability_added_later');
    v_j := public.my_capabilities();
    reset role;
    perform set_config('request.jwt.claims', '', true);
    r := r || nl || pg_temp.dr_line(pg_temp.dr_same(v_caps, c_all) and pg_temp.dr_same(v_caps2, c_all) and v_b
                                    and v_j -> 'is_staff' = 'true'::jsonb,
           'S15 verified admin: all six, through any company, and a capability not in the table yet; my_capabilities says is_staff',
           array_to_string(v_caps, ',') || ' / ' || coalesce(v_b::text, 'null'));
    raise exception 'dryrun: scenario rolled back' using errcode = 'P0D01';
  exception
    when sqlstate 'P0D01' then null;
    when others then r := r || nl || 'FAIL S15 staff: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- S16 anonymous: no right; my_capabilities and the report refused
  begin
    v_caps := pg_temp.dr_caps_as(null);
    r := r || nl || pg_temp.dr_line(pg_temp.dr_same(v_caps, c_none), 'S16 anonymous: has_capability is false for all six', array_to_string(v_caps, ','));
    v_try := pg_temp.dr_try(null, 'select public.my_capabilities()');
    r := r || nl || pg_temp.dr_line(v_try like '42501%', 'S16 anonymous: my_capabilities refused', v_try);
    v_try := pg_temp.dr_try(null, 'select count(*) from public.capability_shadow_report()');
    r := r || nl || pg_temp.dr_line(v_try like '42501%', 'S16 anonymous: capability_shadow_report refused', v_try);
    v_try := pg_temp.dr_try(null, 'select count(*) from public.org_type_capability');
    r := r || nl || pg_temp.dr_line(v_try like '42501%', 'S16 anonymous: org_type_capability not readable', v_try);
  exception
    when others then r := r || nl || 'FAIL S16 anonymous: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- S17 the table: a member reads it and cannot write it; an admin can
  begin
    v_n := pg_temp.dr_count(v_p, 'select count(*) from public.org_type_capability');
    r := r || nl || pg_temp.dr_line(v_n = 23, 'S17 a signed-in member reads the 23 rows', v_n::text);
    v_try := pg_temp.dr_try(v_p, 'insert into public.org_type_capability (org_type, capability) values (''participant'', ''see_opportunities'')');
    r := r || nl || pg_temp.dr_line(v_try like '42501%', 'S17 a member cannot add a right', v_try);
    v_n := pg_temp.dr_count(v_p, 'with d as (delete from public.org_type_capability returning 1) select count(*) from d');
    r := r || nl || pg_temp.dr_line(v_n = 0, 'S17 a member cannot remove a right (0 rows)', v_n::text);
    v_try := pg_temp.dr_try(v_a, 'insert into public.org_type_capability (org_type, capability) values (''participant'', ''see_opportunities'')');
    r := r || nl || pg_temp.dr_line(v_try = 'ok', 'S17 a verified admin can add a right (rolled back)', v_try);
    v_try := pg_temp.dr_try(v_a, 'insert into public.org_type_capability (org_type, capability) values (''supplier'', ''see_opportunities'')');
    r := r || nl || pg_temp.dr_line(v_try like '23514%', 'S17 an unknown type is refused by the check constraint', v_try);
  exception
    when others then r := r || nl || 'FAIL S17 table rights: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- S18 the shadow report: staff only, one row per non-staff person, ids only
  begin
    v_try := pg_temp.dr_try(v_p, 'select count(*) from public.capability_shadow_report()');
    r := r || nl || pg_temp.dr_line(v_try like '42501%', 'S18 a member cannot read the report', v_try);
    select count(*) into v_n from public.profiles p
     where not (p.persona in ('admin', 'moderator') and p.access_status = 'verified');
    v_n2 := pg_temp.dr_count(v_a, 'select count(*) from public.capability_shadow_report()');
    v_n3 := pg_temp.dr_count(v_a, format('select count(*) from public.capability_shadow_report() where user_id = %L', v_a));
    r := r || nl || pg_temp.dr_line(v_n2 = v_n and v_n3 = 0, 'S18 an admin reads one row per non-staff person, none for staff',
           v_n2 || ' rows for ' || v_n || ' people; staff rows ' || v_n3);
    select string_agg(a.attname, ',' order by a.attnum) into v_t
      from pg_proc p, unnest(p.proargnames) with ordinality a(attname, attnum)
     where p.oid = 'public.capability_shadow_report()'::regprocedure;
    r := r || nl || pg_temp.dr_line(v_t = 'user_id,person_status,persona,company_ids,company_types,current_caps,new_caps,gained,lost',
           'S18 the report has ids, statuses and capability lists only (no name, no e-mail)', v_t);
    -- The figures, as postgres (no JWT: allowed), for the record.
    select count(*) filter (where q.person_status = 'verified'),
           count(*) filter (where q.person_status = 'verified' and cardinality(q.gained) > 0),
           count(*) filter (where q.person_status = 'verified' and cardinality(q.lost) > 0)
      into v_n, v_n2, v_n3
      from public.capability_shadow_report() q;
    r := r || nl || 'INFO shadow report: ' || v_n || ' verified people, ' || v_n2 || ' gain, ' || v_n3
              || ' lose (expected on 10 Oct 2026: 128, 32, 15)';
    select string_agg(x.line, '; ' order by x.line) into v_t from (
      select 'gain ' || g || ' ' || count(*) as line from public.capability_shadow_report() q, unnest(q.gained) g group by g
      union all
      select 'lose ' || l || ' ' || count(*) from public.capability_shadow_report() q, unnest(q.lost) l group by l) x;
    r := r || nl || 'INFO by right: ' || coalesce(v_t, 'no change');
    select count(*) into v_n from public.capability_shadow_report() q
     where q.person_status <> 'verified' and (cardinality(q.gained) > 0 or cardinality(q.lost) > 0);
    r := r || nl || pg_temp.dr_line(v_n = 0, 'S18 people not verified neither gain nor lose', v_n::text);
  exception
    when others then r := r || nl || 'FAIL S18 report: ' || sqlstate || ' ' || sqlerrm;
  end;

  insert into _dr_report (line) values (r);
end
$tests$;


-- ════════════════════════════════════════════════════════════════════════════
-- D. The down script, verbatim: supabase/migrations/down/20261010200000_capabilities_shadow.down.sql
-- ════════════════════════════════════════════════════════════════════════════

-- UNDO of supabase/migrations/20261010200000_capabilities_shadow.sql
--
-- Refuses to run while the switch (supabase/migrations/held/capabilities_enforce.sql)
-- is applied: its policies call has_capability. Undo the switch first
-- (supabase/migrations/down/capabilities_enforce.down.sql).
--
-- The platform_settings row 'registration_flags' stays: it is shared with the
-- registration work (20261009200000_registration_prereqs). Only
-- capabilities_enforced is put back to false, so the site gates nothing.

do $pre$
begin
  if exists (select 1 from pg_policies
              where schemaname = 'public'
                and (coalesce(qual, '') like '%has_capability%' or coalesce(with_check, '') like '%has_capability%')) then
    raise exception 'capabilities shadow undo: policies still call has_capability; run down/capabilities_enforce.down.sql first';
  end if;
end
$pre$;

update public.platform_settings
   set value = jsonb_set(value, '{capabilities_enforced}', 'false'::jsonb, true)
 where key = 'registration_flags'
   and jsonb_typeof(value) = 'object';

drop function if exists public.capability_shadow_report();
drop function if exists public.my_capabilities();
drop function if exists public.has_capability(text, uuid);
drop function if exists public.capability_set(uuid, uuid);
drop table if exists public.org_type_capability;

-- ════════════════════════════════════════════════════════════════════════════
-- F. After the down script: the report
-- ════════════════════════════════════════════════════════════════════════════
do $final$
declare
  nl constant text := chr(10);
  r text;
  v_n bigint;
  v_n2 bigint;
  v_t text;
  v_j jsonb;
  v_before text;
  v_b boolean;
  v_pass int;
  v_fail int;
begin
  select string_agg(d.line, nl order by d.n) into r from _dr_report d;
  r := coalesce(r, 'FAIL the checks block left no report');

  -- D1 the new objects are gone
  v_b := to_regclass('public.org_type_capability') is null
     and to_regprocedure('public.capability_set(uuid, uuid)') is null
     and to_regprocedure('public.has_capability(text, uuid)') is null
     and to_regprocedure('public.my_capabilities()') is null
     and to_regprocedure('public.capability_shadow_report()') is null;
  r := r || nl || pg_temp.dr_line(v_b, 'D1 down script: the table and the four functions are gone');

  -- D2 everything else exactly as before the migration
  select count(*) into v_n from (
    select b.k, b.v from _dr_before b where b.k <> 'flags'
    except
    select s.k, s.v from pg_temp.dr_snapshot() s where s.k <> 'flags') x;
  select count(*), string_agg(x.k, ', ' order by x.k) into v_n2, v_t from (
    select s.k, s.v from pg_temp.dr_snapshot() s where s.k <> 'flags'
    except
    select b.k, b.v from _dr_before b where b.k <> 'flags') x;
  r := r || nl || pg_temp.dr_line(v_n = 0 and v_n2 = 0,
         'D2 down script: policies, functions, triggers, constraints and tables exactly as before',
         v_n || ' missing or changed, ' || v_n2 || ' extra: ' || coalesce(v_t, '-'));

  -- D3 the shared switches row stays; capabilities_enforced is off
  select ps.value into v_j from public.platform_settings ps where ps.key = 'registration_flags';
  select b.v into v_before from _dr_before b where b.k = 'flags';
  v_b := v_j -> 'capabilities_enforced' = 'false'::jsonb
     and (v_before = '<none>' or (v_j - 'capabilities_enforced') = (v_before::jsonb - 'capabilities_enforced'));
  r := r || nl || pg_temp.dr_line(v_b, 'D3 down script: capabilities_enforced is false, the other switches untouched (the shared row stays)',
         coalesce(v_j::text, 'no row'));

  select count(*) filter (where l like 'PASS %'), count(*) filter (where l like 'FAIL %')
    into v_pass, v_fail
    from regexp_split_to_table(r, nl) l;
  raise exception 'DRYRUN %', v_pass || ' PASS, ' || v_fail || ' FAIL' || nl || r;
end
$final$;
