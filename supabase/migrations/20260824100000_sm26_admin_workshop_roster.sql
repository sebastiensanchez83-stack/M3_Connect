-- Applied to the remote project via the Supabase MCP; kept here for traceability.
--
-- Who is in each workshop, and putting someone in one for them.
--
-- Workshop seats were a participant-only affair: `sm_book_workshop` books
-- `auth.uid()` and nothing else, and the only trace of a booking anywhere in the
-- admin console was the "3/10" counter on the programme list. So the six
-- workshops had names attached in the database and nowhere on the platform could
-- staff read them out — no list to print, no list to hand the room facilitator,
-- and no way to seat the person who books by replying to an email.
--
-- Three staff-only RPCs. They deliberately mirror the participant ones, because
-- the invariants are the participant's: one workshop per person per day, the
-- capacity, and the waitlist that fills a seat the moment one is freed.
--
-- `day_date` is computed as `date(starts_at)` exactly as `sm_book_workshop`
-- does — the one-per-day unique constraint is on that value, so a different
-- expression here would quietly let the same person hold two workshops in a day.

-- == Read: every booking for the event, with the person behind the user_id ==
create or replace function public.sm_admin_workshop_bookings(p_event_id uuid)
returns table(
  session_id uuid, session_title text, starts_at timestamptz, capacity integer,
  user_id uuid, registration_id uuid, full_name text, email text, company text,
  roles text[], status text, waitlist_pos integer, booked_at timestamptz
)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if not sm_is_staff() then raise exception 'Not authorized'; end if;
  return query
  select s.id, s.title, s.starts_at, s.capacity,
         b.user_id, r.id,
         coalesce(
           nullif(trim(coalesce(r.first_name, '') || ' ' || coalesce(r.last_name, '')), ''),
           nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
           'Participant') as full_name,
         coalesce(r.email, p.email) as email,
         nullif(trim(coalesce(r.company_name, '')), '') as company,
         coalesce((select array_agg(distinct ra.role order by ra.role)
                     from sm_role_assignment ra
                    where ra.registration_id = r.id and ra.status <> 'declined'), '{}') as roles,
         b.status, b.waitlist_pos, b.created_at
    from sm_workshop_booking b
    join sm_session s on s.id = b.session_id
    -- the booking carries a user, not a registration; prefer their confirmed one
    left join lateral (
      select r2.* from sm_registration r2
       where r2.event_id = b.event_id and r2.user_id = b.user_id
       order by (r2.status = 'confirmed') desc, r2.created_at
       limit 1
    ) r on true
    left join profiles p on p.user_id = b.user_id
   where b.event_id = p_event_id
   order by s.starts_at nulls last, s.title,
            (b.status <> 'booked'), b.waitlist_pos nulls first, b.created_at;
end $function$;

-- == Remove: frees the seat and promotes the top of the waitlist, as cancelling
--    your own booking does. `p_notify` is off when this is the first half of a
--    move, so the participant is not told they were removed and re-added. ==
create or replace function public.sm_admin_cancel_workshop(
  p_session_id uuid, p_user_id uuid, p_notify boolean default true)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_was text; v_promote uuid; v_title text;
begin
  if not sm_is_staff() then raise exception 'Not authorized'; end if;
  select title into v_title from sm_session where id = p_session_id for update;
  if v_title is null then raise exception 'session not found'; end if;
  select status into v_was from sm_workshop_booking
    where session_id = p_session_id and user_id = p_user_id;
  if v_was is null then return 'not_booked'; end if;
  delete from sm_workshop_booking where session_id = p_session_id and user_id = p_user_id;
  if v_was = 'booked' then
    select user_id into v_promote from sm_workshop_booking
      where session_id = p_session_id and status = 'waitlisted'
      order by waitlist_pos asc limit 1;
    if v_promote is not null then
      update sm_workshop_booking set status = 'booked', waitlist_pos = null
        where session_id = p_session_id and user_id = v_promote;
      insert into sm_notification (user_id, type, title, body, link)
        values (v_promote, 'sm26_workshop_promoted', 'A workshop seat opened up',
                'You''ve been moved off the waitlist into ' || v_title || '.', '/sm26/agenda');
    end if;
  end if;
  if p_notify then
    insert into sm_notification (user_id, type, title, body, link)
      values (p_user_id, 'sm26_workshop_removed', 'Your workshop booking was cancelled',
              'M3 has removed your place in ' || v_title || '. You can choose another workshop from the programme.',
              '/sm26/agenda');
  end if;
  return 'cancelled';
