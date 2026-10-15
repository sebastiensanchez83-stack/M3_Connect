-- DRY RUN of supabase/migrations/20261016091500_review_and_validation_provisioning.sql (timing of
-- the account e-mail; WYS: never before the guest-list QR e-mail). NOT A MIGRATION. ONE query
-- text, ONE execute_sql call, BEFORE that file is applied. A snapshot, the migration verbatim,
-- then cases on a test guest-list event (rolled back; no e-mail can leave: no edge function is
-- called, the flag is switched on only inside one rolled-back case). Ends with RAISE EXCEPTION
-- 'DRYRUN ...'. Expected: "14 PASS, 0 FAIL".

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ─── A. Snapshot (read again after the migration, case S01: must be identical) ─
create function pg_temp.dr_snap() returns table (k text, v text) language sql as $f$
  select 'sm26', md5(concat_ws('|',
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_registration x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_role_assignment x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_attendee x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_badge x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_payment x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_invoice x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_networking_pass x)))
  union all select 'gl_guest', (select md5(coalesce(string_agg(g.id::text || g.token::text || g.status || coalesce(g.user_id::text, ''), ',' order by g.id), '')) from public.gl_guest g)
  union all select 'jobs', (select md5(coalesce(string_agg(j.id::text || j.status || coalesce(j.email_due_at::text, ''), ',' order by j.id), '')) from public.account_provision_job j)
  union all select 'orgs', (select md5(coalesce(string_agg(concat_ws('/', o.id, o.name, o.access_status, o.organization_type, o.owner_user_id, o.primary_domain, o.updated_at), ',' order by o.id), '')) from public.organizations o)
  union all select 'members', (select md5(coalesce(string_agg(m.id::text || m.user_id::text || m.role, ',' order by m.id), '')) from public.organization_members m)
  union all select 'profiles', (select md5(coalesce(string_agg(concat_ws('/', pr.user_id, pr.access_status, pr.onboarding_status, pr.persona, pr.updated_at, pr.email_proven_at), ',' order by pr.user_id), '')) from public.profiles pr)
  union all select 'invitations', (select md5(coalesce(string_agg(i.id::text || i.status, ',' order by i.id), '')) from public.organization_invitations i)
  union all select 'outbox', (select md5(coalesce(string_agg(n.id::text || coalesce(n.sent_at::text, ''), ',' order by n.id), '')) from public.notification_outbox n)
  union all select 'review_log', (select count(*)::text from public.review_log)
  union all select 'policies', (select md5(string_agg(format('%s|%s|%s|%s|%s', pl.tablename, pl.policyname, pl.roles, pl.qual, pl.with_check), ';' order by pl.tablename, pl.policyname))
                                  from pg_policies pl where pl.schemaname = 'public')
  union all select 'cron', (select string_agg(j.jobname || '=' || j.schedule, ',' order by j.jobname) from cron.job j where j.jobname not like 'registration-cron-provision%')
$f$;
create temp table _dr_before on commit drop as select * from pg_temp.dr_snap();

-- ─── B. The migration, verbatim ─────────────────────────────────────────────────
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

-- ─── C. Test helpers (temporary, gone with the rollback) ───────────────────────
-- An account: the auth.users row (handle_new_user makes the profile), then status, persona, proof.
create function pg_temp.dr_user(p_id uuid, p_email text, p_meta jsonb, p_proven boolean, p_status text, p_persona text)
returns void language plpgsql as $f$
begin
  insert into auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
  values (p_id, p_email, 'authenticated', 'authenticated', p_meta, now(), now(), now());
  update public.profiles
     set email_proven_at = case when p_proven then now() end,
         access_status = p_status::public.access_status_enum,
         persona = p_persona::public.persona_enum,
         onboarding_status = (case when p_status = 'verified' then 'completed' else 'submitted' end)::public.onboarding_status_enum
   where user_id = p_id;
end
$f$;
-- A company (and its owner member when given).
create function pg_temp.dr_org(p_id uuid, p_name text, p_status text, p_type text, p_owner uuid, p_site text)
returns void language plpgsql as $f$
begin
  insert into public.organizations (id, name, slug, access_status, onboarding_status, organization_type, owner_user_id, created_by_user_id, website)
  values (p_id, p_name, 'dryrun-' || p_id, p_status, case when p_status = 'verified' then 'completed' else 'submitted' end,
          p_type, p_owner, p_owner, p_site);
  if p_owner is not null then
    insert into public.organization_members (organization_id, user_id, role) values (p_id, p_owner, 'owner');
  end if;
