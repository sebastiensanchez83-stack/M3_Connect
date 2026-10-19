-- DRY RUN of supabase/migrations/down/20261017093000_invitation_adopt_request.down.sql.
-- NOT A MIGRATION. Run it AFTER step 1 is applied and BEFORE 20261017093000 is, like that
-- file's own dry run. ONE query text, ONE execute_sql call. Everything rolls back: the last
-- statement raises 'DRYRUN ...'; the result is in that error message.
-- Order: snapshot; the migration, verbatim; a pending request on a throw-away guest list
-- adopted into a campaign and recorded as sent (the service role, for a verified admin); the
-- down, verbatim, twice (a second run must be harmless); checks.
-- Expected: "4 PASS, 0 FAIL".

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- A. Snapshot (compared at the end; guest list, e-mail log and module rows aside: the run adds test rows)
create function pg_temp.dr_snap() returns table (k text, v text) language sql as $f$
  select 'gl_guest', (select md5(coalesce(string_agg(g::text, ',' order by g.id), '')) from public.gl_guest g)
  union all select 'gl_event', (select md5(coalesce(string_agg(e::text, ',' order by e.id), '')) from public.gl_event e)
  union all select 'gl_email_log', (select count(*) || '/' || coalesce(max(l.id), 0) from public.gl_email_log l)
  union all select 'sm', concat_ws('/', (select count(*) from public.sm_registration), (select count(*) from public.sm_attendee),
                                   (select count(*) from public.sm_badge), (select count(*) from public.sm_invitation))
  union all select 'policies', (select md5(string_agg(format('%s.%s.%s|%s|%s|%s|%s', pl.schemaname, pl.tablename, pl.policyname,
                                  pl.cmd, pl.roles, pl.qual, pl.with_check), ';' order by pl.schemaname, pl.tablename, pl.policyname))
                                  from pg_policies pl)
  union all select 'acls', (select md5(string_agg(p.oid::regprocedure::text || '=' || coalesce(array_to_string(p.proacl, ','), ''), ';'
                              order by p.oid::regprocedure::text))
                              from pg_proc p where p.pronamespace = 'public'::regnamespace
                               and p.proname not in ('invitation_adopt_request', 'invitation_unadopt_request', 'invitation_mark_sent', 'invitation_relink_guest'))
  union all select 'step1_bodies', (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc), ',' order by p.oid::regprocedure::text))
                              from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'invitation%'
                               and p.proname not in ('invitation_adopt_request', 'invitation_unadopt_request', 'invitation_mark_sent', 'invitation_relink_guest'))
  union all select 'pins', (select md5(string_agg(p.proname || ':' || md5(p.prosrc), ',' order by p.proname, md5(p.prosrc)))
                              from pg_proc p where p.pronamespace = 'public'::regnamespace
                               and p.proname in ('gl_checkin', 'gl_checkin_v2', 'gl_guest_engine_guard', 'gl_guest_queue_provisioning',
                                 'invoke_registration_cron', 'invoke_send_profile_reminders', 'invoke_guest_webinar_reminders',
                                 'handle_new_user', 'has_capability', 'capability_set', 'complete_signup_for', 'is_moderator', 'is_admin',
                                 'ops_health_checks', 'ops_health_report'))
  union all select 'triggers', (select md5(string_agg(t.tgrelid::regclass::text || ':' || t.tgname || ':' || t.tgenabled::text, ','
                                  order by t.tgrelid::regclass::text, t.tgname))
                                  from pg_trigger t where not t.tgisinternal)
  union all select 'tables', (select md5(string_agg(c.oid::regclass::text || ':' || c.relrowsecurity::text || ':'
                                || coalesce(array_to_string(c.relacl, ','), ''), ';' order by c.oid::regclass::text))
                                from pg_class c where c.relnamespace in ('public'::regnamespace, 'storage'::regnamespace)
                                 and c.relkind = 'r')
  union all select 'buckets', (select md5(string_agg(b::text, ',' order by b.id)) from storage.buckets b)
  union all select 'invitation', concat_ws('/', (select count(*) from public.invitation_campaign), (select count(*) from public.invitation_recipient),
                                           (select count(*) from public.invitation_log))
