-- DRY RUN of supabase/migrations/20261009190000_payment_email_log_sent_at.sql.
-- NOT A MIGRATION: never apply it, never commit it to the database.
--
-- Run it as ONE query text (one implicit transaction). The last statement ends
-- with RAISE EXCEPTION 'DRYRUN ...': the report is the error message, and
-- everything (the new column, the grant, the test payment and its e-mail keys)
-- rolls back.
-- Tripwire: if the report starts with "FAIL before-snapshot missing", the
-- statements did NOT run in one transaction and the migration may have been
-- committed: check information_schema.columns for payment_email_log.sent_at at once.
--
-- Expected report: every line PASS. Needs 20261009180000_payment_email_log.sql
-- (applied 9 Oct 2026 as 20261009180349). The last checks (T8) run the down script
-- too, inside the same transaction.
--
-- Real ids, looked up read-only on 9 Oct 2026:
--   member, verified, not staff: 0f8c900e-5e63-404c-96ca-58a0718541a8
--   public.payments and public.payment_email_log had 0 rows; the test payment below
--   belongs to the member and goes with the final RAISE.

-- ────────────────────────────────────────────────────────────────────────────
-- 0. Before the migration: no sent_at column; one e-mail key written "the old way"
--    (by the payment-ipn live now), to check the backfill.
-- ────────────────────────────────────────────────────────────────────────────
do $before$
declare
  pay uuid;
begin
  perform set_config('smc_dryrun.column_before', (
    select coalesce(string_agg(column_name, ',' order by column_name), 'none')
      from information_schema.columns
     where table_schema = 'public' and table_name = 'payment_email_log' and column_name = 'sent_at'), true);
  perform set_config('smc_dryrun.rows_before', (select count(*)::text from public.payment_email_log), true);
  insert into public.payments (user_id, payment_type, amount_cents, currency, status, reference_type, metadata)
  values ('0f8c900e-5e63-404c-96ca-58a0718541a8', 'event_participation', 12345, 'EUR', 'paid', 'event_participation', '{"dryrun": true}'::jsonb)
  returning id into pay;
  insert into public.payment_email_log (payment_id, status, created_at) values (pay, 'paid', now() - interval '1 hour');
  perform set_config('smc_dryrun.pay', pay::text, true);
  perform set_config('smc_dryrun.before', 'yes', true);
end
$before$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. The migration body, verbatim.
-- ────────────────────────────────────────────────────────────────────────────
alter table public.payment_email_log add column if not exists sent_at timestamptz;

comment on column public.payment_email_log.sent_at is
  'payment-ipn: when the e-mail was handed to send-notification. Empty = being sent (or abandoned if the row is over 10 minutes old).';

update public.payment_email_log set sent_at = created_at where sent_at is null;

grant update (sent_at, created_at) on table public.payment_email_log to service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Checks.
-- ────────────────────────────────────────────────────────────────────────────
do $dryrun$
declare
  nl constant text := chr(10);
  r text := '';
  v text;
  n int;
  member constant uuid := '0f8c900e-5e63-404c-96ca-58a0718541a8';
  pay uuid := nullif(current_setting('smc_dryrun.pay', true), '')::uuid;
  old_at timestamptz;
