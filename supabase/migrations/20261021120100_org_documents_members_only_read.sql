-- Hole 2 of 3 of the go-live runbook (P2.4, Q8 = a), 21 Oct 2026: any signed-in account lists
-- and reads every file of the private org-documents bucket (21 files, 19 listed documents).
-- Down: supabase/migrations/down/20261021120100_org_documents_members_only_read.down.sql
-- Dry run: supabase/dryrun/20261021120100_org_documents_members_only_read.dryrun.sql
--
-- "Org members read documents" only checks auth.role() = 'authenticated'. It is dropped. The
-- strict policy org_documents_select_members stays: staff (is_moderator()) or a member of the
-- company whose id is the first folder of the path.
-- Clients (main 2a332cf8, refonte 02559e58): the only read of the bucket is createSignedUrl right
-- after the member's own upload (main OrganizationTab.tsx:319, refonte orgActions.ts:165), in its
-- own company's folder; the list shows the one-year signed link stored in organization_documents
-- (members and staff only), which needs no storage policy. Nothing else reads this bucket.
-- Writes are hole 3 (20261021120200). No other policy changes.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if not exists (select 1 from pg_policies p
                  where p.schemaname = 'storage' and p.tablename = 'objects'
                    and p.policyname = 'Org members read documents' and p.cmd = 'SELECT'
                    and p.roles = '{public}'::name[] and p.permissive = 'PERMISSIVE'
                    and p.qual = '((bucket_id = ''org-documents''::text) AND (auth.role() = ''authenticated''::text))'
                    and p.with_check is null) then
    raise exception 'org-documents: the policy "Org members read documents" is missing or changed (applied already?)';
  end if;
  if not exists (select 1 from pg_policies p
                  where p.schemaname = 'storage' and p.tablename = 'objects'
                    and p.policyname = 'org_documents_select_members' and p.cmd = 'SELECT'
                    and p.roles = '{authenticated}'::name[] and p.permissive = 'PERMISSIVE'
                    and strpos(p.qual, 'org-documents') > 0 and strpos(p.qual, 'is_moderator()') > 0
                    and strpos(p.qual, 'organization_members') > 0 and strpos(p.qual, 'foldername(objects.name))[1]') > 0) then
    raise exception 'org-documents: the member policy org_documents_select_members is missing or changed';
  end if;
  if (select b.public from storage.buckets b where b.id = 'org-documents') is distinct from false then
    raise exception 'org-documents: the bucket is missing or public';
  end if;
end
$pre$;

drop policy "Org members read documents" on storage.objects;
