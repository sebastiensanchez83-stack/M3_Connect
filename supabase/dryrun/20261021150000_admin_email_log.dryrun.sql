-- DRY RUN of supabase/migrations/20261021150000_admin_email_log.sql and of its down.
-- NOT A MIGRATION. ONE query text, ONE execute_sql call, BEFORE the file is applied.
-- A snapshot, the migration verbatim, checks, the down verbatim, checks again. Writes NO row
-- (the staff calls run as a verified admin and a verified member through request.jwt.claims,
-- inside this transaction). Old and new health outputs are compared inside ONE statement (the
-- old body runs as a pg_temp copy of the live one), so a cron run, a pg_net answer or a new
-- connection during the dry run cannot make them differ.
-- Ends with RAISE EXCEPTION 'DRYRUN ...': everything rolls back. Expected: "20 PASS, 0 FAIL".
-- C5 prints the new check as it reads today (counts only).

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

-- Runs a staff call as the account p_uid (role authenticated, its JWT claims), returns the row
-- count or the SQLSTATE it raised ('rows:N' / 'err:42501'), then goes back to the dry run's role.
create function pg_temp._dr_as(p_uid uuid, p_sql text) returns text language plpgsql as $s$
declare
  v_n bigint;
  v_out text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  execute 'set local role authenticated';
  begin
    execute 'select count(*) from (' || p_sql || ') q' into v_n;
    v_out := 'rows:' || v_n;
  exception when others then
    v_out := 'err:' || sqlstate;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return v_out;
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
  insert into _dr_res (ok, label) values ((select o.m from _dr_old o) = '34cf828987417b2527ebf58c71c1f2c8',
    'A2 live ops_health_checks() md5 ' || coalesce((select o.m from _dr_old o), 'MISSING') || ' (pinned 34cf828987417b2527ebf58c71c1f2c8)');
end
$a1$;

-- B. The migration, verbatim
-- Admin e-mail log, and a health check for too many automatic e-mails (admin refonte, lane
-- inbox, 21 Oct 2026). Victor, 21 Oct: one screen for the M3 team that gathers every e-mail log,
-- a count per person over 24 h and 7 days, and a monitor alert when a member gets more than 5
-- AUTOMATIC e-mails in 24 h (the e-mails the person asked for themselves do not count).
-- FILES ONLY: not applied. Down: supabase/migrations/down/20261021150000_admin_email_log.down.sql.
-- Dry run: supabase/dryrun/20261021150000_admin_email_log.dryrun.sql (runs this file, then the
-- down, in one rolled-back transaction; expected "20 PASS, 0 FAIL").
--
-- Adds three functions. No table, no row, no trigger, no policy: harmless for main.
--   public.email_log_rows(p_since)  the read model: one row per e-mail found in the 8 logs below,
--     with when, which log, its kind, origin, status, the recipient (resolved to a profile when
--     the log has only an address or only an account) and the event or object it is about.
--     Owner only (no API access): read by the two staff functions and by ops_health_checks().
--   public.admin_email_log(p_days, p_source, p_status, p_query, p_limit)  staff only
--     (is_moderator(): verified admins and moderators), newest first, at most 1000 rows, 90 days.
--   public.admin_email_log_top(p_limit)  staff only: the people who received the most e-mails,
--     automatic ones over 24 h and 7 days, and every e-mail over 7 days.
--   Both SECURITY DEFINER, search_path '', EXECUTE revoked from public and anon.
--
-- The logs and how each e-mail is classed (origin):
--   notification_sends    profile reminders                               automatic
--   sm_email_log          Smart Marina 2026 console e-mails               automatic; registration_received
--                                                                         and paid (the person's own step) asked
--   gl_email_log          guest lists (WYS)                               automatic; request_ack, and a pass
--                                                                         no staff member sent, asked;
--                                                                         staff_notify goes to M3: staff
--   invitation_recipient  invitation campaigns (sent_at / send_error)     automatic
--   payment_email_log     payment receipts                                asked
--   digest_log            the Friday digest                               automatic
--   notification_outbox   sign-up and team notices                        automatic; account_under_review
--                                                                         (after the person's sign-up) asked;
--                                                                         comment_report goes to M3: staff
--   email_rate_log        send-notification / notify-admins / accept-invite throttle rows: "resolved:<ref>"
--                         names the recipient; the other rows name the member whose action sent the
--                         e-mail, not who received it (recipient unknown, never counted per person);
--                         notify-admins:* go to M3: staff. A "send-notification:<dedupe key>" row of a
--                         queued notification is left out: its notification_outbox row is that e-mail.
--   Password reset, magic link and sign-up confirmation (send-email, the auth hook) are logged
--   nowhere, so they never count.
-- Status: sent, failed, pending (queued or being sent), skipped (the queue decided not to send).
--
-- Changes public.ops_health_checks(): pinned on the live body (md5(prosrc) 34cf828987417b2527ebf58c71c1f2c8,
-- applied by 20261020170000, read on 21 Oct). ONE block is inserted just before
-- "-- registration queues": email.automatic_volume, warn when at least one person received more
-- than 5 automatic e-mails that were sent in the last 24 hours (origin automatic, status sent,
-- recipient known). Counts only in its summary and detail (never a name or an address); who it
-- is shows in the admin's E-mail log. Every other check is byte for byte the same (the dry run
-- compares every row with the old body). Signature, SQL language, STABLE, SECURITY INVOKER,
-- owner, search_path, grants (owner only) and comment do not move: create or replace keeps them.
-- ops_health_checks is not among the md5 pins of drift.function_pins: no re-pin.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.ops_health_checks()'))
       is distinct from '34cf828987417b2527ebf58c71c1f2c8' then
    raise exception 'admin_email_log: ops_health_checks() changed since 21 Oct; rebuild this file on the live body';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('email_log_rows', 'admin_email_log', 'admin_email_log_top')) then
    raise exception 'admin_email_log: one of the three functions already exists';
  end if;
