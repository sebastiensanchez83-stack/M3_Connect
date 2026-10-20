-- DRY RUN of supabase/migrations/20261020140000_org_sm26_showcase.sql and of its down.
-- NOT A MIGRATION. ONE query text, ONE execute_sql call, BEFORE the file is applied.
-- A. snapshot; B. the migration, verbatim; C. cases as a visitor, a stranger, a collaborator,
-- two owners, a moderator and the service role, on real SM26 companies picked at run time (an
-- open startup and a restricted one), each write in its own rolled-back sub-transaction;
-- D. the down, verbatim; E. checks after the down. NO sm_* row is written (they are only read)
-- and the output names no company and no text (keys and counts only).
-- Ends with RAISE EXCEPTION 'DRYRUN ...': everything rolls back. Expected: "27 PASS, 0 FAIL".

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- A. Snapshot (S01 after the migration and the cases, E02 after the down: both identical)
create function pg_temp.dr_snap() returns table (k text, v text) language sql as $f$
  select 'sm', concat_ws('/',
      (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.sm_startup_profile t),
      (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.sm_architecture_entry t),
      (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.sm_role_assignment t),
      (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.sm_registration t))
  union all select 'orgs', (select md5(coalesce(string_agg(o.id::text || o.access_status || coalesce(o.archived_at::text, '')
                               || coalesce(o.owner_user_id::text, ''), ',' order by o.id), '')) from public.organizations o)
  union all select 'audit', (select count(*) || '/' || coalesce(max(l.created_at)::text, '') from public.organization_audit_log l)
  union all select 'policies', (select md5(string_agg(format('%s.%s.%s|%s|%s|%s|%s', pl.schemaname, pl.tablename, pl.policyname,
                                  pl.cmd, pl.roles, pl.qual, pl.with_check), ';' order by pl.schemaname, pl.tablename, pl.policyname))
                                  from pg_policies pl)
  union all select 'acls', (select md5(string_agg(p.oid::regprocedure::text || '=' || coalesce(array_to_string(p.proacl, ','), ''), ';'
                              order by p.oid::regprocedure::text))
                              from pg_proc p where p.pronamespace = 'public'::regnamespace and left(p.proname, 17) <> 'org_sm26_showcase')
  union all select 'tables', (select md5(string_agg(c.oid::regclass::text || ':' || c.relrowsecurity::text || ':'
                                || coalesce(array_to_string(c.relacl, ','), ''), ';' order by c.oid::regclass::text))
                                from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
                                 and c.relname <> 'org_sm26_showcase')
  union all select 'triggers', (select md5(string_agg(t.tgrelid::regclass::text || ':' || t.tgname || ':' || t.tgenabled::text, ','
                                  order by t.tgrelid::regclass::text, t.tgname)) from pg_trigger t where not t.tgisinternal)
$f$;
create temp table _dr_before on commit drop as select * from pg_temp.dr_snap();
create temp table _dr_res (n serial, ok boolean, label text) on commit drop;
create function pg_temp.dr_claims(p_uid uuid) returns text language sql stable as $f$
  select jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'email', (select u.email from auth.users u where u.id = p_uid))::text
$f$;
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claim.role', '', true), set_config('request.jwt.claims', '', true);

-- B. The migration, verbatim ─────────────────────────────────────────────────────
-- org_sm26_showcase: a company's Smart Marina 2026 catalogue and jury texts on its public page
-- (Victor, 20 Oct 2026: "les fiches des entreprises montrent les details donnes lors de leur
-- inscription a la Smart pour le catalogue et le jury"). NOT APPLIED. Apply with Victor's OK,
-- after the dry run supabase/dryrun/20261020140000_org_sm26_showcase.dryrun.sql (it runs this
-- file, then its down, in one rolled-back transaction).
-- Down: supabase/migrations/down/20261020140000_org_sm26_showcase.down.sql.
--
-- ADDITIVE ONLY. No sm_* table is written or altered (SM26 stays frozen): the sm_* rows are
-- READ by SECURITY DEFINER functions that return a fixed list of fields. Nothing existing is
-- redefined. Independent of every other pending file; any order.
--
-- What a visitor can see (public.org_sm26_showcase, open to anyone): for a company M3 verified
-- (not archived, not merged into another), its latest confirmed SM26 entry (registration
-- confirmed, role not declined):
--   startup (sm_startup_profile): activity, problem, solution, differentiation, usp,
--     target_markets, business_model, positioning (competitive_positioning), collaboration
--     (collaboration_expected), references (references_text), links (social_links);
--   architect, professional entries only (sm_architecture_entry): description
--     (company_description), sustainability (sustainability_statement), domain, references
--     (references_text), links (social_links and portfolio_link).
--   Links keep linkedin, instagram, facebook, twitter, x, youtube, tiktok, website and
--   portfolio values that look like a web address, and never a personal LinkedIn page
--   (linkedin.com/in/, /pub/).
-- NEVER returned: the pitch deck, pitch media, funds_needed, investment_seeking/stage/type, the
-- startup stage and categories, team members and team size, anon codes, jury data, consents,
-- visibility_level, storage paths (logos, product images, renders and the e-catalogue file are
-- in the private event-media bucket; images are a follow-up) and student entries (a person).
--
-- Defaults and the company's choice (public.org_sm26_showcase, one row per company, written
-- only through public.org_sm26_showcase_set):
--   opted_in null  = no choice yet: shown, EXCEPT a restricted entry (startup visibility_level 1,
--                    or module_data.ecat_consent not 'Yes'), which shows nothing until the
--                    company opts in;
--   opted_in true  = shown; opted_in false = nothing shown;
--   hidden_sections = the blocks the company hides (keys above).
-- Who changes it: the company owner (organizations.owner_user_id, or a member whose role is
-- 'owner') and M3 staff (public.is_moderator()). Every member of the company can read the
-- settings (public.org_sm26_showcase_settings). Each change is logged with
-- public.log_org_event (event 'sm26_showcase_changed').

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
declare
  v_missing text;
