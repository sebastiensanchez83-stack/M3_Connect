-- Registration Phase 3 (DB lane), part 1 of 4: companies for the review queue.
-- Spec: regspec-en.md §3.9, §4.6, §8.1, §9 (directory), §12, §15 Phase 3. Contract: docs/registration-contract.md §11.
-- NOT APPLIED. Order: this file, 20261016090500_review_and_validation_people,
-- 20261016091000_review_and_validation_queue, 20261016091500_review_and_validation_provisioning.
-- Down: supabase/migrations/down/20261016090000_review_and_validation_orgs.down.sql.
-- Dry run: supabase/dryrun/20261016090000_review_and_validation_orgs.dryrun.sql.
--
-- With every flag off, the live main site and the redesign behave as today:
--  1. organizations.archived_at / duplicate_of (new, null everywhere): set by M3 only
--     (admin_archive_org, admin_mark_duplicate_org). company_search and has_capability
--     already leave such companies out (they read them through to_jsonb since Phase 2 / the
--     rights shadow); org_match_candidates and org_public_member_counts too. The directory
--     pages of the redesign filter them once this is applied (contract §11.6); main shows
--     them as before (nothing is archived today). organizations has COLUMN-level SELECT
--     grants for anon and authenticated (every column but claim_code): both columns are
--     granted here, or any client read naming them would answer 42501 (fixer, 15 Oct).
--  2. guard_org_sensitive_columns: a direct API write cannot change archived_at /
--     duplicate_of (staff excepted), nor the TYPE of a company once it is verified (the
--     owner could until now). Silently kept, like the other guarded columns: main's
--     company form keeps working. (Members cannot INSERT companies through the API: only
--     create_organization, which never sets them.)
--  3. notification_outbox accepts the decision e-mails of the queue (kinds below).
--  4. Staff-only lookups org_match_candidates / person_match_candidates (read only; SM26
--     rows are only read), the listing RPCs, and org_public_member_counts (anyone: the
--     member counts of validated companies, for the day the directory teams become
--     signed-in only: held/directory_signed_in_only.sql).
--  5. get_public_profiles is no longer executable by anon: neither client calls it signed
--     out (main: AdminWebinarRequests, OpportunitiesPage and OrganizationPublicPage, each
--     for a verified viewer; the redesign: the same pages and the inbox).

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ---- 0. Preconditions --------------------------------------------------------
do $pre$
declare
  v_md5 text;
  v_def text;
  v_row record;
begin
  if to_regclass('public.notification_outbox') is null or to_regclass('public.review_log') is null
     or to_regprocedure('public.normalize_org_name(text)') is null
     or to_regprocedure('public.immutable_unaccent(text)') is null
     or to_regprocedure('public.is_public_email_domain(text)') is null
     or to_regprocedure('public.get_public_profiles(uuid[])') is null
     or to_regprocedure('public.log_org_event(uuid,text,jsonb)') is null then
    raise exception 'review_and_validation_orgs: apply registration Phases 1 and 2 first';
  end if;
  select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p where p.oid = to_regprocedure('public.complete_signup_for(uuid)');
  if v_md5 is distinct from '67a850075f0e06e93b1ab02a377408ae' then
    raise exception 'review_and_validation_orgs: complete_signup_for is not the Phase 2 version (md5 %)', v_md5;
  end if;
  -- The outbox kinds are replaced by a fixed list below: refuse if another file added kinds
  -- since Phase 2 (they would be lost silently; merge the lists first). Re-running is fine.
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conname = 'notification_outbox_kind_check' and c.conrelid = 'public.notification_outbox'::regclass;
  if v_def is distinct from 'CHECK ((kind = ANY (ARRAY[''account_under_review''::text, ''team_join_request''::text])))'
     and v_def is distinct from 'CHECK ((kind = ANY (ARRAY[''account_under_review''::text, ''team_join_request''::text, ''user_account_approved''::text, ''user_account_rejected''::text, ''account_info_requested''::text, ''company_validated''::text, ''claim_approved''::text, ''claim_declined''::text])))' then
    raise exception 'review_and_validation_orgs: notification_outbox kinds changed (%); merge the lists in this file', v_def;
  end if;
  for v_row in
    select * from (values
      ('public.guard_org_sensitive_columns()', '1bb4a8fbf3c636bed7691b452940739c', 'f34eb998471505d98fe23f768ef3f854')
    ) as x(sig, prod, mine)
  loop
    select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p where p.oid = to_regprocedure(v_row.sig);
    if v_md5 is distinct from v_row.prod and v_md5 is distinct from v_row.mine then
      raise exception 'review_and_validation_orgs: % changed (md5 %); rebuild this migration from pg_get_functiondef', v_row.sig, v_md5;
    end if;
  end loop;