end
$pre$;

-- ---- 1. The read model (owner only) ---------------------------------------------------------

create function public.email_log_rows(p_since timestamptz)
returns table (
  sent_at timestamptz,
  source text,
  kind text,
  origin text,
  status text,
  recipient_key text,
  recipient_user_id uuid,
  recipient_email text,
  recipient_name text,
  related_label text,
  related_kind text,
  related_id uuid,
  actor_user_id uuid
)
language sql
stable
set search_path = ''
as $fn$
  with raw as (
    select ns.sent_at as at, 'profile_reminders'::text as src, ns.notification_type as kind,
           'automatic'::text as origin, 'sent'::text as status, ns.user_id as uid, null::text as email,
           null::text as rel_label, null::text as rel_kind, null::uuid as rel_id, null::uuid as actor
      from public.notification_sends ns
     where ns.sent_at >= p_since
    union all
    select l.sent_at, 'sm26', l.kind,
           case when l.kind in ('registration_received', 'paid') then 'asked' else 'automatic' end,
           'sent', null, l.to_email, coalesce(e.name, 'Smart Marina'), 'sm_event', l.event_id, l.sent_by
      from public.sm_email_log l
      left join public.sm_event e on e.id = l.event_id
     where l.sent_at >= p_since
    union all
    select l.sent_at, 'guest_list', l.kind,
           case when l.kind = 'staff_notify' then 'staff'
                when l.kind = 'request_ack' or (l.kind = 'pass' and l.sent_by is null) then 'asked'
                else 'automatic' end,
           'sent', case when l.kind = 'staff_notify' then null else g.user_id end, l.to_email,
           e.title, 'gl_event', l.event_id, l.sent_by
      from public.gl_email_log l
      left join public.gl_event e on e.id = l.event_id
      left join public.gl_guest g on g.id = l.guest_id
     where l.sent_at >= p_since
    union all
    select coalesce(r.sent_at, r.sending_at, r.updated_at), 'invitations', 'invitation', 'automatic',
           case when r.sent_at is not null then 'sent' when r.send_error is not null then 'failed' else 'pending' end,
           r.profile_user_id, r.email, c.name, 'invitation_campaign', c.id, null
      from public.invitation_recipient r
      join public.invitation_campaign c on c.id = r.campaign_id
     where (r.sent_at is not null or r.sending_at is not null or r.send_error is not null)
       and coalesce(r.sent_at, r.sending_at, r.updated_at) >= p_since
    union all
    select coalesce(l.sent_at, l.created_at), 'payments', 'payment_' || l.status, 'asked',
           case when l.sent_at is not null then 'sent'
                when l.created_at < now() - interval '10 minutes' then 'failed' else 'pending' end,
           p.user_id, null, coalesce(p.reference_type, p.payment_type), 'payment', l.payment_id, null
      from public.payment_email_log l
      left join public.payments p on p.id = l.payment_id
     where coalesce(l.sent_at, l.created_at) >= p_since
    union all
    select coalesce(d.sent_at, d.created_at), 'digest', d.kind, 'automatic',
           case when d.status = 'sent' then 'sent'
                when d.created_at < now() - interval '1 hour' then 'failed' else 'pending' end,
           d.user_id, null, 'Week of ' || to_char(d.week_start, 'DD Mon YYYY'), null, null, null
      from public.digest_log d
     where coalesce(d.sent_at, d.created_at) >= p_since
    union all
    select coalesce(o.sent_at, o.created_at), 'outbox', o.kind,
           case when o.kind = 'account_under_review' then 'asked'
                when o.kind = 'comment_report' then 'staff' else 'automatic' end,
           case when o.sent_at is null then case when o.attempts >= 5 then 'failed' else 'pending' end
                when o.last_error like 'not sent%' then 'skipped' else 'sent' end,
           o.user_id, null, null, null, o.subject_id, o.actor_id
      from public.notification_outbox o
     where coalesce(o.sent_at, o.created_at) >= p_since
    union all
    select r.created_at, 'notifications', r.kind,
           case when r.kind like 'notify-admins:%' then 'staff' else 'automatic' end,
           'sent',
           case when r.kind like 'resolved:%' then r.actor_id end, null, null, null, null,
           case when r.kind like 'resolved:%' then null else r.actor_id end
      from public.email_rate_log r
     where r.created_at >= p_since
       and not (r.kind like 'send-notification:%'
                and exists (select 1 from public.notification_outbox o where o.dedupe_key = substr(r.kind, 19)))
  )
  select raw.at, raw.src, raw.kind, raw.origin, raw.status,
         coalesce(lower(nullif(btrim(coalesce(raw.email, pu.email, au.email::text)), '')), 'user:' || raw.uid::text),
         coalesce(raw.uid, pe.user_id),
         coalesce(nullif(btrim(raw.email), ''), pu.email, au.email::text),
         nullif(btrim(concat_ws(' ', coalesce(pu.first_name, pe.first_name), coalesce(pu.last_name, pe.last_name))), ''),
         raw.rel_label, raw.rel_kind, raw.rel_id, raw.actor
    from raw
    left join public.profiles pu on pu.user_id = raw.uid
    left join auth.users au on au.id = raw.uid
    left join lateral (
      select p2.user_id, p2.first_name, p2.last_name
        from public.profiles p2
       where raw.uid is null and nullif(btrim(raw.email), '') is not null
         and lower(p2.email) = lower(btrim(raw.email))
       order by p2.created_at
       limit 1) pe on true
