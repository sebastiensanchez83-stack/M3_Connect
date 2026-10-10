-- LAUNCH-DAY migration: the Friday messages digest (company messaging, Victor's
-- decisions of 9 Oct 2026). Needs 20261009190000_company_messaging.sql first.
--
-- APPLY IT ONLY ON THE DAY THE REFONTE REPLACES THE OLD SITE on
-- smartmarinaconnect.com, together with the deploy of the messages-digest edge
-- function (verify_jwt = true). Before that day the live site has no Messages
-- screen, still e-mails each request as it arrives (partner_request_received) and
-- ignores /?open=inbox: a digest would announce those requests a second time and
-- send people to a button that does nothing.
--
-- What it does: pg_cron job "messages-digest-friday" at 08:00, 08:30, 09:00 and
-- 09:30 UTC on Fridays. public.invoke_messages_digest() goes ahead only between
-- 10:00 and 10:59 in Monaco (msg_digest_due), so two runs a Friday reach the edge
-- function, at 10:00 and 10:30 Monaco time in summer and in winter alike. The
-- second sends what the first left (its time budget, a send Resend refused);
-- digest_log stops anything from being sent twice.
--
-- Check after applying:
--   select jobname, schedule, command from cron.job where jobname = 'messages-digest-friday';
--     -> '0,30 8,9 * * 5', 'SELECT public.invoke_messages_digest();'
-- UNDO: supabase/migrations/down/20261009190001_messages_digest_cron.down.sql

SELECT cron.schedule(
  'messages-digest-friday',
  '0,30 8,9 * * 5',
  $cmd$SELECT public.invoke_messages_digest();$cmd$
);
