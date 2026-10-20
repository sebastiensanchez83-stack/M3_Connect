-- DOWN of supabase/migrations/20261020141000_resource_organization_mention.sql. NOT A
-- MIGRATION: run it only to take the feature out (with Victor's OK). It DROPS every confirmed
-- mention; keep a copy first if any exist:
--   select * from public.resource_organization_mention;
-- The client copes with the table being gone: the article page and the company page simply show
-- no mentions, and the editor's panel says it could not load them.
-- Checked by the same dry run as the migration
-- (supabase/dryrun/20261020141000_resource_organization_mention.dryrun.sql).

set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop table if exists public.resource_organization_mention;

do $post$
begin
  if to_regclass('public.resource_organization_mention') is not null
     or exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'resource_organization_mention') then
    raise exception 'resource_organization_mention down: something is left';
  end if;
end
$post$;
