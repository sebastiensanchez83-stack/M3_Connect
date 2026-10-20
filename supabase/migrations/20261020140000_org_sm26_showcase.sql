-- org_sm26_showcase: a company's Smart Marina 2026 catalogue and jury texts on its public page
-- (Victor, 20 Oct 2026: "les fiches des entreprises montrent les details donnes lors de leur
-- inscription a la Smart pour le catalogue et le jury"). NOT APPLIED. Apply with Victor's OK,
-- after its two dry runs, supabase/dryrun/20261020140000_org_sm26_showcase.dryrun.sql and
-- .dryrun-2.sql (each runs this file, then its down, in one rolled-back transaction).
-- Down: supabase/migrations/down/20261020140000_org_sm26_showcase.down.sql.
--
-- ADDITIVE ONLY. No sm_* table is written or altered (SM26 stays frozen): the sm_* rows are
-- READ by SECURITY DEFINER functions that return a fixed list of fields. Nothing existing is
-- redefined. Independent of every other pending file; any order.
--
-- What a visitor can see (public.org_sm26_showcase, open to anyone): for a company M3 verified
-- (not archived, not merged into another), its latest confirmed SM26 entry of each kind
-- (registration confirmed, role not declined):
--   startup (sm_startup_profile): activity, problem, solution, differentiation, usp,
--     target_markets, business_model, positioning (competitive_positioning), collaboration
--     (collaboration_expected), references (references_text), links (social_links: linkedin,
--     instagram, facebook, twitter, x, youtube, tiktok and website values that look like a web
--     address, never a personal LinkedIn page, linkedin.com/in/ or /pub/);
--   architect, professional entries only (sm_architecture_entry): description
--     (company_description), sustainability (sustainability_statement), references
--     (references_text). Victor's list; no links and no field (social links of a one-person
--     practice are often the architect's own accounts). Renders are a follow-up.
-- NEVER returned: the pitch deck, pitch media, the funding fields (funds_needed,
-- investment_seeking/stage/type), the startup stage and categories, team members and team size,
-- anon codes, jury data, consents, visibility_level, storage paths (logos, product images,
-- renders and the e-catalogue file are in the private event-media bucket; images are a follow-up)
-- and student entries (a person). The free texts above are returned as the company wrote them:
-- an amount written inside one of them is shown (the dashboard flags such texts to the owner).
--
-- Defaults and the company's choice (public.org_sm26_showcase, one row per company AND kind,
-- written only through public.org_sm26_showcase_set):
--   opted_in null  = no choice yet: shown, EXCEPT a restricted entry (startup visibility_level 1,
--                    or module_data.ecat_consent not 'Yes'), which shows nothing until the
--                    company opts in;
--   opted_in true  = shown; opted_in false = nothing of that entry shown;
--   hidden_sections = the blocks of that entry the company hides (keys above, per kind).
-- Who changes it: the company owner (organizations.owner_user_id, or a member whose role is
-- 'owner') and M3 staff (public.is_moderator()). Staff may hide anything, but only the owner
-- may switch on a restricted entry that is not already on. Every member of the company can
-- read the settings (public.org_sm26_showcase_settings). Each change is logged with
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
      ('sm_architecture_entry', 'sustainability_statement'), ('sm_architecture_entry', 'references_text'),
      ('sm_architecture_entry', 'updated_at'),
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

-- 1. The company's choice, one row per entry kind. Nobody reads or writes it directly: the
--    functions below do.
create table public.org_sm26_showcase (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null,
  opted_in boolean,
  hidden_sections text[] not null default '{}'::text[],
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint org_sm26_showcase_pkey primary key (organization_id, kind),
  constraint org_sm26_showcase_kind check (kind in ('startup', 'architect')),
  constraint org_sm26_showcase_sections check (
    case kind
      when 'startup' then hidden_sections <@ array['activity', 'problem', 'solution', 'differentiation', 'usp',
        'target_markets', 'business_model', 'positioning', 'collaboration', 'references', 'links']::text[]
      when 'architect' then hidden_sections <@ array['description', 'sustainability', 'references']::text[]
      else false
    end)
);
comment on table public.org_sm26_showcase is
  'A company''s choice about its Smart Marina 2026 texts on its public page, per entry kind (startup, architect): opted_in (null = default, true = show, false = hide all of that entry) and the hidden blocks. Read and written only through org_sm26_showcase_settings / org_sm26_showcase_set.';
