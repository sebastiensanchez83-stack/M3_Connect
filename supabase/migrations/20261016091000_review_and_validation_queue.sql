-- Registration Phase 3 (DB lane), part 3 of 4: the review queue v2 (/admin/review).
-- Spec: regspec-en.md §8.1, §4.6 (admin_review_queue(filter)), §12 (Q6 retro-review). Contract §11.4.
-- NOT APPLIED. Apply after 20261016090500_review_and_validation_people (checked below).
-- Down: supabase/migrations/down/20261016091000_review_and_validation_queue.down.sql (restores v1).
-- Dry runs: supabase/dryrun/20261016091000_review_and_validation_queue.dryrun.sql, .dryrun2.sql;
-- the down's: .down.dryrun.sql (run AFTER this file is applied).
--
-- admin_review_queue() (v1, applied 20261010083745) becomes admin_review_queue(p_filter jsonb
-- default null). The v1 note asked for exactly this: the zero-argument signature is DROPPED
-- first, so supabase.rpc('admin_review_queue') stays unambiguous (PGRST203).
--   p_filter null (the redesign's page and badge today, flag review_queue off): the SAME rows
--     as v1, in the same order; each row gains two columns (tab, signals) and a few extra
--     facts keys. admin_review_queue_count() keeps counting exactly these rows.
--   p_filter an object (queue v2, flag review_queue on): {tab?: people | registrations |
--     team_joins | duplicates | retro | content, event_id?: gl_event id}. Adds the v2 cards:
--     claim, join_request (people), team_join (team_joins), duplicate_org, duplicate_person
--     (duplicates), retro (retro); and the legacy pending drafts (spec §12) as people.
-- admin_review_queue_counts(): {total, <tab>: n, oldest: {<tab>: timestamptz}} of the v2 queue,
--   for the tabs and the sidebar badge, and for registration-cron's 08:00 digest (service role).
-- Read only. sm_* rows are only read. Verified admins see everything; a verified moderator
-- sees the content tab only (reports, webinar proposals, article drafts), as in v1.

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $pre$
declare
  v_md5 text;
begin
  if to_regprocedure('public.admin_review_dismiss(text,uuid,uuid,text)') is null then
    raise exception 'review_and_validation_queue: apply 20261016090500_review_and_validation_people first';
  end if;
  select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p where p.oid = to_regprocedure('public.admin_review_queue()');
  if v_md5 is distinct from 'fd5b3948edc00996d367d9ae13fd0042'
     and not (v_md5 is null and to_regprocedure('public.admin_review_queue(jsonb)') is not null) then
    raise exception 'review_and_validation_queue: admin_review_queue() changed (md5 %); rebuild this migration', v_md5;
  end if;
  select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p where p.oid = to_regprocedure('public.admin_review_queue_count()');
  if v_md5 is distinct from '88a81b56160d50bfe446717f87fcffbf' and v_md5 is distinct from '7dba3abde522f780c4ce3ea04072c215' then
    raise exception 'review_and_validation_queue: admin_review_queue_count() changed (md5 %)', v_md5;
  end if;
end
$pre$;

drop function if exists public.admin_review_queue();

-- All the rows. Internal: no client may call it (the wrappers check the caller).
create or replace function public.review_queue_rows(p_admin boolean, p_v2 boolean)
returns table (kind text, id uuid, title text, subtitle text, created_at timestamptz, waiting_since timestamptz,
               url text, priority integer, facts jsonb, tab text, signals jsonb)
language plpgsql
stable
security definer
set search_path to ''
as $function$
#variable_conflict use_column
declare
  -- Team joins are listed from here; earlier ones are in the Q6 retro-review list.
  c_since constant timestamptz := timestamptz '2026-10-16 00:00:00+00';
begin
  -- 1. Reported conversations (v1, unchanged), admins and moderators.
  if pg_catalog.to_regclass('public.conversation_reports') is not null then
    begin
      return query execute $q$
        select 'report'::text, r.id,
               coalesce(nullif(concat_ws(' and ', nullif(btrim(po.name), ''), nullif(btrim(mo.name), '')), ''),
                        'A conversation between members')::text,
               nullif(left(btrim(r.reason), 160), '')::text, r.created_at, r.created_at,
               '/admin/partner-requests'::text, 1,
               jsonb_strip_nulls(jsonb_build_object(
                 'reason', nullif(left(btrim(r.reason), 1000), ''),
                 'excerpt', nullif(left(btrim(r.excerpt), 30000), ''),
                 'reporter_name', nullif(btrim(concat_ws(' ', btrim(rp.first_name), btrim(rp.last_name))), ''),
                 'reporter_company', nullif(btrim(ro.name), ''),
                 'partner_request_id', r.partner_request_id,
                 'one_message', r.message_id is not null)),
               'content'::text, '{}'::jsonb
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
        null;
      when undefined_column or undefined_function or datatype_mismatch then
        raise warning 'admin_review_queue: reported conversations could not be read (% %)', sqlstate, sqlerrm;
        return query
          select 'report'::text, '00000000-0000-0000-0000-000000000000'::uuid,
                 'Reported conversations could not be listed here'::text, null::text, now(), now(),
                 '/admin/partner-requests'::text, 1, jsonb_build_object('unreadable', true), 'content'::text, '{}'::jsonb;
    end;
  end if;

  return query
  with
  member_org as (
    select distinct on (m.user_id) m.user_id, m.organization_id, m.role
      from public.organization_members m
     order by m.user_id, (m.role = 'owner') desc, m.joined_at asc nulls last, m.organization_id
  ),
  org_size as (
    select m.organization_id, count(*)::integer as members from public.organization_members m group by m.organization_id
  ),
  seats as (
    select g.event_id, (count(*) filter (where g.status in ('confirmed', 'invited', 'approved')))::integer as held
      from public.gl_guest g group by g.event_id
  ),
  -- People waiting for M3: v1 = form sent; v2 also the legacy drafts (spec §12).
  ppl as (
    select p.user_id from public.profiles p
     where p_admin and p.access_status::text = 'pending'
       and (p.onboarding_status::text <> 'draft' or (p_v2 and p.signup_source = 'legacy'))
  ),
  listed as (
    select o.id, o.name, public.normalize_org_name(o.name) as n, o.access_status, o.created_at
      from public.organizations o
     where o.archived_at is null and o.duplicate_of is null and o.access_status in ('verified', 'pending')
  ),
  dismissed as (
    select l.subject_type, l.subject_id, l.action, l.details from public.review_log l
     where l.action in ('fyi_seen', 'join_revoked', 'not_duplicate', 'retro_kept', 'validated', 'validated_participant', 'rejected')
  ),
  q as (
    -- 2. Event requests (requests and plus-ones), priority 2.
    select 'event_request'::text as kind, g.id as id,
           coalesce(nullif(btrim(concat_ws(' ', btrim(g.first_name), btrim(g.last_name))), ''),
                    nullif(btrim(g.email), ''), 'Unnamed guest')::text as title,
           nullif(concat_ws(' @ ', nullif(btrim(g.job_title), ''), nullif(btrim(g.company), '')), '')::text as subtitle,
           g.created_at as created_at, g.created_at as waiting_since,
           (case when ge.engine = 'guest_list_v1' then '/admin/guest-list/' || e.slug
                 when e.legacy_event_id is not null then '/admin/events/' || e.legacy_event_id::text
                 else '/admin/events' end)::text as url,
           2 as priority,
           jsonb_strip_nulls(jsonb_build_object(
             'event_id', e.id, 'event_slug', e.slug, 'event_title', e.title, 'engine', ge.engine, 'source', g.source,
             'email', nullif(btrim(g.email), ''), 'country', nullif(btrim(g.country), ''),
             'motivation', nullif(left(btrim(g.motivation), 400), ''),
             'wants_conference', g.wants_conference, 'wants_gala', g.wants_gala,
             'plus_one_of', case when h.id is not null
                                 then coalesce(nullif(btrim(concat_ws(' ', btrim(h.first_name), btrim(h.last_name))), ''), h.email) end,
             'capacity', e.capacity, 'seats_held', coalesce(s.held, 0),
             'ticket_key', g.ticket_key, 'guest_user_id', g.user_id)) as facts,
           'registrations'::text as tab,
           jsonb_strip_nulls(jsonb_build_object(
             'link_opened_at', g.link_opened_at,
             'existing_account', ea.uid is not null,
             'email_proven', ea.proven,
             'sm26_by_email', exists (select 1 from public.sm_attendee a join public.sm_registration r on r.id = a.registration_id
                                       where r.status = 'confirmed' and a.attending and lower(btrim(a.email)) = lower(btrim(g.email))),
             'duplicate', (select jsonb_build_object('kind', 'registration', 'id', g2.id, 'score', 0.8)
                             from public.gl_guest g2
                            where g2.event_id = g.event_id and g2.id <> g.id and g2.status not in ('cancelled', 'declined', 'rejected')
                              and public.review_name_key(g2.first_name, g2.last_name) = public.review_name_key(g.first_name, g.last_name)
                            limit 1))) as signals
      from public.gl_guest g
      join public.gl_event e on e.id = g.event_id
      cross join lateral (
        select coalesce(to_jsonb(e) ->> 'engine', 'guest_list_v1') as engine,
               coalesce((to_jsonb(e) ->> 'hidden')::boolean, false) as hidden
      ) ge
      left join public.gl_guest h on h.id = g.plus_one_of
      left join seats s on s.event_id = e.id
      left join lateral (
        select u.id as uid, (pr.email_proven_at is not null and lower(btrim(pr.email)) = lower(btrim(u.email))) as proven
          from auth.users u left join public.profiles pr on pr.user_id = u.id
         where lower(btrim(u.email)) = lower(btrim(g.email)) order by u.created_at limit 1
      ) ea on true
     where p_admin and g.status = 'requested' and e.slug not like 'canary-%' and not ge.hidden

    union all

    -- 3. People waiting for access, priority 3.
    select 'person'::text, p.user_id,
           coalesce(nullif(btrim(concat_ws(' ', btrim(p.first_name), btrim(p.last_name))), ''), nullif(d.email, ''), 'Unnamed account')::text,
           nullif(concat_ws(' @ ', nullif(btrim(p.job_title), ''), nullif(btrim(o.name), '')), '')::text,
           p.created_at, p.created_at, ('/admin/users/' || p.user_id::text)::text, 3,
           jsonb_strip_nulls(jsonb_build_object(
             'email', nullif(d.email, ''), 'email_domain', nullif(d.edomain, ''), 'email_proven', d.proven,
             'public_email', case when d.edomain <> '' then public.is_public_email_domain(d.edomain) end,
             'persona', p.persona::text, 'job_title', nullif(btrim(p.job_title), ''),
             'person_country', nullif(btrim(p.country), ''), 'linkedin', nullif(btrim(p.linkedin_url), '') is not null,
             'onboarding_status', p.onboarding_status::text,
             'company_id', o.id, 'company_name', nullif(btrim(o.name), ''), 'company_status', o.access_status,
             'company_type', o.organization_type,
             'company_country', coalesce(nullif(btrim(o.country), ''), nullif(btrim(o.headquarters_country), '')),
             'company_website', nullif(btrim(o.website), ''), 'company_role', mo.role, 'company_members', os.members,
             'domain_match', d.dmatch, 'sm26', d.sm26,
             'signup_source', p.signup_source, 'intent', p.signup_intent,
             'draft', case when p.onboarding_status::text = 'draft' then true end)),
           'people'::text,
           jsonb_strip_nulls(jsonb_build_object(
             'email_proven', d.proven, 'domain_match', d.dmatch, 'sm26', d.sm26,
             'linkedin', nullif(btrim(p.linkedin_url), '') is not null,
             'duplicate', coalesce(
               (select jsonb_build_object('kind', 'person', 'id', p2.user_id, 'score', 0.9,
                                          'name', nullif(btrim(concat_ws(' ', p2.first_name, p2.last_name)), ''))
                  from public.profiles p2
                 where p2.user_id <> p.user_id and length(coalesce(public.review_name_key(p.first_name, p.last_name), '')) >= 4
                   and public.review_name_key(p2.first_name, p2.last_name) = public.review_name_key(p.first_name, p.last_name)
                 limit 1),
               (select jsonb_build_object('kind', 'company', 'id', l2.id, 'name', l2.name,
                                          'score', round(extensions.similarity(l2.n, public.normalize_org_name(p.signup_intent ->> 'name'))::numeric, 2))
                  from listed l2
                 where p.signup_intent ->> 'action' = 'new'
                   and l2.n operator(extensions.%) public.normalize_org_name(p.signup_intent ->> 'name')
                 order by extensions.similarity(l2.n, public.normalize_org_name(p.signup_intent ->> 'name')) desc
                 limit 1)),
             'info_requested_at', (select max(l.created_at) from public.review_log l
                                    where l.subject_type = 'person' and l.subject_id = p.user_id and l.action = 'info_requested')))
      from public.profiles p
      join ppl on ppl.user_id = p.user_id
      left join auth.users u on u.id = p.user_id
      left join member_org mo on mo.user_id = p.user_id
      left join public.organizations o on o.id = mo.organization_id
      left join org_size os on os.organization_id = o.id
      cross join lateral (
        select x.email, x.edomain, x.proven,
               case when x.edomain = '' or x.whost = '' then null
                    when public.is_public_email_domain(x.edomain) then null
                    else x.edomain = x.whost or right(x.edomain, length(x.whost) + 1) = '.' || x.whost
                         or right(x.whost, length(x.edomain) + 1) = '.' || x.edomain end as dmatch,
               exists (select 1 from public.sm_attendee a join public.sm_registration r on r.id = a.registration_id
                        where r.status = 'confirmed' and a.attending
                          and (a.user_id = p.user_id or (x.proven and x.email <> '' and lower(btrim(a.email)) = lower(x.email)))) as sm26
          from (select y.email, lower(split_part(y.email, '@', 2)) as edomain,
                       lower(regexp_replace(regexp_replace(btrim(coalesce(o.website, '')), '^[a-z][a-z0-9+.-]*://', '', 'i'),
                                            '^www\.|[/:?#].*$', '', 'g')) as whost,
                       (p.email_proven_at is not null and coalesce(lower(btrim(p.email)) = lower(btrim(u.email)), false)) as proven
                  from (select coalesce(nullif(btrim(u.email), ''), nullif(btrim(p.email), ''), '') as email) y) x
      ) d

    union all

    -- 4. Companies waiting that no person card shows, priority 3.
    select 'company'::text, o.id, coalesce(nullif(btrim(o.name), ''), 'Unnamed company')::text,
           nullif(concat_ws(' · ', coalesce(nullif(btrim(o.country), ''), nullif(btrim(o.headquarters_country), '')),
                            nullif(w.whost, '')), '')::text,
           o.created_at, o.created_at, ('/admin/organizations/' || o.id::text)::text, 3,
           jsonb_strip_nulls(jsonb_build_object(
             'company_type', o.organization_type,
             'country', coalesce(nullif(btrim(o.country), ''), nullif(btrim(o.headquarters_country), '')),
             'website', nullif(btrim(o.website), ''), 'members', coalesce(os.members, 0),
             'owner_name', nullif(btrim(concat_ws(' ', btrim(op.first_name), btrim(op.last_name))), ''),
             'owner_status', op.access_status::text, 'onboarding_status', o.onboarding_status)),
           'people'::text,
           jsonb_strip_nulls(jsonb_build_object(
             'duplicate', (select jsonb_build_object('kind', 'company', 'id', l2.id, 'name', l2.name,
                                                     'score', round(extensions.similarity(l2.n, public.normalize_org_name(o.name))::numeric, 2))
                             from listed l2
                            where l2.id <> o.id and l2.n operator(extensions.%) public.normalize_org_name(o.name)
                              and extensions.similarity(l2.n, public.normalize_org_name(o.name)) >= 0.75
                            order by extensions.similarity(l2.n, public.normalize_org_name(o.name)) desc limit 1)))
      from public.organizations o
      left join org_size os on os.organization_id = o.id
      left join public.profiles op on op.user_id = o.owner_user_id
      cross join lateral (
        select lower(regexp_replace(regexp_replace(btrim(coalesce(o.website, '')), '^[a-z][a-z0-9+.-]*://', '', 'i'),
                                    '^www\.|[/:?#].*$', '', 'g')) as whost
      ) w
     where p_admin and o.access_status = 'pending'
       and not exists (select 1 from member_org mo2 join ppl on ppl.user_id = mo2.user_id where mo2.organization_id = o.id)
       and not (exists (select 1 from public.organization_members m where m.organization_id = o.id)
                and not exists (select 1 from public.organization_members m
                                  left join public.profiles mp on mp.user_id = m.user_id
                                 where m.organization_id = o.id
                                   and not (coalesce(mp.access_status::text, '') = 'pending'
                                            and coalesce(mp.onboarding_status::text, '') = 'draft')))

    union all

    -- 5. Needs (RFPs, consultations, marina projects), priority 4.
    select 'need'::text, r.id, coalesce(nullif(btrim(r.title), ''), 'Untitled request for proposals')::text,
           coalesce(nullif(btrim(o.name), ''), nullif(btrim(concat_ws(' ', btrim(a.first_name), btrim(a.last_name))), ''))::text,
           r.created_at, r.created_at, ('/admin/rfps/' || r.id::text)::text, 4,
           jsonb_strip_nulls(jsonb_build_object('need_type', 'rfp', 'status', r.status, 'company_name', nullif(btrim(o.name), ''),
             'author_name', nullif(btrim(concat_ws(' ', btrim(a.first_name), btrim(a.last_name))), ''), 'deadline', r.deadline_date)),
           'content'::text, '{}'::jsonb
      from public.rfps r
      left join public.organizations o on o.id = r.organization_id
      left join public.profiles a on a.user_id = r.marina_user_id
     where p_admin and r.status in ('submitted', 'under_review')
    union all
    select 'need'::text, c.id, coalesce(nullif(btrim(c.title), ''), 'Untitled consultation')::text,
           coalesce(nullif(btrim(o.name), ''), nullif(btrim(concat_ws(' ', btrim(a.first_name), btrim(a.last_name))), ''))::text,
           c.created_at, c.created_at, ('/admin/consultations/' || c.id::text)::text, 4,
           jsonb_strip_nulls(jsonb_build_object('need_type', 'consultation', 'status', c.status, 'company_name', nullif(btrim(o.name), ''),
             'author_name', nullif(btrim(concat_ws(' ', btrim(a.first_name), btrim(a.last_name))), ''))),
           'content'::text, '{}'::jsonb
      from public.consultations c
      left join public.organizations o on o.id = c.organization_id
      left join public.profiles a on a.user_id = c.marina_user_id
     where p_admin and c.status in ('submitted', 'under_review')
    union all
    select 'need'::text, mp.id, coalesce(nullif(initcap(replace(btrim(mp.project_type), '_', ' ')), ''), 'Marina project')::text,
           coalesce(nullif(btrim(o.name), ''), nullif(btrim(concat_ws(' ', btrim(a.first_name), btrim(a.last_name))), ''))::text,
           mp.created_at, mp.created_at, ('/admin/projects/' || mp.id::text)::text, 4,
           jsonb_strip_nulls(jsonb_build_object('need_type', 'project', 'status', mp.status, 'company_name', nullif(btrim(o.name), ''),
             'author_name', nullif(btrim(concat_ws(' ', btrim(a.first_name), btrim(a.last_name))), ''),
             'budget_range', nullif(btrim(mp.budget_range), ''), 'timeline', nullif(btrim(mp.timeline), ''))),
           'content'::text, '{}'::jsonb
      from public.marina_projects mp
      left join public.organizations o on o.id = mp.organization_id
      left join public.profiles a on a.user_id = mp.user_id
     where p_admin and mp.status in ('new', 'submitted', 'under_review')

    union all

    -- 6. Webinar proposals (moderators too), priority 4.
    select 'webinar'::text, wr.id, coalesce(nullif(btrim(wr.title), ''), 'Untitled webinar proposal')::text,
           nullif(concat_ws(' @ ', nullif(btrim(concat_ws(' ', btrim(a.first_name), btrim(a.last_name))), ''), nullif(btrim(o.name), '')), '')::text,
           wr.created_at, wr.created_at, ('/admin/webinars/' || wr.id::text)::text, 4,
           jsonb_strip_nulls(jsonb_build_object('status', wr.status::text, 'language', nullif(btrim(wr.preferred_language), ''),
             'timeframe', nullif(btrim(wr.preferred_timeframe), ''), 'company_name', nullif(btrim(o.name), ''))),
           'content'::text, '{}'::jsonb
      from public.webinar_requests wr
      left join public.profiles a on a.user_id = wr.user_id
      left join public.organizations o on o.id = wr.organization_id
     where wr.status::text in ('submitted', 'under_review')

    union all

    -- 7. Article drafts (moderators too), priority 4.
    select 'resource_draft'::text, rd.id, coalesce(nullif(btrim(rd.title), ''), 'Untitled draft')::text,
           nullif(btrim(concat_ws(' ', btrim(a.first_name), btrim(a.last_name))), '')::text,
           rd.created_at, coalesce(rd.updated_at, rd.created_at), ('/admin/resources/' || rd.id::text || '?type=draft')::text, 4,
           jsonb_strip_nulls(jsonb_build_object('status', rd.status::text, 'type', nullif(btrim(rd.type), ''),
             'language', nullif(btrim(rd.language), ''))),
           'content'::text, '{}'::jsonb
      from public.resource_drafts rd
      left join public.profiles a on a.user_id = rd.created_by
     where rd.status::text in ('submitted', 'review_1', 'review_2')

    union all

    -- 8-9. Old sponsorship and exposition requests, priority 4.
    select 'sponsorship'::text, sr.id, coalesce(nullif(btrim(o.name), ''), 'Unknown company')::text,
           nullif(initcap(replace(btrim(coalesce(sr.requested_tier, '')), '_', ' ')), '')::text,
           sr.created_at,
           case when sr.status = 'paid' then coalesce(sr.payment_confirmed_at, sr.updated_at, sr.created_at) else sr.created_at end,
           ('/admin/sponsorship-requests/' || sr.id::text)::text, 4,
           jsonb_strip_nulls(jsonb_build_object('status', sr.status, 'current_tier', sr.current_tier, 'requested_tier', sr.requested_tier)),
           'content'::text, '{}'::jsonb
      from public.sponsorship_requests sr
      left join public.organizations o on o.id = sr.organization_id
     where p_admin and sr.status in ('pending', 'paid')
    union all
    select 'exposition'::text, x.id, coalesce(nullif(btrim(o.name), ''), 'Unknown company')::text,
           nullif(btrim(ev.title), '')::text, x.created_at,
           case when x.status = 'paid' then coalesce(x.payment_confirmed_at, x.created_at) else x.created_at end,
           ('/admin/expositions/' || x.id::text)::text, 4,
           jsonb_strip_nulls(jsonb_build_object('status', x.status, 'event_title', nullif(btrim(ev.title), ''))),
           'content'::text, '{}'::jsonb
      from public.exposition_requests x
      left join public.organizations o on o.id = x.organization_id
      left join public.events ev on ev.id = x.event_id
     where p_admin and x.status in ('pending', 'paid')

    union all

    -- 10-11 (v2). Claims (M3 decides, admin_decide_claim) and join requests (the owner
    -- decides; FYI here), people tab.
    select case when i.status = 'claim_requested' then 'claim' else 'join_request' end::text, i.id,
           coalesce(nullif(btrim(concat_ws(' ', btrim(cu.first_name), btrim(cu.last_name))), ''), nullif(btrim(i.email), ''), 'Unknown person')::text,
           (case when i.status = 'claim_requested' then 'Claims ' else 'Asks to join ' end || coalesce(nullif(btrim(o.name), ''), 'a company'))::text,
           i.created_at, i.created_at, ('/admin/organizations/' || o.id::text)::text,
           case when i.status = 'claim_requested' then 3 else 5 end,
           jsonb_strip_nulls(jsonb_build_object(
             'invitation_id', i.id, 'organization_id', o.id, 'org_name', nullif(btrim(o.name), ''), 'org_type', o.organization_type,
             'org_status', o.access_status, 'org_country', coalesce(nullif(btrim(o.country), ''), nullif(btrim(o.headquarters_country), '')),
             'org_website', nullif(btrim(o.website), ''), 'org_listed', o.archived_at is null and o.duplicate_of is null,
             'org_has_owner', o.owner_user_id is not null
                              or exists (select 1 from public.organization_members m where m.organization_id = o.id and m.role = 'owner'),
             'owner_name', nullif(btrim(concat_ws(' ', btrim(ow.first_name), btrim(ow.last_name))), ''),
             'decided_by', case when i.status = 'claim_requested' then 'm3' else 'owner' end,
             'code_matched', case when i.status = 'claim_requested' then i.code_matched end,
             'expired', i.expires_at < now(), 'user_id', cu.uid, 'email', lower(btrim(i.email)),
             'person_status', cu.status, 'job_title', nullif(btrim(cu.job_title), ''),
             'other_claims', case when i.status = 'claim_requested'
                                  then (select count(*) from public.organization_invitations i2
                                         where i2.organization_id = i.organization_id and i2.status = 'claim_requested' and i2.id <> i.id) end)),
           'people'::text,
           jsonb_strip_nulls(jsonb_build_object(
             'email_proven', cu.proven, 'existing_account', cu.uid is not null, 'linkedin', cu.linkedin,
             'domain_match', case when public.is_public_email_domain(split_part(lower(btrim(i.email)), '@', 2)) then null
                                  else coalesce(public.review_domain_match(split_part(lower(btrim(i.email)), '@', 2), public.review_url_host(o.website)),
                                                public.review_domain_match(split_part(lower(btrim(i.email)), '@', 2), o.primary_domain)) end,
             'sm26', exists (select 1 from public.sm_registration r where r.organization_id = o.id and r.status = 'confirmed')))
      from public.organization_invitations i
      join public.organizations o on o.id = i.organization_id
      left join public.profiles ow on ow.user_id = o.owner_user_id
      left join lateral (
        select u.id as uid, pr.first_name, pr.last_name, pr.job_title, pr.access_status::text as status,
               (pr.email_proven_at is not null and lower(btrim(pr.email)) = lower(btrim(u.email))) as proven,
               nullif(btrim(pr.linkedin_url), '') is not null as linkedin
          from auth.users u left join public.profiles pr on pr.user_id = u.id
         where lower(btrim(u.email)) = lower(btrim(i.email)) order by u.created_at limit 1
      ) cu on true
     where p_v2 and p_admin and i.status in ('claim_requested', 'join_requested')
       and not (i.status = 'join_requested'
                and exists (select 1 from dismissed x where x.subject_type = 'join' and x.subject_id = i.id))

    union all

    -- 12 (v2). Team joins: a collaborator who joined through an invitation or an owner-approved
    -- join request (no M3 review: the decided exception); FYI, revocable.
    select 'team_join'::text, m.id,
           coalesce(nullif(btrim(concat_ws(' ', btrim(pr.first_name), btrim(pr.last_name))), ''), nullif(btrim(u.email), ''), 'Unnamed account')::text,
           ('Joined ' || coalesce(nullif(btrim(o.name), ''), 'a company'))::text,
           m.joined_at, m.joined_at, ('/admin/organizations/' || o.id::text)::text, 5,
           jsonb_strip_nulls(jsonb_build_object(
             'member_id', m.id, 'organization_id', o.id, 'org_name', nullif(btrim(o.name), ''), 'org_status', o.access_status,
             'role', m.role, 'user_id', m.user_id, 'email', lower(btrim(u.email)), 'person_status', pr.access_status::text,
             'via', case when inv.invited_by_user_id is not null then 'invitation' else 'join_request' end,
             'invited_by', nullif(btrim(concat_ws(' ', btrim(ib.first_name), btrim(ib.last_name))), ''), 'invitation_id', inv.id)),
           'team_joins'::text,
           jsonb_strip_nulls(jsonb_build_object(
             'email_proven', pr.email_proven_at is not null and lower(btrim(pr.email)) = lower(btrim(u.email)),
             'domain_match', case when public.is_public_email_domain(split_part(lower(btrim(u.email)), '@', 2)) then null
                                  else coalesce(public.review_domain_match(split_part(lower(btrim(u.email)), '@', 2), public.review_url_host(o.website)),
                                                public.review_domain_match(split_part(lower(btrim(u.email)), '@', 2), o.primary_domain)) end))
      from public.organization_members m
      join public.organizations o on o.id = m.organization_id
      join public.profiles pr on pr.user_id = m.user_id
      join auth.users u on u.id = m.user_id
      join lateral (
        select i.id, i.invited_by_user_id from public.organization_invitations i
         where i.organization_id = m.organization_id and lower(btrim(i.email)) = lower(btrim(u.email)) and i.status = 'accepted'
           and not exists (select 1 from public.review_log l where l.subject_type = 'claim' and l.subject_id = i.id)
         order by i.updated_at desc limit 1
      ) inv on true
      left join public.profiles ib on ib.user_id = inv.invited_by_user_id
     where p_v2 and p_admin and m.role = 'collaborator' and m.joined_at >= c_since
       and pr.persona::text not in ('admin', 'moderator')
       and not exists (select 1 from dismissed x where x.subject_type = 'join' and x.subject_id = m.id)

    union all

    -- 13 (v2). Possible duplicate companies (same normalised name, or similarity >= 0.75).
    select 'duplicate_org'::text, md5(a.id::text || b.id::text)::uuid,
           (coalesce(nullif(btrim(a.name), ''), '?') || ' / ' || coalesce(nullif(btrim(b.name), ''), '?'))::text,
           'Possible duplicate companies'::text,
           greatest(a.created_at, b.created_at), greatest(a.created_at, b.created_at),
           ('/admin/organizations/' || (case when a.created_at >= b.created_at then a.id else b.id end)::text)::text, 6,
           jsonb_build_object('a_id', a.id, 'a_name', a.name, 'a_status', a.access_status, 'a_created_at', a.created_at,
             'a_members', coalesce((select os.members from org_size os where os.organization_id = a.id), 0),
             'a_sm26', exists (select 1 from public.sm_registration r where r.organization_id = a.id),
             'b_id', b.id, 'b_name', b.name, 'b_status', b.access_status, 'b_created_at', b.created_at,
             'b_members', coalesce((select os.members from org_size os where os.organization_id = b.id), 0),
             'b_sm26', exists (select 1 from public.sm_registration r where r.organization_id = b.id)),
           'duplicates'::text,
           jsonb_build_object('duplicate', jsonb_build_object('kind', 'company', 'score', round(extensions.similarity(a.n, b.n)::numeric, 2)))
      from listed a
      join listed b on a.id < b.id and (a.n = b.n or (a.n operator(extensions.%) b.n and extensions.similarity(a.n, b.n) >= 0.75))
     where p_v2 and p_admin
       and not exists (select 1 from dismissed x where x.subject_type = 'merge' and x.action = 'not_duplicate'
                          and x.subject_id = a.id and x.details ->> 'other_id' = b.id::text)

    union all

    -- 14 (v2). Possible duplicate accounts (same first and last name).
    select 'duplicate_person'::text, md5(a.user_id::text || b.user_id::text)::uuid,
           coalesce(nullif(btrim(concat_ws(' ', btrim(a.first_name), btrim(a.last_name))), ''), '?')::text,
           'Possible duplicate accounts'::text,
           greatest(a.created_at, b.created_at), greatest(a.created_at, b.created_at),
           ('/admin/users/' || (case when a.created_at >= b.created_at then a.user_id else b.user_id end)::text)::text, 6,
           jsonb_build_object('a_id', a.user_id, 'a_email', ua.email, 'a_status', a.access_status::text, 'a_created_at', a.created_at,
                              'b_id', b.user_id, 'b_email', ub.email, 'b_status', b.access_status::text, 'b_created_at', b.created_at),
           'duplicates'::text,
           jsonb_build_object('duplicate', jsonb_build_object('kind', 'person', 'score', 0.9))
      from public.profiles a
      join public.profiles b on a.user_id < b.user_id
                            and public.review_name_key(a.first_name, a.last_name) = public.review_name_key(b.first_name, b.last_name)
      left join auth.users ua on ua.id = a.user_id
      left join auth.users ub on ub.id = b.user_id
     where p_v2 and p_admin and length(coalesce(public.review_name_key(a.first_name, a.last_name), '')) >= 4
       and a.persona::text not in ('admin', 'moderator') and b.persona::text not in ('admin', 'moderator')
       and not exists (select 1 from dismissed x where x.subject_type = 'merge' and x.action = 'not_duplicate'
                          and x.subject_id = a.user_id and x.details ->> 'other_id' = b.user_id::text)

    union all

    -- 15 (v2). Retro-review (Q6, spec §12): verified before Phase 3 without an M3 review:
    -- team invitation, claimed company, company auto-verified at creation, SM26 delegation.
    -- Listed once: gone after any M3 decision on the person (admin_validate_person) or "keep".
    select 'retro'::text, p.user_id,
           coalesce(nullif(btrim(concat_ws(' ', btrim(p.first_name), btrim(p.last_name))), ''), nullif(btrim(u.email), ''), 'Unnamed account')::text,
           nullif(concat_ws(' @ ', nullif(btrim(p.job_title), ''), nullif(btrim(o.name), '')), '')::text,
           p.created_at, p.created_at, ('/admin/users/' || p.user_id::text)::text, 6,
           jsonb_strip_nulls(jsonb_build_object('reasons', to_jsonb(rs.reasons), 'email', lower(btrim(u.email)), 'persona', p.persona::text,
             'company_id', o.id, 'company_name', nullif(btrim(o.name), ''), 'company_status', o.access_status,
             'company_type', o.organization_type, 'company_role', mo.role)),
           'retro'::text,
           jsonb_strip_nulls(jsonb_build_object(
             'email_proven', p.email_proven_at is not null and lower(btrim(p.email)) = lower(btrim(u.email)),
             'domain_match', case when public.is_public_email_domain(split_part(lower(btrim(u.email)), '@', 2)) then null
                                  else public.review_domain_match(split_part(lower(btrim(u.email)), '@', 2), public.review_url_host(o.website)) end,
             'sm26', exists (select 1 from public.sm_attendee a join public.sm_registration r on r.id = a.registration_id
                              where r.status = 'confirmed' and a.attending and a.user_id = p.user_id)))
      from public.profiles p
      left join auth.users u on u.id = p.user_id
      left join member_org mo on mo.user_id = p.user_id
      left join public.organizations o on o.id = mo.organization_id
      cross join lateral (
        select array_remove(array[
          case when exists (select 1 from public.organization_members m
                              join public.organization_invitations i on i.organization_id = m.organization_id
                               and lower(btrim(i.email)) = lower(btrim(u.email)) and i.status = 'accepted'
                             where m.user_id = p.user_id and m.role = 'collaborator' and m.joined_at < c_since) then 'team_invite' end,
          case when exists (select 1 from public.organization_members m join public.organizations o2 on o2.id = m.organization_id
                             where m.user_id = p.user_id and m.role = 'owner' and m.joined_at < c_since
                               and o2.created_by_user_id is distinct from p.user_id) then 'claimed_company' end,
          case when exists (select 1 from public.organization_members m
                              join public.organization_audit_log al on al.organization_id = m.organization_id
                               and al.event_type = 'organization_auto_verified'
                             where m.user_id = p.user_id) then 'auto_verified_company' end,
          case when coalesce(u.raw_user_meta_data ? 'pw_pending', false)
                and exists (select 1 from public.sm_attendee a join public.sm_registration r on r.id = a.registration_id
                             where a.user_id = p.user_id and r.status = 'confirmed' and not a.is_primary
                               and r.user_id is distinct from p.user_id) then 'sm26_delegation' end], null) as reasons
      ) rs
     where p_v2 and p_admin and p.access_status::text = 'verified' and p.persona::text not in ('admin', 'moderator')
       and cardinality(rs.reasons) > 0
       and not exists (select 1 from dismissed x where x.subject_type = 'person' and x.subject_id = p.user_id
                          and x.action in ('retro_kept', 'validated', 'validated_participant', 'rejected'))
  )
  select q.kind, q.id, q.title, q.subtitle, q.created_at, q.waiting_since, q.url, q.priority, q.facts, q.tab, q.signals
    from q;
end
$function$;

create or replace function public.admin_review_queue(p_filter jsonb default null)
returns table (kind text, id uuid, title text, subtitle text, created_at timestamptz, waiting_since timestamptz,
               url text, priority integer, facts jsonb, tab text, signals jsonb)
language plpgsql
stable
security definer
set search_path to ''
as $function$
#variable_conflict use_column
declare
  v_tab text;
  v_event uuid;
begin
  if not coalesce(public.is_moderator(), false) then
    raise exception 'admin_review_queue: M3 staff only' using errcode = '42501';
  end if;
  if p_filter is not null then
    if jsonb_typeof(p_filter) <> 'object' then
      raise exception using errcode = '22023', message = 'bad_filter';
    end if;
    v_tab := nullif(p_filter ->> 'tab', '');
    if v_tab is not null and v_tab not in ('people', 'registrations', 'team_joins', 'duplicates', 'retro', 'content') then
      raise exception using errcode = '22023', message = 'bad_tab';
    end if;
    if nullif(p_filter ->> 'event_id', '') is not null then
      if (p_filter ->> 'event_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception using errcode = '22023', message = 'bad_filter';
      end if;
      v_event := (p_filter ->> 'event_id')::uuid;
    end if;
  end if;
  return query
    select r.kind, r.id, r.title, r.subtitle, r.created_at, r.waiting_since, r.url, r.priority, r.facts, r.tab,
           coalesce(r.signals, '{}'::jsonb)
             || jsonb_build_object('age_days', round((extract(epoch from (now() - r.waiting_since)) / 86400)::numeric, 1))
      from public.review_queue_rows(coalesce(public.is_admin(), false), p_filter is not null) r
     where (v_tab is null or r.tab = v_tab)
       and (v_event is null or (r.kind = 'event_request' and r.facts ->> 'event_id' = v_event::text))
     order by r.priority, r.waiting_since asc nulls last, r.kind, r.id;
end
$function$;

create or replace function public.admin_review_queue_count()
returns integer
language sql
stable
security invoker
set search_path to ''
as $function$
  select count(*)::integer from public.admin_review_queue(null::jsonb);
$function$;

-- Counts per tab of the v2 queue (+ the oldest waiting item per tab). Staff, or the
-- service role (registration-cron's 08:00 digest).
create or replace function public.admin_review_queue_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_admin boolean;
  v_res jsonb;
begin
  if coalesce(auth.role(), '') = 'service_role' then
    v_admin := true;
  elsif coalesce(public.is_moderator(), false) then
    v_admin := coalesce(public.is_admin(), false);
  else
    raise exception 'admin_review_queue_counts: M3 staff only' using errcode = '42501';
  end if;
  select jsonb_build_object(
           'total', count(*),
           'people', count(*) filter (where r.tab = 'people'),
           'registrations', count(*) filter (where r.tab = 'registrations'),
           'team_joins', count(*) filter (where r.tab = 'team_joins'),
           'duplicates', count(*) filter (where r.tab = 'duplicates'),
           'retro', count(*) filter (where r.tab = 'retro'),
           'content', count(*) filter (where r.tab = 'content'),
           'oldest', jsonb_strip_nulls(jsonb_build_object(
             'people', min(r.waiting_since) filter (where r.tab = 'people'),
             'registrations', min(r.waiting_since) filter (where r.tab = 'registrations'),
             'team_joins', min(r.waiting_since) filter (where r.tab = 'team_joins'),
             'duplicates', min(r.waiting_since) filter (where r.tab = 'duplicates'),
             'retro', min(r.waiting_since) filter (where r.tab = 'retro'),
             'content', min(r.waiting_since) filter (where r.tab = 'content'))))
    into v_res
    from public.review_queue_rows(v_admin, true) r;
  return v_res;
end
$function$;

revoke all on function public.review_queue_rows(boolean, boolean) from public, anon, authenticated, service_role;
revoke all on function public.admin_review_queue(jsonb) from public, anon;
revoke all on function public.admin_review_queue_count() from public, anon;
revoke all on function public.admin_review_queue_counts() from public, anon;
grant execute on function public.admin_review_queue(jsonb) to authenticated;
grant execute on function public.admin_review_queue_count() to authenticated;
grant execute on function public.admin_review_queue_counts() to authenticated, service_role;

comment on function public.admin_review_queue(jsonb) is 'M3 review queue. p_filter null: the v1 rows (kind, id, title, subtitle, created_at, waiting_since, url, priority, facts) plus tab and signals; p_filter {tab?, event_id?}: the v2 queue (claims, join requests, team joins, duplicates, retro-review, legacy drafts). Verified staff only (42501); moderators get the content tab only. Migration 20261016091000 (v1: 20261009230000).';
comment on function public.admin_review_queue_count() is 'Number of rows public.admin_review_queue(null) returns for the caller (the v1 badge). Migration 20261016091000.';
comment on function public.admin_review_queue_counts() is 'Counts per tab of the v2 queue and the oldest waiting item per tab. Verified staff (moderators: content only) or the service role. Migration 20261016091000.';
