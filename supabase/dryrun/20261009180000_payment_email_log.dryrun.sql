-- DRY RUN of supabase/migrations/20261009180000_payment_email_log.sql.
-- NOT A MIGRATION: never apply it, never commit it to the database.
--
-- Run it as ONE query text (one implicit transaction). The last statement ends
-- with RAISE EXCEPTION 'DRYRUN ...': the report is the error message, and
-- everything (the CREATE TABLE, the test payment and its e-mail keys) rolls back.
-- Tripwire: if the report starts with "FAIL before-snapshot missing", the
-- statements did NOT run in one transaction and the migration may have been
-- committed: check to_regclass('public.payment_email_log') at once.
--
-- Expected report: every line PASS. The last checks (T10) run the down script
-- too, inside the same transaction.
--
-- Real ids, looked up read-only on 9 Oct 2026:
--   member, verified, not staff: 0f8c900e-5e63-404c-96ca-58a0718541a8
--   verified admin (is_moderator()): 9e51b498-d4d9-4a66-91f5-0c4e66185179
--   public.payments had 0 rows; the test payment below belongs to the member and
--   goes with the final RAISE.

-- ────────────────────────────────────────────────────────────────────────────
-- 0. Before the migration: the table must not exist; the payments policies.
-- ────────────────────────────────────────────────────────────────────────────
do $before$
begin
  perform set_config('smc_dryrun.existed_before', coalesce(to_regclass('public.payment_email_log')::text, 'none'), true);
  perform set_config('smc_dryrun.payments_policies_before', (
    select md5(coalesce(string_agg(format('%s|%s|%s|%s|%s', policyname, cmd, roles, qual, with_check), ';' order by policyname), ''))
      from pg_policies where schemaname = 'public' and tablename = 'payments'), true);
  perform set_config('smc_dryrun.before', 'yes', true);
end
$before$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. The migration body, verbatim.
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.payment_email_log (
  payment_id uuid not null references public.payments(id) on delete cascade,
  status text not null check (status in ('paid', 'failed')),
  created_at timestamptz not null default now(),
  primary key (payment_id, status)
);

comment on table public.payment_email_log is
  'payment-ipn: one row per payment e-mail sent (payment id + status). The primary key makes the e-mail idempotent. Service role only.';

alter table public.payment_email_log enable row level security;

revoke all on table public.payment_email_log from anon, authenticated;
revoke all on table public.payment_email_log from public, service_role;
grant select, insert, delete on table public.payment_email_log to service_role;

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
  staff constant uuid := '9e51b498-d4d9-4a66-91f5-0c4e66185179';
  pay uuid;
