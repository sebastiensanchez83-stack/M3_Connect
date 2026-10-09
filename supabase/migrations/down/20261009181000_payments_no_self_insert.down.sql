-- DOWN for supabase/migrations/20261009181000_payments_no_self_insert.sql.
--
-- Puts back the policy exactly as it was in production on 9 Oct 2026 (pg_policies:
-- PERMISSIVE, INSERT, roles {public}, with_check (user_id = auth.uid())). Doing so
-- reopens the hole the migration describes: any signed-in account can then insert a
-- payments row with any status, "paid" included.

drop policy if exists payments_insert_own on public.payments;
create policy payments_insert_own on public.payments
  as permissive
  for insert
  to public
  with check (user_id = auth.uid());
