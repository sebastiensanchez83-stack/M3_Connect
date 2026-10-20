-- DOWN for supabase/migrations/20261020130000_org_award_wins.sql
-- Drops the public read of award winners by company. Nothing else depends on it in the database
-- (checked below); the client treats a missing function as "no winner" (src/lib/awardWins.ts), so
-- the company pages and the directory simply stop showing the badge.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
declare
  v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p
   where p.prosrc ilike '%org_award_wins%'
     and p.oid is distinct from to_regprocedure('public.org_award_wins()')
     and p.prolang <> (select l.oid from pg_language l where l.lanname = 'c');
  if v_bad is not null then
    raise exception 'org_award_wins down: SQL function(s) call it: %', v_bad;
  end if;
end
$pre$;

drop function if exists public.org_award_wins();
