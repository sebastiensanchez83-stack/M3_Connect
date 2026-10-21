-- DRY RUN of supabase/migrations/20261021141000_org_visitor_teaser.sql and of its down.
-- NOT A MIGRATION. ONE query text, ONE execute_sql call, BEFORE the file is applied.
-- A snapshot, the migration verbatim, fixtures (a validated marina with details and plans, a
-- pending company, an archived one, a merged copy: inserted in this transaction only), checks as
-- postgres, anon, an account M3 has not validated and a validated member, on the fixtures and on
-- every real company, then the down verbatim and checks again. No sm_* row is written: the Smart
-- Marina 2026 cases read the real entries through the existing functions.
-- Ends with RAISE EXCEPTION 'DRYRUN ...': everything rolls back. Expected: "16 PASS, 0 FAIL".

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
-- What a signed-out visitor (or an account M3 has not validated yet) sees of a company page
-- (go-live runbook P2 item 2; Victor's answers of 21 Oct 2026: Q1 = C "generous", Q2 = an
-- account validated by M3, Q3 = the first block of the Smart Marina 2026 texts public).
-- Down: supabase/migrations/down/20261021141000_org_visitor_teaser.down.sql
-- Dry run: supabase/dryrun/20261021141000_org_visitor_teaser.dryrun.sql (this file, checks as
-- postgres, anon, a pending account and a validated member, then the down, in one rolled-back
-- transaction).
--
-- ADDITIVE, SAFE FOR MAIN. Two read-only SECURITY DEFINER functions, open to anyone. Nothing
-- existing is changed; main does not call them.
--
-- 1. public.org_visitor_teaser(p_org_id) -> jsonb, BOOLEANS AND COUNTS ONLY, never a value:
--      team               people in the company (the public "N members", as org_public_member_counts)
--      gallery            photos in the gallery
--      has_website        a website is set
--      has_marina_details the marina has a details row
--      marina_facilities  how many of its 6 facilities are ticked (yard, concierge, restaurants,
--                         fresh water, yacht club, sailing school)
--      marina_texts       how many of its 2 texts are written (about the marina, services)
--      plans              its purchase projects (organization_future_plans), marinas only
--      sm26_texts_more    its Smart Marina 2026 sustainability texts beyond the first, marinas only
--      showcase_more      the Smart Marina 2026 catalogue / jury sections beyond the public ones
--    The page draws the locked blocks from it: "Facilities, 2 descriptions and 3 purchase
--    projects", "5 people from X are on Smart Marina Connect", without loading what is locked.
-- 2. public.org_public_highlights(p_org_id) -> jsonb, the few VALUES that stay public in
--    variant C although they sit in tables that close to visitors at go-live:
--      marina      the key figures of a marina: status (marina_type), berths, superyacht berths,
--                  longest berth, certifications. NOT the facilities, the two texts, the dates.
--      sm26_marina the FIRST written text of the marina's Smart Marina 2026 sustainability entry
--                  (in the page's order: architectural quality, biodiversity, water, energy,
--                  waste, innovation, security, sustainable differentiation, more), its key and
--                  its text. No image: the evidence images close to visitors at go-live.
--      showcase    the public block of the company's Smart Marina 2026 catalogue and jury texts,
--                  from public.org_sm26_showcase (so only what the company lets show): for a
--                  startup "activity" and "solution", for an architecture practice "description".
--    Each key is null when there is nothing.
-- Both answer null for a company that is not validated, archived or merged into another
-- (organizations.access_status / archived_at / duplicate_of), like org_public_member_counts.
-- Both run as their owner, so they keep working when anon loses the tables and the SM26 functions
-- at go-live (held/directory_visitor_basic.sql). They read sm_* through the existing functions
-- sm_org_marina_submission and org_sm26_showcase: no sm_* table is read directly or written.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
declare
  v_missing text;
