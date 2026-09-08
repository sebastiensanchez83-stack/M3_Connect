-- Applied to the remote project via the Supabase MCP; kept here for traceability.
--
-- Changing your workshop without falling between two chairs.
--
-- `sm_book_workshop` refuses a second workshop on a day you already hold one:
-- the unique key is (user_id, event_id, day_date), so one row per person per
-- day, booked or waitlisted. Changing your mind therefore meant cancel, then
-- book — and cancelling promotes whoever is first on that waitlist the instant
-- the seat is freed. Two clicks with a gap in the middle where the seat you had
-- is gone and the seat you want may have filled.
--
-- So the move is one statement. It refuses outright if the target is full,
-- because giving up a confirmed seat for a waitlist place is never what someone
-- pressing "switch" meant; they can cancel deliberately if that is what they
-- want. The seat left behind is passed to the top of its waitlist exactly as
-- `sm_cancel_workshop` does — the person waiting should not lose their turn
-- because the seat was vacated by a switch rather than a cancellation.

create or replace function public.sm_switch_workshop(p_session_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_event uuid; v_cap int; v_type text; v_day date; v_title text;
  v_booked int; v_from uuid; v_from_status text; v_from_title text; v_promote uuid;
begin
  if v_uid is null then raise exception 'authentication required'; end if;

  select event_id, capacity, type, date(starts_at), title
    into v_event, v_cap, v_type, v_day, v_title
    from sm_session where id = p_session_id;
  if v_event is null then raise exception 'session not found'; end if;
  if v_type <> 'workshop' then raise exception 'not a workshop'; end if;

  select session_id, status into v_from, v_from_status
    from sm_workshop_booking
   where user_id = v_uid and event_id = v_event and day_date = v_day;
  if v_from is null then raise exception 'NO_BOOKING: nothing booked that day'; end if;
  if v_from = p_session_id then return 'already_booked'; end if;

  -- Both rooms, locked in id order. Two people switching in opposite
  -- directions at the same moment would otherwise be able to deadlock.
  perform id from sm_session where id in (p_session_id, v_from) order by id for update;

  select count(*) into v_booked from sm_workshop_booking
    where session_id = p_session_id and status = 'booked';
  if v_cap is not null and v_booked >= v_cap then
    select title into v_from_title from sm_session where id = v_from;
    raise exception 'FULL: % is full, so you have been left in %.', v_title, v_from_title;
  end if;

  delete from sm_workshop_booking where session_id = v_from and user_id = v_uid;

  -- Only a confirmed seat frees a seat; leaving a waitlist frees nothing.
  if v_from_status = 'booked' then
    select user_id into v_promote from sm_workshop_booking
      where session_id = v_from and status = 'waitlisted'
      order by waitlist_pos asc limit 1;
    if v_promote is not null then
      select title into v_from_title from sm_session where id = v_from;
      update sm_workshop_booking set status = 'booked', waitlist_pos = null
        where session_id = v_from and user_id = v_promote;
      insert into sm_notification (user_id, type, title, body, link)
        values (v_promote, 'sm26_workshop_promoted', 'A workshop seat opened up',
                'You''ve been moved off the waitlist into ' || v_from_title || '.', '/sm26/me');
    end if;
  end if;

  insert into sm_workshop_booking (event_id, session_id, user_id, day_date, status)
    values (v_event, p_session_id, v_uid, v_day, 'booked');
  return 'booked';
end $function$;

revoke all on function public.sm_switch_workshop(uuid) from anon;
grant execute on function public.sm_switch_workshop(uuid) to authenticated;