begin
  -- T0 one transaction
  r := case when current_setting('smc_dryrun.before', true) = 'yes'
            then 'PASS before-snapshot present (one transaction)'
            else 'FAIL before-snapshot missing: NOT one transaction, the migration may be COMMITTED' end;
  r := r || nl || case when current_setting('smc_dryrun.existed_before', true) = 'none' then 'PASS ' else 'FAIL ' end
            || 'table absent before the migration (' || coalesce(current_setting('smc_dryrun.existed_before', true), '?') || ')';

  -- T1 shape: RLS on, no policy, primary key (payment_id, status), cascade FK
  begin
    select format('rls=%s policies=%s pk=%s fk=%s',
      c.relrowsecurity,
      (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'payment_email_log'),
      (select pg_get_constraintdef(k.oid) from pg_constraint k where k.conrelid = c.oid and k.contype = 'p'),
      (select pg_get_constraintdef(k.oid) from pg_constraint k where k.conrelid = c.oid and k.contype = 'f'))
      into v
      from pg_class c where c.oid = 'public.payment_email_log'::regclass;
    r := r || nl || case when v = 'rls=true policies=0 pk=PRIMARY KEY (payment_id, status) fk=FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE'
                         then 'PASS ' else 'FAIL ' end || 'shape: ' || coalesce(v, '(missing)');
  exception when others then
    r := r || nl || 'FAIL shape: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T2 privileges
  begin
    v := format('anon=%s/%s/%s authenticated=%s/%s/%s service_role=%s/%s/%s/%s',
      has_table_privilege('anon', 'public.payment_email_log', 'select'),
      has_table_privilege('anon', 'public.payment_email_log', 'insert'),
      has_table_privilege('anon', 'public.payment_email_log', 'delete'),
      has_table_privilege('authenticated', 'public.payment_email_log', 'select'),
      has_table_privilege('authenticated', 'public.payment_email_log', 'insert'),
      has_table_privilege('authenticated', 'public.payment_email_log', 'delete'),
      has_table_privilege('service_role', 'public.payment_email_log', 'select'),
      has_table_privilege('service_role', 'public.payment_email_log', 'insert'),
      has_table_privilege('service_role', 'public.payment_email_log', 'delete'),
      has_table_privilege('service_role', 'public.payment_email_log', 'update'));
    r := r || nl || case when v = 'anon=false/false/false authenticated=false/false/false service_role=true/true/true/false'
                         then 'PASS ' else 'FAIL ' end || 'privileges ' || v;
  exception when others then
    r := r || nl || 'FAIL privileges: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- A test payment of the member (rolled back with everything else).
  begin
    insert into public.payments (user_id, payment_type, amount_cents, currency, status, reference_type, metadata)
    values (member, 'event_participation', 12345, 'EUR', 'pending', 'event_participation', '{"dryrun": true}'::jsonb)
    returning id into pay;
    r := r || nl || 'PASS test payment created';
  exception when others then
    r := r || nl || 'FAIL test payment: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T3 anon reads / writes nothing
  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    set local role anon;
    begin
      select count(*) into n from public.payment_email_log;
      r := r || nl || 'FAIL anon could read payment_email_log (' || n || ' rows)';
    exception when insufficient_privilege then
      r := r || nl || 'PASS anon select refused (42501)';
    end;
    begin
      insert into public.payment_email_log (payment_id, status) values (pay, 'paid');
      r := r || nl || 'FAIL anon could insert into payment_email_log';
    exception when insufficient_privilege then
      r := r || nl || 'PASS anon insert refused (42501)';
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
  exception when others then
    reset role;
    r := r || nl || 'FAIL anon block: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T4 the paying member reads / writes nothing, not even for their own payment
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
      insert into public.payment_email_log (payment_id, status) values (pay, 'paid');
      r := r || nl || 'FAIL member could insert into payment_email_log (could block their own e-mail)';
    exception when insufficient_privilege then
      r := r || nl || 'PASS member insert refused (42501)';
    end;
    begin
      delete from public.payment_email_log where payment_id = pay;
      r := r || nl || 'FAIL member could delete from payment_email_log';
    exception when insufficient_privilege then
      r := r || nl || 'PASS member delete refused (42501)';
    end;
    begin
      update public.payment_email_log set created_at = now() where payment_id = pay;
      r := r || nl || 'FAIL member could update payment_email_log';
    exception when insufficient_privilege then
      r := r || nl || 'PASS member update refused (42501)';
    end;
    begin
      truncate public.payment_email_log;
      r := r || nl || 'FAIL member could truncate payment_email_log';
    exception when insufficient_privilege then
      r := r || nl || 'PASS member truncate refused (42501)';
    end;
    -- The member still sees their own payment as before (payments policies untouched).
    select count(*) into n from public.payments where id = pay;
    r := r || nl || case when n = 1 then 'PASS ' else 'FAIL ' end || 'member still reads own payment (' || n || ')';
    reset role;
    perform set_config('request.jwt.claims', '', true);
  exception when others then
    reset role;
    r := r || nl || 'FAIL member block: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T5 a verified admin through the API gets nothing either (service role only)
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', staff, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      select count(*) into n from public.payment_email_log;
      r := r || nl || 'FAIL admin (API) could read payment_email_log (' || n || ' rows)';
    exception when insufficient_privilege then
      r := r || nl || 'PASS admin (API) select refused (42501)';
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
  exception when others then
    reset role;
    r := r || nl || 'FAIL admin block: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T6 service role: the claim / duplicate / release cycle payment-ipn relies on
  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    set local role service_role;
    insert into public.payment_email_log (payment_id, status) values (pay, 'paid');
    r := r || nl || 'PASS service_role claims (payment, paid)';
    begin
      insert into public.payment_email_log (payment_id, status) values (pay, 'paid');
      r := r || nl || 'FAIL second claim of (payment, paid) went through: duplicate e-mails possible';
    exception when unique_violation then
      r := r || nl || 'PASS second claim of (payment, paid) refused (23505)';
    end;
    insert into public.payment_email_log (payment_id, status) values (pay, 'failed');
    r := r || nl || 'PASS (payment, failed) is a separate key';
    begin
      insert into public.payment_email_log (payment_id, status) values (pay, 'cancelled');
      r := r || nl || 'FAIL status cancelled accepted';
    exception when check_violation then
      r := r || nl || 'PASS status cancelled refused (23514)';
    end;
    begin
      insert into public.payment_email_log (payment_id, status) values (gen_random_uuid(), 'paid');
      r := r || nl || 'FAIL claim for an unknown payment accepted';
    exception when foreign_key_violation then
      r := r || nl || 'PASS claim for an unknown payment refused (23503)';
    end;
    delete from public.payment_email_log where payment_id = pay and status = 'paid';
    get diagnostics n = row_count;
    r := r || nl || case when n = 1 then 'PASS ' else 'FAIL ' end || 'service_role releases a claim (' || n || ' row)';
    insert into public.payment_email_log (payment_id, status) values (pay, 'paid');
    r := r || nl || 'PASS claim taken again after release (the retry path)';
    begin
      update public.payment_email_log set created_at = now() where payment_id = pay;
      r := r || nl || 'FAIL service_role may update (not needed, not granted)';
    exception when insufficient_privilege then
      r := r || nl || 'PASS service_role update refused (not granted)';
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
  exception when others then
    reset role;
    r := r || nl || 'FAIL service_role block: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T7 the conditional status move payment-ipn uses: once, never away from paid
  begin
    update public.payments set status = 'paid', paid_at = now()
     where id = pay and status in ('pending', 'failed', 'cancelled');
    get diagnostics n = row_count;
    v := n::text;
    update public.payments set status = 'paid', paid_at = now()
     where id = pay and status in ('pending', 'failed', 'cancelled');
    get diagnostics n = row_count;
    v := v || '/' || n;
    update public.payments set status = 'failed'
     where id = pay and status in ('pending', 'cancelled');
    get diagnostics n = row_count;
    v := v || '/' || n;
    r := r || nl || case when v = '1/0/0' then 'PASS ' else 'FAIL ' end
              || 'status moves once (first paid / repeat paid / late failed = ' || v || ')';
  exception when others then
    r := r || nl || 'FAIL status move: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T8 deleting a payment takes its e-mail keys with it
  begin
    delete from public.payments where id = pay;
    select count(*) into n from public.payment_email_log where payment_id = pay;
    r := r || nl || case when n = 0 then 'PASS ' else 'FAIL ' end || 'cascade on payment delete (' || n || ' left)';
  exception when others then
    r := r || nl || 'FAIL cascade: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T9 nothing else changed: payments policies identical
  begin
    select md5(coalesce(string_agg(format('%s|%s|%s|%s|%s', policyname, cmd, roles, qual, with_check), ';' order by policyname), ''))
      into v from pg_policies where schemaname = 'public' and tablename = 'payments';
    r := r || nl || case when v = current_setting('smc_dryrun.payments_policies_before', true) then 'PASS ' else 'FAIL ' end
              || 'payments policies unchanged';
  exception when others then
    r := r || nl || 'FAIL payments policies: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T10 the DOWN script, verbatim: the table goes, nothing else moves
  begin
    drop table if exists public.payment_email_log;
    r := r || nl || case when to_regclass('public.payment_email_log') is null then 'PASS ' else 'FAIL ' end
              || 'down script drops payment_email_log';
    select md5(coalesce(string_agg(format('%s|%s|%s|%s|%s', policyname, cmd, roles, qual, with_check), ';' order by policyname), ''))
      into v from pg_policies where schemaname = 'public' and tablename = 'payments';
    r := r || nl || case when v = current_setting('smc_dryrun.payments_policies_before', true) then 'PASS ' else 'FAIL ' end
              || 'payments policies unchanged after the down script';
  exception when others then
    r := r || nl || 'FAIL down script: ' || sqlstate || ' ' || sqlerrm;
  end;

  raise exception 'DRYRUN %', coalesce(r, '(report lost: a NULL was concatenated)');
end
$dryrun$;
