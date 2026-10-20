-- DOWN of supabase/migrations/20261020160000_readable_slugs.sql. NOT A MIGRATION: run it only to
-- take readable addresses out (with Victor's OK). It DROPS resources.slug, events.slug and every
-- old address kept in the two history tables (and slug_auto, slug_public); keep a copy first:
--   select r.id, r.slug, r.slug_auto from public.resources r;
--   select e.id, e.slug, e.slug_auto, e.slug_public from public.events e;
--   select * from public.resource_slug_history;
--   select * from public.event_slug_history;
-- After it, /resources/<slug> and /events/<slug> links that were shared stop working (the pages
-- show "not found"; the Rendezvous' address alone keeps opening, the code knows its id). The
-- redesign's code copes with the column gone: it goes back to id addresses, as before the
-- migration. The live site (main) never read a slug and is not affected.
-- Checked by the same dry run as the migration (supabase/dryrun/20261020160000_readable_slugs.dryrun.sql).

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- No other SQL function of the public schema relies on what goes away.
do $pre$
declare
  v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) into v_bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prolang <> (select l.oid from pg_language l where l.lanname = 'c')
     and (p.prosrc ilike '%slug_history%' or p.prosrc ilike '%slug_lookup%' or p.prosrc ilike '%smc_slugify%'
          or p.prosrc ilike '%slug_auto%' or p.prosrc ilike '%slug_public%')
     and p.oid is distinct from to_regprocedure('public.smc_slug_assign()')
     and p.oid is distinct from to_regprocedure('public.smc_slug_remember()')
     and p.oid is distinct from to_regprocedure('public.resource_slug_lookup(text)')
     and p.oid is distinct from to_regprocedure('public.event_slug_lookup(text)')
     and p.oid is distinct from to_regprocedure('public.smc_slugify(text)');
  if v_bad is not null then
    raise exception 'readable_slugs down: SQL function(s) use it: %', v_bad;
  end if;
end
$pre$;

drop trigger if exists trg_resources_slug_remember on public.resources;
drop trigger if exists trg_resources_slug_assign on public.resources;
drop trigger if exists events_slug_remember on public.events;
drop trigger if exists events_slug_assign on public.events;
drop function if exists public.resource_slug_lookup(text);
drop function if exists public.event_slug_lookup(text);
drop function if exists public.smc_slug_remember();
drop function if exists public.smc_slug_assign();
drop table if exists public.resource_slug_history;
drop table if exists public.event_slug_history;
-- Drops the unique and format constraints with the columns.
alter table public.resources drop column if exists slug;
alter table public.resources drop column if exists slug_auto;
alter table public.events drop column if exists slug;
alter table public.events drop column if exists slug_auto;
alter table public.events drop column if exists slug_public;
drop function if exists public.smc_slugify(text);

do $post$
begin
  if exists (select 1 from information_schema.columns c
              where c.table_schema = 'public' and c.table_name in ('resources', 'events')
                and c.column_name in ('slug', 'slug_auto', 'slug_public'))
     or to_regclass('public.resource_slug_history') is not null
     or to_regclass('public.event_slug_history') is not null
     or to_regprocedure('public.smc_slugify(text)') is not null
     or to_regprocedure('public.smc_slug_assign()') is not null
     or to_regprocedure('public.smc_slug_remember()') is not null
     or to_regprocedure('public.resource_slug_lookup(text)') is not null
     or to_regprocedure('public.event_slug_lookup(text)') is not null
     or exists (select 1 from pg_trigger t
                 where t.tgrelid in ('public.resources'::regclass, 'public.events'::regclass)
                   and t.tgname in ('trg_resources_slug_assign', 'trg_resources_slug_remember', 'events_slug_assign', 'events_slug_remember')) then
    raise exception 'readable_slugs down: something is left';
  end if;
end
$post$;
