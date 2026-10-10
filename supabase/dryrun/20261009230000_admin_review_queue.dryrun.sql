-- DRY RUN of supabase/migrations/20261009230000_admin_review_queue.sql.
-- NOT A MIGRATION: never apply it, never commit it to the database.
--
-- Run it as ONE query text (one implicit transaction). The last statement ends
-- with RAISE EXCEPTION 'DRYRUN ...': the report is the error message, and
-- everything (the two functions, the test UPDATEs of two profiles, the test
-- webinar proposal and article draft, the stand-in tables) rolls back.
-- Tripwire: if the report starts with "FAIL before-snapshot missing", the
-- statements did NOT run in one transaction and the migration may have been
-- committed: check pg_proc for admin_review_queue at once.
--
-- Expected report: every line PASS, except INFO lines. T12 and T13 only run
-- while public.conversation_reports does NOT exist (the messaging lane's
-- migration 20261009190000 not applied yet): they create a stand-in table and
-- undo it at once. If it exists, they print INFO, and T6 and T11 compare the
-- real open-report count instead. T4b prints INFO instead of PASS when no
-- waiting (or no draft) profile exists to try.
-- T11, T12, T13, T15, T16 and T17 undo their own writes at once (inner block
-- that raises 'dryrun-undo'); everything else goes with the final RAISE. T14
-- checks that nothing they wrote is left and that both functions are back
-- after T17 ran the down script.
--
-- Real ids, looked up read-only on 9 Oct 2026:
--   verified admin (is_moderator(), is_admin()): 9e51b498-d4d9-4a66-91f5-0c4e66185179
--     (T16 marks it 'suspended' for one inner block, then undoes it.)
--   verified marina member, not staff:           0f8c900e-5e63-404c-96ca-58a0718541a8
--     (T11, T12 and T15 turn this profile into a verified moderator for one
--      inner block, then undo it: there is no moderator account in production.
--      T15 also writes one webinar proposal and one article draft in its name,
--      undone with it. Those two tables have UPDATE triggers only; profiles has
--      no trigger with an outside effect.)
--   T4b looks up one waiting profile and one draft profile at run time (no id
--   written here) and only reads as them.
-- Production on 9 Oct 2026 (read-only): 10 people waiting (pending, not draft;
-- 2 of them confirmed for Smart Marina 2026), 8 drafts, 1 pending company that
-- no person card shows (its only person was not accepted), 3 wys26 requests,
-- 0 RFPs / consultations / marina projects / webinar proposals / article
-- drafts / old sponsorship and exposition requests. T6 recomputes these live.

-- ────────────────────────────────────────────────────────────────────────────
-- 0. Before the migration: tripwire and whether the functions already exist.
-- ────────────────────────────────────────────────────────────────────────────
do $before$
begin
  perform set_config('smc_dryrun.before', 'ok', true);
  perform set_config('smc_dryrun.existed',
    case when to_regprocedure('public.admin_review_queue()') is null
          and to_regprocedure('public.admin_review_queue_count()') is null then 'no' else 'yes' end, true);
end
$before$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. The migration, verbatim.
-- ────────────────────────────────────────────────────────────────────────────
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
--                  <> 'draft' (10 rows today; the 8 drafts are still filling
--                  in the form). Company = their organization_members row
--                  (owner first).
--                  E-mail = the login address (auth.users.email), never
--                  profiles.email alone: any member can PATCH profiles.email on
--                  their own row and Confirm email is OFF, so no address here is
--                  proven. 'email_proven' appears only once the registration
--                  lane adds profiles.email_proven_at (proven = stamp set AND
--                  profiles.email = auth.users.email); the page shows the
--                  domain match as a neutral hint until it is true.
--                  Facts: e-mail, its domain, public e-mail provider
--                  (is_public_email_domain), persona, job title, the person's
--                  own country and "LinkedIn given" (profiles.country /
--                  linkedin_url, read through to_jsonb: they arrive with the
--                  registration lane), company id / name / status / type /
--                  country / website / role / members, e-mail domain = website
--                  host (null when unknown or public), confirmed for Smart
--                  Marina 2026 (sm_attendee + sm_registration, READ ONLY: an
--                  attending attendee of a confirmed registration, linked by
--                  user_id; by e-mail only when that address is proven).
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
--                  of the guest-list edge function only for guest_list_v1, and
--                  only guest_list_v1 rows link to /admin/guest-list/<slug>. A
--                  core_v2 row (registration lane) links to its event,
--                  /admin/events/<legacy_event_id> (else /admin/events): the
--                  guest list's own Approve e-mails the gl_guest.token QR, which
--                  a core_v2 door (checkin_token) refuses.
--   report         conversation_reports.status = 'open', only if that table
--                  exists (it ships with the messaging lane, migration
--                  20261009190000). Read through EXECUTE so this function is
--                  valid without it; if its columns differ, ONE stand-in row
--                  (id 00000000-..., facts {"unreadable": true}) says the
--                  reports could not be listed, with a WARNING in the logs, and
--                  the rest of the queue still loads.
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
--                  "Pending Drafts" of /admin/resources), linked to the draft's
--                  own screen /admin/resources/<id>?type=draft. 0 rows today.
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
--   (sm_attendee and sm_registration are only read); gl_guest tokens are not
--   read or returned; auth.users is read for the login e-mail only.
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

