-- DOWN for supabase/migrations/20261009190000_payment_email_log_sent_at.sql.
--
-- Takes back the UPDATE right of service_role and drops sent_at; the table and its
-- other rights (20261009180000_payment_email_log.sql) stay. Run it only AFTER
-- payment-ipn has been rolled back to a version that does not use sent_at (v13), or
-- accept that the payment-ipn of rf-rel then behaves like v13: it cannot read
-- sent_at, logs it, and treats an existing key as "already e-mailed".

revoke update (sent_at, created_at) on table public.payment_email_log from service_role;

alter table public.payment_email_log drop column if exists sent_at;