$fn$;

revoke all on function public.email_log_rows(timestamptz) from public, anon, authenticated, service_role;
comment on function public.email_log_rows(timestamptz) is
  'One row per e-mail found in the 8 e-mail logs since p_since, with origin automatic / asked / staff and status sent / failed / pending / skipped. Owner only: read by admin_email_log(), admin_email_log_top() and ops_health_checks(). 20261021150000.';

-- ---- 2. The staff functions -----------------------------------------------------------------

create function public.admin_email_log(
  p_days integer default 7,
  p_source text default null,
  p_status text default null,
  p_query text default null,
  p_limit integer default 300
)
returns table (
  sent_at timestamptz,
  source text,
  kind text,
  origin text,
  status text,
  recipient_user_id uuid,
  recipient_email text,
  recipient_name text,
  related_label text,
  related_kind text,
  related_id uuid,
  actor_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_q text := lower(nullif(btrim(coalesce(p_query, '')), ''));
begin
  if not coalesce(public.is_moderator(), false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select r.sent_at, r.source, r.kind, r.origin, r.status, r.recipient_user_id, r.recipient_email, r.recipient_name,
           r.related_label, r.related_kind, r.related_id,
           nullif(btrim(concat_ws(' ', a.first_name, a.last_name)), '')
      from public.email_log_rows(now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 90))) r
      left join public.profiles a on a.user_id = r.actor_user_id
     where (p_source is null or r.source = p_source)
       and (p_status is null or r.status = p_status)
       and (v_q is null or strpos(lower(concat_ws(' ', r.recipient_email, r.recipient_name, r.kind, r.related_label)), v_q) > 0)
     order by r.sent_at desc
     limit least(greatest(coalesce(p_limit, 300), 1), 1000);