begin
  if to_regprocedure('public.org_visitor_teaser(uuid)') is not null
     or to_regprocedure('public.org_public_highlights(uuid)') is not null then
    raise exception 'org_visitor_teaser: a function already exists';
  end if;
  if to_regprocedure('public.sm_org_marina_submission(uuid)') is null
     or to_regprocedure('public.org_sm26_showcase(uuid)') is null then
    raise exception 'org_visitor_teaser: sm_org_marina_submission(uuid) or org_sm26_showcase(uuid) is missing';
  end if;
  select string_agg(w.t || '.' || w.c, ', ') into v_missing
    from (values
      ('organizations', 'id'), ('organizations', 'organization_type'), ('organizations', 'access_status'),
      ('organizations', 'archived_at'), ('organizations', 'duplicate_of'), ('organizations', 'gallery'),
      ('organizations', 'website'), ('organization_members', 'organization_id'),
      ('organization_future_plans', 'organization_id'), ('organization_marina_details', 'organization_id'),
      ('organization_marina_details', 'marina_type'), ('organization_marina_details', 'berths_count'),
      ('organization_marina_details', 'superyacht_berths'), ('organization_marina_details', 'longest_berth_meters'),
      ('organization_marina_details', 'certifications'), ('organization_marina_details', 'certifications_other'),
      ('organization_marina_details', 'has_boat_yard'), ('organization_marina_details', 'has_concierge'),
      ('organization_marina_details', 'has_restaurants'), ('organization_marina_details', 'fresh_water_available'),
      ('organization_marina_details', 'has_yacht_club'), ('organization_marina_details', 'has_sailing_school'),
      ('organization_marina_details', 'marina_description'), ('organization_marina_details', 'services_description')
    ) as w(t, c)
   where not exists (select 1 from information_schema.columns c
                      where c.table_schema = 'public' and c.table_name = w.t and c.column_name = w.c);
  if v_missing is not null then
    raise exception 'org_visitor_teaser: column(s) missing: %', v_missing;
  end if;
end
$pre$;

