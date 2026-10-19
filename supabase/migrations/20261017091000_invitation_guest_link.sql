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
