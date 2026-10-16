-- DRY RUN of supabase/migrations/20261017093000_invitation_adopt_request.sql. NOT A MIGRATION.
-- Run it AFTER step 1 (20261017090000 and 20261017091000) is applied and BEFORE this file is.
-- ONE query text, ONE execute_sql call. Everything rolls back: the last statement raises
-- 'DRYRUN ...'; the result is in that error message.
-- A. a snapshot of what must not change; B. the migration, verbatim (its precondition checks
-- the md5 of the 4 step 1 bodies it relies on); C. test helpers; D. cases as a visitor
-- (anon), a verified member, a verified moderator, a verified admin and the service role (the
-- sender, acting for a staff member), each in its own rolled-back sub-transaction, on a
-- throw-away guest-list event (capacity 3) created inside the run: the real wys26 list and
-- its 11 pending requests are not touched. No e-mail is sent (nothing is sent from SQL).
-- Expected: "44 PASS, 0 FAIL".

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
                                  from pg_policies pl)
  union all select 'acls', (select md5(string_agg(p.oid::regprocedure::text || '=' || coalesce(array_to_string(p.proacl, ','), ''), ';'
                              order by p.oid::regprocedure::text))
                              from pg_proc p where p.pronamespace = 'public'::regnamespace
                               and p.proname not in ('invitation_adopt_request', 'invitation_unadopt_request', 'invitation_mark_sent'))
  union all select 'step1_bodies', (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc), ',' order by p.oid::regprocedure::text))
                              from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'invitation%'
                               and p.proname not in ('invitation_adopt_request', 'invitation_unadopt_request', 'invitation_mark_sent'))
  union all select 'pins', (select md5(string_agg(p.proname || ':' || md5(p.prosrc), ',' order by p.proname, md5(p.prosrc)))
                              from pg_proc p where p.pronamespace = 'public'::regnamespace
                               and p.proname in ('gl_checkin', 'gl_checkin_v2', 'gl_guest_engine_guard', 'gl_guest_queue_provisioning',
                                 'invoke_registration_cron', 'invoke_send_profile_reminders', 'invoke_guest_webinar_reminders',
                                 'handle_new_user', 'has_capability', 'capability_set', 'complete_signup_for', 'is_moderator', 'is_admin',
                                 'ops_health_checks', 'ops_health_report'))
  union all select 'triggers', (select md5(string_agg(t.tgrelid::regclass::text || ':' || t.tgname || ':' || t.tgenabled, ','
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

-- B. The migration, verbatim ───────────────────────────────────────────────────
-- invitation_adopt_request: step 4 (sending) of the "Invitation campaigns" admin module.
-- NOT APPLIED. Needs step 1 applied (20261017090000_invitation_campaigns and
-- 20261017091000_invitation_guest_link), with the function bodies pinned below. Apply only
-- with Victor's OK, after its dry runs: supabase/dryrun/20261017093000_invitation_adopt_request.dryrun.sql
-- and supabase/dryrun/20261017093000_invitation_adopt_request.down.dryrun.sql.
-- Down: supabase/migrations/down/20261017093000_invitation_adopt_request.down.sql.
--
-- ADDITIVE ONLY: 3 new functions, called by the new edge function invitation-campaign (the
-- sender). No step 1 function is redefined; their bodies are pinned (md5) because the sender
-- relies on what they return. No gl_* function, trigger or policy is redefined; guest-list
-- (live v6, WYS freeze until 28 Nov) is untouched.
--
-- 1. invitation_adopt_request(): Victor's decision of 16 Oct (plan question 10). When a
--    campaign guest's address already has a PENDING public request on the event's guest list
--    (/wys26), Victor chooses per guest: adopt that request into the campaign, or leave it
--    to "WYS 2026". Adopting is never automatic: only the sender calls this, for a guest
--    staff listed explicitly ("adopt"), in the same action as the invitation e-mail. The
--    request row KEEPS its id, token (same QR, same /wys26/guest page), names, wishes and
--    source 'request'; it becomes 'invited' as guest-list v6 "invite" writes an invitation
--    (conference/gala from the campaign, invited_at = decided_at = now, decided_by = the
--    staff member). It takes a seat (capacity as v6, unless forced). Journalled
--    'request_adopted' with the values it replaced.
-- 2. invitation_unadopt_request(): undoes an adoption whose invitation e-mail never went out
--    (failed send): the row goes back to the pending request it was, exactly.
-- 3. invitation_mark_sent(): after Resend accepted the e-mail, in ONE transaction: the
--    gl_email_log line of kind 'invitation' (the health monitor expects it within 10 minutes
--    of the link), the campaign guest marked sent (first send only; a re-send keeps it), the
--    send lock released, the journal line. Service role only.

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
              and p.proname in ('invitation_adopt_request', 'invitation_unadopt_request', 'invitation_mark_sent')) then
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

-- 4. Privileges (the project's default grants EXECUTE to anon, authenticated and
-- service_role). Adopting and recording a send: the sender only, so no request becomes
-- 'invited' without its e-mail. Undoing an adoption: staff too (checked inside).
revoke all on function public.invitation_adopt_request(uuid, boolean, uuid) from public, anon, authenticated;
revoke all on function public.invitation_mark_sent(uuid, uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.invitation_unadopt_request(uuid, uuid) from public, anon;
grant execute on function public.invitation_adopt_request(uuid, boolean, uuid) to service_role;
grant execute on function public.invitation_mark_sent(uuid, uuid, boolean, text) to service_role;
grant execute on function public.invitation_unadopt_request(uuid, uuid) to authenticated, service_role;

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
  ad text := 'select pg_temp.dr_svc(); select public.invitation_adopt_request({r2}, false, {admin});';
  seats text := 'insert into public.gl_guest (event_id, source, status, first_name, last_name, email) select {ev}::uuid, ''invitation'', ''invited'', ''Seat'', ''No '' || n, ''dryrun-seat-'' || n || ''-'' || {r8} || ''@example.invalid'' from generate_series(1, 3) n;';
begin
  vars := jsonb_build_object('admin', gen_random_uuid(), 'moder', gen_random_uuid(), 'member', gen_random_uuid(),
    'ev', gen_random_uuid(), 'c1', gen_random_uuid(), 'c2', gen_random_uuid(),
    'r1', gen_random_uuid(), 'r2', gen_random_uuid(), 'r3', gen_random_uuid(), 'r4', gen_random_uuid(), 'r5', gen_random_uuid(),
    'g_req', gen_random_uuid(), 'g_rej', gen_random_uuid(), 'tok', gen_random_uuid(),
    'e_admin', 'dryrun-admin-' || r8 || '@example.invalid', 'e_moder', 'dryrun-moder-' || r8 || '@example.invalid',
    'e_member', 'dryrun-member-' || r8 || '@example.invalid', 'e_r1', 'dryrun-leo-' || r8 || '@example.invalid',
    'e_req', 'dryrun-ines-' || r8 || '@example.invalid', 'e_rej', 'dryrun-rex-' || r8 || '@example.invalid',
    'e_staff', 'dryrun-staff-' || r8 || '@example.invalid', 'r8', r8);
  -- Shared setup (as the owner): 3 users; a throw-away guest-list event, capacity 3, with a
  -- pending public request (g_req: conference only wished, its acknowledgement and staff
  -- notice logged, as guest-list v6 does) and a refused one (g_rej); campaign c1: r1 new
  -- address, r2 = g_req's address (upper case), r3 no address, r4 = g_rej's address;
  -- campaign c2: r5 = g_req's address again. lk / ad (in a setup): the sender links r1 /
  -- adopts r2's request, for the admin.
  s0 := $s$select pg_temp.dr_user({admin}, {e_admin}, 'admin');
select pg_temp.dr_user({moder}, {e_moder}, 'moderator');
select pg_temp.dr_user({member}, {e_member}, 'marina');
insert into public.gl_event (id, slug, title, capacity) values ({ev}, 'dryrun-adopt-' || {r8}, 'Dryrun adopt', 3);
insert into public.gl_guest (id, event_id, source, status, first_name, last_name, email, company, job_title, motivation,
                             wants_conference, wants_gala, token) values
  ({g_req}, {ev}, 'request', 'requested', 'Ines', 'Dryrun', {e_req}, 'Acme SA', 'CEO', 'Interested', true, false, {tok}),
  ({g_rej}, {ev}, 'request', 'rejected', 'Rex', 'Jected', {e_rej}, 'Rex Ltd', 'Owner', null, true, true, gen_random_uuid());
insert into public.gl_email_log (guest_id, event_id, kind, to_email) values
  ({g_req}, {ev}, 'request_ack', {e_req}), ({g_req}, {ev}, 'staff_notify', {e_staff});
insert into public.invitation_campaign (id, gl_event_id, name) values ({c1}, {ev}, 'Dryrun C1'), ({c2}, {ev}, 'Dryrun C2');
insert into public.invitation_recipient (id, campaign_id, first_name, last_name, name_on_ticket, email, status) values
  ({r1}, {c1}, 'Leo', 'Sample', 'Mr Leo Sample', {e_r1}, 'ready'),
  ({r2}, {c1}, 'Ines', 'Dryrun', 'Dr Ines Dryrun', upper({e_req}), 'ready'),
  ({r3}, {c1}, 'No', 'Mail', 'No Mail', null, 'draft'),
  ({r4}, {c1}, 'Rex', 'Jected', 'Rex Jected', {e_rej}, 'ready'),
  ({r5}, {c2}, 'Ines', 'Twin', 'Ines Twin', {e_req}, 'ready')$s$;

  tests := jsonb_build_array(
    jsonb_build_object('id', 'S01', 'who', 'postgres', 'bare', true, 'expect', 'ret:0',
      'label', 'nothing else changed: guest list, e-mail log, campaigns, SM26 counts, policies, function ACLs, step 1 bodies, ops_health pins, triggers, tables, buckets',
      'q', $q$select count(*)::text from ((select * from _dr_before except select * from pg_temp.dr_snap())
               union all (select * from pg_temp.dr_snap() except select * from _dr_before)) d$q$),
    jsonb_build_object('id', 'S02', 'who', 'postgres', 'bare', true, 'expect', 'ret:false/false/true/false/true/true/false',
      'label', 'EXECUTE: adopting and recording a send for the sender (service role) only; undoing an adoption for signed-in callers too (staff checked inside); nothing for visitors',
      'q', $q$select concat_ws('/', has_function_privilege('anon', 'public.invitation_adopt_request(uuid,boolean,uuid)', 'execute')::text,
               has_function_privilege('authenticated', 'public.invitation_adopt_request(uuid,boolean,uuid)', 'execute')::text,
               has_function_privilege('service_role', 'public.invitation_adopt_request(uuid,boolean,uuid)', 'execute')::text,
               has_function_privilege('authenticated', 'public.invitation_mark_sent(uuid,uuid,boolean,text)', 'execute')::text,
               has_function_privilege('service_role', 'public.invitation_mark_sent(uuid,uuid,boolean,text)', 'execute')::text,
               has_function_privilege('authenticated', 'public.invitation_unadopt_request(uuid,uuid)', 'execute')::text,
               has_function_privilege('anon', 'public.invitation_unadopt_request(uuid,uuid)', 'execute')::text)$q$),
    -- Adopting a pending request (the sender, for a staff member who chose it for this guest)
    jsonb_build_object('id', 'R01', 'who', 'anon', 'expect', 'rls', 'label', 'a visitor cannot adopt a request',
      'q', $q$select public.invitation_adopt_request({r2})::text$q$),
    jsonb_build_object('id', 'R02', 'who', 'admin', 'expect', 'rls',
      'label', 'nor can an admin from the browser: only the sender adopts, with the e-mail',
      'q', $q$select public.invitation_adopt_request({r2}, false, {admin})::text$q$,
      'chk', $c$select (select g.status from public.gl_guest g where g.id = {g_req}) = 'requested'$c$),
    jsonb_build_object('id', 'R03', 'who', 'service', 'expect', 'rls', 'label', 'the service role cannot adopt without naming the staff member',
      'q', $q$select public.invitation_adopt_request({r2})::text$q$,
      'chk', $c$select (select g.status from public.gl_guest g where g.id = {g_req}) = 'requested'$c$),
    jsonb_build_object('id', 'R04', 'who', 'service', 'expect', 'rls', 'label', 'nor for someone who is not verified staff',
      'q', $q$select public.invitation_adopt_request({r2}, false, {member})::text$q$,
      'chk', $c$select (select g.status from public.gl_guest g where g.id = {g_req}) = 'requested'$c$),
    jsonb_build_object('id', 'R05', 'who', 'service', 'expect', 'ret:false/pending_request',
      'label', 'step 1 unchanged: invitation_link_guest still refuses a pending request, even with adopt (the sender then calls invitation_adopt_request)',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_link_guest({r2}, false, true, {admin}) as x) s$q$),
    jsonb_build_object('id', 'R06', 'who', 'service', 'expect', 'ret:true/true/invited',
      'label', 'adopted: the SAME row and token become invited (campaign access, decided_by the admin), names, wishes and source kept, nothing e-mailed, journalled with the values replaced',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'adopted_request', x ->> 'guest_status')
               from (select public.invitation_adopt_request({r2}, false, {admin}) as x) s$q$,
      'chk', $c$select exists (select 1 from public.gl_guest g join public.invitation_recipient r on r.gl_guest_id = g.id
               where r.id = {r2} and r.status = 'ready' and g.id = {g_req} and g.token = {tok} and g.status = 'invited'
                 and g.source = 'request' and g.first_name = 'Ines' and g.last_name = 'Dryrun' and g.email = {e_req}
                 and g.company = 'Acme SA' and g.job_title = 'CEO' and g.motivation = 'Interested'
                 and g.wants_conference and not g.wants_gala and g.conference and g.gala
                 and g.invited_at is not null and g.decided_at = g.invited_at and g.decided_by = {admin}
                 and g.responded_at is null and g.plus_one_of is null)
             and (select count(*) from public.gl_email_log l where l.guest_id = {g_req}) = 2
             and exists (select 1 from public.invitation_log l where l.recipient_id = {r2} and l.action = 'request_adopted'
               and l.actor_id = {admin} and l.payload ->> 'guest_id' = {g_req} and l.payload -> 'before' ->> 'conference' = 'false'
               and l.payload -> 'before' ->> 'decided_by' is null and l.payload ->> 'forced' = 'false')
             and exists (select 1 from public.invitation_log l where l.recipient_id = {r2} and l.action = 'guest_link_changed'
               and l.actor_id = {admin})$c$),
    jsonb_build_object('id', 'R07', 'who', 'service', 'expect', 'ret:true/true',
      'label', 'after adoption, the sender''s link call returns that row (retry path)',
      'setup', '<ad>',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'already_linked') from (select public.invitation_link_guest({r2}, false, true, {admin}) as x) s$q$),
    jsonb_build_object('id', 'R08', 'who', 'service', 'expect', 'ret:true/true/invited', 'label', 'adopting twice returns the same row',
      'setup', '<ad>',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'already_linked', x ->> 'guest_status')
               from (select public.invitation_adopt_request({r2}, false, {admin}) as x) s$q$,
      'chk', $c$select (select count(*) from public.invitation_log l where l.recipient_id = {r2} and l.action = 'request_adopted') = 1$c$),
    jsonb_build_object('id', 'R09', 'who', 'service', 'expect', 'ret:false/capacity',
      'label', 'an adopted request takes a seat: confirmed + invited + 1 must fit',
      'setup', '<seats>',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_adopt_request({r2}, false, {admin}) as x) s$q$,
      'chk', $c$select (select g.status from public.gl_guest g where g.id = {g_req}) = 'requested'
             and (select r.gl_guest_id from public.invitation_recipient r where r.id = {r2}) is null$c$),
    jsonb_build_object('id', 'R10', 'who', 'service', 'expect', 'ret:true/invited', 'label', 'unless forced (journalled as forced)',
      'setup', '<seats>',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'guest_status') from (select public.invitation_adopt_request({r2}, true, {admin}) as x) s$q$,
      'chk', $c$select exists (select 1 from public.invitation_log l where l.recipient_id = {r2} and l.action = 'request_adopted'
               and l.payload ->> 'forced' = 'true')$c$),
    jsonb_build_object('id', 'R11', 'who', 'service', 'expect', 'ret:false/not_pending_request/rejected', 'label', 'a refused request is not adopted',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error', x ->> 'guest_status') from (select public.invitation_adopt_request({r4}, false, {admin}) as x) s$q$,
      'chk', $c$select (select g.status from public.gl_guest g where g.id = {g_rej}) = 'rejected'$c$),
    jsonb_build_object('id', 'R12', 'who', 'service', 'expect', 'ret:false/not_pending_request/confirmed',
      'label', 'a request approved meanwhile in WYS 2026 is not adopted here (invitation_link_guest with adopt links it as it is)',
      'setup', $s$update public.gl_guest set status = 'confirmed', conference = true, decided_at = now() where id = {g_req}$s$,
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error', x ->> 'guest_status') from (select public.invitation_adopt_request({r2}, false, {admin}) as x) s$q$),
    jsonb_build_object('id', 'R13', 'who', 'service', 'expect', 'ret:false/not_pending_request', 'label', 'a plus-one request is not adopted',
      'setup', $s$update public.gl_guest set source = 'plus_one', plus_one_of = {g_rej} where id = {g_req}$s$,
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_adopt_request({r2}, false, {admin}) as x) s$q$),
    jsonb_build_object('id', 'R14', 'who', 'service', 'expect', 'ret:false/no_request', 'label', 'an address with no row on the list: nothing to adopt',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_adopt_request({r1}, false, {admin}) as x) s$q$,
      'chk', $c$select not exists (select 1 from public.gl_guest g where g.event_id = {ev} and g.email = {e_r1})$c$),
    jsonb_build_object('id', 'R15', 'who', 'service', 'expect', 'ret:false/no_email', 'label', 'no address, nothing to adopt',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_adopt_request({r3}, false, {admin}) as x) s$q$),
    jsonb_build_object('id', 'R16', 'who', 'service', 'expect', 'ret:false/guest_linked_elsewhere',
      'label', 'one request answers one invitation: the same address in another campaign is refused',
      'setup', '<ad>',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_adopt_request({r5}, false, {admin}) as x) s$q$),
    jsonb_build_object('id', 'R17', 'who', 'service', 'expect', 'ret:false/bad_status', 'label', 'a guest marked declined is not adopted',
      'setup', $s$select pg_temp.dr_as({admin}); select public.invitation_set_answer({r2}, 'declined')$s$,
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_adopt_request({r2}, false, {admin}) as x) s$q$,
      'chk', $c$select (select g.status from public.gl_guest g where g.id = {g_req}) = 'requested'$c$),
    jsonb_build_object('id', 'R18', 'who', 'service', 'expect', 'ret:false/campaign_archived', 'label', 'an archived campaign adopts nobody',
      'setup', $s$update public.invitation_campaign set archived_at = now() where id = {c1}$s$,
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_adopt_request({r2}, false, {admin}) as x) s$q$),
    jsonb_build_object('id', 'R19', 'who', 'service', 'expect', 'ret:true/invited', 'label', 'adopted for a moderator: decided_by is the moderator',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'guest_status') from (select public.invitation_adopt_request({r2}, false, {moder}) as x) s$q$,
      'chk', $c$select (select g.decided_by from public.gl_guest g where g.id = {g_req}) = {moder}::uuid$c$),
    -- Undoing an adoption whose invitation never went out (failed send)
    jsonb_build_object('id', 'N01', 'who', 'member', 'expect', 'rls', 'label', 'a verified member cannot undo an adoption',
      'setup', '<ad>',
      'q', $q$select public.invitation_unadopt_request({r2})::text$q$,
      'chk', $c$select (select g.status from public.gl_guest g where g.id = {g_req}) = 'invited'$c$),
    jsonb_build_object('id', 'N02', 'who', 'admin', 'expect', 'ret:true/requested',
      'label', 'an admin undoes it: the row is exactly the pending request it was (every column but updated_at), unlinked, journalled',
      'setup', 'create temp table _dr_n02 on commit drop as select to_jsonb(g) - ''updated_at'' as j from public.gl_guest g where g.id = {g_req}; <ad>',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'guest_status') from (select public.invitation_unadopt_request({r2}) as x) s$q$,
      'chk', $c$select (select to_jsonb(g) - 'updated_at' from public.gl_guest g where g.id = {g_req}) = (select n.j from _dr_n02 n)
             and exists (select 1 from public.invitation_recipient r where r.id = {r2} and r.gl_guest_id is null and r.status = 'ready')
             and exists (select 1 from public.invitation_log l where l.recipient_id = {r2} and l.action = 'request_unadopted'
               and l.actor_id = {admin})$c$),
    jsonb_build_object('id', 'N03', 'who', 'service', 'expect', 'ret:true/requested', 'label', 'the sender undoes it for a moderator',
      'setup', '<ad>',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'guest_status') from (select public.invitation_unadopt_request({r2}, {moder}) as x) s$q$),
    jsonb_build_object('id', 'N04', 'who', 'admin', 'expect', 'ret:false/not_undoable', 'label', 'no undo once an invitation e-mail is logged for the row',
      'setup', '<ad> insert into public.gl_email_log (guest_id, event_id, kind, to_email) values ({g_req}, {ev}, ''invitation'', {e_req});',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_unadopt_request({r2}) as x) s$q$,
      'chk', $c$select (select g.status from public.gl_guest g where g.id = {g_req}) = 'invited'$c$),
    jsonb_build_object('id', 'N05', 'who', 'admin', 'expect', 'ret:false/not_undoable', 'label', 'not for a row the module created (that is invitation_unlink_guest)',
      'setup', '<lk>',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_unadopt_request({r1}) as x) s$q$,
      'chk', $c$select exists (select 1 from public.gl_guest g join public.invitation_recipient r on r.gl_guest_id = g.id
               where r.id = {r1} and g.status = 'invited')$c$),
    jsonb_build_object('id', 'N06', 'who', 'admin', 'expect', 'ret:false/not_undoable',
      'label', 'step 1 invitation_unlink_guest never cancels an adopted request',
      'setup', '<ad>',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_unlink_guest({r2}) as x) s$q$,
      'chk', $c$select (select g.status from public.gl_guest g where g.id = {g_req}) = 'invited'$c$),
    jsonb_build_object('id', 'N07', 'who', 'service', 'expect', 'ret:true/invited', 'label', 'after an undo the request can be adopted again',
      'setup', '<ad> select pg_temp.dr_as({admin}); select public.invitation_unadopt_request({r2});',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'guest_status') from (select public.invitation_adopt_request({r2}, false, {admin}) as x) s$q$),
    jsonb_build_object('id', 'N08', 'who', 'admin', 'expect', 'ret:false/not_linked', 'label', 'nothing to undo on a guest never linked',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_unadopt_request({r1}) as x) s$q$),
    jsonb_build_object('id', 'N09', 'who', 'admin', 'expect', 'ret:false/bad_status', 'label', 'nor once the guest is marked sent',
      'setup', '<ad> select pg_temp.dr_svc(); select public.invitation_mark_sent({r2}, {admin});',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_unadopt_request({r2}) as x) s$q$),
    -- Recording a send Resend accepted (one transaction: e-mail log, status, lock, journal)
    jsonb_build_object('id', 'M01', 'who', 'admin', 'expect', 'rls', 'label', 'an admin cannot record a send from the browser',
      'setup', '<lk>',
      'q', $q$select public.invitation_mark_sent({r1}, {admin})::text$q$,
      'chk', $c$select not exists (select 1 from public.gl_email_log l where l.event_id = {ev} and l.kind = 'invitation')$c$),
    jsonb_build_object('id', 'M02', 'who', 'service', 'expect', 'rls', 'label', 'the service role names a staff member',
      'setup', '<lk>',
      'q', $q$select public.invitation_mark_sent({r1}, null)::text$q$,
      'chk', $c$select not exists (select 1 from public.gl_email_log l where l.event_id = {ev} and l.kind = 'invitation')$c$),
    jsonb_build_object('id', 'M03', 'who', 'service', 'expect', 'ret:true/sent',
      'label', 'first send: gl_email_log invitation (what the health monitor reads), guest sent, lock and error cleared, journalled for the admin',
      'setup', '<lk> update public.invitation_recipient set sending_at = now(), send_error = ''resend_500'' where id = {r1};',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'status') from (select public.invitation_mark_sent({r1}, {admin}, false, 'msg-1') as x) s$q$,
      'chk', $c$select exists (select 1 from public.gl_email_log l join public.invitation_recipient r on r.gl_guest_id = l.guest_id
               where r.id = {r1} and l.kind = 'invitation' and l.event_id = {ev} and l.to_email = {e_r1} and l.sent_by = {admin})
             and (select count(*) from public.gl_email_log l where l.event_id = {ev} and l.kind = 'invitation') = 1
             and exists (select 1 from public.invitation_recipient r where r.id = {r1} and r.status = 'sent' and r.sent_at is not null
               and r.sending_at is null and r.send_error is null)
             and exists (select 1 from public.invitation_log l where l.recipient_id = {r1} and l.action = 'invitation_sent'
               and l.actor_id = {admin} and l.payload ->> 'message_id' = 'msg-1' and l.payload ->> 'resend' = 'false')
             and exists (select 1 from public.invitation_log l where l.recipient_id = {r1} and l.action = 'status_changed'
               and l.payload ->> 'to' = 'sent' and l.actor_id = {admin})$c$),
    jsonb_build_object('id', 'M04', 'who', 'service', 'expect', 'ret:true/sent',
      'label', 'an explicit re-send logs a second line and keeps the first sent_at',
      'setup', '<lk> select public.invitation_mark_sent({r1}, {admin});
               update public.invitation_recipient set sent_at = now() - interval ''1 day'' where id = {r1};',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'status') from (select public.invitation_mark_sent({r1}, {admin}, true) as x) s$q$,
      'chk', $c$select (select count(*) from public.gl_email_log l where l.event_id = {ev} and l.kind = 'invitation') = 2
             and (select r.sent_at from public.invitation_recipient r where r.id = {r1}) < now() - interval '1 hour'
             and exists (select 1 from public.invitation_log l where l.recipient_id = {r1} and l.action = 'invitation_sent'
               and l.payload ->> 'resend' = 'true')$c$),
    jsonb_build_object('id', 'M05', 'who', 'service', 'expect', 'ret:true/sent',
      'label', 'an adopted request, once e-mailed, has its invitation line (the monitor is satisfied)',
      'setup', '<ad>',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'status') from (select public.invitation_mark_sent({r2}, {admin}) as x) s$q$,
      'chk', $c$select exists (select 1 from public.gl_email_log l where l.guest_id = {g_req} and l.kind = 'invitation'
               and l.to_email = {e_req})$c$),
    jsonb_build_object('id', 'M06', 'who', 'service', 'expect', 'ret:true/accepted',
      'label', 'an adopted guest who had already accepted keeps accepted',
      'setup', $s$update public.gl_guest set status = 'confirmed', conference = true, decided_at = now() where id = {g_req};
               select pg_temp.dr_svc(); select public.invitation_link_guest({r2}, false, true, {admin})$s$,
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'status') from (select public.invitation_mark_sent({r2}, {admin}) as x) s$q$),
    jsonb_build_object('id', 'M07', 'who', 'service', 'expect', 'ret:false/not_linked', 'label', 'a guest not linked is not recorded as sent',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_mark_sent({r1}, {admin}) as x) s$q$,
      'chk', $c$select not exists (select 1 from public.gl_email_log l where l.event_id = {ev} and l.kind = 'invitation')
             and (select r.status from public.invitation_recipient r where r.id = {r1}) = 'ready'$c$),
    -- What the sender writes directly (service role): its double-click lock and failure journal
    jsonb_build_object('id', 'L01', 'who', 'service', 'expect', 'allow', 'label', 'the sender takes its send lock on a ready guest',
      'q', $q$update public.invitation_recipient set sending_at = now(), send_error = null
               where id = {r1} and status in ('draft', 'ready') and sending_at is null$q$),
    jsonb_build_object('id', 'L02', 'who', 'service', 'expect', 'rls', 'label', 'a second click while it runs gets no row (0 rows written)',
      'setup', $s$update public.invitation_recipient set sending_at = now() where id = {r1}$s$,
      'q', $q$update public.invitation_recipient set sending_at = now(), send_error = null
               where id = {r1} and status in ('draft', 'ready') and sending_at is null$q$),
    jsonb_build_object('id', 'L03', 'who', 'service', 'expect', 'rls', 'label', 'a guest already sent is never claimed by a plain send (0 rows written)',
      'setup', '<lk> select public.invitation_mark_sent({r1}, {admin});',
      'q', $q$update public.invitation_recipient set sending_at = now(), send_error = null
               where id = {r1} and status in ('draft', 'ready') and sending_at is null$q$),
    jsonb_build_object('id', 'L04', 'who', 'service', 'expect', 'allow', 'label', 'the sender releases the lock with the error and journals the failure',
      'setup', $s$update public.invitation_recipient set sending_at = now() where id = {r1}$s$,
      'q', $q$insert into public.invitation_log (campaign_id, recipient_id, action, actor_id, payload)
               select {c1}::uuid, {r1}::uuid, 'send_failed', {admin}::uuid, jsonb_build_object('error', 'resend_422')
                 from public.invitation_recipient r where r.id = {r1}$q$,
      'chk', $c$select exists (select 1 from public.invitation_log l where l.recipient_id = {r1} and l.action = 'send_failed')$c$),
    jsonb_build_object('id', 'L05', 'who', 'admin', 'expect', 'err:invitation_recipient', 'label', 'staff still cannot mark a guest sent by hand',
      'q', $q$update public.invitation_recipient set status = 'sent' where id = {r1}$q$),
    -- Answers recorded on an adopted request (step 1 function, unchanged)
    jsonb_build_object('id', 'A01', 'who', 'admin', 'expect', 'ret:true/confirmed/true',
      'label', 'an adopted request accepts like any invitation: confirmed, same token, the pass still to send through guest-list resend',
      'setup', '<ad> select public.invitation_mark_sent({r2}, {admin});',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'guest_status', x ->> 'pass_needed') from (select public.invitation_set_answer({r2}, 'accepted') as x) s$q$,
      'chk', $c$select exists (select 1 from public.gl_guest g where g.id = {g_req} and g.status = 'confirmed' and g.token = {tok})
             and exists (select 1 from public.invitation_recipient r where r.id = {r2} and r.status = 'accepted')$c$),
    jsonb_build_object('id', 'A02', 'who', 'admin', 'expect', 'ret:true/declined',
      'label', 'or declines: the seat is freed',
      'setup', '<ad> select public.invitation_mark_sent({r2}, {admin});',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'guest_status') from (select public.invitation_set_answer({r2}, 'declined') as x) s$q$)
  );
  tests := replace(replace(replace(tests::text, '<lk>', lk), '<ad>', ad), '<seats>', seats)::jsonb;

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

  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (invitation_adopt_request dry run, run %s)', n_pass, n_fail, now()) || results;
end
$dryrun$;
