-- Close the two internal functions anyone could call, and drop the two SM26 reminder jobs
-- (20 Oct 2026, Victor: "go pour la 1"). Independent of every other file; any order.
-- Down: supabase/migrations/down/20261020090000_close_open_functions_and_sm26_reminders.down.sql.
-- Dry run: supabase/dryrun/20261020090000_close_open_functions_and_sm26_reminders.dryrun.sql
-- (runs this file, then the down, in one rolled-back transaction).
--
-- 1. public.cleanup_guest_rate_limits() and public.invoke_guest_webinar_reminders() are
--    SECURITY DEFINER (owner postgres) and were EXECUTE-able by PUBLIC, anon and authenticated:
--    anyone holding the publishable key could purge the guest sign-up rate limits or fire the
--    webinar reminder call at will (ops_health_report: security.open_functions).
--    Their callers (production, read 20 Oct): pg_cron jobs guest-webinar-reminders-hourly and
--    guest-signup-rate-limit-cleanup, both run as postgres, the owner, which keeps EXECUTE.
--    No SQL function calls them (invoke_send_profile_reminders names one in a comment,
--    ops_health_checks only in LIKE patterns), no edge function, and no client: neither main nor
--    the redesign has rpc('cleanup_guest_rate_limits') or rpc('invoke_guest_webinar_reminders').
--    The service role keeps EXECUTE.
-- 2. pg_cron jobs sm26-remind-7d ('0 8 13 9 *') and sm26-remind-1d ('0 8 19 9 *') post to the
--    sm26-reminders edge function for Smart Marina 2026, which is over; left in place they fire
--    again on 13 and 19 September 2027. Unscheduled here; the down re-creates them byte for byte.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
declare
  v_bad text;
  v_n integer;
begin
  -- The functions as read on 20 Oct.
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.cleanup_guest_rate_limits()'))
       is distinct from '8e84ac0adb560fe3ac442b92d5ed1e46'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.invoke_guest_webinar_reminders()'))
       is distinct from '2564c454d3a324caea2ea162eab4ae42' then
    raise exception 'close_open_functions: a function changed since 20 Oct; check its callers again';
  end if;
  -- No other SQL function names them (a new caller could be SECURITY INVOKER and lose them).
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) into v_bad
    from pg_proc p
   where p.prolang <> (select l.oid from pg_language l where l.lanname = 'c')
     and (p.prosrc ilike '%cleanup_guest_rate_limits%' or p.prosrc ilike '%invoke_guest_webinar_reminders%')
     and p.oid not in (to_regprocedure('public.cleanup_guest_rate_limits()'), to_regprocedure('public.invoke_guest_webinar_reminders()'),
                       to_regprocedure('public.invoke_send_profile_reminders()'), to_regprocedure('public.ops_health_checks()'));
  if v_bad is not null then
    raise exception 'close_open_functions: unexpected SQL caller(s): %', v_bad;
  end if;
  -- The two SM26 jobs exactly as recorded (the down re-creates these).
  select count(*) into v_n from cron.job j
   where (j.jobname, j.schedule, md5(j.command), j.username, j.database, j.active) in
         (('sm26-remind-7d', '0 8 13 9 *', 'b363fd02534ca4fd9456f3b6a7690a16', 'postgres', 'postgres', true),
          ('sm26-remind-1d', '0 8 19 9 *', '92b52ad11ecdd56147773e237c1af3f0', 'postgres', 'postgres', true));
  if v_n <> 2 or (select count(*) from cron.job j where j.jobname like 'sm26-%') <> 2 then
    raise exception 'close_open_functions: the SM26 cron jobs are not as recorded on 20 Oct';
  end if;
end
$pre$;

revoke execute on function public.cleanup_guest_rate_limits() from public, anon, authenticated;
revoke execute on function public.invoke_guest_webinar_reminders() from public, anon, authenticated;
grant execute on function public.cleanup_guest_rate_limits() to service_role;
grant execute on function public.invoke_guest_webinar_reminders() to service_role;

select cron.unschedule('sm26-remind-7d');
select cron.unschedule('sm26-remind-1d');

-- After: closed to the API, open to the owner, the service role and every cron job that calls
-- them; no SM26 job left (else the whole file rolls back).
do $post$
declare
  v_bad text;
begin
  select string_agg(f.fn, ', ') into v_bad
    from unnest(array['public.cleanup_guest_rate_limits()', 'public.invoke_guest_webinar_reminders()']) as f(fn)
   where has_function_privilege('anon', f.fn, 'execute')
      or has_function_privilege('authenticated', f.fn, 'execute')
      or exists (select 1 from aclexplode((select p.proacl from pg_proc p where p.oid = f.fn::regprocedure)) a where a.grantee = 0)
      or not has_function_privilege('postgres', f.fn, 'execute')
      or not has_function_privilege('service_role', f.fn, 'execute');
  if v_bad is not null then
    raise exception 'close_open_functions: wrong privileges on %', v_bad;
  end if;
  select string_agg(j.jobname, ', ') into v_bad
    from cron.job j
   where (j.command ilike '%cleanup_guest_rate_limits%' and not has_function_privilege(j.username, 'public.cleanup_guest_rate_limits()', 'execute'))
      or (j.command ilike '%invoke_guest_webinar_reminders%' and not has_function_privilege(j.username, 'public.invoke_guest_webinar_reminders()', 'execute'));
  if v_bad is not null then
    raise exception 'close_open_functions: cron job(s) would lose their function: %', v_bad;
  end if;
  if exists (select 1 from cron.job j where j.jobname like 'sm26-%') then
    raise exception 'close_open_functions: an SM26 cron job is still scheduled';
  end if;
end
$post$;
