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
