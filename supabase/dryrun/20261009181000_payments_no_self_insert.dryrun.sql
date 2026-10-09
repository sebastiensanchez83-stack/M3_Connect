-- DRY RUN of supabase/migrations/20261009181000_payments_no_self_insert.sql
-- (and of its down script). NOT A MIGRATION: never apply it, never commit it.
--
-- Run it as ONE query text (one implicit transaction). The last statement ends
-- with RAISE EXCEPTION 'DRYRUN ...': the report is the error message, and
-- everything (the dropped policy, the test payments) rolls back.
-- Tripwire: if the report starts with "FAIL before-snapshot missing", the
-- statements did NOT run in one transaction and the migration may have been
-- committed: check pg_policies for payments_insert_own at once.
--
-- Expected report: every line PASS.
--
-- Real ids, looked up read-only on 9 Oct 2026:
--   member, verified, not staff (persona marina): 0f8c900e-5e63-404c-96ca-58a0718541a8
--   verified admin (is_moderator()):             9e51b498-d4d9-4a66-91f5-0c4e66185179
--   public.payments had 0 rows; every test row below carries metadata {"dryrun": true}
--   and goes with the final RAISE.

-- ────────────────────────────────────────────────────────────────────────────
-- 0. Before: the policy exists; fingerprints of the payments policies.
-- ────────────────────────────────────────────────────────────────────────────
do $before$
begin
  perform set_config('smc_dryrun.insert_own_before', (
    select count(*)::text from pg_policies
     where schemaname = 'public' and tablename = 'payments' and policyname = 'payments_insert_own'), true);
  perform set_config('smc_dryrun.all_before', (
    select md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s', policyname, permissive, cmd, roles, qual, with_check), ';' order by policyname), ''))
      from pg_policies where schemaname = 'public' and tablename = 'payments'), true);
  perform set_config('smc_dryrun.others_before', (
    select md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s', policyname, permissive, cmd, roles, qual, with_check), ';' order by policyname), ''))
      from pg_policies where schemaname = 'public' and tablename = 'payments' and policyname <> 'payments_insert_own'), true);
  perform set_config('smc_dryrun.before', 'yes', true);
end
$before$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. The migration body, verbatim.
-- ────────────────────────────────────────────────────────────────────────────
drop policy if exists payments_insert_own on public.payments;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Checks (then the down script, then checks again).
-- ────────────────────────────────────────────────────────────────────────────
do $dryrun$
declare
  nl constant text := chr(10);
  r text := '';
  v text;
  n int;
  member constant uuid := '0f8c900e-5e63-404c-96ca-58a0718541a8';
  staff constant uuid := '9e51b498-d4d9-4a66-91f5-0c4e66185179';