end
$pre$;

-- ---- 1. Listing columns (staff-set) ----------------------------------------------
alter table public.organizations
  add column if not exists archived_at timestamptz,
  add column if not exists duplicate_of uuid;
do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_duplicate_of_fkey' and conrelid = 'public.organizations'::regclass) then
    alter table public.organizations add constraint organizations_duplicate_of_fkey
      foreign key (duplicate_of) references public.organizations(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'organizations_duplicate_of_not_self' and conrelid = 'public.organizations'::regclass) then
    alter table public.organizations add constraint organizations_duplicate_of_not_self check (duplicate_of <> id);
  end if;
end
$c$;
create index if not exists organizations_duplicate_of_idx on public.organizations (duplicate_of) where duplicate_of is not null;
comment on column public.organizations.archived_at is 'Phase 3: set by M3 (admin_archive_org). Hidden from the directory, company search and matching; no rights through it. Null = listed.';
comment on column public.organizations.duplicate_of is 'Phase 3: set by M3 (admin_mark_duplicate_org): the company this one duplicates (the survivor; an SM26-linked company always survives). Hidden like archived_at until admin_merge_org (December).';
-- Readable like the other listing columns (the table's SELECT is granted column by column, so
-- a new column is unreadable for API roles until granted): the directory filters
-- (.is('archived_at', null)) and the admin pages read them. Writes stay with the guard below.
grant select (archived_at, duplicate_of) on public.organizations to anon, authenticated;

-- ---- 2. Guards ------------------------------------------------------------------------
create or replace function public.guard_org_sensitive_columns()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  -- SECURITY DEFINER / service-role contexts (create_organization,
  -- claim_organization, update_org_branding, sync_org_entitlements, admin RPCs)
  -- run as a non-API role -- let them through.
  if current_user <> 'authenticated' then return new; end if;
  -- Verified moderators/admins may change anything.
  if is_moderator() then return new; end if;

  -- Money / trust / identity columns: NO self-service user may change these,
  -- INCLUDING org owners. Closes the owner self-verify + self-tier-upgrade path.
  new.tier := old.tier;
  new.access_status := old.access_status;
  new.max_seats := old.max_seats;
  new.featured_partner := old.featured_partner;
  new.owner_user_id := old.owner_user_id;
  new.created_by_user_id := old.created_by_user_id;
  new.claim_code := old.claim_code;
  new.slug := old.slug;
  new.rejection_reason := old.rejection_reason;
  -- Listing (Phase 3, 20261016090000): archived / duplicate are set by M3 only.
  new.archived_at := old.archived_at;
  new.duplicate_of := old.duplicate_of;
  -- Type lock (spec §3.9): once M3 has verified a company, its type is M3's.
  if old.access_status = 'verified' then
    new.organization_type := old.organization_type;
  end if;

  -- Structural columns only OWNERS may change (owners legitimately advance
  -- onboarding_status during the wizard and toggle domain auto-join; members cannot).
  if not is_org_owner(old.id) then
    new.onboarding_status := old.onboarding_status;
    new.primary_domain := old.primary_domain;
    new.auto_approve_domain_joins := old.auto_approve_domain_joins;
    new.organization_type := old.organization_type;
  end if;
  return new;
end
$function$;

-- ---- 3. Decision e-mails in the outbox (sent by registration-cron, EDGE lane) ---
alter table public.notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table public.notification_outbox add constraint notification_outbox_kind_check check (kind in (
  'account_under_review', 'team_join_request',
  'user_account_approved', 'user_account_rejected', 'account_info_requested', 'company_validated',
  'claim_approved', 'claim_declined'));

-- ---- 4. Helpers (pure) ----------------------------------------------------------------
-- Host of a website as people type it ("https://www.x.com/a", "x.com", "https:\\x.com").
create or replace function public.review_url_host(p text)
returns text
language sql
immutable parallel safe
set search_path = ''
as $function$
  select nullif(lower(regexp_replace(regexp_replace(btrim(coalesce(p, '')), '^[a-z][a-z0-9+.-]*:[/\\]+', '', 'i'),
                                     '^www\.|[/:?#\\ ].*$', '', 'g')), '')
$function$;

-- Same domain, or one a sub-domain of the other; null when either is unknown.
create or replace function public.review_domain_match(a text, b text)
returns boolean
language sql
immutable parallel safe
set search_path = ''
as $function$
  select case when nullif(btrim(coalesce(a, '')), '') is null or nullif(btrim(coalesce(b, '')), '') is null then null
              else lower(btrim(a)) = lower(btrim(b))
                   or right(lower(btrim(a)), length(btrim(b)) + 1) = '.' || lower(btrim(b))
                   or right(lower(btrim(b)), length(btrim(a)) + 1) = '.' || lower(btrim(a)) end
