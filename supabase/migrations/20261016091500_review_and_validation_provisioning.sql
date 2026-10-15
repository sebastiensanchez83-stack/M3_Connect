-- Registration Phase 3 (DB lane), part 4 of 4: timing of the account e-mail.
-- Spec: regspec-en.md §3.6, §4.2, §4.3; Victor, 15 Oct 2026: when M3 confirms a WYS guest the
-- guest-list function sends its QR e-mail UNCHANGED, and within about one to two minutes a
-- SECOND e-mail follows, "Your Smart Marina Connect account is ready, choose your password"
-- (provision-person, account_ready_set_password), NEVER before the QR e-mail. Other on-site
-- events follow their editor setting (with_confirmation / after_event + date). Contract §11.5.
-- NOT APPLIED. Independent of parts 1-3 (any order).
-- Down: supabase/migrations/down/20261016091500_review_and_validation_provisioning.down.sql.
-- Dry run: supabase/dryrun/20261016091500_review_and_validation_provisioning.dryrun.sql.
--
-- Everything stays behind flag provisioning: with it off (production), invoke_registration_cron
-- calls nothing and provision-person sends nothing, as today. The guest-list function, gl_guest
-- tokens, QR content and gl_checkin are untouched; this only reads gl_email_log.
--  1. gl_guest_queue_provisioning: with_confirmation -> email_due_at = confirmation + 1 minute
--     (was: the confirmation itself), so the account e-mail never overtakes the confirmation
--     e-mail sent right after the status change. after_event unchanged.
--  2. account_email_waits_for(source_kind, source_id) + trigger account_provision_job_email_gate:
--     on a guest_list_v1 event (WYS) the account e-mail of a guest cannot be claimed
--     (provision-person sets email_sent_at) until guest-list has LOGGED that guest's QR e-mail
--     (gl_email_log kind 'pass', sent after this confirmation). The claim fails with SQLSTATE
--     55000 "account_email_waits_for_pass" (provision-person reads it as "busy" and retries on
--     its next run). A QR e-mail that failed is re-sent from the guest list (Resend pass), and
--     the account e-mail follows.
--  3. invoke_registration_cron('provision') does not wake registration-cron for an e-mail that
--     must still wait (2), and (flag on only) pushes such an e-mail's due time back (1 minute,
--     15 once its job is an hour old) so it never holds a place among the 50 oldest due
--     e-mails provision-person takes per run (no starvation of other events' e-mails).
--  4. registration-cron-provision runs every minute (was every 5; cron.alter_job): about one
--     to two minutes after the QR e-mail. Dormant while the flag is off or nothing is due (one
--     SELECT). A daily job (registration-cron-provision-purge) keeps its last 7 days of
--     cron.job_run_details (about 1,440 rows a day otherwise kept forever).

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $pre$
declare
  v_md5 text;
  v_row record;
begin
  if to_regclass('public.account_provision_job') is null or to_regclass('public.gl_email_log') is null
     or not exists (select 1 from cron.job j where j.jobname = 'registration-cron-provision') then
    raise exception 'review_and_validation_provisioning: apply 20261009210000_registration_core first';
  end if;
  for v_row in
    select * from (values
      ('public.gl_guest_queue_provisioning()', 'fdeb96f5561037534043d8fcce68f6d5', '4af8136d541de900fba5d540d3ac76c7'),
      ('public.invoke_registration_cron(text)', 'bb4625d8f5d547fcf471b22c4d8b41f5', '1e9775a6d7337edc64c0bed75dcc367a')
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
-- null = the account e-mail may go; 'pass' = a WYS guest whose QR e-mail is not logged yet.
create or replace function public.account_email_waits_for(p_source_kind text, p_source_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when p_source_kind is distinct from 'gl_guest' or p_source_id is null then null
    when not exists (select 1 from public.gl_guest g join public.gl_event e on e.id = g.event_id
                      where g.id = p_source_id and e.engine = 'guest_list_v1') then null
    -- the QR e-mail of THIS confirmation: logged after the decision (staff) or the RSVP
    -- (guest); 2 minutes of slack for the edge function's clock.
    when exists (select 1 from public.gl_guest g
                   join public.gl_email_log l on l.guest_id = g.id and l.kind = 'pass'
                  where g.id = p_source_id
                    and l.sent_at >= coalesce(greatest(g.decided_at, g.responded_at), g.created_at) - interval '2 minutes') then null
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

-- ---- 3. The cron wakes up only for an e-mail that may go ---------------------------------
create or replace function public.invoke_registration_cron(p_job text)
returns text
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault', 'pg_temp'
as $function$
declare
  v_url text;
  v_key text;
  v_flags jsonb;
  v_go boolean;
begin
  if p_job is null or p_job not in ('provision', 'reminders', 'digest') then
    return 'unknown job';
  end if;

  -- Dormant until the flag is on (and, for provisioning, until there is work):
  -- nothing is called before the registration-cron function is deployed. Only a
  -- JSON true turns a flag on, as in registration-cron itself (never a cast that
  -- could fail on a mistyped value).
  select ps.value into v_flags from public.platform_settings ps where ps.key = 'registration_flags';
  v_flags := coalesce(v_flags, '{}'::jsonb);
  -- A WYS guest's account e-mail that must still wait for the QR e-mail goes to the back of
  -- the line: provision-person takes the 50 oldest due e-mails, so blocked ones would starve
  -- every other event's. Due again in 1 minute (every 15 once its job is an hour old); a QR
  -- e-mail re-sent from the guest list is then followed within that time (20261016091500).
  if p_job = 'provision' and coalesce((v_flags -> 'provisioning') = 'true'::jsonb, false) then
    update public.account_provision_job j
       set email_due_at = now() + case when coalesce(j.done_at, j.created_at) > now() - interval '1 hour' then interval '1 minute'
                                       else interval '15 minutes' end
     where j.status = 'done' and j.email_sent_at is null and j.email_due_at <= now()
       and j.source_kind = 'gl_guest'
       and public.account_email_waits_for(j.source_kind, j.source_id) is not null;
  end if;
  v_go := case p_job
    when 'provision' then
      coalesce((v_flags -> 'provisioning') = 'true'::jsonb, false)
      and exists (select 1 from public.account_provision_job j
                   where j.status = 'queued'
                      or (j.status = 'failed' and j.attempts < 5)
                      -- an account e-mail due and not sent; provision-person sets
                      -- email_due_at = null when none is to be sent. Backstop: an
                      -- e-mail overdue by more than 7 days no longer wakes the
                      -- cron on its own (it is still sent on the next run). A WYS
                      -- guest's e-mail waits for the QR e-mail (20261016091500).
                      or (j.status = 'done' and j.email_sent_at is null
                          and j.email_due_at <= now() and j.email_due_at > now() - interval '7 days'
                          and public.account_email_waits_for(j.source_kind, j.source_id) is null))
    when 'reminders' then
      coalesce((v_flags -> 'webinar_v2') = 'true'::jsonb, false) or coalesce((v_flags -> 'onsite_v2') = 'true'::jsonb, false)
    when 'digest' then
      coalesce((v_flags -> 'review_queue') = 'true'::jsonb, false)
      and extract(hour from (now() at time zone 'Europe/Monaco')) = 8
  end;
  if not coalesce(v_go, false) then
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

comment on function public.account_email_waits_for(text, uuid) is 'Phase 3: null when the account e-mail of a provisioning job may go; ''pass'' while the guest-list QR e-mail of a guest_list_v1 (WYS) guest is not logged for this confirmation (Victor, 15 Oct 2026). Service role (provision-person may ask before claiming).';

-- ---- 4. Every minute (alter_job: the existing job, whoever applies this file) -----------
select cron.alter_job((select j.jobid from cron.job j where j.jobname = 'registration-cron-provision'),
                      schedule := '* * * * *');
-- About 1,440 run rows a day in cron.job_run_details, which nothing purges: keep this job's
-- last 7 days only (other jobs' history is not touched).
select cron.schedule('registration-cron-provision-purge', '17 3 * * *',
  $cmd$delete from cron.job_run_details d where d.jobid in (select j.jobid from cron.job j where j.jobname = 'registration-cron-provision') and d.end_time < now() - interval '7 days';$cmd$);
