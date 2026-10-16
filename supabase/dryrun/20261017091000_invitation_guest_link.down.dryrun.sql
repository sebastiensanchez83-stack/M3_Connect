-- DRY RUN of supabase/migrations/down/20261017091000_invitation_guest_link.down.sql.
-- NOT A MIGRATION. Run it AFTER 20261017090000_invitation_campaigns is applied and BEFORE
-- 20261017091000_invitation_guest_link is, like that file's own dry run. ONE query text,
-- ONE execute_sql call. Everything rolls back: the last statement raises 'DRYRUN ...'; the
-- result is in that error message.
-- Order: snapshot; the migration, verbatim; a campaign guest put on a throw-away guest list
-- by invitation_link_guest (the service role, for a verified admin); the down, verbatim,
-- twice (a second run must be harmless); checks.
-- Expected: "4 PASS, 0 FAIL".

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- A. Snapshot (compared at the end; guest list and module rows aside: the run adds test rows)
create function pg_temp.dr_snap() returns table (k text, v text) language sql as $f$
  select 'gl_guest', (select md5(coalesce(string_agg(g::text, ',' order by g.id), '')) from public.gl_guest g)
  union all select 'gl_event', (select md5(coalesce(string_agg(e::text, ',' order by e.id), '')) from public.gl_event e)
  union all select 'gl_email_log', (select count(*) || '/' || coalesce(max(l.id), 0) from public.gl_email_log l)
  union all select 'sm', concat_ws('/', (select count(*) from public.sm_registration), (select count(*) from public.sm_attendee),
                                   (select count(*) from public.sm_badge), (select count(*) from public.sm_invitation))
  union all select 'policies', (select md5(string_agg(format('%s.%s.%s|%s|%s|%s|%s', pl.schemaname, pl.tablename, pl.policyname,
                                  pl.cmd, pl.roles, pl.qual, pl.with_check), ';' order by pl.schemaname, pl.tablename, pl.policyname))
                                  from pg_policies pl where pl.policyname not like 'invitation%')
  union all select 'acls', (select md5(string_agg(p.oid::regprocedure::text || '=' || coalesce(array_to_string(p.proacl, ','), ''), ';'
                              order by p.oid::regprocedure::text))
                              from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname not like 'invitation%')
  union all select 'pins', (select md5(string_agg(p.proname || ':' || md5(p.prosrc), ',' order by p.proname, md5(p.prosrc)))
                              from pg_proc p where p.pronamespace = 'public'::regnamespace
                               and p.proname in ('gl_checkin', 'gl_checkin_v2', 'gl_guest_engine_guard', 'gl_guest_queue_provisioning',
                                 'invoke_registration_cron', 'invoke_send_profile_reminders', 'invoke_guest_webinar_reminders',
                                 'handle_new_user', 'has_capability', 'capability_set', 'complete_signup_for', 'is_moderator', 'is_admin'))
  union all select 'triggers', (select md5(string_agg(t.tgrelid::regclass::text || ':' || t.tgname || ':' || t.tgenabled::text, ','
                                  order by t.tgrelid::regclass::text, t.tgname))
                                  from pg_trigger t where not t.tgisinternal and t.tgrelid::regclass::text not like 'invitation%')
  union all select 'tables', (select md5(string_agg(c.oid::regclass::text || ':' || c.relrowsecurity::text || ':'
                                || coalesce(array_to_string(c.relacl, ','), ''), ';' order by c.oid::regclass::text))
                                from pg_class c where c.relnamespace in ('public'::regnamespace, 'storage'::regnamespace)
                                 and c.relkind = 'r' and c.relname not like 'invitation%')
  union all select 'buckets', (select md5(string_agg(b::text, ',' order by b.id)) from storage.buckets b where b.id <> 'invitation-files')
  union all select 'invitation', concat_ws('/', (select count(*) from public.invitation_campaign), (select count(*) from public.invitation_recipient),
                                           (select count(*) from public.invitation_log))
$f$;
create temp table _dr_before on commit drop as select * from pg_temp.dr_snap();