$function$;

-- "Jérôme  Dupont" -> "jerome dupont"; null when empty.
create or replace function public.review_name_key(p_first text, p_last text)
returns text
language sql
immutable parallel safe
set search_path = ''
as $function$
  select nullif(btrim(regexp_replace(lower(public.immutable_unaccent(coalesce(p_first, '') || ' ' || coalesce(p_last, ''))),
                                     '[^[:alnum:]]+', ' ', 'g')), '')
$function$;

-- ---- 5. Matching (verified admins; read only) ---------------------------------------
create or replace function public.org_match_candidates(p_name text, p_website text default null,
                                                       p_email text default null, p_country text default null)
returns table (id uuid, name text, slug text, organization_type text, access_status text, country text,
               website text, logo_url text, score numeric, reasons text[], sm26_linked boolean,
               has_owner boolean, members integer)
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_column
declare
  v_n text := public.normalize_org_name(left(p_name, 200));
  v_host text := public.review_url_host(left(p_website, 300));
  v_dom text := nullif(lower(split_part(btrim(coalesce(p_email, '')), '@', 2)), '');
  v_cty text := nullif(lower(btrim(coalesce(p_country, ''))), '');
begin
  if not coalesce(public.is_admin(), false) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if v_dom is not null and public.is_public_email_domain(v_dom) then
    v_dom := null;
  end if;
  return query
  with c as (
    select o.id, o.name, o.slug, o.organization_type, o.access_status, coalesce(o.country, o.headquarters_country) as cty,
           o.website, o.logo_url, o.owner_user_id,
           case when v_n is null then 0::real else extensions.similarity(public.normalize_org_name(o.name), v_n) end as sim,
           coalesce(v_n is not null and public.normalize_org_name(o.name) = v_n, false) as same_name,
           coalesce(public.review_domain_match(public.review_url_host(o.website), v_host)
                    or public.review_domain_match(o.primary_domain, v_host), false) as same_site,
           coalesce(public.review_domain_match(o.primary_domain, v_dom)
                    or public.review_domain_match(public.review_url_host(o.website), v_dom), false) as same_dom
      from public.organizations o
     where o.archived_at is null and o.duplicate_of is null
       and o.access_status in ('verified', 'pending')
       and ((v_n is not null and public.normalize_org_name(o.name) operator(extensions.%) v_n)
            or (v_host is not null and (public.review_domain_match(public.review_url_host(o.website), v_host)
                                        or public.review_domain_match(o.primary_domain, v_host)))
            or (v_dom is not null and (public.review_domain_match(o.primary_domain, v_dom)
                                       or public.review_domain_match(public.review_url_host(o.website), v_dom))))
  )
  select c.id, c.name, c.slug, c.organization_type, c.access_status, c.cty, c.website, c.logo_url,
         round(least(1, greatest(case when c.same_name then 1 else c.sim end,
                                 case when c.same_site then 0.9 else 0 end,
                                 case when c.same_dom then 0.85 else 0 end)
                        + case when v_cty is not null and lower(coalesce(c.cty, '')) = v_cty then 0.05 else 0 end)::numeric, 3),
         array_remove(array[case when c.same_name then 'same_name' when c.sim >= 0.55 then 'similar_name' end,
                            case when c.same_site then 'same_website' end,
                            case when c.same_dom then 'email_domain' end,
                            case when v_cty is not null and lower(coalesce(c.cty, '')) = v_cty then 'same_country' end], null),
         exists (select 1 from public.sm_registration r where r.organization_id = c.id),
         (c.owner_user_id is not null or exists (select 1 from public.organization_members m
                                                   where m.organization_id = c.id and m.role = 'owner')),
         (select count(*)::integer from public.organization_members m where m.organization_id = c.id)
    from c
   where c.same_name or c.sim >= 0.55 or c.same_site or c.same_dom
   order by 9 desc, c.name
   limit 10;
end
$function$;

create or replace function public.person_match_candidates(p_email text, p_first text default null,
                                                          p_last text default null, p_company text default null)
