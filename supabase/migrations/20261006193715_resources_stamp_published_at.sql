-- resources.published_at is stamped by the database the first time a resource
-- is published. Until now no admin flow set it: Admin -> Resources (create /
-- edit with the Published checkbox) and both draft-approve buttons
-- (AdminResourceDetail, AdminResourceDrafts) write `published: true` straight
-- to public.resources and never send published_at, so all 30 published rows
-- were NULL and every list (home, /resources, dashboard, media articles) fell
-- back to created_at. The only writer that did stamp it is the DB-side
-- publish_resource_from_draft() trigger on resource_drafts, which the client
-- approve flows never reach (they set the draft to 'approved', not
-- 'published').
--
-- Rule (BEFORE INSERT OR UPDATE, per row):
--   published is true and published_at is null  ->  published_at := now()
-- so:
--   - a value already present (set by an admin, or by
--     publish_resource_from_draft(), which sends now() itself) is never
--     overridden;
--   - unpublishing does not clear it, and republishing keeps the original date;
--   - a draft saved with published = false stays NULL until it is published.
-- No client code writes published_at on resources, so nothing conflicts.
--
-- Existing triggers on public.resources: trg_resources_updated_at (BEFORE
-- UPDATE, set_updated_at()). Same-timing triggers fire in name order, so this
-- one runs first; they touch different columns.
--
-- Backfill: published rows that are still NULL take their creation date. It
-- runs with trg_resources_updated_at switched off so updated_at keeps meaning
-- "last edited" instead of becoming today for all 30 rows. It is one DO
-- statement, so a failure cannot leave that trigger disabled.
--
-- Undo:
--   drop trigger if exists trg_resources_stamp_published_at on public.resources;
--   drop function if exists public.resources_stamp_published_at();
--   (the backfilled dates stay; they were NULL before.)

create or replace function public.resources_stamp_published_at()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
begin
  if new.published is true and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_resources_stamp_published_at on public.resources;
create trigger trg_resources_stamp_published_at
  before insert or update on public.resources
  for each row execute function public.resources_stamp_published_at();

do $$
begin
  alter table public.resources disable trigger trg_resources_updated_at;
  update public.resources
     set published_at = coalesce(created_at, updated_at)
   where published and published_at is null;
  alter table public.resources enable trigger trg_resources_updated_at;
end
$$;

comment on column public.resources.published_at is
  'First time the resource was published. Stamped by trg_resources_stamp_published_at when published is true and this is NULL; never cleared on unpublish, never overrides a value already set.';