end
$fn$;

create function public.admin_email_log_top(p_limit integer default 15)
returns table (
  recipient_key text,
  recipient_user_id uuid,
  recipient_email text,
  recipient_name text,
  automatic_24h integer,
  automatic_7d integer,
  all_7d integer,
  last_sent_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
begin
  if not coalesce(public.is_moderator(), false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select r.recipient_key,
           (array_agg(r.recipient_user_id) filter (where r.recipient_user_id is not null))[1],
           max(r.recipient_email),
           max(r.recipient_name),
           (count(*) filter (where r.origin = 'automatic' and r.sent_at >= now() - interval '24 hours'))::integer,
           (count(*) filter (where r.origin = 'automatic'))::integer,
           count(*)::integer,
           max(r.sent_at)
      from public.email_log_rows(now() - interval '7 days') r
     where r.status = 'sent' and r.recipient_key is not null and r.origin <> 'staff'
     group by r.recipient_key
     order by 5 desc, 6 desc, 7 desc, 8 desc
     limit least(greatest(coalesce(p_limit, 15), 1), 100);
end
$fn$;

revoke all on function public.admin_email_log(integer, text, text, text, integer) from public, anon;
revoke all on function public.admin_email_log_top(integer) from public, anon;
grant execute on function public.admin_email_log(integer, text, text, text, integer) to authenticated, service_role;
grant execute on function public.admin_email_log_top(integer) to authenticated, service_role;
comment on function public.admin_email_log(integer, text, text, text, integer) is
  'Staff only (is_moderator()): the e-mails of the last p_days days (1 to 90) from every e-mail log, newest first, filtered by source, status and a text; at most 1000 rows. 20261021150000.';
comment on function public.admin_email_log_top(integer) is
  'Staff only (is_moderator()): the people who received the most e-mails (sent, not to M3): automatic ones over 24 h and 7 days, every one over 7 days. 20261021150000.';

-- ---- 3. The health check --------------------------------------------------------------------

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
-- e-mails (every log, through email_log_rows; what the person asked for does not count)
union all
select 'email.automatic_volume', 'e-mails',
  case when x.n > 0 then 'warn' else 'ok' end,
  case when x.n > 0 then x.n || ' person(s) received more than 5 automatic e-mails in 24 h (most: ' || x.top || '). Who: the admin''s E-mail log.'
    else 'Nobody received more than 5 automatic e-mails in 24 h (most: ' || x.top || ').' end,
  jsonb_build_object('people_over', x.n, 'max_24h', x.top, 'threshold', 5)
from (select count(*) filter (where c.cnt > 5) as n, coalesce(max(c.cnt), 0) as top
  from (select count(*) as cnt from public.email_log_rows(now() - interval '24 hours') r
    where r.origin = 'automatic' and r.status = 'sent' and r.recipient_key is not null
    group by r.recipient_key) c) x
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

do $post$
begin
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.ops_health_checks()'))
       is distinct from 'b8a5d05adefb4fd85a46b4bf6f408107' then
    raise exception 'admin_email_log: the new ops_health_checks() body is not the expected one (line endings changed?)';
  end if;
end
$post$;

-- C. Checks after the migration
do $c$
declare
  v_new text;
  v_old text;
  v_mark text := '-- registration queues';
  v_k integer;
  v_mid text;
  v_txt text;
  v_r record;
  v_since timestamptz := now() - interval '30 days';
  v_admin uuid;
  v_member uuid;
  v_a text;
  v_b text;
  v_ok boolean;
  v_bad bigint;
  v_all bigint;
begin
  select p.prosrc into v_new from pg_proc p where p.oid = to_regprocedure('public.ops_health_checks()');
  select o.src into v_old from _dr_old o;

  -- C1 the bodies, by md5
  insert into _dr_res (ok, label) values (
    md5(v_new) = 'b8a5d05adefb4fd85a46b4bf6f408107',
    'C1 md5(prosrc) ' || (select o.m from _dr_old o) || ' -> ' || coalesce(md5(v_new), 'MISSING') || ' (expected b8a5d05adefb4fd85a46b4bf6f408107)');

  -- C2 nothing else of the function moved
  insert into _dr_res (ok, label) values (
    pg_temp._dr_meta() = (select o.meta from _dr_old o),
    'C2 same oid, owner, SECURITY INVOKER, STABLE, parallel, language, search_path, grants, signature, comment');

  -- C3 the new body is the old one with ONE block inserted before "-- registration queues"
  v_k := strpos(v_old, v_mark);
  v_mid := substr(v_new, v_k, length(v_new) - length(v_old));
  insert into _dr_res (ok, label) values (
    (length(v_old) - length(replace(v_old, v_mark, ''))) / length(v_mark) = 1
      and left(v_new, v_k - 1) = left(v_old, v_k - 1)
      and substr(v_new, v_k + length(v_mid)) = substr(v_old, v_k)
      and v_mid like '-- e-mails %'
      and (length(v_mid) - length(replace(v_mid, 'union all', ''))) / 9 = 1
      and (length(v_mid) - length(replace(v_mid, 'select ''', ''))) / 8 = 1
      and strpos(v_mid, 'select ''email.automatic_volume'', ''e-mails'',') > 0,
    'C3 byte for byte the old body outside ONE inserted block of ' || length(v_mid) || ' characters ('
      || (v_k - 1) || ' characters before it, ' || (length(v_old) - v_k + 1) || ' after it), one check in it');

  -- C4 every other row equals the old body's, same statement
  v_txt := pg_temp._dr_diff('email.automatic_volume');
  insert into _dr_res (ok, label) values (v_txt = '',
    'C4 every row but email.automatic_volume equals the old body''s: ' || coalesce(nullif(v_txt, ''), 'no difference'));

  -- C5 the new check, as it reads today
  select h.* into v_r from public.ops_health_checks() h where h.check_id = 'email.automatic_volume';
  insert into _dr_res (ok, label) values (
    v_r.check_id is not null and v_r.area = 'e-mails' and v_r.status in ('ok', 'warn')
      and (v_r.status = 'warn') = ((v_r.detail ->> 'people_over')::int > 0)
      and (v_r.detail ->> 'threshold')::int = 5 and v_r.summary !~ '@',
    'C5 email.automatic_volume today: ' || coalesce(v_r.status, 'MISSING') || ' "' || coalesce(v_r.summary, '') || '" '
      || coalesce(v_r.detail::text, ''));
  insert into _dr_res (ok, label) values (
    (select count(*) from public.ops_health_checks()) = (select count(*) from _dr_before) + 1,
    'C6 ' || (select count(*) from public.ops_health_checks()) || ' checks (one more than ' || (select count(*) from _dr_before) || ')');

  -- C7 every e-mail of the 8 logs over 30 days, one row each
  select string_agg(x.src || ' ' || x.got || '/' || x.want, ', ' order by x.src), bool_and(x.got = x.want)
    into v_a, v_ok
    from (select s.src, s.want, (select count(*) from public.email_log_rows(v_since) e where e.source = s.src) as got
            from (values
              ('profile_reminders', (select count(*) from public.notification_sends t where t.sent_at >= v_since)),
              ('sm26', (select count(*) from public.sm_email_log t where t.sent_at >= v_since)),
              ('guest_list', (select count(*) from public.gl_email_log t where t.sent_at >= v_since)),
              ('invitations', (select count(*) from public.invitation_recipient t
                                where (t.sent_at is not null or t.sending_at is not null or t.send_error is not null)
                                  and coalesce(t.sent_at, t.sending_at, t.updated_at) >= v_since)),
              ('payments', (select count(*) from public.payment_email_log t where coalesce(t.sent_at, t.created_at) >= v_since)),
              ('digest', (select count(*) from public.digest_log t where coalesce(t.sent_at, t.created_at) >= v_since)),
              ('outbox', (select count(*) from public.notification_outbox t where coalesce(t.sent_at, t.created_at) >= v_since)),
              ('notifications', (select count(*) from public.email_rate_log t where t.created_at >= v_since
                                   and not (t.kind like 'send-notification:%' and exists
                                     (select 1 from public.notification_outbox o where o.dedupe_key = substr(t.kind, 19)))))
            ) s(src, want)) x;
  insert into _dr_res (ok, label) values (coalesce(v_ok, false),
    'C7 rows per log over 30 days (got/want): ' || coalesce(v_a, 'none'));

  -- C8 every row well formed
  select count(*) filter (where e.sent_at is null or e.origin not in ('automatic', 'asked', 'staff')
                            or e.status not in ('sent', 'failed', 'pending', 'skipped')),
         count(*)
    into v_bad, v_all from public.email_log_rows(now() - interval '90 days') e;
  insert into _dr_res (ok, label) values (v_bad = 0,
    'C8 90 days: ' || v_all || ' row(s), ' || v_bad || ' row(s) with no date or an unknown origin or status');

  -- C9 who may run what
  insert into _dr_res (ok, label) values (
    not has_function_privilege('anon', 'public.email_log_rows(timestamptz)', 'execute')
      and not has_function_privilege('authenticated', 'public.email_log_rows(timestamptz)', 'execute')
      and not has_function_privilege('service_role', 'public.email_log_rows(timestamptz)', 'execute')
      and not has_function_privilege('anon', 'public.admin_email_log(integer, text, text, text, integer)', 'execute')
      and not has_function_privilege('anon', 'public.admin_email_log_top(integer)', 'execute')
      and has_function_privilege('authenticated', 'public.admin_email_log(integer, text, text, text, integer)', 'execute')
      and has_function_privilege('authenticated', 'public.admin_email_log_top(integer)', 'execute')
      and (select bool_and(p.prosecdef = (p.proname <> 'email_log_rows') and array_to_string(p.proconfig, ';') = 'search_path=""'
                           and pg_get_userbyid(p.proowner) = 'postgres')
             from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('email_log_rows', 'admin_email_log', 'admin_email_log_top'))
      and (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('email_log_rows', 'admin_email_log', 'admin_email_log_top')) = 3,
    'C9 email_log_rows owner only (INVOKER); admin_email_log and _top SECURITY DEFINER, authenticated yes, anon no; search_path '''' everywhere');

  -- C10 nobody signed in: refused
  begin
    perform count(*) from public.admin_email_log();
    v_a := 'ran';
  exception when others then
    v_a := sqlstate;
  end;
  begin
    perform count(*) from public.admin_email_log_top();
    v_b := 'ran';
  exception when others then
    v_b := sqlstate;
  end;
  insert into _dr_res (ok, label) values (v_a = '42501' and v_b = '42501',
    'C10 without an account: admin_email_log ' || v_a || ', admin_email_log_top ' || v_b || ' (expected 42501)');

  -- C11 a verified member who is not staff: refused; C12 a verified admin: the rows
  select p.user_id into v_member from public.profiles p
   where p.access_status::text = 'verified' and p.persona::text not in ('admin', 'moderator') order by p.created_at limit 1;
  select p.user_id into v_admin from public.profiles p
   where p.access_status::text = 'verified' and p.persona::text = 'admin' order by p.created_at limit 1;
  v_a := pg_temp._dr_as(v_member, 'select * from public.admin_email_log()');
  v_b := pg_temp._dr_as(v_member, 'select * from public.admin_email_log_top()');
  insert into _dr_res (ok, label) values (v_member is not null and v_a = 'err:42501' and v_b = 'err:42501',
    'C11 a verified member: admin_email_log ' || v_a || ', admin_email_log_top ' || v_b);
  v_a := pg_temp._dr_as(v_admin, 'select * from public.admin_email_log(30, null, null, null, 1000)');
  v_txt := 'rows:' || least((select count(*) from public.email_log_rows(now() - interval '30 days')), 1000);
  v_b := pg_temp._dr_as(v_admin, 'select * from public.admin_email_log_top(100)');
  insert into _dr_res (ok, label) values (v_admin is not null and v_a = v_txt and v_b like 'rows:%',
    'C12 a verified admin: admin_email_log(30 days) ' || v_a || ' (expected ' || v_txt || '), admin_email_log_top ' || v_b);
  v_a := pg_temp._dr_as(v_admin, 'select * from public.admin_email_log(90, ''sm26'', ''sent'', ''@'', 5)');
  insert into _dr_res (ok, label) values (v_a ~ '^rows:[0-5]$',
    'C13 filters and limit: admin_email_log(90, sm26, sent, "@", 5) ' || v_a);
  insert into _dr_res (ok, label) values (current_user = (select session_user) or current_user = 'postgres',
    'C14 back to the dry run''s role after the staff calls: ' || current_user);
end
$c$;

-- D. The down, verbatim
-- DOWN for supabase/migrations/20261021150000_admin_email_log.sql
-- Puts back, byte for byte, the body of public.ops_health_checks() applied by 20261020170000
-- (md5(prosrc) 34cf828987417b2527ebf58c71c1f2c8: no email.automatic_volume check), then drops the three functions
-- the migration added: admin_email_log, admin_email_log_top, email_log_rows. Owner, grants,
-- search_path and comment of ops_health_checks are kept by create or replace. Touches no row.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.ops_health_checks()'))
       is distinct from 'b8a5d05adefb4fd85a46b4bf6f408107' then
    raise exception 'admin_email_log down: ops_health_checks() is not the body of 20261021150000; rebuild this file on the live body';
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

drop function public.admin_email_log(integer, text, text, text, integer);
drop function public.admin_email_log_top(integer);
drop function public.email_log_rows(timestamptz);

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
    'E3 down: public functions back to the snapshot (' || (select count(*) from _dr_fn) || '), the three new ones gone');
  v_txt := pg_temp._dr_diff(null::text);
  insert into _dr_res (ok, label) values (v_txt = '',
    'E4 down: every row equals the old body''s again, no email.automatic_volume: ' || coalesce(nullif(v_txt, ''), 'no difference'));
  select string_agg(case when r.ok then 'PASS ' else 'FAIL ' end || r.label, chr(10) order by r.n) into v_txt from _dr_res r;
  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (admin_email_log, run %s)',
    (select count(*) from _dr_res where ok), (select count(*) from _dr_res where ok is not true), now()) || chr(10) || v_txt;
end
$e$;
