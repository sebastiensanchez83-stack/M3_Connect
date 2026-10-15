-- DOWN for supabase/migrations/20261016091500_review_and_validation_provisioning.sql
-- Puts back the production bodies of gl_guest_queue_provisioning (md5 fdeb96f5...) and
-- invoke_registration_cron (md5 bb4625d8...), verbatim from 20261009210000_registration_core.sql,
-- drops the e-mail gate, and runs registration-cron-provision every 5 minutes again. Jobs
-- queued in between keep their email_due_at (confirmation + 1 minute).

set local lock_timeout = '5s';
set local statement_timeout = '120s';

drop trigger if exists account_provision_job_email_gate on public.account_provision_job;
drop function if exists public.account_provision_job_email_gate();

create or replace function public.gl_guest_queue_provisioning()
returns trigger
language plpgsql
security definer
set search_path = ''
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
    v_due := case when v_timing = 'after_event'
                  then coalesce(v_send_at, v_ends + interval '1 day', now())
                  else now() end;
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
  v_go := case p_job
    when 'provision' then
      coalesce((v_flags -> 'provisioning') = 'true'::jsonb, false)
      and exists (select 1 from public.account_provision_job j
                   where j.status = 'queued'
                      or (j.status = 'failed' and j.attempts < 5)
                      -- an account e-mail due and not sent; provision-person sets
                      -- email_due_at = null when none is to be sent. Backstop: an
                      -- e-mail overdue by more than 7 days no longer wakes the
                      -- cron on its own (it is still sent on the next run).
                      or (j.status = 'done' and j.email_sent_at is null
                          and j.email_due_at <= now() and j.email_due_at > now() - interval '7 days'))
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

drop function if exists public.account_email_waits_for(text, uuid);

select cron.schedule('registration-cron-provision', '*/5 * * * *',
  $cmd$select public.invoke_registration_cron('provision');$cmd$);
