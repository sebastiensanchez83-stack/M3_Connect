-- DRY RUN of the DOWN of supabase/migrations/20261016091000_review_and_validation_queue.sql. NOT
-- A MIGRATION. ONE execute_sql call, AFTER that file is APPLIED (the migration is not repeated
-- here: with the 20 KB of v1 it restores, the file would pass 60 KB). Reads the applied v2 queue
-- (p_filter null) as a temporary admin, runs the down verbatim, then checks that v1 is back
-- exactly and lists the same rows. Ends with RAISE EXCEPTION 'DRYRUN ...'. Expected: "4 PASS, 0 FAIL".

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ─── A. The applied v2 queue, p_filter null, as a temporary verified admin sees it ─────
create temp table _dr_admin on commit drop as select gen_random_uuid() as id;
insert into auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
select a.id, 'dryrun-qadmin-' || left(a.id::text, 8) || '@example.invalid', 'authenticated', 'authenticated', '{}', now(), now(), now() from _dr_admin a;
update public.profiles set persona = 'admin', access_status = 'verified', onboarding_status = 'completed'
 where user_id = (select id from _dr_admin);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select id from _dr_admin), 'role', 'authenticated')::text, true);
create temp table _q_v2 on commit drop as select * from public.admin_review_queue(null::jsonb);
select set_config('request.jwt.claims', '', true);

-- ─── B2. The down, verbatim ─────────────────────────────────────────────────────
-- DOWN for supabase/migrations/20261016091000_review_and_validation_queue.sql
-- Puts the v1 queue back exactly as applied on 10 Oct (20261010083745, file
-- 20261009230000_admin_review_queue.sql, md5 fd5b3948... and 88a81b56...): drops the v2
-- functions, then recreates admin_review_queue() and admin_review_queue_count() verbatim.
-- No data changes (the queue only reads). Dry run, AFTER the migration is applied:
-- supabase/dryrun/20261016091000_review_and_validation_queue.down.dryrun.sql.

set local lock_timeout = '5s';
set local statement_timeout = '120s';

drop function if exists public.admin_review_queue_counts();
drop function if exists public.admin_review_queue_count();
drop function if exists public.admin_review_queue(jsonb);
drop function if exists public.review_queue_rows(boolean, boolean);

