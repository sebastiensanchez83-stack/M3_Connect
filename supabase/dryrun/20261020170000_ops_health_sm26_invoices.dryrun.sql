-- DRY RUN of supabase/migrations/20261020170000_ops_health_sm26_invoices.sql and of its down.
-- NOT A MIGRATION. ONE query text, ONE execute_sql call, BEFORE the file is applied.
-- A snapshot, the migration verbatim, checks, the down verbatim, checks again. Writes NO sm_*
-- row: the invoice cases change only the ops_health BASELINE in platform_settings, inside this
-- transaction, and put the row back before the down. Old and new outputs are compared inside
-- ONE statement (the old body runs as a pg_temp copy of the live one), so a cron run, a pg_net
-- answer or a new connection during the dry run cannot make them differ.
-- Ends with RAISE EXCEPTION 'DRYRUN ...': everything rolls back. Expected: "25 PASS, 0 FAIL".
-- C8 expects today's state (more invoices than the stored baseline, the 6 other tables equal):
-- if it fails, its label shows why the alert would not clear.

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- A. Snapshot
create temp table _dr_res (n serial, ok boolean, label text) on commit drop;
create temp table _dr_fn on commit drop as
  select p.oid as o, p.oid::regprocedure::text as fn, coalesce(array_to_string(p.proacl, ','), '') as acl, md5(p.prosrc) as m
    from pg_proc p where p.pronamespace = 'public'::regnamespace;
create function pg_temp._dr_meta() returns text language sql stable as $m$
  select concat_ws(' | ', p.oid, pg_get_userbyid(p.proowner), p.prosecdef, p.provolatile, p.proparallel, p.proleakproof,
           p.proisstrict, p.procost, p.prorows, l.lanname, p.prokind, array_to_string(p.proconfig, ';'),
           coalesce(p.proacl::text, 'null'), pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid),
           coalesce(obj_description(p.oid, 'pg_proc'), 'no comment'))
    from pg_proc p join pg_language l on l.oid = p.prolang
   where p.oid = to_regprocedure('public.ops_health_checks()')
$m$;
create temp table _dr_old on commit drop as
  select p.prosrc as src, md5(p.prosrc) as m, md5(pg_get_functiondef(p.oid)) as def_m, pg_temp._dr_meta() as meta
    from pg_proc p where p.oid = to_regprocedure('public.ops_health_checks()');
create temp table _dr_ps on commit drop as
  select ps.value, ps.updated_at, ps.updated_by, ps::text as row_txt from public.platform_settings ps where ps.key = 'ops_health';
create temp table _dr_before on commit drop as select * from public.ops_health_checks();

-- The live body, copied before the migration replaces it: the "old" side of every comparison.
do $a$
begin
  execute format('create function pg_temp._dr_old_checks() returns table (check_id text, area text, status text, summary text, detail jsonb) '
                 || 'language sql stable set search_path to %L, %L as %L', 'public', 'pg_temp', (select o.src from _dr_old o));
end
$a$;

-- Check ids whose row differs between the live function and the old copy, in ONE statement
-- (p_skip: a check id left out). db.size reads the disk at each call: its bytes may move by 1 MB.
create function pg_temp._dr_diff(p_skip text) returns text language sql stable as $d$
  select coalesce(string_agg(coalesce(n.check_id, o.check_id), ', ' order by coalesce(n.check_id, o.check_id)), '')
    from public.ops_health_checks() n
    full join pg_temp._dr_old_checks() o on o.check_id = n.check_id
   where coalesce(n.check_id, o.check_id) is distinct from p_skip
     and (n.check_id is null or o.check_id is null or n.area is distinct from o.area or n.status is distinct from o.status
          or n.summary is distinct from o.summary
          or case when n.check_id = 'db.size' then abs((n.detail ->> 'bytes')::numeric - (o.detail ->> 'bytes')::numeric) > 1048576
                  else n.detail is distinct from o.detail end)
$d$;

-- Sets the stored SM26 baseline (p_set; p_base null = no sm26 key), then returns the
-- drift.sm26_archive row of the live function and of the old copy, from ONE statement.
create function pg_temp._dr_sm26(p_set boolean, p_base jsonb)
returns table (n_status text, n_summary text, n_detail jsonb, o_status text, o_summary text, o_detail jsonb, same_row boolean)
language plpgsql as $s$
begin
  if p_set then
    update public.platform_settings ps
       set value = case when p_base is null then ps.value #- '{baseline,sm26}' else jsonb_set(ps.value, '{baseline,sm26}', p_base) end
     where ps.key = 'ops_health';
  end if;
  return query
    select n.status, n.summary, n.detail, o.status, o.summary, o.detail,
           (n.status, n.summary, n.detail) is not distinct from (o.status, o.summary, o.detail)
      from public.ops_health_checks() n cross join pg_temp._dr_old_checks() o
     where n.check_id = 'drift.sm26_archive' and o.check_id = 'drift.sm26_archive';
end
$s$;

do $a1$
declare
  v_txt text;
begin
  v_txt := pg_temp._dr_diff(null::text);
  insert into _dr_res (ok, label) values (v_txt = '' and (select count(*) from _dr_before) > 0,
    'A1 the pg_temp copy of the live body returns the live function''s ' || (select count(*) from _dr_before)
      || ' rows, same statement: ' || coalesce(nullif(v_txt, ''), 'no difference'));
end
$a1$;

-- B. The migration, verbatim
-- ops-health: new SM26 invoices no longer raise an alert (20 Oct 2026, Victor: "Oui, plus
-- d'alerte factures"). M3 still adds SM26 invoices (sm_invoice 42 against a baseline of 41 on
-- 20 Oct), so drift.sm26_archive failed and e-mailed M3 on every run.
-- Down: supabase/migrations/down/20261020170000_ops_health_sm26_invoices.down.sql.
-- Dry run: supabase/dryrun/20261020170000_ops_health_sm26_invoices.dryrun.sql
-- (runs this file, then the down, in one rolled-back transaction).
--
-- Replaces public.ops_health_checks() with the body applied by 20261016120000 (live md5(prosrc)
-- 1ff11d35c3239f5257c627b2a9b10087, read on 20 Oct) in which ONLY the drift.sm26_archive block changes:
--   - ok when the 6 other tables equal their baseline exactly and sm_invoice is at least its
--     baseline: 'SM26 archive unchanged (7 tables; new invoices allowed).'
--   - fail otherwise, with the same wording as before; FEWER invoices than the baseline still fail.
--   - A baseline whose sm26 object has no numeric sm_invoice fails, as the old whole-object
--     comparison did (a missing or text value can only come from a hand edit; failing is safe).
--   - No sm26 baseline stored: ok, 'No SM26 baseline stored.', as before. detail keeps now and baseline.
-- Every other check is byte for byte the same. Signature, SQL language, STABLE, SECURITY INVOKER,
-- owner postgres, search_path, grants (owner only) and comment do not move: create or replace
-- keeps them (checked after). ops_health_checks is not among the md5 pins of
-- drift.function_pins: no re-pin. The stored baseline is not touched (any invoice count from 41
-- up is ok). Writes no data row: sm_*, settings and every other table stay as they are.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  -- The body applied by 20261016120000, as read on 20 Oct.
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.ops_health_checks()'))
       is distinct from '1ff11d35c3239f5257c627b2a9b10087' then
    raise exception 'ops_health_sm26_invoices: ops_health_checks() changed since 20 Oct; rebuild this file on the live body';
  end if;
end
$pre$;

create or replace function public.ops_health_checks()
returns table (check_id text, area text, status text, summary text, detail jsonb)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
with
cfg as (select coalesce((select ps.value from public.platform_settings ps where ps.key = 'ops_health'), '{}'::jsonb) as v),
flg as (select coalesce((select ps.value from public.platform_settings ps where ps.key = 'registration_flags'), '{}'::jsonb) as v),
cj as (
  select j.jobname, lr.start_time as last_start,
    case
      when s.sch ~ '^\*(/1)? \* \* \* \*$' then 1
      when s.sch ~ '^\*/[0-9]+ \* \* \* \*$' then substring(s.sch from '^\*/([0-9]+)')::int
      when s.sch ~ '^[0-9]+ \* \* \* \*$' then 60
      when s.sch ~ '^[0-9]+ \*/[0-9]+ \* \* \*$' then 60 * substring(s.sch from '^[0-9]+ \*/([0-9]+)')::int
      when s.sch ~ '^[0-9]+ [0-9]+(,[0-9]+)* \* \* \*$' then 1440
      when s.sch ~ '^[0-9]+ [0-9]+ \* \* [0-9]+$' then 10080
    end as every_min
  from cron.job j
  cross join lateral (select regexp_replace(btrim(j.schedule), '\s+', ' ', 'g') as sch) s
  left join lateral (select d.start_time from cron.job_run_details d
    where d.jobid = j.jobid and d.status in ('succeeded', 'failed') order by d.start_time desc limit 1) lr on true
  where j.active),
rd as (
  select d.jobid, d.status as run_status, d.start_time, d.end_time
  from cron.job_run_details d where d.start_time > now() - interval '24 hours'),
hr as (
  select coalesce(r.status_code, 0) as code, coalesce(r.timed_out, false) as timed_out, r.error_msg, r.created,
    case when r.content is not null and pg_input_is_valid(r.content, 'jsonb') then r.content::jsonb end as body
  from net._http_response r where r.created > now() - interval '6 hours'),
