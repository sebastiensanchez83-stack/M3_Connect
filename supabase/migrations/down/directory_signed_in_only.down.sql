-- DOWN for supabase/migrations/held/directory_signed_in_only.sql: signed-out visitors read team
-- members and validated marinas' details again, exactly as before (policies recreated as they were
-- on 15 Oct 2026).

set local lock_timeout = '5s';
set local statement_timeout = '120s';

drop policy if exists org_members_select_public on public.organization_members;
create policy org_members_select_public on public.organization_members for select to anon using (true);
alter policy marina_details_public_read on public.organization_marina_details to public;