create function public.org_visitor_teaser(p_org_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select jsonb_build_object(
    'team', (select count(*)::integer from public.organization_members m where m.organization_id = o.id),
    'gallery', case when jsonb_typeof(o.gallery) = 'array'
                    then (select count(*)::integer from jsonb_array_elements(o.gallery) as g(v)
                           where jsonb_typeof(g.v) = 'string' and length(btrim(g.v #>> '{}')) > 0)
                    else 0 end,
    'has_website', length(btrim(coalesce(o.website, ''))) > 0,
    'has_marina_details', d.organization_id is not null,
    'marina_facilities', case when d.organization_id is null then 0 else
        coalesce(d.has_boat_yard, false)::integer + coalesce(d.has_concierge, false)::integer
      + coalesce(d.has_restaurants, false)::integer + coalesce(d.fresh_water_available, false)::integer
      + coalesce(d.has_yacht_club, false)::integer + coalesce(d.has_sailing_school, false)::integer end,
    'marina_texts', case when d.organization_id is null then 0 else
        (length(btrim(coalesce(d.marina_description, ''))) > 0)::integer
      + (length(btrim(coalesce(d.services_description, ''))) > 0)::integer end,
    'plans', case when o.organization_type = 'marina'
                  then (select count(*)::integer from public.organization_future_plans f where f.organization_id = o.id)
                  else 0 end,
    'sm26_texts_more', case when o.organization_type = 'marina'
        then greatest((select count(*)::integer
                         from (select public.sm_org_marina_submission(o.id) as sub) as s
                         cross join unnest(array['architectural_quality', 'biodiversity', 'water', 'energy', 'waste',
                                                 'innovation', 'security', 'sustainable_diff', 'further_info']) as k(key)
                        where length(btrim(coalesce(s.sub ->> k.key, ''))) > 0) - 1, 0)
        else 0 end,
    'showcase_more', (select count(*)::integer
        from (select public.org_sm26_showcase(o.id) as sc) as s
        cross join lateral jsonb_array_elements(coalesce(s.sc -> 'blocks', '[]'::jsonb)) as e(b)
        cross join lateral jsonb_each(coalesce(e.b -> 'sections', '{}'::jsonb)) as k(key, value)
       where not ((e.b ->> 'kind' = 'startup' and k.key in ('activity', 'solution'))
                  or (e.b ->> 'kind' = 'architect' and k.key = 'description'))
         and ((jsonb_typeof(k.value) = 'string' and length(btrim(k.value #>> '{}')) > 0)
              or (jsonb_typeof(k.value) = 'object' and k.value <> '{}'::jsonb)))
  )
  from public.organizations o
  left join public.organization_marina_details d on d.organization_id = o.id and o.organization_type = 'marina'
  where o.id = p_org_id
    and o.access_status = 'verified'
    and o.archived_at is null
    and o.duplicate_of is null
$fn$;

comment on function public.org_visitor_teaser(uuid) is
  'What the locked blocks of a validated company page hold, as booleans and counts only (team, gallery, has_website, has_marina_details, marina_facilities, marina_texts, plans, sm26_texts_more, showcase_more). Null for a company that is not validated, archived or merged. Public. 20261021141000.';

create function public.org_public_highlights(p_org_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select jsonb_build_object(
    'marina', (select jsonb_build_object(
                 'marina_type', d.marina_type,
                 'berths_count', d.berths_count,
                 'superyacht_berths', d.superyacht_berths,
                 'longest_berth_meters', d.longest_berth_meters,
                 'certifications', to_jsonb(coalesce(d.certifications, '{}'::text[])),
                 'certifications_other', d.certifications_other)
                 from public.organization_marina_details d
                where d.organization_id = o.id and o.organization_type = 'marina'),
    'sm26_marina', (select jsonb_build_object('key', k.key, 'text', btrim(s.sub ->> k.key))
                      from (select public.sm_org_marina_submission(o.id) as sub) as s
                      cross join unnest(array['architectural_quality', 'biodiversity', 'water', 'energy', 'waste',
                                              'innovation', 'security', 'sustainable_diff', 'further_info'])
                           with ordinality as k(key, ord)
                     where o.organization_type = 'marina'
                       and length(btrim(coalesce(s.sub ->> k.key, ''))) > 0
                     order by k.ord
                     limit 1),
    'showcase', (select jsonb_build_object('edition', s.sc ->> 'edition', 'blocks', x.blocks)
                   from (select public.org_sm26_showcase(o.id) as sc) as s
                   cross join lateral (
                     select jsonb_agg(jsonb_build_object('kind', e.b ->> 'kind', 'sections', pub.sections) order by e.ord) as blocks
                       from jsonb_array_elements(coalesce(s.sc -> 'blocks', '[]'::jsonb)) with ordinality as e(b, ord)
                       cross join lateral (
                         select jsonb_object_agg(k.key, btrim(k.value #>> '{}')) as sections
                           from jsonb_each(coalesce(e.b -> 'sections', '{}'::jsonb)) as k(key, value)
                          where ((e.b ->> 'kind' = 'startup' and k.key in ('activity', 'solution'))
                                 or (e.b ->> 'kind' = 'architect' and k.key = 'description'))
                            and jsonb_typeof(k.value) = 'string'
                            and length(btrim(k.value #>> '{}')) > 0) as pub
                      where pub.sections is not null) as x
                  where x.blocks is not null)
  )
  from public.organizations o
  where o.id = p_org_id
    and o.access_status = 'verified'
    and o.archived_at is null
    and o.duplicate_of is null
$fn$;

comment on function public.org_public_highlights(uuid) is
  'The values of a validated company page that stay public when their tables close to visitors (variant C, 21 Oct 2026): a marina''s key figures (status, berths, superyacht berths, longest berth, certifications), the first Smart Marina 2026 sustainability text of a marina, and the public block of the Smart Marina 2026 catalogue texts (startup: activity, solution; architect: description). Null for a company that is not validated, archived or merged. Public. 20261021141000.';

revoke all on function public.org_visitor_teaser(uuid) from public;
revoke all on function public.org_public_highlights(uuid) from public;
grant execute on function public.org_visitor_teaser(uuid) to anon, authenticated, service_role;
grant execute on function public.org_public_highlights(uuid) to anon, authenticated, service_role;

-- C. Fixtures (this transaction only) and checks
create temp table _dr_ids on commit drop as
  select gen_random_uuid() as m, gen_random_uuid() as p, gen_random_uuid() as a, gen_random_uuid() as d,
         substr(md5(random()::text), 1, 8) as r8;

do $fx$
declare
  v record;
  v_s1 uuid;
  v_s2 uuid;
begin
  select * into v from _dr_ids;
  select s.id into v_s1 from public.sectors s order by s.id limit 1;
  select s.id into v_s2 from public.sectors s where s.id <> v_s1 order by s.id limit 1;
  insert into public.organizations (id, name, slug, access_status, onboarding_status, organization_type, website, gallery)
  values (v.m, 'Dryrun Marina ' || v.r8, 'dryrun-teaser-m-' || v.r8, 'verified', 'completed', 'marina', 'https://example.invalid',
          '["https://example.invalid/1.jpg", "https://example.invalid/2.jpg", " "]'::jsonb);
  insert into public.organization_marina_details (organization_id, marina_type, berths_count, superyacht_berths, longest_berth_meters,
              certifications, certifications_other, has_boat_yard, has_concierge, has_restaurants, fresh_water_available,
              has_yacht_club, has_sailing_school, marina_description, services_description)
  values (v.m, 'in_operation', 120, 4, 60.5, array['Blue Flag'], 'ISO 14001', true, true, true, false, false, true,
          'A marina description that stays for members.', '  ');
  insert into public.organization_future_plans (organization_id, sector_id, timeline) values (v.m, v_s1, '0-3months'), (v.m, v_s2, '1-3years');
  insert into public.organizations (id, name, slug, access_status, onboarding_status, organization_type)
  values (v.p, 'Dryrun Pending ' || v.r8, 'dryrun-teaser-p-' || v.r8, 'pending', 'submitted', 'partner');
  insert into public.organizations (id, name, slug, access_status, onboarding_status, organization_type, archived_at)
  values (v.a, 'Dryrun Archived ' || v.r8, 'dryrun-teaser-a-' || v.r8, 'verified', 'completed', 'partner', now());
  insert into public.organizations (id, name, slug, access_status, onboarding_status, organization_type, duplicate_of)
  values (v.d, 'Dryrun Merged ' || v.r8, 'dryrun-teaser-d-' || v.r8, 'verified', 'completed', 'marina', v.m);
end
$fx$;

do $c$
declare
  v record;
  v_pending uuid;
  v_pending_label text;
  v_member uuid;
  v_teaser jsonb;
  v_high jsonb;
  v_out text;
  v_n integer;
  v_bad integer;
  v_keys constant text[] := array['architectural_quality', 'biodiversity', 'water', 'energy', 'waste', 'innovation', 'security', 'sustainable_diff', 'further_info'];
  v_o record;
  v_sub jsonb;
  v_first text;
  v_cnt integer;
  v_sc jsonb;
  v_pub jsonb;
  v_more integer;
begin
  select * into v from _dr_ids;
  -- An account M3 has not validated: a real pending profile if there is one, else an unknown id
  -- (no profile, so not validated either).
  select p.user_id into v_pending from public.profiles p where p.access_status = 'pending' order by p.user_id limit 1;
  v_pending_label := case when v_pending is null then 'an account with no profile' else 'a pending account' end;
  v_pending := coalesce(v_pending, gen_random_uuid());
  select p.user_id into v_member from public.profiles p
   where p.access_status = 'verified' and p.persona::text not in ('admin', 'moderator') order by p.user_id limit 1;

  -- C1 shape
  insert into _dr_res (ok, label) values (
    (select count(*) from pg_proc p
      where p.oid in (to_regprocedure('public.org_visitor_teaser(uuid)'), to_regprocedure('public.org_public_highlights(uuid)'))
        and p.prosecdef and p.provolatile = 's' and p.prokind = 'f'
        and array_to_string(p.proconfig, ';') = 'search_path=""'
        and p.prorettype = 'jsonb'::regtype
        and p.proowner = (select q.proowner from pg_proc q where q.oid = to_regprocedure('public.org_public_member_counts(uuid[])'))) = 2,
    'C1 org_visitor_teaser(uuid) and org_public_highlights(uuid): SECURITY DEFINER, STABLE, search_path "", jsonb, same owner as org_public_member_counts');

  -- C2 who may call them
  insert into _dr_res (ok, label) values (
    coalesce(has_function_privilege('anon', 'public.org_visitor_teaser(uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.org_visitor_teaser(uuid)', 'execute')
      and has_function_privilege('service_role', 'public.org_visitor_teaser(uuid)', 'execute')
      and has_function_privilege('anon', 'public.org_public_highlights(uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.org_public_highlights(uuid)', 'execute')
      and has_function_privilege('service_role', 'public.org_public_highlights(uuid)', 'execute')
      and not exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
                       where p.oid in (to_regprocedure('public.org_visitor_teaser(uuid)'), to_regprocedure('public.org_public_highlights(uuid)'))
                         and a.grantee = 0), false),
    'C2 EXECUTE for anon, authenticated, service_role; none for PUBLIC');

  -- C3 the teaser of the fixture marina, exactly
  v_teaser := public.org_visitor_teaser(v.m);
  insert into _dr_res (ok, label) values (
    v_teaser = '{"team": 0, "gallery": 2, "has_website": true, "has_marina_details": true, "marina_facilities": 4, "marina_texts": 1, "plans": 2, "sm26_texts_more": 0, "showcase_more": 0}'::jsonb,
    'C3 fixture marina teaser: ' || coalesce(v_teaser::text, 'null'));

  -- C4 booleans and counts only, the same 9 keys, on every validated listed company
  select count(*) into v_bad
    from public.organizations o
    cross join lateral (select public.org_visitor_teaser(o.id) as t) x
   where o.access_status = 'verified' and o.archived_at is null and o.duplicate_of is null
     and (x.t is null
          or (select count(*) from jsonb_object_keys(x.t)) <> 9
          or exists (select 1 from jsonb_each(x.t) k where jsonb_typeof(k.value) not in ('number', 'boolean'))
          or exists (select 1 from jsonb_each(x.t) k where jsonb_typeof(k.value) = 'number' and (k.value #>> '{}')::numeric < 0));
  select count(*) into v_n from public.organizations o where o.access_status = 'verified' and o.archived_at is null and o.duplicate_of is null;
  insert into _dr_res (ok, label) values (v_bad = 0,
    'C4 every validated listed company (' || v_n || '): 9 keys, numbers >= 0 and booleans only; ' || v_bad || ' bad');

  -- C5 the team count is the public member count
  select count(*) into v_bad
    from public.organizations o
    left join public.org_public_member_counts(array(select o2.id from public.organizations o2
                                                      where o2.access_status = 'verified' and o2.archived_at is null and o2.duplicate_of is null)) c
           on c.organization_id = o.id
   where o.access_status = 'verified' and o.archived_at is null and o.duplicate_of is null
     and (public.org_visitor_teaser(o.id) ->> 'team')::integer <> coalesce(c.members, 0);
  insert into _dr_res (ok, label) values (v_bad = 0, 'C5 team = org_public_member_counts on every listed company (' || v_bad || ' differ)');

  -- C6 nothing for a company that is not validated, archived, merged, or unknown
  insert into _dr_res (ok, label) values (
    public.org_visitor_teaser(v.p) is null and public.org_visitor_teaser(v.a) is null
      and public.org_visitor_teaser(v.d) is null and public.org_visitor_teaser(gen_random_uuid()) is null
      and public.org_public_highlights(v.p) is null and public.org_public_highlights(v.a) is null
      and public.org_public_highlights(v.d) is null and public.org_public_highlights(gen_random_uuid()) is null
      and public.org_visitor_teaser(null) is null and public.org_public_highlights(null) is null,
    'C6 both null for a pending, an archived, a merged, an unknown and a null company');

  -- C7 the public values of the fixture marina, exactly
  v_high := public.org_public_highlights(v.m);
  insert into _dr_res (ok, label) values (
    v_high = '{"marina": {"marina_type": "in_operation", "berths_count": 120, "superyacht_berths": 4, "longest_berth_meters": 60.5, "certifications": ["Blue Flag"], "certifications_other": "ISO 14001"}, "sm26_marina": null, "showcase": null}'::jsonb,
    'C7 fixture marina highlights: ' || coalesce(v_high::text, 'null'));

  -- C8 the marina part never carries a locked field, on every validated marina
  select count(*) into v_bad
    from public.organizations o
    cross join lateral (select public.org_public_highlights(o.id) -> 'marina' as mk) x
   where o.access_status = 'verified' and o.archived_at is null and o.duplicate_of is null and o.organization_type = 'marina'
     and jsonb_typeof(x.mk) = 'object'
     and (x.mk - array['marina_type', 'berths_count', 'superyacht_berths', 'longest_berth_meters', 'certifications', 'certifications_other']) <> '{}'::jsonb;
  select count(*) into v_n from public.organizations o
   where o.access_status = 'verified' and o.archived_at is null and o.duplicate_of is null and o.organization_type = 'marina'
     and jsonb_typeof(public.org_public_highlights(o.id) -> 'marina') = 'object';
  insert into _dr_res (ok, label) values (v_bad = 0,
    'C8 ' || v_n || ' marina(s) with figures: only status, berths, superyacht berths, longest berth, certifications; ' || v_bad || ' with more');

  -- C9 the first Smart Marina 2026 sustainability text, and how many stay locked, on every real marina entry
  v_n := 0; v_bad := 0;
  for v_o in select o.id from public.organizations o
              where o.access_status = 'verified' and o.archived_at is null and o.duplicate_of is null and o.organization_type = 'marina' loop
    v_sub := public.sm_org_marina_submission(v_o.id);
    v_first := null; v_cnt := 0;
    if v_sub is not null then
      for i in 1 .. array_length(v_keys, 1) loop
        if length(btrim(coalesce(v_sub ->> v_keys[i], ''))) > 0 then
          v_cnt := v_cnt + 1;
          if v_first is null then v_first := v_keys[i]; end if;
        end if;
      end loop;
    end if;
    v_high := public.org_public_highlights(v_o.id);
    v_teaser := public.org_visitor_teaser(v_o.id);
    if v_first is not null then v_n := v_n + 1; end if;
    if (v_first is null and (v_high -> 'sm26_marina') <> 'null'::jsonb)
       or (v_first is not null and ((v_high -> 'sm26_marina') is distinct from jsonb_build_object('key', v_first, 'text', btrim(v_sub ->> v_first))))
       or (v_teaser ->> 'sm26_texts_more')::integer <> greatest(v_cnt - 1, 0) then
      v_bad := v_bad + 1;
    end if;
  end loop;
  insert into _dr_res (ok, label) values (v_bad = 0,
    'C9 ' || v_n || ' marina(s) with SM26 texts: the first text in page order is public, the count of the others matches; ' || v_bad || ' differ');

  -- C10 the public block of the Smart Marina 2026 catalogue texts, on every real company that shows some
  v_n := 0; v_bad := 0;
  for v_o in select o.id from public.organizations o
              where o.access_status = 'verified' and o.archived_at is null and o.duplicate_of is null loop
    v_sc := public.org_sm26_showcase(v_o.id);
    if v_sc is null then
      if (public.org_public_highlights(v_o.id) -> 'showcase') <> 'null'::jsonb
         or (public.org_visitor_teaser(v_o.id) ->> 'showcase_more')::integer <> 0 then
        v_bad := v_bad + 1;
      end if;
      continue;
    end if;
    v_n := v_n + 1;
    -- expected: per block, the public keys with a text; and the count of every other filled section
    select jsonb_agg(jsonb_build_object('kind', e.b ->> 'kind', 'sections', x.s) order by e.ord) into v_pub
      from jsonb_array_elements(v_sc -> 'blocks') with ordinality as e(b, ord)
      cross join lateral (select jsonb_object_agg(k.key, btrim(k.value #>> '{}')) as s
                            from jsonb_each(e.b -> 'sections') k
                           where k.key = any (case e.b ->> 'kind' when 'startup' then array['activity', 'solution']
                                                                  when 'architect' then array['description'] else array[]::text[] end)
                             and jsonb_typeof(k.value) = 'string' and length(btrim(k.value #>> '{}')) > 0) x
     where x.s is not null;
    select count(*)::integer into v_more
      from jsonb_array_elements(v_sc -> 'blocks') e(b)
      cross join lateral jsonb_each(e.b -> 'sections') k
     where not (k.key = any (case e.b ->> 'kind' when 'startup' then array['activity', 'solution']
                                                when 'architect' then array['description'] else array[]::text[] end))
       and ((jsonb_typeof(k.value) = 'string' and length(btrim(k.value #>> '{}')) > 0)
            or (jsonb_typeof(k.value) = 'object' and k.value <> '{}'::jsonb));
    v_high := public.org_public_highlights(v_o.id);
    if (v_high -> 'showcase' -> 'blocks') is distinct from v_pub
       and not (v_pub is null and (v_high -> 'showcase') = 'null'::jsonb) then
      v_bad := v_bad + 1;
    elsif (public.org_visitor_teaser(v_o.id) ->> 'showcase_more')::integer <> v_more then
      v_bad := v_bad + 1;
    end if;
  end loop;
  insert into _dr_res (ok, label) values (v_bad = 0,
    'C10 ' || v_n || ' company(ies) with SM26 catalogue texts: public = startup activity + solution / architect description only, the rest counted; ' || v_bad || ' differ');

  -- C11 a visitor gets the same answers
  v_out := pg_temp.dr_as('anon', null,
    format('select public.org_visitor_teaser(%L)::text || ''|'' || public.org_public_highlights(%L)::text', v.m, v.m));
  insert into _dr_res (ok, label) values (
    v_out = 'ok:' || public.org_visitor_teaser(v.m)::text || '|' || public.org_public_highlights(v.m)::text,
    'C11 anon: same teaser and highlights as postgres: ' || left(v_out, 120));

  -- C12 an account M3 has not validated gets the same
  v_out := pg_temp.dr_as('authenticated', v_pending,
    format('select public.org_visitor_teaser(%L)::text || ''|'' || public.org_public_highlights(%L)::text', v.m, v.m));
  insert into _dr_res (ok, label) values (
    v_out = 'ok:' || public.org_visitor_teaser(v.m)::text || '|' || public.org_public_highlights(v.m)::text,
    'C12 ' || v_pending_label || ': same answers: ' || left(v_out, 60));

  -- C13 a validated member gets the same
  v_out := pg_temp.dr_as('authenticated', v_member,
    format('select public.org_visitor_teaser(%L)::text || ''|'' || public.org_public_highlights(%L)::text', v.m, v.m));
  insert into _dr_res (ok, label) values (
    v_member is not null and v_out = 'ok:' || public.org_visitor_teaser(v.m)::text || '|' || public.org_public_highlights(v.m)::text,
    'C13 a validated member: same answers: ' || left(v_out, 60));

  -- C14 nothing else moved
  insert into _dr_res (ok, label) values (
    not exists ((select f.fn, f.acl, f.m from _dr_fn f)
                except
                (select p.oid::regprocedure::text, coalesce(array_to_string(p.proacl, ','), ''), md5(p.prosrc)
                   from pg_proc p where p.pronamespace = 'public'::regnamespace))
      and (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace) = (select count(*) from _dr_fn) + 2
      and (select md5(string_agg(format('%s|%s|%s|%s|%s|%s', pl.schemaname, pl.tablename, pl.policyname, pl.roles, pl.qual, pl.with_check), ';'
                                 order by pl.schemaname, pl.tablename, pl.policyname))
             from pg_policies pl where pl.schemaname in ('public', 'storage')) = (select p.m from _dr_pol p),
    'C14 every other public function unchanged, two added; every policy unchanged');
end
$c$;

-- D. The down, verbatim
-- DOWN for supabase/migrations/20261021141000_org_visitor_teaser.sql
-- Drops org_visitor_teaser(uuid) and org_public_highlights(uuid). The redesign treats a missing
-- function as "nothing to say" (src/lib/orgVisibility.ts): locked blocks lose their counts and a
-- visitor no longer sees a marina's key figures or the first Smart Marina 2026 text.
-- NEVER run this while supabase/migrations/held/directory_visitor_basic.sql is applied: run that
-- file's down first (it checks that both functions exist).

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
declare
  v_bad text;
begin
  if to_regprocedure('public.get_public_profile(uuid)') is not null
     and not has_function_privilege('anon', 'public.get_public_profile(uuid)', 'execute')
     and to_regprocedure('public.org_sm26_showcase(uuid)') is not null
     and not has_function_privilege('anon', 'public.org_sm26_showcase(uuid)', 'execute') then
    raise exception 'org_visitor_teaser down: held/directory_visitor_basic.sql looks applied; run its down first';
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p
   where (p.prosrc ilike '%org_visitor_teaser%' or p.prosrc ilike '%org_public_highlights%')
     and p.oid is distinct from to_regprocedure('public.org_visitor_teaser(uuid)')
     and p.oid is distinct from to_regprocedure('public.org_public_highlights(uuid)')
     and p.prolang <> (select l.oid from pg_language l where l.lanname = 'c');
  if v_bad is not null then
    raise exception 'org_visitor_teaser down: SQL function(s) call them: %', v_bad;
  end if;
end
$pre$;

drop function if exists public.org_public_highlights(uuid);
drop function if exists public.org_visitor_teaser(uuid);

-- E. Checks after the down, then the report (rolls everything back)
do $e$
declare
  v_txt text;
begin
  insert into _dr_res (ok, label) values (
    to_regprocedure('public.org_visitor_teaser(uuid)') is null and to_regprocedure('public.org_public_highlights(uuid)') is null,
    'E1 down dropped both functions');
  insert into _dr_res (ok, label) values (
    not exists ((select f.fn, f.acl, f.m from _dr_fn f)
                except
                (select p.oid::regprocedure::text, coalesce(array_to_string(p.proacl, ','), ''), md5(p.prosrc)
                   from pg_proc p where p.pronamespace = 'public'::regnamespace))
      and (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace) = (select count(*) from _dr_fn),
    'E2 public functions back to the snapshot (' || (select count(*) from _dr_fn) || ')');
  select string_agg(case when r.ok then 'PASS ' else 'FAIL ' end || r.label, chr(10) order by r.n) into v_txt from _dr_res r;
  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (org_visitor_teaser, run %s)',
    (select count(*) from _dr_res where ok), (select count(*) from _dr_res where ok is not true), now()) || chr(10) || v_txt;
end
$e$;