-- ────────────────────────────────────────────────────────────────────────────
-- 2. The checks. Every one in its own BEGIN ... EXCEPTION block (a failing one
--    is reported, its role and claims roll back, the next one runs).
-- ────────────────────────────────────────────────────────────────────────────
do $dryrun$
declare
  nl constant text := chr(10);
  r text := '';
  v text;
  w text;
  n bigint;
  m bigint;
  k bigint;
  v_rows jsonb := '[]'::jsonb;
  v_expected text;
  v_got text;
  v_exp_mod bigint;
  v_open_reports bigint := 0;
  v_pr uuid;
  v_wr uuid;
  v_rd uuid;
  v_all bigint;
  v_mod_reports bigint;
  v_mod_total bigint;
  v_excerpt text;
  v_caller uuid;
  v_label text;
  v_reports_table constant boolean := to_regclass('public.conversation_reports') is not null;
  c_admin constant uuid := '9e51b498-d4d9-4a66-91f5-0c4e66185179';
  c_member constant uuid := '0f8c900e-5e63-404c-96ca-58a0718541a8';
  c_kinds constant text[] := array['company', 'event_request', 'exposition', 'need', 'person', 'report',
                                   'resource_draft', 'sponsorship', 'webinar'];
  c_mod_kinds constant text[] := array['report', 'resource_draft', 'webinar'];