$f$;
create temp table _dr_before on commit drop as select * from pg_temp.dr_snap();

-- B. The migration, verbatim
-- invitation_adopt_request: step 4 (sending) of the "Invitation campaigns" admin module.
-- NOT APPLIED. Needs step 1 applied (20261017090000_invitation_campaigns and
-- 20261017091000_invitation_guest_link), with the function bodies pinned below. Apply only
-- with Victor's OK, after its dry runs: supabase/dryrun/20261017093000_invitation_adopt_request.dryrun.sql
-- and supabase/dryrun/20261017093000_invitation_adopt_request.down.dryrun.sql.
-- Down: supabase/migrations/down/20261017093000_invitation_adopt_request.down.sql.
--
-- ADDITIVE ONLY: 4 new functions, called by the new edge function invitation-campaign (the
-- sender). No step 1 function is redefined; their bodies are pinned (md5) because the sender
-- relies on what they return. No gl_* function, trigger or policy is redefined; guest-list
-- (live v6, WYS freeze until 28 Nov) is untouched.
--
-- 1. invitation_adopt_request(): Victor's decision of 16 Oct. A campaign guest whose address
--    has a PENDING /wys26 request: Victor adopts it per guest ("adopt"), never automatically.
--    The sender adopts it with the e-mail: same row, token, names, wishes, source 'request';
--    it becomes 'invited' as v6 "invite" writes it, takes a seat, journalled with what it
--    replaced.
-- 2. invitation_unadopt_request(): undoes an adoption whose e-mail never went out.
-- 3. invitation_mark_sent(): after Resend accepted the e-mail, in ONE transaction: the
--    gl_email_log 'invitation' line (the health monitor expects it within 10 minutes of the
--    link), the guest sent (first send only), lock released, journal. Service role only.
-- 4. invitation_relink_guest(): step 1's unlink (after a refused send) cancels the row and
--    keeps it, so invitation_link_guest refuses that address for good; this re-opens it.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
declare
  v_pins text[][] := array[
    array['invitation_actor', '1aad1efc0d41ef761a26e75d9db28a77'],
    array['invitation_link_guest', 'e22cf3162ca0ab8e14c202a11417b351'],
    array['invitation_unlink_guest', '516a6cddf6017e718fcb0b3efb437f4b'],
    array['invitation_set_answer', 'f0c21ae0a4a88bb1dcc211e97dab3fb1']];
  v_i integer;
  v_md5 text;
begin
  if to_regprocedure('public.invitation_actor(uuid)') is null
     or to_regprocedure('public.invitation_link_guest(uuid,boolean,boolean,uuid)') is null
     or to_regprocedure('public.invitation_unlink_guest(uuid,uuid)') is null
     or to_regprocedure('public.invitation_set_answer(uuid,text,boolean,uuid)') is null then
    raise exception 'invitation_adopt_request: apply step 1 (20261017090000 and 20261017091000) first';
  end if;
  -- The step 1 bodies this migration and the sender rely on, as committed (b85b08c3).
  -- Carriage returns are ignored, so a CRLF checkout applies the same.
  for v_i in 1 .. array_length(v_pins, 1) loop
    select md5(replace(p.prosrc, chr(13), '')) into v_md5
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = v_pins[v_i][1];
    if v_md5 is distinct from v_pins[v_i][2] then
      raise exception 'invitation_adopt_request: % is not the step 1 version this migration was written for (md5 %)',
        v_pins[v_i][1], v_md5;
    end if;
  end loop;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('invitation_adopt_request', 'invitation_unadopt_request', 'invitation_mark_sent',
                                'invitation_relink_guest')) then
    raise exception 'invitation_adopt_request: already applied';
  end if;
  if (select count(*) from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = 'gl_email_log'
         and c.column_name in ('guest_id', 'event_id', 'kind', 'to_email', 'sent_by')) <> 5
     or (select count(*) from information_schema.columns c
          where c.table_schema = 'public' and c.table_name = 'invitation_recipient'
            and c.column_name in ('sending_at', 'send_error', 'sent_at', 'gl_guest_id')) <> 4 then
    raise exception 'invitation_adopt_request: gl_email_log or invitation_recipient is not the expected shape';
  end if;
