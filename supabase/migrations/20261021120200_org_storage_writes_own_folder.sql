-- Hole 3 of 3 of the go-live runbook (P2.4, Q8 = a), the most serious, 21 Oct 2026: any
-- signed-in account can overwrite or delete every logo, cover and gallery photo of the public
-- org-logos bucket (431 files) and upload into or delete from org-documents (21 files), in any
-- company's folder.
-- Down: supabase/migrations/down/20261021120200_org_storage_writes_own_folder.down.sql
-- Dry run: supabase/dryrun/20261021120200_org_storage_writes_own_folder.dryrun.sql
--
-- "Org members upload logos", "Org members update logos", "Org members delete logos",
-- "Org members upload documents" and "Org members delete documents" only check
-- auth.role() = 'authenticated'. They are replaced by folder-scoped policies, the rule that
-- org_documents_select_members already uses: staff (public.is_moderator()) or a row of
-- public.organization_members for auth.uid() whose organization_id::text is the first folder of
-- the path, (storage.foldername(name))[1].
--   INSERT: with check. UPDATE: using AND with check, so an object cannot be moved into another
--   company's folder. DELETE: using. For authenticated only: anon never wrote, the service role
--   bypasses RLS.
-- Every upload path already writes "<organization id>/...", the company coming from
-- organization_members (AuthContext): main OrganizationTab.tsx:178, 221, 266 (org-logos) and :315
-- (org-documents); refonte orgActions.ts:43, 79 (org-logos) and :161 (org-documents);
-- sm26-sync-media uses the service role. No client removes or moves a file in these buckets (a
-- removed photo or document only leaves the database) and no admin screen uploads here.
-- After this, staff only can rewrite: the 2 logo files in 2 folders of companies that no longer
-- exist, and 3 files (2 logos, 1 document) in 2 folders of companies since merged into another
-- (duplicate_of, no member left; their uploaders are members of the merged-into company).
-- Reads do not change.
-- Kept as they are: "Public read org logos" (storage upserts need it), org_documents_select_members
-- and every other storage.objects policy. No document UPDATE policy existed; none is added.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if (select count(*)
        from pg_policies p
        join (values
               ('Org members upload logos', 'INSERT', null,
                '((bucket_id = ''org-logos''::text) AND (auth.role() = ''authenticated''::text))'),
               ('Org members update logos', 'UPDATE',
                '((bucket_id = ''org-logos''::text) AND (auth.role() = ''authenticated''::text))', null),
               ('Org members delete logos', 'DELETE',
                '((bucket_id = ''org-logos''::text) AND (auth.role() = ''authenticated''::text))', null),
               ('Org members upload documents', 'INSERT', null,
                '((bucket_id = ''org-documents''::text) AND (auth.role() = ''authenticated''::text))'),
               ('Org members delete documents', 'DELETE',
                '((bucket_id = ''org-documents''::text) AND (auth.role() = ''authenticated''::text))', null)
             ) as e(n, c, q, w)
          on p.policyname = e.n and p.cmd = e.c and p.qual is not distinct from e.q and p.with_check is not distinct from e.w
       where p.schemaname = 'storage' and p.tablename = 'objects'
         and p.roles = '{public}'::name[] and p.permissive = 'PERMISSIVE') <> 5 then
    raise exception 'org storage writes: the five policies to replace are not all there as expected (applied already?)';
  end if;
  if exists (select 1 from pg_policies p
              where p.schemaname = 'storage' and p.tablename = 'objects'
                and p.policyname in ('org_logos_insert_members', 'org_logos_update_members', 'org_logos_delete_members',
                                     'org_documents_insert_members', 'org_documents_delete_members')) then
    raise exception 'org storage writes: a new policy name exists already';
  end if;
  if not exists (select 1 from pg_policies p
                  where p.schemaname = 'storage' and p.tablename = 'objects' and p.policyname = 'Public read org logos'
                    and p.cmd = 'SELECT' and p.qual = '(bucket_id = ''org-logos''::text)') then
    raise exception 'org storage writes: "Public read org logos" is missing or changed';
  end if;
  if to_regprocedure('public.is_moderator()') is null
     or not (select p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.is_moderator()'))
     or not has_function_privilege('authenticated', 'public.is_moderator()', 'execute') then
    raise exception 'org storage writes: public.is_moderator() is missing, not SECURITY DEFINER or not callable by authenticated';
  end if;
  if (select count(*) from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = 'organization_members'
         and (c.column_name, c.data_type) in (('user_id', 'uuid'), ('organization_id', 'uuid'))) <> 2 then
    raise exception 'org storage writes: organization_members.user_id / organization_id are missing or not uuid';
  end if;
end
$pre$;

drop policy "Org members upload logos" on storage.objects;
drop policy "Org members update logos" on storage.objects;
drop policy "Org members delete logos" on storage.objects;
drop policy "Org members upload documents" on storage.objects;
drop policy "Org members delete documents" on storage.objects;

create policy org_logos_insert_members on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'org-logos'
    and ((select public.is_moderator())
         or exists (select 1 from public.organization_members m
                     where m.user_id = (select auth.uid())
                       and m.organization_id::text = (storage.foldername(objects.name))[1]))
  );

create policy org_logos_update_members on storage.objects
  for update to authenticated
  using (
    bucket_id = 'org-logos'
    and ((select public.is_moderator())
         or exists (select 1 from public.organization_members m
                     where m.user_id = (select auth.uid())
                       and m.organization_id::text = (storage.foldername(objects.name))[1]))
  )
  with check (
    bucket_id = 'org-logos'
    and ((select public.is_moderator())
         or exists (select 1 from public.organization_members m
                     where m.user_id = (select auth.uid())
                       and m.organization_id::text = (storage.foldername(objects.name))[1]))
  );

create policy org_logos_delete_members on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'org-logos'
    and ((select public.is_moderator())
         or exists (select 1 from public.organization_members m
                     where m.user_id = (select auth.uid())
                       and m.organization_id::text = (storage.foldername(objects.name))[1]))
  );

create policy org_documents_insert_members on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'org-documents'
    and ((select public.is_moderator())
         or exists (select 1 from public.organization_members m
                     where m.user_id = (select auth.uid())
                       and m.organization_id::text = (storage.foldername(objects.name))[1]))
  );

create policy org_documents_delete_members on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'org-documents'
    and ((select public.is_moderator())
         or exists (select 1 from public.organization_members m
                     where m.user_id = (select auth.uid())
                       and m.organization_id::text = (storage.foldername(objects.name))[1]))
  );

do $post$
begin
  if exists (select 1 from pg_policies p
              where p.schemaname = 'storage' and p.tablename = 'objects'
                and p.policyname in ('Org members upload logos', 'Org members update logos', 'Org members delete logos',
                                     'Org members upload documents', 'Org members delete documents'))
     or (select count(*) from pg_policies p
          where p.schemaname = 'storage' and p.tablename = 'objects' and p.roles = '{authenticated}'::name[]
            and p.policyname in ('org_logos_insert_members', 'org_logos_update_members', 'org_logos_delete_members',
                                 'org_documents_insert_members', 'org_documents_delete_members')) <> 5 then
    raise exception 'org storage writes: the swap of the five policies is incomplete';
  end if;
end
$post$;
