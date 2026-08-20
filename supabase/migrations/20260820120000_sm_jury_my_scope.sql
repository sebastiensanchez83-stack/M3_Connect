-- Applied to the remote project via the Supabase MCP; kept here for traceability.
-- Which competition(s) the signed-in juror judges, so the jury page can offer an
-- Innovation / Architecture switch to the jurors who do both (and stay a single
-- plain list for everyone else). Returns the declared scope plus what they
-- actually have assigned, because the two can disagree while M3 is still
-- allocating entries.
create or replace function public.sm_jury_my_scope(p_event_id uuid)
returns table(scope text, innovation_assigned integer, architecture_assigned integer)
language sql stable security definer set search_path to 'public','pg_temp'
as $function$
  select
    coalesce(max(ra.module_data->>'jury_scope'), '') as scope,
    (select count(*)::int from sm_jury_assignment ja
      where ja.event_id = p_event_id and ja.juror_user_id = auth.uid()
        and ja.competition = 'innovation'),
    (select count(*)::int from sm_jury_assignment ja
      where ja.event_id = p_event_id and ja.juror_user_id = auth.uid()
        and ja.competition like 'architecture%')
  from sm_role_assignment ra
  join sm_registration r on r.id = ra.registration_id
  where ra.event_id = p_event_id and ra.role = 'jury' and ra.status = 'confirmed'
    and r.user_id = auth.uid();
$function$;

grant execute on function public.sm_jury_my_scope(uuid) to authenticated;
