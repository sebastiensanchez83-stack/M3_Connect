-- Event registrations: other people's rows become private, member sign-up
-- respects "published" and "invitation only", the anonymous guest insert only
-- accepts a plain free guest row, and the webinar join link gets a
-- registrant-only reader.
-- Audit items S5 + S18 (Phase 0, security). Track "event-registrations".
--
-- ════════════════════════════════════════════════════════════════════════════
-- Why (state of production on 7 Oct 2026, re-verified before writing)
-- ════════════════════════════════════════════════════════════════════════════
-- * S5. Policy "Authenticated users can see event participants" (FOR SELECT,
--   role public, USING auth.uid() IS NOT NULL AND the event exists) lets ANY
--   signed-in account, pending or not, read EVERY row of event_registrations
--   with every column: guest_email, guest_first_name, guest_last_name,
--   guest_company of no-account webinar guests, plus other members'
--   payment_status, amount_due(_cents), invoice_reference, organization_id.
--       GET /rest/v1/event_registrations?select=*
--   Latent today (1 row, 0 guests) but the pre-WYS webinars will fill it.
-- * S18. Policy event_reg_insert checks verified + onboarding completed +
--   can_access_resource(access_level), but neither events.published nor
--   events.invitation_only. A verified member can register by REST to the WYS
--   2026 row of public.events (access_level public, published false,
--   invitation_only true), outside its guest list. 0 such rows today.
-- * S18 (anon path). Policy "Anonymous guests can register for public
--   webinars" (FOR INSERT to anon) only checks user_id IS NULL, guest_email IS
--   NOT NULL and a public/published/non-invitation webinar. Every other column
--   is free, and the app has not used this path since 9 Apr 2026 (commit
--   f7818473: LightweightWebinarSignup -> guest-webinar-register, which inserts
--   with service_role after its rate limits and e-mail check). By REST, anon can
--       POST /rest/v1/event_registrations
--   with any registration_type, payment_status 'paid', another company's
--   organization_id (eats its sponsor seats in the counter), registered_by,
--   invoice_reference, amounts, a back-dated created_at, and HTML in
--   guest_first_name, which guest-webinar-reminders v7 prints raw ("Hello
--   ${firstName}") in an e-mail from noreply@smartmarinaconnect.com. Such a row
--   is also attached to whoever later signs up with that e-mail
--   (link_guest_registrations_on_profile_insert), forged columns included.
-- * S5 (link). events.meeting_url is readable by anon and by every signed-in
--   account (table-level SELECT + events_anon_public / events_select_by_access_level),
--   so registering protects nothing: the join link of every webinar is public.
-- * Found while checking the invitation path: the registration_type CHECK does
--   not allow 'invitation_request', which is the value EventRegistrationFlow
--   inserts for "Request an invitation" (and that AccountPage / i18n label as
--   "Invitation request"). That button has always failed with 23514. Without
--   this value there would be no way for a non-sponsor member to ask for an
--   invitation once invitation_only is enforced.
--
-- ════════════════════════════════════════════════════════════════════════════
-- What this migration changes (parts 1, 2, 2b, 3, 4)
-- ════════════════════════════════════════════════════════════════════════════
-- PART 1. SELECT on event_registrations.
--   DROP the policy "Authenticated users can see event participants".
--   What remains: event_reg_select (own rows, all columns; or is_moderator()),
--   "Moderators can manage registrations" (ALL, is_moderator()). So each user
--   still reads their own rows in full, staff keep full access, nobody else
--   reads any row. anon never had a SELECT policy and still has none.
--   What the browser used the broad policy for is now served by two
--   SECURITY DEFINER functions (authenticated only, anon revoked):
--     get_event_registration_counts(p_event_id uuid, p_organization_id uuid default null)
--       returns table(total integer, organization_total integer)
--       total = every row of the event (members + guests), as before.
--       organization_total = rows of that organisation, only when the caller is
--       a member of it (is_org_member) or staff; NULL otherwise or when no
--       organisation is passed. Feeds the sponsor seat counter.
--       Event must be visible to the caller: staff, or can_access_resource()
--       and published (no row otherwise; the page shows 0).
--     get_event_participants(p_event_id uuid)
--       returns table(user_id, first_name, last_name, avatar_url, job_title,
--                     org_name, org_logo_url)
--       Member registrants only (user_id not null): never a guest_* value,
--       never a payment column. Same people the event page could show before:
--       the page joined profiles!inner, and profiles RLS only lets a user read
--       their own profile, staff read all, and co-members of an organisation
--       read each other (profiles_select_auth / profiles_select_org_comembers).
--       The function applies exactly that rule, so who-sees-whom is unchanged.
--       An invitation request still waiting for staff is not listed. org_name is
--       the organisation the person registered under when they still belong to
--       it, else their earliest membership (before: an arbitrary membership).
--
-- PART 2. INSERT on event_registrations (event_reg_insert, same name/role).
--   Unchanged: is_moderator() may insert anything; a member inserts only their
--   own row (user_id = auth.uid()), verified + onboarding completed, on an event
--   can_access_resource() lets them see.
--   Added for non-staff:
--     * the event is published (coalesce(published, true), as the anon guest
--       policy already does);
--     * on an invitation_only event the row must be either
--         - an invitation request: registration_type 'invitation_request' AND
--           payment_status 'pending_approval' (staff approve it from the
--           event's admin sheet, which moves payment_status on), or
--         - a sponsor seat: registration_type 'sponsor_included' for an
--           organisation the caller belongs to whose tier is a sponsor tier
--           (SPONSOR_TIERS in src/types/database.ts). This is the
--           "sponsors can still auto-register" branch of EventRegistrationFlow.
--     * payment_status is 'free' or 'pending_approval' (the only two values any
--       non-staff caller sends; 'paid', 'invoice_sent'... are staff/IPN only);
--     * organization_id is NULL or an organisation the caller belongs to (stops
--       anyone eating another company's sponsor seats).
--   The RESTRICTIVE policy block_generic_reg_on_sm_event (SM26) is untouched.
--
-- PART 2b. INSERT by anon ("Anonymous guests can register for public webinars",
--   same name, same role anon, same event condition). The row must now have
--   exactly the shape guest-webinar-register writes: registration_type 'guest',
--   payment_status 'free', no organization_id / registered_by /
--   reminder_sent_at / invoice_reference / amount_due_cents, amount_due 0,
--   created_at = now (+-5 min), plus the function's e-mail format check, length
--   caps (e-mail 254, names 100, company 200) and no '<' or '>' in the name
--   and company fields. guest-webinar-register uses service_role and does not go
--   through this policy, so the guest flow is unchanged; the old direct insert
--   of LightweightWebinarSignup (before 9 Apr 2026) sent exactly this shape.
--   What it does NOT close: anon can still add plain guest rows for arbitrary
--   e-mail addresses without the function's rate limits (each gets one reminder
--   e-mail 24 h before the webinar). Only dropping the policy closes that; see
--   the OPTION line under PART 2b (lead's call, the brief asked to keep it).
--
-- PART 3. registration_type CHECK gains 'invitation_request' (additive; the 6
--   existing values are kept; no row is rewritten).
--
-- PART 4. Webinar join link: get_my_event_access(p_event_ids uuid[] default null)
--       returns table(event_id uuid, is_registered boolean, meeting_url text)
--   authenticated only. A row per event where the caller has a confirmed
--   registration (or, when p_event_ids is given, also every listed event for
--   staff). is_registered = the caller has a row for the event, by user_id, or
--   a guest row whose guest_email is the caller's CONFIRMED auth e-mail (the
--   "registered as a guest with my e-mail" case the event page and the
--   dashboard already handled), excluding an invitation request still pending.
--   meeting_url is returned only to such a registrant, or to staff. A
--   registrant must also pass can_access_resource() on the event (same as the
--   events RLS the link was read through before).
--   p_event_ids NULL = every event the caller is registered for (dashboard).
--
--   NOT done here: hiding the column itself. A column-level REVOKE on
--   events.meeting_url makes every select('*') / select=* on events fail with
--   42501 for that role, and four screens outside this track still read it
--   that way (see PHASE B at the bottom). Until PHASE B is applied, the link
--   is still readable by REST; the new client in this track already reads it
--   only through get_my_event_access.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Callers checked (src/ + supabase/functions/ + DB functions/views, 7 Oct)
-- ════════════════════════════════════════════════════════════════════════════
--   event_registrations SELECT
--     EventRegistrationFlow.tsx  own row (user_id) -> unchanged; the 2 count
--                                queries -> get_event_registration_counts (this track)
--     EventDetailPage.tsx        count + participants -> RPCs; "am I registered"
--                                -> get_my_event_access (this track)
--     DashboardPage.tsx          own + guest-email rows -> get_my_event_access (this track)
--     EventsPage.tsx:170, AccountPage.tsx:490, HomePage.tsx:224
--                                own rows by user_id -> unchanged (event_reg_select)
--     AdminDashboard / AdminEvents / AdminEventDetail
--                                staff -> unchanged ("Moderators can manage registrations")
--     guest-webinar-register, guest-webinar-reminders, payment-ipn
--                                service_role -> RLS bypassed, unchanged
--     link_guest_registrations_on_profile_insert (trigger, SECURITY DEFINER) -> unchanged
--     No view reads event_registrations.
--   event_registrations INSERT
--     EventRegistrationFlow.tsx  visitor/member_discount/sponsor_included:
--                                free|pending_approval, own org -> allowed;
--                                invitation_request now always pending_approval
--                                (client changed in this track) -> allowed
--     EventsPage.tsx:225         {event_id, user_id}, defaults free, never on an
--                                invitation_only event (routes to the event page)
--                                -> allowed when published
--     AdminExpositionDetail.tsx:93 staff, 'paid' -> is_moderator() branch
--     guest-webinar-register     service_role -> unchanged
--     anon (REST, policy "Anonymous guests can register for public webinars")
--                                no caller in src/ or supabase/functions/ since
--                                f7818473 (9 Apr 2026); the old direct insert sent
--                                guest/free/no org -> still allowed by PART 2b
--     SM26 / WYS: SM26 registers in sm_registration (and is blocked here by
--     block_generic_reg_on_sm_event); WYS 2026 runs on gl_* (guest-list
--     function, /wys26) and never writes event_registrations. The WYS row of
--     public.events (unpublished, invitation_only) simply stops accepting
--     member self-registrations, which is the S18 fix.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Deploy order
-- ════════════════════════════════════════════════════════════════════════════
--   1. Apply this migration.
--   2. Deploy the frontend of this track (EventRegistrationFlow, EventDetailPage,
--      DashboardPage), which calls the three functions.
--   Between 1 and 2 the OLD frontend still works but shows degraded numbers:
--   counts read from the table only see the caller's own row (0 or 1), the
--   participant list shows only the caller, sponsor seat counters read 0 or 1.
--   Nothing errors. Do not deploy the frontend first: its RPC calls would fail
--   (counts 0, nobody "registered", no join link) until the migration lands.
--   3. Later, PHASE B (bottom of this file) once the four screens are changed.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Verify after applying (read-only)
-- ════════════════════════════════════════════════════════════════════════════
--   select policyname from pg_policies where schemaname = 'public'
--      and tablename = 'event_registrations' order by 1;
--     -> no "Authenticated users can see event participants"
--   select with_check from pg_policies where schemaname = 'public'
--      and tablename = 'event_registrations'
--      and policyname = 'Anonymous guests can register for public webinars';
--     -> contains registration_type = 'guest' and organization_id IS NULL
--   On /events/0cda049e-fb8c-47d7-8337-1d387f62dd82 logged out: the guest
--   webinar form still registers (it calls guest-webinar-register).
--   select has_function_privilege('anon', 'public.get_my_event_access(uuid[])', 'execute');        -- false
--   select has_function_privilege('authenticated', 'public.get_my_event_access(uuid[])', 'execute'); -- true
--   In the app, signed in as a NON-staff verified member:
--     /events/0cda049e-fb8c-47d7-8337-1d387f62dd82 (GCC webinar, 1 registrant)
--       -> "1 registered" still shows; the registrant still sees "You're
--          registered" and the "Join the webinar" button; a co-member of the
--          registrant still sees them in Participants.
--     REST as that member: GET /rest/v1/event_registrations?select=* -> only own rows.
--
-- ════════════════════════════════════════════════════════════════════════════
-- UNDO
-- ════════════════════════════════════════════════════════════════════════════
--   create policy "Authenticated users can see event participants"
--     on public.event_registrations for select to public
--     using ((auth.uid() is not null) and (exists (select 1 from public.events e
--            where e.id = event_registrations.event_id)));
--   drop policy if exists event_reg_insert on public.event_registrations;
--   create policy event_reg_insert on public.event_registrations for insert to authenticated
--     with check (is_moderator() or ((user_id = (select auth.uid()))
--       and (exists (select 1 from public.profiles p where p.user_id = (select auth.uid())
--             and p.access_status = 'verified'::access_status_enum
--             and p.onboarding_status = 'completed'::onboarding_status_enum))
--       and (exists (select 1 from public.events e where e.id = event_registrations.event_id
--             and can_access_resource(e.access_level)))));
--   drop policy if exists "Anonymous guests can register for public webinars" on public.event_registrations;
--   create policy "Anonymous guests can register for public webinars"
--     on public.event_registrations for insert to anon
--     with check ((user_id is null) and (guest_email is not null)
--       and (exists (select 1 from public.events e
--             where e.id = event_registrations.event_id and e.event_type = 'webinar'
--               and e.access_level = 'public' and coalesce(e.published, true) = true
--               and coalesce(e.invitation_only, false) = false)));
--   -- Only if no row uses it (else first: update ... set registration_type = 'visitor'
--   --   where registration_type = 'invitation_request'):
--   alter table public.event_registrations drop constraint event_registrations_registration_type_check;
--   alter table public.event_registrations add constraint event_registrations_registration_type_check
--     check (registration_type = any (array['exhibitor','visitor','sponsor_included',
--       'additional_member','member_discount','guest']::text[]));
--   drop function if exists public.get_event_registration_counts(uuid, uuid);
--   drop function if exists public.get_event_participants(uuid);
--   drop function if exists public.get_my_event_access(uuid[]);
--   -- The frontend of this track needs the three functions: revert it together
--   -- with the functions (or keep the functions; they are harmless alone).
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY, DROP/ADD CONSTRAINT,
-- CREATE OR REPLACE FUNCTION, REVOKE/GRANT can all be re-run.

-- ─── PART 1. SELECT: drop the broad policy, add the safe readers ────────────
drop policy if exists "Authenticated users can see event participants" on public.event_registrations;

create or replace function public.get_event_registration_counts(
  p_event_id uuid,
  p_organization_id uuid default null
)
returns table(total integer, organization_total integer)
language sql
stable
security definer
set search_path to ''
as $function$
  -- Seat counters only: numbers, never rows. Same events the caller can see.
  with me as (
    select auth.uid() as uid, public.is_moderator() as staff
  )
  select
    (select count(*)::integer
       from public.event_registrations r
      where r.event_id = e.id),
    case
      when p_organization_id is null then null
      when me.staff or public.is_org_member(p_organization_id) then
        (select count(*)::integer
           from public.event_registrations r
          where r.event_id = e.id
            and r.organization_id = p_organization_id)
    end
  from public.events e
  cross join me
  where e.id = p_event_id
    and me.uid is not null
    and (me.staff
         or (public.can_access_resource(e.access_level) and coalesce(e.published, true)));
$function$;

revoke all on function public.get_event_registration_counts(uuid, uuid) from public, anon;
grant execute on function public.get_event_registration_counts(uuid, uuid) to authenticated, service_role;

create or replace function public.get_event_participants(p_event_id uuid)
returns table(
  user_id uuid,
  first_name text,
  last_name text,
  avatar_url text,
  job_title text,
  org_name text,
  org_logo_url text
)
language sql
stable
security definer
set search_path to ''
as $function$
  -- Member registrants of one event, safe columns only (no guest_*, no payment
  -- data). Visibility is the profiles RLS rule the page went through before:
  -- self, staff, or a co-member of one of the caller's organisations.
  with me as (
    select auth.uid() as uid, public.is_moderator() as staff
  )
  select r.user_id,
         p.first_name,
         p.last_name,
         p.avatar_url,
         p.job_title,
         o.name,
         o.logo_url
    from public.events e
    cross join me
    join public.event_registrations r
      on r.event_id = e.id
     and r.user_id is not null
    join public.profiles p
      on p.user_id = r.user_id
    left join lateral (
      select org.name, org.logo_url
        from public.organization_members om
        join public.organizations org on org.id = om.organization_id
       where om.user_id = r.user_id
       order by (om.organization_id = r.organization_id) desc nulls last,
                om.joined_at asc nulls last
       limit 1
    ) o on true
   where e.id = p_event_id
     and me.uid is not null
     and (me.staff
          or (public.can_access_resource(e.access_level) and coalesce(e.published, true)))
     -- an invitation request is not an attendee until staff approve it
     and not (coalesce(e.invitation_only, false) and r.payment_status = 'pending_approval')
     and (me.staff
          or r.user_id = me.uid
          or public.profiles_shares_org(r.user_id))
   order by r.created_at;
$function$;

revoke all on function public.get_event_participants(uuid) from public, anon;
grant execute on function public.get_event_participants(uuid) to authenticated, service_role;

-- ─── PART 2. INSERT: published + invitation_only + own org + payment status ──
drop policy if exists event_reg_insert on public.event_registrations;

create policy event_reg_insert
  on public.event_registrations
  as permissive
  for insert
  to authenticated
  with check (
    is_moderator()
    or (
      user_id = (select auth.uid())
      -- the only statuses a member's own browser ever sends
      and coalesce(payment_status, 'free') in ('free', 'pending_approval')
      -- a registration may only be booked under one of the caller's organisations
      and (
        organization_id is null
        or exists (
          select 1
            from public.organization_members om
           where om.organization_id = event_registrations.organization_id
             and om.user_id = (select auth.uid())
        )
      )
      and exists (
        select 1
          from public.profiles p
         where p.user_id = (select auth.uid())
           and p.access_status = 'verified'::access_status_enum
           and p.onboarding_status = 'completed'::onboarding_status_enum
      )
      and exists (
        select 1
          from public.events e
         where e.id = event_registrations.event_id
           and can_access_resource(e.access_level)
           and coalesce(e.published, true) = true
           and (
             coalesce(e.invitation_only, false) = false
             -- "Request an invitation": waits for staff
             or (event_registrations.registration_type = 'invitation_request'
                 and event_registrations.payment_status = 'pending_approval')
             -- sponsors' included seats (EventRegistrationFlow invitation-only branch)
             or (event_registrations.registration_type = 'sponsor_included'
                 and exists (
                   select 1
                     from public.organization_members om
                     join public.organizations o on o.id = om.organization_id
                    where om.organization_id = event_registrations.organization_id
                      and om.user_id = (select auth.uid())
                      and o.tier in ('innovation_partner', 'associate_partner',
                                     'premium_partner', 'premium_sponsor', 'main_sponsor')
                 ))
           )
      )
    )
  );

-- ─── PART 2b. INSERT by anon: only the row guest-webinar-register would write ─
-- guest-webinar-register (service_role) bypasses RLS and is not affected.
drop policy if exists "Anonymous guests can register for public webinars" on public.event_registrations;

-- DECISION (7 Oct 2026, applied this way): the anon INSERT policy is DROPPED and
-- not recreated. Nothing in the app inserts as anon (LightweightWebinarSignup
-- calls guest-webinar-register, which uses the service role and keeps its own
-- rate limits), so guest registration keeps working and the REST bypass (mass
-- guest rows for arbitrary addresses, each reminded by e-mail) is gone. The
-- assertion below accepts this outcome.

-- ─── PART 3. registration_type: allow 'invitation_request' ───────────────────
alter table public.event_registrations
  drop constraint if exists event_registrations_registration_type_check;
alter table public.event_registrations
  add constraint event_registrations_registration_type_check
  check (registration_type = any (array[
    'exhibitor', 'visitor', 'sponsor_included', 'additional_member',
    'member_discount', 'guest', 'invitation_request'
  ]::text[]));

-- ─── PART 4. Join link for registrants and staff only ────────────────────────
create or replace function public.get_my_event_access(p_event_ids uuid[] default null)
returns table(event_id uuid, is_registered boolean, meeting_url text)
language sql
stable
security definer
set search_path to ''
as $function$
  with me as (
    select auth.uid() as uid,
           public.is_moderator() as staff,
           -- guest rows count as mine only for a CONFIRMED auth e-mail
           (select lower(u.email)
              from auth.users u
             where u.id = auth.uid()
               and u.email_confirmed_at is not null) as email
  ),
  mine as (
    select distinct r.event_id
      from public.event_registrations r
      join public.events e on e.id = r.event_id
      cross join me
     where me.uid is not null
       and (r.user_id = me.uid
            or (r.user_id is null
                and me.email is not null
                and lower(r.guest_email) = me.email))
       -- an invitation request is not a seat until staff approve it
       and not (coalesce(e.invitation_only, false) and r.payment_status = 'pending_approval')
       and (p_event_ids is null or r.event_id = any(p_event_ids))
  )
  select e.id,
         (m.event_id is not null),
         case when m.event_id is not null or me.staff then e.meeting_url end
    from public.events e
    cross join me
    left join mine m on m.event_id = e.id
   where me.uid is not null
     and (me.staff or public.can_access_resource(e.access_level))
     and case
           when p_event_ids is null then m.event_id is not null
           else e.id = any(p_event_ids) and (m.event_id is not null or me.staff)
         end;
$function$;

revoke all on function public.get_my_event_access(uuid[]) from public, anon;
grant execute on function public.get_my_event_access(uuid[]) to authenticated, service_role;

-- ─── Assertions (abort the migration if anything is off) ─────────────────────
do $$
begin
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'event_registrations'
                and policyname = 'Authenticated users can see event participants') then
    raise exception 'S5: broad participant policy still present';
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'event_registrations'
                    and policyname = 'event_reg_select') then
    raise exception 'S5: own-row policy event_reg_select is missing';
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'event_registrations'
                    and policyname = 'block_generic_reg_on_sm_event'
                    and permissive = 'RESTRICTIVE') then
    raise exception 'S18: SM26 restrictive policy is missing';
  end if;
  -- the anon guest policy is either dropped (OPTION) or the tightened one
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'event_registrations'
                and policyname = 'Anonymous guests can register for public webinars'
                and (roles <> '{anon}'::name[]
                     or with_check not like '%registration_type = ''guest''%'
                     or with_check not like '%organization_id IS NULL%')) then
    raise exception 'S18: anon guest policy is still the loose one';
  end if;
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'event_registrations'
                and cmd in ('INSERT', 'ALL') and 'anon' = any(roles)
                and policyname <> 'Anonymous guests can register for public webinars') then
    raise exception 'S18: another INSERT policy is open to anon';
  end if;
  if has_function_privilege('anon', 'public.get_event_registration_counts(uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'public.get_event_participants(uuid)', 'execute')
     or has_function_privilege('anon', 'public.get_my_event_access(uuid[])', 'execute') then
    raise exception 'S5: a new function is executable by anon';
  end if;
  if not (has_function_privilege('authenticated', 'public.get_event_registration_counts(uuid, uuid)', 'execute')
          and has_function_privilege('authenticated', 'public.get_event_participants(uuid)', 'execute')
          and has_function_privilege('authenticated', 'public.get_my_event_access(uuid[])', 'execute')) then
    raise exception 'S5: a new function is not executable by authenticated';
  end if;
end
$$;

-- The three new RPCs must be visible to PostgREST right away.
notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- PHASE B — NOT APPLIED BY THIS FILE. Hide events.meeting_url itself.
-- ════════════════════════════════════════════════════════════════════════════
-- Prerequisite: no client reads events with select('*') or names meeting_url.
-- Still doing so on 7 Oct 2026 (files outside this track):
--   src/pages/EventsPage.tsx:123            .from('events').select('*')
--       + uses e.meeting_url for registered webinars (lines ~415-446, ~969)
--       -> explicit column list; join links from
--          supabase.rpc('get_my_event_access', { p_event_ids: null })
--   src/pages/AccountPage.tsx:491           embed events(..., meeting_url, ...)
--       + lines ~2627-2707
--       -> drop meeting_url from the embed; rpc('get_my_event_access',
--          { p_event_ids: <the event ids> }) for the links
--   src/components/admin/AdminEvents.tsx:41 .from('events').select('*')
--       -> explicit column list (the list does not use meeting_url)
--   src/components/admin/AdminEventDetail.tsx:120  .from('events').select('*')
--       + form field meeting_url (line ~138)
--       -> explicit column list; rpc('get_my_event_access',
--          { p_event_ids: [eventId] }) returns the link to staff
--   (EventDetailPage and DashboardPage are already done in this track.
--    Writes keep working: INSERT/UPDATE grants are untouched, and
--    insert(...).select('id') only needs SELECT on id.)
-- Then, as a NEW migration:
--
--   do $$
--   declare v_cols text;
--   begin
--     select string_agg(format('%I', a.attname), ', ' order by a.attnum)
--       into v_cols
--       from pg_attribute a
--      where a.attrelid = 'public.events'::regclass
--        and a.attnum > 0 and not a.attisdropped
--        and a.attname <> 'meeting_url';
--     execute 'revoke select on public.events from anon, authenticated';
--     execute format('grant select (%s) on public.events to anon, authenticated', v_cols);
--     if has_column_privilege('anon', 'public.events', 'meeting_url', 'SELECT')
--        or has_column_privilege('authenticated', 'public.events', 'meeting_url', 'SELECT') then
--       raise exception 'meeting_url still readable';
--     end if;
--   end $$;
--
-- Trap after PHASE B: a column added to public.events is not readable by anon
-- or authenticated until granted explicitly (grant select (col) on
-- public.events to anon, authenticated;), and select('*') on events fails.
-- UNDO of PHASE B: grant select on public.events to anon, authenticated;
