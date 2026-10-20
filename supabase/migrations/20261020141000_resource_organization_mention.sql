-- resource_organization_mention: the companies an article mentions, confirmed by M3 in the
-- article editor (Victor, 20 Oct 2026: "quand un article mentionne une entreprise qui est dans
-- la plateforme il faut que ca la tag et redirige sur son profil quand c'est clique").
-- NOT APPLIED. Apply with Victor's OK, after the dry run
-- supabase/dryrun/20261020141000_resource_organization_mention.dryrun.sql (it runs this file,
-- then its down, in one rolled-back transaction).
-- Down: supabase/migrations/down/20261020141000_resource_organization_mention.down.sql.
--
-- ADDITIVE ONLY: two tables (the mentions, and the suggestions staff turned down), an index and
-- eight policies. Nothing existing is redefined, the article's stored HTML is never touched (the
-- article page links the first occurrence of each confirmed name at render time) and the RSS feeds
-- (netlify/edge-functions/rss.ts) do not read them. Independent of every other pending file; any order.
--
-- Who sees a mention: anyone, when the article is published and public and the company is
-- verified, not archived and not merged into another (duplicate_of); signed-in readers also on
-- the published articles they may read (public.can_access_resource, the rule of
-- resource_sectors); M3 staff (public.is_moderator()) all of them. Who writes: M3 staff only
-- (insert and delete; a mention has nothing to update). created_by is stamped by default and is
-- not readable through the API. The turned-down suggestions (resource_organization_mention_skip)
-- are read and written by M3 staff only.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if to_regclass('public.resource_organization_mention') is not null or to_regclass('public.resource_organization_mention_skip') is not null then
    raise exception 'resource_organization_mention: already installed';
  end if;
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.is_moderator()'))
       is distinct from 'cb9c826f94db460c5b63f9830ae12361'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.can_access_resource(text)'))
       is distinct from '2fcf0a1a840a7be68a2fc2467a408c6e' then
    raise exception 'resource_organization_mention: is_moderator() or can_access_resource() changed since 20 Oct; check them again';
  end if;
  if not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'organizations' and c.column_name = 'duplicate_of')
     or not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'organizations' and c.column_name = 'archived_at') then
    raise exception 'resource_organization_mention: organizations.archived_at / duplicate_of missing';
  end if;
end
$pre$;