end $function$;

-- == Add: seat somebody who did not book themselves. ==
--
-- Two things only staff get to decide, so both are explicit arguments rather
-- than silent behaviour: `p_replace` moves a person who already holds a workshop
-- that day, and `p_overbook` seats them past the stated capacity. Without either
-- flag the call refuses and says which it needs, so nobody moves a booking or
-- puts an eleventh chair in a ten-seat room by accident.
create or replace function public.sm_admin_book_workshop(
  p_session_id uuid, p_user_id uuid,
  p_replace boolean default false, p_overbook boolean default false)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_event uuid; v_cap int; v_type text; v_day date; v_title text;
  v_booked int; v_status text; v_other uuid; v_other_title text;
begin
  if not sm_is_staff() then raise exception 'Not authorized'; end if;
  if p_user_id is null then
    raise exception 'This participant has no platform account yet — provision one first, then add them to a workshop.';
  end if;
  select event_id, capacity, type, date(starts_at), title
    into v_event, v_cap, v_type, v_day, v_title
    from sm_session where id = p_session_id for update;   -- serialise per session
  if v_event is null then raise exception 'session not found'; end if;
  if v_type <> 'workshop' then raise exception 'not a workshop'; end if;

  select count(*) into v_booked from sm_workshop_booking
    where session_id = p_session_id and status = 'booked';

  -- Already on this workshop: booked is a no-op, waitlisted is a promotion.
  select status into v_status from sm_workshop_booking
    where session_id = p_session_id and user_id = p_user_id;
  if v_status = 'booked' then return 'already_booked'; end if;
  if v_status = 'waitlisted' then
    if v_cap is not null and v_booked >= v_cap and not p_overbook then
      raise exception 'FULL: % is at capacity (%/%).', v_title, v_booked, v_cap;
    end if;
    update sm_workshop_booking set status = 'booked', waitlist_pos = null
      where session_id = p_session_id and user_id = p_user_id;
    insert into sm_notification (user_id, type, title, body, link)
      values (p_user_id, 'sm26_workshop_promoted', 'A workshop seat opened up',
              'You''ve been moved off the waitlist into ' || v_title || '.', '/sm26/agenda');
    return 'booked';
  end if;

  -- One workshop per person per day.
  select session_id into v_other from sm_workshop_booking
    where user_id = p_user_id and event_id = v_event and day_date = v_day;
  if v_other is not null then
    select title into v_other_title from sm_session where id = v_other;
    if not p_replace then
      raise exception 'BOOKED_THAT_DAY: %', v_other_title;
    end if;
    perform sm_admin_cancel_workshop(v_other, p_user_id, false);
    select count(*) into v_booked from sm_workshop_booking
      where session_id = p_session_id and status = 'booked';
  end if;

  if v_cap is null or v_booked < v_cap or p_overbook then
    insert into sm_workshop_booking (event_id, session_id, user_id, day_date, status)
      values (v_event, p_session_id, p_user_id, v_day, 'booked');
    insert into sm_notification (user_id, type, title, body, link)
      values (p_user_id, 'sm26_workshop_booked', 'M3 booked you into a workshop',
              'You have a place in ' || v_title || '. It is on your programme.', '/sm26/agenda');
    return 'booked';
  end if;

  insert into sm_workshop_booking (event_id, session_id, user_id, day_date, status, waitlist_pos)
    values (v_event, p_session_id, p_user_id, v_day, 'waitlisted',
      coalesce((select max(waitlist_pos) from sm_workshop_booking
                 where session_id = p_session_id and status = 'waitlisted'), 0) + 1);
  insert into sm_notification (user_id, type, title, body, link)
    values (p_user_id, 'sm26_workshop_waitlisted', 'You are on a workshop waitlist',
            v_title || ' was full, so M3 put you on the waitlist. We will tell you if a seat opens.',
            '/sm26/agenda');
  return 'waitlisted';
end $function$;

revoke all on function public.sm_admin_workshop_bookings(uuid) from anon;
revoke all on function public.sm_admin_cancel_workshop(uuid, uuid, boolean) from anon;
revoke all on function public.sm_admin_book_workshop(uuid, uuid, boolean, boolean) from anon;
grant execute on function public.sm_admin_workshop_bookings(uuid) to authenticated;
grant execute on function public.sm_admin_cancel_workshop(uuid, uuid, boolean) to authenticated;
grant execute on function public.sm_admin_book_workshop(uuid, uuid, boolean, boolean) to authenticated;