end
$f$;

-- ─── D. Cases ───────────────────────────────────────────────────────────────────
do $dryrun$
declare
  tests jsonb := '[]'::jsonb;
  t jsonb;
  kv record;
  vars jsonb;
  s0 text;
  v_q text; v_setup text; v_chkq text; v_exp text;
  v_uid uuid; v_dml boolean; v_ret text; v_n bigint;
  v_err text; v_state text; v_chk boolean; v_pass boolean;
  n_pass integer := 0; n_fail integer := 0;
  results text := '';
  r8 text := substr(md5(random()::text), 1, 8);
begin
  vars := jsonb_build_object('ev', gen_random_uuid(), 'ev2', gen_random_uuid(), 'g', gen_random_uuid(), 'r8', r8,
    'e_g', 'dryrun-guest-' || r8 || '@example.invalid');
  -- A guest-list (v1, WYS-like) on-site event with confirmation-time account e-mails and one
  -- request; ev2 is a core_v2 on-site event.
  s0 := $s$insert into public.gl_event (id, slug, title) values ({ev}, 'dryrun-' || {r8}, 'Dryrun on-site');
insert into public.gl_guest (id, event_id, source, status, first_name, last_name, email) values ({g}, {ev}, 'request', 'requested', 'Gil', 'Guest', {e_g})$s$;
  tests := jsonb_build_array(
    jsonb_build_object('id', 'S01', 'who', 'postgres', 'bare', true, 'expect', 'ret:0', 'label', 'no row changed (SM26, WYS, jobs, people, policies, other crons)',
      'q', $q$select count(*)::text from ((select * from _dr_before except select * from pg_temp.dr_snap()) union all (select * from pg_temp.dr_snap() except select * from _dr_before)) d$q$),
    jsonb_build_object('id', 'S02', 'who', 'postgres', 'bare', true, 'expect', 'ret:registration-cron-provision=* * * * *,registration-cron-provision-purge=17 3 * * *', 'label', 'registration-cron-provision runs every minute (the same job); its run history is purged daily',
      'q', $q$select string_agg(jobname || '=' || schedule, ',' order by jobname) from cron.job where jobname like 'registration-cron-provision%'$q$),
    jsonb_build_object('id', 'S03', 'who', 'postgres', 'bare', true, 'expect', 'ret:4af8136d541de900fba5d540d3ac76c7,1e9775a6d7337edc64c0bed75dcc367a', 'label', 'stored bodies = this file (md5 of gl_guest_queue_provisioning, invoke_registration_cron)',
      'q', $q$select string_agg(md5(replace(p.prosrc, chr(13), '')), ',' order by p.proname) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('gl_guest_queue_provisioning', 'invoke_registration_cron')$q$),
    jsonb_build_object('id', 'P01', 'who', 'postgres', 'expect', 'allow', 'label', 'confirmation (with_confirmation): the account e-mail is due one minute later',
      'q', $q$update public.gl_guest set status = 'confirmed', decided_at = now() where id = {g}$q$,
      'chk', $c$select email_due_at = now() + interval '1 minute' and status = 'queued' from public.account_provision_job where source_id = {g}$c$),
    jsonb_build_object('id', 'P02', 'who', 'postgres', 'expect', 'allow', 'label', 'after_event: the date set in the editor, as before',
      'setup', $s$update public.gl_event set account_email_timing = 'after_event', account_email_send_at = '2026-12-01 09:00+00' where id = {ev}$s$,
      'q', $q$update public.gl_guest set status = 'confirmed' where id = {g}$q$,
      'chk', $c$select email_due_at = '2026-12-01 09:00+00'::timestamptz from public.account_provision_job where source_id = {g}$c$),
    jsonb_build_object('id', 'P03', 'who', 'postgres', 'expect', 'allow', 'label', 'a webinar never queues a job (unchanged)',
      'setup', $s$update public.gl_event set kind = 'webinar' where id = {ev}$s$,
      'q', $q$update public.gl_guest set status = 'confirmed' where id = {g}$q$,
      'chk', $c$select not exists (select 1 from public.account_provision_job where source_id = {g})$c$),
    jsonb_build_object('id', 'P04', 'who', 'service', 'expect', 'err:account_email_waits_for_pass', 'label', 'WYS: the account e-mail cannot be claimed before guest-list has logged the QR e-mail',
      'setup', $s$update public.gl_guest set status = 'confirmed', decided_at = now() where id = {g}; update public.account_provision_job set status = 'done', email_due_at = now() - interval '1 minute' where source_id = {g}$s$,
      'q', $q$update public.account_provision_job set email_sent_at = now() where source_id = {g} and status = 'done' and email_sent_at is null$q$,
      'chk', $c$select email_sent_at is null from public.account_provision_job where source_id = {g}$c$),
    jsonb_build_object('id', 'P05', 'who', 'service', 'expect', 'allow', 'label', 'once the QR e-mail of this confirmation is logged, the claim goes through',
      'setup', $s$update public.gl_guest set status = 'confirmed', decided_at = now() where id = {g}; update public.account_provision_job set status = 'done' where source_id = {g};
insert into public.gl_email_log (guest_id, event_id, kind, to_email, sent_at) values ({g}, {ev}, 'pass', {e_g}, now())$s$,
      'q', $q$update public.account_provision_job set email_sent_at = now() where source_id = {g} and status = 'done' and email_sent_at is null$q$),
    jsonb_build_object('id', 'P06', 'who', 'service', 'expect', 'err:account_email_waits_for_pass', 'label', 'a QR e-mail of an EARLIER confirmation does not count',
      'setup', $s$update public.gl_guest set status = 'confirmed', decided_at = now() where id = {g}; update public.account_provision_job set status = 'done' where source_id = {g};
insert into public.gl_email_log (guest_id, event_id, kind, to_email, sent_at) values ({g}, {ev}, 'pass', {e_g}, now() - interval '10 minutes')$s$,
      'q', $q$update public.account_provision_job set email_sent_at = now() where source_id = {g} and status = 'done' and email_sent_at is null$q$),
    jsonb_build_object('id', 'P07', 'who', 'service', 'expect', 'allow', 'label', 'a core_v2 on-site event: no QR gate',
      'setup', $s$insert into public.gl_event (id, slug, title, engine, door_token, kind, registration_mode) values ({ev2}, 'dryrun2-' || {r8}, 'Dryrun v2', 'core_v2', 'separate', 'onsite', 'review');
insert into public.gl_guest (event_id, source, status, first_name, last_name, email) values ({ev2}, 'registration', 'confirmed', 'Vi', 'Two', {e_g});
update public.account_provision_job j set status = 'done' from public.gl_guest g where g.id = j.source_id and g.event_id = {ev2}$s$,
      'q', $q$update public.account_provision_job j set email_sent_at = now() from public.gl_guest g where g.id = j.source_id and g.event_id = {ev2} and j.email_sent_at is null$q$),
    jsonb_build_object('id', 'P08', 'who', 'service', 'expect', 'ret:pass', 'label', 'account_email_waits_for tells provision-person why it waits',
      'setup', $s$update public.gl_guest set status = 'confirmed' where id = {g}$s$,
      'q', $q$select public.account_email_waits_for('gl_guest', {g})$q$),
    jsonb_build_object('id', 'P09', 'who', 'postgres', 'expect', 'ret:skipped', 'label', 'flag on, the only work an e-mail that must wait: the cron calls nothing and pushes it back one minute (no starvation)',
      'setup', $s$update public.platform_settings set value = value || '{"provisioning": true}'::jsonb where key = 'registration_flags';
update public.gl_guest set status = 'confirmed' where id = {g};
update public.account_provision_job set status = 'done', email_due_at = now() - interval '1 minute' where source_id = {g};
update public.account_provision_job set status = 'skipped', email_due_at = null where source_id is distinct from {g}::uuid$s$,
      'q', $q$select public.invoke_registration_cron('provision')$q$,
      'chk', $c$select email_due_at = now() + interval '1 minute' from public.account_provision_job where source_id = {g}$c$),
    jsonb_build_object('id', 'P10', 'who', 'postgres', 'expect', 'ret:skipped', 'label', 'flag off: nothing, as today',
      'setup', $s$update public.platform_settings set value = value || '{"provisioning": false}'::jsonb where key = 'registration_flags';
update public.gl_guest set status = 'confirmed' where id = {g}$s$,
      'q', $q$select public.invoke_registration_cron('provision')$q$),
    jsonb_build_object('id', 'P11', 'who', 'postgres', 'bare', true, 'expect', 'ret:false/false', 'label', 'the gate is not for members; the trigger function for nobody',
      'q', $q$select has_function_privilege('authenticated', 'public.account_email_waits_for(text,uuid)', 'execute')::text || '/' || has_function_privilege('authenticated', 'public.account_provision_job_email_gate()', 'execute')::text$q$)
  );

  -- Runner: setup s0 + setup (postgres), q as the caller (an expected error is caught around q
  -- only, so chk still runs), chk (postgres), all rolled back. {x} = quoted vars.x; <x> = raw.
  for t in select * from jsonb_array_elements(tests) loop
    v_q := t ->> 'q'; v_setup := coalesce(t ->> 'setup', ''); v_chkq := coalesce(t ->> 'chk', ''); v_exp := t ->> 'expect';
    if not coalesce((t ->> 'bare')::boolean, false) then v_setup := s0 || ';' || v_setup; end if;
    for kv in select * from jsonb_each_text(vars) loop
      v_q := replace(v_q, '{' || kv.key || '}', quote_literal(kv.value));
      v_setup := replace(v_setup, '{' || kv.key || '}', quote_literal(kv.value));
      v_chkq := replace(v_chkq, '{' || kv.key || '}', quote_literal(kv.value));
      v_exp := replace(v_exp, '<' || kv.key || '>', kv.value);
    end loop;
    v_dml := lower(left(ltrim(v_q), 6)) in ('insert', 'update', 'delete');
    v_ret := null; v_n := null; v_err := null; v_state := null; v_chk := null;
    begin
      perform set_config('request.jwt.claims', '', true);
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claim.role', '', true);
      if btrim(v_setup, ' ;') <> '' then execute v_setup; end if;
      if t ->> 'who' = 'postgres' then
        null;
      elsif t ->> 'who' like 'jwt:%' then
        perform set_config('request.jwt.claims', jsonb_build_object('sub', vars ->> substr(t ->> 'who', 5), 'role', 'authenticated')::text, true);
      elsif t ->> 'who' = 'anon' then
        perform set_config('request.jwt.claims', '{"role": "anon"}', true);
        set local role anon;
      elsif t ->> 'who' = 'service' then
        perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
        set local role service_role;
      else
        v_uid := (vars ->> (t ->> 'who'))::uuid;
        perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated',
          'email', (select u.email from auth.users u where u.id = v_uid))::text, true);
        set local role authenticated;
      end if;
      begin
        if v_dml then
          execute v_q;
          get diagnostics v_n = row_count;
        else
          execute v_q into v_ret;
        end if;
      exception when others then
        if v_exp like 'err:%' or v_exp = 'rls' then v_err := sqlerrm; v_state := sqlstate; else raise; end if;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      if v_chkq <> '' then execute v_chkq into v_chk; end if;
      raise exception using errcode = 'DRY01', message = 'case finished';
    exception
      when sqlstate 'DRY01' then null;
      when others then v_err := coalesce(v_err, sqlerrm); v_state := coalesce(v_state, sqlstate);
    end;
    v_pass := coalesce(case
                when v_exp = 'allow' then v_err is null and (not v_dml or v_n > 0)
                when v_exp = 'rls' then v_state = '42501' or (v_err is null and v_dml and v_n = 0)
                when v_exp like 'err:%' then strpos(v_err, substr(v_exp, 5)) > 0
                when v_exp like 'ret:%' then v_err is null and v_ret is not distinct from substr(v_exp, 5)
              end, false)
              and (v_chkq = '' or v_chk is true);
    if v_pass then n_pass := n_pass + 1; else n_fail := n_fail + 1; end if;
    results := results || format(E'\n%s %s %s: %s | expect %s | %s%s',
      case when v_pass then 'PASS' else 'FAIL' end, t ->> 'id', t ->> 'who', t ->> 'label', v_exp,
      left(case when v_err is not null then format('error %s: %s', v_state, v_err)
                when v_dml then v_n || ' row(s) written'
                else 'returned ' || coalesce(v_ret, 'null') end, 300),
      case when v_chkq <> '' then ' | chk ' || coalesce(v_chk::text, 'null') else '' end);
  end loop;

  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (review_and_validation_provisioning dry run, run %s)', n_pass, n_fail, now()) || results;
end
$dryrun$;
