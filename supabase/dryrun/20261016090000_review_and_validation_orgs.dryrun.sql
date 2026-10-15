-- DRY RUN of supabase/migrations/20261016090000_review_and_validation_orgs.sql. NOT A MIGRATION.
-- ONE query text, ONE execute_sql call, BEFORE that file is applied (Phases 1 and 2 applied).
-- A snapshot, the migration verbatim, then cases run as anon / a member / an owner / a verified
-- admin / the service role, each rolled back. Ends with RAISE EXCEPTION 'DRYRUN ...':
-- everything rolls back. Expected: "41 PASS, 0 FAIL".
-- Locks: ACCESS EXCLUSIVE on organizations (new columns) and notification_outbox (CHECK)
-- until the final rollback (seconds): run it off-peak.

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ─── A. Snapshot (read again after the migration, case S01: must be identical) ─
create function pg_temp.dr_snap() returns table (k text, v text) language sql as $f$
  select 'sm26', md5(concat_ws('|',
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_registration x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_role_assignment x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_attendee x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_badge x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_payment x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_invoice x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_networking_pass x)))
  union all select 'gl_guest', (select md5(coalesce(string_agg(g.id::text || g.token::text || g.status || coalesce(g.user_id::text, ''), ',' order by g.id), '')) from public.gl_guest g)
  union all select 'jobs', (select md5(coalesce(string_agg(j.id::text || j.status || coalesce(j.email_due_at::text, ''), ',' order by j.id), '')) from public.account_provision_job j)
  union all select 'orgs', (select md5(coalesce(string_agg(concat_ws('/', o.id, o.name, o.access_status, o.organization_type, o.owner_user_id, o.primary_domain, o.updated_at), ',' order by o.id), '')) from public.organizations o)
  union all select 'members', (select md5(coalesce(string_agg(m.id::text || m.user_id::text || m.role, ',' order by m.id), '')) from public.organization_members m)
  union all select 'profiles', (select md5(coalesce(string_agg(concat_ws('/', pr.user_id, pr.access_status, pr.onboarding_status, pr.persona, pr.updated_at, pr.email_proven_at), ',' order by pr.user_id), '')) from public.profiles pr)
  union all select 'invitations', (select md5(coalesce(string_agg(i.id::text || i.status, ',' order by i.id), '')) from public.organization_invitations i)
  union all select 'outbox', (select md5(coalesce(string_agg(n.id::text || coalesce(n.sent_at::text, ''), ',' order by n.id), '')) from public.notification_outbox n)
  union all select 'review_log', (select count(*)::text from public.review_log)
  union all select 'policies', (select md5(string_agg(format('%s|%s|%s|%s|%s', pl.tablename, pl.policyname, pl.roles, pl.qual, pl.with_check), ';' order by pl.tablename, pl.policyname))
                                  from pg_policies pl where pl.schemaname = 'public')
  union all select 'cron', (select string_agg(j.jobname || '=' || j.schedule, ',' order by j.jobname) from cron.job j where j.jobname <> 'registration-cron-provision')
$f$;
create temp table _dr_before on commit drop as select * from pg_temp.dr_snap();

-- ─── B. The migration, verbatim ─────────────────────────────────────────────────
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

-- ─── C. Test helpers (temporary, gone with the rollback) ───────────────────────
-- An account: the auth.users row (handle_new_user makes the profile), then status, persona, proof.
create function pg_temp.dr_user(p_id uuid, p_email text, p_meta jsonb, p_proven boolean, p_status text, p_persona text)
returns void language plpgsql as $f$
begin
  insert into auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
  values (p_id, p_email, 'authenticated', 'authenticated', p_meta, now(), now(), now());
  update public.profiles
     set email_proven_at = case when p_proven then now() end,
         access_status = p_status::public.access_status_enum,
         persona = p_persona::public.persona_enum,
         onboarding_status = (case when p_status = 'verified' then 'completed' else 'submitted' end)::public.onboarding_status_enum
   where user_id = p_id;
end
$f$;
-- A company (and its owner member when given).
create function pg_temp.dr_org(p_id uuid, p_name text, p_status text, p_type text, p_owner uuid, p_site text)
returns void language plpgsql as $f$
begin
  insert into public.organizations (id, name, slug, access_status, onboarding_status, organization_type, owner_user_id, created_by_user_id, website)
  values (p_id, p_name, 'dryrun-' || p_id, p_status, case when p_status = 'verified' then 'completed' else 'submitted' end,
          p_type, p_owner, p_owner, p_site);
  if p_owner is not null then
    insert into public.organization_members (organization_id, user_id, role) values (p_id, p_owner, 'owner');
  end if;
