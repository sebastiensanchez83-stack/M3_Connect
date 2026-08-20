-- Applied to the remote project via the Supabase MCP; kept here for traceability.
-- The single student entry is judged in the professional pool, and its jury
-- assignments already say so. But the award picker, the public ballot, the tally
-- and the vote check all selected candidates by ROLE (architect_pro), not by the
-- judging pool — so the student could be scored by the whole panel and then be
-- missing from the Architecture (Pro) winner list and from the public vote.
-- sm_vote_roles() replaces sm_vote_role(): a competition covers a SET of roles,
-- and architecture_pro covers pros and the student together.
-- (Full bodies of the four rewritten functions were applied via the MCP; they
-- differ from their previous definitions only in the role predicate, which
-- becomes `ra.role = any(sm_vote_roles(p_competition))`.)
create or replace function public.sm_vote_roles(p_competition text)
returns text[] language sql immutable set search_path to 'public','pg_temp'
as $fn$
  select case p_competition
    when 'innovation' then array['startup']
    when 'architecture_pro' then array['architect_pro','architect_student']
    when 'architecture_student' then array['architect_student']
  end;
$fn$;
grant execute on function public.sm_vote_roles(text) to authenticated, anon;
