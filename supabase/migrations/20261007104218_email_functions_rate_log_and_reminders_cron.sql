-- E-mail edge functions: rate log + authenticated nightly reminder run.
-- Audit items S4 / S9 (Phase 0, security), track "email-functions", 7 Oct 2026.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Why
-- ════════════════════════════════════════════════════════════════════════════
-- Four edge functions sent e-mail for callers they never checked:
--   notify-admins            public; forwarded caller text to every admin and
--                            answered with the list of admin addresses (S4)
--   send-status-notification public; fake "account rejected" + free text to any
--                            member (S9)
--   send-profile-reminders   public; anyone could start a reminder round (S9)
--   send-notification        any signed-in account could send any template to
--                            any address with unescaped caller text (S9)
-- The functions are fixed in the repo (same commit). This migration provides the
-- two database pieces they need:
--
-- PART 1. public.email_rate_log -- one row per member-triggered e-mail
--   (send-notification) and per member / sign-up admin alert (notify-admins), so
--   the functions can refuse duplicates and cap a member's volume. Written and
--   read only with the service role: RLS on, no policy, no grant to anon /
--   authenticated. Rows are tiny (dozens a day); actor_id cascades with the
--   auth user. Kept separate from notification_sends so reminder statistics and
--   the reminder cooldown query are unchanged.
--   send-notification also logs one "org-email:<organization id>" row per e-mail
--   that names an organisation M3 has not verified (team invitations and join
--   request answers), capped at 5 per organisation and 50 in total per 24 h; the
--   (kind, created_at) index serves those counts.
--   The per-member caps fail OPEN if this table is missing (they log an error and
--   still send, relationship checks still apply). The unverified-organisation cap
--   fails CLOSED (such e-mails are refused until the table exists; production has
--   never sent one). So apply this BEFORE deploying send-notification.
--
-- PART 2. send-profile-reminders now requires the service role. Job 4
--   "nightly-profile-reminders" called it with NO credentials
--   (net.http_post with only Content-Type), so it would get 401 from the new
--   function. The job now calls public.invoke_send_profile_reminders(), the same
--   pattern as public.invoke_guest_webinar_reminders() (job 1, working since
--   April): read project_url + service_role_key from Vault and POST with
--   "Authorization: Bearer <service_role_key>". The key never appears in
--   cron.job.command. The function accepts that key if it equals its own env key,
--   or if GoTrue accepts it as a service-role JWT on an admin endpoint.
--   EXECUTE on the invoker is revoked from PUBLIC / anon / authenticated:
--   otherwise POST /rest/v1/rpc/invoke_send_profile_reminders would re-open the
--   very hole being closed. (Note: invoke_guest_webinar_reminders() and
--   cleanup_guest_rate_limits() ARE executable by anon today -- reported to the
--   lead, not changed here.)
--   Same schedule as before: 08:00 UTC daily. Same job name (cron.schedule with an
--   existing name updates that job in place, pg_cron 1.6.4).
--
-- No SM26 (sm_*) or WYS (gl_*) object is read or written.
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
-- CREATE OR REPLACE FUNCTION, cron.schedule upsert by name.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Checks after applying (read-only)
-- ════════════════════════════════════════════════════════════════════════════
--   select jobid, jobname, schedule, command from cron.job where jobname = 'nightly-profile-reminders';
--     -> command = 'SELECT public.invoke_send_profile_reminders();'
--   select has_function_privilege('anon', 'public.invoke_send_profile_reminders()', 'execute');  -> false
--   select has_function_privilege('authenticated', 'public.invoke_send_profile_reminders()', 'execute');  -> false
--   select has_table_privilege('anon', 'public.email_rate_log', 'select');  -> false
--   Next morning: select status_code from net._http_response order by created desc limit 5;
--     (the 08:00 call must be 200) and notification_sends gets its usual rows.
--
-- ════════════════════════════════════════════════════════════════════════════
-- UNDO
-- ════════════════════════════════════════════════════════════════════════════
--   -- restore the old job (only together with redeploying the OLD public
--   -- send-profile-reminders, otherwise the job gets 401 every morning):
--   SELECT cron.schedule('nightly-profile-reminders', '0 8 * * *', $cmd$
--     SELECT net.http_post(
--       url := 'https://djjbgzasuomhyfvtlidi.supabase.co/functions/v1/send-profile-reminders',
--       headers := '{"Content-Type": "application/json"}'::jsonb,
--       body := '{}'::jsonb
--     );
--   $cmd$);
--   DROP FUNCTION IF EXISTS public.invoke_send_profile_reminders();
--   DROP TABLE IF EXISTS public.email_rate_log;   -- per-member caps fail open without it;
--                                                 -- unverified-organisation e-mails are refused

-- ─── PART 1: rate log ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.email_rate_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id   uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.email_rate_log IS
  'One row per member-triggered e-mail (send-notification, notify-admins), plus one org-email:<org id> row per e-mail naming an unverified organisation. Service role only. Used for de-duplication, per-member and per-organisation caps. Audit S4/S9, 2026-10-07.';

CREATE INDEX IF NOT EXISTS email_rate_log_actor_kind_created_idx
  ON public.email_rate_log (actor_id, kind, created_at DESC);

-- kind = 'org-email:<id>' and kind LIKE 'org-email:%' (text_pattern_ops serves both).
CREATE INDEX IF NOT EXISTS email_rate_log_kind_created_idx
  ON public.email_rate_log (kind text_pattern_ops, created_at DESC);

ALTER TABLE public.email_rate_log ENABLE ROW LEVEL SECURITY;
-- No policy on purpose: only the service role (which bypasses RLS) uses it.

REVOKE ALL ON TABLE public.email_rate_log FROM PUBLIC;
REVOKE ALL ON TABLE public.email_rate_log FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.email_rate_log TO service_role;

-- ─── PART 2: authenticated nightly reminder run ─────────────────────────────

CREATE OR REPLACE FUNCTION public.invoke_send_profile_reminders()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'vault', 'pg_temp'
AS $function$
DECLARE
  v_url TEXT;
  v_key TEXT;
BEGIN
  -- Same Vault secrets as invoke_guest_webinar_reminders(); exit quietly if missing.
  BEGIN
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1;
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'invoke_send_profile_reminders: vault read failed: %', SQLERRM;
    RETURN;
  END;

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE 'invoke_send_profile_reminders: vault secrets not configured; skipping';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url || '/functions/v1/send-profile-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := '{}'::jsonb,
    -- The reminder run takes longer than pg_net's 5 s default (the old job already
    -- logged 'Timeout of 5000 ms reached' while finishing its work).
    timeout_milliseconds := 60000
  );
END;
$function$;

COMMENT ON FUNCTION public.invoke_send_profile_reminders() IS
  'pg_cron job nightly-profile-reminders: POST send-profile-reminders with the Vault service_role_key. Not callable by anon/authenticated. Audit S9, 2026-10-07.';

REVOKE ALL ON FUNCTION public.invoke_send_profile_reminders() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invoke_send_profile_reminders() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_send_profile_reminders() TO service_role;

SELECT cron.schedule(
  'nightly-profile-reminders',
  '0 8 * * *',
  $cmd$SELECT public.invoke_send_profile_reminders();$cmd$
);
