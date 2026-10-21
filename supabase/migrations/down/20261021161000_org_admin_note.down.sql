-- DOWN of supabase/migrations/20261021161000_org_admin_note.sql.
-- Removes the three objects it added; nothing else existed before. The notes written in the
-- meantime are lost with the table (export them first if they matter). Join requests answered
-- through admin_decide_join_request stay answered (their review_log rows stay too).

set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop function if exists public.admin_decide_join_request(uuid, boolean, text);
drop policy if exists org_audit_staff_read on public.organization_audit_log;
drop table if exists public.org_admin_note;