create table public.resource_organization_mention (
  resource_id uuid not null references public.resources(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint resource_organization_mention_pkey primary key (resource_id, organization_id)
);
create index resource_organization_mention_org_idx on public.resource_organization_mention (organization_id);
comment on table public.resource_organization_mention is
  'Companies an article mentions, confirmed by M3 staff in the article editor. The article page links the first occurrence of each name to the company page and lists them; the company page lists the public articles that mention it.';

alter table public.resource_organization_mention enable row level security;
revoke all on table public.resource_organization_mention from public, anon, authenticated;
grant select (resource_id, organization_id, created_at) on table public.resource_organization_mention to anon, authenticated;
grant insert (resource_id, organization_id) on table public.resource_organization_mention to authenticated;
grant delete on table public.resource_organization_mention to authenticated;
grant all on table public.resource_organization_mention to service_role;

create policy resource_org_mention_anon_read on public.resource_organization_mention
  for select to anon
  using (
    exists (select 1 from public.resources r
             where r.id = resource_organization_mention.resource_id
               and r.published = true
               and lower(coalesce(r.access_level, 'public')) = 'public')
    and exists (select 1 from public.organizations o
                 where o.id = resource_organization_mention.organization_id
                   and o.access_status = 'verified' and o.archived_at is null and o.duplicate_of is null)
  );
create policy resource_org_mention_member_read on public.resource_organization_mention
  for select to authenticated
  using (
    exists (select 1 from public.resources r
             where r.id = resource_organization_mention.resource_id
               and r.published = true
               and public.can_access_resource(r.access_level))
    and exists (select 1 from public.organizations o
                 where o.id = resource_organization_mention.organization_id
                   and o.access_status = 'verified' and o.archived_at is null and o.duplicate_of is null)
  );
create policy resource_org_mention_staff_read on public.resource_organization_mention
  for select to authenticated using ((select public.is_moderator()));
create policy resource_org_mention_staff_insert on public.resource_organization_mention
  for insert to authenticated with check ((select public.is_moderator()));
create policy resource_org_mention_staff_delete on public.resource_organization_mention
  for delete to authenticated using ((select public.is_moderator()));

-- "Not this one": a suggested company M3 staff turned down for an article, so neither the
-- article editor nor the admin list "Company tags to review" proposes it again. Staff only.
create table public.resource_organization_mention_skip (
  resource_id uuid not null references public.resources(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint resource_organization_mention_skip_pkey primary key (resource_id, organization_id)
);
comment on table public.resource_organization_mention_skip is
  'Company suggestions M3 staff turned down for an article ("Not this one"): never proposed again for it. Staff only; readers never see it.';

alter table public.resource_organization_mention_skip enable row level security;
revoke all on table public.resource_organization_mention_skip from public, anon, authenticated;
grant select (resource_id, organization_id, created_at) on table public.resource_organization_mention_skip to authenticated;
grant insert (resource_id, organization_id) on table public.resource_organization_mention_skip to authenticated;
grant delete on table public.resource_organization_mention_skip to authenticated;
grant all on table public.resource_organization_mention_skip to service_role;

create policy resource_org_mention_skip_staff_read on public.resource_organization_mention_skip
  for select to authenticated using ((select public.is_moderator()));
create policy resource_org_mention_skip_staff_insert on public.resource_organization_mention_skip
  for insert to authenticated with check ((select public.is_moderator()));
create policy resource_org_mention_skip_staff_delete on public.resource_organization_mention_skip
  for delete to authenticated using ((select public.is_moderator()));

-- After: privileges and policies exactly as intended, else the whole file rolls back.
do $post$
begin
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.resource_organization_mention'::regclass) then
    raise exception 'resource_organization_mention: RLS is off';
  end if;
  if has_column_privilege('anon', 'public.resource_organization_mention', 'created_by', 'select')
     or has_column_privilege('authenticated', 'public.resource_organization_mention', 'created_by', 'select')
     or has_column_privilege('authenticated', 'public.resource_organization_mention', 'created_by', 'insert')
     or has_table_privilege('anon', 'public.resource_organization_mention', 'insert, update, delete')
     or has_table_privilege('authenticated', 'public.resource_organization_mention', 'update')
     or not has_column_privilege('anon', 'public.resource_organization_mention', 'organization_id', 'select')
     or not has_column_privilege('authenticated', 'public.resource_organization_mention', 'organization_id', 'insert')
     or not has_table_privilege('authenticated', 'public.resource_organization_mention', 'delete') then
    raise exception 'resource_organization_mention: wrong privileges';
  end if;
  if (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'resource_organization_mention') <> 5 then
    raise exception 'resource_organization_mention: expected 5 policies';
  end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.resource_organization_mention_skip'::regclass)
     or has_table_privilege('anon', 'public.resource_organization_mention_skip', 'select, insert, update, delete')
     or has_column_privilege('anon', 'public.resource_organization_mention_skip', 'organization_id', 'select')
     or has_column_privilege('authenticated', 'public.resource_organization_mention_skip', 'created_by', 'select')
     or has_column_privilege('authenticated', 'public.resource_organization_mention_skip', 'created_by', 'insert')
     or has_table_privilege('authenticated', 'public.resource_organization_mention_skip', 'update')
     or not has_column_privilege('authenticated', 'public.resource_organization_mention_skip', 'organization_id', 'insert')
     or not has_table_privilege('authenticated', 'public.resource_organization_mention_skip', 'delete')
     or (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'resource_organization_mention_skip') <> 3 then
    raise exception 'resource_organization_mention_skip: wrong privileges, RLS or policies';
  end if;
end
$post$;
