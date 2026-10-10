-- DOWN for supabase/migrations/20261009190001_messages_digest_cron.sql
--
-- Stops the Friday messages digest: the pg_cron job goes, nothing else. Messages,
-- read markers and digest_log stay. To stop sending at once without this file,
-- undeploying the messages-digest edge function has the same effect.

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'messages-digest-friday';