end
$f$;

-- ─── D. Cases ───────────────────────────────────────────────────────────────────
do $dryrun$
declare
  tests jsonb := '[]'::jsonb;
  t jsonb;
  kv record;
  vars jsonb;
  s0 text;
  v_q text; v_setup text; v_chkq text; v_exp text;
  v_uid uuid; v_dml boolean; v_ret text; v_n bigint;
  v_err text; v_state text; v_chk boolean; v_pass boolean;
  n_pass integer := 0; n_fail integer := 0;
  results text := '';
  r8 text := substr(md5(random()::text), 1, 8);
begin
  vars := jsonb_build_object(
    'admin', gen_random_uuid(), 'owner', gen_random_uuid(), 'p1', gen_random_uuid(), 'p2', gen_random_uuid(),
    'e_admin', 'dryrun-admin-' || r8 || '@example.invalid', 'e_owner', 'dryrun-owner-' || r8 || '@example.invalid',
    'e_p1', 'dryrun-p1-' || r8 || '@example.invalid', 'e_p2', 'dryrun-p2-' || r8 || '@example.invalid',
    'fn', 'Patr' || r8, 'org_v', gen_random_uuid(), 'org_p', gen_random_uuid(),
    'name_v', 'Dryrun Zebramarina ' || r8, 'name_p', 'Dryrun Pending Docks ' || r8,
    'site_v', 'https://www.dryrun-' || r8 || '.example/about', 'mail_v', 'jane@dryrun-' || r8 || '.example',
    'sm26_org', (select r.organization_id::text from public.sm_registration r where r.organization_id is not null order by r.created_at limit 1));
  s0 := $s$select pg_temp.dr_user({admin}, {e_admin}, '{}', true, 'verified', 'admin');
