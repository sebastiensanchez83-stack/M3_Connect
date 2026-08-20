-- Applied to the remote project via the Supabase MCP; kept here for traceability.
-- Architecture is judged by the whole panel: every architecture juror evaluates
-- every project, so the pairing is DERIVED rather than allocated one by one.
-- Innovation stays allocation-based (the panels Yachting Ventures build).
--
-- These have to be real sm_jury_assignment rows, not just a widened read: the
-- Awards Score in sm_admin_rankings joins sm_review to sm_jury_assignment on
-- (entry, juror) AND ja.mandatory, so a review with no assignment behind it is
-- silently dropped from the score.

create or replace function public.sm_sync_architecture_assignments(p_event_id uuid)
returns integer
language plpgsql security definer set search_path to 'public','pg_temp'
as $fn$
declare v_created int := 0; v_removed int := 0;
begin
  insert into sm_jury_assignment (event_id, juror_user_id, entry_role_assignment_id, competition, mandatory)
  select p_event_id, j.user_id, e.id,
         case when e.role = 'architect_pro' then 'architecture_pro' else 'architecture_student' end,
         true
  from (
    select distinct r.user_id
    from sm_role_assignment ra
    join sm_registration r on r.id = ra.registration_id
    where ra.event_id = p_event_id and ra.role = 'jury' and ra.status = 'confirmed'
      and r.user_id is not null and r.status not in ('declined','cancelled')
      and coalesce(ra.module_data->>'jury_scope','') in ('architecture','both')
  ) j
  cross join (
    select ra.id, ra.role
    from sm_role_assignment ra
    join sm_registration r on r.id = ra.registration_id
    where ra.event_id = p_event_id and ra.role in ('architect_pro','architect_student')
      and ra.status <> 'declined' and r.status not in ('declined','cancelled')
  ) e
  on conflict (juror_user_id, entry_role_assignment_id)
  do update set mandatory = true, competition = excluded.competition
  where sm_jury_assignment.mandatory is distinct from true
     or sm_jury_assignment.competition is distinct from excluded.competition;
  get diagnostics v_created = row_count;

  -- Never cull a scored pairing, and never an EXTERNAL reviewer's: token
  -- reviewers (sm_architecture_reviewer) score under a synthetic juror id with no
  -- registration behind it, so the "no longer a scoped juror" test is always true
  -- for them. Their rows belong to sm_architecture_reviewer_add / _revoke.
  delete from sm_jury_assignment ja
  where ja.event_id = p_event_id
    and ja.competition like 'architecture%'
    and not exists (select 1 from sm_review rv
                     where rv.entry_role_assignment_id = ja.entry_role_assignment_id
                       and rv.juror_user_id = ja.juror_user_id)
    and not exists (select 1 from sm_architecture_reviewer ar
                     where ar.juror_user_id = ja.juror_user_id)
    and (
      not exists (
        select 1 from sm_role_assignment ra join sm_registration r on r.id = ra.registration_id
        where ra.id = ja.entry_role_assignment_id
          and ra.status <> 'declined' and r.status not in ('declined','cancelled')
      )
      or not exists (
        select 1 from sm_role_assignment ra join sm_registration r on r.id = ra.registration_id
        where ra.event_id = p_event_id and ra.role = 'jury' and ra.status = 'confirmed'
          and r.user_id = ja.juror_user_id and r.status not in ('declined','cancelled')
          and coalesce(ra.module_data->>'jury_scope','') in ('architecture','both')
      )
    );
  get diagnostics v_removed = row_count;
  raise notice 'architecture assignments: % created, % withdrawn', v_created, v_removed;
  return v_created;
end $fn$;

create or replace function public.sm_arch_assignments_autosync()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp'
as $fn$
begin
  perform public.sm_sync_architecture_assignments(new.event_id);
  return null;
end $fn$;

drop trigger if exists sm_arch_assignments_autosync_trg on public.sm_role_assignment;
create trigger sm_arch_assignments_autosync_trg
after insert or update on public.sm_role_assignment
for each row
when (new.role in ('jury','architect_pro','architect_student'))
execute function public.sm_arch_assignments_autosync();

drop trigger if exists sm_arch_assignments_reg_autosync_trg on public.sm_registration;
create trigger sm_arch_assignments_reg_autosync_trg
after update of status, user_id on public.sm_registration
for each row
when (new.status is distinct from old.status or new.user_id is distinct from old.user_id)
execute function public.sm_arch_assignments_autosync();

select public.sm_sync_architecture_assignments((select id from sm_event where slug = 'sm26'));