end
$pre$;

-- 1. Adopt a pending public request into the campaign. Service role only (the sender), for
-- a verified staff member (p_actor). Returns {ok, ...} or {ok:false, error}. No e-mail here.
--  - Already linked: returns that row (the sender may retry).
--  - Only a draft or ready guest, of a campaign not archived, on a guest_list_v1 event.
--  - The address must have a pending public request ('requested', source 'request', not a
--    plus-one) not linked to another campaign guest: 'no_request', 'not_pending_request'
--    (invitation_link_guest with adopt handles invited, confirmed and declined rows),
--    'guest_linked_elsewhere'.
--  - Capacity as v6 "invite": confirmed + invited + 1 must fit, unless p_force.
create function public.invitation_adopt_request(p_recipient_id uuid, p_force boolean default false,
                                                p_actor uuid default null)
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
  v_before jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'forbidden: requests are adopted by the sender only';
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

  -- The same lock as invitation_link_guest: one link at a time per event.
  perform pg_advisory_xact_lock(hashtext('invitation_link_guest'), hashtext(v_ev.id::text));

  select * into v_guest from public.gl_guest where event_id = v_ev.id and lower(email) = v_rec.email for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_request');
  end if;
  select r.id into v_other from public.invitation_recipient r where r.gl_guest_id = v_guest.id;
  if v_other is not null then
    return jsonb_build_object('ok', false, 'error', 'guest_linked_elsewhere', 'guest_id', v_guest.id,
      'other_recipient_id', v_other);
  end if;
  if v_guest.status <> 'requested' or v_guest.source <> 'request' or v_guest.plus_one_of is not null then
    return jsonb_build_object('ok', false, 'error', 'not_pending_request', 'guest_id', v_guest.id,
      'guest_status', v_guest.status, 'guest_source', v_guest.source);
  end if;
  if v_ev.capacity is not null and not p_force then
    select count(*) into v_held from public.gl_guest where event_id = v_ev.id and status in ('confirmed', 'invited');
    if v_held + 1 > v_ev.capacity then
      return jsonb_build_object('ok', false, 'error', 'capacity', 'held', v_held, 'capacity', v_ev.capacity);
    end if;
  end if;

  v_before := jsonb_build_object('conference', v_guest.conference, 'gala', v_guest.gala,
    'invited_at', v_guest.invited_at, 'decided_at', v_guest.decided_at, 'decided_by', v_guest.decided_by);
  update public.gl_guest
     set status = 'invited', conference = v_camp.conference, gala = v_camp.gala,
         invited_at = now(), decided_at = now(), decided_by = v_uid
   where id = v_guest.id and status = 'requested'
  returning * into v_guest;
  update public.invitation_recipient set gl_guest_id = v_guest.id where id = v_rec.id;
  insert into public.invitation_log (campaign_id, recipient_id, action, actor_id, payload)
  values (v_rec.campaign_id, v_rec.id, 'request_adopted', v_uid,
          jsonb_build_object('guest_id', v_guest.id, 'forced', p_force, 'before', v_before));
  return jsonb_build_object('ok', true, 'created', false, 'adopted', true, 'adopted_request', true,
    'guest_id', v_guest.id, 'guest_status', v_guest.status);
end
$f$;