begin
  if to_regclass('public.org_sm26_showcase') is not null
     or exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and left(p.proname, 17) = 'org_sm26_showcase') then
    raise exception 'org_sm26_showcase: already installed (table or functions exist)';
  end if;
  -- Every column the functions read, as read on 20 Oct 2026.
  select string_agg(w.t || '.' || w.c, ', ') into v_missing
    from (values
      ('sm_startup_profile', 'role_assignment_id'), ('sm_startup_profile', 'organization_activity'),
      ('sm_startup_profile', 'problem'), ('sm_startup_profile', 'solution'), ('sm_startup_profile', 'differentiation'),
      ('sm_startup_profile', 'usp'), ('sm_startup_profile', 'target_markets'), ('sm_startup_profile', 'business_model'),
      ('sm_startup_profile', 'competitive_positioning'), ('sm_startup_profile', 'collaboration_expected'),
      ('sm_startup_profile', 'references_text'), ('sm_startup_profile', 'social_links'),
      ('sm_startup_profile', 'visibility_level'), ('sm_startup_profile', 'updated_at'),
      ('sm_architecture_entry', 'role_assignment_id'), ('sm_architecture_entry', 'company_description'),
      ('sm_architecture_entry', 'sustainability_statement'), ('sm_architecture_entry', 'domain'),
      ('sm_architecture_entry', 'references_text'), ('sm_architecture_entry', 'portfolio_link'),
      ('sm_architecture_entry', 'social_links'), ('sm_architecture_entry', 'updated_at'),
      ('sm_role_assignment', 'registration_id'), ('sm_role_assignment', 'organization_id'),
      ('sm_role_assignment', 'role'), ('sm_role_assignment', 'status'), ('sm_role_assignment', 'module_data'),
      ('sm_registration', 'organization_id'), ('sm_registration', 'status'),
      ('organizations', 'access_status'), ('organizations', 'archived_at'), ('organizations', 'duplicate_of'),
      ('organizations', 'owner_user_id'), ('organization_members', 'organization_id'),
      ('organization_members', 'user_id'), ('organization_members', 'role')) as w(t, c)
   where not exists (select 1 from information_schema.columns ic
                      where ic.table_schema = 'public' and ic.table_name = w.t and ic.column_name = w.c);
  if v_missing is not null then
    raise exception 'org_sm26_showcase: missing column(s): %', v_missing;
  end if;
  -- The two helpers the functions call, as read on 20 Oct 2026.
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.is_moderator()'))
       is distinct from 'cb9c826f94db460c5b63f9830ae12361'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.log_org_event(uuid, text, jsonb)'))
       is distinct from 'f36ef2bcbab1e3396977f0c71c49c1e3' then
    raise exception 'org_sm26_showcase: is_moderator() or log_org_event() changed since 20 Oct; check them again';
  end if;
end
$pre$;

-- 1. The company's choice. Nobody reads or writes it directly: the functions below do.
create table public.org_sm26_showcase (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  opted_in boolean,
  hidden_sections text[] not null default '{}'::text[],
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint org_sm26_showcase_sections check (hidden_sections <@ array[
    'activity', 'problem', 'solution', 'differentiation', 'usp', 'target_markets', 'business_model',
    'positioning', 'collaboration', 'references', 'links', 'description', 'sustainability', 'domain']::text[])
);
comment on table public.org_sm26_showcase is
  'A company''s choice about its Smart Marina 2026 texts on its public page: opted_in (null = default, true = show, false = hide all) and the hidden blocks. Read and written only through org_sm26_showcase_settings / org_sm26_showcase_set.';
alter table public.org_sm26_showcase enable row level security;
revoke all on table public.org_sm26_showcase from public, anon, authenticated;
grant all on table public.org_sm26_showcase to service_role;

-- 2. Links: only web addresses, never a personal LinkedIn page. Internal.
create function public.org_sm26_showcase_links(p_links jsonb, p_portfolio text)
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  select nullif(coalesce(jsonb_object_agg(l.k, l.v), '{}'::jsonb), '{}'::jsonb)
    from (select lower(e.key) as k, btrim(e.value) as v
            from jsonb_each_text(case when jsonb_typeof(p_links) = 'object' then p_links else '{}'::jsonb end) as e
          union all
          select 'portfolio', btrim(p_portfolio) where p_portfolio is not null) as l
   where l.k in ('linkedin', 'instagram', 'facebook', 'twitter', 'x', 'youtube', 'tiktok', 'website', 'portfolio')
     and l.v ~* '^(https?://)?([a-z0-9-]+[.])+[a-z]{2,}(/[^[:space:]]*)?$'
     and l.v !~* 'linkedin[.]com/(in|pub)/'
$fn$;