-- ---- v1, verbatim from 20261009230000_admin_review_queue.sql ----
create or replace function public.admin_review_queue()
returns table (
  kind text,
  id uuid,
  title text,
  subtitle text,
  created_at timestamptz,
  waiting_since timestamptz,
  url text,
  priority integer,
  facts jsonb
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
#variable_conflict use_column
declare
  v_admin boolean;
begin
  if not coalesce(public.is_moderator(), false) then
    raise exception 'admin_review_queue: M3 staff only' using errcode = '42501';
  end if;
  v_admin := coalesce(public.is_admin(), false);

  -- 1. Reported conversations (priority 1), admins and moderators (the table's
  --    staff RLS is is_moderator()). Optional table: read through EXECUTE.
  if pg_catalog.to_regclass('public.conversation_reports') is not null then
    begin
      return query execute $q$
        select 'report'::text,
               r.id,
               coalesce(nullif(concat_ws(' and ', nullif(btrim(po.name), ''), nullif(btrim(mo.name), '')), ''),
                        'A conversation between members')::text,
               nullif(left(btrim(r.reason), 160), '')::text,
               r.created_at,
               r.created_at,
               '/admin/partner-requests'::text,
               1,
               jsonb_strip_nulls(jsonb_build_object(
                 'reason', nullif(left(btrim(r.reason), 1000), ''),
                 'excerpt', nullif(left(btrim(r.excerpt), 30000), ''),
                 'reporter_name', nullif(btrim(concat_ws(' ', btrim(rp.first_name), btrim(rp.last_name))), ''),
                 'reporter_company', nullif(btrim(ro.name), ''),
                 'partner_request_id', r.partner_request_id,
                 'one_message', r.message_id is not null))
          from public.conversation_reports r
          left join public.partner_requests pr on pr.id = r.partner_request_id
          left join public.organizations po on po.id = pr.partner_organization_id
          left join public.organizations mo on mo.id = pr.marina_organization_id
          left join public.organizations ro on ro.id = r.reporter_org_id
          left join public.profiles rp on rp.user_id = r.reporter_user_id
         where r.status = 'open'
         order by r.created_at asc, r.id
      $q$;
    exception
      when undefined_table then
        -- Dropped between the check above and the read: nothing to report.
        null;
      when undefined_column or undefined_function or datatype_mismatch then
        -- The table exists but not as expected: say so on the list (one stand-in
        -- row the page shows without a Close button), never drop reports silently.
        raise warning 'admin_review_queue: reported conversations could not be read (% %)', sqlstate, sqlerrm;
        return query
          select 'report'::text,
                 '00000000-0000-0000-0000-000000000000'::uuid,
                 'Reported conversations could not be listed here'::text,
                 null::text,
                 now(),
                 now(),
                 '/admin/partner-requests'::text,
                 1,
                 jsonb_build_object('unreadable', true);
    end;
  end if;

  -- 2-9. Everything else, in one sorted query.
  return query
  with
  member_org as (
    -- A person's company: the one they own first, else the first they joined.
    select distinct on (m.user_id) m.user_id, m.organization_id, m.role
      from public.organization_members m
     order by m.user_id, (m.role = 'owner') desc, m.joined_at asc nulls last, m.organization_id
  ),
  org_size as (
    select m.organization_id, count(*)::integer as members
      from public.organization_members m
     group by m.organization_id
  ),
  seats as (
    select g.event_id, (count(*) filter (where g.status in ('confirmed', 'invited', 'approved')))::integer as held
      from public.gl_guest g
     group by g.event_id
  ),
  q as (
    -- 2. Event invitation requests (requests and plus-ones), priority 2.
    select 'event_request'::text as kind,
           g.id as id,
           coalesce(nullif(btrim(concat_ws(' ', btrim(g.first_name), btrim(g.last_name))), ''),
                    nullif(btrim(g.email), ''), 'Unnamed guest')::text as title,
           nullif(concat_ws(' @ ', nullif(btrim(g.job_title), ''), nullif(btrim(g.company), '')), '')::text as subtitle,
           g.created_at as created_at,
           g.created_at as waiting_since,
           -- Only a guest_list_v1 event opens the guest list (its Approve e-mails the
           -- gl_guest.token QR); a core_v2 event opens its own event screen.
           (case when ge.engine = 'guest_list_v1' then '/admin/guest-list/' || e.slug
                 when e.legacy_event_id is not null then '/admin/events/' || e.legacy_event_id::text
                 else '/admin/events' end)::text as url,
           2 as priority,
           jsonb_strip_nulls(jsonb_build_object(
             'event_id', e.id,
             'event_slug', e.slug,
             'event_title', e.title,
             'engine', ge.engine,
             'source', g.source,
             'email', nullif(btrim(g.email), ''),
             'country', nullif(btrim(g.country), ''),
             'motivation', nullif(left(btrim(g.motivation), 400), ''),
             'wants_conference', g.wants_conference,
             'wants_gala', g.wants_gala,
             'plus_one_of', case when h.id is not null
                                 then coalesce(nullif(btrim(concat_ws(' ', btrim(h.first_name), btrim(h.last_name))), ''), h.email)
                            end,
             'capacity', e.capacity,
             'seats_held', coalesce(s.held, 0))) as facts
      from public.gl_guest g
      join public.gl_event e on e.id = g.event_id
      -- engine / hidden arrive with the registration lane: read through to_jsonb.
      cross join lateral (
        select coalesce(to_jsonb(e) ->> 'engine', 'guest_list_v1') as engine,
               coalesce((to_jsonb(e) ->> 'hidden')::boolean, false) as hidden
      ) ge
      left join public.gl_guest h on h.id = g.plus_one_of
      left join seats s on s.event_id = e.id
     where v_admin
       and g.status = 'requested'
       and e.slug not like 'canary-%'
       and not ge.hidden

    union all

    -- 3. People waiting for access (form sent, not a draft), priority 3.
    --    E-mail = the login address (auth.users.email): profiles.email is writable
    --    by its owner, and no address here is proven (Confirm email is OFF).
    select 'person'::text,
           p.user_id,
           coalesce(nullif(btrim(concat_ws(' ', btrim(p.first_name), btrim(p.last_name))), ''),
                    nullif(d.email, ''), 'Unnamed account')::text,
           nullif(concat_ws(' @ ', nullif(btrim(p.job_title), ''), nullif(btrim(o.name), '')), '')::text,
           p.created_at,
           p.created_at,
           ('/admin/users/' || p.user_id::text)::text,
           3,
           jsonb_strip_nulls(jsonb_build_object(
             'email', nullif(d.email, ''),
             'email_domain', nullif(d.edomain, ''),
             -- left out (null) until profiles.email_proven_at exists
             'email_proven', d.proven,
             'public_email', case when d.edomain <> '' then public.is_public_email_domain(d.edomain) end,
             'persona', p.persona::text,
             'job_title', nullif(btrim(p.job_title), ''),
             -- profiles.country / linkedin_url arrive with the registration lane
             'person_country', nullif(btrim(d.pj ->> 'country'), ''),
             'linkedin', case when d.pj ? 'linkedin_url' then nullif(btrim(d.pj ->> 'linkedin_url'), '') is not null end,
             'onboarding_status', p.onboarding_status::text,
             'company_id', o.id,
             'company_name', nullif(btrim(o.name), ''),
             'company_status', o.access_status,
             'company_type', o.organization_type,
             'company_country', coalesce(nullif(btrim(o.country), ''), nullif(btrim(o.headquarters_country), '')),
             'company_website', nullif(btrim(o.website), ''),
             'company_role', mo.role,
             'company_members', os.members,
             'domain_match', case
                               when d.edomain = '' or d.whost = '' then null
                               when public.is_public_email_domain(d.edomain) then null
                               else d.edomain = d.whost
                                    or right(d.edomain, length(d.whost) + 1) = '.' || d.whost
                                    or right(d.whost, length(d.edomain) + 1) = '.' || d.edomain
                             end,
             -- An attending attendee of a confirmed SM26 registration (READ ONLY), linked
             -- by account; by e-mail only when that address is proven.
             'sm26', exists (select 1
                               from public.sm_attendee a
                               join public.sm_registration r on r.id = a.registration_id
                              where r.status = 'confirmed'
                                and a.attending
                                and (a.user_id = p.user_id
                                     or (d.proven is true and d.lemail <> ''
                                         and lower(btrim(a.email)) = d.lemail)))))
      from public.profiles p
      left join auth.users u on u.id = p.user_id
      left join member_org mo on mo.user_id = p.user_id
      left join public.organizations o on o.id = mo.organization_id
      left join org_size os on os.organization_id = o.id
      cross join lateral (
        select x.email,
               lower(x.email) as lemail,
               lower(split_part(x.email, '@', 2)) as edomain,
               lower(regexp_replace(regexp_replace(btrim(coalesce(o.website, '')), '^[a-z][a-z0-9+.-]*://', '', 'i'),
                                    '^www\.|[/:?#].*$', '', 'g')) as whost,
               x.pj,
               -- proven = the stamp is set AND the stamped copy is still the login address
               case when x.pj ? 'email_proven_at'
                    then (x.pj ->> 'email_proven_at') is not null
                         and coalesce(lower(btrim(p.email)) = lower(btrim(u.email)), false)
               end as proven
          from (select coalesce(nullif(btrim(u.email), ''), nullif(btrim(p.email), ''), '') as email,
                       to_jsonb(p) as pj) x
      ) d
     where v_admin
       and p.access_status::text = 'pending'
       and p.onboarding_status::text <> 'draft'

    union all

    -- 4. Companies waiting that no person card shows, priority 3.
    select 'company'::text,
           o.id,
           coalesce(nullif(btrim(o.name), ''), 'Unnamed company')::text,
           nullif(concat_ws(' · ', coalesce(nullif(btrim(o.country), ''), nullif(btrim(o.headquarters_country), '')),
                            nullif(w.whost, '')), '')::text,
           o.created_at,
           o.created_at,
           ('/admin/organizations/' || o.id::text)::text,
           3,
           jsonb_strip_nulls(jsonb_build_object(
             'company_type', o.organization_type,
             'country', coalesce(nullif(btrim(o.country), ''), nullif(btrim(o.headquarters_country), '')),
             'website', nullif(btrim(o.website), ''),
             'members', coalesce(os.members, 0),
             'owner_name', nullif(btrim(concat_ws(' ', btrim(op.first_name), btrim(op.last_name))), ''),
             'owner_status', op.access_status::text,
             'onboarding_status', o.onboarding_status))
      from public.organizations o
      left join org_size os on os.organization_id = o.id
      left join public.profiles op on op.user_id = o.owner_user_id
      cross join lateral (
        select lower(regexp_replace(regexp_replace(btrim(coalesce(o.website, '')), '^[a-z][a-z0-9+.-]*://', '', 'i'),
                                    '^www\.|[/:?#].*$', '', 'g')) as whost
      ) w
     where v_admin
       and o.access_status = 'pending'
       -- (a) not already on a waiting person's card (section 3 shows member_org)
       and not exists (select 1
                         from member_org mo2
                         join public.profiles mp on mp.user_id = mo2.user_id
                        where mo2.organization_id = o.id
                          and mp.access_status::text = 'pending'
                          and mp.onboarding_status::text <> 'draft')
       -- (b) not a company whose people are all still drafts (an empty one is shown)
       and not (exists (select 1 from public.organization_members m where m.organization_id = o.id)
                and not exists (select 1
                                  from public.organization_members m
                                  left join public.profiles mp on mp.user_id = m.user_id
                                 where m.organization_id = o.id
                                   and not (coalesce(mp.access_status::text, '') = 'pending'
                                            and coalesce(mp.onboarding_status::text, '') = 'draft')))

    union all

    -- 5a. RFPs, priority 4.
    select 'need'::text,
           r.id,
           coalesce(nullif(btrim(r.title), ''), 'Untitled request for proposals')::text,
           coalesce(nullif(btrim(o.name), ''), nullif(btrim(concat_ws(' ', btrim(a.first_name), btrim(a.last_name))), ''))::text,
           r.created_at,
           r.created_at,
           ('/admin/rfps/' || r.id::text)::text,
           4,
           jsonb_strip_nulls(jsonb_build_object(
             'need_type', 'rfp',
             'status', r.status,
             'company_name', nullif(btrim(o.name), ''),
             'author_name', nullif(btrim(concat_ws(' ', btrim(a.first_name), btrim(a.last_name))), ''),
             'deadline', r.deadline_date))
      from public.rfps r
      left join public.organizations o on o.id = r.organization_id
      left join public.profiles a on a.user_id = r.marina_user_id
     where v_admin
       and r.status in ('submitted', 'under_review')

    union all

    -- 5b. Consultations, priority 4.
    select 'need'::text,
           c.id,
           coalesce(nullif(btrim(c.title), ''), 'Untitled consultation')::text,
           coalesce(nullif(btrim(o.name), ''), nullif(btrim(concat_ws(' ', btrim(a.first_name), btrim(a.last_name))), ''))::text,
           c.created_at,
           c.created_at,
           ('/admin/consultations/' || c.id::text)::text,
           4,
           jsonb_strip_nulls(jsonb_build_object(
             'need_type', 'consultation',
             'status', c.status,
             'company_name', nullif(btrim(o.name), ''),
             'author_name', nullif(btrim(concat_ws(' ', btrim(a.first_name), btrim(a.last_name))), '')))
      from public.consultations c
      left join public.organizations o on o.id = c.organization_id
      left join public.profiles a on a.user_id = c.marina_user_id
     where v_admin
       and c.status in ('submitted', 'under_review')

    union all

    -- 5c. Marina projects, priority 4.
    select 'need'::text,
           mp.id,
           coalesce(nullif(initcap(replace(btrim(mp.project_type), '_', ' ')), ''), 'Marina project')::text,
           coalesce(nullif(btrim(o.name), ''), nullif(btrim(concat_ws(' ', btrim(a.first_name), btrim(a.last_name))), ''))::text,
           mp.created_at,
           mp.created_at,
           ('/admin/projects/' || mp.id::text)::text,
           4,
           jsonb_strip_nulls(jsonb_build_object(
             'need_type', 'project',
             'status', mp.status,
             'company_name', nullif(btrim(o.name), ''),
             'author_name', nullif(btrim(concat_ws(' ', btrim(a.first_name), btrim(a.last_name))), ''),
             'budget_range', nullif(btrim(mp.budget_range), ''),
             'timeline', nullif(btrim(mp.timeline), '')))
      from public.marina_projects mp
      left join public.organizations o on o.id = mp.organization_id
      left join public.profiles a on a.user_id = mp.user_id
     where v_admin
       and mp.status in ('new', 'submitted', 'under_review')

    union all

    -- 6. Webinar proposals (moderators too), priority 4.
    select 'webinar'::text,
           wr.id,
           coalesce(nullif(btrim(wr.title), ''), 'Untitled webinar proposal')::text,
           nullif(concat_ws(' @ ', nullif(btrim(concat_ws(' ', btrim(a.first_name), btrim(a.last_name))), ''),
                            nullif(btrim(o.name), '')), '')::text,
           wr.created_at,
           wr.created_at,
           ('/admin/webinars/' || wr.id::text)::text,
           4,
           jsonb_strip_nulls(jsonb_build_object(
             'status', wr.status::text,
             'language', nullif(btrim(wr.preferred_language), ''),
             'timeframe', nullif(btrim(wr.preferred_timeframe), ''),
             'company_name', nullif(btrim(o.name), '')))
      from public.webinar_requests wr
      left join public.profiles a on a.user_id = wr.user_id
      left join public.organizations o on o.id = wr.organization_id
     where wr.status::text in ('submitted', 'under_review')

    union all

    -- 7. Article drafts (moderators too), priority 4.
    select 'resource_draft'::text,
           rd.id,
           coalesce(nullif(btrim(rd.title), ''), 'Untitled draft')::text,
           nullif(btrim(concat_ws(' ', btrim(a.first_name), btrim(a.last_name))), '')::text,
           rd.created_at,
           coalesce(rd.updated_at, rd.created_at),
           ('/admin/resources/' || rd.id::text || '?type=draft')::text,
           4,
           jsonb_strip_nulls(jsonb_build_object(
             'status', rd.status::text,
             'type', nullif(btrim(rd.type), ''),
             'language', nullif(btrim(rd.language), '')))
      from public.resource_drafts rd
      left join public.profiles a on a.user_id = rd.created_by
     where rd.status::text in ('submitted', 'review_1', 'review_2')

    union all

    -- 8. Old sponsorship requests (legacy queue), priority 4.
    select 'sponsorship'::text,
           sr.id,
           coalesce(nullif(btrim(o.name), ''), 'Unknown company')::text,
           nullif(initcap(replace(btrim(coalesce(sr.requested_tier, '')), '_', ' ')), '')::text,
           sr.created_at,
           case when sr.status = 'paid' then coalesce(sr.payment_confirmed_at, sr.updated_at, sr.created_at) else sr.created_at end,
           ('/admin/sponsorship-requests/' || sr.id::text)::text,
           4,
           jsonb_strip_nulls(jsonb_build_object(
             'status', sr.status,
             'current_tier', sr.current_tier,
             'requested_tier', sr.requested_tier))
      from public.sponsorship_requests sr
      left join public.organizations o on o.id = sr.organization_id
     where v_admin
       and sr.status in ('pending', 'paid')

    union all

    -- 9. Old exposition requests (legacy queue), priority 4.
    select 'exposition'::text,
           x.id,
           coalesce(nullif(btrim(o.name), ''), 'Unknown company')::text,
           nullif(btrim(ev.title), '')::text,
           x.created_at,
           case when x.status = 'paid' then coalesce(x.payment_confirmed_at, x.created_at) else x.created_at end,
           ('/admin/expositions/' || x.id::text)::text,
           4,
           jsonb_strip_nulls(jsonb_build_object(
             'status', x.status,
             'event_title', nullif(btrim(ev.title), '')))
      from public.exposition_requests x
      left join public.organizations o on o.id = x.organization_id
      left join public.events ev on ev.id = x.event_id
     where v_admin
       and x.status in ('pending', 'paid')
  )
  select q.kind, q.id, q.title, q.subtitle, q.created_at, q.waiting_since, q.url, q.priority, q.facts
    from q
   order by q.priority, q.waiting_since asc nulls last, q.kind, q.id;
end;
$function$;

comment on function public.admin_review_queue() is
  'M3 review queue (/admin/review): one row per item waiting for M3 staff (kind, id, title, subtitle, created_at, waiting_since, url, priority 1-4, facts), most urgent first, then longest waiting first. Read only. Verified staff only (42501 otherwise); moderators get reported conversations, webinar proposals and article drafts only. conversation_reports is read only if it exists (one stand-in row with facts.unreadable when its columns differ). A later overload must DROP this signature first (PostgREST ambiguity). Migration 20261009230000.';

create or replace function public.admin_review_queue_count()
returns integer
language sql
stable
security invoker
set search_path to ''
as $function$
  select count(*)::integer from public.admin_review_queue();
$function$;

comment on function public.admin_review_queue_count() is
  'Number of rows public.admin_review_queue() returns for the caller (sidebar badge "To review", dashboard card). Staff only through that function. Migration 20261009230000.';

revoke all on function public.admin_review_queue() from public, anon;
revoke all on function public.admin_review_queue_count() from public, anon;
grant execute on function public.admin_review_queue() to authenticated;
grant execute on function public.admin_review_queue_count() to authenticated;

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
  vars := jsonb_build_object('admin', (select id::text from _dr_admin));
  s0 := '';
  tests := jsonb_build_array(
    jsonb_build_object('id', 'D01', 'who', 'jwt:admin', 'expect', 'ret:0', 'label', 'the restored v1 lists the same rows as v2 with p_filter null (v2 facts a superset)',
      'q', $q$select (count(*) + (select count(*) from _q_v2 n join public.admin_review_queue() o on o.kind = n.kind and o.id = n.id where not (n.facts @> o.facts)))::text
               from ((select kind, id, title, subtitle, created_at, waiting_since, url, priority from _q_v2
                      except select kind, id, title, subtitle, created_at, waiting_since, url, priority from public.admin_review_queue())
                     union all
                     (select kind, id, title, subtitle, created_at, waiting_since, url, priority from public.admin_review_queue()
                      except select kind, id, title, subtitle, created_at, waiting_since, url, priority from _q_v2)) d$q$),
    jsonb_build_object('id', 'D02', 'who', 'postgres', 'bare', true, 'expect', 'ret:fd5b3948edc00996d367d9ae13fd0042,88a81b56160d50bfe446717f87fcffbf', 'label', 'v1 bodies back (admin_review_queue, admin_review_queue_count)',
      'q', $q$select string_agg(md5(replace(p.prosrc, chr(13), '')), ',' order by p.proname) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('admin_review_queue', 'admin_review_queue_count')$q$),
    jsonb_build_object('id', 'D03', 'who', 'postgres', 'bare', true, 'expect', 'ret:0', 'label', 'the v2 functions are gone',
      'q', $q$select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and (proname in ('review_queue_rows', 'admin_review_queue_counts') or oid = to_regprocedure('public.admin_review_queue(jsonb)'))$q$),
    jsonb_build_object('id', 'D04', 'who', 'postgres', 'bare', true, 'expect', 'ret:true/false/true', 'label', 'EXECUTE as v1: members yes, anon no',
      'q', $q$select has_function_privilege('authenticated', 'public.admin_review_queue()', 'execute')::text || '/' || has_function_privilege('anon', 'public.admin_review_queue()', 'execute')::text || '/' || has_function_privilege('authenticated', 'public.admin_review_queue_count()', 'execute')::text$q$)
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

  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (review_and_validation_queue down dry run, run %s)', n_pass, n_fail, now()) || results;
end
$dryrun$;
