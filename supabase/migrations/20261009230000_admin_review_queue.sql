-- M3 review queue: ONE list of everything waiting for the M3 team (/admin/review).
-- 9 Oct 2026. Spec: regspec-en.md §8.1 (review queue) and §4.6 (admin_review_queue).
--
-- NOT APPLIED. Written on branch rf-queue. Down script:
-- supabase/migrations/down/20261009230000_admin_review_queue.down.sql. Dry run:
-- supabase/dryrun/20261009230000_admin_review_queue.dryrun.sql.
-- Order: apply it before (or with) the front end that calls it. A front end
-- without the migration shows "The review list is not available yet" and no
-- sidebar badge; nothing breaks.
--
-- ════════════════════════════════════════════════════════════════════════════
-- What it adds (two read-only functions, nothing else)
-- ════════════════════════════════════════════════════════════════════════════
--   public.admin_review_queue()
--     SECURITY DEFINER, STABLE, search_path ''. Staff only: raises 42501 unless
--     public.is_moderator() (a verified admin or moderator). Returns one row per
--     item waiting for M3:
--       kind           person | company | event_request | report | need |
--                      webinar | resource_draft | sponsorship | exposition
--       id             the item's own id (profiles.user_id for a person)
--       title          who or what ("Jane Doe", the company, the RFP title)
--       subtitle       one line of context ("Sales Manager @ NewCo"), may be null
--       created_at     when the row was created
--       waiting_since  when it started waiting for M3 (created_at, except a
--                      legacy request that was paid: its payment date; an
--                      article draft: its last update)
--       url            the existing admin screen that decides it
--       priority       1 reported conversation, 2 event invitation request,
--                      3 person or company waiting for access, 4 content
--                      (needs, webinar proposals, article drafts, old queues)
--       facts          jsonb of key facts for the 10-second card (see below)
--     Rows come sorted: priority, then the one waiting LONGEST first (oldest
--     waiting_since first), so a forgotten item is never last in its group.
--     Verified admins see every kind. A verified moderator (not admin) sees the
--     kinds a moderator may handle: webinar proposals, article drafts (every
--     other screen is behind AdminOnlyGuard) and reported conversations
--     (conversation_reports RLS: is_moderator() reads and closes them; the page
--     closes a report with that same update, no screen needed).
--
--   Later versions: the spec plans admin_review_queue(filter jsonb). A later
--   migration MUST drop public.admin_review_queue() and
--   public.admin_review_queue_count() before adding an overload with a DEFAULT,
--   or supabase.rpc('admin_review_queue') becomes ambiguous in PostgREST
--   (PGRST203) and the page, the badge and the dashboard card go blank.
--
--   public.admin_review_queue_count()
--     SECURITY INVOKER, STABLE: count(*) of the above for the caller (the
--     sidebar badge "To review" and the dashboard card). Same 42501 for
--     non-staff (it calls the function above).
--
--   EXECUTE: revoked from PUBLIC and anon, granted to authenticated.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Sources (read-only; production values checked 9 Oct 2026)
-- ════════════════════════════════════════════════════════════════════════════
--   person         profiles.access_status = 'pending' and onboarding_status
--                  <> 'draft' (a draft is still filling in the form; 10 rows).
--                  Company = their organization_members row (owner first).
--                  Facts: e-mail, its domain, public e-mail provider
--                  (is_public_email_domain), persona, job title, company id /
--                  name / status / type / country / website / role / members,
--                  e-mail domain = website host (null when unknown or public),
--                  registered for Smart Marina 2026 (sm_attendee, READ ONLY:
--                  same user_id or same e-mail).
--   company        organizations.access_status = 'pending', except (a) a
--                  company already shown on a waiting person's card (that
--                  person's company, owner first: AdminUserDetail's Approve
--                  verifies both) and (b) a company whose people are all still
--                  drafts (not waiting for M3 yet). A pending company is never
--                  hidden only because some other member is pending. 1 row
--                  today: its only person was not accepted.
--   event_request  gl_guest.status = 'requested' (requests and plus-ones; 3
--                  wys26 rows), read like /admin/guest-list/<slug> reads them.
--                  Canary and hidden events are left out (slug 'canary-%',
--                  gl_event.hidden when that column exists). Facts include the
--                  engine (gl_event.engine when it exists, else
--                  'guest_list_v1'): the page offers the quick Approve / Refuse
--                  of the guest-list edge function only for guest_list_v1.
--   report         conversation_reports.status = 'open', only if that table
--                  exists (it ships with the messaging lane, migration
--                  20261009190000). Read through EXECUTE so this function is
--                  valid without it; if its columns differ, the reports are
--                  skipped with a WARNING and the rest of the queue still loads.
--                  Facts carry the reason and the excerpt (the last messages
--                  at the time of the report: the only way M3 reads a
--                  conversation). url = /admin/partner-requests, where the
--                  messaging lane's "Reported conversations" panel lists them;
--                  the queue card itself closes a report (status 'closed'
--                  through the table's staff RLS, exactly like that panel).
--   need           rfps and consultations in submitted / under_review;
--                  marina_projects in new / submitted / under_review (new
--                  projects are inserted as 'new'). 0 rows today.
--   webinar        webinar_requests in submitted / under_review. 0 rows today.
--   resource_draft resource_drafts in submitted / review_1 / review_2 (the
--                  "Pending Drafts" of /admin/resources). 0 rows today.
--   sponsorship    legacy sponsorship_requests in pending / paid. 0 rows.
--   exposition     legacy exposition_requests in pending / paid. 0 rows.
--   Not included: reference bypass requests (the table was dropped by
--   drop_reference_bypass_schema), company claim requests (no table or status
--   yet: organization_invitations allows pending / accepted / expired /
--   cancelled / join_requested, and join_requested is decided by the company
--   owner, approve_join_request), legacy event_registrations pending_approval
--   (none; the old flow is retired).
--
-- ════════════════════════════════════════════════════════════════════════════
-- Safety
-- ════════════════════════════════════════════════════════════════════════════
--   Additive: two new functions. No table, column, policy, trigger or grant on
--   an existing object changes. The old live client (main) never calls them.
--   Read only: no INSERT / UPDATE / DELETE anywhere; no sm_* row is written
--   (sm_attendee is only read); gl_guest tokens are not read or returned.
--   Personal data (names, e-mails) goes to verified staff only, as the admin
--   screens already show it (profiles_select_auth, gl_guest_staff: is_moderator).
--   Called from the SQL editor or with the service key (no JWT sub), it raises
--   42501 like for any non-staff caller.

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
      when undefined_table or undefined_column or undefined_function or datatype_mismatch then
        raise warning 'admin_review_queue: reported conversations skipped (% %)', sqlstate, sqlerrm;
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
           ('/admin/guest-list/' || e.slug)::text as url,
           2 as priority,
           jsonb_strip_nulls(jsonb_build_object(
             'event_id', e.id,
             'event_slug', e.slug,
             'event_title', e.title,
             'engine', coalesce(to_jsonb(e) ->> 'engine', 'guest_list_v1'),
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
      left join public.gl_guest h on h.id = g.plus_one_of
      left join seats s on s.event_id = e.id
     where v_admin
       and g.status = 'requested'
       and e.slug not like 'canary-%'
       and not coalesce((to_jsonb(e) ->> 'hidden')::boolean, false)

    union all

    -- 3. People waiting for access (form sent, not a draft), priority 3.
    select 'person'::text,
           p.user_id,
           coalesce(nullif(btrim(concat_ws(' ', btrim(p.first_name), btrim(p.last_name))), ''),
                    nullif(btrim(p.email), ''), 'Unnamed account')::text,
           nullif(concat_ws(' @ ', nullif(btrim(p.job_title), ''), nullif(btrim(o.name), '')), '')::text,
           p.created_at,
           p.created_at,
           ('/admin/users/' || p.user_id::text)::text,
           3,
           jsonb_strip_nulls(jsonb_build_object(
             'email', nullif(btrim(p.email), ''),
             'email_domain', nullif(d.edomain, ''),
             'public_email', case when d.edomain <> '' then public.is_public_email_domain(d.edomain) end,
             'persona', p.persona::text,
             'job_title', nullif(btrim(p.job_title), ''),
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
             'sm26', exists (select 1 from public.sm_attendee a
                              where a.user_id = p.user_id
                                 or (p.email is not null and lower(a.email) = lower(btrim(p.email))))))
      from public.profiles p
      left join member_org mo on mo.user_id = p.user_id
      left join public.organizations o on o.id = mo.organization_id
      left join org_size os on os.organization_id = o.id
      cross join lateral (
        select lower(split_part(coalesce(btrim(p.email), ''), '@', 2)) as edomain,
               lower(regexp_replace(regexp_replace(btrim(coalesce(o.website, '')), '^[a-z][a-z0-9+.-]*://', '', 'i'),
                                    '^www\.|[/:?#].*$', '', 'g')) as whost
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
           '/admin/resources?tab=drafts'::text,
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
  'M3 review queue (/admin/review): one row per item waiting for M3 staff (kind, id, title, subtitle, created_at, waiting_since, url, priority 1-4, facts), most urgent first, then longest waiting first. Read only. Verified staff only (42501 otherwise); moderators get reported conversations, webinar proposals and article drafts only. conversation_reports is read only if it exists. A later overload must DROP this signature first (PostgREST ambiguity). Migration 20261009230000.';

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
