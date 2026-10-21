-- SUPERSEDED on 21 Oct 2026 by supabase/migrations/held/directory_visitor_basic.sql (go-live runbook P4,
-- Victor's answers of 21 Oct 2026), which contains both statements of this file and more.
-- DO NOT APPLY OR RUN THIS FILE. Kept for the record only.
-- The statement below stops any run of it at once (privacy review of 21 Oct 2026, finding 2).
do $superseded$ begin raise exception 'directory_signed_in_only: SUPERSEDED by supabase/migrations/held/directory_visitor_basic.sql (21 Oct 2026); never run this file'; end $superseded$;
--
-- DOWN for supabase/migrations/held/directory_signed_in_only.sql: signed-out visitors read team
-- members and validated marinas' details again, exactly as before (policies recreated as they were
-- on 15 Oct 2026).

set local lock_timeout = '5s';
set local statement_timeout = '120s';

drop policy if exists org_members_select_public on public.organization_members;
create policy org_members_select_public on public.organization_members for select to anon using (true);
alter policy marina_details_public_read on public.organization_marina_details to public;