returns table (source text, id uuid, user_id uuid, email text, first_name text, last_name text, company text,
               status text, match text, score numeric, detail jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_column
declare
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_key text := public.review_name_key(left(p_first, 100), left(p_last, 100));
  v_comp text := public.normalize_org_name(left(p_company, 200));
begin
  if not coalesce(public.is_admin(), false) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if v_key is not null and length(v_key) < 4 then
    v_key := null;
  end if;
  return query
  with acc as (
    select 'account'::text as src, u.id as rid, u.id as uid, lower(u.email) as em, pr.first_name as fn, pr.last_name as ln,
           (select o.name from public.organization_members m join public.organizations o on o.id = m.organization_id
             where m.user_id = u.id order by (m.role = 'owner') desc, m.joined_at limit 1) as comp,
           pr.access_status::text as st, jsonb_build_object('persona', pr.persona::text, 'created_at', u.created_at) as det
      from auth.users u join public.profiles pr on pr.user_id = u.id
     where (v_email is not null and lower(u.email) = v_email)
        or (v_key is not null and public.review_name_key(pr.first_name, pr.last_name) = v_key)
  ), reg as (
    select 'registration'::text, g.id, g.user_id, lower(g.email), g.first_name, g.last_name, g.company, g.status,
           jsonb_build_object('event_slug', e.slug, 'gl_event_id', e.id)
      from public.gl_guest g join public.gl_event e on e.id = g.event_id
     where (v_email is not null and lower(g.email) = v_email)
        or (v_key is not null and public.review_name_key(g.first_name, g.last_name) = v_key)
  ), leg as (
    select 'legacy_registration'::text, r.id, r.user_id, lower(r.guest_email), r.guest_first_name, r.guest_last_name,
           r.guest_company, coalesce(r.payment_status, 'registered'), jsonb_build_object('event_id', r.event_id)
      from public.event_registrations r
     where v_email is not null and lower(r.guest_email) = v_email
  ), sm as (
    -- SM26 archive: read only.
    select 'sm26_attendee'::text, a.id, a.user_id, lower(a.email), a.first_name, a.last_name, r.company_name, r.status,
           jsonb_build_object('registration_id', r.id, 'attending', a.attending, 'is_primary', a.is_primary)
      from public.sm_attendee a join public.sm_registration r on r.id = a.registration_id
     where (v_email is not null and lower(a.email) = v_email)
        or (v_key is not null and public.review_name_key(a.first_name, a.last_name) = v_key)
  ), allr as (
    select * from acc union all select * from reg union all select * from leg union all select * from sm
  )
  select x.src, x.rid, x.uid, x.em, x.fn, x.ln, x.comp, x.st,
         case when v_email is not null and x.em = v_email then 'email'
              when v_comp is not null and extensions.similarity(coalesce(public.normalize_org_name(x.comp), ''), v_comp) >= 0.5 then 'name_company'
              else 'name' end,
         case when v_email is not null and x.em = v_email then 1.0
              when v_comp is not null and extensions.similarity(coalesce(public.normalize_org_name(x.comp), ''), v_comp) >= 0.5 then 0.8
              else 0.5 end::numeric,
         x.det
    from allr x(src, rid, uid, em, fn, ln, comp, st, det)
   order by 10 desc, 1, 4
   limit 25;
end
$function$;

-- ---- 6. Listing decisions (verified admins) ------------------------------------------
create or replace function public.admin_archive_org(p_org_id uuid, p_archived boolean, p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_at timestamptz;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if p_org_id is null or p_archived is null then
    raise exception using errcode = '22023', message = 'bad_input';
  end if;
  update public.organizations o
     set archived_at = case when p_archived then coalesce(o.archived_at, now()) end
   where o.id = p_org_id
  returning o.archived_at into v_at;
  if not found then
    raise exception using errcode = '22023', message = 'org_not_found';
  end if;
  insert into public.review_log (subject_type, subject_id, action, note, details, actor_id)
  values ('company', p_org_id, case when p_archived then 'archived' else 'unarchived' end,
          nullif(left(btrim(coalesce(p_note, '')), 4000), ''), '{}'::jsonb, auth.uid());
  return jsonb_build_object('ok', true, 'organization_id', p_org_id, 'archived_at', v_at);
end
$function$;

create or replace function public.admin_mark_duplicate_org(p_org_id uuid, p_duplicate_of uuid, p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_target record;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if p_org_id is null then
    raise exception using errcode = '22023', message = 'bad_input';
  end if;
  perform 1 from public.organizations o where o.id = p_org_id for update;
  if not found then
    raise exception using errcode = '22023', message = 'org_not_found';
  end if;
  if p_duplicate_of is not null then
    if p_duplicate_of = p_org_id then
      raise exception using errcode = '22023', message = 'duplicate_of_self';
    end if;
    select o.id, o.duplicate_of, o.archived_at into v_target from public.organizations o where o.id = p_duplicate_of for share;
    if not found then
      raise exception using errcode = '22023', message = 'target_not_found';
    end if;
    if v_target.duplicate_of is not null or v_target.archived_at is not null then
      raise exception using errcode = '22023', message = 'target_not_listed';
    end if;
    if exists (select 1 from public.organizations o where o.duplicate_of = p_org_id) then
      raise exception using errcode = '22023', message = 'has_duplicates';
    end if;
    -- The SM26-linked company always survives (spec §4.6 admin_merge_org): no sm_* row moves.
    if exists (select 1 from public.sm_registration r where r.organization_id = p_org_id)
       or exists (select 1 from public.sm_role_assignment a where a.organization_id = p_org_id) then
      raise exception using errcode = '22023', message = 'sm26_company_must_survive';
    end if;
  end if;
  update public.organizations o set duplicate_of = p_duplicate_of where o.id = p_org_id;
  insert into public.review_log (subject_type, subject_id, action, note, details, actor_id)
  values ('merge', p_org_id, case when p_duplicate_of is null then 'unmarked_duplicate' else 'marked_duplicate' end,
          nullif(left(btrim(coalesce(p_note, '')), 4000), ''),
          jsonb_strip_nulls(jsonb_build_object('duplicate_of', p_duplicate_of)), auth.uid());
  return jsonb_build_object('ok', true, 'organization_id', p_org_id, 'duplicate_of', p_duplicate_of);
end
$function$;

-- Member counts of validated companies, for everyone (no names, no ids of people).
create or replace function public.org_public_member_counts(p_org_ids uuid[])
returns table (organization_id uuid, members integer)
language sql
stable
security definer
set search_path = ''
as $function$
  select m.organization_id, count(*)::integer
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id
   where m.organization_id = any ((p_org_ids)[1:500])
     and o.access_status = 'verified' and o.archived_at is null and o.duplicate_of is null
   group by m.organization_id
$function$;

-- ---- 7. EXECUTE -------------------------------------------------------------------
revoke all on function public.review_url_host(text) from public, anon;
revoke all on function public.review_domain_match(text, text) from public, anon;
revoke all on function public.review_name_key(text, text) from public, anon;
grant execute on function public.review_url_host(text) to authenticated, service_role;
grant execute on function public.review_domain_match(text, text) to authenticated, service_role;
grant execute on function public.review_name_key(text, text) to authenticated, service_role;
revoke all on function public.org_match_candidates(text, text, text, text) from public, anon;
grant execute on function public.org_match_candidates(text, text, text, text) to authenticated;
revoke all on function public.person_match_candidates(text, text, text, text) from public, anon;
grant execute on function public.person_match_candidates(text, text, text, text) to authenticated;
revoke all on function public.admin_archive_org(uuid, boolean, text) from public, anon;
grant execute on function public.admin_archive_org(uuid, boolean, text) to authenticated;
revoke all on function public.admin_mark_duplicate_org(uuid, uuid, text) from public, anon;
grant execute on function public.admin_mark_duplicate_org(uuid, uuid, text) to authenticated;
revoke all on function public.org_public_member_counts(uuid[]) from public;
grant execute on function public.org_public_member_counts(uuid[]) to anon, authenticated, service_role;
-- Spec §9 / §15 Phase 3: get_public_profiles is not for anon (no signed-out caller, see above).
revoke all on function public.get_public_profiles(uuid[]) from public, anon;
grant execute on function public.get_public_profiles(uuid[]) to authenticated, service_role;

comment on function public.org_match_candidates(text, text, text, text) is 'Phase 3: companies that may be the one a person declared (same or similar normalised name >= 0.55, same website host, same non-public e-mail domain; same country +0.05). Up to 10, best first; archived and duplicates left out. Verified admins only.';
comment on function public.person_match_candidates(text, text, text, text) is 'Phase 3: the same person elsewhere: exact e-mail across accounts, gl_guest, legacy event_registrations and sm_attendee (read only), or the same first and last name (score 0.8 with a similar company, else 0.5). Verified admins only.';
comment on function public.admin_archive_org(uuid, boolean, text) is 'Phase 3: archive (true) or list again (false) a company; review_log subject company. Verified admins only.';
comment on function public.admin_mark_duplicate_org(uuid, uuid, text) is 'Phase 3: mark a company as a duplicate of a listed one (null clears); refused for an SM26-linked company (it must survive), for chains and for itself; review_log subject merge. Verified admins only.';
comment on function public.org_public_member_counts(uuid[]) is 'Phase 3: member counts of validated, listed companies (500 ids at most). Anyone: replaces the signed-out read of organization_members once held/directory_signed_in_only.sql is applied.';