select pg_temp.dr_user({owner}, {e_owner}, '{"first_name": "Olive", "last_name": "Owner"}', true, 'verified', 'marina');
select pg_temp.dr_user({p1}, {e_p1}, jsonb_build_object('first_name', {fn}, 'last_name', 'Doe'), true, 'pending', 'individual');
select pg_temp.dr_org({org_v}, {name_v}, 'verified', 'marina', {owner}, {site_v});
select pg_temp.dr_org({org_p}, {name_p}, 'pending', 'partner', {p1}, null)$s$;

  tests := jsonb_build_array(
    jsonb_build_object('id', 'S01', 'who', 'postgres', 'bare', true, 'expect', 'ret:0', 'label', 'the migration changed no row (SM26, WYS, companies, people, outbox) nor any policy or cron',
      'q', $q$select count(*)::text from ((select * from _dr_before except select * from pg_temp.dr_snap()) union all (select * from pg_temp.dr_snap() except select * from _dr_before)) d$q$),
    jsonb_build_object('id', 'S02', 'who', 'postgres', 'bare', true, 'expect', 'ret:0', 'label', 'archived_at / duplicate_of exist and are null everywhere',
      'q', $q$select count(*)::text from public.organizations where archived_at is not null or duplicate_of is not null$q$),
    jsonb_build_object('id', 'S03', 'who', 'postgres', 'bare', true, 'expect', 'ret:false/false/true/true/false', 'label', 'EXECUTE: anon none of the lookups nor get_public_profiles; members yes; anyone the member counts; no anon helper',
      'q', $q$select concat_ws('/', has_function_privilege('anon', 'public.org_match_candidates(text,text,text,text)', 'execute')::text,
                has_function_privilege('anon', 'public.get_public_profiles(uuid[])', 'execute')::text,
                has_function_privilege('authenticated', 'public.get_public_profiles(uuid[])', 'execute')::text,
                has_function_privilege('anon', 'public.org_public_member_counts(uuid[])', 'execute')::text,
                has_function_privilege('anon', 'public.admin_archive_org(uuid,boolean,text)', 'execute')::text)$q$),
    jsonb_build_object('id', 'S04', 'who', 'postgres', 'bare', true, 'expect', 'ret:true/true/true/true/false/false', 'label', 'SELECT on the two new columns for anon and members (column grants, as the other listing columns); claim_code still not',
      'q', $q$select concat_ws('/', has_column_privilege('anon', 'public.organizations', 'archived_at', 'select')::text,
                has_column_privilege('anon', 'public.organizations', 'duplicate_of', 'select')::text,
                has_column_privilege('authenticated', 'public.organizations', 'archived_at', 'select')::text,
                has_column_privilege('authenticated', 'public.organizations', 'duplicate_of', 'select')::text,
                has_column_privilege('anon', 'public.organizations', 'claim_code', 'select')::text,
                has_column_privilege('authenticated', 'public.organizations', 'claim_code', 'select')::text)$q$),
    -- ── guard ──
    jsonb_build_object('id', 'G01', 'who', 'owner', 'expect', 'allow', 'label', 'TYPE LOCK: the owner of a verified company cannot change its type (kept, no error); other fields still save',
      'q', $q$update public.organizations set organization_type = 'partner', description = 'dry run' where id = {org_v}$q$,
      'chk', $c$select organization_type = 'marina' and description = 'dry run' from public.organizations where id = {org_v}$c$),
    jsonb_build_object('id', 'G02', 'who', 'p1', 'expect', 'allow', 'label', 'the owner of a PENDING company still sets its type',
      'q', $q$update public.organizations set organization_type = 'investor' where id = {org_p}$q$,
      'chk', $c$select organization_type = 'investor' from public.organizations where id = {org_p}$c$),
    jsonb_build_object('id', 'G03', 'who', 'admin', 'expect', 'allow', 'label', 'staff change the type of a verified company',
      'q', $q$update public.organizations set organization_type = 'partner' where id = {org_v}$q$,
      'chk', $c$select organization_type = 'partner' from public.organizations where id = {org_v}$c$),
    jsonb_build_object('id', 'G04', 'who', 'owner', 'expect', 'allow', 'label', 'an owner cannot archive or mark a duplicate (kept null)',
      'q', $q$update public.organizations set archived_at = now(), duplicate_of = {org_p} where id = {org_v}$q$,
      'chk', $c$select archived_at is null and duplicate_of is null from public.organizations where id = {org_v}$c$),
    jsonb_build_object('id', 'G05', 'who', 'postgres', 'expect', 'err:organizations_duplicate_of_not_self', 'label', 'a company is never its own duplicate',
      'q', $q$update public.organizations set duplicate_of = id where id = {org_v}$q$),
    jsonb_build_object('id', 'O01', 'who', 'postgres', 'expect', 'allow', 'label', 'the outbox takes the decision e-mails (claim_approved)',
      'q', $q$insert into public.notification_outbox (kind, user_id, dedupe_key) values ('claim_approved', {p1}, 'dryrun:' || {fn})$q$),
    jsonb_build_object('id', 'O02', 'who', 'postgres', 'expect', 'err:notification_outbox_kind_check', 'label', 'and still refuses an unknown kind',
      'q', $q$insert into public.notification_outbox (kind, user_id, dedupe_key) values ('dryrun_kind', {p1}, 'dryrun2:' || {fn})$q$),
    jsonb_build_object('id', 'O03', 'who', 'postgres', 'bare', true, 'expect', 'ret:true', 'label', 'the new kind list is the one the precondition accepts on a re-run',
      'q', $q$select (pg_get_constraintdef(c.oid) = 'CHECK ((kind = ANY (ARRAY[''account_under_review''::text, ''team_join_request''::text, ''user_account_approved''::text, ''user_account_rejected''::text, ''account_info_requested''::text, ''company_validated''::text, ''claim_approved''::text, ''claim_declined''::text])))')::text from pg_constraint c where c.conname = 'notification_outbox_kind_check' and c.conrelid = 'public.notification_outbox'::regclass$q$),
    -- ── helpers ──
    jsonb_build_object('id', 'H01', 'who', 'postgres', 'bare', true, 'expect', 'ret:dryrun.example|dryrun.example|dryrun.example|null', 'label', 'review_url_host: scheme, www, port, path, backslashes, empty',
      'q', $q$select public.review_url_host('HTTPS://www.Dryrun.example:8080/x') || '|' || public.review_url_host('dryrun.example/path?q') || '|' || public.review_url_host('https:\\www.dryrun.example') || '|' || coalesce(public.review_url_host(' '), 'null')$q$),
    jsonb_build_object('id', 'H02', 'who', 'postgres', 'bare', true, 'expect', 'ret:true/false/null', 'label', 'review_domain_match: sub-domain yes, look-alike no, unknown null',
      'q', $q$select public.review_domain_match('mail.dryrun.example', 'dryrun.example')::text || '/' || public.review_domain_match('xdryrun.example', 'dryrun.example')::text || '/' || coalesce(public.review_domain_match(null, 'a.b')::text, 'null')$q$),
    jsonb_build_object('id', 'H03', 'who', 'postgres', 'bare', true, 'expect', 'ret:jerome dupont smith', 'label', 'review_name_key: accents, case, punctuation',
      'q', $q$select public.review_name_key(' Jérôme ', 'DUPONT-Smith')$q$),
    -- ── matching ──
    jsonb_build_object('id', 'M01', 'who', 'anon', 'expect', 'rls', 'label', 'anon cannot look up companies',
      'q', $q$select count(*)::text from public.org_match_candidates('dryrun')$q$),
    jsonb_build_object('id', 'M02', 'who', 'owner', 'expect', 'err:forbidden', 'label', 'a member cannot look up companies',
      'q', $q$select count(*)::text from public.org_match_candidates('dryrun')$q$),
    jsonb_build_object('id', 'M03', 'who', 'admin', 'expect', 'ret:same_name/1.000', 'label', 'same normalised name (legal suffix dropped): score 1',
      'q', $q$select array_to_string(r.reasons, ',') || '/' || r.score from public.org_match_candidates({name_v} || ' SARL') r where r.id = {org_v}$q$),
    jsonb_build_object('id', 'M04', 'who', 'admin', 'expect', 'ret:email_domain', 'label', 'the person''s e-mail domain is the company''s website host',
      'q', $q$select array_to_string(r.reasons, ',') from public.org_match_candidates('Qqqq Unrelated', null, {mail_v}) r where r.id = {org_v}$q$),
    jsonb_build_object('id', 'M05', 'who', 'admin', 'expect', 'ret:same_website/0.900', 'label', 'same website host',
      'q', $q$select array_to_string(r.reasons, ',') || '/' || r.score from public.org_match_candidates('Qqqq Unrelated', {site_v}) r where r.id = {org_v}$q$),
    jsonb_build_object('id', 'M06', 'who', 'admin', 'expect', 'ret:0', 'label', 'an archived company is never proposed',
      'setup', $s$update public.organizations set archived_at = now() where id = {org_v}$s$,
      'q', $q$select count(*)::text from public.org_match_candidates({name_v}) r where r.id = {org_v}$q$),
    jsonb_build_object('id', 'M07', 'who', 'admin', 'expect', 'ret:0', 'label', 'a public e-mail domain matches nothing',
      'q', $q$select count(*)::text from public.org_match_candidates(null, null, 'someone@gmail.com')$q$),
    jsonb_build_object('id', 'P01', 'who', 'admin', 'expect', 'ret:account:email', 'label', 'the same e-mail: the account',
      'q', $q$select string_agg(r.source || ':' || r.match, ',' order by r.source) from public.person_match_candidates({e_p1}) r where r.email = lower({e_p1})$q$),
    jsonb_build_object('id', 'P02', 'who', 'owner', 'expect', 'err:forbidden', 'label', 'a member cannot look up people',
      'q', $q$select count(*)::text from public.person_match_candidates({e_p1})$q$),
    jsonb_build_object('id', 'P03', 'who', 'admin', 'expect', 'ret:2', 'label', 'the same first and last name: both accounts',
      'setup', $s$select pg_temp.dr_user({p2}, {e_p2}, jsonb_build_object('first_name', {fn}, 'last_name', 'Doe'), false, 'pending', 'individual')$s$,
      'q', $q$select count(*)::text from public.person_match_candidates('nobody@example.invalid', {fn}, 'Doe') r where r.source = 'account'$q$),
    -- ── listing ──
    jsonb_build_object('id', 'A01', 'who', 'admin', 'expect', 'ret:true', 'label', 'staff archive a company, logged',
      'q', $q$select public.admin_archive_org({org_v}, true, 'dry run') ->> 'ok'$q$,
      'chk', $c$select (select archived_at is not null from public.organizations where id = {org_v}) and exists (select 1 from public.review_log where subject_id = {org_v} and action = 'archived')$c$),
    jsonb_build_object('id', 'A02', 'who', 'owner', 'expect', 'err:forbidden', 'label', 'a member cannot archive',
      'q', $q$select public.admin_archive_org({org_v}, true)::text$q$),
    jsonb_build_object('id', 'A03', 'who', 'service', 'expect', 'ret:0', 'label', 'company_search (sign-up) hides an archived company',
      'setup', $s$update public.organizations set archived_at = now() where id = {org_v}$s$,
      'q', $q$select count(*)::text from public.company_search({name_v}) c where c.id = {org_v}$q$),
    jsonb_build_object('id', 'A04', 'who', 'service', 'expect', 'ret:1', 'label', 'and finds it when listed',
      'q', $q$select count(*)::text from public.company_search({name_v}) c where c.id = {org_v}$q$),
    jsonb_build_object('id', 'A05', 'who', 'admin', 'expect', 'ret:true', 'label', 'staff list it again',
      'setup', $s$update public.organizations set archived_at = now() where id = {org_v}$s$,
      'q', $q$select public.admin_archive_org({org_v}, false) ->> 'ok'$q$,
      'chk', $c$select archived_at is null from public.organizations where id = {org_v}$c$),
    jsonb_build_object('id', 'D01', 'who', 'admin', 'expect', 'ret:true', 'label', 'staff mark a duplicate of a listed company, logged',
      'q', $q$select public.admin_mark_duplicate_org({org_p}, {org_v}, 'dry run') ->> 'ok'$q$,
      'chk', $c$select (select duplicate_of = {org_v} from public.organizations where id = {org_p}) and exists (select 1 from public.review_log where subject_id = {org_p} and action = 'marked_duplicate')$c$),
    jsonb_build_object('id', 'D02', 'who', 'admin', 'expect', 'err:duplicate_of_self', 'label', 'never its own duplicate',
      'q', $q$select public.admin_mark_duplicate_org({org_v}, {org_v})::text$q$),
    jsonb_build_object('id', 'D03', 'who', 'admin', 'expect', 'err:sm26_company_must_survive', 'label', 'an SM26-linked company is never the one hidden (read only)',
      'q', $q$select public.admin_mark_duplicate_org({sm26_org}, {org_v})::text$q$),
    jsonb_build_object('id', 'D04', 'who', 'admin', 'expect', 'err:target_not_listed', 'label', 'no chains: the survivor must be listed',
      'setup', $s$update public.organizations set duplicate_of = {org_v} where id = {org_p}$s$,
      'q', $q$select public.admin_mark_duplicate_org({org_v}, {org_p})::text$q$),
    jsonb_build_object('id', 'D05', 'who', 'admin', 'expect', 'ret:true', 'label', 'staff clear the mark',
      'setup', $s$update public.organizations set duplicate_of = {org_v} where id = {org_p}$s$,
      'q', $q$select public.admin_mark_duplicate_org({org_p}, null) ->> 'ok'$q$,
      'chk', $c$select duplicate_of is null from public.organizations where id = {org_p}$c$),
    -- ── signed-out reads ──
    jsonb_build_object('id', 'K01', 'who', 'anon', 'expect', 'ret:1', 'label', 'anyone: member count of a validated company',
      'q', $q$select string_agg(c.members::text, ',') from public.org_public_member_counts(array[{org_v}]::uuid[]) c$q$),
    jsonb_build_object('id', 'K02', 'who', 'anon', 'expect', 'ret:0', 'label', 'nothing for an archived or a pending company',
      'setup', $s$update public.organizations set archived_at = now() where id = {org_v}$s$,
      'q', $q$select count(*)::text from public.org_public_member_counts(array[{org_v}, {org_p}]::uuid[])$q$),
    jsonb_build_object('id', 'K03', 'who', 'anon', 'expect', 'rls', 'label', 'get_public_profiles: not for anon any more',
      'q', $q$select count(*)::text from public.get_public_profiles(array[{owner}]::uuid[])$q$),
    jsonb_build_object('id', 'K04', 'who', 'owner', 'expect', 'ret:1', 'label', 'get_public_profiles: signed-in callers as before',
      'q', $q$select count(*)::text from public.get_public_profiles(array[{owner}]::uuid[])$q$),
    jsonb_build_object('id', 'K05', 'who', 'anon', 'expect', 'ret:1', 'label', 'a visitor''s directory read filtering on the new columns works (no 42501)',
      'q', $q$select count(*)::text from (select o.id, o.archived_at, o.duplicate_of from public.organizations o where o.id = {org_v} and o.archived_at is null and o.duplicate_of is null limit 1) x$q$),
    jsonb_build_object('id', 'K06', 'who', 'owner', 'expect', 'ret:1/0', 'label', 'a member reads the new columns, and the filter leaves an archived company out',
      'setup', $s$update public.organizations set archived_at = now() where id = {org_v}$s$,
      'q', $q$select (select count(*) from public.organizations o where o.id = {org_v} and o.archived_at is not null)::text || '/'
               || (select count(*) from public.organizations o where o.id = {org_v} and o.archived_at is null and o.duplicate_of is null)::text$q$)
  );

  -- Runner: setup s0 + setup (postgres), q as the caller (an expected error is caught around q
  -- only, so chk still runs), chk (postgres), all rolled back. {x} = quoted vars.x; <x> = raw.
  for t in select * from jsonb_array_elements(tests) loop
    v_q := t ->> 'q'; v_setup := coalesce(t ->> 'setup', ''); v_chkq := coalesce(t ->> 'chk', ''); v_exp := t ->> 'expect';
    if not coalesce((t ->> 'bare')::boolean, false) then v_setup := s0 || ';' || v_setup; end if;
    for kv in select * from jsonb_each_text(vars) loop
      v_q := replace(v_q, '{' || kv.key || '}', quote_literal(kv.value));
      v_setup := replace(v_setup, '{' || kv.key || '}', quote_literal(kv.value));
      v_chkq := replace(v_chkq, '{' || kv.key || '}', quote_literal(kv.value));
      v_exp := replace(v_exp, '<' || kv.key || '>', kv.value);
    end loop;
    v_dml := lower(left(ltrim(v_q), 6)) in ('insert', 'update', 'delete');
    v_ret := null; v_n := null; v_err := null; v_state := null; v_chk := null;
    begin
      perform set_config('request.jwt.claims', '', true);
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claim.role', '', true);
      if btrim(v_setup, ' ;') <> '' then execute v_setup; end if;
      if t ->> 'who' = 'postgres' then
        null;
      elsif t ->> 'who' like 'jwt:%' then
        perform set_config('request.jwt.claims', jsonb_build_object('sub', vars ->> substr(t ->> 'who', 5), 'role', 'authenticated')::text, true);
      elsif t ->> 'who' = 'anon' then
        perform set_config('request.jwt.claims', '{"role": "anon"}', true);
        set local role anon;
      elsif t ->> 'who' = 'service' then
        perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
        set local role service_role;
      else
        v_uid := (vars ->> (t ->> 'who'))::uuid;
        perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated',
          'email', (select u.email from auth.users u where u.id = v_uid))::text, true);
        set local role authenticated;
      end if;
      begin
        if v_dml then
          execute v_q;
          get diagnostics v_n = row_count;
        else
          execute v_q into v_ret;
        end if;
      exception when others then
        if v_exp like 'err:%' or v_exp = 'rls' then v_err := sqlerrm; v_state := sqlstate; else raise; end if;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      if v_chkq <> '' then execute v_chkq into v_chk; end if;
      raise exception using errcode = 'DRY01', message = 'case finished';
    exception
      when sqlstate 'DRY01' then null;
      when others then v_err := coalesce(v_err, sqlerrm); v_state := coalesce(v_state, sqlstate);
    end;
    v_pass := coalesce(case
                when v_exp = 'allow' then v_err is null and (not v_dml or v_n > 0)
                when v_exp = 'rls' then v_state = '42501' or (v_err is null and v_dml and v_n = 0)
                when v_exp like 'err:%' then strpos(v_err, substr(v_exp, 5)) > 0
                when v_exp like 'ret:%' then v_err is null and v_ret is not distinct from substr(v_exp, 5)
              end, false)
              and (v_chkq = '' or v_chk is true);
    if v_pass then n_pass := n_pass + 1; else n_fail := n_fail + 1; end if;
    results := results || format(E'\n%s %s %s: %s | expect %s | %s%s',
      case when v_pass then 'PASS' else 'FAIL' end, t ->> 'id', t ->> 'who', t ->> 'label', v_exp,
      left(case when v_err is not null then format('error %s: %s', v_state, v_err)
                when v_dml then v_n || ' row(s) written'
                else 'returned ' || coalesce(v_ret, 'null') end, 300),
      case when v_chkq <> '' then ' | chk ' || coalesce(v_chk::text, 'null') else '' end);
  end loop;

  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (review_and_validation_orgs dry run, run %s)', n_pass, n_fail, now()) || results;
end
$dryrun$;
