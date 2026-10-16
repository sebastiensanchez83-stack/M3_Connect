-- invitation_guest_link: step 1 (part 2 of 2) of the "Invitation campaigns" admin module.
-- NOT APPLIED. Needs part 1 (20261017090000_invitation_campaigns) applied. Apply only with
-- Victor's OK, after its dry run: supabase/dryrun/20261017091000_invitation_guest_link.dryrun.sql.
-- Down: supabase/migrations/down/20261017091000_invitation_guest_link.down.sql (run it before
-- part 1's down). Plan: "9 M3 Connect/Module invitations - etape 0 - plan.md" (16 Oct 2026).
--
-- ADDITIVE ONLY: 2 functions. invitation_link_guest() puts a campaign guest on the event's
-- guest list (gl_guest) exactly as the guest-list edge function's "invite" action (live v6,
-- WYS freeze until 28 Nov) does, but sends NO e-mail: the module's sender (step 4) e-mails
-- the letter and the ticket and logs gl_email_log kind 'invitation' itself, because the
-- health monitor expects that log for every invited row. invitation_set_answer() records an
-- answer received by e-mail as v6's public "rsvp" action does; the entry pass is then sent
-- by guest-list's existing staff "resend" action (for a confirmed guest it sends the pass),
-- never from SQL. Neither touches gl_guest's token, plus-one fields, user_id or admin_note.
-- No gl_* function, trigger or policy is redefined.
--
-- Callers: verified admins and moderators (public.is_moderator()), or the service role.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if to_regclass('public.invitation_recipient') is null or to_regclass('public.invitation_log') is null
     or to_regprocedure('public.invitation_find_duplicates(uuid,uuid)') is null then
    raise exception 'invitation_guest_link: apply 20261017090000_invitation_campaigns first';
  end if;
  if to_regprocedure('public.invitation_link_guest(uuid,boolean,boolean)') is not null
     or to_regprocedure('public.invitation_set_answer(uuid,text,boolean)') is not null then
    raise exception 'invitation_guest_link: already applied';
  end if;
  -- The columns written below, as guest-list v6 "invite" and "rsvp" write them.
  if (select count(*) from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = 'gl_guest'
         and c.column_name in ('first_name', 'last_name', 'email', 'company', 'job_title', 'phone', 'country', 'event_id',
                               'source', 'status', 'conference', 'gala', 'wants_conference', 'wants_gala', 'invited_at',
                               'decided_by', 'decided_at', 'responded_at', 'token', 'plus_one_of')) <> 20
     or (select count(*) from information_schema.columns c
          where c.table_schema = 'public' and c.table_name = 'gl_event' and c.column_name in ('capacity', 'engine')) <> 2 then
    raise exception 'invitation_guest_link: gl_guest / gl_event are not the shape guest-list v6 uses';
  end if;
end
$pre$;

