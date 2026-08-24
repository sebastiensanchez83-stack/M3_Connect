-- Applied to the remote project via the Supabase MCP; kept here for traceability.
--
-- Answering a slot pinned a juror to it.
--
-- Panel membership drives the sessions: `sm_jury_group_member` is the truth and
-- two triggers push it into `sm_jury_session_juror` — one when a juror joins or
-- leaves a panel, one when a session is repointed at a different panel. Both
-- guarded the DELETE half with
--
--     and j.invited_at is null and j.status = 'invited'
--
-- which reads "only take somebody off a session if they were never asked and
-- never answered". That is the exact opposite of when you need it. The reason a
-- juror gets moved is that they answered — they said the slot does not work —
-- and answering is what made them impossible to move. They stayed on the
-- original session's panel for good: still in the roster, still in the
-- "n jurors" count, still in "ask all again", and still a recipient of the Zoom
-- invitation, which goes to every juror on the session whose RSVP is available
-- or confirmed. Being reassigned to a new panel added a second row; it never
-- removed the first.
--
-- The startup half of the same feature (`sm_sync_session_roster` /
-- `sm_sync_sessions_from_batch`) has no such guard and behaves correctly — a
-- startup moved between batches leaves the old session whatever it answered.
-- There were zero stale entries on that side and seven stale jurors on this one.
--
-- So the guard goes. What stays is `not s.zoom_sent`: once the calendar
-- invitation has gone out, the attendee list is a fact in other people's
-- calendars and in Zoom, and quietly editing our copy of it would only make the
-- two disagree. A juror removed from a panel after the invite was sent still
-- shows on that session — and the console now says why, rather than leaving it
-- looking like the same bug.
--
-- The answer itself is per (session, juror), so removing somebody from a panel
-- does forget what they said about that panel's slots. That is the right way
-- round: it is a fact about a slot they are no longer being asked to attend, and
-- re-adding them asks again.

-- == a juror joins or leaves a panel ==
create or replace function public.sm_sync_sessions_from_panel()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if tg_op = 'INSERT' then
    if new.juror_user_id is null then return null; end if;

    insert into sm_jury_session_juror (session_id, juror_user_id)
    select s.id, new.juror_user_id
      from sm_jury_session s
     where s.jury_group_id = new.group_id and s.status <> 'cancelled' and not s.zoom_sent
    on conflict (session_id, juror_user_id) do nothing;

    insert into sm_jury_assignment (event_id, juror_user_id, entry_role_assignment_id, competition, mandatory, assigned_by)
    select distinct s.event_id, new.juror_user_id, e.entry_role_assignment_id, 'innovation', true, auth.uid()
      from sm_jury_session s
      join sm_jury_session_entry e on e.session_id = s.id
     where s.jury_group_id = new.group_id and s.status <> 'cancelled'
    on conflict (juror_user_id, entry_role_assignment_id) do nothing;
    return null;
  end if;

  if old.juror_user_id is null then return null; end if;

  -- Leaving the panel leaves its sessions, whatever they had answered. Only a
  -- session whose Zoom invitation has already gone out keeps them.
  delete from sm_jury_session_juror j
   using sm_jury_session s
   where j.session_id = s.id and j.juror_user_id = old.juror_user_id
     and s.jury_group_id = old.group_id and s.status <> 'cancelled' and not s.zoom_sent;

  delete from sm_jury_assignment a
   where a.juror_user_id = old.juror_user_id
     and not exists (select 1 from sm_review rv
                      where rv.juror_user_id = a.juror_user_id
                        and rv.entry_role_assignment_id = a.entry_role_assignment_id)
     and exists (select 1 from sm_jury_session s
                  join sm_jury_session_entry e on e.session_id = s.id
                 where s.jury_group_id = old.group_id and s.status <> 'cancelled'
                   and e.entry_role_assignment_id = a.entry_role_assignment_id)
     and not exists (select 1 from sm_jury_session s2
                      join sm_jury_group_member m2 on m2.group_id = s2.jury_group_id
                      join sm_jury_session_entry e2 on e2.session_id = s2.id
                     where s2.status <> 'cancelled' and m2.juror_user_id = a.juror_user_id
                       and e2.entry_role_assignment_id = a.entry_role_assignment_id);
  return null;
end $function$;

-- == a session is pointed at a different panel ==
create or replace function public.sm_sync_session_panel()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.jury_group_id is null or new.zoom_sent or new.status = 'cancelled' then
    return null;
  end if;

  delete from sm_jury_session_juror j
   where j.session_id = new.id
     and not exists (
       select 1 from sm_jury_group_member m
        where m.group_id = new.jury_group_id and m.juror_user_id = j.juror_user_id);

  insert into sm_jury_session_juror (session_id, juror_user_id)
  select new.id, m.juror_user_id
    from sm_jury_group_member m
   where m.group_id = new.jury_group_id and m.juror_user_id is not null
  on conflict (session_id, juror_user_id) do nothing;

  return null;
