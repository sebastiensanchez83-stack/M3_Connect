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
