-- DOWN for supabase/migrations/20261021120200_org_storage_writes_own_folder.sql
-- Puts back the five open write policies (any signed-in account writes in any company's folder of
-- org-logos and org-documents), exactly as they were on 21 Oct 2026. Harmless for main and refonte
-- (they write in their own company's folder only), but it reopens the hole.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if (select count(*) from pg_policies p
       where p.schemaname = 'storage' and p.tablename = 'objects'
         and p.policyname in ('org_logos_insert_members', 'org_logos_update_members', 'org_logos_delete_members',
                              'org_documents_insert_members', 'org_documents_delete_members')) <> 5 then
    raise exception 'org storage writes down: the five folder-scoped policies are not all there';
  end if;
  if exists (select 1 from pg_policies p
              where p.schemaname = 'storage' and p.tablename = 'objects'
                and p.policyname in ('Org members upload logos', 'Org members update logos', 'Org members delete logos',
                                     'Org members upload documents', 'Org members delete documents')) then
    raise exception 'org storage writes down: an old policy exists already';
  end if;
end
$pre$;

drop policy org_logos_insert_members on storage.objects;
drop policy org_logos_update_members on storage.objects;
drop policy org_logos_delete_members on storage.objects;
drop policy org_documents_insert_members on storage.objects;
drop policy org_documents_delete_members on storage.objects;

create policy "Org members upload logos" on storage.objects
  for insert
  with check ((bucket_id = 'org-logos'::text) AND (auth.role() = 'authenticated'::text));
create policy "Org members update logos" on storage.objects
  for update
  using ((bucket_id = 'org-logos'::text) AND (auth.role() = 'authenticated'::text));
create policy "Org members delete logos" on storage.objects
  for delete
  using ((bucket_id = 'org-logos'::text) AND (auth.role() = 'authenticated'::text));
create policy "Org members upload documents" on storage.objects
  for insert
  with check ((bucket_id = 'org-documents'::text) AND (auth.role() = 'authenticated'::text));
create policy "Org members delete documents" on storage.objects
  for delete
  using ((bucket_id = 'org-documents'::text) AND (auth.role() = 'authenticated'::text));
