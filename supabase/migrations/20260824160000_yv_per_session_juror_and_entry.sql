-- Applied to the remote project via the Supabase MCP; kept here for traceability.
--
-- One juror, one session — without moving the whole panel.
--
-- A session is a panel meeting a batch, and until now that was the only way to
-- put somebody in one: to add a juror to a single slot you had to put them on
-- the panel, which added them to every slot that panel sits in. The real cases
-- are smaller than that — one juror who can only make the Tuesday, one startup
-- moved into the session with the investor who asked to see them — and each one
-- meant either building a one-off panel or leaving it wrong.
--
-- Four RPCs that edit one session's roster directly. They keep the scoring
-- duties in step, which is the part that is easy to forget by hand: a juror
-- added to a session is given that session's innovations to score, and one
-- removed loses them again unless they have already scored, or still meet that
-- innovation in another session.
--
-- These are overrides, not a second source of truth. The panel and the batch
-- still drive the sessions, so editing THIS person's panel membership later
-- will re-apply the panel's answer to this session. Anything else would mean a
-- third table saying which of the two wins, and the console can say this in one
-- line instead.

-- == a juror on one session ==
create or replace function public.sm_yv_session_juror_add(p_session_id uuid, p_juror_user_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_ev uuid; v_status text; v_ra uuid;
begin
  select event_id, status into v_ev, v_status from sm_jury_session where id = p_session_id;
  if v_ev is null then raise exception 'Session not found'; end if;
  if not sm_is_yv(v_ev) then raise exception 'Not authorized'; end if;
  if v_status = 'cancelled' then raise exception 'This session is cancelled'; end if;

  -- They log in to score, so an account and a confirmed jury role are the bar —
  -- the same one `sm_yv_group_add_member` applies. Somebody without an account
  -- goes on the Zoom invitation as a guest instead.
  select ra.id into v_ra
    from sm_role_assignment ra join sm_registration r on r.id = ra.registration_id
   where ra.event_id = v_ev and ra.role = 'jury' and ra.status = 'confirmed'
     and r.user_id = p_juror_user_id and r.status not in ('declined','cancelled')
   limit 1;
  if v_ra is null then raise exception 'Juror must be confirmed and have an account'; end if;

  if exists (select 1 from sm_jury_session_juror where session_id = p_session_id and juror_user_id = p_juror_user_id)
  then return 'already_on'; end if;

  insert into sm_jury_session_juror (session_id, juror_user_id)
    values (p_session_id, p_juror_user_id);

  insert into sm_jury_assignment (event_id, juror_user_id, entry_role_assignment_id, competition, mandatory, assigned_by)
  select v_ev, p_juror_user_id, e.entry_role_assignment_id, 'innovation', true, auth.uid()
    from sm_jury_session_entry e where e.session_id = p_session_id
  on conflict (juror_user_id, entry_role_assignment_id) do nothing;

  return 'added';
end $function$;

create or replace function public.sm_yv_session_juror_remove(p_session_id uuid, p_juror_user_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_ev uuid;
begin
  select event_id into v_ev from sm_jury_session where id = p_session_id;
  if v_ev is null then raise exception 'Session not found'; end if;
  if not sm_is_yv(v_ev) then raise exception 'Not authorized'; end if;

  delete from sm_jury_session_juror
   where session_id = p_session_id and juror_user_id = p_juror_user_id;
  if not found then return 'not_on'; end if;

  -- Their duties for this session's innovations go too — unless they have
  -- already scored one, or still meet it in another live session.
  delete from sm_jury_assignment a
   where a.juror_user_id = p_juror_user_id
     and a.competition = 'innovation'
     and exists (select 1 from sm_jury_session_entry e
                  where e.session_id = p_session_id
                    and e.entry_role_assignment_id = a.entry_role_assignment_id)
     and not exists (select 1 from sm_review rv
                      where rv.juror_user_id = a.juror_user_id
                        and rv.entry_role_assignment_id = a.entry_role_assignment_id)
     and not exists (select 1 from sm_jury_session s2
                      join sm_jury_session_juror j2 on j2.session_id = s2.id
                      join sm_jury_session_entry e2 on e2.session_id = s2.id
                     where s2.status <> 'cancelled' and s2.id <> p_session_id
                       and j2.juror_user_id = a.juror_user_id
                       and e2.entry_role_assignment_id = a.entry_role_assignment_id);

  return 'removed';
end $function$;

-- == an innovation on one session ==
create or replace function public.sm_yv_session_entry_add(p_session_id uuid, p_entry_role_assignment_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_ev uuid; v_status text;
begin
  select event_id, status into v_ev, v_status from sm_jury_session where id = p_session_id;
  if v_ev is null then raise exception 'Session not found'; end if;
  if not sm_is_yv(v_ev) then raise exception 'Not authorized'; end if;
  if v_status = 'cancelled' then raise exception 'This session is cancelled'; end if;

  if not exists (
    select 1 from sm_role_assignment ra join sm_registration r on r.id = ra.registration_id
     where ra.id = p_entry_role_assignment_id and ra.event_id = v_ev and ra.role = 'startup'
       and ra.status <> 'declined' and r.status not in ('declined','cancelled'))
  then raise exception 'Innovation entry not found'; end if;

  if exists (select 1 from sm_jury_session_entry where session_id = p_session_id and entry_role_assignment_id = p_entry_role_assignment_id)
  then return 'already_on'; end if;

  insert into sm_jury_session_entry (session_id, entry_role_assignment_id)
    values (p_session_id, p_entry_role_assignment_id);

  insert into sm_jury_assignment (event_id, juror_user_id, entry_role_assignment_id, competition, mandatory, assigned_by)
  select v_ev, j.juror_user_id, p_entry_role_assignment_id, 'innovation', true, auth.uid()
    from sm_jury_session_juror j where j.session_id = p_session_id
  on conflict (juror_user_id, entry_role_assignment_id) do nothing;

  return 'added';
end $function$;

create or replace function public.sm_yv_session_entry_remove(p_session_id uuid, p_entry_role_assignment_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_ev uuid;
begin
  select event_id into v_ev from sm_jury_session where id = p_session_id;
  if v_ev is null then raise exception 'Session not found'; end if;
  if not sm_is_yv(v_ev) then raise exception 'Not authorized'; end if;

  delete from sm_jury_session_entry
   where session_id = p_session_id and entry_role_assignment_id = p_entry_role_assignment_id;
  if not found then return 'not_on'; end if;

  delete from sm_jury_assignment a
   where a.entry_role_assignment_id = p_entry_role_assignment_id
     and a.competition = 'innovation'
     and exists (select 1 from sm_jury_session_juror j
                  where j.session_id = p_session_id and j.juror_user_id = a.juror_user_id)
     and not exists (select 1 from sm_review rv
                      where rv.juror_user_id = a.juror_user_id
                        and rv.entry_role_assignment_id = a.entry_role_assignment_id)
     and not exists (select 1 from sm_jury_session s2
                      join sm_jury_session_juror j2 on j2.session_id = s2.id
                      join sm_jury_session_entry e2 on e2.session_id = s2.id
                     where s2.status <> 'cancelled' and s2.id <> p_session_id
                       and j2.juror_user_id = a.juror_user_id
                       and e2.entry_role_assignment_id = a.entry_role_assignment_id);

  return 'removed';
end $function$;

revoke all on function public.sm_yv_session_juror_add(uuid, uuid) from anon;
revoke all on function public.sm_yv_session_juror_remove(uuid, uuid) from anon;
revoke all on function public.sm_yv_session_entry_add(uuid, uuid) from anon;
revoke all on function public.sm_yv_session_entry_remove(uuid, uuid) from anon;
grant execute on function public.sm_yv_session_juror_add(uuid, uuid) to authenticated;
grant execute on function public.sm_yv_session_juror_remove(uuid, uuid) to authenticated;
grant execute on function public.sm_yv_session_entry_add(uuid, uuid) to authenticated;
grant execute on function public.sm_yv_session_entry_remove(uuid, uuid) to authenticated;