begin
  -- T0 tripwire: block 0 ran in this same transaction.
  r := r || nl || case when current_setting('smc_dryrun.before', true) = 'ok'
                       then 'PASS before-snapshot present (one transaction)'
                       else 'FAIL before-snapshot missing: NOT one transaction, the migration may be COMMITTED' end;
  r := r || nl || 'INFO functions existed before this run: ' || coalesce(current_setting('smc_dryrun.existed', true), '?');
  r := r || nl || 'INFO public.conversation_reports exists: ' || v_reports_table::text;

  -- T1 shapes: the queue is SECURITY DEFINER plpgsql, STABLE, with the same empty search_path as
  --    is_moderator(); the count is SECURITY INVOKER sql, STABLE, same search_path.
  begin
    select format('secdef=%s volatile=%s lang=%s config_like_is_moderator=%s', p.prosecdef, p.provolatile, l.lanname,
                  p.proconfig = (select q.proconfig from pg_proc q where q.oid = 'public.is_moderator()'::regprocedure))
      into v from pg_proc p join pg_language l on l.oid = p.prolang
     where p.oid = 'public.admin_review_queue()'::regprocedure;
    r := r || nl || case when v = 'secdef=t volatile=s lang=plpgsql config_like_is_moderator=t' then 'PASS ' else 'FAIL ' end
              || 'admin_review_queue shape: ' || coalesce(v, '(missing)');
    select format('secdef=%s volatile=%s lang=%s config_like_is_moderator=%s', p.prosecdef, p.provolatile, l.lanname,
                  p.proconfig = (select q.proconfig from pg_proc q where q.oid = 'public.is_moderator()'::regprocedure))
      into v from pg_proc p join pg_language l on l.oid = p.prolang
     where p.oid = 'public.admin_review_queue_count()'::regprocedure;
    r := r || nl || case when v = 'secdef=f volatile=s lang=sql config_like_is_moderator=t' then 'PASS ' else 'FAIL ' end
              || 'admin_review_queue_count shape: ' || coalesce(v, '(missing)');
    -- One signature each: an overload would make supabase.rpc() ambiguous (PGRST203).
    select count(*) into n from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname in ('admin_review_queue', 'admin_review_queue_count');
    r := r || nl || case when n = 2 then 'PASS ' else 'FAIL ' end || 'one signature per function (no overload): ' || n || ' found';
  exception when others then
    r := r || nl || 'FAIL shapes: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T2 EXECUTE: not PUBLIC, not anon; authenticated yes.
  begin
    select format('public=%s anon=%s authenticated=%s',
                  exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                           where p.oid = 'public.admin_review_queue()'::regprocedure and a.grantee = 0),
                  has_function_privilege('anon', 'public.admin_review_queue()', 'execute'),
                  has_function_privilege('authenticated', 'public.admin_review_queue()', 'execute'))
      into v;
    r := r || nl || case when v = 'public=f anon=f authenticated=t' then 'PASS ' else 'FAIL ' end
              || 'EXECUTE admin_review_queue(): ' || v;
    select format('public=%s anon=%s authenticated=%s',
                  exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                           where p.oid = 'public.admin_review_queue_count()'::regprocedure and a.grantee = 0),
                  has_function_privilege('anon', 'public.admin_review_queue_count()', 'execute'),
                  has_function_privilege('authenticated', 'public.admin_review_queue_count()', 'execute'))
      into v;
    r := r || nl || case when v = 'public=f anon=f authenticated=t' then 'PASS ' else 'FAIL ' end
              || 'EXECUTE admin_review_queue_count(): ' || v;
  exception when others then
    r := r || nl || 'FAIL EXECUTE privileges: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T3 deny: anon (no EXECUTE).
  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    set local role anon;
    perform count(*) from public.admin_review_queue();
    reset role;
    r := r || nl || 'FAIL anon could call admin_review_queue()';
  exception when others then
    r := r || nl || case when sqlstate = '42501' then 'PASS ' else 'FAIL ' end
              || 'anon refused admin_review_queue() (' || sqlstate || ': ' || sqlerrm || ')';
  end;
  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    set local role anon;
    perform public.admin_review_queue_count();
    reset role;
    r := r || nl || 'FAIL anon could call admin_review_queue_count()';
  exception when others then
    r := r || nl || case when sqlstate = '42501' then 'PASS ' else 'FAIL ' end
              || 'anon refused admin_review_queue_count() (' || sqlstate || ': ' || sqlerrm || ')';
  end;

  -- T4 deny: a verified member who is not staff (both functions).
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', c_member, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform count(*) from public.admin_review_queue();
    reset role;
    r := r || nl || 'FAIL a member (not staff) could read the queue';
  exception when others then
    r := r || nl || case when sqlstate = '42501' and sqlerrm like '%M3 staff only%' then 'PASS ' else 'FAIL ' end
              || 'member refused admin_review_queue() (' || sqlstate || ': ' || sqlerrm || ')';
  end;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', c_member, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.admin_review_queue_count();
    reset role;
    r := r || nl || 'FAIL a member (not staff) could read the count';
  exception when others then
    r := r || nl || case when sqlstate = '42501' then 'PASS ' else 'FAIL ' end
              || 'member refused admin_review_queue_count() (' || sqlstate || ': ' || sqlerrm || ')';
  end;

  -- T4b deny: a person still waiting for M3, and one still filling in the form (a draft). Both looked
  --     up now (not staff); both functions must refuse them with 42501.
  foreach v_label in array array['waiting', 'draft'] loop
    v_caller := null;
    select p.user_id into v_caller
      from public.profiles p
     where p.access_status::text = 'pending'
       and p.persona::text not in ('admin', 'moderator')
       and (case when v_label = 'draft' then p.onboarding_status::text = 'draft'
                 else p.onboarding_status::text <> 'draft' end)
     order by p.created_at
     limit 1;
    if v_caller is null then
      r := r || nl || 'INFO no ' || v_label || ' profile to try (T4b skipped for it)';
      continue;
    end if;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_caller, 'role', 'authenticated')::text, true);
      set local role authenticated;
      perform count(*) from public.admin_review_queue();
      reset role;
      r := r || nl || 'FAIL a ' || v_label || ' profile could read the queue';
    exception when others then
      r := r || nl || case when sqlstate = '42501' then 'PASS ' else 'FAIL ' end
                || v_label || ' profile refused admin_review_queue() (' || sqlstate || ')';
    end;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_caller, 'role', 'authenticated')::text, true);
      set local role authenticated;
      perform public.admin_review_queue_count();
      reset role;
      r := r || nl || 'FAIL a ' || v_label || ' profile could read the count';
    exception when others then
      r := r || nl || case when sqlstate = '42501' then 'PASS ' else 'FAIL ' end
                || v_label || ' profile refused admin_review_queue_count() (' || sqlstate || ')';
    end;
  end loop;

  -- T5 deny: authenticated with no sub, and a session with no JWT at all (SQL editor, service key).
  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
    set local role authenticated;
    perform count(*) from public.admin_review_queue();
    reset role;
    r := r || nl || 'FAIL authenticated without sub could read the queue';
  exception when others then
    r := r || nl || case when sqlstate = '42501' then 'PASS ' else 'FAIL ' end
              || 'authenticated without sub refused (' || sqlstate || ')';
  end;
  begin
    perform set_config('request.jwt.claims', '', true);
    perform count(*) from public.admin_review_queue();
    r := r || nl || 'FAIL a session with no JWT (' || current_user || ') could read the queue';
  exception when others then
    r := r || nl || case when sqlstate = '42501' then 'PASS ' else 'FAIL ' end
              || 'no-JWT session (' || current_user || ') refused (' || sqlstate || ')';
  end;

  -- Expected rows per kind, computed as the migration role (all rows visible). The company rule is the
  -- migration's: pending, not on a waiting person's card (that person's company, owner first), and not
  -- a company whose people are all still drafts.
  begin
    if v_reports_table then
      execute 'select count(*) from public.conversation_reports where status = ''open''' into v_open_reports;
    end if;
    v_expected := format(
      'company=%s event_request=%s exposition=%s need=%s person=%s report=%s resource_draft=%s sponsorship=%s webinar=%s',
      (select count(*) from public.organizations o
        where o.access_status = 'pending'
          and not exists (select 1
                            from (select distinct on (m.user_id) m.user_id, m.organization_id
                                    from public.organization_members m
                                   order by m.user_id, (m.role = 'owner') desc, m.joined_at asc nulls last, m.organization_id) mo
                            join public.profiles p on p.user_id = mo.user_id
                           where mo.organization_id = o.id
                             and p.access_status::text = 'pending' and p.onboarding_status::text <> 'draft')
          and not (exists (select 1 from public.organization_members m where m.organization_id = o.id)
                   and not exists (select 1 from public.organization_members m
                                     left join public.profiles p on p.user_id = m.user_id
                                    where m.organization_id = o.id
                                      and not (coalesce(p.access_status::text, '') = 'pending'
                                               and coalesce(p.onboarding_status::text, '') = 'draft')))),
      (select count(*) from public.gl_guest g join public.gl_event e on e.id = g.event_id
        where g.status = 'requested' and e.slug not like 'canary-%'
          and not coalesce((to_jsonb(e) ->> 'hidden')::boolean, false)),
      (select count(*) from public.exposition_requests where status in ('pending', 'paid')),
      (select count(*) from public.rfps where status in ('submitted', 'under_review'))
        + (select count(*) from public.consultations where status in ('submitted', 'under_review'))
        + (select count(*) from public.marina_projects where status in ('new', 'submitted', 'under_review')),
      (select count(*) from public.profiles where access_status::text = 'pending' and onboarding_status::text <> 'draft'),
      v_open_reports,
      (select count(*) from public.resource_drafts where status::text in ('submitted', 'review_1', 'review_2')),
      (select count(*) from public.sponsorship_requests where status in ('pending', 'paid')),
      (select count(*) from public.webinar_requests where status::text in ('submitted', 'under_review')));
    -- A moderator: reported conversations, webinar proposals and article drafts.
    v_exp_mod := v_open_reports
               + (select count(*) from public.webinar_requests where status::text in ('submitted', 'under_review'))
               + (select count(*) from public.resource_drafts where status::text in ('submitted', 'review_1', 'review_2'));
    r := r || nl || 'INFO expected per kind: ' || v_expected || ' (moderator: ' || v_exp_mod || ')';
  exception when others then
    r := r || nl || 'FAIL expected counts: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T6 allow: the verified admin reads the queue; rows per kind = the expected counts. The rows are kept
  --    (as jsonb, in the order returned) for T7-T10, which run as the migration role.
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', c_admin, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) into v_rows from public.admin_review_queue() q;
    select public.admin_review_queue_count() into n;
    reset role;
    select string_agg(format('%s=%s', kk.kind_name,
                             (select count(*) from jsonb_array_elements(v_rows) e where e ->> 'kind' = kk.kind_name)), ' ' order by kk.pos)
      into v_got from unnest(c_kinds) with ordinality as kk(kind_name, pos);
    r := r || nl || case when v_got = v_expected then 'PASS ' else 'FAIL ' end || 'admin rows per kind: ' || coalesce(v_got, '(null)');
    m := (select count(*) from jsonb_array_elements(v_rows) e where not (e ->> 'kind' = any (c_kinds)));
    r := r || nl || case when m = 0 then 'PASS ' else 'FAIL ' end || 'no unknown kind: ' || m;
    -- T9 the count function = the number of rows.
    r := r || nl || case when n = jsonb_array_length(v_rows) then 'PASS ' else 'FAIL ' end
              || format('admin_review_queue_count() = %s, rows = %s', n, jsonb_array_length(v_rows));
  exception when others then
    r := r || nl || 'FAIL admin read: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T7 order: priority ascending, then the one waiting longest first (oldest waiting_since first).
  begin
    with x as (
      select e.ord, (e.val ->> 'priority')::int as p, (e.val ->> 'waiting_since')::timestamptz as ws
        from jsonb_array_elements(v_rows) with ordinality as e(val, ord)
    )
    select count(*) into n from x a join x b on b.ord = a.ord + 1
     where b.p < a.p or (b.p = a.p and b.ws < a.ws);
    r := r || nl || case when n = 0 then 'PASS ' else 'FAIL ' end
              || 'rows sorted by priority, then waiting longest first: ' || n || ' pair(s) out of order';
  exception when others then
    r := r || nl || 'FAIL order: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T8 every row is complete, links to an admin screen and has its kind's priority. Dates may be null
  --    only where the source column allows it (marina_projects, the two old request tables).
  begin
    select count(*) into n from jsonb_array_elements(v_rows) e
     where coalesce(e ->> 'id', '') = '' or coalesce(e ->> 'title', '') = '' or coalesce(e ->> 'url', '') not like '/admin/%'
        or ((e ->> 'created_at' is null or e ->> 'waiting_since' is null)
            and not (e ->> 'kind' in ('sponsorship', 'exposition')
                     or (e ->> 'kind' = 'need' and e ->> 'url' like '/admin/projects/%')))
        or jsonb_typeof(e -> 'facts') <> 'object'
        or (e ->> 'priority')::int <> case e ->> 'kind' when 'report' then 1 when 'event_request' then 2
                                                        when 'person' then 3 when 'company' then 3 else 4 end;
    r := r || nl || case when n = 0 then 'PASS ' else 'FAIL ' end || 'rows complete (id, title, /admin url, dates, facts, priority): ' || n || ' bad';
  exception when others then
    r := r || nl || 'FAIL row shape: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T10 content: people are pending non-draft profiles linked to their own user page; a person's company
  --     is one of their memberships; event requests link to their guest list and carry their engine; no
  --     gl_guest token appears anywhere in the output; a company row is never on a person card nor a
  --     company of drafts only; and no pending company is lost (each one is a company row, on a person
  --     card, or a company of drafts only).
  begin
    select count(*) into n from jsonb_array_elements(v_rows) e
     where e ->> 'kind' = 'person'
       and (e ->> 'url' <> '/admin/users/' || (e ->> 'id')
            or not exists (select 1 from public.profiles p where p.user_id = (e ->> 'id')::uuid
                              and p.access_status::text = 'pending' and p.onboarding_status::text <> 'draft')
            or (e -> 'facts' ? 'company_id'
                and not exists (select 1 from public.organization_members m
                                 where m.user_id = (e ->> 'id')::uuid
                                   and m.organization_id = (e -> 'facts' ->> 'company_id')::uuid)));
    r := r || nl || case when n = 0 then 'PASS ' else 'FAIL ' end || 'person rows match profiles and memberships: ' || n || ' bad';

    -- The person's e-mail is the login address (auth.users.email), never a profiles.email that differs.
    select count(*) into n from jsonb_array_elements(v_rows) e
      join auth.users u on u.id = (e ->> 'id')::uuid
     where e ->> 'kind' = 'person'
       and nullif(btrim(u.email), '') is not null
       and coalesce(e -> 'facts' ->> 'email', '') <> btrim(u.email);
    r := r || nl || case when n = 0 then 'PASS ' else 'FAIL ' end || 'person e-mail = login e-mail (auth.users): ' || n || ' bad';

    -- "Confirmed for Smart Marina 2026" = an attending attendee of a confirmed registration linked to
    -- the account (no proven address exists yet, so no e-mail match).
    select count(*) filter (where x.flag is distinct from x.expected), count(*) filter (where x.flag)
      into n, m
      from (select (e -> 'facts' ->> 'sm26')::boolean as flag,
                   exists (select 1 from public.sm_attendee a
                             join public.sm_registration sr on sr.id = a.registration_id
                            where sr.status = 'confirmed' and a.attending and a.user_id = (e ->> 'id')::uuid) as expected
              from jsonb_array_elements(v_rows) e
             where e ->> 'kind' = 'person') x;
    r := r || nl || case when n = 0 or exists (select 1 from information_schema.columns
                                                 where table_schema = 'public' and table_name = 'profiles'
                                                   and column_name = 'email_proven_at')
                         then 'PASS ' else 'FAIL ' end
              || format('Smart Marina 2026 flag = confirmed, attending, same account: %s bad, %s flagged', n, m);

    select count(*) into n from jsonb_array_elements(v_rows) e
     where e ->> 'kind' = 'event_request'
       and (e ->> 'url' <> case when e -> 'facts' ->> 'engine' = 'guest_list_v1'
                                then '/admin/guest-list/' || (e -> 'facts' ->> 'event_slug')
                                else coalesce((select '/admin/events/' || ge.legacy_event_id::text
                                                 from public.gl_event ge
                                                where ge.id = (e -> 'facts' ->> 'event_id')::uuid
                                                  and ge.legacy_event_id is not null), '/admin/events') end
            or coalesce(e -> 'facts' ->> 'engine', '') = ''
            or not exists (select 1 from public.gl_guest g where g.id = (e ->> 'id')::uuid and g.status = 'requested'));
    select count(*) into m from jsonb_array_elements(v_rows) e
     where e ->> 'kind' = 'event_request' and e -> 'facts' ->> 'event_slug' = 'wys26'
       and e -> 'facts' ->> 'engine' = 'guest_list_v1';
    r := r || nl || case when n = 0 then 'PASS ' else 'FAIL ' end
              || format('event request rows match gl_guest (%s bad); wys26 rows on guest_list_v1: %s', n, m);

    select count(*) into n from public.gl_guest g where strpos(v_rows::text, g.token::text) > 0;
    r := r || nl || case when n = 0 then 'PASS ' else 'FAIL ' end || 'no gl_guest token in the output: ' || n || ' found';

    select count(*) into n from jsonb_array_elements(v_rows) e
     where e ->> 'kind' = 'company'
       and (exists (select 1 from jsonb_array_elements(v_rows) p
                     where p ->> 'kind' = 'person' and p -> 'facts' ->> 'company_id' = e ->> 'id')
            or not exists (select 1 from public.organizations o where o.id = (e ->> 'id')::uuid and o.access_status = 'pending')
            or (exists (select 1 from public.organization_members mm where mm.organization_id = (e ->> 'id')::uuid)
                and not exists (select 1 from public.organization_members mm
                                  left join public.profiles p on p.user_id = mm.user_id
                                 where mm.organization_id = (e ->> 'id')::uuid
                                   and not (coalesce(p.access_status::text, '') = 'pending'
                                            and coalesce(p.onboarding_status::text, '') = 'draft'))));
    r := r || nl || case when n = 0 then 'PASS ' else 'FAIL ' end
              || 'company rows are pending, not on a person card, not drafts only: ' || n || ' bad';

    select count(*) into n from public.organizations o
     where o.access_status = 'pending'
       and not exists (select 1 from jsonb_array_elements(v_rows) e where e ->> 'kind' = 'company' and e ->> 'id' = o.id::text)
       and not exists (select 1 from jsonb_array_elements(v_rows) e where e ->> 'kind' = 'person' and e -> 'facts' ->> 'company_id' = o.id::text)
       and not (exists (select 1 from public.organization_members mm where mm.organization_id = o.id)
                and not exists (select 1 from public.organization_members mm
                                  left join public.profiles p on p.user_id = mm.user_id
                                 where mm.organization_id = o.id
                                   and not (coalesce(p.access_status::text, '') = 'pending'
                                            and coalesce(p.onboarding_status::text, '') = 'draft')));
    r := r || nl || case when n = 0 then 'PASS ' else 'FAIL ' end
              || 'no pending company lost (company row, person card or drafts only): ' || n || ' lost';
  exception when others then
    r := r || nl || 'FAIL content checks: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T11 a verified moderator (not admin) sees only reported conversations, webinar proposals and article
  --     drafts. There is no moderator in production: the member profile becomes one for this inner block
  --     (as the migration role, no JWT: the staff guard trusts it), then everything is undone ('dryrun-undo').
  begin
    v := null; n := null; m := null; k := null;
    begin
      perform set_config('request.jwt.claims', '', true);
      update public.profiles set persona = 'moderator' where user_id = c_member and access_status::text = 'verified';
      get diagnostics k = row_count;
      perform set_config('request.jwt.claims', json_build_object('sub', c_member, 'role', 'authenticated')::text, true);
      set local role authenticated;
      select coalesce(string_agg(distinct q.kind, ',' order by q.kind), ''), count(*) into v, n from public.admin_review_queue() q;
      select public.admin_review_queue_count() into m;
      reset role;
      raise exception 'dryrun-undo';
    exception when raise_exception then
      if sqlerrm <> 'dryrun-undo' then raise; end if;
    end;
    r := r || nl || case when k = 1 and n = v_exp_mod and m = n
                               and coalesce(string_to_array(nullif(v, ''), ','), '{}'::text[]) <@ c_mod_kinds
                         then 'PASS ' else 'FAIL ' end
              || format('moderator (undone): %s row(s) of kinds [%s], count() %s, expected %s', n, v, m, v_exp_mod);
  exception when others then
    r := r || nl || 'FAIL moderator view: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T12 reported conversations: with a stand-in public.conversation_reports (the messaging lane's columns),
  --     one open report comes first, priority 1, linked to the reports page, with its excerpt; a closed one
  --     is left out; a moderator sees it too. Undone at once. Skipped when the real table exists (T6 and
  --     T11 counted its open reports).
  if v_reports_table then
    r := r || nl || 'INFO stand-in report checks skipped: public.conversation_reports exists (see T6 and T11)';
  else
    begin
      v := null; w := null; n := null; m := null; k := null;
      v_excerpt := null; v_mod_reports := null; v_mod_total := null;
      begin
        create table public.conversation_reports (
          id uuid primary key default gen_random_uuid(),
          partner_request_id uuid,
          message_id uuid,
          reporter_user_id uuid,
          reporter_org_id uuid,
          reason text not null,
          excerpt text,
          status text not null default 'open',
          staff_note text,
          handled_by uuid,
          handled_at timestamptz,
          created_at timestamptz not null default now());
        v_pr := coalesce((select pr.id from public.partner_requests pr order by pr.created_at limit 1), gen_random_uuid());
        insert into public.conversation_reports (partner_request_id, reporter_user_id, reason, excerpt)
        values (v_pr, c_member, 'Dry run: unwanted messages', 'Dry run: the last messages');
        insert into public.conversation_reports (partner_request_id, reporter_user_id, reason, status)
        values (v_pr, c_member, 'Dry run: closed report', 'closed');
        -- the admin
        perform set_config('request.jwt.claims', json_build_object('sub', c_admin, 'role', 'authenticated')::text, true);
        set local role authenticated;
        select count(*) filter (where q.kind = 'report'), min(q.url) filter (where q.kind = 'report'),
               min(q.facts ->> 'excerpt') filter (where q.kind = 'report'), count(*)
          into n, v, v_excerpt, k from public.admin_review_queue() q;
        select format('%s/%s', q.kind, q.priority) into w from public.admin_review_queue() q limit 1;
        select public.admin_review_queue_count() into m;
        reset role;
        -- a moderator (the member, for this block only)
        perform set_config('request.jwt.claims', '', true);
        update public.profiles set persona = 'moderator' where user_id = c_member and access_status::text = 'verified';
        perform set_config('request.jwt.claims', json_build_object('sub', c_member, 'role', 'authenticated')::text, true);
        set local role authenticated;
        select count(*) filter (where q.kind = 'report'), count(*) into v_mod_reports, v_mod_total from public.admin_review_queue() q;
        reset role;
        raise exception 'dryrun-undo';
      exception when raise_exception then
        if sqlerrm <> 'dryrun-undo' then raise; end if;
      end;
      r := r || nl || case when n = 1 and v = '/admin/partner-requests' and w = 'report/1'
                                 and v_excerpt = 'Dry run: the last messages'
                                 and k = jsonb_array_length(v_rows) + 1 and m = k
                           then 'PASS ' else 'FAIL ' end
                || format('stand-in reports, admin (undone): %s open report row(s), first row %s, url %s, excerpt %s, rows %s (+1 expected), count() %s',
                          n, w, v, v_excerpt is not null, k, m);
      r := r || nl || case when v_mod_reports = 1 and v_mod_total = v_exp_mod + 1 then 'PASS ' else 'FAIL ' end
                || format('stand-in reports, moderator (undone): %s report row(s), %s row(s) in all (%s expected)',
                          v_mod_reports, v_mod_total, v_exp_mod + 1);
    exception when others then
      r := r || nl || 'FAIL stand-in reports: ' || sqlstate || ' ' || sqlerrm;
    end;

    -- T13 a conversation_reports table with other columns does not break the queue: ONE stand-in row
    --     (zero id, priority 1, facts.unreadable) says the reports could not be listed (and a WARNING),
    --     and every other row still comes back. Undone at once.
    begin
      n := null; m := null; v := null; k := null;
      begin
        create table public.conversation_reports (id uuid primary key default gen_random_uuid(), status text);
        insert into public.conversation_reports (status) values ('open');
        perform set_config('request.jwt.claims', json_build_object('sub', c_admin, 'role', 'authenticated')::text, true);
        set local role authenticated;
        select count(*), count(*) filter (where q.kind = 'report'),
               min(format('%s/%s/%s/%s', q.id, q.priority, q.url, q.facts ->> 'unreadable')) filter (where q.kind = 'report')
          into n, m, v from public.admin_review_queue() q;
        select public.admin_review_queue_count() into k;
        reset role;
        raise exception 'dryrun-undo';
      exception when raise_exception then
        if sqlerrm <> 'dryrun-undo' then raise; end if;
      end;
      r := r || nl || case when n = jsonb_array_length(v_rows) + 1 and m = 1 and k = n
                                 and v = '00000000-0000-0000-0000-000000000000/1//admin/partner-requests/true'
                           then 'PASS ' else 'FAIL ' end
                || format('mismatched conversation_reports flagged (undone): %s rows (%s expected), %s report row [%s], count() %s',
                          n, jsonb_array_length(v_rows) + 1, m, v, k);
    exception when others then
      r := r || nl || 'FAIL mismatched conversation_reports: ' || sqlstate || ' ' || sqlerrm;
    end;
  end if;

  -- T15 the moderator kinds on real rows (production has none): one webinar proposal and one article draft
  --     written in the member's name, as the migration role. A moderator gets exactly these two (priority
  --     4, their own screens) on top of the rest of their list; the admin gets them on top of everything.
  --     Undone at once.
  begin
    v := null; n := null; m := null; k := null; v_all := null; v_wr := null; v_rd := null;
    begin
      perform set_config('request.jwt.claims', '', true);
      update public.profiles set persona = 'moderator' where user_id = c_member and access_status::text = 'verified';
      insert into public.webinar_requests (user_id, title, description, status)
      values (c_member, 'Dry run webinar proposal', 'Dry run: never kept', 'submitted')
      returning id into v_wr;
      insert into public.resource_drafts (created_by, title, content, status)
      values (c_member, 'Dry run article draft', 'Dry run: never kept', 'submitted')
      returning id into v_rd;
      -- the moderator
      perform set_config('request.jwt.claims', json_build_object('sub', c_member, 'role', 'authenticated')::text, true);
      set local role authenticated;
      select coalesce(string_agg(format('%s/%s/%s', q.kind, q.priority, q.url), ',' order by q.kind), ''), count(*)
        into v, n from public.admin_review_queue() q where q.id in (v_wr, v_rd);
      select count(*) into m from public.admin_review_queue() q;
      reset role;
      -- the admin
      perform set_config('request.jwt.claims', json_build_object('sub', c_admin, 'role', 'authenticated')::text, true);
      set local role authenticated;
      select count(*) filter (where q.id in (v_wr, v_rd)), count(*) into k, v_all from public.admin_review_queue() q;
      reset role;
      raise exception 'dryrun-undo';
    exception when raise_exception then
      if sqlerrm <> 'dryrun-undo' then raise; end if;
    end;
    r := r || nl || case when n = 2
                               and v = format('resource_draft/4/%s,webinar/4/%s',
                                              '/admin/resources/' || v_rd::text || '?type=draft', '/admin/webinars/' || v_wr::text)
                               and m = v_exp_mod + 2
                         then 'PASS ' else 'FAIL ' end
              || format('moderator sees a webinar proposal and an article draft (undone): %s row(s) [%s], %s in all (%s expected)',
                        n, v, m, v_exp_mod + 2);
    r := r || nl || case when k = 2 and v_all = jsonb_array_length(v_rows) + 2 then 'PASS ' else 'FAIL ' end
              || format('admin sees them too (undone): %s of 2, %s rows in all (%s expected)', k, v_all, jsonb_array_length(v_rows) + 2);
  exception when others then
    r := r || nl || 'FAIL moderator kinds on real rows: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T16 deny: a staff account that is no longer verified (the admin, suspended for this inner block).
  begin
    v := null; k := null;
    begin
      perform set_config('request.jwt.claims', '', true);
      update public.profiles set access_status = 'suspended' where user_id = c_admin and access_status::text = 'verified';
      get diagnostics k = row_count;
      perform set_config('request.jwt.claims', json_build_object('sub', c_admin, 'role', 'authenticated')::text, true);
      set local role authenticated;
      begin
        perform count(*) from public.admin_review_queue();
        v := 'allowed';
      exception when others then
        v := sqlstate;
      end;
      reset role;
      raise exception 'dryrun-undo';
    exception when raise_exception then
      if sqlerrm <> 'dryrun-undo' then raise; end if;
    end;
    r := r || nl || case when k = 1 and v = '42501' then 'PASS ' else 'FAIL ' end
              || format('suspended admin refused (undone): %s profile(s) suspended, result %s', k, v);
  exception when others then
    r := r || nl || 'FAIL suspended admin: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T17 the down script (supabase/migrations/down/20261009230000_admin_review_queue.down.sql, its two
  --     statements verbatim) removes both functions. Undone at once.
  begin
    v := null;
    begin
      perform set_config('request.jwt.claims', '', true);
      drop function if exists public.admin_review_queue_count();
      drop function if exists public.admin_review_queue();
      select format('queue_gone=%s count_gone=%s',
                    to_regprocedure('public.admin_review_queue()') is null,
                    to_regprocedure('public.admin_review_queue_count()') is null)
        into v;
      raise exception 'dryrun-undo';
    exception when raise_exception then
      if sqlerrm <> 'dryrun-undo' then raise; end if;
    end;
    r := r || nl || case when v = 'queue_gone=t count_gone=t' then 'PASS ' else 'FAIL ' end
              || 'down script drops both functions (undone): ' || coalesce(v, '(null)');
  exception when others then
    r := r || nl || 'FAIL down script: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T14 nothing else: no conversation_reports stand-in survived, both profiles are unchanged, no
  --     dry-run webinar proposal or article draft is left, and both functions are back after T17.
  begin
    select format('functions=%s reports_table=%s member_persona=%s admin=%s/%s dryrun_webinars=%s dryrun_drafts=%s',
                  to_regprocedure('public.admin_review_queue()') is not null
                    and to_regprocedure('public.admin_review_queue_count()') is not null,
                  to_regclass('public.conversation_reports') is not null,
                  (select p.persona::text from public.profiles p where p.user_id = c_member),
                  (select p.persona::text from public.profiles p where p.user_id = c_admin),
                  (select p.access_status::text from public.profiles p where p.user_id = c_admin),
                  (select count(*) from public.webinar_requests w2 where w2.user_id = c_member and w2.title = 'Dry run webinar proposal'),
                  (select count(*) from public.resource_drafts d2 where d2.created_by = c_member and d2.title = 'Dry run article draft'))
      into v;
    r := r || nl || case when v = format('functions=t reports_table=%s member_persona=marina admin=admin/verified dryrun_webinars=0 dryrun_drafts=0',
                                         v_reports_table)
                         then 'PASS ' else 'FAIL ' end
              || 'inner blocks undone: ' || v;
  exception when others then
    r := r || nl || 'FAIL undo check: ' || sqlstate || ' ' || sqlerrm;
  end;

  raise exception 'DRYRUN %', coalesce(r, '(report lost: a NULL was concatenated)');
end
$dryrun$;
