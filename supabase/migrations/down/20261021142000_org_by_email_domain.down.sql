-- DOWN for supabase/migrations/20261021142000_org_by_email_domain.sql
-- Drops org_by_email_domain(text). The redesign's sign-up form then falls back to its direct
-- primary_domain filter (src/components/auth/SignupForm.tsx), which works while anon still reads
-- that column, i.e. until held/directory_visitor_basic.sql is applied. After that, run this down
-- only together with that file's down, or the form simply stops recognising company domains
-- (no error: the account is created all the same).

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
declare
  v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p
   where p.prosrc ilike '%org_by_email_domain%'
     and p.oid is distinct from to_regprocedure('public.org_by_email_domain(text)')
     and p.prolang <> (select l.oid from pg_language l where l.lanname = 'c');
  if v_bad is not null then
    raise exception 'org_by_email_domain down: SQL function(s) call it: %', v_bad;
  end if;
end
$pre$;

drop function if exists public.org_by_email_domain(text);