-- 1. Put a campaign guest on the event's guest list
-- Called just before the invitation e-mail goes out (step 4), or by staff to settle a
-- duplicate. Returns {ok, ...} or {ok:false, error}. No e-mail is sent here.
--  - Already linked: returns the row (idempotent).
--  - New address: inserts the row exactly as guest-list v6 "invite" does (source
--    'invitation', status 'invited', conference/gala and wants_* from the campaign or the
--    guest, invited_at = decided_at = now, decided_by = caller, empty strings for missing
--    company/job title/phone/country, token by default). Capacity as v6: confirmed +
--    invited + 1 must fit, unless p_force.
--  - The address is already on the list: refused ('already_on_list', with its status),
--    unless p_adopt: a pending public request (source 'request') becomes 'invited' (same
--    row, same token; capacity checked); an invited, confirmed or declined row is linked
--    as it is (the guest's answer is copied); rejected, cancelled rows and pending
--    plus-one requests are not adoptable. A row already linked to another campaign guest
--    is never taken ('guest_linked_elsewhere').
create function public.invitation_link_guest(p_recipient_id uuid, p_force boolean default false, p_adopt boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_uid uuid := auth.uid();
  v_rec public.invitation_recipient;
  v_camp public.invitation_campaign;
  v_ev public.gl_event;
  v_guest public.gl_guest;
  v_other uuid;
  v_prev text;
  v_held integer;
  v_conf boolean;
  v_gala boolean;
begin
  if not (coalesce(public.is_moderator(), false) or coalesce(auth.role(), '') = 'service_role') then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  select * into v_rec from public.invitation_recipient where id = p_recipient_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'recipient_not_found');
  end if;
  if v_rec.gl_guest_id is not null then
    select * into v_guest from public.gl_guest where id = v_rec.gl_guest_id;
    return jsonb_build_object('ok', true, 'already_linked', true, 'created', false, 'adopted', false,
      'guest_id', v_guest.id, 'guest_status', v_guest.status);
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
  v_conf := coalesce(v_rec.conference, v_camp.conference);
  v_gala := coalesce(v_rec.gala, v_camp.gala);
  if not (v_conf or v_gala) then
    return jsonb_build_object('ok', false, 'error', 'no_part');
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
    v_prev := v_guest.status;
    if v_guest.status = 'requested' and v_guest.source = 'request' then
      if v_ev.capacity is not null and not p_force then
        select count(*) into v_held from public.gl_guest where event_id = v_ev.id and status in ('confirmed', 'invited');
        if v_held + 1 > v_ev.capacity then
          return jsonb_build_object('ok', false, 'error', 'capacity', 'held', v_held, 'capacity', v_ev.capacity);
        end if;
      end if;
      update public.gl_guest
         set status = 'invited', conference = v_conf, gala = v_gala, invited_at = now(), decided_at = now(), decided_by = v_uid
       where id = v_guest.id
      returning * into v_guest;
    elsif v_guest.status not in ('invited', 'confirmed', 'declined') then
      return jsonb_build_object('ok', false, 'error', 'not_adoptable', 'guest_id', v_guest.id,
        'guest_status', v_guest.status, 'guest_source', v_guest.source);
    end if;
    update public.invitation_recipient
       set gl_guest_id = v_guest.id,
           status = case v_guest.status when 'confirmed' then 'accepted' when 'declined' then 'declined' else status end,
           responded_at = case when v_guest.status in ('confirmed', 'declined')
                               then coalesce(v_guest.responded_at, v_guest.decided_at, now()) else responded_at end
     where id = v_rec.id;
    insert into public.invitation_log (campaign_id, recipient_id, action, payload)
    values (v_rec.campaign_id, v_rec.id, 'guest_adopted', jsonb_build_object('guest_id', v_guest.id,
      'previous_status', v_prev, 'guest_status', v_guest.status, 'forced', p_force));
    return jsonb_build_object('ok', true, 'created', false, 'adopted', true, 'guest_id', v_guest.id,
      'guest_status', v_guest.status, 'previous_status', v_prev);
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
            'invitation', 'invited', v_conf, v_gala, v_conf, v_gala,
            now(), v_uid, now())
    returning * into v_guest;
  exception when unique_violation then
    -- A public request for this address arrived in between.
    return jsonb_build_object('ok', false, 'error', 'already_on_list');
  end;
  update public.invitation_recipient set gl_guest_id = v_guest.id where id = v_rec.id;
  insert into public.invitation_log (campaign_id, recipient_id, action, payload)
  values (v_rec.campaign_id, v_rec.id, 'guest_created', jsonb_build_object('guest_id', v_guest.id, 'forced', p_force));
  return jsonb_build_object('ok', true, 'created', true, 'adopted', false, 'guest_id', v_guest.id,
    'guest_status', v_guest.status);
end
$f$;

-- 2. Record an answer received by e-mail
-- accepted: the guest-list row becomes 'confirmed' with responded_at, as v6's public
--   "rsvp accept" does (invited: the seat is already held; declined: a seat must be free,
--   unless p_force). The caller then sends the entry pass with guest-list "resend"
--   ('pass_needed' says whether no pass was logged yet).
-- declined: invited or confirmed becomes 'declined' with responded_at (v6 "rsvp decline").
--   A guest who was never linked is only marked declined in the campaign.
-- no_answer: campaign status only, while the row is still 'invited' (it keeps its seat).
create function public.invitation_set_answer(p_recipient_id uuid, p_answer text, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_rec public.invitation_recipient;
  v_ev public.gl_event;
  v_guest public.gl_guest;
  v_before text;
  v_held integer;
begin
  if not (coalesce(public.is_moderator(), false) or coalesce(auth.role(), '') = 'service_role') then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
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
    insert into public.invitation_log (campaign_id, recipient_id, action, payload)
    values (v_rec.campaign_id, v_rec.id, 'answer', jsonb_build_object('answer', p_answer, 'guest_id', null));
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

  insert into public.invitation_log (campaign_id, recipient_id, action, payload)
  values (v_rec.campaign_id, v_rec.id, 'answer', jsonb_build_object('answer', p_answer, 'guest_id', v_guest.id,
    'guest_before', v_before, 'guest_after', v_guest.status, 'forced', p_force));
  return jsonb_build_object('ok', true, 'guest_id', v_guest.id, 'guest_status', v_guest.status,
    'changed', v_before is distinct from v_guest.status,
    'pass_needed', v_guest.status = 'confirmed'
      and not exists (select 1 from public.gl_email_log l where l.guest_id = v_guest.id and l.kind = 'pass'));
end
$f$;

-- 3. Function privileges
revoke all on function public.invitation_link_guest(uuid, boolean, boolean) from public, anon;
revoke all on function public.invitation_set_answer(uuid, text, boolean) from public, anon;
grant execute on function public.invitation_link_guest(uuid, boolean, boolean) to authenticated, service_role;
grant execute on function public.invitation_set_answer(uuid, text, boolean) to authenticated, service_role;