alter table public.org_sm26_showcase enable row level security;
revoke all on table public.org_sm26_showcase from public, anon, authenticated;
grant all on table public.org_sm26_showcase to service_role;

-- 2. A startup's links: only web addresses, never a personal LinkedIn page. Internal.
create function public.org_sm26_showcase_links(p_links jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  select nullif(coalesce(jsonb_object_agg(l.k, l.v), '{}'::jsonb), '{}'::jsonb)
    from (select lower(e.key) as k, btrim(e.value) as v
            from jsonb_each_text(case when jsonb_typeof(p_links) = 'object' then p_links else '{}'::jsonb end) as e) as l
   where l.k in ('linkedin', 'instagram', 'facebook', 'twitter', 'x', 'youtube', 'tiktok', 'website')
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
                'links', public.org_sm26_showcase_links(sp.social_links))) as sections
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
                'references', nullif(btrim(ae.references_text), '')))
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
  with shown as (
    select e.kind,
           (select jsonb_object_agg(k.key, k.value)
              from jsonb_each(e.sections) as k
             where k.key <> all (coalesce(s.hidden_sections, '{}'::text[]))) as sections
      from public.organizations o
      cross join lateral public.org_sm26_showcase_entries(o.id) as e
      left join public.org_sm26_showcase s on s.organization_id = o.id and s.kind = e.kind
     where o.id = p_org_id
       and o.access_status = 'verified'
       and o.archived_at is null
       and o.duplicate_of is null
       and coalesce(s.opted_in, e.restricted is false)
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
  v_is_owner boolean;
  v_can_edit boolean;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Sign in to see these settings' using errcode = '42501';
  end if;
  v_is_owner := exists (select 1 from public.organizations o where o.id = p_org_id and o.owner_user_id = v_uid)
    or exists (select 1 from public.organization_members m
                where m.organization_id = p_org_id and m.user_id = v_uid and m.role = 'owner');
  v_can_edit := v_is_owner or public.is_moderator();
  if not v_can_edit
     and not exists (select 1 from public.organization_members m where m.organization_id = p_org_id and m.user_id = v_uid) then
    raise exception 'Only members of this company can see these settings' using errcode = '42501';
  end if;
  select jsonb_build_object(
           'can_edit', v_can_edit,
           'is_owner', v_is_owner,
           'listed', coalesce((select o.access_status = 'verified' and o.archived_at is null and o.duplicate_of is null
                                 from public.organizations o where o.id = p_org_id), false),
           'entries', coalesce(jsonb_agg(jsonb_build_object(
                        'kind', e.kind, 'restricted', e.restricted, 'restricted_reason', e.restricted_reason,
                        'sections', e.sections, 'opted_in', s.opted_in,
                        'hidden_sections', to_jsonb(coalesce(s.hidden_sections, '{}'::text[])), 'updated_at', s.updated_at)
                      order by e.kind desc), '[]'::jsonb))
    into v_result
    from public.org_sm26_showcase_entries(p_org_id) as e
    left join public.org_sm26_showcase s on s.organization_id = p_org_id and s.kind = e.kind;
  return v_result;
end
$fn$;

-- 6. The company's change for one entry kind: its owner or M3 staff. Returns the new settings.
create function public.org_sm26_showcase_set(p_org_id uuid, p_kind text, p_opted_in boolean, p_hidden_sections text[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_is_owner boolean;
  v_restricted boolean;
  v_current boolean;
  v_hidden text[];
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  v_is_owner := exists (select 1 from public.organizations o where o.id = p_org_id and o.owner_user_id = v_uid)
    or exists (select 1 from public.organization_members m
                where m.organization_id = p_org_id and m.user_id = v_uid and m.role = 'owner');
  if not (v_is_owner or public.is_moderator()) then
    raise exception 'Only the company owner or the M3 team can change this' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('startup', 'architect') then
    raise exception 'Unknown entry kind' using errcode = '22023';
  end if;
  select e.restricted into v_restricted
    from public.org_sm26_showcase_entries(p_org_id) as e
   where e.kind = p_kind;
  if not found then
    raise exception 'This company has no Smart Marina 2026 entry of this kind' using errcode = '22023';
  end if;
  select s.opted_in into v_current
    from public.org_sm26_showcase s
   where s.organization_id = p_org_id and s.kind = p_kind;
  -- M3 staff may hide anything, but never publish texts the company has not agreed to show.
  if not v_is_owner and v_restricted and p_opted_in is true and v_current is distinct from true then
    raise exception 'Only the company owner can choose to show these texts' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct h.v order by h.v), '{}'::text[]) into v_hidden
    from unnest(coalesce(p_hidden_sections, '{}'::text[])) as h(v)
   where h.v is not null;
  begin
    insert into public.org_sm26_showcase (organization_id, kind, opted_in, hidden_sections, updated_by, updated_at)
    values (p_org_id, p_kind, p_opted_in, v_hidden, v_uid, now())
    on conflict (organization_id, kind) do update
      set opted_in = excluded.opted_in,
          hidden_sections = excluded.hidden_sections,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at;
  exception when check_violation then
    raise exception 'Unknown section in %', v_hidden using errcode = '22023';
  end;
  perform public.log_org_event(p_org_id, 'sm26_showcase_changed',
    jsonb_build_object('kind', p_kind, 'opted_in', p_opted_in, 'hidden_sections', to_jsonb(v_hidden)));
  return public.org_sm26_showcase_settings(p_org_id);
end
$fn$;

-- 7. Who may call what.
revoke all on function public.org_sm26_showcase_links(jsonb) from public, anon, authenticated;
revoke all on function public.org_sm26_showcase_entries(uuid) from public, anon, authenticated;
revoke all on function public.org_sm26_showcase(uuid) from public, anon, authenticated;
revoke all on function public.org_sm26_showcase_settings(uuid) from public, anon, authenticated;
revoke all on function public.org_sm26_showcase_set(uuid, text, boolean, text[]) from public, anon, authenticated;
grant execute on function public.org_sm26_showcase_links(jsonb) to service_role;
grant execute on function public.org_sm26_showcase_entries(uuid) to service_role;
grant execute on function public.org_sm26_showcase(uuid) to anon, authenticated, service_role;
grant execute on function public.org_sm26_showcase_settings(uuid) to authenticated, service_role;
grant execute on function public.org_sm26_showcase_set(uuid, text, boolean, text[]) to authenticated, service_role;

-- After: the privileges exactly as intended, else the whole file rolls back.
do $post$
declare
  v_bad text;
begin
  select string_agg(f.fn || ' ' || f.who, ', ') into v_bad
    from (values
      ('public.org_sm26_showcase_links(jsonb)', 'anon', false), ('public.org_sm26_showcase_links(jsonb)', 'authenticated', false),
      ('public.org_sm26_showcase_entries(uuid)', 'anon', false), ('public.org_sm26_showcase_entries(uuid)', 'authenticated', false),
      ('public.org_sm26_showcase(uuid)', 'anon', true), ('public.org_sm26_showcase(uuid)', 'authenticated', true),
      ('public.org_sm26_showcase_settings(uuid)', 'anon', false), ('public.org_sm26_showcase_settings(uuid)', 'authenticated', true),
      ('public.org_sm26_showcase_set(uuid, text, boolean, text[])', 'anon', false),
      ('public.org_sm26_showcase_set(uuid, text, boolean, text[])', 'authenticated', true)
    ) as f(fn, who, want)
   where has_function_privilege(f.who, f.fn, 'execute') is distinct from f.want
      or exists (select 1 from aclexplode((select p.proacl from pg_proc p where p.oid = f.fn::regprocedure)) a where a.grantee = 0)
      or not has_function_privilege('service_role', f.fn, 'execute');
  if v_bad is not null then
    raise exception 'org_sm26_showcase: wrong function privileges: %', v_bad;
  end if;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and left(p.proname, 17) = 'org_sm26_showcase') <> 5 then
    raise exception 'org_sm26_showcase: expected exactly five functions';
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