-- 3. A company's latest confirmed SM26 entries (one startup, one architect at most), with the
--    allowed fields only and whether the entry is restricted. Internal: never the API.
create function public.org_sm26_showcase_entries(p_org_id uuid)
returns table (kind text, restricted boolean, restricted_reason text, sections jsonb)
language sql
stable
security definer
set search_path = ''
as $fn$
  select x.kind, x.restricted_reason is not null, x.restricted_reason, x.sections
    from (
      (select 'startup'::text as kind,
              case when sp.visibility_level = 1 then 'visibility'
                   when (ra.module_data ->> 'ecat_consent') is distinct from 'Yes' then 'consent' end as restricted_reason,
              jsonb_strip_nulls(jsonb_build_object(
                'activity', nullif(btrim(sp.organization_activity), ''),
                'problem', nullif(btrim(sp.problem), ''),
                'solution', nullif(btrim(sp.solution), ''),
                'differentiation', nullif(btrim(sp.differentiation), ''),
                'usp', nullif(btrim(sp.usp), ''),
                'target_markets', nullif(btrim(sp.target_markets), ''),
                'business_model', nullif(btrim(sp.business_model), ''),
                'positioning', nullif(btrim(sp.competitive_positioning), ''),
                'collaboration', nullif(btrim(sp.collaboration_expected), ''),
                'references', nullif(btrim(sp.references_text), ''),
                'links', public.org_sm26_showcase_links(sp.social_links, null))) as sections
         from public.sm_startup_profile sp
         join public.sm_role_assignment ra on ra.id = sp.role_assignment_id
         join public.sm_registration reg on reg.id = ra.registration_id
        where coalesce(ra.organization_id, reg.organization_id) = p_org_id
          and ra.role = 'startup'
          and coalesce(ra.status, '') <> 'declined'
          and reg.status = 'confirmed'
        order by sp.updated_at desc nulls last, sp.id
        limit 1)
      union all
      (select 'architect'::text,
              case when (ra.module_data ->> 'ecat_consent') is distinct from 'Yes' then 'consent' end,
              jsonb_strip_nulls(jsonb_build_object(
                'description', nullif(btrim(ae.company_description), ''),
                'sustainability', nullif(btrim(ae.sustainability_statement), ''),
                'domain', nullif(btrim(ae.domain), ''),
                'references', nullif(btrim(ae.references_text), ''),
                'links', public.org_sm26_showcase_links(ae.social_links, ae.portfolio_link)))
         from public.sm_architecture_entry ae
         join public.sm_role_assignment ra on ra.id = ae.role_assignment_id
         join public.sm_registration reg on reg.id = ra.registration_id
        where coalesce(ra.organization_id, reg.organization_id) = p_org_id
          and ra.role = 'architect_pro'
          and coalesce(ra.status, '') <> 'declined'
          and reg.status = 'confirmed'
        order by ae.updated_at desc nulls last, ae.id
        limit 1)
    ) as x
$fn$;

-- 4. What the public company page shows (anyone). Null when there is nothing to show.
create function public.org_sm26_showcase(p_org_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  with pref as (
    select s.opted_in, s.hidden_sections from public.org_sm26_showcase s where s.organization_id = p_org_id
  ), shown as (
    select e.kind,
           (select jsonb_object_agg(k.key, k.value)
              from jsonb_each(e.sections) as k
             where k.key <> all (coalesce((select pref.hidden_sections from pref), '{}'::text[]))) as sections
      from public.organizations o
      cross join lateral public.org_sm26_showcase_entries(o.id) as e
     where o.id = p_org_id
       and o.access_status = 'verified'
       and o.archived_at is null
       and o.duplicate_of is null
       and coalesce((select pref.opted_in from pref), e.restricted is false)
  )
  select jsonb_build_object(
           'edition', 'Smart Marina 2026',
           'blocks', jsonb_agg(jsonb_build_object('kind', shown.kind, 'sections', shown.sections) order by shown.kind desc))
    from shown
   where shown.sections is not null
  having count(*) > 0
$fn$;

-- 5. The dashboard's view of the choice: members of the company and M3 staff.
create function public.org_sm26_showcase_settings(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_can_edit boolean;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Sign in to see these settings' using errcode = '42501';
  end if;
  v_can_edit := public.is_moderator()
    or exists (select 1 from public.organizations o where o.id = p_org_id and o.owner_user_id = v_uid)
    or exists (select 1 from public.organization_members m
                where m.organization_id = p_org_id and m.user_id = v_uid and m.role = 'owner');
  if not v_can_edit
     and not exists (select 1 from public.organization_members m where m.organization_id = p_org_id and m.user_id = v_uid) then
    raise exception 'Only members of this company can see these settings' using errcode = '42501';
  end if;
  select jsonb_build_object(
           'can_edit', v_can_edit,
           'listed', coalesce((select o.access_status = 'verified' and o.archived_at is null and o.duplicate_of is null
                                 from public.organizations o where o.id = p_org_id), false),
           'opted_in', s.opted_in,
           'hidden_sections', to_jsonb(coalesce(s.hidden_sections, '{}'::text[])),
           'updated_at', s.updated_at,
           'entries', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'restricted', e.restricted,
                                         'restricted_reason', e.restricted_reason, 'sections', e.sections) order by e.kind desc)
                                  from public.org_sm26_showcase_entries(p_org_id) as e), '[]'::jsonb))
    into v_result
    from (select 1) as one
    left join public.org_sm26_showcase s on s.organization_id = p_org_id;
  return v_result;
end
$fn$;

-- 6. The company's change: its owner or M3 staff. Returns the new settings.
create function public.org_sm26_showcase_set(p_org_id uuid, p_opted_in boolean, p_hidden_sections text[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_hidden text[];
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not (public.is_moderator()
          or exists (select 1 from public.organizations o where o.id = p_org_id and o.owner_user_id = v_uid)
          or exists (select 1 from public.organization_members m
                      where m.organization_id = p_org_id and m.user_id = v_uid and m.role = 'owner')) then
    raise exception 'Only the company owner or the M3 team can change this' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organizations o where o.id = p_org_id) then
    raise exception 'Unknown company' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct h.v order by h.v), '{}'::text[]) into v_hidden
    from unnest(coalesce(p_hidden_sections, '{}'::text[])) as h(v)
   where h.v is not null;
  begin
    insert into public.org_sm26_showcase (organization_id, opted_in, hidden_sections, updated_by, updated_at)
    values (p_org_id, p_opted_in, v_hidden, v_uid, now())
    on conflict (organization_id) do update
      set opted_in = excluded.opted_in,
          hidden_sections = excluded.hidden_sections,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at;
  exception when check_violation then
    raise exception 'Unknown section in %', v_hidden using errcode = '22023';
  end;
  perform public.log_org_event(p_org_id, 'sm26_showcase_changed',
    jsonb_build_object('opted_in', p_opted_in, 'hidden_sections', to_jsonb(v_hidden)));
  return public.org_sm26_showcase_settings(p_org_id);
