-- DOWN for supabase/migrations/20261009180000_payment_email_log.sql.
--
-- Drops the idempotency table of payment-ipn. Run it only AFTER payment-ipn has been
-- rolled back to a version that does not use it, or accept that the new payment-ipn
-- then sends no payment e-mail (it logs "table public.payment_email_log is missing",
-- answers 503 and never sends a duplicate). The rows only record which e-mails went
-- out: nothing else depends on them.

drop table if exists public.payment_email_log;