end $function$;

-- == the seven already stuck ==
--
-- Anne LEBRETON-WOLF said no to JG2's 1 Sep slot and moved to JG7 + JG9;
-- OLIVIER THORAVAL said yes to JG5's and moved to JG3 + JG7; Derek van Brussel
-- came off every panel and was still on five sessions, two of them as
-- "available" — which is who the Zoom invitation goes to. None of these
-- sessions has been invited yet, so this is the same delete the trigger would
-- now have done at the time.
delete from public.sm_jury_session_juror j
 using public.sm_jury_session s
 where j.session_id = s.id
   and s.status <> 'cancelled' and not s.zoom_sent
   and s.jury_group_id is not null
   and not exists (
     select 1 from public.sm_jury_group_member m
      where m.group_id = s.jury_group_id and m.juror_user_id = j.juror_user_id);

-- == say so when one legitimately remains ==
--
-- After the invitation is sent a juror can be off the panel and still on the
-- session, on purpose. `on_panel` lets the timetable label that instead of
-- showing a name with no explanation.
create or replace function public.sm_yv_timetable(p_event_id uuid)
returns table(
  id uuid, title text, slot_label text, scheduled_at timestamptz, duration_minutes integer,
  status text, is_test boolean, zoom_sent boolean, zoom_sent_at timestamptz, zoom_join_url text,
  last_availability_email_at timestamptz, last_startup_email_at timestamptz,
  jury_group_id uuid, jury_group_code text, startup_group_id uuid, startup_group_code text,
  jurors jsonb, entries jsonb, guests jsonb, assigned integer, submitted integer)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if not sm_is_yv(p_event_id) then raise exception 'Not authorized'; end if;
  return query
  select s.id, s.title, s.slot_label, s.scheduled_at, s.duration_minutes,
    s.status, s.is_test, s.zoom_sent, s.zoom_sent_at, s.zoom_join_url,
    s.last_availability_email_at, s.last_startup_email_at,
    s.jury_group_id, jg.code, s.startup_group_id, sg.code,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', sj.juror_user_id,
               'name', coalesce(nullif(trim(coalesce(p.first_name,'')||' '||coalesce(p.last_name,'')),''), p.email, 'Juror'),
               'rsvp', sj.status,
               'responded_at', sj.responded_at,
               'invited_at', sj.invited_at,
               'on_panel', s.jury_group_id is null or exists (
                 select 1 from sm_jury_group_member m
                  where m.group_id = s.jury_group_id and m.juror_user_id = sj.juror_user_id))
             order by p.last_name nulls last, p.first_name nulls last)
      from sm_jury_session_juror sj
      left join profiles p on p.user_id = sj.juror_user_id
      where sj.session_id = s.id), '[]'::jsonb),
    -- Entries carry their own RSVP. The token is deliberately NOT exposed: it
    -- is the entire authorisation for answering in that startup's name, and it
    -- only ever needs to exist inside the email we send them.
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'role_assignment_id', se.entry_role_assignment_id,
               'company', coalesce(nullif(trim(r.company_name),''), nullif(trim(coalesce(r.first_name,'')||' '||coalesce(r.last_name,'')),''), 'Entry'),
               'rsvp', se.status,
               'responded_at', se.responded_at,
               'invited_at', se.invited_at)
             order by r.company_name nulls last)
      from sm_jury_session_entry se
      join sm_role_assignment ra on ra.id = se.entry_role_assignment_id
      join sm_registration r on r.id = ra.registration_id
      where se.session_id = s.id), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('email', g.email, 'name', g.name) order by g.email)
      from sm_jury_session_guest g where g.session_id = s.id), '[]'::jsonb),
    (select count(*)::int
       from sm_jury_session_juror sj, sm_jury_session_entry se
      where sj.session_id = s.id and se.session_id = s.id
        and exists (select 1 from sm_jury_assignment a
                     where a.juror_user_id = sj.juror_user_id
                       and a.entry_role_assignment_id = se.entry_role_assignment_id
                       and a.competition = 'innovation')),
    (select count(*)::int
       from sm_jury_session_juror sj, sm_jury_session_entry se
      where sj.session_id = s.id and se.session_id = s.id
        and exists (select 1 from sm_review rv
                     where rv.juror_user_id = sj.juror_user_id
                       and rv.entry_role_assignment_id = se.entry_role_assignment_id
                       and rv.status = 'submitted'))
  from sm_jury_session s
  left join sm_jury_group jg on jg.id = s.jury_group_id
  left join sm_startup_group sg on sg.id = s.startup_group_id
  where s.event_id = p_event_id
  order by s.scheduled_at, jg.code nulls last;
end $function$;