-- B. The migration, verbatim ───────────────────────────────────────────────────
-- invitation_guest_link: step 1 (part 2 of 2) of the "Invitation campaigns" admin module.
-- NOT APPLIED. Needs part 1 (20261017090000_invitation_campaigns) applied. Apply only with
-- Victor's OK, after its dry runs: supabase/dryrun/20261017091000_invitation_guest_link.dryrun.sql
-- and supabase/dryrun/20261017091000_invitation_guest_link.down.dryrun.sql (this file's down).
-- Down: supabase/migrations/down/20261017091000_invitation_guest_link.down.sql (before part
-- 1's down). Plan: "9 M3 Connect/Module invitations - etape 0 - plan.md" (16 Oct 2026).
--
-- ADDITIVE ONLY: 4 functions. invitation_link_guest() puts a campaign guest on the event's
-- guest list (gl_guest) exactly as the guest-list edge function's "invite" action (live v6,
-- WYS freeze until 28 Nov) does, but sends NO e-mail. Only the module's sender (step 4,
-- service role, acting for a verified staff member) calls it, in the same action as the
-- invitation e-mail and its gl_email_log 'invitation' line, which the health monitor
-- expects for every invited row. invitation_unlink_guest() undoes a link whose e-mail never
-- went out. invitation_set_answer() records an answer received by e-mail as v6's public
-- "rsvp" action does; the entry pass is then sent by guest-list's existing staff "resend"
-- action, never from SQL. None touches gl_guest's token, plus-one fields, user_id or
-- admin_note. No gl_* function, trigger or policy is redefined.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if to_regclass('public.invitation_recipient') is null or to_regclass('public.invitation_log') is null
     or to_regprocedure('public.invitation_find_duplicates(uuid,uuid)') is null then
    raise exception 'invitation_guest_link: apply 20261017090000_invitation_campaigns first';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('invitation_actor', 'invitation_link_guest', 'invitation_unlink_guest', 'invitation_set_answer')) then
    raise exception 'invitation_guest_link: already applied';
  end if;
  -- The columns written or read below, as guest-list v6 writes and reads them.
  if (select count(*) from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = 'gl_guest'
         and c.column_name in ('first_name', 'last_name', 'email', 'company', 'job_title', 'phone', 'country', 'event_id',
                               'source', 'status', 'conference', 'gala', 'wants_conference', 'wants_gala', 'invited_at',
                               'decided_by', 'decided_at', 'responded_at', 'token', 'plus_one_of')) <> 20
     or (select count(*) from information_schema.columns c
          where c.table_schema = 'public' and c.table_name = 'gl_event' and c.column_name in ('capacity', 'engine')) <> 2
     or (select count(*) from information_schema.columns c
          where c.table_schema = 'public' and c.table_name = 'gl_email_log' and c.column_name in ('guest_id', 'kind')) <> 2 then
    raise exception 'invitation_guest_link: gl_guest / gl_event / gl_email_log are not the shape guest-list v6 uses';
  end if;
end
$pre$;