-- 2. Undo an adoption whose invitation never went out: only for a draft or ready guest whose
-- link came from invitation_adopt_request ('request_adopted' in the journal for this very
-- row), still 'invited', source 'request', and with no e-mail logged for it other than the
-- request's own acknowledgement and staff notice. The row goes back to the pending request it
-- was (status, conference, gala, invited_at, decided_at, decided_by as before); its id and
-- token never changed. Staff may call it; the service role passes p_actor.
create function public.invitation_unadopt_request(p_recipient_id uuid, p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_uid uuid;
  v_rec public.invitation_recipient;
  v_guest public.gl_guest;
  v_was jsonb;
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
  select l.payload -> 'before' into v_was
    from public.invitation_log l
   where l.recipient_id = v_rec.id and l.action = 'request_adopted' and l.payload ->> 'guest_id' = v_rec.gl_guest_id::text
   order by l.id desc limit 1;
  select * into v_guest from public.gl_guest where id = v_rec.gl_guest_id for update;
  if v_was is null or v_guest.status <> 'invited' or v_guest.source <> 'request'
     or exists (select 1 from public.gl_email_log l
                 where l.guest_id = v_guest.id and l.kind not in ('request_ack', 'staff_notify')) then
    return jsonb_build_object('ok', false, 'error', 'not_undoable', 'guest_id', v_guest.id,
      'guest_status', v_guest.status, 'guest_source', v_guest.source);
  end if;
  update public.gl_guest
     set status = 'requested',
         conference = coalesce((v_was ->> 'conference')::boolean, false),
         gala = coalesce((v_was ->> 'gala')::boolean, false),
         invited_at = (v_was ->> 'invited_at')::timestamptz,
         decided_at = (v_was ->> 'decided_at')::timestamptz,
         decided_by = (v_was ->> 'decided_by')::uuid
   where id = v_guest.id
  returning * into v_guest;
  update public.invitation_recipient set gl_guest_id = null where id = v_rec.id;
  insert into public.invitation_log (campaign_id, recipient_id, action, actor_id, payload)
  values (v_rec.campaign_id, v_rec.id, 'request_unadopted', v_uid, jsonb_build_object('guest_id', v_guest.id));
  return jsonb_build_object('ok', true, 'guest_id', v_guest.id, 'guest_status', v_guest.status);
end
$f$;

-- 3. Record an invitation e-mail Resend accepted (first send or explicit re-send), in one
-- transaction: gl_email_log 'invitation' for the linked guest-list row (to the guest's
-- address, sent_by the staff member, as guest-list v6 logs), the campaign guest 'sent' when
-- it was draft or ready (an adopted guest who already answered keeps that answer), sent_at
-- set on the first send only, the send lock and error cleared, the journal line. Service
-- role only. The e-mail has gone out when this is called, so it never refuses a linked guest.
create function public.invitation_mark_sent(p_recipient_id uuid, p_actor uuid, p_resend boolean default false,
                                            p_message_id text default null)
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
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'forbidden: sends are recorded by the sender only';
  end if;
  v_uid := public.invitation_actor(p_actor);
  select * into v_rec from public.invitation_recipient where id = p_recipient_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'recipient_not_found');
  end if;
  if v_rec.gl_guest_id is null or v_rec.email is null then
    return jsonb_build_object('ok', false, 'error', 'not_linked');
  end if;
  select * into v_guest from public.gl_guest where id = v_rec.gl_guest_id;
  insert into public.gl_email_log (guest_id, event_id, kind, to_email, sent_by)
  values (v_guest.id, v_guest.event_id, 'invitation', v_rec.email, v_uid);
  update public.invitation_recipient
     set status = case when v_rec.status in ('draft', 'ready') then 'sent' else v_rec.status end,
         sent_at = coalesce(v_rec.sent_at, now()),
         sending_at = null,
         send_error = null
   where id = v_rec.id
  returning * into v_rec;
  insert into public.invitation_log (campaign_id, recipient_id, action, actor_id, payload)
  values (v_rec.campaign_id, v_rec.id, 'invitation_sent', v_uid,
          jsonb_build_object('guest_id', v_guest.id, 'resend', coalesce(p_resend, false),
                             'message_id', left(p_message_id, 100)));
  return jsonb_build_object('ok', true, 'status', v_rec.status, 'sent_at', v_rec.sent_at, 'guest_id', v_guest.id,
    'guest_status', v_guest.status);
