-- DRY RUN of supabase/migrations/20261017091000_invitation_guest_link.sql. NOT A MIGRATION.
-- Run it AFTER 20261017090000_invitation_campaigns is applied and BEFORE this file is.
-- ONE query text, ONE execute_sql call. Everything rolls back: the last statement raises
-- 'DRYRUN ...'; the result is in that error message.
-- A. a snapshot of what must not change; B. the migration, verbatim; C. test helpers;
-- D. cases as a visitor (anon), a verified member, a verified moderator, a verified admin
-- and the service role (the sender, acting for a staff member), each in its own rolled-back
-- sub-transaction, on a throw-away guest-list event (capacity 3) created inside the run:
-- the real wys26 list is not touched. The cases compare every gl_guest column guest-list
-- v6 "invite" writes, and check that no e-mail is logged (nothing is sent from SQL).
-- No sm_* row is written.
-- Expected: "42 PASS, 0 FAIL".

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- A. Snapshot (case S01 reads it again after the migration: must be identical)
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
  union all select 'triggers', (select md5(string_agg(t.tgrelid::regclass::text || ':' || t.tgname || ':' || t.tgenabled, ','
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

-- C. Test helpers ──────────────────────────────────────────────────────────────
set local statement_timeout = '120s';

-- A verified user with a proven address (handle_new_user creates the profile).
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

-- Inside a case's setup: act as a signed-in user, or as the service role (the runner
-- resets this before each case and again before q).
create function pg_temp.dr_as(p_uid uuid)
returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end
$f$;
create function pg_temp.dr_svc()
returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
end
$f$;

-- D. Cases ─────────────────────────────────────────────────────────────────────
do $dryrun$
declare
  tests jsonb := '[]'::jsonb;
  t jsonb;
  kv record;
  vars jsonb;
  s0 text;
  v_q text; v_setup text; v_chkq text; v_exp text;
  v_uid uuid; v_dml boolean; v_ret text; v_n bigint;
  v_err text; v_state text; v_chk boolean; v_pass boolean; v_serr text; v_oerr text;
  n_pass integer := 0; n_fail integer := 0;
  results text := '';
  r8 text := substr(md5(random()::text), 1, 8);
  lk text := 'select pg_temp.dr_svc(); select public.invitation_link_guest({r1}, false, false, {admin});';
begin
  vars := jsonb_build_object('admin', gen_random_uuid(), 'moder', gen_random_uuid(), 'member', gen_random_uuid(),
    'ev', gen_random_uuid(), 'c1', gen_random_uuid(), 'c2', gen_random_uuid(),
    'r1', gen_random_uuid(), 'r2', gen_random_uuid(), 'r3', gen_random_uuid(), 'r4', gen_random_uuid(),
    'r5', gen_random_uuid(), 'r6', gen_random_uuid(), 'g_req', gen_random_uuid(), 'g_rej', gen_random_uuid(),
    'tok', gen_random_uuid(),
    'e_admin', 'dryrun-admin-' || r8 || '@example.invalid', 'e_moder', 'dryrun-moder-' || r8 || '@example.invalid',
    'e_member', 'dryrun-member-' || r8 || '@example.invalid', 'e_r1', 'dryrun-leo-' || r8 || '@example.invalid',
    'e_req', 'dryrun-ines-' || r8 || '@example.invalid', 'e_rej', 'dryrun-rex-' || r8 || '@example.invalid',
    'e_r6', 'dryrun-prof-' || r8 || '@example.invalid', 'e_new', 'dryrun-new-' || r8 || '@example.invalid', 'r8', r8);
  -- Shared setup (as the owner): 3 users; a throw-away guest-list event, capacity 3, with a
  -- pending public request (g_req) and a refused one (g_rej); campaign c1: r1 new address,
  -- r2 = g_req's address, r3 no address, r4 = g_rej's address, r6 no first/last name;
  -- campaign c2: r5 = r1's address. lk (in a setup): the sender links r1 for the admin.
  s0 := $s$select pg_temp.dr_user({admin}, {e_admin}, 'admin');
select pg_temp.dr_user({moder}, {e_moder}, 'moderator');
select pg_temp.dr_user({member}, {e_member}, 'marina');
insert into public.gl_event (id, slug, title, capacity) values ({ev}, 'dryrun-inv-' || {r8}, 'Dryrun invitations', 3);
insert into public.gl_guest (id, event_id, source, status, first_name, last_name, email, company, token) values
  ({g_req}, {ev}, 'request', 'requested', 'Ines', 'Dryrun', {e_req}, 'Acme SA', {tok}),
  ({g_rej}, {ev}, 'request', 'rejected', 'Rex', 'Jected', {e_rej}, 'Rex Ltd', gen_random_uuid());
insert into public.invitation_campaign (id, gl_event_id, name) values ({c1}, {ev}, 'Dryrun C1'), ({c2}, {ev}, 'Dryrun C2');
insert into public.invitation_recipient (id, campaign_id, first_name, last_name, name_on_ticket, email, organisation, status) values
  ({r1}, {c1}, 'Leo', 'Sample', 'Mr Leo Sample', {e_r1}, 'Sample & Co', 'ready'),
  ({r2}, {c1}, 'Ines', 'Dryrun', 'Dr Ines Dryrun', {e_req}, 'ACME S.A.', 'ready'),
  ({r3}, {c1}, 'No', 'Mail', 'No Mail', null, null, 'draft'),
  ({r4}, {c1}, 'Rex', 'Jected', 'Rex Jected', {e_rej}, null, 'ready'),
  ({r6}, {c1}, null, null, 'Prof. Someone', {e_r6}, null, 'ready'),
  ({r5}, {c2}, 'Lucky', 'Twin', 'Lucky Twin', upper({e_r1}), null, 'ready')$s$;

  tests := jsonb_build_array(
    jsonb_build_object('id', 'S01', 'who', 'postgres', 'bare', true, 'expect', 'ret:0',
      'label', 'nothing else changed: guest list, campaigns, SM26 counts, policies, function ACLs, ops_health pins, triggers, buckets',
      'q', $q$select count(*)::text from ((select * from _dr_before except select * from pg_temp.dr_snap())
               union all (select * from pg_temp.dr_snap() except select * from _dr_before)) d$q$),
    jsonb_build_object('id', 'S02', 'who', 'postgres', 'bare', true, 'expect', 'ret:false/false/true/true/true/false/false',
      'label', 'EXECUTE: link for the sender (service role) only; answer and undo for signed-in callers (staff checked inside); none for visitors; the actor check is internal',
      'q', $q$select concat_ws('/', has_function_privilege('anon', 'public.invitation_link_guest(uuid,boolean,boolean,uuid)', 'execute')::text,
               has_function_privilege('authenticated', 'public.invitation_link_guest(uuid,boolean,boolean,uuid)', 'execute')::text,
               has_function_privilege('service_role', 'public.invitation_link_guest(uuid,boolean,boolean,uuid)', 'execute')::text,
               has_function_privilege('authenticated', 'public.invitation_set_answer(uuid,text,boolean,uuid)', 'execute')::text,
               has_function_privilege('authenticated', 'public.invitation_unlink_guest(uuid,uuid)', 'execute')::text,
               has_function_privilege('anon', 'public.invitation_unlink_guest(uuid,uuid)', 'execute')::text,
               has_function_privilege('authenticated', 'public.invitation_actor(uuid)', 'execute')::text)$q$),
    -- Linking a campaign guest to the guest list (the sender: service role, for a staff member)
    jsonb_build_object('id', 'K01', 'who', 'anon', 'expect', 'rls', 'label', 'a visitor cannot link',
      'q', $q$select public.invitation_link_guest({r1})::text$q$),
    jsonb_build_object('id', 'K02', 'who', 'member', 'expect', 'rls', 'label', 'a verified member cannot link',
      'q', $q$select public.invitation_link_guest({r1})::text$q$,
      'chk', $c$select not exists (select 1 from public.gl_guest g where g.event_id = {ev} and g.email = {e_r1})$c$),
    jsonb_build_object('id', 'K03', 'who', 'admin', 'expect', 'rls',
      'label', 'nor can an admin from the browser: only the sender links, with the e-mail, so no row exists without its invitation',
      'q', $q$select public.invitation_link_guest({r1}, false, false, {admin})::text$q$,
      'chk', $c$select not exists (select 1 from public.gl_guest g where g.event_id = {ev} and g.email = {e_r1})$c$),
    jsonb_build_object('id', 'K04', 'who', 'service', 'expect', 'ret:true/true/invited',
      'label', 'new address: an "invited" row exactly as guest-list v6 invite writes it (decided_by = the staff member), no e-mail logged, journalled in their name',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'created', x ->> 'guest_status')
               from (select public.invitation_link_guest({r1}, false, false, {admin}) as x) s$q$,
      'chk', $c$select exists (select 1 from public.gl_guest g join public.invitation_recipient r on r.gl_guest_id = g.id
               where r.id = {r1} and r.status = 'ready' and g.event_id = {ev} and g.source = 'invitation' and g.status = 'invited'
                 and g.email = {e_r1} and g.first_name = 'Leo' and g.last_name = 'Sample' and g.company = 'Sample & Co'
                 and g.job_title = '' and g.phone = '' and g.country = '' and g.motivation is null
                 and g.conference and g.gala and g.wants_conference and g.wants_gala
                 and g.invited_at is not null and g.decided_at = g.invited_at and g.decided_by = {admin} and g.responded_at is null
                 and g.plus_one_of is null and g.user_id is null and g.admin_note is null and g.token is not null)
             and not exists (select 1 from public.gl_email_log l where l.event_id = {ev})
             and exists (select 1 from public.invitation_log l where l.recipient_id = {r1} and l.action = 'guest_created'
               and l.actor_id = {admin})
             and exists (select 1 from public.invitation_log l where l.recipient_id = {r1} and l.action = 'guest_link_changed'
               and l.actor_id = {admin})$c$),
    jsonb_build_object('id', 'K05', 'who', 'service', 'expect', 'ret:true', 'label', 'linking twice returns the same row (the sender may retry)',
      'setup', '<lk>',
      'q', $q$select x ->> 'already_linked' from (select public.invitation_link_guest({r1}, false, false, {admin}) as x) s$q$,
      'chk', $c$select (select count(*) from public.gl_guest g where g.event_id = {ev} and g.email = {e_r1}) = 1$c$),
    jsonb_build_object('id', 'K06', 'who', 'service', 'expect', 'ret:false/capacity',
      'label', 'capacity as v6: confirmed + invited + 1 must fit',
      'setup', $s$insert into public.gl_guest (event_id, source, status, first_name, last_name, email)
               select {ev}::uuid, 'invitation', 'invited', 'Seat', 'No ' || n, 'dryrun-seat-' || n || '-' || {r8} || '@example.invalid'
                 from generate_series(1, 3) n$s$,
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_link_guest({r1}, false, false, {admin}) as x) s$q$,
      'chk', $c$select not exists (select 1 from public.gl_guest g where g.event_id = {ev} and g.email = {e_r1})$c$),
    jsonb_build_object('id', 'K07', 'who', 'service', 'expect', 'ret:true/true', 'label', 'unless forced',
      'setup', $s$insert into public.gl_guest (event_id, source, status, first_name, last_name, email)
               select {ev}::uuid, 'invitation', 'invited', 'Seat', 'No ' || n, 'dryrun-seat-' || n || '-' || {r8} || '@example.invalid'
                 from generate_series(1, 3) n$s$,
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'created') from (select public.invitation_link_guest({r1}, true, false, {admin}) as x) s$q$),
    jsonb_build_object('id', 'K08', 'who', 'service', 'expect', 'ret:false/already_on_list/requested',
      'label', 'an address with a pending public request is refused without adopt, nothing changes',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error', x ->> 'guest_status') from (select public.invitation_link_guest({r2}, false, false, {admin}) as x) s$q$,
      'chk', $c$select (select g.status from public.gl_guest g where g.id = {g_req}) = 'requested'
             and (select r.gl_guest_id from public.invitation_recipient r where r.id = {r2}) is null$c$),
    jsonb_build_object('id', 'K09', 'who', 'service', 'expect', 'ret:false/pending_request/requested',
      'label', 'a pending request is never adopted (plan question 10 open), even forced: the request row stays byte-identical',
      'setup', $s$create temp table _dr_k09 on commit drop as select md5(g::text) as h from public.gl_guest g where g.id = {g_req}$s$,
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error', x ->> 'guest_status') from (select public.invitation_link_guest({r2}, true, true, {admin}) as x) s$q$,
      'chk', $c$select (select md5(g::text) from public.gl_guest g where g.id = {g_req}) = (select k.h from _dr_k09 k)
             and (select r.gl_guest_id from public.invitation_recipient r where r.id = {r2}) is null
             and not exists (select 1 from public.invitation_log l where l.recipient_id = {r2} and l.action = 'guest_adopted')$c$),
    jsonb_build_object('id', 'K10', 'who', 'service', 'expect', 'ret:false/not_adoptable', 'label', 'a refused request is not adoptable',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_link_guest({r4}, false, true, {admin}) as x) s$q$,
      'chk', $c$select (select g.status from public.gl_guest g where g.id = {g_rej}) = 'rejected'$c$),
    jsonb_build_object('id', 'K11', 'who', 'service', 'expect', 'ret:true/true/confirmed',
      'label', 'adopting a row that already accepted copies the answer (guest-list row untouched)',
      'setup', $s$update public.gl_guest set status = 'confirmed', responded_at = now() where id = {g_req}$s$,
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'adopted', x ->> 'guest_status') from (select public.invitation_link_guest({r2}, false, true, {admin}) as x) s$q$,
      'chk', $c$select exists (select 1 from public.invitation_recipient r where r.id = {r2} and r.status = 'accepted'
               and r.responded_at is not null and r.gl_guest_id = {g_req})
             and (select g.decided_by from public.gl_guest g where g.id = {g_req}) is null$c$),
    jsonb_build_object('id', 'K12', 'who', 'service', 'expect', 'ret:false/no_email', 'label', 'no address, no link',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_link_guest({r3}, false, false, {admin}) as x) s$q$),
    jsonb_build_object('id', 'K13', 'who', 'service', 'expect', 'ret:false/guest_linked_elsewhere',
      'label', 'the same address in another campaign is never linked twice, even with adopt',
      'setup', '<lk>',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_link_guest({r5}, false, true, {admin}) as x) s$q$),
    jsonb_build_object('id', 'K14', 'who', 'service', 'expect', 'rls', 'label', 'the service role cannot link without naming the staff member',
      'q', $q$select public.invitation_link_guest({r1})::text$q$,
      'chk', $c$select not exists (select 1 from public.gl_guest g where g.event_id = {ev} and g.email = {e_r1})$c$),
    jsonb_build_object('id', 'K15', 'who', 'service', 'expect', 'rls', 'label', 'nor for someone who is not verified staff',
      'q', $q$select public.invitation_link_guest({r1}, false, false, {member})::text$q$,
      'chk', $c$select not exists (select 1 from public.gl_guest g where g.event_id = {ev} and g.email = {e_r1})$c$),
    jsonb_build_object('id', 'K16', 'who', 'service', 'expect', 'ret:false/campaign_archived', 'label', 'an archived campaign links nobody',
      'setup', $s$update public.invitation_campaign set archived_at = now() where id = {c1}$s$,
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_link_guest({r1}, false, false, {admin}) as x) s$q$),
    jsonb_build_object('id', 'K17', 'who', 'service', 'expect', 'ret:false/missing_name', 'label', 'the guest list needs a first and a last name (sent for a moderator)',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_link_guest({r6}, false, false, {moder}) as x) s$q$),
    jsonb_build_object('id', 'K18', 'who', 'service', 'expect', 'ret:false/bad_status',
      'label', 'a guest already marked declined is not put on the list',
      'setup', $s$select pg_temp.dr_as({admin}); select public.invitation_set_answer({r1}, 'declined')$s$,
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_link_guest({r1}, false, false, {admin}) as x) s$q$,
      'chk', $c$select not exists (select 1 from public.gl_guest g where g.event_id = {ev} and g.email = {e_r1})$c$),
    -- Undoing a link whose invitation never went out
    jsonb_build_object('id', 'U01', 'who', 'member', 'expect', 'rls', 'label', 'a verified member cannot undo a link',
      'setup', '<lk>',
      'q', $q$select public.invitation_unlink_guest({r1})::text$q$,
      'chk', $c$select (select r.gl_guest_id from public.invitation_recipient r where r.id = {r1}) is not null$c$),
    jsonb_build_object('id', 'U02', 'who', 'admin', 'expect', 'ret:true/cancelled',
      'label', 'an admin undoes a link never e-mailed: the row is cancelled as v6 cancel does, the guest is free again, journalled',
      'setup', '<lk>',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'guest_status') from (select public.invitation_unlink_guest({r1}) as x) s$q$,
      'chk', $c$select exists (select 1 from public.gl_guest g where g.event_id = {ev} and g.email = {e_r1} and g.status = 'cancelled'
               and g.decided_by = {admin} and g.cancelled_at is not null and g.source = 'invitation')
             and exists (select 1 from public.invitation_recipient r where r.id = {r1} and r.gl_guest_id is null and r.status = 'ready')
             and exists (select 1 from public.invitation_log l where l.recipient_id = {r1} and l.action = 'guest_unlinked'
               and l.actor_id = {admin})$c$),
    jsonb_build_object('id', 'U03', 'who', 'admin', 'expect', 'allow', 'label', 'then the guest can be deleted (the cancelled row stays on the list)',
      'setup', '<lk> select pg_temp.dr_as({admin}); select public.invitation_unlink_guest({r1});',
      'q', $q$delete from public.invitation_recipient where id = {r1}$q$,
      'chk', $c$select exists (select 1 from public.gl_guest g where g.event_id = {ev} and g.email = {e_r1} and g.status = 'cancelled')$c$),
    jsonb_build_object('id', 'U04', 'who', 'service', 'expect', 'ret:true/true',
      'label', 'or corrected and linked again: a new invited row, the cancelled one stays',
      'setup', '<lk> select pg_temp.dr_as({admin}); select public.invitation_unlink_guest({r1});
               update public.invitation_recipient set email = {e_new} where id = {r1};',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'created') from (select public.invitation_link_guest({r1}, false, false, {admin}) as x) s$q$,
      'chk', $c$select exists (select 1 from public.gl_guest g join public.invitation_recipient r on r.gl_guest_id = g.id
               where r.id = {r1} and g.email = {e_new} and g.status = 'invited')
             and exists (select 1 from public.gl_guest g where g.event_id = {ev} and g.email = {e_r1} and g.status = 'cancelled')$c$),
    jsonb_build_object('id', 'U05', 'who', 'admin', 'expect', 'ret:false/not_undoable', 'label', 'no undo once the invitation e-mail is logged',
      'setup', '<lk> insert into public.gl_email_log (guest_id, event_id, kind, to_email)
               select g.id, g.event_id, ''invitation'', g.email from public.gl_guest g where g.event_id = {ev} and g.email = {e_r1};',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_unlink_guest({r1}) as x) s$q$,
      'chk', $c$select exists (select 1 from public.gl_guest g join public.invitation_recipient r on r.gl_guest_id = g.id
               where r.id = {r1} and g.status = 'invited')$c$),
    jsonb_build_object('id', 'U06', 'who', 'admin', 'expect', 'ret:false/not_undoable', 'label', 'nor for an adopted row the module did not create',
      'setup', $s$update public.gl_guest set status = 'invited', source = 'invitation' where id = {g_req};
               select pg_temp.dr_svc(); select public.invitation_link_guest({r2}, false, true, {admin})$s$,
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_unlink_guest({r2}) as x) s$q$,
      'chk', $c$select exists (select 1 from public.gl_guest g join public.invitation_recipient r on r.gl_guest_id = g.id
               where r.id = {r2} and g.id = {g_req} and g.status = 'invited')$c$),
    jsonb_build_object('id', 'U07', 'who', 'admin', 'expect', 'ret:false/bad_status', 'label', 'nor once the guest is marked sent',
      'setup', '<lk> update public.invitation_recipient set status = ''sent'' where id = {r1};',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_unlink_guest({r1}) as x) s$q$),
    -- Answers received by e-mail
    jsonb_build_object('id', 'A01', 'who', 'member', 'expect', 'rls', 'label', 'a verified member cannot record an answer',
      'q', $q$select public.invitation_set_answer({r1}, 'declined')::text$q$),
    jsonb_build_object('id', 'A02', 'who', 'admin', 'expect', 'err:bad_answer', 'label', 'only accepted, declined or no_answer',
      'q', $q$select public.invitation_set_answer({r1}, 'maybe')::text$q$),
    jsonb_build_object('id', 'A03', 'who', 'admin', 'expect', 'ret:true/confirmed/true/true',
      'label', 'accepted: the row becomes confirmed as v6 rsvp accept does; no e-mail from SQL, the pass is still to send',
      'setup', '<lk>',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'guest_status', x ->> 'changed', x ->> 'pass_needed')
               from (select public.invitation_set_answer({r1}, 'accepted') as x) s$q$,
      'chk', $c$select exists (select 1 from public.invitation_recipient r join public.gl_guest g on g.id = r.gl_guest_id
               where r.id = {r1} and r.status = 'accepted' and r.responded_at is not null and g.status = 'confirmed'
                 and g.responded_at is not null and g.token is not null)
             and not exists (select 1 from public.gl_email_log l where l.event_id = {ev})
             and exists (select 1 from public.invitation_log l where l.recipient_id = {r1} and l.action = 'answer'
               and l.payload ->> 'guest_after' = 'confirmed' and l.actor_id = {admin})$c$),
    jsonb_build_object('id', 'A04', 'who', 'admin', 'expect', 'ret:true/confirmed/false', 'label', 'accepting twice changes nothing',
      'setup', '<lk> select pg_temp.dr_as({admin}); select public.invitation_set_answer({r1}, ''accepted'');',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'guest_status', x ->> 'changed') from (select public.invitation_set_answer({r1}, 'accepted') as x) s$q$),
    jsonb_build_object('id', 'A05', 'who', 'admin', 'expect', 'ret:true/declined', 'label', 'declined: invited becomes declined (v6 rsvp decline)',
      'setup', '<lk>',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'guest_status') from (select public.invitation_set_answer({r1}, 'declined') as x) s$q$,
      'chk', $c$select exists (select 1 from public.invitation_recipient r join public.gl_guest g on g.id = r.gl_guest_id
               where r.id = {r1} and r.status = 'declined' and g.status = 'declined' and g.responded_at is not null)$c$),
    jsonb_build_object('id', 'A06', 'who', 'admin', 'expect', 'ret:true/invited', 'label', 'no answer: campaign status only, the seat stays held',
      'setup', '<lk>',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'guest_status') from (select public.invitation_set_answer({r1}, 'no_answer') as x) s$q$,
      'chk', $c$select exists (select 1 from public.invitation_recipient r join public.gl_guest g on g.id = r.gl_guest_id
               where r.id = {r1} and r.status = 'no_answer' and g.status = 'invited' and g.responded_at is null)$c$),
    jsonb_build_object('id', 'A07', 'who', 'admin', 'expect', 'ret:false/guest_answered', 'label', 'no answer is refused once the guest answered',
      'setup', '<lk> select pg_temp.dr_as({admin}); select public.invitation_set_answer({r1}, ''accepted'');',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_set_answer({r1}, 'no_answer') as x) s$q$),
    jsonb_build_object('id', 'A08', 'who', 'admin', 'expect', 'ret:false/capacity', 'label', 'accepting after declining needs a free seat (v6)',
      'setup', '<lk> select pg_temp.dr_as({admin}); select public.invitation_set_answer({r1}, ''declined'');
               insert into public.gl_guest (event_id, source, status, first_name, last_name, email)
               select {ev}::uuid, ''invitation'', ''invited'', ''Seat'', ''No '' || n, ''dryrun-seat-'' || n || ''-'' || {r8} || ''@example.invalid''
                 from generate_series(1, 3) n;',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_set_answer({r1}, 'accepted') as x) s$q$,
      'chk', $c$select (select g.status from public.gl_guest g where g.event_id = {ev} and g.email = {e_r1}) = 'declined'$c$),
    jsonb_build_object('id', 'A09', 'who', 'admin', 'expect', 'ret:true/confirmed', 'label', 'unless forced',
      'setup', '<lk> select pg_temp.dr_as({admin}); select public.invitation_set_answer({r1}, ''declined'');
               insert into public.gl_guest (event_id, source, status, first_name, last_name, email)
               select {ev}::uuid, ''invitation'', ''invited'', ''Seat'', ''No '' || n, ''dryrun-seat-'' || n || ''-'' || {r8} || ''@example.invalid''
                 from generate_series(1, 3) n;',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'guest_status') from (select public.invitation_set_answer({r1}, 'accepted', true) as x) s$q$),
    jsonb_build_object('id', 'A10', 'who', 'admin', 'expect', 'ret:false/not_linked', 'label', 'a guest never invited cannot accept',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_set_answer({r1}, 'accepted') as x) s$q$),
    jsonb_build_object('id', 'A11', 'who', 'admin', 'expect', 'ret:true', 'label', 'but may be marked declined (campaign only, no guest-list row)',
      'q', $q$select x ->> 'ok' from (select public.invitation_set_answer({r1}, 'declined') as x) s$q$,
      'chk', $c$select (select r.status from public.invitation_recipient r where r.id = {r1}) = 'declined'
             and not exists (select 1 from public.gl_guest g where g.event_id = {ev} and g.email = {e_r1})$c$),
    jsonb_build_object('id', 'A12', 'who', 'admin', 'expect', 'ret:false/guest_cancelled', 'label', 'a guest cancelled in WYS 2026 cannot be accepted here',
      'setup', '<lk> update public.gl_guest set status = ''cancelled'' where event_id = {ev} and email = {e_r1};',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_set_answer({r1}, 'accepted') as x) s$q$),
    jsonb_build_object('id', 'A13', 'who', 'moder', 'expect', 'ret:true/confirmed', 'label', 'a moderator records an acceptance',
      'setup', '<lk>',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'guest_status') from (select public.invitation_set_answer({r1}, 'accepted') as x) s$q$),
    jsonb_build_object('id', 'A14', 'who', 'service', 'expect', 'ret:true/confirmed',
      'label', 'the service role records an answer for a moderator, journalled in their name',
      'setup', '<lk>',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'guest_status') from (select public.invitation_set_answer({r1}, 'accepted', false, {moder}) as x) s$q$,
      'chk', $c$select exists (select 1 from public.invitation_log l where l.recipient_id = {r1} and l.action = 'answer' and l.actor_id = {moder})
             and exists (select 1 from public.invitation_log l where l.recipient_id = {r1} and l.action = 'status_changed'
               and l.payload ->> 'to' = 'accepted' and l.actor_id = {moder})$c$),
    jsonb_build_object('id', 'A15', 'who', 'service', 'expect', 'rls', 'label', 'but not without naming a staff member',
      'setup', '<lk>',
      'q', $q$select public.invitation_set_answer({r1}, 'accepted')::text$q$,
      'chk', $c$select (select g.status from public.gl_guest g where g.event_id = {ev} and g.email = {e_r1}) = 'invited'$c$)
  );
  tests := replace(tests::text, '<lk>', lk)::jsonb;

  -- Runner: setup s0 + setup (owner), q as the caller, chk (owner), all rolled back. An
  -- expected error is caught around q only, so chk still runs. An error in setup, or any
  -- other error outside q, FAILS the case. {x} = quoted vars.x; <x> = raw.
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
    v_ret := null; v_n := null; v_err := null; v_state := null; v_chk := null; v_serr := null; v_oerr := null;
    begin
      perform set_config('request.jwt.claims', '', true);
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claim.role', '', true);
      begin
        if btrim(v_setup, ' ;') <> '' then execute v_setup; end if;
      exception when others then
        v_serr := sqlstate || ' ' || sqlerrm;
        raise exception using errcode = 'DRY02', message = 'setup failed';
      end;
      perform set_config('request.jwt.claims', '', true);
      if t ->> 'who' = 'postgres' then
        null;
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
      when sqlstate 'DRY01' or sqlstate 'DRY02' then null;
      when others then v_oerr := sqlstate || ' ' || sqlerrm;
    end;
    v_pass := v_serr is null and v_oerr is null
              and coalesce(case
                when v_exp = 'allow' then v_err is null and (not v_dml or v_n > 0)
                when v_exp = 'rls' then v_state = '42501' or (v_err is null and v_dml and v_n = 0)
                when v_exp like 'err:%' then strpos(v_err, substr(v_exp, 5)) > 0
                when v_exp like 'ret:%' then v_err is null and v_ret is not distinct from substr(v_exp, 5)
              end, false)
              and (v_chkq = '' or v_chk is true);
    if v_pass then n_pass := n_pass + 1; else n_fail := n_fail + 1; end if;
    results := results || format(E'\n%s %s %s: %s | expect %s | %s%s',
      case when v_pass then 'PASS' else 'FAIL' end, t ->> 'id', t ->> 'who', t ->> 'label', v_exp,
      left(case when v_serr is not null then 'SETUP ERROR ' || v_serr
                when v_oerr is not null then 'ERROR ' || v_oerr
                when v_err is not null then format('error %s: %s', v_state, v_err)
                when v_dml then v_n || ' row(s) written'
                else 'returned ' || coalesce(v_ret, 'null') end, 300),
      case when v_chkq <> '' then ' | chk ' || coalesce(v_chk::text, 'null') else '' end);
  end loop;

  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (invitation_guest_link dry run, run %s)', n_pass, n_fail, now()) || results;
end
$dryrun$;
