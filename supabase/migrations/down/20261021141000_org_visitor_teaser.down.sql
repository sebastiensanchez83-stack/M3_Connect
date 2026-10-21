-- DOWN for supabase/migrations/20261021141000_org_visitor_teaser.sql
-- Drops org_visitor_teaser(uuid) and org_public_highlights(uuid). The redesign treats a missing
-- function as "nothing to say" (src/lib/orgVisibility.ts): locked blocks lose their counts and a
-- visitor no longer sees a marina's key figures or the first Smart Marina 2026 text.
-- NEVER run this while supabase/migrations/held/directory_visitor_basic.sql is applied: run that
-- file's down first (it checks that both functions exist).

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
declare
  v_bad text;
begin
  if to_regprocedure('public.get_public_profile(uuid)') is not null
     and not has_function_privilege('anon', 'public.get_public_profile(uuid)', 'execute')
     and to_regprocedure('public.org_sm26_showcase(uuid)') is not null
     and not has_function_privilege('anon', 'public.org_sm26_showcase(uuid)', 'execute') then
    raise exception 'org_visitor_teaser down: held/directory_visitor_basic.sql looks applied; run its down first';
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p
   where (p.prosrc ilike '%org_visitor_teaser%' or p.prosrc ilike '%org_public_highlights%')
     and p.oid is distinct from to_regprocedure('public.org_visitor_teaser(uuid)')
     and p.oid is distinct from to_regprocedure('public.org_public_highlights(uuid)')
     and p.prolang <> (select l.oid from pg_language l where l.lanname = 'c');
  if v_bad is not null then
    raise exception 'org_visitor_teaser down: SQL function(s) call them: %', v_bad;
  end if;
end
$pre$;

drop function if exists public.org_public_highlights(uuid);
drop function if exists public.org_visitor_teaser(uuid);