end
$f$;

-- 4. Re-link after a refused send (the sender only): the row THIS guest unlinked (journal),
-- still 'cancelled', source 'invitation', never e-mailed, nobody else on it; capacity as
-- invitation_link_guest. Same id and token, 'invited' again with the guest's current details.
create function public.invitation_relink_guest(p_recipient_id uuid, p_force boolean default false,
                                               p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_uid uuid;
  v_rec public.invitation_recipient;
  v_camp public.invitation_campaign;
  v_guest public.gl_guest;
  v_cap integer;
  v_held integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'forbidden: guests are re-linked by the sender only';
  end if;
  v_uid := public.invitation_actor(p_actor);
  select * into v_rec from public.invitation_recipient where id = p_recipient_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'recipient_not_found');
  end if;
  if v_rec.gl_guest_id is not null or v_rec.status not in ('draft', 'ready') then
    return jsonb_build_object('ok', false, 'error', 'bad_status', 'status', v_rec.status);
  end if;
  select * into v_camp from public.invitation_campaign where id = v_rec.campaign_id;
  if v_camp.archived_at is not null then
    return jsonb_build_object('ok', false, 'error', 'campaign_archived');
  end if;
  if v_rec.email is null or v_rec.first_name is null or v_rec.last_name is null then
    return jsonb_build_object('ok', false, 'error', 'missing_name');
  end if;
  perform pg_advisory_xact_lock(hashtext('invitation_link_guest'), hashtext(v_camp.gl_event_id::text));
  select * into v_guest from public.gl_guest where event_id = v_camp.gl_event_id and lower(email) = v_rec.email for update;
  if not found or v_guest.status <> 'cancelled' or v_guest.source <> 'invitation'
     or exists (select 1 from public.invitation_recipient r where r.gl_guest_id = v_guest.id)
     or exists (select 1 from public.gl_email_log l where l.guest_id = v_guest.id)
     or not exists (select 1 from public.invitation_log l where l.recipient_id = v_rec.id and l.action = 'guest_unlinked'
                     and l.payload ->> 'guest_id' = v_guest.id::text) then
    return jsonb_build_object('ok', false, 'error', 'not_relinkable', 'guest_status', v_guest.status);
  end if;
  select e.capacity into v_cap from public.gl_event e where e.id = v_camp.gl_event_id;
  if v_cap is not null and not p_force then
    select count(*) into v_held from public.gl_guest where event_id = v_camp.gl_event_id and status in ('confirmed', 'invited');
    if v_held + 1 > v_cap then
      return jsonb_build_object('ok', false, 'error', 'capacity', 'held', v_held, 'capacity', v_cap);
    end if;
  end if;
  update public.gl_guest
     set status = 'invited', first_name = left(v_rec.first_name, 80), last_name = left(v_rec.last_name, 80),
         company = coalesce(left(v_rec.organisation, 160), ''), job_title = coalesce(left(v_rec.position, 160), ''),
         phone = coalesce(left(v_rec.phone, 40), ''), country = coalesce(left(v_rec.country, 80), ''),
         conference = v_camp.conference, gala = v_camp.gala, wants_conference = v_camp.conference,
         wants_gala = v_camp.gala, invited_at = now(), decided_at = now(), decided_by = v_uid
   where id = v_guest.id
  returning * into v_guest;
  update public.invitation_recipient set gl_guest_id = v_guest.id where id = v_rec.id;
  insert into public.invitation_log (campaign_id, recipient_id, action, actor_id, payload)
  values (v_rec.campaign_id, v_rec.id, 'guest_relinked', v_uid, jsonb_build_object('guest_id', v_guest.id, 'forced', p_force));
  return jsonb_build_object('ok', true, 'created', true, 'relinked', true, 'adopted', false, 'guest_id', v_guest.id,
    'guest_status', v_guest.status);