-- 1. Who acts. A verified admin or moderator signed in; or the service role acting for one
-- (p_actor: a verified admin or moderator, checked as guest-list v6 checks staff). Anyone
-- else: 42501. The staff member is recorded as decided_by on gl_guest (as v6 does) and as
-- the journal's actor (invitation.actor, read by part 1's journal triggers).
create function public.invitation_actor(p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_uid uuid;
begin
  if coalesce(auth.role(), '') = 'service_role' then
    select p.user_id into v_uid from public.profiles p
     where p_actor is not null and p.user_id = p_actor
       and p.persona::text in ('admin', 'moderator') and p.access_status::text = 'verified';
  elsif coalesce(public.is_moderator(), false) then
    v_uid := auth.uid();
  end if;
  if v_uid is null then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  perform set_config('invitation.actor', v_uid::text, true);
  return v_uid;
end
$f$;

-- 2. Put a campaign guest on the event's guest list. Service role only (the sender).
-- Returns {ok, ...} or {ok:false, error}. No e-mail is sent here.
--  - Already linked: returns the row (idempotent: the sender retries a failed e-mail).
--  - Only a draft or ready guest is linked ('bad_status': e.g. one marked declined).
--  - New address: inserts the row exactly as guest-list v6 "invite" does (source
--    'invitation', status 'invited', conference/gala and wants_* from the campaign,
--    invited_at = decided_at = now, decided_by = the staff member, empty strings for a
--    missing company/job title/phone/country, token by default). Capacity as v6:
--    confirmed + invited + 1 must fit, unless p_force.
--  - The address is already on the list: refused ('already_on_list', with its status and
--    source), unless p_adopt: an invited, confirmed or declined row is linked as it is (the
--    guest's answer is copied, the row is not written). A pending request is NOT adopted
--    ('pending_request'; plan question 10 is open): staff handle it in "WYS 2026".
--    Rejected, cancelled rows and pending plus-one requests: 'not_adoptable'. A row linked
--    to another campaign guest is never taken ('guest_linked_elsewhere').
create function public.invitation_link_guest(p_recipient_id uuid, p_force boolean default false,
                                             p_adopt boolean default false, p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_uid uuid;
  v_rec public.invitation_recipient;
  v_camp public.invitation_campaign;
  v_ev public.gl_event;
  v_guest public.gl_guest;
  v_other uuid;
  v_held integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'forbidden: guests are linked by the sender only';
  end if;
  v_uid := public.invitation_actor(p_actor);
  select * into v_rec from public.invitation_recipient where id = p_recipient_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'recipient_not_found');
  end if;
  if v_rec.gl_guest_id is not null then
    select * into v_guest from public.gl_guest where id = v_rec.gl_guest_id;
    return jsonb_build_object('ok', true, 'already_linked', true, 'created', false, 'adopted', false,
      'guest_id', v_guest.id, 'guest_status', v_guest.status);
  end if;
  if v_rec.status not in ('draft', 'ready') then
    return jsonb_build_object('ok', false, 'error', 'bad_status', 'status', v_rec.status);
  end if;
  select * into v_camp from public.invitation_campaign where id = v_rec.campaign_id;
  if v_camp.archived_at is not null then
    return jsonb_build_object('ok', false, 'error', 'campaign_archived');
  end if;
  select * into v_ev from public.gl_event where id = v_camp.gl_event_id;
  if v_ev.engine is distinct from 'guest_list_v1' then
    return jsonb_build_object('ok', false, 'error', 'engine_not_supported', 'engine', v_ev.engine);
  end if;
  if v_rec.email is null then
    return jsonb_build_object('ok', false, 'error', 'no_email');
  end if;
  if v_rec.first_name is null or v_rec.last_name is null then
    return jsonb_build_object('ok', false, 'error', 'missing_name');
  end if;

  -- One link at a time per event, so the seat count and the address check hold until commit.
  perform pg_advisory_xact_lock(hashtext('invitation_link_guest'), hashtext(v_ev.id::text));

  select * into v_guest from public.gl_guest where event_id = v_ev.id and lower(email) = v_rec.email for update;
  if found then
    select r.id into v_other from public.invitation_recipient r where r.gl_guest_id = v_guest.id;
    if v_other is not null then
      return jsonb_build_object('ok', false, 'error', 'guest_linked_elsewhere', 'guest_id', v_guest.id,
        'other_recipient_id', v_other);
    end if;
    if not p_adopt then
      return jsonb_build_object('ok', false, 'error', 'already_on_list', 'guest_id', v_guest.id,
        'guest_status', v_guest.status, 'guest_source', v_guest.source);
    end if;
    if v_guest.status = 'requested' and v_guest.source = 'request' then
      return jsonb_build_object('ok', false, 'error', 'pending_request', 'guest_id', v_guest.id,
        'guest_status', v_guest.status, 'guest_source', v_guest.source);
    end if;
    if v_guest.status not in ('invited', 'confirmed', 'declined') then
      return jsonb_build_object('ok', false, 'error', 'not_adoptable', 'guest_id', v_guest.id,
        'guest_status', v_guest.status, 'guest_source', v_guest.source);
    end if;
    update public.invitation_recipient
       set gl_guest_id = v_guest.id,
           status = case v_guest.status when 'confirmed' then 'accepted' when 'declined' then 'declined' else status end,
           responded_at = case when v_guest.status in ('confirmed', 'declined')
                               then coalesce(v_guest.responded_at, v_guest.decided_at, now()) else responded_at end
     where id = v_rec.id;
    insert into public.invitation_log (campaign_id, recipient_id, action, actor_id, payload)
    values (v_rec.campaign_id, v_rec.id, 'guest_adopted', v_uid, jsonb_build_object('guest_id', v_guest.id,
      'guest_status', v_guest.status, 'guest_source', v_guest.source));
    return jsonb_build_object('ok', true, 'created', false, 'adopted', true, 'guest_id', v_guest.id,
      'guest_status', v_guest.status);
  end if;

  if v_ev.capacity is not null and not p_force then
    select count(*) into v_held from public.gl_guest where event_id = v_ev.id and status in ('confirmed', 'invited');
    if v_held + 1 > v_ev.capacity then
      return jsonb_build_object('ok', false, 'error', 'capacity', 'held', v_held, 'capacity', v_ev.capacity);
    end if;
  end if;
  begin
    insert into public.gl_guest (first_name, last_name, email, company, job_title, phone, country, event_id,
                                 source, status, conference, gala, wants_conference, wants_gala,
                                 invited_at, decided_by, decided_at)
    values (left(v_rec.first_name, 80), left(v_rec.last_name, 80), left(v_rec.email, 200),
            coalesce(left(v_rec.organisation, 160), ''), coalesce(left(v_rec.position, 160), ''),
            coalesce(left(v_rec.phone, 40), ''), coalesce(left(v_rec.country, 80), ''), v_ev.id,
            'invitation', 'invited', v_camp.conference, v_camp.gala, v_camp.conference, v_camp.gala,
            now(), v_uid, now())
    returning * into v_guest;
  exception when unique_violation then
    -- A public request for this address arrived in between.
    return jsonb_build_object('ok', false, 'error', 'already_on_list');
  end;
  update public.invitation_recipient set gl_guest_id = v_guest.id where id = v_rec.id;
  insert into public.invitation_log (campaign_id, recipient_id, action, actor_id, payload)
  values (v_rec.campaign_id, v_rec.id, 'guest_created', v_uid, jsonb_build_object('guest_id', v_guest.id, 'forced', p_force));
  return jsonb_build_object('ok', true, 'created', true, 'adopted', false, 'guest_id', v_guest.id,
    'guest_status', v_guest.status);
end
$f$;

-- 3. Undo a link whose invitation never went out (wrong address, failed send), so the
-- guest can be corrected and linked again, or deleted. Only for a draft or ready guest
-- whose row this module created ('guest_created' in the journal), still 'invited', source
-- 'invitation', with no e-mail logged for it ('not_undoable' otherwise). The row is
-- cancelled exactly as guest-list v6 "cancel" does (status, decided_at, decided_by); it
-- stays on the list, so its address cannot be invited again on this event.
create function public.invitation_unlink_guest(p_recipient_id uuid, p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_uid uuid;
  v_rec public.invitation_recipient;
  v_guest public.gl_guest;
begin
  v_uid := public.invitation_actor(p_actor);
  select * into v_rec from public.invitation_recipient where id = p_recipient_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'recipient_not_found');
  end if;
  if v_rec.gl_guest_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_linked');
  end if;
  if v_rec.status not in ('draft', 'ready') then
    return jsonb_build_object('ok', false, 'error', 'bad_status', 'status', v_rec.status);
  end if;
  select * into v_guest from public.gl_guest where id = v_rec.gl_guest_id for update;
  if v_guest.status <> 'invited' or v_guest.source <> 'invitation'
     or exists (select 1 from public.gl_email_log l where l.guest_id = v_guest.id)
     or not exists (select 1 from public.invitation_log l where l.recipient_id = v_rec.id and l.action = 'guest_created'
                     and l.payload ->> 'guest_id' = v_guest.id::text) then
    return jsonb_build_object('ok', false, 'error', 'not_undoable', 'guest_id', v_guest.id,
      'guest_status', v_guest.status, 'guest_source', v_guest.source);
  end if;
  update public.gl_guest set status = 'cancelled', decided_at = now(), decided_by = v_uid where id = v_guest.id
  returning * into v_guest;
  update public.invitation_recipient set gl_guest_id = null where id = v_rec.id;
  insert into public.invitation_log (campaign_id, recipient_id, action, actor_id, payload)
  values (v_rec.campaign_id, v_rec.id, 'guest_unlinked', v_uid, jsonb_build_object('guest_id', v_guest.id));
  return jsonb_build_object('ok', true, 'guest_id', v_guest.id, 'guest_status', v_guest.status);
end
$f$;

-- 4. Record an answer received by e-mail
-- accepted: the guest-list row becomes 'confirmed' with responded_at, as v6's public
--   "rsvp accept" does (invited: the seat is already held; declined: a seat must be free,
--   unless p_force). The caller then sends the entry pass with guest-list "resend"
--   ('pass_needed' says whether no pass was logged yet).
-- declined: invited or confirmed becomes 'declined' with responded_at (v6 "rsvp decline").
--   A guest who was never linked is only marked declined in the campaign.
-- no_answer: campaign status only, while the row is still 'invited' (it keeps its seat).
create function public.invitation_set_answer(p_recipient_id uuid, p_answer text, p_force boolean default false,
                                             p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_uid uuid;
  v_rec public.invitation_recipient;
  v_ev public.gl_event;
  v_guest public.gl_guest;
  v_before text;
  v_held integer;
begin
  v_uid := public.invitation_actor(p_actor);
  if p_answer is null or p_answer not in ('accepted', 'declined', 'no_answer') then
    raise exception using errcode = '22023', message = 'bad_answer';
  end if;
  select * into v_rec from public.invitation_recipient where id = p_recipient_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'recipient_not_found');
  end if;

  if v_rec.gl_guest_id is null then
    if p_answer <> 'declined' then
      return jsonb_build_object('ok', false, 'error', 'not_linked');
    end if;
    update public.invitation_recipient set status = 'declined', responded_at = now() where id = v_rec.id;
    insert into public.invitation_log (campaign_id, recipient_id, action, actor_id, payload)
    values (v_rec.campaign_id, v_rec.id, 'answer', v_uid, jsonb_build_object('answer', p_answer, 'guest_id', null));
    return jsonb_build_object('ok', true, 'guest_id', null, 'guest_status', null, 'changed', false, 'pass_needed', false);
  end if;

  select * into v_guest from public.gl_guest where id = v_rec.gl_guest_id for update;
  v_before := v_guest.status;

  if p_answer = 'accepted' then
    if v_guest.status = 'declined' then
      select * into v_ev from public.gl_event where id = v_guest.event_id;
      if v_ev.capacity is not null and not p_force then
        select count(*) into v_held from public.gl_guest where event_id = v_ev.id and status in ('confirmed', 'invited');
        if v_held >= v_ev.capacity then
          return jsonb_build_object('ok', false, 'error', 'capacity', 'held', v_held, 'capacity', v_ev.capacity);
        end if;
      end if;
    elsif v_guest.status not in ('invited', 'confirmed') then
      return jsonb_build_object('ok', false, 'error', 'guest_' || v_guest.status, 'guest_status', v_guest.status);
    end if;
    if v_guest.status <> 'confirmed' then
      update public.gl_guest set status = 'confirmed', responded_at = now() where id = v_guest.id
      returning * into v_guest;
    end if;
    update public.invitation_recipient
       set status = 'accepted', responded_at = coalesce(v_guest.responded_at, now())
     where id = v_rec.id;
  elsif p_answer = 'declined' then
    if v_guest.status in ('invited', 'confirmed') then
      update public.gl_guest set status = 'declined', responded_at = now() where id = v_guest.id
      returning * into v_guest;
    elsif v_guest.status <> 'declined' then
      return jsonb_build_object('ok', false, 'error', 'guest_' || v_guest.status, 'guest_status', v_guest.status);
    end if;
    update public.invitation_recipient
       set status = 'declined', responded_at = coalesce(v_guest.responded_at, now())
     where id = v_rec.id;
  else
    if v_guest.status <> 'invited' then
      return jsonb_build_object('ok', false, 'error', 'guest_answered', 'guest_status', v_guest.status);
    end if;
    update public.invitation_recipient set status = 'no_answer' where id = v_rec.id;
  end if;

  insert into public.invitation_log (campaign_id, recipient_id, action, actor_id, payload)
  values (v_rec.campaign_id, v_rec.id, 'answer', v_uid, jsonb_build_object('answer', p_answer, 'guest_id', v_guest.id,
    'guest_before', v_before, 'guest_after', v_guest.status, 'forced', p_force));
  return jsonb_build_object('ok', true, 'guest_id', v_guest.id, 'guest_status', v_guest.status,
    'changed', v_before is distinct from v_guest.status,
    'pass_needed', v_guest.status = 'confirmed'
      and not exists (select 1 from public.gl_email_log l where l.guest_id = v_guest.id and l.kind = 'pass'));
end
$f$;

-- 5. Function privileges (the project's default grants EXECUTE to anon, authenticated and
-- service_role). invitation_link_guest: the sender only, so no guest-list row is ever
-- created without its e-mail. invitation_actor: internal.
revoke all on function public.invitation_actor(uuid) from public, anon, authenticated, service_role;
revoke all on function public.invitation_link_guest(uuid, boolean, boolean, uuid) from public, anon, authenticated;
revoke all on function public.invitation_unlink_guest(uuid, uuid) from public, anon;
revoke all on function public.invitation_set_answer(uuid, text, boolean, uuid) from public, anon;
grant execute on function public.invitation_link_guest(uuid, boolean, boolean, uuid) to service_role;
grant execute on function public.invitation_unlink_guest(uuid, uuid) to authenticated, service_role;
grant execute on function public.invitation_set_answer(uuid, text, boolean, uuid) to authenticated, service_role;

-- C. A campaign guest put on a throw-away guest list (the down must leave that row) ──
set local statement_timeout = '120s';
create function pg_temp.dr_user(p_id uuid, p_email text, p_persona text)
returns void language plpgsql as $f$
begin
  insert into auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
  values (p_id, p_email, 'authenticated', 'authenticated', '{}'::jsonb, now(), now(), now());
  update public.profiles
     set email_proven_at = now(), access_status = 'verified'::public.access_status_enum,
         persona = p_persona::public.persona_enum, onboarding_status = 'completed'::public.onboarding_status_enum
   where user_id = p_id;
end
$f$;
create temp table _dr_ids on commit drop as
  select gen_random_uuid() as admin, gen_random_uuid() as ev, gen_random_uuid() as c1, gen_random_uuid() as r1,
         'dryrun-down-' || substr(md5(random()::text), 1, 8) || '@example.invalid' as email;
select pg_temp.dr_user(i.admin, 'admin-' || i.email, 'admin') from _dr_ids i;
insert into public.gl_event (id, slug, title, capacity) select i.ev, 'dryrun-down-' || substr(i.ev::text, 1, 8), 'Dryrun down', 3 from _dr_ids i;
insert into public.invitation_campaign (id, gl_event_id, name) select i.c1, i.ev, 'Dryrun down' from _dr_ids i;
insert into public.invitation_recipient (id, campaign_id, first_name, last_name, name_on_ticket, email, status)
  select i.r1, i.c1, 'Down', 'Test', 'Down Test', i.email, 'ready' from _dr_ids i;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
create temp table _dr_link on commit drop as select public.invitation_link_guest(i.r1, false, false, i.admin) as x from _dr_ids i;
select set_config('request.jwt.claims', '', true);

-- D. The down, verbatim ────────────────────────────────────────────────────────
-- DOWN for supabase/migrations/20261017091000_invitation_guest_link.sql
-- Drops invitation_set_answer, invitation_unlink_guest, invitation_link_guest and
-- invitation_actor. Run it before part 1's down.
-- Dry run: supabase/dryrun/20261017091000_invitation_guest_link.down.dryrun.sql.
--
-- DATA: nothing is deleted. The guest-list rows these functions created or changed (gl_guest
-- 'invited' / 'confirmed' / 'declined' / 'cancelled') STAY as they are: they are the event's
-- guest list, with tokens and QR codes already e-mailed; staff keep managing them in
-- "WYS 2026".

set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop function if exists public.invitation_set_answer(uuid, text, boolean, uuid);
drop function if exists public.invitation_unlink_guest(uuid, uuid);
drop function if exists public.invitation_link_guest(uuid, boolean, boolean, uuid);
drop function if exists public.invitation_actor(uuid);

-- E. The down again: must be harmless ──────────────────────────────────────────
-- DOWN for supabase/migrations/20261017091000_invitation_guest_link.sql
-- Drops invitation_set_answer, invitation_unlink_guest, invitation_link_guest and
-- invitation_actor. Run it before part 1's down.
-- Dry run: supabase/dryrun/20261017091000_invitation_guest_link.down.dryrun.sql.
--
-- DATA: nothing is deleted. The guest-list rows these functions created or changed (gl_guest
-- 'invited' / 'confirmed' / 'declined' / 'cancelled') STAY as they are: they are the event's
-- guest list, with tokens and QR codes already e-mailed; staff keep managing them in
-- "WYS 2026".

set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop function if exists public.invitation_set_answer(uuid, text, boolean, uuid);
drop function if exists public.invitation_unlink_guest(uuid, uuid);
drop function if exists public.invitation_link_guest(uuid, boolean, boolean, uuid);
drop function if exists public.invitation_actor(uuid);

-- F. Checks ────────────────────────────────────────────────────────────────────
do $check$
declare
  n_pass integer := 0; n_fail integer := 0; results text := '';
  v_ok boolean; v_label text;
begin
  for v_label, v_ok in
    select 'D1 the 4 functions of this migration are gone',
           not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                        and p.proname in ('invitation_actor', 'invitation_link_guest', 'invitation_unlink_guest', 'invitation_set_answer'))
    union all
    select 'D2 part 1 is untouched: 3 tables, duplicates check, trim helper, private bucket and its 4 policies, the campaign guest still linked',
           to_regclass('public.invitation_campaign') is not null and to_regclass('public.invitation_log') is not null
           and to_regprocedure('public.invitation_find_duplicates(uuid,uuid)') is not null
           and to_regprocedure('public.invitation_trim(text)') is not null
           and exists (select 1 from storage.buckets b where b.id = 'invitation-files' and not b.public)
           and (select count(*) from pg_policies p where p.schemaname = 'storage' and p.policyname like 'invitation_files_staff_%') = 4
           and exists (select 1 from _dr_ids i join public.invitation_recipient r on r.id = i.r1 where r.gl_guest_id is not null)
    union all
    select 'D3 the guest-list row the sender created stays (invited, source invitation, its token, decided_by the admin); the link returned ok',
           exists (select 1 from _dr_ids i join public.gl_guest g on g.event_id = i.ev and g.email = i.email
                    where g.status = 'invited' and g.source = 'invitation' and g.token is not null and g.decided_by = i.admin)
           and (select (l.x ->> 'ok')::boolean from _dr_link l)
    union all
    select 'D4 everything else is as before (policies, ACLs, pins, triggers, tables, buckets, SM26, e-mail log)',
           not exists (((select * from _dr_before except select * from pg_temp.dr_snap())
                        union all (select * from pg_temp.dr_snap() except select * from _dr_before)) except
                       (select * from pg_temp.dr_snap() where k in ('gl_guest', 'gl_event', 'invitation')
                        union all select * from _dr_before where k in ('gl_guest', 'gl_event', 'invitation')))
  loop
    if coalesce(v_ok, false) then n_pass := n_pass + 1; else n_fail := n_fail + 1; end if;
    results := results || E'\n' || case when coalesce(v_ok, false) then 'PASS ' else 'FAIL ' end || v_label;
  end loop;
  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (invitation_guest_link down dry run, run %s)', n_pass, n_fail, now()) || results;
end
$check$;