begin
  -- T0 one transaction, and the policy really existed before
  r := case when current_setting('smc_dryrun.before', true) = 'yes'
            then 'PASS before-snapshot present (one transaction)'
            else 'FAIL before-snapshot missing: NOT one transaction, the migration may be COMMITTED' end;
  r := r || nl || case when current_setting('smc_dryrun.insert_own_before', true) = '1' then 'PASS ' else 'FAIL ' end
            || 'payments_insert_own existed before (' || coalesce(current_setting('smc_dryrun.insert_own_before', true), '?') || ')';

  -- T1 the policy is gone, every other payments policy is identical
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'payments' and policyname = 'payments_insert_own';
  r := r || nl || case when n = 0 then 'PASS ' else 'FAIL ' end || 'payments_insert_own dropped (' || n || ' left)';
  select md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s', policyname, permissive, cmd, roles, qual, with_check), ';' order by policyname), ''))
    into v from pg_policies where schemaname = 'public' and tablename = 'payments';
  r := r || nl || case when v = current_setting('smc_dryrun.others_before', true) then 'PASS ' else 'FAIL ' end
            || 'other payments policies unchanged';

  -- A payment of the member, written as the table owner (the edge functions' service
  -- role does the same), for the read check below.
  begin
    insert into public.payments (user_id, payment_type, amount_cents, currency, status, reference_type, metadata)
    values (member, 'event_participation', 12345, 'EUR', 'pending', 'event_participation', '{"dryrun": true, "who": "owner"}'::jsonb);
    r := r || nl || 'PASS owner insert (setup)';
  exception when others then
    r := r || nl || 'FAIL owner insert (setup): ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T2 the member can no longer insert, neither "paid" nor "pending"; still reads their own
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      insert into public.payments (user_id, payment_type, amount_cents, currency, status, metadata)
      values (member, 'membership', 50000, 'EUR', 'paid', '{"dryrun": true, "who": "member-paid"}'::jsonb);
      r := r || nl || 'FAIL member could insert a PAID payment';
    exception when insufficient_privilege then
      r := r || nl || 'PASS member insert of a paid payment refused (42501)';
    end;
    begin
      insert into public.payments (user_id, payment_type, amount_cents, currency, status, metadata)
      values (member, 'event_participation', 100, 'EUR', 'pending', '{"dryrun": true, "who": "member-pending"}'::jsonb);
      r := r || nl || 'FAIL member could insert a pending payment';
    exception when insufficient_privilege then
      r := r || nl || 'PASS member insert of a pending payment refused (42501)';
    end;
    select count(*) into n from public.payments where metadata->>'dryrun' = 'true';
    r := r || nl || case when n = 1 then 'PASS ' else 'FAIL ' end || 'member still reads own payment (' || n || ' visible)';
    reset role;
    perform set_config('request.jwt.claims', '', true);
  exception when others then
    reset role;
    r := r || nl || 'FAIL member block: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T3 anon cannot insert
  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    set local role anon;
    begin
      insert into public.payments (user_id, payment_type, amount_cents, currency, status, metadata)
      values (member, 'membership', 50000, 'EUR', 'paid', '{"dryrun": true, "who": "anon"}'::jsonb);
      r := r || nl || 'FAIL anon could insert a payment';
    exception when insufficient_privilege then
      r := r || nl || 'PASS anon insert refused (42501)';
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
  exception when others then
    reset role;
    r := r || nl || 'FAIL anon block: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T4 a verified admin still inserts, reads and updates through payments_admin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', staff, 'role', 'authenticated')::text, true);
    set local role authenticated;
    insert into public.payments (user_id, payment_type, amount_cents, currency, status, metadata)
    values (member, 'event_participation', 2500, 'EUR', 'pending', '{"dryrun": true, "who": "admin"}'::jsonb);
    r := r || nl || 'PASS admin insert still allowed (payments_admin)';
    update public.payments set status = 'cancelled' where metadata->>'who' = 'admin';
    get diagnostics n = row_count;
    r := r || nl || case when n = 1 then 'PASS ' else 'FAIL ' end || 'admin update still allowed (' || n || ' row)';
    select count(*) into n from public.payments where metadata->>'dryrun' = 'true';
    r := r || nl || case when n = 2 then 'PASS ' else 'FAIL ' end || 'admin reads every test payment (' || n || ')';
    reset role;
    perform set_config('request.jwt.claims', '', true);
  exception when others then
    reset role;
    r := r || nl || 'FAIL admin block: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T5 the service role (create-payment, payment-ipn) still inserts
  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    set local role service_role;
    insert into public.payments (user_id, payment_type, amount_cents, currency, status, metadata)
    values (member, 'event_participation', 2500, 'EUR', 'pending', '{"dryrun": true, "who": "service"}'::jsonb);
    r := r || nl || 'PASS service_role insert still allowed';
    reset role;
    perform set_config('request.jwt.claims', '', true);
  exception when others then
    reset role;
    r := r || nl || 'FAIL service_role block: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T6 the DOWN script, verbatim: the policy comes back identical
  begin
    drop policy if exists payments_insert_own on public.payments;
    create policy payments_insert_own on public.payments
      as permissive
      for insert
      to public
      with check (user_id = auth.uid());
    select md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s', policyname, permissive, cmd, roles, qual, with_check), ';' order by policyname), ''))
      into v from pg_policies where schemaname = 'public' and tablename = 'payments';
    r := r || nl || case when v = current_setting('smc_dryrun.all_before', true) then 'PASS ' else 'FAIL ' end
              || 'down script restores the payments policies exactly';
  exception when others then
    r := r || nl || 'FAIL down script: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T7 after the down script, the member can insert again (the old behaviour)
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
    set local role authenticated;
    insert into public.payments (user_id, payment_type, amount_cents, currency, status, metadata)
    values (member, 'event_participation', 100, 'EUR', 'pending', '{"dryrun": true, "who": "member-after-down"}'::jsonb);
    r := r || nl || 'PASS after the down script the member inserts again (old behaviour back)';
    reset role;
    perform set_config('request.jwt.claims', '', true);
  exception when others then
    reset role;
    r := r || nl || 'FAIL after down, member insert: ' || sqlstate || ' ' || sqlerrm;
  end;

  raise exception 'DRYRUN %', coalesce(r, '(report lost: a NULL was concatenated)');
end
$dryrun$;
