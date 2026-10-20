-- DOWN for supabase/migrations/20261020090000_close_open_functions_and_sm26_reminders.sql
-- Puts back production's EXECUTE on the two functions (PUBLIC, anon, authenticated; the owner
-- and the service role kept it) and re-creates the two SM26 reminder jobs exactly as recorded
-- on 20 Oct (same name, schedule, command, run as the caller: postgres; a new jobid).
--
-- The recorded commands embed the project's publishable (anon) key, which this repository never
-- commits. Put it first in the same query text, then this file:
--   select set_config('m3.anon_key', '<publishable anon key of djjbgzasuomhyfvtlidi>', true);
-- Each command is checked against the md5 recorded before the unschedule; a wrong key refuses.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

grant execute on function public.cleanup_guest_rate_limits() to public, anon, authenticated;
grant execute on function public.invoke_guest_webinar_reminders() to public, anon, authenticated;

do $down$
declare
  v_key text := nullif(current_setting('m3.anon_key', true), '');
  v_7d text;
  v_1d text;
begin
  if v_key is null then
    raise exception 'close_open_functions down: set m3.anon_key first (see the header)';
  end if;
  if exists (select 1 from cron.job j where j.jobname in ('sm26-remind-7d', 'sm26-remind-1d')) then
    raise exception 'close_open_functions down: an sm26-remind job already exists';
  end if;
  v_7d := replace($cmd$
  select net.http_post(
    url := 'https://djjbgzasuomhyfvtlidi.supabase.co/functions/v1/sm26-reminders',
    headers := jsonb_build_object('Content-Type','application/json','apikey','__ANON_KEY__','Authorization','Bearer __ANON_KEY__'),
    body := jsonb_build_object('kind','pre_event_7d','secret',(select secret from sm_cron_secret where name='reminders'))
  );
$cmd$, '__ANON_KEY__', v_key);
  v_1d := replace($cmd$
  select net.http_post(
    url := 'https://djjbgzasuomhyfvtlidi.supabase.co/functions/v1/sm26-reminders',
    headers := jsonb_build_object('Content-Type','application/json','apikey','__ANON_KEY__','Authorization','Bearer __ANON_KEY__'),
    body := jsonb_build_object('kind','pre_event_1d','secret',(select secret from sm_cron_secret where name='reminders'))
  );
$cmd$, '__ANON_KEY__', v_key);
  if md5(v_7d) <> 'b363fd02534ca4fd9456f3b6a7690a16' or md5(v_1d) <> '92b52ad11ecdd56147773e237c1af3f0' then
    raise exception 'close_open_functions down: rebuilt commands differ from the recorded ones (wrong key?)';
  end if;
  perform cron.schedule('sm26-remind-7d', '0 8 13 9 *', v_7d);
  perform cron.schedule('sm26-remind-1d', '0 8 19 9 *', v_1d);
end
$down$;