end
$fn$;

-- 7. Who may call what.
revoke all on function public.org_sm26_showcase_links(jsonb, text) from public, anon, authenticated;
revoke all on function public.org_sm26_showcase_entries(uuid) from public, anon, authenticated;
revoke all on function public.org_sm26_showcase(uuid) from public, anon, authenticated;
revoke all on function public.org_sm26_showcase_settings(uuid) from public, anon, authenticated;
revoke all on function public.org_sm26_showcase_set(uuid, boolean, text[]) from public, anon, authenticated;
grant execute on function public.org_sm26_showcase_links(jsonb, text) to service_role;
grant execute on function public.org_sm26_showcase_entries(uuid) to service_role;
grant execute on function public.org_sm26_showcase(uuid) to anon, authenticated, service_role;
grant execute on function public.org_sm26_showcase_settings(uuid) to authenticated, service_role;
grant execute on function public.org_sm26_showcase_set(uuid, boolean, text[]) to authenticated, service_role;

-- After: the privileges exactly as intended, else the whole file rolls back.
do $post$
declare
  v_bad text;
begin
  select string_agg(f.fn || ' ' || f.who, ', ') into v_bad
    from (values
      ('public.org_sm26_showcase_links(jsonb, text)', 'anon', false), ('public.org_sm26_showcase_links(jsonb, text)', 'authenticated', false),
      ('public.org_sm26_showcase_entries(uuid)', 'anon', false), ('public.org_sm26_showcase_entries(uuid)', 'authenticated', false),
      ('public.org_sm26_showcase(uuid)', 'anon', true), ('public.org_sm26_showcase(uuid)', 'authenticated', true),
      ('public.org_sm26_showcase_settings(uuid)', 'anon', false), ('public.org_sm26_showcase_settings(uuid)', 'authenticated', true),
      ('public.org_sm26_showcase_set(uuid, boolean, text[])', 'anon', false), ('public.org_sm26_showcase_set(uuid, boolean, text[])', 'authenticated', true)
    ) as f(fn, who, want)
   where has_function_privilege(f.who, f.fn, 'execute') is distinct from f.want
      or exists (select 1 from aclexplode((select p.proacl from pg_proc p where p.oid = f.fn::regprocedure)) a where a.grantee = 0)
      or not has_function_privilege('service_role', f.fn, 'execute');
  if v_bad is not null then
    raise exception 'org_sm26_showcase: wrong function privileges: %', v_bad;
  end if;
  if has_table_privilege('anon', 'public.org_sm26_showcase', 'select, insert, update, delete')
     or has_table_privilege('authenticated', 'public.org_sm26_showcase', 'select, insert, update, delete')
     or not (select c.relrowsecurity from pg_class c where c.oid = 'public.org_sm26_showcase'::regclass) then
    raise exception 'org_sm26_showcase: the table is open to the API or has no RLS';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and left(p.proname, 17) = 'org_sm26_showcase'
                and coalesce(array_to_string(p.proconfig, ','), '') <> 'search_path=""') then
    raise exception 'org_sm26_showcase: a function has no empty search_path';
  end if;
  if public.org_sm26_showcase('00000000-0000-0000-0000-000000000000'::uuid) is not null then
    raise exception 'org_sm26_showcase: an unknown company shows something';
  end if;
end
$post$;
-- ─────────────────────────────────────────────────────────────────────────────────

-- C. Cases
do $cases$
declare
  v_o1 uuid; v_own1 uuid; v_o2 uuid; v_own2 uuid; v_col2 uuid; v_str uuid; v_mod uuid;
  v_j jsonb; v_j2 jsonb; v_t text; v_st text; v_st2 text; v_n integer; v_n2 integer;
  v_allowed text[] := array['activity', 'problem', 'solution', 'differentiation', 'usp', 'target_markets', 'business_model',
    'positioning', 'collaboration', 'references', 'links', 'description', 'sustainability', 'domain'];
  v_linkkeys text[] := array['linkedin', 'instagram', 'facebook', 'twitter', 'x', 'youtube', 'tiktok', 'website', 'portfolio'];
  r_ok boolean[] := '{}';
  r_lb text[] := '{}';
