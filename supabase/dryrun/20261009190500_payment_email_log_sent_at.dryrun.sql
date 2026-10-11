-- DRY RUN of supabase/migrations/20261009190500_payment_email_log_sent_at.sql
-- (and of its down script). NOT A MIGRATION: never apply it, never commit it.
--
-- Run it as ONE query text (one execute_sql call = one implicit transaction). The
-- last statement ends with RAISE EXCEPTION 'DRYRUN ...': the report is the error
-- message, and everything (the new column, the comments, the grant, the test payment
-- and its e-mail keys) rolls back.
-- Tripwire: if the report starts with "FAIL before-snapshot missing", the
-- statements did NOT run in one transaction and parts may have been committed:
--   1. check information_schema.columns for payment_email_log.sent_at at once;
--   2. delete the test payment (its e-mail keys go with it, on delete cascade):
--        delete from public.payments where metadata->>'dryrun' = 'true';
--      It is inserted as 'pending', so even a leaked row never counts as revenue
--      (the admin dashboard sums status 'paid').
--
-- Expected report: every line PASS (INFO lines are information). Booleans are cast
-- with ::text before format(), which would print them as t / f. Each check sets up
-- what it needs itself (the test payment of step 0 aside), so a FAIL in one does not
-- cascade into the next. Needs 20261009180000_payment_email_log.sql (applied 9 Oct
-- 2026 as 20261009180349). The last check (T9) runs the down script too, inside the
-- same transaction.
--
-- The APPLIED table, read-only on 10 Oct 2026 (what the checks expect before the
-- migration): columns payment_id uuid, status text (paid / failed), created_at
-- timestamptz default now(); primary key (payment_id, status), payment_id references
-- payments on delete cascade; RLS on, not forced, no policy; grants: service_role
-- select / insert / delete, nothing for anon and authenticated; no trigger on it or
-- on public.payments; 0 rows; public.payments 0 rows.
--
-- Real ids, looked up read-only on 10 Oct 2026:
--   member, verified, not staff (persona marina): 0f8c900e-5e63-404c-96ca-58a0718541a8

-- ────────────────────────────────────────────────────────────────────────────
-- 0. Before the migration: no sent_at column, the 9 Oct table comment; one e-mail
--    key written "the old way" (by payment-ipn v13), to check the backfill.
-- ────────────────────────────────────────────────────────────────────────────
do $before$
declare
  pay uuid;
begin
  perform set_config('smc_dryrun.column_before', (
    select coalesce(string_agg(column_name, ',' order by column_name), 'none')
      from information_schema.columns
     where table_schema = 'public' and table_name = 'payment_email_log' and column_name = 'sent_at'), true);
  perform set_config('smc_dryrun.comment_before', coalesce(obj_description('public.payment_email_log'::regclass, 'pg_class'), ''), true);
  perform set_config('smc_dryrun.rows_before', (select count(*)::text from public.payment_email_log), true);
  insert into public.payments (user_id, payment_type, amount_cents, currency, status, reference_type, metadata)
  values ('0f8c900e-5e63-404c-96ca-58a0718541a8', 'event_participation', 12345, 'EUR', 'pending', 'event_participation', '{"dryrun": true}'::jsonb)
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

comment on table public.payment_email_log is
  'payment-ipn: one row per payment e-mail (payment id + status), inserted before sending; the primary key makes the e-mail idempotent and sent_at says it went out. Service role only.';

update public.payment_email_log set sent_at = created_at where sent_at is null;

grant update (sent_at, created_at) on table public.payment_email_log to service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Checks.
-- ────────────────────────────────────────────────────────────────────────────
do $dryrun$
declare
  nl constant text := chr(10);
  old_comment constant text := 'payment-ipn: one row per payment e-mail sent (payment id + status). The primary key makes the e-mail idempotent. Service role only.';
  new_comment constant text := 'payment-ipn: one row per payment e-mail (payment id + status), inserted before sending; the primary key makes the e-mail idempotent and sent_at says it went out. Service role only.';
  r text := '';
  v text;
  n int;
  member constant uuid := '0f8c900e-5e63-404c-96ca-58a0718541a8';
  pay uuid := nullif(current_setting('smc_dryrun.pay', true), '')::uuid;
  old_at timestamptz;
