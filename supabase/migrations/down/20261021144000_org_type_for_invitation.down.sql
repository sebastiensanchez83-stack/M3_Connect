-- DOWN for supabase/migrations/20261021144000_org_type_for_invitation.sql
-- Drops org_type_for_invitation(uuid). The redesign's invitation sign-up page then falls back to
-- its direct read of organizations.organization_type (src/pages/JoinPage.tsx), which works while
-- anon still reads every company, i.e. until held/directory_visitor_basic.sql is applied. After
-- that, run this down only together with that file's down: the page would refuse the sign-up of an
-- invitee of a company M3 has not validated ("could not read the company"), never guess a persona.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
declare
  v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p
   where p.prosrc ilike '%org_type_for_invitation%'
     and p.oid is distinct from to_regprocedure('public.org_type_for_invitation(uuid)')
     and p.prolang <> (select l.oid from pg_language l where l.lanname = 'c');
  if v_bad is not null then
    raise exception 'org_type_for_invitation down: SQL function(s) call it: %', v_bad;
  end if;
end
$pre$;

drop function if exists public.org_type_for_invitation(uuid);
