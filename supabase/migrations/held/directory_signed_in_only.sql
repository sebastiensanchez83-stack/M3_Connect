-- HELD for the go-live of the redesign: NOT a normal migration. Spec §9 ("org_members_select_public,
-- marina_details_public_read -> authenticated, no longer anon") and §15 Phase 3; Victor, 6 Oct 2026:
-- "company cards public; people (teams) and marina details for signed-in only".
-- Held because the OLD live client (main) reads both SIGNED OUT, checked on 15 Oct 2026:
--   - src/pages/DirectoryPage.tsx counts each company's members with organization_members (the
--     /directory route is public);
--   - src/pages/OrganizationPublicPage.tsx (/organizations/:slug, public) reads organization_members
--     for the member count in the header and the "More for verified members" card, and
--     organization_marina_details for that card's "The marina's detailed profile" line.
--   With this file a signed-out visitor of main would see no member counts and a shorter card
--   (no error: the reads come back empty). The redesign reads them the same way today.
-- get_public_profiles is NOT here: neither client calls it signed out, so 20261016090000 already
-- revoked it from anon.
-- Before applying: the redesign's signed-out member counts read org_public_member_counts()
-- (20261016090000) instead of organization_members (contract §11.6); grep src for
-- "from('organization_members')" and "organization_marina_details" on pages reachable signed out.
-- Down: supabase/migrations/down/directory_signed_in_only.down.sql.
-- Dry run: supabase/dryrun/directory_signed_in_only.dryrun.sql.

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $pre$
begin
  if to_regprocedure('public.org_public_member_counts(uuid[])') is null then
    raise exception 'directory_signed_in_only: apply 20261016090000_review_and_validation_orgs first (org_public_member_counts)';
  end if;
  if not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'organization_members'
                  and p.policyname = 'org_members_select_public' and p.roles = '{anon}' and p.cmd = 'SELECT' and p.qual = 'true')
     and exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'organization_members'
                  and p.policyname = 'org_members_select_public') then
    raise exception 'directory_signed_in_only: org_members_select_public changed; rebuild this file';
  end if;
  if not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'organization_marina_details'
                  and p.policyname = 'marina_details_public_read' and p.cmd = 'SELECT'
                  and p.qual like '%organizations o%' and p.qual like '%access_status = ''verified''%') then
    raise exception 'directory_signed_in_only: marina_details_public_read changed; rebuild this file';
  end if;
  if not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'organization_members'
                  and p.policyname = 'org_members_select_auth' and p.roles = '{authenticated}' and p.qual = 'true') then
    raise exception 'directory_signed_in_only: org_members_select_auth is missing; signed-in visitors would lose the teams';
  end if;
end
$pre$;

-- Teams: signed-in visitors keep org_members_select_auth (any status); anon reads nothing.
drop policy if exists org_members_select_public on public.organization_members;
-- Marina details of validated marinas: signed-in visitors only (any status).
alter policy marina_details_public_read on public.organization_marina_details to authenticated;