begin
  -- T0 one transaction, column absent before
  r := case when current_setting('smc_dryrun.before', true) = 'yes'
            then 'PASS before-snapshot present (one transaction)'
            else 'FAIL before-snapshot missing: NOT one transaction, the migration may be COMMITTED' end;
  r := r || nl || case when current_setting('smc_dryrun.column_before', true) = 'none' then 'PASS ' else 'FAIL ' end
            || 'sent_at absent before the migration (' || coalesce(current_setting('smc_dryrun.column_before', true), '?') || ')';
  r := r || nl || 'INFO rows in payment_email_log before the test row: ' || coalesce(current_setting('smc_dryrun.rows_before', true), '?');

  -- T1 shape: timestamptz, nullable, RLS still on with no policy
  begin
    select format('%s nullable=%s rls=%s policies=%s', c.data_type, c.is_nullable,
      (select relrowsecurity from pg_class where oid = 'public.payment_email_log'::regclass),
      (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'payment_email_log'))
      into v
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'payment_email_log' and c.column_name = 'sent_at';
    r := r || nl || case when v = 'timestamp with time zone nullable=YES rls=true policies=0' then 'PASS ' else 'FAIL ' end
              || 'shape: ' || coalesce(v, '(missing)');
  exception when others then
    r := r || nl || 'FAIL shape: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T2 backfill: the key written before the migration counts as sent
  begin
    select count(*) filter (where sent_at is null), count(*) filter (where payment_id = pay and sent_at = created_at)
      into n, v from public.payment_email_log;
    r := r || nl || case when n = 0 and v = '1' then 'PASS ' else 'FAIL ' end
              || 'backfill: rows without sent_at = ' || n || ', test row sent_at = created_at: ' || v;
  exception when others then
    r := r || nl || 'FAIL backfill: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T3 privileges, column by column
  begin
    v := format('service_role select/insert/delete=%s/%s/%s update sent_at/created_at/payment_id/status=%s/%s/%s/%s anon=%s/%s authenticated=%s/%s',
      has_table_privilege('service_role', 'public.payment_email_log', 'select'),
      has_table_privilege('service_role', 'public.payment_email_log', 'insert'),
      has_table_privilege('service_role', 'public.payment_email_log', 'delete'),
      has_column_privilege('service_role', 'public.payment_email_log', 'sent_at', 'update'),
      has_column_privilege('service_role', 'public.payment_email_log', 'created_at', 'update'),
      has_column_privilege('service_role', 'public.payment_email_log', 'payment_id', 'update'),
      has_column_privilege('service_role', 'public.payment_email_log', 'status', 'update'),
      has_column_privilege('anon', 'public.payment_email_log', 'sent_at', 'select'),
      has_column_privilege('anon', 'public.payment_email_log', 'sent_at', 'update'),
      has_column_privilege('authenticated', 'public.payment_email_log', 'sent_at', 'select'),
      has_column_privilege('authenticated', 'public.payment_email_log', 'sent_at', 'update'));
    r := r || nl || case when v = 'service_role select/insert/delete=true/true/true update sent_at/created_at/payment_id/status=true/true/false/false anon=false/false authenticated=false/false'
                         then 'PASS ' else 'FAIL ' end || 'privileges ' || v;
  exception when others then
    r := r || nl || 'FAIL privileges: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T4 the paying member can neither read nor mark anything sent
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      select count(*) into n from public.payment_email_log;
      r := r || nl || 'FAIL member could read payment_email_log (' || n || ' rows)';
    exception when insufficient_privilege then
      r := r || nl || 'PASS member select refused (42501)';
    end;
    begin
      update public.payment_email_log set sent_at = now() where payment_id = pay;
      r := r || nl || 'FAIL member could update sent_at';
    exception when insufficient_privilege then
      r := r || nl || 'PASS member update of sent_at refused (42501)';
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
  exception when others then
    reset role;
    r := r || nl || 'FAIL member block: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T5 anon neither
  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    set local role anon;
    begin
      update public.payment_email_log set sent_at = now() where payment_id = pay;
      r := r || nl || 'FAIL anon could update sent_at';
    exception when insufficient_privilege then
      r := r || nl || 'PASS anon update of sent_at refused (42501)';
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
  exception when others then
    reset role;
    r := r || nl || 'FAIL anon block: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T6 service role: claim, mark sent, take over an abandoned claim exactly once
  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    set local role service_role;
    -- a claim that is still being sent
    insert into public.payment_email_log (payment_id, status) values (pay, 'failed');
    select sent_at::text into v from public.payment_email_log where payment_id = pay and status = 'failed';
    r := r || nl || case when v is null then 'PASS ' else 'FAIL ' end || 'a new claim has no sent_at (' || coalesce(v, 'null') || ')';
    update public.payment_email_log set sent_at = now() where payment_id = pay and status = 'failed';
    get diagnostics n = row_count;
    r := r || nl || case when n = 1 then 'PASS ' else 'FAIL ' end || 'service_role marks the e-mail sent (' || n || ' row)';
    begin
      update public.payment_email_log set status = 'paid' where payment_id = pay and status = 'failed';
      r := r || nl || 'FAIL service_role may change status (not granted)';
    exception when insufficient_privilege then
      r := r || nl || 'PASS service_role update of status refused (42501)';
    end;
    -- an abandoned claim (20 minutes old, never marked sent)
    delete from public.payment_email_log where payment_id = pay and status = 'failed';
    old_at := now() - interval '20 minutes';
    insert into public.payment_email_log (payment_id, status, created_at) values (pay, 'failed', old_at);
    update public.payment_email_log set created_at = clock_timestamp()
     where payment_id = pay and status = 'failed' and sent_at is null and created_at = old_at;
    get diagnostics n = row_count;
    v := n::text;
    update public.payment_email_log set created_at = clock_timestamp()
     where payment_id = pay and status = 'failed' and sent_at is null and created_at = old_at;
    get diagnostics n = row_count;
    v := v || '/' || n;
    r := r || nl || case when v = '1/0' then 'PASS ' else 'FAIL ' end || 'abandoned claim taken over once (first / second taker = ' || v || ')';
    reset role;
    perform set_config('request.jwt.claims', '', true);
  exception when others then
    reset role;
    r := r || nl || 'FAIL service_role block: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T7 the payments table is untouched by the migration (only the test row)
  begin
    select count(*) into n from public.payments where id <> pay;
    r := r || nl || 'INFO other payments rows: ' || n;
  exception when others then
    r := r || nl || 'FAIL payments count: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T8 the DOWN script, verbatim: the column and the update right go, the rest stays
  begin
    revoke update (sent_at, created_at) on table public.payment_email_log from service_role;
    alter table public.payment_email_log drop column if exists sent_at;
    select count(*) into n from information_schema.columns
     where table_schema = 'public' and table_name = 'payment_email_log' and column_name = 'sent_at';
    v := format('sent_at columns=%s service_role update created_at=%s select/insert/delete=%s/%s/%s',
      n,
      has_column_privilege('service_role', 'public.payment_email_log', 'created_at', 'update'),
      has_table_privilege('service_role', 'public.payment_email_log', 'select'),
      has_table_privilege('service_role', 'public.payment_email_log', 'insert'),
      has_table_privilege('service_role', 'public.payment_email_log', 'delete'));
    r := r || nl || case when v = 'sent_at columns=0 service_role update created_at=false select/insert/delete=true/true/true'
                         then 'PASS ' else 'FAIL ' end || 'down script: ' || v;
  exception when others then
    r := r || nl || 'FAIL down script: ' || sqlstate || ' ' || sqlerrm;
  end;

  raise exception 'DRYRUN %', coalesce(r, '(report lost: a NULL was concatenated)');
end
$dryrun$;
