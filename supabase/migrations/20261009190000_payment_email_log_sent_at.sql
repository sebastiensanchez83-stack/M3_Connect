-- payment_email_log: record WHEN the e-mail went out, not only that it was claimed.
--
-- NOT APPLIED. Written by the reliability lane (branch rf-rel, 9 Oct 2026, review fixes).
-- Needs 20261009180000_payment_email_log.sql (applied 9 Oct 2026). Apply it BEFORE
-- deploying the payment-ipn of this branch; the payment-ipn live now (v13) ignores the
-- new column, so applying it first changes nothing for it. Down script:
-- supabase/migrations/down/20261009190000_payment_email_log_sent_at.down.sql. Dry run:
-- supabase/dryrun/20261009190000_payment_email_log_sent_at.dryrun.sql.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Why
-- ════════════════════════════════════════════════════════════════════════════
-- payment-ipn sends a payment e-mail only when its insert of (payment_id, status)
-- succeeds. Until now a second notification for the same payment and status (Lyra
-- retrying after a time-out while the first request is still sending) found the key
-- and was answered 200 at once. If the first request's e-mail then failed, it gave
-- the key back and answered 500, but Lyra already held a 200: nothing retried, and
-- the e-mail was never sent. Likewise a request that died half way (time-out, crash)
-- kept the key forever.
--
-- With sent_at, payment-ipn tells the cases apart:
--   - sent_at set: the e-mail went out, answer 200;
--   - sent_at empty, claimed under 10 minutes ago: another request is sending,
--     answer 503 so that Lyra tries again later;
--   - sent_at empty, claimed over 10 minutes ago: that request died; take the key
--     over (a conditional update of created_at, so only one request can) and send.
--
-- ════════════════════════════════════════════════════════════════════════════
-- What
-- ════════════════════════════════════════════════════════════════════════════
--   - a nullable column sent_at;
--   - rows already there are marked sent (sent_at = created_at): the payment-ipn
--     deployed until now deletes the row of an e-mail that failed for a passing
--     reason, so a row means the e-mail went out (or could never go out, e.g. no
--     address). On 9 Oct 2026 the table had 0 rows and public.payments had 0 rows;
--   - service_role may UPDATE these two columns only (sent_at, created_at). It keeps
--     select, insert and delete; anon and authenticated still have nothing, and RLS
--     stays on with no policy.
-- Nothing else changes, and the live client (main) never reads this table.

alter table public.payment_email_log add column if not exists sent_at timestamptz;

comment on column public.payment_email_log.sent_at is
  'payment-ipn: when the e-mail was handed to send-notification. Empty = being sent (or abandoned if the row is over 10 minutes old).';

update public.payment_email_log set sent_at = created_at where sent_at is null;

grant update (sent_at, created_at) on table public.payment_email_log to service_role;