wev as (select e.id, e.slug, e.notify_email from public.gl_event e where e.engine = 'guest_list_v1'),
wys as (select coalesce(nullif(cfg.v ->> 'wys_slug', ''), 'wys26') as slug from cfg),
em as (
  select case when split_part(o.name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then 'registrations'
              when position('/' in o.name) = 0 then '(root)' else split_part(o.name, '/', 1) end as grp, count(*) as cnt
  from storage.objects o where o.bucket_id = 'event-media' group by 1)
-- cron
select 'cron.failed_runs'::text as check_id, 'cron'::text as area,
  case when x.n > 0 then 'fail' else 'ok' end as status,
  case when x.n > 0 then x.n || ' failed cron run(s) in 24 h: ' || x.jobs || '.' else 'No failed cron run in 24 h.' end as summary,
  jsonb_build_object('failed_24h', x.n) as detail
from (select count(*) as n, string_agg(distinct coalesce(j.jobname, rd.jobid::text), ', ') as jobs
  from rd left join cron.job j on j.jobid = rd.jobid where rd.run_status = 'failed') x
union all
select 'cron.stale_jobs', 'cron',
  case when x.n > 0 then 'fail' else 'ok' end,
  case when x.n > 0 then x.n || ' scheduled job(s) stopped running: ' || x.jobs || '.' else x.watched || ' watched job(s) ran on time.' end,
  jsonb_build_object('stale', x.n, 'watched', x.watched, 'never_ran', x.never_ran)
from (select count(*) filter (where cj.last_start < now() - make_interval(mins => 2 * cj.every_min + 5)) as n,
    string_agg(cj.jobname, ', ') filter (where cj.last_start < now() - make_interval(mins => 2 * cj.every_min + 5)) as jobs,
    count(*) filter (where cj.every_min is not null) as watched,
    count(*) filter (where cj.every_min is not null and cj.last_start is null) as never_ran
  from cj) x
union all
select 'cron.slow_runs', 'cron',
  case when x.slow + x.stuck > 0 then 'warn' else 'ok' end,
  case when x.slow + x.stuck > 0 then x.slow || ' run(s) over 10 s, ' || x.stuck || ' stuck over 10 min, in 24 h: ' || x.jobs || '.'
    else 'No slow or stuck cron run in 24 h.' end,
  jsonb_build_object('slow', x.slow, 'stuck', x.stuck)
from (select count(*) filter (where rd.end_time - rd.start_time > interval '10 seconds') as slow,
    count(*) filter (where rd.run_status in ('starting', 'running') and rd.start_time < now() - interval '10 minutes') as stuck,
    string_agg(distinct coalesce(j.jobname, rd.jobid::text), ', ') filter (where rd.end_time - rd.start_time > interval '10 seconds'
      or (rd.run_status in ('starting', 'running') and rd.start_time < now() - interval '10 minutes')) as jobs
  from rd left join cron.job j on j.jobid = rd.jobid) x
union all
select 'cron.dormant_sm26', 'cron',
  case when x.n > 0 and extract(month from now()) in (8, 9) then 'warn' else 'ok' end,
  case when x.n > 0 then x.n || ' SM26 reminder job(s) still scheduled (' || x.jobs || '): they fire again in September.'
    else 'No SM26 job left scheduled.' end,
  jsonb_build_object('jobs', x.n)
from (select count(*) as n, string_agg(j.jobname, ', ' order by j.jobname) as jobs
  from cron.job j where j.active and j.jobname like 'sm26-%') x
union all
select 'cron.history_size', 'cron', case when x.n > 200000 then 'warn' else 'ok' end,
  x.n || ' rows of cron history.', jsonb_build_object('rows', x.n)
from (select count(*) as n from cron.job_run_details) x
-- scheduled calls (pg_net keeps the answers 6 h)
union all
select 'calls.vault_secrets', 'calls',
  case when x.n = 2 then 'ok' else 'fail' end,
  case when x.n = 2 then 'Both Vault secrets of the scheduled calls are present.'
    else 'Vault secret(s) missing: the scheduled calls are silently skipped.' end,
  jsonb_build_object('present', x.n)
from (select count(distinct s.name) as n from vault.secrets s where s.name in ('project_url', 'service_role_key')) x
union all
select 'calls.http_errors', 'calls',
  case when x.n > 0 then 'fail' else 'ok' end,
  case when x.n > 0 then x.n || ' scheduled call(s) failed in 6 h (' || x.codes || ').' else x.total || ' scheduled call(s) in 6 h, all 2xx.' end,
  jsonb_build_object('failed', x.n, 'total', x.total)
from (select count(*) filter (where hr.code not between 200 and 299 or hr.timed_out or hr.error_msg is not null) as n,
    count(*) as total,
    string_agg(distinct case when hr.timed_out then 'timeout' when hr.code = 0 then 'no answer' else hr.code::text end, ', ')
      filter (where hr.code not between 200 and 299 or hr.timed_out or hr.error_msg is not null) as codes
  from hr) x
union all
select 'calls.missing_answers', 'calls',
  case when x.n > 0 then 'warn' else 'ok' end,
  case when x.n > 0 then x.n || ' reminder run(s) in 6 h got no answer (' || x.jobs || '): call skipped or lost.'
    else x.runs || ' reminder run(s) in 6 h, all answered.' end,
  jsonb_build_object('missing', x.n, 'runs', x.runs)
from (select count(*) filter (where not m.answered) as n, count(*) as runs,
    string_agg(distinct m.jobname, ', ') filter (where not m.answered) as jobs
  from (select j.jobname, exists (select 1 from hr
      where hr.created between d.start_time and d.start_time + interval '90 seconds'
        and (hr.code not between 200 and 299 or hr.timed_out
          or hr.body ? (case when j.command like '%invoke_send_profile_reminders%' then 'candidates_considered' else 'events' end))) as answered
    from cron.job_run_details d join cron.job j on j.jobid = d.jobid
    where d.start_time between now() - interval '5 hours 50 minutes' and now() - interval '2 minutes' and d.status = 'succeeded'
      and (j.command like '%invoke_guest_webinar_reminders%' or j.command like '%invoke_send_profile_reminders%')) m) x
union all
select 'calls.answer_errors', 'calls',
  case when x.n > 0 then 'warn' else 'ok' end,
  case when x.n > 0 then x.n || ' scheduled call(s) in 6 h answered 2xx with an error inside.' else 'No error inside the answers of 6 h.' end,
  jsonb_build_object('with_errors', x.n)
from (select count(*) as n from hr
  where hr.code between 200 and 299 and jsonb_typeof(hr.body) = 'object'
    and ((hr.body ->> 'ok') = 'false' or (hr.body ->> 'success') = 'false' or hr.body ? 'error'
      or (case jsonb_typeof(hr.body -> 'errors') when 'array' then jsonb_array_length(hr.body -> 'errors')
            when 'number' then (hr.body ->> 'errors')::numeric else 0 end) > 0)) x
union all
select 'calls.queue_backlog', 'calls', case when x.n > 20 then 'warn' else 'ok' end,
  x.n || ' call(s) waiting in the pg_net queue.', jsonb_build_object('queued', x.n)
from (select count(*) as n from net.http_request_queue) x
union all
select 'calls.reminder_volume', 'calls', case when x.n > 40 then 'warn' else 'ok' end,
  x.n || ' profile reminder(s) sent in 24 h' || case when x.n > 40 then ' (over 40: cooldown broken?).' else '.' end,
  jsonb_build_object('sent_24h', x.n)
from (select count(*) as n from public.notification_sends ns where ns.sent_at > now() - interval '24 hours') x
-- registration queues
union all
select 'reg.provisioning', 'registration',
  case when x.dead > 0 or (x.waiting + x.overdue > 0 and x.flag_on) then 'fail' when x.waiting + x.overdue > 0 then 'warn' else 'ok' end,
  case when x.dead > 0 then x.dead || ' account job(s) failed 5 times and are no longer retried.'
    when x.waiting + x.overdue > 0 and x.flag_on then x.waiting || ' account job(s) waiting over 15 min, ' || x.overdue || ' account e-mail(s) overdue.'
    when x.waiting + x.overdue > 0 then (x.waiting + x.overdue) || ' guest(s) wait for the "choose your password" e-mail: switch provisioning is OFF.'
    else 'No account job waiting or failed (provisioning ' || case when x.flag_on then 'on' else 'off' end || ').' end,
  jsonb_build_object('waiting', x.waiting, 'overdue', x.overdue, 'dead', x.dead, 'provisioning_on', x.flag_on)
from (select count(*) filter (where a.status = 'queued' and a.created_at < now() - interval '15 minutes') as waiting,
    count(*) filter (where a.status = 'done' and a.email_sent_at is null
      and a.email_due_at between now() - interval '30 days' and now() - interval '15 minutes') as overdue,
    count(*) filter (where a.status = 'failed' and a.attempts >= 5) as dead,
    coalesce((select (flg.v -> 'provisioning') = 'true'::jsonb from flg), false) as flag_on
  from public.account_provision_job a) x
union all
select 'reg.confirmed_without_job', 'registration',
  case when x.n > 0 then 'fail' else 'ok' end,
  case when x.n > 0 then x.n || ' confirmed on-site guest(s) have no account job (' || x.slugs || ').' else 'Every confirmed on-site guest has an account job.' end,
  jsonb_build_object('missing', x.n)
from (select count(*) as n, string_agg(distinct e.slug, ', ') as slugs
  from public.gl_guest g join public.gl_event e on e.id = g.event_id
  where e.kind = 'onsite' and g.status = 'confirmed'
    and greatest(g.created_at, g.updated_at, g.decided_at, g.responded_at) < now() - interval '5 minutes'
    and not exists (select 1 from public.account_provision_job a where a.source_kind = 'gl_guest' and a.source_id = g.id)) x
union all
select 'reg.outbox', 'registration',
  case when x.dead > 0 then 'fail' when x.stale + x.errored > 0 then 'warn' else 'ok' end,
  case when x.dead + x.stale + x.errored > 0 then x.stale || ' notification(s) of 7 days unsent after 15 min, ' || x.errored || ' with an error, '
      || x.dead || ' given up after 5 attempts.'
    else 'Nothing stuck in the notification outbox (7 days).' end,
  jsonb_build_object('stale', x.stale, 'errored', x.errored, 'dead', x.dead)
-- Only rows send-notification would still send: the person still pending, the join request
-- still open (it refuses the others and leaves them unsent for ever). 7 days at most.
from (select count(*) filter (where o.created_at < now() - interval '15 minutes') as stale,
    count(*) filter (where o.last_error is not null) as errored,
    count(*) filter (where o.attempts >= 5) as dead
  from public.notification_outbox o
  where o.sent_at is null and o.created_at > now() - interval '7 days'
    and case o.kind
      when 'account_under_review' then exists (select 1 from public.profiles pr
        where pr.user_id = o.user_id and pr.access_status::text = 'pending')
      when 'team_join_request' then exists (select 1 from public.organization_invitations i
        where i.id = o.subject_id and i.status = 'join_requested')
      else true end) x
-- payments
union all
select 'pay.emails', 'payments',
  case when x.no_mail + x.stuck > 0 then 'fail' else 'ok' end,
  case when x.no_mail + x.stuck > 0 then x.no_mail || ' paid payment(s) without their e-mail, ' || x.stuck || ' e-mail claim(s) stuck over 10 min.'
    else 'Every recent paid payment has its e-mail.' end,
  jsonb_build_object('paid_without_email', x.no_mail, 'stuck_claims', x.stuck)
from (select (select count(*) from public.payments p
      where p.status = 'paid' and coalesce(p.paid_at, p.updated_at) between now() - interval '30 days' and now() - interval '15 minutes'
        and not exists (select 1 from public.payment_email_log l where l.payment_id = p.id and l.status = 'paid' and l.sent_at is not null)) as no_mail,
    (select count(*) from public.payment_email_log l
      where l.sent_at is null and l.created_at between now() - interval '30 days' and now() - interval '10 minutes') as stuck) x
union all
select 'pay.ipn_review', 'payments',
  case when x.n > 0 then 'fail' else 'ok' end,
  case when x.n > 0 then x.n || ' payment(s) flagged by the bank notification in the last 48 h (mismatch or review).'
    else 'No payment flagged by the bank in the last 48 h.' end,
  jsonb_build_object('flagged', x.n)
-- The flag's own time (payment-ipn writes "at"): payments.updated_at moves with any later edit.
from (select count(distinct p.id) as n from public.payments p
  cross join lateral (values (p.metadata -> 'ipn_review'), (p.metadata -> 'ipn_mismatch')) f(v)
  where jsonb_typeof(f.v) = 'object'
    and case when pg_input_is_valid(f.v ->> 'at', 'timestamptz') then (f.v ->> 'at')::timestamptz end > now() - interval '48 hours') x
union all
select 'pay.stale_pending', 'payments',
  case when x.n > 0 then 'warn' else 'ok' end,
  case when x.n > 0 then x.n || ' payment(s) pending 24 to 72 h after checkout: abandoned, or the bank notification was lost.'
    else 'No payment pending over a day.' end,
  jsonb_build_object('pending', x.n)
from (select count(*) as n from public.payments p
  where p.status = 'pending' and p.created_at between now() - interval '72 hours' and now() - interval '24 hours') x
-- guest lists (WYS)
union all
select 'wys.pass_missing', 'guest list',
  case when x.n > 0 then 'fail' else 'ok' end,
  case when x.n > 0 then x.n || ' confirmed guest(s) without a QR e-mail logged (' || x.slugs || '): resend the pass.'
    else 'Every confirmed guest has a QR e-mail logged.' end,
  jsonb_build_object('missing', x.n)
from (select count(*) as n, string_agg(distinct w.slug, ', ') as slugs
  from public.gl_guest g join wev w on w.id = g.event_id
  where g.status = 'confirmed' and greatest(g.created_at, g.updated_at, g.decided_at, g.responded_at) < now() - interval '10 minutes'
    and not exists (select 1 from public.gl_email_log l where l.guest_id = g.id and l.kind = 'pass')) x
union all
select 'wys.emails_missing', 'guest list',
  case when x.inv + x.ack + x.staff > 0 then 'warn' else 'ok' end,
  case when x.inv + x.ack + x.staff > 0 then x.inv || ' invitation(s), ' || x.ack || ' request acknowledgement(s), '
      || x.staff || ' staff notice(s) not logged after 10 min.'
    else 'Invitations, acknowledgements and staff notices all logged.' end,
  jsonb_build_object('invitation', x.inv, 'request_ack', x.ack, 'staff_notify', x.staff)
from (select
    count(*) filter (where g.status = 'invited'
      and not exists (select 1 from public.gl_email_log l where l.guest_id = g.id and l.kind = 'invitation')) as inv,
    count(*) filter (where g.status = 'requested' and g.source = 'request'
      and not exists (select 1 from public.gl_email_log l where l.guest_id = g.id and l.kind = 'request_ack')) as ack,
    count(*) filter (where g.status = 'requested' and g.source in ('request', 'plus_one') and nullif(btrim(w.notify_email), '') is not null
      and not exists (select 1 from public.gl_email_log l where l.guest_id = g.id and l.kind = 'staff_notify')) as staff
  from public.gl_guest g join wev w on w.id = g.event_id
  where greatest(g.created_at, g.updated_at, g.decided_at, g.responded_at, g.invited_at) < now() - interval '10 minutes') x
union all
select 'wys.event', 'guest list',
  case when e.id is null or e.engine is distinct from 'guest_list_v1' or e.door_token is distinct from 'shared'
    or e.kind is distinct from 'onsite' or e.hidden then 'fail' else 'ok' end,
  case when e.id is null then 'Guest-list event ' || wys.slug || ' is missing.'
    when e.engine is distinct from 'guest_list_v1' or e.door_token is distinct from 'shared' or e.kind is distinct from 'onsite' or e.hidden
      then wys.slug || ' changed: engine ' || coalesce(e.engine, '-') || ', door ' || coalesce(e.door_token, '-') || ', kind '
        || coalesce(e.kind, '-') || ', hidden ' || e.hidden || '.'
    else wys.slug || ': requests ' || case when e.requests_open then 'open' else 'closed' end || ', capacity '
      || coalesce(e.capacity::text, 'unlimited') || '.' end,
  jsonb_build_object('slug', wys.slug, 'requests_open', e.requests_open, 'capacity', e.capacity)
from wys left join public.gl_event e on e.slug = wys.slug
union all
select 'wys.guests_integrity', 'guest list',
  case when x.no_tok + x.dup_tok + x.odd > 0 then 'fail' else 'ok' end,
  case when x.no_tok + x.dup_tok + x.odd > 0 then x.no_tok || ' guest(s) without a token, ' || x.dup_tok || ' duplicated token(s), '
      || x.odd || ' row(s) with an unknown status or source.'
    else x.n || ' guest row(s): tokens unique, statuses and sources valid.' end,
  jsonb_build_object('guests', x.n, 'no_token', x.no_tok, 'duplicate_tokens', x.dup_tok, 'odd_rows', x.odd)
from (select count(g.id) as n, count(g.id) filter (where g.token is null) as no_tok,
    count(g.token) - count(distinct g.token) as dup_tok,
    count(g.id) filter (where g.status not in ('requested', 'invited', 'confirmed', 'declined', 'rejected', 'cancelled')
      or g.source not in ('request', 'invitation', 'plus_one')) as odd
  from wys join public.gl_event e on e.slug = wys.slug join public.gl_guest g on g.event_id = e.id) x
union all
select 'wys.capacity', 'guest list',
  case when x.cap is not null and x.held >= x.cap then 'warn' else 'ok' end,
  x.held || ' seat(s) held (' || x.confirmed || ' confirmed, ' || x.invited || ' invited) of ' || coalesce(x.cap::text, '?') || '; '
    || x.checked_in || ' checked in.',
  jsonb_build_object('held', x.held, 'confirmed', x.confirmed, 'invited', x.invited, 'capacity', x.cap, 'checked_in', x.checked_in)
from (select max(e.capacity) as cap, count(g.id) filter (where g.status in ('confirmed', 'invited')) as held,
    count(g.id) filter (where g.status = 'confirmed') as confirmed, count(g.id) filter (where g.status = 'invited') as invited,
    count(g.id) filter (where g.checked_in_at is not null) as checked_in
  from wys join public.gl_event e on e.slug = wys.slug left join public.gl_guest g on g.event_id = e.id) x
union all
select 'wys.door', 'guest list',
  case when x.door_ok and x.trig_on = 2 then 'ok' else 'fail' end,
  'Door check-in function ' || case when x.door_ok then 'unchanged' else 'CHANGED or missing' end || ', '
    || x.trig_on || ' of 2 guest-list triggers enabled.',
  jsonb_build_object('gl_checkin_unchanged', x.door_ok, 'triggers_enabled', x.trig_on)
from (select coalesce((select case when count(*) = 1 then min(md5(p.prosrc)) end from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname = 'gl_checkin') = 'e2a63a98dcb1f5625b24d71f0cda3a62', false) as door_ok,
    (select count(*) from pg_trigger t where t.tgrelid = 'public.gl_guest'::regclass and not t.tgisinternal and t.tgenabled <> 'D'
      and t.tgname in ('gl_guest_engine_guard', 'gl_guest_queue_provisioning')) as trig_on) x
-- drift
union all
select 'drift.function_pins', 'drift',
  case when x.changed > 0 then 'warn' else 'ok' end,
  case when x.changed > 0 then x.changed || ' pinned function(s) changed: ' || x.names || '. Re-pin after a planned change.'
    else x.pinned || ' pinned function(s) unchanged.' end,
  jsonb_build_object('pinned', x.pinned, 'changed', x.changed)
from (select count(*) as pinned, count(*) filter (where pin.md5_now is distinct from pin.md5_want) as changed,
    string_agg(pin.fn, ', ' order by pin.fn) filter (where pin.md5_now is distinct from pin.md5_want) as names
  from (select k.key as fn, k.value as md5_want,
      (select case when count(*) = 1 then min(md5(p.prosrc)) else md5(string_agg(md5(p.prosrc), ',' order by md5(p.prosrc))) end
        from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = k.key) as md5_now
    from cfg cross join lateral jsonb_each_text(case when jsonb_typeof(cfg.v -> 'pins') = 'object' then cfg.v -> 'pins' else '{}' end) k) pin) x
union all
select 'drift.freeze', 'drift',
  case when x.in_freeze and x.n > 0 then 'warn' else 'ok' end,
  case when not x.in_freeze then 'No freeze in force.'
    when x.n > 0 then x.n || ' migration(s) applied since the freeze began on ' || x.f || ': were they planned?'
    else 'Freeze until ' || x.t || ': no migration since ' || x.f || '.' end,
  jsonb_build_object('in_freeze', x.in_freeze, 'migrations_since', x.n)
from (select fz.f, fz.t, coalesce(current_date between fz.f and fz.t, false) as in_freeze,
    (select count(*) from supabase_migrations.schema_migrations m where m.version >= to_char(fz.f, 'YYYYMMDD')) as n
  from (select case when pg_input_is_valid(cfg.v -> 'freeze' ->> 'from', 'date') then (cfg.v -> 'freeze' ->> 'from')::date end as f,
      case when pg_input_is_valid(cfg.v -> 'freeze' ->> 'to', 'date') then (cfg.v -> 'freeze' ->> 'to')::date end as t
    from cfg) fz) x
union all
select 'drift.sm26_archive', 'drift',
  case when x.base is null or x.same then 'ok' else 'fail' end,
  case when x.base is null then 'No SM26 baseline stored.' when x.same then 'SM26 archive unchanged (7 tables; new invoices allowed).'
    else 'The SM26 archive changed: rows added or removed in sm_* tables.' end,
  jsonb_build_object('now', x.cur, 'baseline', x.base)
-- New SM26 invoices are allowed (Victor, 20 Oct 2026): sm_invoice may grow, never shrink; the
-- 6 other tables must equal the baseline. A baseline without a numeric sm_invoice fails, as before.
from (select y.base, y.cur,
    coalesce((y.cur - 'sm_invoice') = (y.base - 'sm_invoice')
      and case when jsonb_typeof(y.base -> 'sm_invoice') = 'number'
            then (y.cur ->> 'sm_invoice')::numeric >= (y.base ->> 'sm_invoice')::numeric else false end, false) as same
  from (select (select case when jsonb_typeof(cfg.v -> 'baseline' -> 'sm26') = 'object' then cfg.v -> 'baseline' -> 'sm26' end from cfg) as base,
      jsonb_build_object('sm_registration', (select count(*) from public.sm_registration),
        'sm_role_assignment', (select count(*) from public.sm_role_assignment), 'sm_attendee', (select count(*) from public.sm_attendee),
        'sm_badge', (select count(*) from public.sm_badge), 'sm_payment', (select count(*) from public.sm_payment),
        'sm_invoice', (select count(*) from public.sm_invoice), 'sm_networking_pass', (select count(*) from public.sm_networking_pass)) as cur) y) x
-- security
union all
select 'security.open_functions', 'security',
  case when x.n > 0 then 'warn' else 'ok' end,
  case when x.n > 0 then x.n || ' internal function(s) anyone can run through the API: ' || x.names || '.'
    else 'Internal scheduled-call functions are closed to the API.' end,
  jsonb_build_object('open', x.n)
from (select count(*) as n, string_agg(p.proname, ', ' order by p.proname) as names
  from pg_proc p where p.pronamespace = 'public'::regnamespace
    and ((p.prosecdef and p.proname like 'invoke\_%') or p.proname in ('cleanup_guest_rate_limits', 'notification_outbox_claim', 'ops_health_checks'))
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) x
-- database
union all
select 'db.connections', 'database',
  case when x.used > 0.95 * x.max_c then 'fail' when x.used > 0.8 * x.max_c then 'warn' else 'ok' end,
  x.used || ' of ' || x.max_c || ' connections in use.', jsonb_build_object('used', x.used, 'max', x.max_c)
from (select count(*) filter (where a.backend_type = 'client backend') as used, current_setting('max_connections')::int as max_c
  from pg_stat_activity a) x
union all
select 'db.long_running', 'database',
  case when x.q + x.idle > 0 then 'warn' else 'ok' end,
  x.q || ' query(ies) running over 5 min, ' || x.idle || ' session(s) idle in a transaction over 5 min.',
  jsonb_build_object('long_queries', x.q, 'idle_in_transaction', x.idle)
from (select count(*) filter (where a.state = 'active' and a.query_start < now() - interval '5 minutes') as q,
    count(*) filter (where a.state like 'idle in transaction%' and a.state_change < now() - interval '5 minutes') as idle
  from pg_stat_activity a where a.backend_type = 'client backend' and a.pid <> pg_backend_pid()) x
union all
select 'db.replication_slots', 'database',
  case when x.held > 1073741824 then 'fail' when x.inactive > 0 then 'warn' else 'ok' end,
  x.n || ' replication slot(s), ' || x.inactive || ' inactive, ' || pg_size_pretty(x.held) || ' of WAL held at most.',
  jsonb_build_object('slots', x.n, 'inactive', x.inactive, 'max_wal_held_bytes', x.held)
from (select count(*) as n, count(*) filter (where not s.active and not s.temporary) as inactive,
    coalesce(max(pg_wal_lsn_diff(pg_current_wal_lsn(), s.restart_lsn)), 0)::bigint as held
  from pg_replication_slots s) x
union all
select 'db.wraparound', 'database',
  case when x.age_max > 1000000000 then 'fail' when x.age_max > 150000000 then 'warn' else 'ok' end,
  'Oldest transaction id age ' || x.age_max || '.', jsonb_build_object('xid_age', x.age_max)
from (select max(age(d.datfrozenxid)) as age_max from pg_database d) x
union all
select 'db.size', 'database', case when x.bytes > 4294967296 then 'warn' else 'ok' end,
  'Database size ' || pg_size_pretty(x.bytes) || '.', jsonb_build_object('bytes', x.bytes)
from (select pg_database_size(current_database()) as bytes) x
-- storage (no backup of the files exists)
union all
select 'storage.event_media', 'storage',
  case when x.lost > 0 then 'fail' else 'ok' end,
  case when x.lost > 0 then x.lost || ' file(s) missing from event-media (' || x.groups || '), which has no backup.'
    when not x.has_base then x.n || ' file(s) in event-media, no baseline stored.'
    else x.n || ' file(s) in event-media, none missing against the baseline.' end,
  jsonb_build_object('files', x.n, 'missing', x.lost)
-- Per folder group (registrations = the per-registration folders, imported, invoices...), so a
-- new upload in one group cannot hide a deletion in another.
from (select (select coalesce(sum(em.cnt), 0) from em) as n,
    (select coalesce(jsonb_typeof(cfg.v -> 'baseline' -> 'event_media') = 'object', false) from cfg) as has_base,
    coalesce(sum(greatest(k.want - coalesce(em.cnt, 0), 0)), 0) as lost,
    string_agg(k.grp || ' -' || (k.want - coalesce(em.cnt, 0)), ', ' order by k.grp) filter (where coalesce(em.cnt, 0) < k.want) as groups
  from cfg
  cross join lateral jsonb_each(case when jsonb_typeof(cfg.v -> 'baseline' -> 'event_media') = 'object'
    then cfg.v -> 'baseline' -> 'event_media' else '{}'::jsonb end) e
  cross join lateral (select e.key as grp, case when jsonb_typeof(e.value) = 'number' then (e.value)::numeric end as want) k
  left join em on em.grp = k.grp) x
-- other queues
union all
select 'other.contact_inbox', 'other',
  case when x.n > 0 then 'warn' else 'ok' end,
  case when x.n > 0 then x.n || ' contact message(s) saved but not e-mailed to the inbox: read them in the admin.'
    else 'Every contact message reached the inbox.' end,
  jsonb_build_object('not_emailed', x.n)
from (select count(*) as n from public.contact_submissions c
  where c.emailed_at is null and c.created_at between now() - interval '30 days' and now() - interval '15 minutes') x
union all
select 'other.pulse_snapshot', 'other',
  case when (now() at time zone 'UTC')::time > time '07:15'
    and coalesce(x.last_day, date '2000-01-01') < (now() at time zone 'UTC')::date then 'warn' else 'ok' end,
  'Last daily KPI snapshot: ' || coalesce(x.last_day::text, 'none') || '.', jsonb_build_object('last', x.last_day)
from (select max(p.snapshot_date) as last_day from public.pulse_snapshots p) x
union all
select 'other.crm_outbox', 'other', case when x.n > 0 then 'warn' else 'ok' end,
  x.n || ' CRM bridge event(s) failed, dead or undelivered after 1 h.', jsonb_build_object('stuck', x.n)
from (select count(*) as n from public.commercial_outbox_events c where c.status in ('failed', 'dead_letter')
  or (c.status <> 'delivered' and (c.created_at < now() - interval '1 hour' or c.attempts >= 5))) x
union all
select 'other.digest_log', 'other', case when x.n > 0 then 'warn' else 'ok' end,
  x.n || ' weekly digest(s) stuck in "sending" over 1 h.', jsonb_build_object('stuck', x.n)
from (select count(*) as n from public.digest_log dl where dl.status = 'sending' and dl.created_at < now() - interval '1 hour') x
union all
select 'other.invitation_expiry', 'other', case when x.n > 0 then 'warn' else 'ok' end,
  x.n || ' team invitation(s) past expiry still pending' || case when x.n > 0 then ': the expiry job is not running.' else '.' end,
  jsonb_build_object('overdue', x.n)
from (select count(*) as n from public.organization_invitations i where i.status = 'pending' and i.expires_at < now() - interval '15 minutes') x
$function$;

-- After: the new body arrived intact (backslashes included), nothing else of the function moved,
-- and it runs (else the whole file rolls back).
do $post$
begin
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.ops_health_checks()'))
       is distinct from '34cf828987417b2527ebf58c71c1f2c8' then
    raise exception 'ops_health_sm26_invoices: the new body of ops_health_checks() did not arrive intact';
  end if;
  if not coalesce((select pg_get_userbyid(p.proowner) = 'postgres' and not p.prosecdef and p.provolatile = 's'
                          and p.proparallel = 'u' and l.lanname = 'sql' and p.prokind = 'f' and p.proretset
                          and array_to_string(p.proconfig, ';') = 'search_path=public, pg_temp'
                          and p.proacl::text = '{postgres=X/postgres}'
                          and pg_get_function_identity_arguments(p.oid) = ''
                          and pg_get_function_result(p.oid) = 'TABLE(check_id text, area text, status text, summary text, detail jsonb)'
                          and md5(obj_description(p.oid, 'pg_proc')) = '0881dd62ca9de11a38fba7730f82e965'
                     from pg_proc p join pg_language l on l.oid = p.prolang
                    where p.oid = to_regprocedure('public.ops_health_checks()')), false) then
    raise exception 'ops_health_sm26_invoices: owner, security, volatility, search_path, grants, signature or comment of ops_health_checks() moved';
  end if;
  if (select count(*) from public.ops_health_checks() h where h.check_id = 'drift.sm26_archive') <> 1 then
    raise exception 'ops_health_sm26_invoices: ops_health_checks() lost its drift.sm26_archive row';
  end if;
end
$post$;

-- C. Checks after the migration
do $c$
declare
  v_new text;
  v_old text;
  v_m1 text := 'select ''drift.sm26_archive'', ''drift'',';
  v_m2 text := '-- security';
  v_txt text;
  v_state text;
  v_n bigint;
  v_cur jsonb;
  v_inv bigint;
  v_ok_txt text := 'SM26 archive unchanged (7 tables; new invoices allowed).';
  v_fail_txt text := 'The SM26 archive changed: rows added or removed in sm_* tables.';
  v_r record;
begin
  select p.prosrc into v_new from pg_proc p where p.oid = to_regprocedure('public.ops_health_checks()');
  select o.src into v_old from _dr_old o;

  -- C1 the bodies, by md5
  insert into _dr_res (ok, label) values (
    (select o.m from _dr_old o) = '1ff11d35c3239f5257c627b2a9b10087' and md5(v_new) = '34cf828987417b2527ebf58c71c1f2c8',
    'C1 md5(prosrc) ' || coalesce((select o.m from _dr_old o), 'MISSING') || ' -> ' || coalesce(md5(v_new), 'MISSING')
      || ' (expected 1ff11d35c3239f5257c627b2a9b10087 -> 34cf828987417b2527ebf58c71c1f2c8)');

  -- C2 nothing else of the function moved
  insert into _dr_res (ok, label) values (
    pg_temp._dr_meta() = (select o.meta from _dr_old o),
    'C2 same oid, owner, SECURITY INVOKER, STABLE, parallel, language, search_path, grants, signature, comment: '
      || coalesce(pg_temp._dr_meta(), 'MISSING'));

  -- C3 byte for byte the same outside the drift.sm26_archive block
  insert into _dr_res (ok, label) values (
    (length(v_old) - length(replace(v_old, v_m1, ''))) / length(v_m1) = 1
      and (length(v_new) - length(replace(v_new, v_m1, ''))) / length(v_m1) = 1
      and (length(v_old) - length(replace(v_old, v_m2, ''))) / length(v_m2) = 1
      and (length(v_new) - length(replace(v_new, v_m2, ''))) / length(v_m2) = 1
      and strpos(v_new, v_m1) < strpos(v_new, v_m2)
      and left(v_new, strpos(v_new, v_m1) - 1) = left(v_old, strpos(v_old, v_m1) - 1)
      and substr(v_new, strpos(v_new, v_m2)) = substr(v_old, strpos(v_old, v_m2)),
    'C3 the new body equals the old one byte for byte outside the drift.sm26_archive block ('
      || (strpos(v_old, v_m1) - 1) || ' characters before it, ' || (length(v_old) - strpos(v_old, v_m2) + 1) || ' after it)');

  -- C4 same check ids
  insert into _dr_res (ok, label) values (
    (select count(*) from public.ops_health_checks()) = (select count(*) from _dr_before)
      and (select count(distinct h.check_id) from public.ops_health_checks() h) = (select count(*) from _dr_before)
      and not exists ((select h.check_id, h.area from public.ops_health_checks() h) except (select b.check_id, b.area from _dr_before b))
      and not exists ((select b.check_id, b.area from _dr_before b) except (select h.check_id, h.area from public.ops_health_checks() h)),
    'C4 the new function compiles, runs and returns the same ' || (select count(*) from _dr_before)
      || ' check ids as before, each once, same area');

  -- C5 every other row identical to the old body's
  v_txt := pg_temp._dr_diff('drift.sm26_archive');
  insert into _dr_res (ok, label) values (v_txt = '',
    'C5 every row but drift.sm26_archive identical to the old body''s, same statement (status, summary, detail; db.size within 1 MB): '
      || coalesce(nullif(v_txt, ''), 'no difference'));

  -- C6 no other function touched
  insert into _dr_res (ok, label) values (
    (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace) = (select count(*) from _dr_fn)
      and not exists ((select f.fn, f.acl, f.m from _dr_fn f where f.o <> to_regprocedure('public.ops_health_checks()')::oid)
                      except (select p.oid::regprocedure::text, coalesce(array_to_string(p.proacl, ','), ''), md5(p.prosrc)
                                from pg_proc p where p.pronamespace = 'public'::regnamespace)),
    'C6 every other public function unchanged (' || ((select count(*) from _dr_fn) - 1) || '), none added or removed');

  -- C7 the report still reads it (direct session, no JWT)
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  v_n := null;
  v_txt := null;
  begin
    select count(*), max(r.status) filter (where r.check_id = 'drift.sm26_archive') into v_n, v_txt from public.ops_health_report() r;
    v_state := 'ok';
  exception when others then v_state := sqlstate || ' ' || sqlerrm;
  end;
  insert into _dr_res (ok, label) values (
    v_state = 'ok' and v_n = (select count(*) from _dr_before)
      and v_txt = (select h.status from public.ops_health_checks() h where h.check_id = 'drift.sm26_archive'),
    'C7 ops_health_report() -> ' || v_state || ', ' || coalesce(v_n::text, 'null') || ' row(s), drift.sm26_archive '
      || coalesce(v_txt, 'null'));

  -- C8 today's stored baseline: the alert clears
  select * into v_r from pg_temp._dr_sm26(false, null);
  insert into _dr_res (ok, label) values (
    v_r.o_status = 'fail' and v_r.n_status = 'ok' and v_r.n_summary = v_ok_txt and v_r.n_detail = v_r.o_detail,
    'C8 the stored baseline (' || coalesce(v_r.n_detail -> 'baseline' ->> 'sm_invoice', '?') || ' invoices, now '
      || coalesce(v_r.n_detail -> 'now' ->> 'sm_invoice', '?') || '): old ' || coalesce(v_r.o_status, 'none') || ', new '
      || coalesce(v_r.n_status, 'none') || ', detail unchanged'
      || case when v_r.n_status = 'ok' then '' else ': ' || coalesce(v_r.n_detail::text, 'null') end);

  -- K. The cases, on the stored BASELINE only (counts read, never written)
  v_cur := jsonb_build_object('sm_registration', (select count(*) from public.sm_registration),
    'sm_role_assignment', (select count(*) from public.sm_role_assignment), 'sm_attendee', (select count(*) from public.sm_attendee),
    'sm_badge', (select count(*) from public.sm_badge), 'sm_payment', (select count(*) from public.sm_payment),
    'sm_invoice', (select count(*) from public.sm_invoice), 'sm_networking_pass', (select count(*) from public.sm_networking_pass));
  v_inv := (v_cur ->> 'sm_invoice')::bigint;

  select * into v_r from pg_temp._dr_sm26(true, v_cur);
  insert into _dr_res (ok, label) values (
    v_r.n_status = 'ok' and v_r.n_summary = v_ok_txt and v_r.n_detail = jsonb_build_object('now', v_cur, 'baseline', v_cur)
      and v_r.o_status = 'ok' and v_r.o_summary = 'SM26 archive unchanged (7 tables).',
    'K1 baseline = now (' || v_inv || ' invoices): new ' || coalesce(v_r.n_status, 'none') || ' "' || coalesce(v_r.n_summary, '')
      || '", old ' || coalesce(v_r.o_status, 'none'));

  select * into v_r from pg_temp._dr_sm26(true, jsonb_set(v_cur, '{sm_invoice}', to_jsonb(v_inv - 1)));
  insert into _dr_res (ok, label) values (
    v_r.n_status = 'ok' and v_r.n_summary = v_ok_txt and v_r.o_status = 'fail'
      and v_r.n_detail = jsonb_build_object('now', v_cur, 'baseline', jsonb_set(v_cur, '{sm_invoice}', to_jsonb(v_inv - 1))),
    'K2 baseline sm_invoice = now - 1 (an invoice added): new ' || coalesce(v_r.n_status, 'none') || ', old '
      || coalesce(v_r.o_status, 'none') || ', detail keeps now and baseline');

  select * into v_r from pg_temp._dr_sm26(true, jsonb_set(v_cur, '{sm_invoice}', to_jsonb(v_inv + 1)));
  insert into _dr_res (ok, label) values (
    v_r.n_status = 'fail' and v_r.n_summary = v_fail_txt and v_r.same_row,
    'K3 baseline sm_invoice = now + 1 (an invoice removed): new ' || coalesce(v_r.n_status, 'none') || ', old '
      || coalesce(v_r.o_status, 'none') || case when v_r.same_row then ', same row' else ', rows differ' end);

  select * into v_r from pg_temp._dr_sm26(true, jsonb_set(v_cur, '{sm_badge}', to_jsonb((v_cur ->> 'sm_badge')::bigint - 1)));
  insert into _dr_res (ok, label) values (
    v_r.n_status = 'fail' and v_r.n_summary = v_fail_txt and v_r.same_row,
    'K4 baseline sm_badge = now - 1 (a badge added): new ' || coalesce(v_r.n_status, 'none') || ', old '
      || coalesce(v_r.o_status, 'none') || case when v_r.same_row then ', same row' else ', rows differ' end);

  select * into v_r from pg_temp._dr_sm26(true, jsonb_set(jsonb_set(v_cur, '{sm_attendee}', to_jsonb((v_cur ->> 'sm_attendee')::bigint + 1)),
                                                          '{sm_invoice}', to_jsonb(v_inv - 1)));
  insert into _dr_res (ok, label) values (
    v_r.n_status = 'fail' and v_r.n_summary = v_fail_txt and v_r.same_row,
    'K5 an attendee removed while an invoice was added: new ' || coalesce(v_r.n_status, 'none') || ', old '
      || coalesce(v_r.o_status, 'none') || case when v_r.same_row then ', same row' else ', rows differ' end);

  select * into v_r from pg_temp._dr_sm26(true, null);
  insert into _dr_res (ok, label) values (
    v_r.n_status = 'ok' and v_r.n_summary = 'No SM26 baseline stored.' and v_r.same_row,
    'K6 no sm26 key in the baseline: new ' || coalesce(v_r.n_status, 'none') || ' "' || coalesce(v_r.n_summary, '') || '"'
      || case when v_r.same_row then ', same row as before' else ', rows differ' end);

  select * into v_r from pg_temp._dr_sm26(true, '[]'::jsonb);
  insert into _dr_res (ok, label) values (
    v_r.n_status = 'ok' and v_r.n_summary = 'No SM26 baseline stored.' and v_r.same_row,
    'K7 sm26 baseline not an object: new ' || coalesce(v_r.n_status, 'none') || ' "' || coalesce(v_r.n_summary, '') || '"'
      || case when v_r.same_row then ', same row as before' else ', rows differ' end);

  select * into v_r from pg_temp._dr_sm26(true, v_cur - 'sm_invoice');
  insert into _dr_res (ok, label) values (
    v_r.n_status = 'fail' and v_r.n_summary = v_fail_txt and v_r.same_row,
    'K8 baseline without sm_invoice: new ' || coalesce(v_r.n_status, 'none') || ', old '
      || coalesce(v_r.o_status, 'none') || case when v_r.same_row then ', same row' else ', rows differ' end);

  select * into v_r from pg_temp._dr_sm26(true, jsonb_set(v_cur, '{sm_invoice}', to_jsonb((v_inv - 1)::text)));
  insert into _dr_res (ok, label) values (
    v_r.n_status = 'fail' and v_r.n_summary = v_fail_txt and v_r.same_row,
    'K9 baseline sm_invoice as text ("' || (v_inv - 1) || '"): new ' || coalesce(v_r.n_status, 'none') || ', old '
      || coalesce(v_r.o_status, 'none') || case when v_r.same_row then ', same row' else ', rows differ' end);

  select * into v_r from pg_temp._dr_sm26(true, v_cur || jsonb_build_object('sm_other', 0));
  insert into _dr_res (ok, label) values (
    v_r.n_status = 'fail' and v_r.n_summary = v_fail_txt and v_r.same_row,
    'K10 baseline with an 8th key: new ' || coalesce(v_r.n_status, 'none') || ', old '
      || coalesce(v_r.o_status, 'none') || case when v_r.same_row then ', same row' else ', rows differ' end);

  -- R. The settings row put back
  update public.platform_settings ps set value = s.value, updated_at = s.updated_at, updated_by = s.updated_by
    from _dr_ps s where ps.key = 'ops_health';
  insert into _dr_res (ok, label) values (
    (select ps::text from public.platform_settings ps where ps.key = 'ops_health') = (select s.row_txt from _dr_ps s),
    'R1 platform_settings ops_health row put back exactly (every column)');
end
$c$;

-- D. The down, verbatim
-- DOWN for supabase/migrations/20261020170000_ops_health_sm26_invoices.sql
-- Puts back, byte for byte, the body of public.ops_health_checks() applied by 20261016120000
-- (md5(prosrc) 1ff11d35c3239f5257c627b2a9b10087): drift.sm26_archive again fails on ANY change of the 7 sm_*
-- counts, new invoices included (re-baseline per docs/operations/health-monitor.md after that).
-- Owner, grants, search_path and comment are kept by create or replace (checked after).
-- Touches nothing else; the stored baseline stays as it is.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.ops_health_checks()'))
       is distinct from '34cf828987417b2527ebf58c71c1f2c8' then
    raise exception 'ops_health_sm26_invoices down: ops_health_checks() is not the body of 20261020170000; rebuild this file on the live body';
  end if;
end
$pre$;

create or replace function public.ops_health_checks()
returns table (check_id text, area text, status text, summary text, detail jsonb)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
with
cfg as (select coalesce((select ps.value from public.platform_settings ps where ps.key = 'ops_health'), '{}'::jsonb) as v),
flg as (select coalesce((select ps.value from public.platform_settings ps where ps.key = 'registration_flags'), '{}'::jsonb) as v),
cj as (
  select j.jobname, lr.start_time as last_start,
    case
      when s.sch ~ '^\*(/1)? \* \* \* \*$' then 1
      when s.sch ~ '^\*/[0-9]+ \* \* \* \*$' then substring(s.sch from '^\*/([0-9]+)')::int
      when s.sch ~ '^[0-9]+ \* \* \* \*$' then 60
      when s.sch ~ '^[0-9]+ \*/[0-9]+ \* \* \*$' then 60 * substring(s.sch from '^[0-9]+ \*/([0-9]+)')::int
      when s.sch ~ '^[0-9]+ [0-9]+(,[0-9]+)* \* \* \*$' then 1440
      when s.sch ~ '^[0-9]+ [0-9]+ \* \* [0-9]+$' then 10080
    end as every_min
  from cron.job j
  cross join lateral (select regexp_replace(btrim(j.schedule), '\s+', ' ', 'g') as sch) s
  left join lateral (select d.start_time from cron.job_run_details d
    where d.jobid = j.jobid and d.status in ('succeeded', 'failed') order by d.start_time desc limit 1) lr on true
  where j.active),
rd as (
  select d.jobid, d.status as run_status, d.start_time, d.end_time
  from cron.job_run_details d where d.start_time > now() - interval '24 hours'),
hr as (
  select coalesce(r.status_code, 0) as code, coalesce(r.timed_out, false) as timed_out, r.error_msg, r.created,
    case when r.content is not null and pg_input_is_valid(r.content, 'jsonb') then r.content::jsonb end as body
  from net._http_response r where r.created > now() - interval '6 hours'),
wev as (select e.id, e.slug, e.notify_email from public.gl_event e where e.engine = 'guest_list_v1'),
wys as (select coalesce(nullif(cfg.v ->> 'wys_slug', ''), 'wys26') as slug from cfg),
em as (
  select case when split_part(o.name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then 'registrations'
              when position('/' in o.name) = 0 then '(root)' else split_part(o.name, '/', 1) end as grp, count(*) as cnt
  from storage.objects o where o.bucket_id = 'event-media' group by 1)
-- cron
select 'cron.failed_runs'::text as check_id, 'cron'::text as area,
  case when x.n > 0 then 'fail' else 'ok' end as status,
  case when x.n > 0 then x.n || ' failed cron run(s) in 24 h: ' || x.jobs || '.' else 'No failed cron run in 24 h.' end as summary,
  jsonb_build_object('failed_24h', x.n) as detail
from (select count(*) as n, string_agg(distinct coalesce(j.jobname, rd.jobid::text), ', ') as jobs
  from rd left join cron.job j on j.jobid = rd.jobid where rd.run_status = 'failed') x
union all
select 'cron.stale_jobs', 'cron',
  case when x.n > 0 then 'fail' else 'ok' end,
  case when x.n > 0 then x.n || ' scheduled job(s) stopped running: ' || x.jobs || '.' else x.watched || ' watched job(s) ran on time.' end,
  jsonb_build_object('stale', x.n, 'watched', x.watched, 'never_ran', x.never_ran)
from (select count(*) filter (where cj.last_start < now() - make_interval(mins => 2 * cj.every_min + 5)) as n,
    string_agg(cj.jobname, ', ') filter (where cj.last_start < now() - make_interval(mins => 2 * cj.every_min + 5)) as jobs,
    count(*) filter (where cj.every_min is not null) as watched,
    count(*) filter (where cj.every_min is not null and cj.last_start is null) as never_ran
  from cj) x
union all
select 'cron.slow_runs', 'cron',
  case when x.slow + x.stuck > 0 then 'warn' else 'ok' end,
  case when x.slow + x.stuck > 0 then x.slow || ' run(s) over 10 s, ' || x.stuck || ' stuck over 10 min, in 24 h: ' || x.jobs || '.'
    else 'No slow or stuck cron run in 24 h.' end,
  jsonb_build_object('slow', x.slow, 'stuck', x.stuck)
from (select count(*) filter (where rd.end_time - rd.start_time > interval '10 seconds') as slow,
    count(*) filter (where rd.run_status in ('starting', 'running') and rd.start_time < now() - interval '10 minutes') as stuck,
    string_agg(distinct coalesce(j.jobname, rd.jobid::text), ', ') filter (where rd.end_time - rd.start_time > interval '10 seconds'
      or (rd.run_status in ('starting', 'running') and rd.start_time < now() - interval '10 minutes')) as jobs
  from rd left join cron.job j on j.jobid = rd.jobid) x
union all
select 'cron.dormant_sm26', 'cron',
  case when x.n > 0 and extract(month from now()) in (8, 9) then 'warn' else 'ok' end,
  case when x.n > 0 then x.n || ' SM26 reminder job(s) still scheduled (' || x.jobs || '): they fire again in September.'
    else 'No SM26 job left scheduled.' end,
  jsonb_build_object('jobs', x.n)
from (select count(*) as n, string_agg(j.jobname, ', ' order by j.jobname) as jobs
  from cron.job j where j.active and j.jobname like 'sm26-%') x
union all
select 'cron.history_size', 'cron', case when x.n > 200000 then 'warn' else 'ok' end,
  x.n || ' rows of cron history.', jsonb_build_object('rows', x.n)
from (select count(*) as n from cron.job_run_details) x
-- scheduled calls (pg_net keeps the answers 6 h)
union all
select 'calls.vault_secrets', 'calls',
  case when x.n = 2 then 'ok' else 'fail' end,
  case when x.n = 2 then 'Both Vault secrets of the scheduled calls are present.'
    else 'Vault secret(s) missing: the scheduled calls are silently skipped.' end,
  jsonb_build_object('present', x.n)
from (select count(distinct s.name) as n from vault.secrets s where s.name in ('project_url', 'service_role_key')) x
union all
select 'calls.http_errors', 'calls',
  case when x.n > 0 then 'fail' else 'ok' end,
  case when x.n > 0 then x.n || ' scheduled call(s) failed in 6 h (' || x.codes || ').' else x.total || ' scheduled call(s) in 6 h, all 2xx.' end,
  jsonb_build_object('failed', x.n, 'total', x.total)
from (select count(*) filter (where hr.code not between 200 and 299 or hr.timed_out or hr.error_msg is not null) as n,
    count(*) as total,
    string_agg(distinct case when hr.timed_out then 'timeout' when hr.code = 0 then 'no answer' else hr.code::text end, ', ')
      filter (where hr.code not between 200 and 299 or hr.timed_out or hr.error_msg is not null) as codes
  from hr) x
union all
select 'calls.missing_answers', 'calls',
  case when x.n > 0 then 'warn' else 'ok' end,
  case when x.n > 0 then x.n || ' reminder run(s) in 6 h got no answer (' || x.jobs || '): call skipped or lost.'
    else x.runs || ' reminder run(s) in 6 h, all answered.' end,
  jsonb_build_object('missing', x.n, 'runs', x.runs)
from (select count(*) filter (where not m.answered) as n, count(*) as runs,
    string_agg(distinct m.jobname, ', ') filter (where not m.answered) as jobs
  from (select j.jobname, exists (select 1 from hr
      where hr.created between d.start_time and d.start_time + interval '90 seconds'
        and (hr.code not between 200 and 299 or hr.timed_out
          or hr.body ? (case when j.command like '%invoke_send_profile_reminders%' then 'candidates_considered' else 'events' end))) as answered
    from cron.job_run_details d join cron.job j on j.jobid = d.jobid
    where d.start_time between now() - interval '5 hours 50 minutes' and now() - interval '2 minutes' and d.status = 'succeeded'
      and (j.command like '%invoke_guest_webinar_reminders%' or j.command like '%invoke_send_profile_reminders%')) m) x
union all
select 'calls.answer_errors', 'calls',
  case when x.n > 0 then 'warn' else 'ok' end,
  case when x.n > 0 then x.n || ' scheduled call(s) in 6 h answered 2xx with an error inside.' else 'No error inside the answers of 6 h.' end,
  jsonb_build_object('with_errors', x.n)
from (select count(*) as n from hr
  where hr.code between 200 and 299 and jsonb_typeof(hr.body) = 'object'
    and ((hr.body ->> 'ok') = 'false' or (hr.body ->> 'success') = 'false' or hr.body ? 'error'
      or (case jsonb_typeof(hr.body -> 'errors') when 'array' then jsonb_array_length(hr.body -> 'errors')
            when 'number' then (hr.body ->> 'errors')::numeric else 0 end) > 0)) x
union all
select 'calls.queue_backlog', 'calls', case when x.n > 20 then 'warn' else 'ok' end,
  x.n || ' call(s) waiting in the pg_net queue.', jsonb_build_object('queued', x.n)
from (select count(*) as n from net.http_request_queue) x
union all
select 'calls.reminder_volume', 'calls', case when x.n > 40 then 'warn' else 'ok' end,
  x.n || ' profile reminder(s) sent in 24 h' || case when x.n > 40 then ' (over 40: cooldown broken?).' else '.' end,
  jsonb_build_object('sent_24h', x.n)
from (select count(*) as n from public.notification_sends ns where ns.sent_at > now() - interval '24 hours') x
-- registration queues
union all
select 'reg.provisioning', 'registration',
  case when x.dead > 0 or (x.waiting + x.overdue > 0 and x.flag_on) then 'fail' when x.waiting + x.overdue > 0 then 'warn' else 'ok' end,
  case when x.dead > 0 then x.dead || ' account job(s) failed 5 times and are no longer retried.'
    when x.waiting + x.overdue > 0 and x.flag_on then x.waiting || ' account job(s) waiting over 15 min, ' || x.overdue || ' account e-mail(s) overdue.'
    when x.waiting + x.overdue > 0 then (x.waiting + x.overdue) || ' guest(s) wait for the "choose your password" e-mail: switch provisioning is OFF.'
    else 'No account job waiting or failed (provisioning ' || case when x.flag_on then 'on' else 'off' end || ').' end,
  jsonb_build_object('waiting', x.waiting, 'overdue', x.overdue, 'dead', x.dead, 'provisioning_on', x.flag_on)
from (select count(*) filter (where a.status = 'queued' and a.created_at < now() - interval '15 minutes') as waiting,
    count(*) filter (where a.status = 'done' and a.email_sent_at is null
      and a.email_due_at between now() - interval '30 days' and now() - interval '15 minutes') as overdue,
    count(*) filter (where a.status = 'failed' and a.attempts >= 5) as dead,
    coalesce((select (flg.v -> 'provisioning') = 'true'::jsonb from flg), false) as flag_on
  from public.account_provision_job a) x
union all
select 'reg.confirmed_without_job', 'registration',
  case when x.n > 0 then 'fail' else 'ok' end,
  case when x.n > 0 then x.n || ' confirmed on-site guest(s) have no account job (' || x.slugs || ').' else 'Every confirmed on-site guest has an account job.' end,
  jsonb_build_object('missing', x.n)
from (select count(*) as n, string_agg(distinct e.slug, ', ') as slugs
  from public.gl_guest g join public.gl_event e on e.id = g.event_id
  where e.kind = 'onsite' and g.status = 'confirmed'
    and greatest(g.created_at, g.updated_at, g.decided_at, g.responded_at) < now() - interval '5 minutes'
    and not exists (select 1 from public.account_provision_job a where a.source_kind = 'gl_guest' and a.source_id = g.id)) x
union all
select 'reg.outbox', 'registration',
  case when x.dead > 0 then 'fail' when x.stale + x.errored > 0 then 'warn' else 'ok' end,
  case when x.dead + x.stale + x.errored > 0 then x.stale || ' notification(s) of 7 days unsent after 15 min, ' || x.errored || ' with an error, '
      || x.dead || ' given up after 5 attempts.'
    else 'Nothing stuck in the notification outbox (7 days).' end,
  jsonb_build_object('stale', x.stale, 'errored', x.errored, 'dead', x.dead)
-- Only rows send-notification would still send: the person still pending, the join request
-- still open (it refuses the others and leaves them unsent for ever). 7 days at most.
from (select count(*) filter (where o.created_at < now() - interval '15 minutes') as stale,
    count(*) filter (where o.last_error is not null) as errored,
    count(*) filter (where o.attempts >= 5) as dead
  from public.notification_outbox o
  where o.sent_at is null and o.created_at > now() - interval '7 days'
    and case o.kind
      when 'account_under_review' then exists (select 1 from public.profiles pr
        where pr.user_id = o.user_id and pr.access_status::text = 'pending')
      when 'team_join_request' then exists (select 1 from public.organization_invitations i
        where i.id = o.subject_id and i.status = 'join_requested')
      else true end) x
-- payments
union all
select 'pay.emails', 'payments',
  case when x.no_mail + x.stuck > 0 then 'fail' else 'ok' end,
  case when x.no_mail + x.stuck > 0 then x.no_mail || ' paid payment(s) without their e-mail, ' || x.stuck || ' e-mail claim(s) stuck over 10 min.'
    else 'Every recent paid payment has its e-mail.' end,
  jsonb_build_object('paid_without_email', x.no_mail, 'stuck_claims', x.stuck)
from (select (select count(*) from public.payments p
      where p.status = 'paid' and coalesce(p.paid_at, p.updated_at) between now() - interval '30 days' and now() - interval '15 minutes'
        and not exists (select 1 from public.payment_email_log l where l.payment_id = p.id and l.status = 'paid' and l.sent_at is not null)) as no_mail,
    (select count(*) from public.payment_email_log l
      where l.sent_at is null and l.created_at between now() - interval '30 days' and now() - interval '10 minutes') as stuck) x
union all
select 'pay.ipn_review', 'payments',
  case when x.n > 0 then 'fail' else 'ok' end,
  case when x.n > 0 then x.n || ' payment(s) flagged by the bank notification in the last 48 h (mismatch or review).'
    else 'No payment flagged by the bank in the last 48 h.' end,
  jsonb_build_object('flagged', x.n)
-- The flag's own time (payment-ipn writes "at"): payments.updated_at moves with any later edit.
from (select count(distinct p.id) as n from public.payments p
  cross join lateral (values (p.metadata -> 'ipn_review'), (p.metadata -> 'ipn_mismatch')) f(v)
  where jsonb_typeof(f.v) = 'object'
    and case when pg_input_is_valid(f.v ->> 'at', 'timestamptz') then (f.v ->> 'at')::timestamptz end > now() - interval '48 hours') x
union all
select 'pay.stale_pending', 'payments',
  case when x.n > 0 then 'warn' else 'ok' end,
  case when x.n > 0 then x.n || ' payment(s) pending 24 to 72 h after checkout: abandoned, or the bank notification was lost.'
    else 'No payment pending over a day.' end,
  jsonb_build_object('pending', x.n)
from (select count(*) as n from public.payments p
  where p.status = 'pending' and p.created_at between now() - interval '72 hours' and now() - interval '24 hours') x
-- guest lists (WYS)
union all
select 'wys.pass_missing', 'guest list',
  case when x.n > 0 then 'fail' else 'ok' end,
  case when x.n > 0 then x.n || ' confirmed guest(s) without a QR e-mail logged (' || x.slugs || '): resend the pass.'
    else 'Every confirmed guest has a QR e-mail logged.' end,
  jsonb_build_object('missing', x.n)
from (select count(*) as n, string_agg(distinct w.slug, ', ') as slugs
  from public.gl_guest g join wev w on w.id = g.event_id
  where g.status = 'confirmed' and greatest(g.created_at, g.updated_at, g.decided_at, g.responded_at) < now() - interval '10 minutes'
    and not exists (select 1 from public.gl_email_log l where l.guest_id = g.id and l.kind = 'pass')) x
union all
select 'wys.emails_missing', 'guest list',
  case when x.inv + x.ack + x.staff > 0 then 'warn' else 'ok' end,
  case when x.inv + x.ack + x.staff > 0 then x.inv || ' invitation(s), ' || x.ack || ' request acknowledgement(s), '
      || x.staff || ' staff notice(s) not logged after 10 min.'
    else 'Invitations, acknowledgements and staff notices all logged.' end,
  jsonb_build_object('invitation', x.inv, 'request_ack', x.ack, 'staff_notify', x.staff)
from (select
    count(*) filter (where g.status = 'invited'
      and not exists (select 1 from public.gl_email_log l where l.guest_id = g.id and l.kind = 'invitation')) as inv,
    count(*) filter (where g.status = 'requested' and g.source = 'request'
      and not exists (select 1 from public.gl_email_log l where l.guest_id = g.id and l.kind = 'request_ack')) as ack,
    count(*) filter (where g.status = 'requested' and g.source in ('request', 'plus_one') and nullif(btrim(w.notify_email), '') is not null
      and not exists (select 1 from public.gl_email_log l where l.guest_id = g.id and l.kind = 'staff_notify')) as staff
  from public.gl_guest g join wev w on w.id = g.event_id
  where greatest(g.created_at, g.updated_at, g.decided_at, g.responded_at, g.invited_at) < now() - interval '10 minutes') x
union all
select 'wys.event', 'guest list',
  case when e.id is null or e.engine is distinct from 'guest_list_v1' or e.door_token is distinct from 'shared'
    or e.kind is distinct from 'onsite' or e.hidden then 'fail' else 'ok' end,
  case when e.id is null then 'Guest-list event ' || wys.slug || ' is missing.'
    when e.engine is distinct from 'guest_list_v1' or e.door_token is distinct from 'shared' or e.kind is distinct from 'onsite' or e.hidden
      then wys.slug || ' changed: engine ' || coalesce(e.engine, '-') || ', door ' || coalesce(e.door_token, '-') || ', kind '
        || coalesce(e.kind, '-') || ', hidden ' || e.hidden || '.'
    else wys.slug || ': requests ' || case when e.requests_open then 'open' else 'closed' end || ', capacity '
      || coalesce(e.capacity::text, 'unlimited') || '.' end,
  jsonb_build_object('slug', wys.slug, 'requests_open', e.requests_open, 'capacity', e.capacity)
from wys left join public.gl_event e on e.slug = wys.slug
union all
select 'wys.guests_integrity', 'guest list',
  case when x.no_tok + x.dup_tok + x.odd > 0 then 'fail' else 'ok' end,
  case when x.no_tok + x.dup_tok + x.odd > 0 then x.no_tok || ' guest(s) without a token, ' || x.dup_tok || ' duplicated token(s), '
      || x.odd || ' row(s) with an unknown status or source.'
    else x.n || ' guest row(s): tokens unique, statuses and sources valid.' end,
  jsonb_build_object('guests', x.n, 'no_token', x.no_tok, 'duplicate_tokens', x.dup_tok, 'odd_rows', x.odd)
from (select count(g.id) as n, count(g.id) filter (where g.token is null) as no_tok,
    count(g.token) - count(distinct g.token) as dup_tok,
    count(g.id) filter (where g.status not in ('requested', 'invited', 'confirmed', 'declined', 'rejected', 'cancelled')
      or g.source not in ('request', 'invitation', 'plus_one')) as odd
  from wys join public.gl_event e on e.slug = wys.slug join public.gl_guest g on g.event_id = e.id) x
union all
select 'wys.capacity', 'guest list',
  case when x.cap is not null and x.held >= x.cap then 'warn' else 'ok' end,
  x.held || ' seat(s) held (' || x.confirmed || ' confirmed, ' || x.invited || ' invited) of ' || coalesce(x.cap::text, '?') || '; '
    || x.checked_in || ' checked in.',
  jsonb_build_object('held', x.held, 'confirmed', x.confirmed, 'invited', x.invited, 'capacity', x.cap, 'checked_in', x.checked_in)
from (select max(e.capacity) as cap, count(g.id) filter (where g.status in ('confirmed', 'invited')) as held,
    count(g.id) filter (where g.status = 'confirmed') as confirmed, count(g.id) filter (where g.status = 'invited') as invited,
    count(g.id) filter (where g.checked_in_at is not null) as checked_in
  from wys join public.gl_event e on e.slug = wys.slug left join public.gl_guest g on g.event_id = e.id) x
union all
select 'wys.door', 'guest list',
  case when x.door_ok and x.trig_on = 2 then 'ok' else 'fail' end,
  'Door check-in function ' || case when x.door_ok then 'unchanged' else 'CHANGED or missing' end || ', '
    || x.trig_on || ' of 2 guest-list triggers enabled.',
  jsonb_build_object('gl_checkin_unchanged', x.door_ok, 'triggers_enabled', x.trig_on)
from (select coalesce((select case when count(*) = 1 then min(md5(p.prosrc)) end from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname = 'gl_checkin') = 'e2a63a98dcb1f5625b24d71f0cda3a62', false) as door_ok,
    (select count(*) from pg_trigger t where t.tgrelid = 'public.gl_guest'::regclass and not t.tgisinternal and t.tgenabled <> 'D'
      and t.tgname in ('gl_guest_engine_guard', 'gl_guest_queue_provisioning')) as trig_on) x
-- drift
union all
select 'drift.function_pins', 'drift',
  case when x.changed > 0 then 'warn' else 'ok' end,
  case when x.changed > 0 then x.changed || ' pinned function(s) changed: ' || x.names || '. Re-pin after a planned change.'
    else x.pinned || ' pinned function(s) unchanged.' end,
  jsonb_build_object('pinned', x.pinned, 'changed', x.changed)
from (select count(*) as pinned, count(*) filter (where pin.md5_now is distinct from pin.md5_want) as changed,
    string_agg(pin.fn, ', ' order by pin.fn) filter (where pin.md5_now is distinct from pin.md5_want) as names
  from (select k.key as fn, k.value as md5_want,
      (select case when count(*) = 1 then min(md5(p.prosrc)) else md5(string_agg(md5(p.prosrc), ',' order by md5(p.prosrc))) end
        from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = k.key) as md5_now
    from cfg cross join lateral jsonb_each_text(case when jsonb_typeof(cfg.v -> 'pins') = 'object' then cfg.v -> 'pins' else '{}' end) k) pin) x
union all
select 'drift.freeze', 'drift',
  case when x.in_freeze and x.n > 0 then 'warn' else 'ok' end,
  case when not x.in_freeze then 'No freeze in force.'
    when x.n > 0 then x.n || ' migration(s) applied since the freeze began on ' || x.f || ': were they planned?'
    else 'Freeze until ' || x.t || ': no migration since ' || x.f || '.' end,
  jsonb_build_object('in_freeze', x.in_freeze, 'migrations_since', x.n)
from (select fz.f, fz.t, coalesce(current_date between fz.f and fz.t, false) as in_freeze,
    (select count(*) from supabase_migrations.schema_migrations m where m.version >= to_char(fz.f, 'YYYYMMDD')) as n
  from (select case when pg_input_is_valid(cfg.v -> 'freeze' ->> 'from', 'date') then (cfg.v -> 'freeze' ->> 'from')::date end as f,
      case when pg_input_is_valid(cfg.v -> 'freeze' ->> 'to', 'date') then (cfg.v -> 'freeze' ->> 'to')::date end as t
    from cfg) fz) x
union all
select 'drift.sm26_archive', 'drift',
  case when x.base is null or x.cur = x.base then 'ok' else 'fail' end,
  case when x.base is null then 'No SM26 baseline stored.' when x.cur = x.base then 'SM26 archive unchanged (7 tables).'
    else 'The SM26 archive changed: rows added or removed in sm_* tables.' end,
  jsonb_build_object('now', x.cur, 'baseline', x.base)
from (select (select case when jsonb_typeof(cfg.v -> 'baseline' -> 'sm26') = 'object' then cfg.v -> 'baseline' -> 'sm26' end from cfg) as base,
    jsonb_build_object('sm_registration', (select count(*) from public.sm_registration),
      'sm_role_assignment', (select count(*) from public.sm_role_assignment), 'sm_attendee', (select count(*) from public.sm_attendee),
      'sm_badge', (select count(*) from public.sm_badge), 'sm_payment', (select count(*) from public.sm_payment),
      'sm_invoice', (select count(*) from public.sm_invoice), 'sm_networking_pass', (select count(*) from public.sm_networking_pass)) as cur) x
-- security
union all
select 'security.open_functions', 'security',
  case when x.n > 0 then 'warn' else 'ok' end,
  case when x.n > 0 then x.n || ' internal function(s) anyone can run through the API: ' || x.names || '.'
    else 'Internal scheduled-call functions are closed to the API.' end,
  jsonb_build_object('open', x.n)
from (select count(*) as n, string_agg(p.proname, ', ' order by p.proname) as names
  from pg_proc p where p.pronamespace = 'public'::regnamespace
    and ((p.prosecdef and p.proname like 'invoke\_%') or p.proname in ('cleanup_guest_rate_limits', 'notification_outbox_claim', 'ops_health_checks'))
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) x
-- database
union all
select 'db.connections', 'database',
  case when x.used > 0.95 * x.max_c then 'fail' when x.used > 0.8 * x.max_c then 'warn' else 'ok' end,
  x.used || ' of ' || x.max_c || ' connections in use.', jsonb_build_object('used', x.used, 'max', x.max_c)
from (select count(*) filter (where a.backend_type = 'client backend') as used, current_setting('max_connections')::int as max_c
  from pg_stat_activity a) x
union all
select 'db.long_running', 'database',
  case when x.q + x.idle > 0 then 'warn' else 'ok' end,
  x.q || ' query(ies) running over 5 min, ' || x.idle || ' session(s) idle in a transaction over 5 min.',
  jsonb_build_object('long_queries', x.q, 'idle_in_transaction', x.idle)
from (select count(*) filter (where a.state = 'active' and a.query_start < now() - interval '5 minutes') as q,
    count(*) filter (where a.state like 'idle in transaction%' and a.state_change < now() - interval '5 minutes') as idle
  from pg_stat_activity a where a.backend_type = 'client backend' and a.pid <> pg_backend_pid()) x
union all
select 'db.replication_slots', 'database',
  case when x.held > 1073741824 then 'fail' when x.inactive > 0 then 'warn' else 'ok' end,
  x.n || ' replication slot(s), ' || x.inactive || ' inactive, ' || pg_size_pretty(x.held) || ' of WAL held at most.',
  jsonb_build_object('slots', x.n, 'inactive', x.inactive, 'max_wal_held_bytes', x.held)
from (select count(*) as n, count(*) filter (where not s.active and not s.temporary) as inactive,
    coalesce(max(pg_wal_lsn_diff(pg_current_wal_lsn(), s.restart_lsn)), 0)::bigint as held
  from pg_replication_slots s) x
union all
select 'db.wraparound', 'database',
  case when x.age_max > 1000000000 then 'fail' when x.age_max > 150000000 then 'warn' else 'ok' end,
  'Oldest transaction id age ' || x.age_max || '.', jsonb_build_object('xid_age', x.age_max)
from (select max(age(d.datfrozenxid)) as age_max from pg_database d) x
union all
select 'db.size', 'database', case when x.bytes > 4294967296 then 'warn' else 'ok' end,
  'Database size ' || pg_size_pretty(x.bytes) || '.', jsonb_build_object('bytes', x.bytes)
from (select pg_database_size(current_database()) as bytes) x
-- storage (no backup of the files exists)
union all
select 'storage.event_media', 'storage',
  case when x.lost > 0 then 'fail' else 'ok' end,
  case when x.lost > 0 then x.lost || ' file(s) missing from event-media (' || x.groups || '), which has no backup.'
    when not x.has_base then x.n || ' file(s) in event-media, no baseline stored.'
    else x.n || ' file(s) in event-media, none missing against the baseline.' end,
  jsonb_build_object('files', x.n, 'missing', x.lost)
-- Per folder group (registrations = the per-registration folders, imported, invoices...), so a
-- new upload in one group cannot hide a deletion in another.
from (select (select coalesce(sum(em.cnt), 0) from em) as n,
    (select coalesce(jsonb_typeof(cfg.v -> 'baseline' -> 'event_media') = 'object', false) from cfg) as has_base,
    coalesce(sum(greatest(k.want - coalesce(em.cnt, 0), 0)), 0) as lost,
    string_agg(k.grp || ' -' || (k.want - coalesce(em.cnt, 0)), ', ' order by k.grp) filter (where coalesce(em.cnt, 0) < k.want) as groups
  from cfg
  cross join lateral jsonb_each(case when jsonb_typeof(cfg.v -> 'baseline' -> 'event_media') = 'object'
    then cfg.v -> 'baseline' -> 'event_media' else '{}'::jsonb end) e
  cross join lateral (select e.key as grp, case when jsonb_typeof(e.value) = 'number' then (e.value)::numeric end as want) k
  left join em on em.grp = k.grp) x
-- other queues
union all
select 'other.contact_inbox', 'other',
  case when x.n > 0 then 'warn' else 'ok' end,
  case when x.n > 0 then x.n || ' contact message(s) saved but not e-mailed to the inbox: read them in the admin.'
    else 'Every contact message reached the inbox.' end,
  jsonb_build_object('not_emailed', x.n)
from (select count(*) as n from public.contact_submissions c
  where c.emailed_at is null and c.created_at between now() - interval '30 days' and now() - interval '15 minutes') x
union all
select 'other.pulse_snapshot', 'other',
  case when (now() at time zone 'UTC')::time > time '07:15'
    and coalesce(x.last_day, date '2000-01-01') < (now() at time zone 'UTC')::date then 'warn' else 'ok' end,
  'Last daily KPI snapshot: ' || coalesce(x.last_day::text, 'none') || '.', jsonb_build_object('last', x.last_day)
from (select max(p.snapshot_date) as last_day from public.pulse_snapshots p) x
union all
select 'other.crm_outbox', 'other', case when x.n > 0 then 'warn' else 'ok' end,
  x.n || ' CRM bridge event(s) failed, dead or undelivered after 1 h.', jsonb_build_object('stuck', x.n)
from (select count(*) as n from public.commercial_outbox_events c where c.status in ('failed', 'dead_letter')
  or (c.status <> 'delivered' and (c.created_at < now() - interval '1 hour' or c.attempts >= 5))) x
union all
select 'other.digest_log', 'other', case when x.n > 0 then 'warn' else 'ok' end,
  x.n || ' weekly digest(s) stuck in "sending" over 1 h.', jsonb_build_object('stuck', x.n)
from (select count(*) as n from public.digest_log dl where dl.status = 'sending' and dl.created_at < now() - interval '1 hour') x
union all
select 'other.invitation_expiry', 'other', case when x.n > 0 then 'warn' else 'ok' end,
  x.n || ' team invitation(s) past expiry still pending' || case when x.n > 0 then ': the expiry job is not running.' else '.' end,
  jsonb_build_object('overdue', x.n)
from (select count(*) as n from public.organization_invitations i where i.status = 'pending' and i.expires_at < now() - interval '15 minutes') x
$function$;

do $post$
begin
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.ops_health_checks()'))
       is distinct from '1ff11d35c3239f5257c627b2a9b10087' then
    raise exception 'ops_health_sm26_invoices down: the old body of ops_health_checks() did not arrive intact';
  end if;
  if not coalesce((select pg_get_userbyid(p.proowner) = 'postgres' and not p.prosecdef and p.provolatile = 's'
                          and p.proparallel = 'u' and l.lanname = 'sql' and p.prokind = 'f' and p.proretset
                          and array_to_string(p.proconfig, ';') = 'search_path=public, pg_temp'
                          and p.proacl::text = '{postgres=X/postgres}'
                          and pg_get_function_identity_arguments(p.oid) = ''
                          and pg_get_function_result(p.oid) = 'TABLE(check_id text, area text, status text, summary text, detail jsonb)'
                          and md5(obj_description(p.oid, 'pg_proc')) = '0881dd62ca9de11a38fba7730f82e965'
                     from pg_proc p join pg_language l on l.oid = p.prolang
                    where p.oid = to_regprocedure('public.ops_health_checks()')), false) then
    raise exception 'ops_health_sm26_invoices down: owner, security, volatility, search_path, grants, signature or comment of ops_health_checks() moved';
  end if;
end
$post$;

-- E. Checks after the down, then the report (rolls everything back)
do $e$
declare
  v_txt text;
begin
  insert into _dr_res (ok, label) values (
    coalesce((select md5(p.prosrc) = (select o.m from _dr_old o) and md5(pg_get_functiondef(p.oid)) = (select o.def_m from _dr_old o)
                from pg_proc p where p.oid = to_regprocedure('public.ops_health_checks()')), false),
    'E1 down: md5(prosrc) back to ' || coalesce((select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.ops_health_checks()')), 'MISSING')
      || ', full definition identical to the snapshot');
  insert into _dr_res (ok, label) values (pg_temp._dr_meta() = (select o.meta from _dr_old o),
    'E2 down: same oid, owner, security, volatility, search_path, grants, signature, comment');
  insert into _dr_res (ok, label) values (
    (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace) = (select count(*) from _dr_fn)
      and not exists ((select f.fn, f.acl, f.m from _dr_fn f)
                      except (select p.oid::regprocedure::text, coalesce(array_to_string(p.proacl, ','), ''), md5(p.prosrc)
                                from pg_proc p where p.pronamespace = 'public'::regnamespace)),
    'E3 down: public functions back to the snapshot (' || (select count(*) from _dr_fn) || ')');
  v_txt := pg_temp._dr_diff(null::text);
  insert into _dr_res (ok, label) values (v_txt = '',
    'E4 down: every row equals the old body''s again, drift.sm26_archive included ('
      || coalesce((select h.status from public.ops_health_checks() h where h.check_id = 'drift.sm26_archive'), 'missing') || '): '
      || coalesce(nullif(v_txt, ''), 'no difference'));
  insert into _dr_res (ok, label) values (
    (select ps::text from public.platform_settings ps where ps.key = 'ops_health') = (select s.row_txt from _dr_ps s),
    'E5 platform_settings ops_health row as in the snapshot');
  select string_agg(case when r.ok then 'PASS ' else 'FAIL ' end || r.label, chr(10) order by r.n) into v_txt from _dr_res r;
  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (ops_health_sm26_invoices, run %s)',
    (select count(*) from _dr_res where ok), (select count(*) from _dr_res where ok is not true), now()) || chr(10) || v_txt;
end
$e$;
