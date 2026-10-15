-- DOWN for supabase/migrations/20261016093000_log_org_event_definer_only.sql
-- Puts back production's EXECUTE on public.log_org_event (PUBLIC, anon, authenticated; the
-- service role and the owner kept it). Any time.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

grant execute on function public.log_org_event(uuid, text, jsonb) to public, anon, authenticated;
