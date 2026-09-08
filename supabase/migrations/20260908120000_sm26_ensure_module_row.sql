-- Applied to the remote project via the Supabase MCP; kept here for traceability.
--
-- The row a participant is editing has to exist before they edit it.
--
-- A startup's pitch lives in sm_startup_profile, one row per role assignment.
-- That row is inserted by the paths a startup travels when they sign up
-- themselves (SM26RegisterPage, sm26-register, sm26-import) — and by nothing
-- else. When M3 grants the startup role by hand to a registration that is
-- already on the platform, no row is created.
--
-- The hub's editor then saves with
--   update sm_startup_profile set … where role_assignment_id = $1
-- which, with no row to match, updates nothing, returns no error, and is
-- reported to the participant as "Innovation details saved". Reopening the
-- editor reads the same absent row and shows an empty form, so the obvious
-- response is to type it all again. Two companies did exactly that.
--
-- This function makes the row exist. It is idempotent, it derives the event
-- from the role assignment rather than trusting the caller, and it refuses
-- anyone who does not already own that role assignment — the same test the
-- table's RLS policy applies.
--
-- Architecture is deliberately NOT seeded here: an sm_architecture_entry row
-- is a competition entry, and creating a blank one because somebody opened an
-- editor would put a phantom submission in front of the jury. Every architect
-- already has their entry; if one ever went missing the client now reports the
-- failed save instead of claiming success.

create or replace function public.sm_ensure_module_row(p_role_assignment_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_role text; v_event uuid;
begin
  if not (sm_owns_role_assignment(p_role_assignment_id) or sm_is_staff()) then
    raise exception 'Not authorized';
  end if;

  select ra.role, r.event_id into v_role, v_event
    from sm_role_assignment ra
    join sm_registration r on r.id = ra.registration_id
   where ra.id = p_role_assignment_id;
  if v_role is null then raise exception 'role assignment not found'; end if;

  if v_role = 'startup' then
    insert into sm_startup_profile (role_assignment_id, event_id)
      values (p_role_assignment_id, v_event)
      on conflict (role_assignment_id) do nothing;
    return 'sm_startup_profile';
  elsif v_role = 'marina' then
    insert into sm_marina_extra (role_assignment_id, event_id)
      values (p_role_assignment_id, v_event)
      on conflict (role_assignment_id) do nothing;
    return 'sm_marina_extra';
  end if;

  return 'none';
end $function$;

revoke all on function public.sm_ensure_module_row(uuid) from anon;
grant execute on function public.sm_ensure_module_row(uuid) to authenticated;

-- The two startups this already cost: UrbanThink and OBLUXE Company Ltd, both
-- given the startup role by hand at the end of July 2026. Their rows are
-- created empty here so staff can see them and so neither company depends on
-- opening the editor again. What they typed before is not recoverable — it was
-- never sent anywhere that stores it.
insert into sm_startup_profile (role_assignment_id, event_id)
select ra.id, r.event_id
  from sm_role_assignment ra
  join sm_registration r on r.id = ra.registration_id
 where ra.role = 'startup'
   and ra.status <> 'declined'
   and not exists (select 1 from sm_startup_profile sp where sp.role_assignment_id = ra.id)
on conflict (role_assignment_id) do nothing;
