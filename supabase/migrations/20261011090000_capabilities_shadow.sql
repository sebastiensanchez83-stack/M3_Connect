-- Rights per company type, in SHADOW mode: the table, the functions and the
-- report. Nothing here changes what anyone can do today.
--
-- Victor's decisions: the table of 6-7 Oct 2026, the answers of 9 Oct 2026 and
-- those of 11 Oct 2026 (memory "registration-harmonisation-decisions"; report
-- "Droits par type d'entreprise - qui gagne, qui perd - 9 octobre 2026"; spec
-- regspec-en.md §9).
--
-- Version 20261011090000. It was first written as 20261010200000, the version of
-- the security lane's org_members_no_forced_join too; renamed before anything was
-- applied.
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
--  ONE person-level exception (Victor, 11 Oct 2026): a verified person who is an
--  SM26-CONFIRMED INVESTOR also has see_dealflow, company or not, and nothing else
--  comes with it. SM26-confirmed investor = the person's own Smart Marina 2026
--  registration (sm_registration.user_id, event slug 'sm26') is confirmed and
--  carries a confirmed 'investor' role (sm_role_assignment):
--      exists (select 1
--                from public.sm_registration r
--                join public.sm_event e on e.id = r.event_id
--                join public.sm_role_assignment ra on ra.registration_id = r.id
--               where r.user_id = <the person>
--                 and e.slug = 'sm26'
--                 and r.status = 'confirmed'
--                 and ra.role = 'investor'
--                 and ra.status = 'confirmed')
--  (the Deal flow page's own check before the switch, plus the registration
--  status). On 11 Oct 2026: 12 people, all verified, 11 of them in a validated
--  investor company; the exception keeps Deal flow, with its data, for the one
--  who is not. The sm_* tables are only read.
--
-- ════════════════════════════════════════════════════════════════════════════
-- What this migration adds (and nothing else)
-- ════════════════════════════════════════════════════════════════════════════
--  1. public.org_type_capability (org_type, capability), seeded with the table above
--     (23 rows). RLS: any signed-in person reads it; verified admins write it.
--  2. public.capability_set(p_user, p_org default null) returns text[]: the rule
--     above for one person (one company when p_org is given: then the person must
--     be a member of it, and neither the participant set nor the SM26 investor
--     exception is added). Internal: no EXECUTE for anon or authenticated (it
--     would tell anyone whether someone is pending or suspended).
--     public.capability_sm26_investor(p_user) returns boolean: the SM26-confirmed
--     investor test above. Internal too (it reads sm_* rows the caller may not).
--  3. public.has_capability(p_cap, p_org default null) returns boolean, for the
--     caller (auth.uid()). STABLE, SECURITY DEFINER, search_path ''. Verified staff:
--     true for any capability. EXECUTE for anon too: a policy that applies to
--     "public" may call it for an anonymous reader, who simply gets false.
--  4. public.my_capabilities() returns jsonb, for the site:
--       {"person_status": "verified", "is_staff": false,
--        "companies": [{"id", "name", "type", "status", "caps": [...]}, ...],
--        "caps": [...]}
--  5. public.capability_shadow_report(): one row per non-staff person (ids only:
--     no name, no e-mail), their rights today and under the new rule, what they
--     gain and lose, and whether they are an SM26-confirmed investor. Staff only
--     (or the service role / SQL console).
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
--     rejected people do not change. The SM26 investor exception (11 Oct) changes
--     none of these counts: the one person it covers keeps see_dealflow but still
--     loses message_companies (no validated company).
--  6. platform_settings.registration_flags.capabilities_enforced = false. The row
--     is created with every switch of spec §13 at false (the same row, label and
--     description as 20261009200000_registration_prereqs, which then finds it in
--     place) or, when it exists, only the missing key is added.
--
--  NO existing policy, function, trigger or row changes (the sm_* tables are only
--  read). Nothing reads the new objects until the separate switch migration
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
--                                                    -> 11 Oct 2026: 128 / 32 / 15 (moves with the data)
--   select count(*), count(*) filter (where not ('investor' = any (company_types)))
--     from public.capability_shadow_report() where person_status = 'verified' and sm26_investor;
--                                                    -> 11 Oct 2026: 12 / 1
--
-- UNDO: supabase/migrations/down/20261011090000_capabilities_shadow.down.sql
-- Dry run: supabase/dryrun/20261011090000_capabilities_shadow.dryrun.sql

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
  -- The SM26 investor exception reads these (read-only).
  if (select count(*) from information_schema.columns
       where table_schema = 'public'
         and ((table_name = 'sm_event' and column_name in ('id', 'slug'))
           or (table_name = 'sm_registration' and column_name in ('id', 'event_id', 'user_id', 'status'))
           or (table_name = 'sm_role_assignment' and column_name in ('registration_id', 'role', 'status')))) <> 9 then
    raise exception 'capabilities shadow: sm_event / sm_registration / sm_role_assignment changed shape; re-read them before applying';
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
-- First the SM26 investor test it uses (Victor, 11 Oct 2026; see the header).
create or replace function public.capability_sm26_investor(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_user is not null
     and exists (
       select 1
         from public.sm_registration r
         join public.sm_event e on e.id = r.event_id
         join public.sm_role_assignment ra on ra.registration_id = r.id
        where r.user_id = p_user
          and e.slug = 'sm26'
          and r.status = 'confirmed'
          and ra.role = 'investor'
          and ra.status = 'confirmed');
$function$;

comment on function public.capability_sm26_investor(uuid) is
  'Whether a person is an SM26-confirmed investor: their own Smart Marina 2026 registration (event slug sm26) is confirmed and has a confirmed investor role. Gives see_dealflow in capability_set (Victor, 11 Oct 2026). Reads sm_* only. Internal (no EXECUTE for anon/authenticated). 2026-10-11.';

revoke all on function public.capability_sm26_investor(uuid) from public, anon, authenticated;
grant execute on function public.capability_sm26_investor(uuid) to service_role;

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

  -- 6. For the person as a whole, the one person-level exception (Victor, 11 Oct
  --    2026): an SM26-confirmed investor sees Deal flow, company or not. Only
  --    see_dealflow, and never through a company (p_org given).
  return array(
    select distinct u.capability
      from (select c.capability
              from public.org_type_capability c
             where c.org_type = any (v_types)
            union all
            select 'see_dealflow'::text
             where p_org is null
               and public.capability_sm26_investor(p_user)) u
     order by 1);
end
$function$;

comment on function public.capability_set(uuid, uuid) is
  'Rights of one person (p_org given: of that one company of theirs, without the participant set or the SM26 exception): staff everything, suspended nothing, not verified the pending set, else the participant set plus the org_type_capability rows of every validated (verified, typed, not archived, not duplicate) company they belong to, plus see_dealflow for an SM26-confirmed investor (capability_sm26_investor; Victor, 11 Oct 2026). Internal (no EXECUTE for anon/authenticated). 2026-10-11.';

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
  'Whether the caller has a capability (org_type_capability, and see_dealflow for a verified SM26-confirmed investor), for themselves or, with p_org, through that one company of theirs. Verified staff: always true. Anonymous: false. Used by the policies of supabase/migrations/held/capabilities_enforce.sql once applied. 2026-10-11.';

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
  'The caller''s rights for the site: person_status, is_staff, companies [{id, name, type, status, caps}], caps (the person as a whole, the SM26 investor exception included). 2026-10-11.';

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
  lost           text[],
  sm26_investor  boolean
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
         array(select c.cap from compared c where c.cap = any (r.cur) and not c.cap = any (r.nxt) order by c.ord),
         public.capability_sm26_investor(r.uid)
    from rows_ r
   order by r.uid;
end
$function$;

comment on function public.capability_shadow_report() is
  'Rights today (both live sites and the database, 10 Oct 2026) versus the company-type rule, per non-staff person: ids, statuses, capability lists and whether they are an SM26-confirmed investor (the see_dealflow exception) only. Staff only. 2026-10-11.';

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
