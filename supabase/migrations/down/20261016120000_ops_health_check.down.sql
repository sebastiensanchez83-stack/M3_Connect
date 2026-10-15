-- DOWN for supabase/migrations/20261016120000_ops_health_check.sql
--
-- Removes the health monitor's database side: the pg_cron job, the three functions, the
-- two memory tables (alert throttle and run history: nothing else reads them), the
-- settings row and its staff-only policy. No other table, row or policy is touched.
-- Undeploy (or leave idle) the ops-health edge function: with this down applied it can
-- no longer read the report and answers ok:false; nothing calls it any more anyway.
-- Faster stop without this file: set platform_settings ops_health.enabled to false.

select cron.unschedule(j.jobid) from cron.job j where j.jobname = 'ops-health';
drop function if exists public.invoke_ops_health();
drop function if exists public.ops_health_report();
drop function if exists public.ops_health_checks();
drop table if exists public.ops_health_alert;
drop table if exists public.ops_health_run;
delete from public.platform_settings where key = 'ops_health';
drop policy if exists platform_settings_ops_health_private on public.platform_settings;