begin
  -- Fixtures, read from the live data (postgres): an open startup with an owner, a restricted
  -- one with an owner and a collaborator who is not staff, a verified stranger, a moderator.
  select o.id, o.owner_user_id into v_o1, v_own1
    from public.organizations o
   where o.access_status = 'verified' and o.archived_at is null and o.duplicate_of is null and o.owner_user_id is not null
     and exists (select 1 from public.org_sm26_showcase_entries(o.id) e where e.kind = 'startup' and not e.restricted and e.sections ? 'problem')
   order by o.id limit 1;
  select o.id, o.owner_user_id, m.user_id into v_o2, v_own2, v_col2
    from public.organizations o
    join public.organization_members m on m.organization_id = o.id and m.role = 'collaborator' and m.user_id <> o.owner_user_id
   where o.access_status = 'verified' and o.archived_at is null and o.duplicate_of is null and o.owner_user_id is not null
     and exists (select 1 from public.org_sm26_showcase_entries(o.id) e where e.restricted and e.sections <> '{}'::jsonb)
     and not exists (select 1 from public.org_sm26_showcase_entries(o.id) e where not e.restricted)
     and not exists (select 1 from public.profiles p where p.user_id = m.user_id and p.persona::text in ('admin', 'moderator'))
     and exists (select 1 from auth.users u where u.id = m.user_id)
   order by o.id, m.user_id limit 1;
  select p.user_id into v_str
    from public.profiles p join auth.users u on u.id = p.user_id
   where p.access_status = 'verified' and p.persona::text not in ('admin', 'moderator')
     and p.user_id is distinct from v_own1 and p.user_id is distinct from v_own2
     and not exists (select 1 from public.organization_members m where m.user_id = p.user_id and m.organization_id in (v_o1, v_o2))
   order by p.user_id limit 1;
  select p.user_id into v_mod
    from public.profiles p join auth.users u on u.id = p.user_id
   where p.access_status = 'verified' and p.persona::text in ('admin', 'moderator')
     and not exists (select 1 from public.organization_members m where m.user_id = p.user_id and m.organization_id in (v_o1, v_o2))
   order by p.user_id limit 1;
  r_ok := r_ok || (v_o1 is not null and v_o2 is not null and v_col2 is not null and v_str is not null and v_mod is not null);
  r_lb := r_lb || format('F00 fixtures found: open startup %s, restricted startup with collaborator %s, stranger %s, moderator %s',
    v_o1 is not null, v_col2 is not null, v_str is not null, v_mod is not null);

  -- A01-A02 a visitor reads the open startup
  begin
    perform set_config('request.jwt.claims', '{"role": "anon"}', true);
    set local role anon;
    v_j := public.org_sm26_showcase(v_o1);
    v_st := 'ok';
  exception when others then v_st := sqlstate || ' ' || sqlerrm; v_j := null;
  end;
  reset role; perform set_config('request.jwt.claims', '', true);
  v_t := (select string_agg(distinct k, ',') from jsonb_array_elements(coalesce(v_j -> 'blocks', '[]'::jsonb)) as b, jsonb_object_keys(b -> 'sections') as k);
  r_ok := r_ok || (v_st = 'ok' and v_j ->> 'edition' = 'Smart Marina 2026'
    and exists (select 1 from jsonb_array_elements(v_j -> 'blocks') as b where b ->> 'kind' = 'startup' and b -> 'sections' ? 'problem'));
  r_lb := r_lb || ('A01 a visitor sees the open startup''s texts: ' || v_st || ', sections ' || coalesce(v_t, 'none'));
  r_ok := r_ok || (v_j is not null
    and not exists (select 1 from jsonb_object_keys(v_j) as k where k not in ('edition', 'blocks'))
    and not exists (select 1 from jsonb_array_elements(v_j -> 'blocks') as b, jsonb_object_keys(b) as k where k not in ('kind', 'sections'))
    and not exists (select 1 from jsonb_array_elements(v_j -> 'blocks') as b, jsonb_object_keys(b -> 'sections') as k where k <> all (v_allowed))
    and not exists (select 1 from jsonb_array_elements(v_j -> 'blocks') as b, jsonb_object_keys(coalesce(b -> 'sections' -> 'links', '{}'::jsonb)) as k
                     where k <> all (v_linkkeys))
    and v_j::text !~* 'linkedin[.]com/(in|pub)/');
  r_lb := r_lb || 'A02 only the allowed keys come back (no deck, funds, investment, team, codes, consents, paths, personal LinkedIn)'::text;

  -- A03-A04 restricted and unknown companies show nothing
  begin
    perform set_config('request.jwt.claims', '{"role": "anon"}', true);
    set local role anon;
    v_j := public.org_sm26_showcase(v_o2);
    v_j2 := public.org_sm26_showcase('00000000-0000-0000-0000-000000000000'::uuid);
    v_st := 'ok';
  exception when others then v_st := sqlstate || ' ' || sqlerrm; v_j := '{}'::jsonb; v_j2 := '{}'::jsonb;
  end;
  reset role; perform set_config('request.jwt.claims', '', true);
  r_ok := r_ok || (v_st = 'ok' and v_j is null);
  r_lb := r_lb || ('A03 a restricted startup with no choice yet shows nothing: ' || v_st || ', ' || case when v_j is null then 'null' else 'SHOWN' end);
  r_ok := r_ok || (v_st = 'ok' and v_j2 is null);
  r_lb := r_lb || ('A04 an unknown company shows nothing: ' || case when v_j2 is null then 'null' else 'SHOWN' end);

  -- A05-A06 the table is closed to the API
  begin
    perform set_config('request.jwt.claims', '{"role": "anon"}', true);
    set local role anon;
    perform 1 from public.org_sm26_showcase s limit 1;
    v_st := 'no error';
  exception when others then v_st := sqlstate || ' ' || sqlerrm;
  end;
  reset role; perform set_config('request.jwt.claims', '', true);
  r_ok := r_ok || (v_st like '42501%');
  r_lb := r_lb || ('A05 a visitor cannot read the table: ' || v_st);
  begin
    perform set_config('request.jwt.claims', pg_temp.dr_claims(v_str), true);
    set local role authenticated;
    perform 1 from public.org_sm26_showcase s limit 1;
    v_st := 'no error';
  exception when others then v_st := sqlstate || ' ' || sqlerrm;
  end;
  reset role; perform set_config('request.jwt.claims', '', true);
  r_ok := r_ok || (v_st like '42501%');
  r_lb := r_lb || ('A06 a signed-in stranger cannot read the table: ' || v_st);

  -- A07-A10 functions a visitor or a member may not call
  begin
    perform set_config('request.jwt.claims', '{"role": "anon"}', true);
    set local role anon;
    v_j := public.org_sm26_showcase_settings(v_o1);
    v_st := 'no error';
  exception when others then v_st := sqlstate || ' ' || sqlerrm;
  end;
  reset role; perform set_config('request.jwt.claims', '', true);
  r_ok := r_ok || (v_st like '42501 permission denied for function%');
  r_lb := r_lb || ('A07 a visitor cannot call the settings: ' || v_st);
  begin
    begin
      perform set_config('request.jwt.claims', '{"role": "anon"}', true);
      set local role anon;
      v_j := public.org_sm26_showcase_set(v_o1, true, '{}'::text[]);
      v_st := 'no error';
    exception when others then v_st := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    raise exception using errcode = 'DRY01';
  exception when sqlstate 'DRY01' then null;
  end;
  r_ok := r_ok || (v_st like '42501 permission denied for function%');
  r_lb := r_lb || ('A08 a visitor cannot change a choice: ' || v_st);
  begin
    perform set_config('request.jwt.claims', '{"role": "anon"}', true);
    set local role anon;
    perform 1 from public.org_sm26_showcase_entries(v_o1);
    v_st := 'no error';
  exception when others then v_st := sqlstate || ' ' || sqlerrm;
  end;
  reset role; perform set_config('request.jwt.claims', '', true);
  r_ok := r_ok || (v_st like '42501 permission denied for function%');
  r_lb := r_lb || ('A09 a visitor cannot call the raw entries: ' || v_st);
  begin
    perform set_config('request.jwt.claims', pg_temp.dr_claims(v_own1), true);
    set local role authenticated;
    perform 1 from public.org_sm26_showcase_entries(v_o1);
    v_st := 'no error';
  exception when others then v_st := sqlstate || ' ' || sqlerrm;
  end;
  reset role; perform set_config('request.jwt.claims', '', true);
  begin
    perform set_config('request.jwt.claims', pg_temp.dr_claims(v_own1), true);
    set local role authenticated;
    v_j := public.org_sm26_showcase_links('{}'::jsonb, null);
    v_st2 := 'no error';
  exception when others then v_st2 := sqlstate || ' ' || sqlerrm;
  end;
  reset role; perform set_config('request.jwt.claims', '', true);
  r_ok := r_ok || (v_st like '42501 permission denied for function%' and v_st2 like '42501 permission denied for function%');
  r_lb := r_lb || ('A10 even the owner cannot call the raw entries or the links helper: ' || v_st || ' / ' || v_st2);

  -- B01-B02 a stranger
  begin
    perform set_config('request.jwt.claims', pg_temp.dr_claims(v_str), true);
    set local role authenticated;
    v_j := public.org_sm26_showcase_settings(v_o1);
    v_st := 'no error';
  exception when others then v_st := sqlstate || ' ' || sqlerrm;
  end;
  reset role; perform set_config('request.jwt.claims', '', true);
  r_ok := r_ok || (v_st like '42501 Only members of this company%');
  r_lb := r_lb || ('B01 a stranger cannot read a company''s settings: ' || v_st);
  begin
    begin
      perform set_config('request.jwt.claims', pg_temp.dr_claims(v_str), true);
      set local role authenticated;
      v_j := public.org_sm26_showcase_set(v_o1, false, '{}'::text[]);
      v_st := 'no error';
    exception when others then v_st := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    select count(*) into v_n from public.org_sm26_showcase s where s.organization_id = v_o1;
    raise exception using errcode = 'DRY01';
  exception when sqlstate 'DRY01' then null;
  end;
  r_ok := r_ok || (v_st like '42501 Only the company owner%' and v_n = 0);
  r_lb := r_lb || ('B02 a stranger cannot change a choice: ' || v_st || ', rows ' || v_n);

  -- B03-B05 the restricted startup's collaborator and owner
  begin
    perform set_config('request.jwt.claims', pg_temp.dr_claims(v_col2), true);
    set local role authenticated;
    v_j := public.org_sm26_showcase_settings(v_o2);
    v_st := 'ok';
  exception when others then v_st := sqlstate || ' ' || sqlerrm; v_j := null;
  end;
  reset role; perform set_config('request.jwt.claims', '', true);
  r_ok := r_ok || (v_st = 'ok' and (v_j ->> 'can_edit')::boolean is false and v_j -> 'opted_in' = 'null'::jsonb
    and (v_j -> 'entries' -> 0 ->> 'restricted')::boolean and (v_j -> 'entries' -> 0 -> 'sections') <> '{}'::jsonb
    and (v_j ->> 'listed')::boolean);
  r_lb := r_lb || ('B03 a collaborator reads the settings, read-only: ' || v_st || ', can_edit ' || coalesce(v_j ->> 'can_edit', '?')
    || ', restricted ' || coalesce(v_j -> 'entries' -> 0 ->> 'restricted', '?') || ' (' || coalesce(v_j -> 'entries' -> 0 ->> 'restricted_reason', '?') || ')');
  begin
    begin
      perform set_config('request.jwt.claims', pg_temp.dr_claims(v_col2), true);
      set local role authenticated;
      v_j := public.org_sm26_showcase_set(v_o2, true, '{}'::text[]);
      v_st := 'no error';
    exception when others then v_st := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    select count(*) into v_n from public.org_sm26_showcase s where s.organization_id = v_o2;
    raise exception using errcode = 'DRY01';
  exception when sqlstate 'DRY01' then null;
  end;
  r_ok := r_ok || (v_st like '42501 Only the company owner%' and v_n = 0);
  r_lb := r_lb || ('B04 a collaborator cannot change the choice: ' || v_st || ', rows ' || v_n);
  begin
    perform set_config('request.jwt.claims', pg_temp.dr_claims(v_own2), true);
    set local role authenticated;
    v_j := public.org_sm26_showcase_settings(v_o2);
    v_st := 'ok';
  exception when others then v_st := sqlstate || ' ' || sqlerrm; v_j := null;
  end;
  reset role; perform set_config('request.jwt.claims', '', true);
  r_ok := r_ok || (v_st = 'ok' and (v_j ->> 'can_edit')::boolean and v_j -> 'opted_in' = 'null'::jsonb
    and v_j -> 'hidden_sections' = '[]'::jsonb);
  r_lb := r_lb || ('B05 the owner may change it, no choice yet: ' || v_st || ', can_edit ' || coalesce(v_j ->> 'can_edit', '?'));

  -- C01 the restricted startup's owner opts in and hides one block
  begin
    perform set_config('request.jwt.claims', pg_temp.dr_claims(v_own2), true);
    set local role authenticated;
    v_j := public.org_sm26_showcase_set(v_o2, true, array['problem']);
    reset role;
    perform set_config('request.jwt.claims', '{"role": "anon"}', true);
    set local role anon;
    v_j2 := public.org_sm26_showcase(v_o2);
    reset role;
    perform set_config('request.jwt.claims', '', true);
    select count(*) into v_n from public.org_sm26_showcase s
     where s.organization_id = v_o2 and s.opted_in and s.hidden_sections = array['problem'] and s.updated_by = v_own2;
    select count(*) into v_n2 from public.organization_audit_log l
     where l.organization_id = v_o2 and l.event_type = 'sm26_showcase_changed' and l.actor_user_id = v_own2
       and l.event_payload = jsonb_build_object('opted_in', true, 'hidden_sections', jsonb_build_array('problem'));
    v_st := 'ok';
    raise exception using errcode = 'DRY01';
  exception
    when sqlstate 'DRY01' then null;
    when others then v_st := sqlstate || ' ' || sqlerrm;
  end;
  reset role; perform set_config('request.jwt.claims', '', true);
  v_t := (select string_agg(distinct k, ',') from jsonb_array_elements(coalesce(v_j2 -> 'blocks', '[]'::jsonb)) as b, jsonb_object_keys(b -> 'sections') as k);
  r_ok := r_ok || (v_st = 'ok' and (v_j ->> 'opted_in')::boolean and v_j -> 'hidden_sections' = '["problem"]'::jsonb
    and v_j2 is not null and v_t is not null and v_t !~ '(^|,)problem(,|$)' and v_n = 1 and v_n2 = 1);
  r_lb := r_lb || ('C01 the owner opts in hiding "problem": the visitor sees ' || coalesce(v_t, 'nothing') || '; row ' || coalesce(v_n, -1)
    || ', audit ' || coalesce(v_n2, -1) || ' (' || v_st || ')');

  -- C02 the open startup's owner hides everything
  begin
    perform set_config('request.jwt.claims', pg_temp.dr_claims(v_own1), true);
    set local role authenticated;
    v_j := public.org_sm26_showcase_set(v_o1, false, '{}'::text[]);
    reset role;
    perform set_config('request.jwt.claims', '{"role": "anon"}', true);
    set local role anon;
    v_j2 := public.org_sm26_showcase(v_o1);
    reset role;
    perform set_config('request.jwt.claims', '', true);
    v_st := 'ok';
    raise exception using errcode = 'DRY01';
  exception
    when sqlstate 'DRY01' then null;
    when others then v_st := sqlstate || ' ' || sqlerrm;
  end;
  reset role; perform set_config('request.jwt.claims', '', true);
  r_ok := r_ok || (v_st = 'ok' and v_j -> 'opted_in' = 'false'::jsonb and v_j2 is null);
  r_lb := r_lb || ('C02 the owner hides everything: the visitor sees ' || case when v_j2 is null then 'nothing' else 'SOMETHING' end || ' (' || v_st || ')');

  -- C03 the open startup's owner hides two blocks (sent twice): stored once, sorted
  begin
    perform set_config('request.jwt.claims', pg_temp.dr_claims(v_own1), true);
    set local role authenticated;
    v_j := public.org_sm26_showcase_set(v_o1, null, array['problem', 'links', 'problem']);
    reset role;
    perform set_config('request.jwt.claims', '{"role": "anon"}', true);
    set local role anon;
    v_j2 := public.org_sm26_showcase(v_o1);
    reset role;
    perform set_config('request.jwt.claims', '', true);
    v_st := 'ok';
    raise exception using errcode = 'DRY01';
  exception
    when sqlstate 'DRY01' then null;
    when others then v_st := sqlstate || ' ' || sqlerrm;
  end;
  reset role; perform set_config('request.jwt.claims', '', true);
  v_t := (select string_agg(distinct k, ',') from jsonb_array_elements(coalesce(v_j2 -> 'blocks', '[]'::jsonb)) as b, jsonb_object_keys(b -> 'sections') as k);
  r_ok := r_ok || (v_st = 'ok' and v_j -> 'hidden_sections' = '["links", "problem"]'::jsonb and v_j -> 'opted_in' = 'null'::jsonb
    and v_t is not null and v_t !~ '(^|,)(problem|links)(,|$)');
  r_lb := r_lb || ('C03 hiding problem and links (sent twice): stored ' || coalesce(v_j ->> 'hidden_sections', '?') || ', visitor sees ' || coalesce(v_t, 'nothing'));

  -- C04 an unknown block is refused, nothing written (checked after the expected error)
  begin
    begin
      perform set_config('request.jwt.claims', pg_temp.dr_claims(v_own1), true);
      set local role authenticated;
      v_j := public.org_sm26_showcase_set(v_o1, null, array['deck']);
      v_st := 'no error';
    exception when others then v_st := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    select count(*) into v_n from public.org_sm26_showcase s where s.organization_id = v_o1;
    raise exception using errcode = 'DRY01';
  exception when sqlstate 'DRY01' then null;
  end;
  r_ok := r_ok || (v_st like '22023 Unknown section%' and v_n = 0);
  r_lb := r_lb || ('C04 an unknown block ("deck") is refused: ' || v_st || ', rows ' || v_n);

  -- C05 M3 staff may change any company's choice
  begin
    perform set_config('request.jwt.claims', pg_temp.dr_claims(v_mod), true);
    set local role authenticated;
    v_j := public.org_sm26_showcase_set(v_o2, true, '{}'::text[]);
    reset role;
    perform set_config('request.jwt.claims', '{"role": "anon"}', true);
    set local role anon;
    v_j2 := public.org_sm26_showcase(v_o2);
    reset role;
    perform set_config('request.jwt.claims', '', true);
    v_st := 'ok';
    raise exception using errcode = 'DRY01';
  exception
    when sqlstate 'DRY01' then null;
    when others then v_st := sqlstate || ' ' || sqlerrm;
  end;
  reset role; perform set_config('request.jwt.claims', '', true);
  r_ok := r_ok || (v_st = 'ok' and (v_j ->> 'can_edit')::boolean and (v_j ->> 'opted_in')::boolean and v_j2 is not null);
  r_lb := r_lb || ('C05 a moderator opts the restricted startup in: ' || v_st || ', shown ' || (v_j2 is not null));

  -- C06 an archived company shows nothing
  begin
    update public.organizations set archived_at = now() where id = v_o1;
    perform set_config('request.jwt.claims', '{"role": "anon"}', true);
    set local role anon;
    v_j2 := public.org_sm26_showcase(v_o1);
    reset role;
    perform set_config('request.jwt.claims', '', true);
    v_st := 'ok';
    raise exception using errcode = 'DRY01';
  exception
    when sqlstate 'DRY01' then null;
    when others then v_st := sqlstate || ' ' || sqlerrm;
  end;
  reset role; perform set_config('request.jwt.claims', '', true);
  r_ok := r_ok || (v_st = 'ok' and v_j2 is null);
  r_lb := r_lb || ('C06 once archived, the open startup shows nothing: ' || v_st);

  -- C07 the owner cannot write the table directly
  begin
    begin
      perform set_config('request.jwt.claims', pg_temp.dr_claims(v_own1), true);
      set local role authenticated;
      insert into public.org_sm26_showcase (organization_id, opted_in) values (v_o1, true);
      v_st := 'no error';
    exception when others then v_st := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    select count(*) into v_n from public.org_sm26_showcase s where s.organization_id = v_o1;
    raise exception using errcode = 'DRY01';
  exception when sqlstate 'DRY01' then null;
  end;
  r_ok := r_ok || (v_st like '42501%' and v_n = 0);
  r_lb := r_lb || ('C07 the owner cannot insert into the table directly: ' || v_st || ', rows ' || v_n);

  -- C08 the service role reads the public view
  begin
    perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
    set local role service_role;
    v_j := public.org_sm26_showcase(v_o1);
    v_st := 'ok';
  exception when others then v_st := sqlstate || ' ' || sqlerrm; v_j := null;
  end;
  reset role; perform set_config('request.jwt.claims', '', true);
  r_ok := r_ok || (v_st = 'ok' and v_j is not null);
  r_lb := r_lb || ('C08 the service role reads the public view: ' || v_st);

  insert into _dr_res (ok, label) select u.ok, u.lb from unnest(r_ok, r_lb) as u(ok, lb);
