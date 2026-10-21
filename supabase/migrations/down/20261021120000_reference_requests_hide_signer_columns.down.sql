-- DOWN for supabase/migrations/20261021120000_reference_requests_hide_signer_columns.sql
-- Gives anon and authenticated their table-level SELECT back and drops their column grants:
-- visitors and signed-in accounts read confirmed_signer_email and verification_code again.
-- Harmless for main and refonte (both read named columns only).

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if has_table_privilege('anon', 'public.reference_requests', 'select')
     or has_table_privilege('authenticated', 'public.reference_requests', 'select') then
    raise exception 'reference_requests down: anon or authenticated already holds table-level SELECT (nothing to undo)';
  end if;
end
$pre$;

-- A table-level REVOKE also removes these roles' column grants.
revoke select on table public.reference_requests from anon, authenticated;
grant select on table public.reference_requests to anon, authenticated;
