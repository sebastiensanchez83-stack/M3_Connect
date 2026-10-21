-- DOWN for supabase/migrations/20261021120100_org_documents_members_only_read.sql
-- Puts back the open read policy: every signed-in account lists and reads every file of
-- org-documents again. Harmless for main and refonte (they read their own folder only).

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if exists (select 1 from pg_policies p
              where p.schemaname = 'storage' and p.tablename = 'objects' and p.policyname = 'Org members read documents') then
    raise exception 'org-documents down: "Org members read documents" exists already (nothing to undo)';
  end if;
end
$pre$;

create policy "Org members read documents" on storage.objects
  for select
  using ((bucket_id = 'org-documents'::text) AND (auth.role() = 'authenticated'::text));
