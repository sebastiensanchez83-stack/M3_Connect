-- DOWN for supabase/migrations/20261009190000_company_messaging.sql
--
-- Removes company messaging. Run it only together with a client that no longer
-- uses it (the refonte's Messages screen, the company page's "Send a message" and
-- the messages-digest edge function), and undeploy messages-digest first.
--
-- DATA LOSS: every conversation message, read marker, report and digest log row is
-- dropped, and partner_requests loses origin / auto_connected. Requests that were
-- auto-connected stay 'accepted' (with answered_by_user_id null): the old client
-- shows them as accepted connections, which they are. Export the four tables first
-- if anything must be kept:
--   copy (select * from public.conversation_messages) to stdout with csv header;  -- etc.

-- The Friday job
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'messages-digest-friday';

-- RPCs and helpers
DROP FUNCTION IF EXISTS public.invoke_messages_digest();
DROP FUNCTION IF EXISTS public.msg_digest_batch(date, integer);
DROP FUNCTION IF EXISTS public.msg_mark_read(uuid);
DROP FUNCTION IF EXISTS public.msg_thread(uuid);
DROP FUNCTION IF EXISTS public.msg_conversations();
DROP FUNCTION IF EXISTS public.msg_unread_count();
DROP FUNCTION IF EXISTS public.msg_unread_items(uuid, timestamptz);

-- Tables (their policies, triggers and indexes go with them)
DROP TABLE IF EXISTS public.digest_log;
DROP TABLE IF EXISTS public.conversation_reports;
DROP TABLE IF EXISTS public.conversation_reads;
DROP TABLE IF EXISTS public.conversation_messages;
DROP FUNCTION IF EXISTS public.conversation_reports_before_write();
DROP FUNCTION IF EXISTS public.msg_report_excerpt(uuid);
DROP FUNCTION IF EXISTS public.conversation_messages_before_insert();

-- partner_requests: policy, triggers, columns, indexes
DROP POLICY IF EXISTS partner_requests_select_sender_org ON public.partner_requests;
DROP TRIGGER IF EXISTS trg_partner_requests_msg_insert ON public.partner_requests;
DROP TRIGGER IF EXISTS trg_partner_requests_msg_update ON public.partner_requests;
DROP FUNCTION IF EXISTS public.partner_requests_msg_before_insert();
DROP FUNCTION IF EXISTS public.partner_requests_msg_before_update();

DROP FUNCTION IF EXISTS public.msg_pair_open_request(uuid, uuid);
DROP FUNCTION IF EXISTS public.msg_orgs_sectors_match(uuid, uuid);
DROP FUNCTION IF EXISTS public.msg_can_write(uuid, uuid);
DROP FUNCTION IF EXISTS public.msg_my_side_org(uuid);
DROP FUNCTION IF EXISTS public.msg_can_access(uuid);
DROP FUNCTION IF EXISTS public.msg_side(uuid, uuid);
DROP FUNCTION IF EXISTS public.msg_user_org_ids(uuid);

DROP INDEX IF EXISTS public.partner_requests_sender_created_idx;
DROP INDEX IF EXISTS public.partner_requests_org_pair_idx;
DROP INDEX IF EXISTS public.partner_requests_marina_org_status_idx;

ALTER TABLE public.partner_requests DROP CONSTRAINT IF EXISTS partner_requests_origin_check;
ALTER TABLE public.partner_requests
  DROP COLUMN IF EXISTS origin,
  DROP COLUMN IF EXISTS auto_connected;