end
$cases$;

-- S01 nothing else moved (the cases' writes rolled back with their sub-transactions)
insert into _dr_res (ok, label)
select not exists ((select k, v from _dr_before) except (select k, v from pg_temp.dr_snap())),
       'S01 after the migration and the cases: sm_* rows, organizations, audit log, policies, other ACLs, tables, triggers unchanged: '
       || coalesce((select string_agg(b.k, ',') from _dr_before b join pg_temp.dr_snap() a on a.k = b.k where a.v is distinct from b.v), 'all equal');

-- D. The down, verbatim ──────────────────────────────────────────────────────────
-- DOWN of supabase/migrations/20261020140000_org_sm26_showcase.sql. NOT A MIGRATION: run it
-- only to take the feature out (with Victor's OK), after the redesign's client that calls
-- org_sm26_showcase* is gone from the live site (else the company pages and the dashboard row
-- just show nothing: the calls fail and the client hides the block).
-- It DROPS the companies' choices (public.org_sm26_showcase). Keep a copy first if any row
-- exists:  select * from public.org_sm26_showcase;
-- The 'sm26_showcase_changed' lines in organization_audit_log stay (history).
-- Checked by the same dry run as the migration (supabase/dryrun/20261020140000_org_sm26_showcase.dryrun.sql).

set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop function if exists public.org_sm26_showcase_set(uuid, boolean, text[]);
drop function if exists public.org_sm26_showcase_settings(uuid);
drop function if exists public.org_sm26_showcase(uuid);
drop function if exists public.org_sm26_showcase_entries(uuid);
drop function if exists public.org_sm26_showcase_links(jsonb, text);
drop table if exists public.org_sm26_showcase;

do $post$
begin
  if to_regclass('public.org_sm26_showcase') is not null
     or exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and left(p.proname, 17) = 'org_sm26_showcase') then
    raise exception 'org_sm26_showcase down: something is left';
  end if;
end
$post$;
-- ─────────────────────────────────────────────────────────────────────────────────

-- E. Checks after the down, then the report
do $e$
declare
  v_txt text;
begin
  insert into _dr_res (ok, label) values (
    to_regclass('public.org_sm26_showcase') is null
      and not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and left(p.proname, 17) = 'org_sm26_showcase'),
    'E01 the down removed the table and the five functions');
  insert into _dr_res (ok, label)
  select not exists ((select k, v from _dr_before) except (select k, v from pg_temp.dr_snap())),
         'E02 after the down: everything back to the snapshot: '
         || coalesce((select string_agg(b.k, ',') from _dr_before b join pg_temp.dr_snap() a on a.k = b.k where a.v is distinct from b.v), 'all equal');
  select string_agg(case when r.ok then 'PASS ' else 'FAIL ' end || r.label, chr(10) order by r.n) into v_txt from _dr_res r;
  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (org_sm26_showcase dry run, run %s)',
    (select count(*) from _dr_res where ok), (select count(*) from _dr_res where ok is not true), now()) || chr(10) || v_txt;
end
$e$;
