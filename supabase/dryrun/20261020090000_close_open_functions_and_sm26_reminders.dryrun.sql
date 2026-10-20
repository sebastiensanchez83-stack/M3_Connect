-- DRY RUN of supabase/migrations/20261020090000_close_open_functions_and_sm26_reminders.sql
-- and of its down. NOT A MIGRATION. ONE query text, ONE execute_sql call, BEFORE the file is applied.
-- A snapshot, the migration verbatim, checks, the down verbatim, checks again. The down's anon key
-- is read from the live sm26-remind-7d job before the migration removes it (never written here).
-- Ends with RAISE EXCEPTION 'DRYRUN ...': everything rolls back. Expected: "12 PASS, 0 FAIL".

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- A. Snapshot
create temp table _dr_res (n serial, ok boolean, label text) on commit drop;
create temp table _dr_cron on commit drop as
  select j.jobname, j.schedule, md5(j.command) as m, j.username, j.database, j.active from cron.job j;
create temp table _dr_acl on commit drop as
  select p.oid::regprocedure::text as fn, coalesce(array_to_string(p.proacl, ','), '') as acl
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname not in ('cleanup_guest_rate_limits', 'invoke_guest_webinar_reminders');
select set_config('m3.anon_key', (select substring(j.command from 'apikey'',''([^'']+)''') from cron.job j where j.jobname = 'sm26-remind-7d'), true);

-- B. The migration, verbatim
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

-- C. Checks after the migration
do $c$
declare
  v_state text;
  v_txt text;
begin
  insert into _dr_res (ok, label) select
    not bool_or(has_function_privilege('anon', f.fn, 'execute') or has_function_privilege('authenticated', f.fn, 'execute')
      or exists (select 1 from aclexplode((select p.proacl from pg_proc p where p.oid = f.fn::regprocedure)) a where a.grantee = 0)),
    'C1 anon, authenticated and PUBLIC lost EXECUTE on both: ' || string_agg((select p.proacl::text from pg_proc p where p.oid = f.fn::regprocedure), ' ')
    from unnest(array['public.cleanup_guest_rate_limits()', 'public.invoke_guest_webinar_reminders()']) as f(fn);
  insert into _dr_res (ok, label) select
    bool_and(has_function_privilege('postgres', f.fn, 'execute') and has_function_privilege('service_role', f.fn, 'execute')),
    'C2 postgres (owner, cron) and service_role keep EXECUTE on both'
    from unnest(array['public.cleanup_guest_rate_limits()', 'public.invoke_guest_webinar_reminders()']) as f(fn);
  begin
    set local role anon;
    perform public.cleanup_guest_rate_limits();
    v_state := 'no error';
  exception when others then v_state := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  insert into _dr_res (ok, label) values (v_state like '42501 permission denied for function%', 'C3 anon calling cleanup_guest_rate_limits() -> ' || v_state);
  begin
    set local role authenticated;
    perform public.invoke_guest_webinar_reminders();
    v_state := 'no error';
  exception when others then v_state := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  insert into _dr_res (ok, label) values (v_state like '42501 permission denied for function%', 'C4 authenticated calling invoke_guest_webinar_reminders() -> ' || v_state);
  select string_agg(j.jobname || ' as ' || j.username, ', ') into v_txt from cron.job j
   where (j.command ilike '%cleanup_guest_rate_limits%' and has_function_privilege(j.username, 'public.cleanup_guest_rate_limits()', 'execute'))
      or (j.command ilike '%invoke_guest_webinar_reminders%' and has_function_privilege(j.username, 'public.invoke_guest_webinar_reminders()', 'execute'));
  insert into _dr_res (ok, label) values ((select count(*) from cron.job j where j.command ilike '%cleanup_guest_rate_limits%' or j.command ilike '%invoke_guest_webinar_reminders%') = 2
      and v_txt like '%guest-webinar-reminders-hourly%' and v_txt like '%guest-signup-rate-limit-cleanup%', 'C5 cron callers keep EXECUTE: ' || coalesce(v_txt, 'none'));
  insert into _dr_res (ok, label) values (not exists (select 1 from cron.job j where j.jobname like 'sm26-%')
      and not exists ((select jobname, schedule, m, username, database, active from _dr_cron where jobname not like 'sm26-%')
                      except (select j.jobname, j.schedule, md5(j.command), j.username, j.database, j.active from cron.job j))
      and (select count(*) from cron.job) = (select count(*) from _dr_cron) - 2,
    'C6 both sm26-remind jobs gone, the other ' || ((select count(*) from _dr_cron) - 2) || ' jobs unchanged');
  insert into _dr_res (ok, label) values (not exists ((select fn, acl from _dr_acl) except
      (select p.oid::regprocedure::text, coalesce(array_to_string(p.proacl, ','), '') from pg_proc p where p.pronamespace = 'public'::regnamespace)),
    'C7 every other public function ACL unchanged');
  select string_agg(h.check_id || '=' || h.status || ' (' || h.summary || ')', '; ') into v_txt
    from public.ops_health_checks() h where h.check_id in ('security.open_functions', 'cron.dormant_sm26');
  insert into _dr_res (ok, label) values (v_txt like '%security.open_functions=ok%' and v_txt like '%No SM26 job left scheduled%', 'C8 health: ' || v_txt);
end
$c$;

-- D. The down, verbatim (m3.anon_key set in A)
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

-- E. Checks after the down
do $e$
declare
  v_txt text;
begin
  insert into _dr_res (ok, label) values ((select count(*) from cron.job j
      where (j.jobname, j.schedule, md5(j.command), j.username, j.database, j.active) in
            (select jobname, schedule, m, username, database, active from _dr_cron where jobname like 'sm26-%')) = 2,
    'E1 down re-created sm26-remind-7d and -1d with the recorded schedule, command md5, user, database, active');
  insert into _dr_res (ok, label) values (not exists ((select jobname, schedule, m, username, database, active from _dr_cron)
      except (select j.jobname, j.schedule, md5(j.command), j.username, j.database, j.active from cron.job j))
      and (select count(*) from cron.job) = (select count(*) from _dr_cron), 'E2 cron table back to the snapshot (jobids aside)');
  insert into _dr_res (ok, label) select
    bool_and(has_function_privilege('anon', f.fn, 'execute') and has_function_privilege('authenticated', f.fn, 'execute')
      and exists (select 1 from aclexplode((select p.proacl from pg_proc p where p.oid = f.fn::regprocedure)) a where a.grantee = 0)
      and has_function_privilege('service_role', f.fn, 'execute')),
    'E3 down restored EXECUTE to PUBLIC, anon, authenticated: ' || string_agg((select p.proacl::text from pg_proc p where p.oid = f.fn::regprocedure), ' ')
    from unnest(array['public.cleanup_guest_rate_limits()', 'public.invoke_guest_webinar_reminders()']) as f(fn);
  insert into _dr_res (ok, label) values (not exists ((select fn, acl from _dr_acl) except
      (select p.oid::regprocedure::text, coalesce(array_to_string(p.proacl, ','), '') from pg_proc p where p.pronamespace = 'public'::regnamespace)),
    'E4 every other public function ACL still unchanged');
  select string_agg(case when r.ok then 'PASS ' else 'FAIL ' end || r.label, chr(10) order by r.n) into v_txt from _dr_res r;
  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (close_open_functions_and_sm26_reminders, run %s)',
    (select count(*) from _dr_res where ok), (select count(*) from _dr_res where ok is not true), now()) || chr(10) || v_txt;
end
$e$;