begin
  -- T0 one transaction; the table as applied on 9 Oct before the migration
  r := case when current_setting('smc_dryrun.before', true) = 'yes'
            then 'PASS before-snapshot present (one transaction)'
            else 'FAIL before-snapshot missing: NOT one transaction, the migration may be COMMITTED' end;
  r := r || nl || case when current_setting('smc_dryrun.column_before', true) = 'none' then 'PASS ' else 'FAIL ' end
            || 'sent_at absent before the migration (' || coalesce(current_setting('smc_dryrun.column_before', true), '?') || ')';
  r := r || nl || case when current_setting('smc_dryrun.comment_before', true) = old_comment then 'PASS ' else 'FAIL ' end
            || 'table comment before = the 9 Oct one';
  r := r || nl || 'INFO rows in payment_email_log before the test row: ' || coalesce(current_setting('smc_dryrun.rows_before', true), '?');

  -- T1 shape: timestamptz, nullable, RLS still on with no policy
  begin
    select format('%s nullable=%s rls=%s policies=%s', c.data_type, c.is_nullable,
      (select relrowsecurity::text from pg_class where oid = 'public.payment_email_log'::regclass),
      (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'payment_email_log'))
      into v
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'payment_email_log' and c.column_name = 'sent_at';
    r := r || nl || case when v = 'timestamp with time zone nullable=YES rls=true policies=0' then 'PASS ' else 'FAIL ' end
              || 'shape: ' || coalesce(v, '(missing)');
  exception when others then
    r := r || nl || 'FAIL shape: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T2 comments: the new column's, and the table's new one
  begin
    v := format('column=%s table=%s',
      (col_description('public.payment_email_log'::regclass,
        (select attnum from pg_attribute where attrelid = 'public.payment_email_log'::regclass and attname = 'sent_at')) like 'payment-ipn: when the e-mail was handed%')::text,
      (obj_description('public.payment_email_log'::regclass, 'pg_class') = new_comment)::text);
    r := r || nl || case when v = 'column=true table=true' then 'PASS ' else 'FAIL ' end || 'comments ' || v;
  exception when others then
    r := r || nl || 'FAIL comments: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T3 backfill: the key written before the migration counts as sent, none is left empty
  begin
    select count(*) filter (where sent_at is null), count(*) filter (where payment_id = pay and status = 'paid' and sent_at = created_at)
      into n, v from public.payment_email_log;
    r := r || nl || case when n = 0 and v = '1' then 'PASS ' else 'FAIL ' end
              || 'backfill: rows without sent_at = ' || n || ', old-style test key sent_at = created_at: ' || v;
  exception when others then
    r := r || nl || 'FAIL backfill: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T4 privileges, column by column
  begin
    v := format('service_role select/insert/delete=%s/%s/%s update sent_at/created_at/payment_id/status=%s/%s/%s/%s anon=%s/%s authenticated=%s/%s',
      has_table_privilege('service_role', 'public.payment_email_log', 'select')::text,
      has_table_privilege('service_role', 'public.payment_email_log', 'insert')::text,
      has_table_privilege('service_role', 'public.payment_email_log', 'delete')::text,
      has_column_privilege('service_role', 'public.payment_email_log', 'sent_at', 'update')::text,
      has_column_privilege('service_role', 'public.payment_email_log', 'created_at', 'update')::text,
      has_column_privilege('service_role', 'public.payment_email_log', 'payment_id', 'update')::text,
      has_column_privilege('service_role', 'public.payment_email_log', 'status', 'update')::text,
      has_column_privilege('anon', 'public.payment_email_log', 'sent_at', 'select')::text,
      has_column_privilege('anon', 'public.payment_email_log', 'sent_at', 'update')::text,
      has_column_privilege('authenticated', 'public.payment_email_log', 'sent_at', 'select')::text,
      has_column_privilege('authenticated', 'public.payment_email_log', 'sent_at', 'update')::text);
    r := r || nl || case when v = 'service_role select/insert/delete=true/true/true update sent_at/created_at/payment_id/status=true/true/false/false anon=false/false authenticated=false/false'
                         then 'PASS ' else 'FAIL ' end || 'privileges ' || v;
  exception when others then
    r := r || nl || 'FAIL privileges: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T5 the paying member can neither read nor mark anything sent
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

  -- T6 anon neither
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

  -- T7 service role (payment-ipn): a fresh claim has no sent_at, it can be marked
  -- sent, and status cannot be changed
  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    set local role service_role;
    delete from public.payment_email_log where payment_id = pay and status = 'failed';
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
    reset role;
    perform set_config('request.jwt.claims', '', true);
  exception when others then
    reset role;
    r := r || nl || 'FAIL service_role claim block: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T8 service role: an abandoned claim (20 minutes old, never marked sent) is taken
  -- over exactly once (payment-ipn's conditional update of created_at)
  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    set local role service_role;
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
    r := r || nl || 'FAIL service_role takeover block: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- INFO the payments table is untouched by the migration (only the test row)
  begin
    select count(*) into n from public.payments where id <> pay;
    r := r || nl || 'INFO other payments rows: ' || n;
  exception when others then
    r := r || nl || 'FAIL payments count: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T9 the DOWN script, verbatim: the column, the update right and the new comment
  -- go, the rest stays
  begin
    revoke update (sent_at, created_at) on table public.payment_email_log from service_role;

    alter table public.payment_email_log drop column if exists sent_at;

    comment on table public.payment_email_log is
      'payment-ipn: one row per payment e-mail sent (payment id + status). The primary key makes the e-mail idempotent. Service role only.';

    select count(*) into n from information_schema.columns
     where table_schema = 'public' and table_name = 'payment_email_log' and column_name = 'sent_at';
    v := format('sent_at columns=%s service_role update created_at=%s select/insert/delete=%s/%s/%s comment restored=%s',
      n,
      has_column_privilege('service_role', 'public.payment_email_log', 'created_at', 'update')::text,
      has_table_privilege('service_role', 'public.payment_email_log', 'select')::text,
      has_table_privilege('service_role', 'public.payment_email_log', 'insert')::text,
      has_table_privilege('service_role', 'public.payment_email_log', 'delete')::text,
      (obj_description('public.payment_email_log'::regclass, 'pg_class') = old_comment)::text);
    r := r || nl || case when v = 'sent_at columns=0 service_role update created_at=false select/insert/delete=true/true/true comment restored=true'
                         then 'PASS ' else 'FAIL ' end || 'down script: ' || v;
  exception when others then
    r := r || nl || 'FAIL down script: ' || sqlstate || ' ' || sqlerrm;
  end;

  raise exception 'DRYRUN %', coalesce(r, '(report lost: a NULL was concatenated)');
end
$dryrun$;
