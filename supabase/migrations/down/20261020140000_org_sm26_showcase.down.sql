-- DOWN of supabase/migrations/20261020140000_org_sm26_showcase.sql. NOT A MIGRATION: run it
-- only to take the feature out (with Victor's OK), after the redesign's client that calls
-- org_sm26_showcase* is gone from the live site (else the company pages and the dashboard row
-- just show nothing: the calls fail and the client hides the block).
-- It DROPS the companies' choices (public.org_sm26_showcase). Keep a copy first if any row
-- exists:  select * from public.org_sm26_showcase;
-- The 'sm26_showcase_changed' lines in organization_audit_log stay (history).
-- Checked by the same two dry runs as the migration (supabase/dryrun/20261020140000_org_sm26_showcase.dryrun*.sql).

set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop function if exists public.org_sm26_showcase_set(uuid, text, boolean, text[]);
drop function if exists public.org_sm26_showcase_settings(uuid);
drop function if exists public.org_sm26_showcase(uuid);
drop function if exists public.org_sm26_showcase_entries(uuid);
drop function if exists public.org_sm26_showcase_links(jsonb);
drop table if exists public.org_sm26_showcase;

do $post$
begin
  if to_regclass('public.org_sm26_showcase') is not null
     or exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and left(p.proname, 17) = 'org_sm26_showcase') then
    raise exception 'org_sm26_showcase down: something is left';
  end if;
end
$post$;
