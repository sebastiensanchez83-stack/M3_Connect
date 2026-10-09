-- One payment e-mail per (payment, status): the idempotency key of payment-ipn.
--
-- NOT APPLIED. Written by the reliability lane (branch rf-rel, 9 Oct 2026). Apply it
-- BEFORE deploying the new payment-ipn. Without it payment-ipn still records payments
-- correctly but sends no payment e-mail: it logs "table public.payment_email_log is
-- missing" and answers 503, so that Lyra's retry (if enabled in its back office) sends
-- the e-mail once the table exists. The order matters only for the e-mails. Down script:
-- supabase/migrations/down/20261009180000_payment_email_log.down.sql. Dry run:
-- supabase/dryrun/20261009180000_payment_email_log.dryrun.sql.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Why
-- ════════════════════════════════════════════════════════════════════════════
-- Lyra re-sends an IPN until it gets a 2xx and may send several for one order. The
-- confirmation ("payment_confirmed") and failure ("payment_failed") e-mails must go
-- out once per status change, and an e-mail that failed for a passing reason must go
-- out on Lyra's retry. payment-ipn sends an e-mail only when ITS insert of
-- (payment_id, status) succeeds; the primary key makes a second insert fail (23505),
-- even for two notifications processed at the same moment. When the e-mail could not
-- be sent, payment-ipn deletes its row again and answers 500, so the retry sends it.
--
-- ════════════════════════════════════════════════════════════════════════════
-- What
-- ════════════════════════════════════════════════════════════════════════════
-- One table, service role only: RLS on with no policy, every privilege of anon and
-- authenticated revoked (the schema's default privileges would grant them all), and
-- service_role reduced to what payment-ipn does: select, insert, delete.
-- Nothing else changes: no existing table, policy, function or row is touched, and
-- the live client (main) never reads it. On 9 Oct 2026 public.payments had 0 rows.

create table if not exists public.payment_email_log (
  payment_id uuid not null references public.payments(id) on delete cascade,
  status text not null check (status in ('paid', 'failed')),
  created_at timestamptz not null default now(),
  primary key (payment_id, status)
);

comment on table public.payment_email_log is
  'payment-ipn: one row per payment e-mail sent (payment id + status). The primary key makes the e-mail idempotent. Service role only.';

alter table public.payment_email_log enable row level security;

revoke all on table public.payment_email_log from anon, authenticated;
revoke all on table public.payment_email_log from public, service_role;
grant select, insert, delete on table public.payment_email_log to service_role;