end
$f$;

-- 5. Privileges (the project's default grants EXECUTE to anon, authenticated and
-- service_role). Adopting, re-linking and recording a send: the sender only, so no row becomes
-- 'invited' without its e-mail. Undoing an adoption: staff too (checked inside).
revoke all on function public.invitation_adopt_request(uuid, boolean, uuid) from public, anon, authenticated;
revoke all on function public.invitation_mark_sent(uuid, uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.invitation_relink_guest(uuid, boolean, uuid) from public, anon, authenticated;
revoke all on function public.invitation_unadopt_request(uuid, uuid) from public, anon;
grant execute on function public.invitation_adopt_request(uuid, boolean, uuid) to service_role;
grant execute on function public.invitation_mark_sent(uuid, uuid, boolean, text) to service_role;
grant execute on function public.invitation_relink_guest(uuid, boolean, uuid) to service_role;
grant execute on function public.invitation_unadopt_request(uuid, uuid) to authenticated, service_role;

-- C. A pending request adopted and e-mailed (the down must leave that row and its lines)
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
         gen_random_uuid() as g1, gen_random_uuid() as tok,
         'dryrun-down-' || substr(md5(random()::text), 1, 8) || '@example.invalid' as email;
select pg_temp.dr_user(i.admin, 'admin-' || i.email, 'admin') from _dr_ids i;
insert into public.gl_event (id, slug, title, capacity) select i.ev, 'dryrun-down-' || substr(i.ev::text, 1, 8), 'Dryrun down', 3 from _dr_ids i;
insert into public.gl_guest (id, event_id, source, status, first_name, last_name, email, company, job_title, token)
  select i.g1, i.ev, 'request', 'requested', 'Down', 'Test', i.email, 'Acme', 'CEO', i.tok from _dr_ids i;
insert into public.invitation_campaign (id, gl_event_id, name) select i.c1, i.ev, 'Dryrun down' from _dr_ids i;
insert into public.invitation_recipient (id, campaign_id, first_name, last_name, name_on_ticket, email, status)
  select i.r1, i.c1, 'Down', 'Test', 'Down Test', i.email, 'ready' from _dr_ids i;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
create temp table _dr_adopt on commit drop as select public.invitation_adopt_request(i.r1, false, i.admin) as x from _dr_ids i;
create temp table _dr_sent on commit drop as select public.invitation_mark_sent(i.r1, i.admin, false, 'msg-down') as x from _dr_ids i;
select set_config('request.jwt.claims', '', true);

-- D. The down, verbatim
-- DOWN for supabase/migrations/20261017093000_invitation_adopt_request.sql
-- Drops invitation_relink_guest, invitation_mark_sent, invitation_unadopt_request and
-- invitation_adopt_request. Run it
-- before step 1's downs (20261017091000, then 20261017090000). Stop the edge function
-- invitation-campaign first: without these functions it can no longer adopt a request or
-- record a send (it then reports an error and sends nothing more).
-- Dry run: supabase/dryrun/20261017093000_invitation_adopt_request.down.dryrun.sql.
--
-- DATA: nothing is deleted or changed. Requests adopted into a campaign stay 'invited' on the
-- guest list (their invitation went out, with their token); the gl_email_log lines and the
-- journal lines stay.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop function if exists public.invitation_relink_guest(uuid, boolean, uuid);
drop function if exists public.invitation_mark_sent(uuid, uuid, boolean, text);
drop function if exists public.invitation_unadopt_request(uuid, uuid);
drop function if exists public.invitation_adopt_request(uuid, boolean, uuid);

-- E. The down again: must be harmless
-- DOWN for supabase/migrations/20261017093000_invitation_adopt_request.sql
-- Drops invitation_relink_guest, invitation_mark_sent, invitation_unadopt_request and
-- invitation_adopt_request. Run it
-- before step 1's downs (20261017091000, then 20261017090000). Stop the edge function
-- invitation-campaign first: without these functions it can no longer adopt a request or
-- record a send (it then reports an error and sends nothing more).
-- Dry run: supabase/dryrun/20261017093000_invitation_adopt_request.down.dryrun.sql.
--
-- DATA: nothing is deleted or changed. Requests adopted into a campaign stay 'invited' on the
-- guest list (their invitation went out, with their token); the gl_email_log lines and the
-- journal lines stay.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop function if exists public.invitation_relink_guest(uuid, boolean, uuid);
drop function if exists public.invitation_mark_sent(uuid, uuid, boolean, text);
drop function if exists public.invitation_unadopt_request(uuid, uuid);
drop function if exists public.invitation_adopt_request(uuid, boolean, uuid);

-- F. Checks
do $check$
declare
  n_pass integer := 0; n_fail integer := 0; results text := '';
  v_ok boolean; v_label text;
begin
  for v_label, v_ok in
    select 'D1 the 4 functions of this migration are gone',
           not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                        and p.proname in ('invitation_adopt_request', 'invitation_unadopt_request', 'invitation_mark_sent', 'invitation_relink_guest'))
    union all
    select 'D2 step 1 is untouched: its 13 functions (bodies and rights, in the snapshot), 3 tables, private bucket; the guest still linked and sent',
           (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'invitation%') = 13
           and to_regclass('public.invitation_campaign') is not null and to_regclass('public.invitation_log') is not null
           and exists (select 1 from storage.buckets b where b.id = 'invitation-files' and not b.public)
           and exists (select 1 from _dr_ids i join public.invitation_recipient r on r.id = i.r1
                        where r.gl_guest_id = i.g1 and r.status = 'sent')
    union all
    select 'D3 the adopted request stays invited (same row, same token, source request) with its invitation line and journal lines; adopt and mark returned ok',
           exists (select 1 from _dr_ids i join public.gl_guest g on g.id = i.g1
                    where g.status = 'invited' and g.source = 'request' and g.token = i.tok and g.decided_by = i.admin)
           and exists (select 1 from _dr_ids i join public.gl_email_log l on l.guest_id = i.g1 where l.kind = 'invitation')
           and (select count(*) from _dr_ids i join public.invitation_log l on l.recipient_id = i.r1
                 where l.action in ('request_adopted', 'invitation_sent')) = 2
           and (select (a.x ->> 'ok')::boolean from _dr_adopt a) and (select (s.x ->> 'ok')::boolean from _dr_sent s)
    union all
    select 'D4 everything else is as before (policies, ACLs, step 1 bodies, pins, triggers, tables, buckets, SM26)',
           not exists (((select * from _dr_before except select * from pg_temp.dr_snap())
                        union all (select * from pg_temp.dr_snap() except select * from _dr_before)) except
                       (select * from pg_temp.dr_snap() where k in ('gl_guest', 'gl_event', 'gl_email_log', 'invitation')
                        union all select * from _dr_before where k in ('gl_guest', 'gl_event', 'gl_email_log', 'invitation')))
  loop
    if coalesce(v_ok, false) then n_pass := n_pass + 1; else n_fail := n_fail + 1; end if;
    results := results || chr(10) || case when coalesce(v_ok, false) then 'PASS ' else 'FAIL ' end || v_label;
  end loop;
  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (invitation_adopt_request down dry run, run %s)', n_pass, n_fail, now()) || results;
end
$check$;
