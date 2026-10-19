-- Registration Phase 3 (DB lane), part 4 of 4: timing of the account e-mail, and the cron
-- wake rules of the Phase 3 jobs (provision, outbox).
-- Spec: regspec-en.md §3.6, §4.2, §4.3; Victor, 15 Oct 2026: when M3 confirms a WYS guest the
-- guest-list function sends its QR e-mail UNCHANGED, and within about one to two minutes a
-- SECOND e-mail follows, "Your Smart Marina Connect account is ready, choose your password"
-- (provision-person, account_ready_set_password), NEVER before the QR e-mail. Other on-site
-- events follow their editor setting (with_confirmation / after_event + date). Contract §11.5.
-- NOT APPLIED. Independent of parts 1-3 (any order). Deploy registration-cron v2 (EDGE lane,
-- job 'outbox') BEFORE applying this file: it schedules that job (dormant while the flag
-- outbox_sender is off, so an older registration-cron is never called with it).
-- Down: supabase/migrations/down/20261016091500_review_and_validation_provisioning.down.sql.
-- Dry run: supabase/dryrun/20261016091500_review_and_validation_provisioning.dryrun.sql.
--
-- Everything stays behind flags: provisioning (account creation and e-mail) and outbox_sender
-- (the notification outbox drain), both off in production: invoke_registration_cron calls
-- nothing and nothing is sent, as today. The guest-list function, gl_guest tokens, QR content
-- and gl_checkin are untouched; this only reads gl_email_log.
--  1. gl_guest_queue_provisioning: with_confirmation -> email_due_at = confirmation + 1 minute
--     (was: the confirmation itself), so the account e-mail never overtakes the confirmation
--     e-mail sent right after the status change. after_event unchanged.
--  2. account_email_waits_for(source_kind, source_id) + trigger account_provision_job_email_gate:
--     on a guest_list_v1 event (WYS) the account e-mail of a CONFIRMED guest cannot be claimed
--     (provision-person sets email_sent_at) until guest-list has LOGGED that guest's QR e-mail
--     (gl_email_log kind 'pass', sent after this confirmation, 5 minutes of clock slack as in
--     provision-person). The claim fails with SQLSTATE 55000 "account_email_waits_for_pass"
--     (provision-person reads it as "busy"; v2 checks the same order itself before claiming).
--     A QR e-mail that failed is re-sent from the guest list (Resend pass); the account
--     e-mail follows.
--  3. registration_cron_wake(job): the wake rules, apart (testable without calling anything);
--     invoke_registration_cron(job) asks it, and accepts 'outbox' (EDGE lane's request, 15 Oct):
--       provision: flag provisioning; a queued job, a failed one under 5 attempts, or an
--                  account e-mail due and unsent: every minute for its first 15 minutes, then
--                  once a quarter of an hour (minute % 15 = 0) up to 7 days (one that keeps
--                  waiting, e.g. for guest-list's QR e-mail; provision-person skips it without
--                  using a slot, and gives up after 7 days). email_due_at is never moved here.
--       outbox:    flag outbox_sender; an unsent row under 5 attempts, at least 2 minutes old
--                  (the page that queued it sends it first), not marked 'held:%' (those only
--                  once a quarter of an hour).
--       reminders, digest: unchanged.
--  4. registration-cron-provision runs every minute (was every 5; cron.alter_job on the existing
--     job); registration-cron-outbox is new, every minute. Dormant while their flag is off or
--     nothing is due (one SELECT). A daily job (registration-cron-purge, 03:17 UTC) keeps the
--     last 7 days of these two jobs' cron.job_run_details (about 2,880 rows a day otherwise).

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $pre$
declare
  v_md5 text;
  v_row record;
begin
  if to_regclass('public.account_provision_job') is null or to_regclass('public.gl_email_log') is null
     or to_regclass('public.notification_outbox') is null
     or not exists (select 1 from cron.job j where j.jobname = 'registration-cron-provision') then
    raise exception 'review_and_validation_provisioning: apply 20261009210000_registration_core and 20261012113500_signup_identity first';
  end if;
  for v_row in
    select * from (values
      ('public.gl_guest_queue_provisioning()', 'fdeb96f5561037534043d8fcce68f6d5', '4af8136d541de900fba5d540d3ac76c7'),
      ('public.invoke_registration_cron(text)', 'bb4625d8f5d547fcf471b22c4d8b41f5', '41885e96797ea8411c4e1975b7c9b2d5')
    ) as x(sig, prod, mine)
  loop
    select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p where p.oid = to_regprocedure(v_row.sig);
    if v_md5 is distinct from v_row.prod and v_md5 is distinct from v_row.mine then
      raise exception 'review_and_validation_provisioning: % changed (md5 %); rebuild this migration from pg_get_functiondef', v_row.sig, v_md5;
    end if;
  end loop;
end
$pre$;

-- ---- 2. The gate ------------------------------------------------------------------------
-- null = the account e-mail may go; 'pass' = a confirmed WYS guest whose QR e-mail of this
-- confirmation is not logged yet.
create or replace function public.account_email_waits_for(p_source_kind text, p_source_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when p_source_kind is distinct from 'gl_guest' or p_source_id is null then null
    -- only a CONFIRMED guest of a guest_list_v1 event gets guest-list's QR e-mail
    when not exists (select 1 from public.gl_guest g join public.gl_event e on e.id = g.event_id
                      where g.id = p_source_id and e.engine = 'guest_list_v1' and g.status = 'confirmed') then null
    -- the QR e-mail of THIS confirmation: logged after the decision (staff) or the RSVP
    -- (guest); 5 minutes of slack for the edge function's clock (as provision-person).
    when exists (select 1 from public.gl_guest g
                   join public.gl_email_log l on l.guest_id = g.id and l.kind = 'pass'
                  where g.id = p_source_id
                    and l.sent_at >= coalesce(greatest(g.decided_at, g.responded_at), g.created_at) - interval '5 minutes') then null
    else 'pass'
  end
$function$;

create or replace function public.account_provision_job_email_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_wait text;
begin
  v_wait := public.account_email_waits_for(new.source_kind, new.source_id);
  if v_wait is not null then
    raise exception using errcode = '55000', message = 'account_email_waits_for_' || v_wait,
      hint = 'The account e-mail of a WYS guest follows the guest-list QR e-mail; re-send the pass from the guest list if it failed.';
  end if;
  return new;
end
$function$;

drop trigger if exists account_provision_job_email_gate on public.account_provision_job;
create trigger account_provision_job_email_gate
  before update of email_sent_at on public.account_provision_job
  for each row when (new.email_sent_at is not null and old.email_sent_at is null)
  execute function public.account_provision_job_email_gate();

-- ---- 1. Due time ------------------------------------------------------------------------
create or replace function public.gl_guest_queue_provisioning()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_kind text;
  v_timing text;
  v_send_at timestamptz;
  v_slug text;
  v_starts timestamptz;
  v_ends timestamptz;
  v_due timestamptz;
begin
  if tg_op = 'UPDATE' then
    if old.status = 'confirmed' then
      return null;
    end if;
  end if;
  -- Never abort the write that fired this (guest-list among others).
  begin
    select e.kind, e.account_email_timing, e.account_email_send_at, e.slug
      into v_kind, v_timing, v_send_at, v_slug
      from public.gl_event e where e.id = new.event_id;
    if v_kind is distinct from 'onsite' then
      return null;
    end if;
    select w.starts_at, w.ends_at into v_starts, v_ends from public.gl_event_window(new.event_id) w;
    -- with_confirmation: one minute after the confirmation, so the account e-mail follows the
    -- confirmation e-mail (WYS: guest-list's QR e-mail, which the e-mail also waits for:
    -- account_provision_job_email_gate, 20261016091500).
    v_due := case when v_timing = 'after_event'
                  then coalesce(v_send_at, v_ends + interval '1 day', now())
                  else now() + interval '1 minute' end;
    insert into public.account_provision_job as j (source_kind, source_id, email, payload, email_due_at)
    values ('gl_guest', new.id, lower(btrim(new.email)),
            jsonb_build_object(
              'first_name', new.first_name, 'last_name', new.last_name,
              'job_title', new.job_title, 'country', new.country, 'phone', new.phone,
              'company', new.company, 'gl_event_id', new.event_id, 'event_slug', v_slug,
              'guest_user_id', new.user_id),
            v_due)
    -- A registration confirmed AGAIN (declined then accepted, cancelled then
    -- re-approved, reactivated) whose job was skipped (no longer confirmed when
    -- provision-person looked) or failed is queued again with fresh data and the
    -- default choices (gl_decide_v2 then stores the staff choices). A job that is
    -- queued or done is left alone.
    on conflict (source_kind, source_id) where source_id is not null do update
       set status = 'queued', attempts = 0, last_error = null, done_at = null, email_sent_at = null,
           email = excluded.email, payload = excluded.payload, email_due_at = excluded.email_due_at,
           org_action = '{"mode": "none"}'::jsonb, validate_person = true, created_by = null
     where j.status in ('skipped', 'failed');
  exception when others then
    raise warning 'gl_guest_queue_provisioning(%): % (%)', new.id, sqlerrm, sqlstate;
  end;
  return null;
end
$function$;

-- ---- 3. When the cron calls registration-cron ------------------------------------------
-- Only a JSON true turns a flag on, as in registration-cron itself (never a cast that could
-- fail on a mistyped value). Read only; never calls anything.
create or replace function public.registration_cron_wake(p_job text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_flags jsonb;
  v_quarter boolean := extract(minute from now())::integer % 15 = 0;
begin
  select ps.value into v_flags from public.platform_settings ps where ps.key = 'registration_flags';
  v_flags := coalesce(v_flags, '{}'::jsonb);
  return coalesce(case p_job
    when 'provision' then
      coalesce((v_flags -> 'provisioning') = 'true'::jsonb, false)
      and exists (select 1 from public.account_provision_job j
                   where j.status = 'queued'
                      or (j.status = 'failed' and j.attempts < 5)
                      -- an account e-mail due and not sent (provision-person sets
                      -- email_due_at = null when none is to be sent): every minute for 15
                      -- minutes, then once a quarter of an hour; overdue by more than 7 days
                      -- it no longer wakes the cron on its own (provision-person gives up).
                      or (j.status = 'done' and j.email_sent_at is null and j.email_due_at <= now()
                          and (j.email_due_at > now() - interval '15 minutes'
                               or (v_quarter and j.email_due_at > now() - interval '7 days'))))
    when 'outbox' then
      coalesce((v_flags -> 'outbox_sender') = 'true'::jsonb, false)
      and exists (select 1 from public.notification_outbox n
                   where n.sent_at is null and n.attempts < 5 and n.created_at <= now() - interval '2 minutes'
                     and (n.last_error is null or n.last_error not like 'held:%' or v_quarter))
    when 'reminders' then
      coalesce((v_flags -> 'webinar_v2') = 'true'::jsonb, false) or coalesce((v_flags -> 'onsite_v2') = 'true'::jsonb, false)
    when 'digest' then
      coalesce((v_flags -> 'review_queue') = 'true'::jsonb, false)
      and extract(hour from (now() at time zone 'Europe/Monaco')) = 8
  end, false);
end
$function$;

create or replace function public.invoke_registration_cron(p_job text)
returns text
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault', 'pg_temp'
as $function$
declare
  v_url text;
  v_key text;
begin
  if p_job is null or p_job not in ('provision', 'reminders', 'digest', 'outbox') then
    return 'unknown job';
  end if;

  -- Dormant until the job's flag is on and, for provision and outbox, until there is work
  -- (public.registration_cron_wake, 20261016091500): nothing is called before the
  -- registration-cron function that knows the job is deployed.
  if not public.registration_cron_wake(p_job) then
    return 'skipped';
  end if;

  -- Same Vault secrets as invoke_send_profile_reminders(); exit quietly if missing.
  begin
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url' limit 1;
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  exception when others then
    raise notice 'invoke_registration_cron: vault read failed: %', sqlerrm;
    return 'no vault';
  end;
  if v_url is null or v_key is null then
    raise notice 'invoke_registration_cron: vault secrets not configured; skipping';
    return 'no vault';
  end if;

  perform net.http_post(
    url := v_url || '/functions/v1/registration-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := jsonb_build_object('job', p_job),
    timeout_milliseconds := 60000
  );
  return 'called';
end
$function$;

revoke all on function public.account_email_waits_for(text, uuid) from public, anon, authenticated;
grant execute on function public.account_email_waits_for(text, uuid) to service_role;
revoke all on function public.account_provision_job_email_gate() from public, anon, authenticated, service_role;
revoke all on function public.registration_cron_wake(text) from public, anon, authenticated;
grant execute on function public.registration_cron_wake(text) to service_role;

comment on function public.account_email_waits_for(text, uuid) is 'Phase 3: null when the account e-mail of a provisioning job may go; ''pass'' while the guest-list QR e-mail of a confirmed guest_list_v1 (WYS) guest is not logged for this confirmation (Victor, 15 Oct 2026). Service role (provision-person may ask before claiming).';
comment on function public.registration_cron_wake(text) is 'Phase 3: true when invoke_registration_cron(job) should call registration-cron (job flag on and, for provision and outbox, work due; see 20261016091500). Read only; service role.';

-- ---- 4. Every minute (alter_job: the existing job, whoever applies this file) -----------
select cron.alter_job((select j.jobid from cron.job j where j.jobname = 'registration-cron-provision'),
                      schedule := '* * * * *');
-- The outbox drain, every minute (created once: a re-run leaves the job as it is).
select cron.schedule('registration-cron-outbox', '* * * * *', $cmd$select public.invoke_registration_cron('outbox');$cmd$)
 where not exists (select 1 from cron.job j where j.jobname = 'registration-cron-outbox');
-- About 2,880 run rows a day in cron.job_run_details for these two jobs, which nothing purges:
-- keep their last 7 days only (other jobs' history is not touched).
select cron.schedule('registration-cron-purge', '17 3 * * *',
  $cmd$delete from cron.job_run_details d where d.jobid in (select j.jobid from cron.job j where j.jobname in ('registration-cron-provision', 'registration-cron-outbox')) and d.end_time < now() - interval '7 days';$cmd$)
 where not exists (select 1 from cron.job j where j.jobname = 'registration-cron-purge');
