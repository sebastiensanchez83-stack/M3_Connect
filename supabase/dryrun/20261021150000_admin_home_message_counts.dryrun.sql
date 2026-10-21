-- DRY RUN of supabase/migrations/20261021150000_admin_home_message_counts.sql and of its down.
-- NOT A MIGRATION. ONE query text, ONE execute_sql call, BEFORE the file is applied.
-- Creates the function inside the transaction, calls it as a verified admin (a jsonb with two
-- numbers equal to a direct count), as a verified moderator and as a random signed-in id
-- (42501 both), checks anon has no EXECUTE, then runs the down (function gone).
-- Ends with RAISE EXCEPTION 'DRYRUN ...': everything rolls back. Expected: "DRYRUN 5 PASS, 0 FAIL".

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.admin_home_message_counts()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'last_7_days', (select count(*) from public.conversation_messages m where m.deleted_at is null and m.created_at > now() - interval '7 days'),
    'total',       (select count(*) from public.conversation_messages m where m.deleted_at is null));
end; $$;
revoke all on function public.admin_home_message_counts() from public, anon;
grant execute on function public.admin_home_message_counts() to authenticated;

do $dr$
declare
  v_admin uuid := (select user_id from public.profiles where persona = 'admin' and access_status = 'verified' order by created_at limit 1);
  v_mod uuid := (select user_id from public.profiles where persona = 'moderator' and access_status = 'verified' order by created_at limit 1);
  v_res jsonb; v_state text; v_pass int := 0; v_fail int := 0; v_log text := '';
  v_want7 bigint := (select count(*) from public.conversation_messages where deleted_at is null and created_at > now() - interval '7 days');
  v_wantall bigint := (select count(*) from public.conversation_messages where deleted_at is null);
  procedure_ok boolean;
begin
  -- 1. admin: the two numbers
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_res := public.admin_home_message_counts();
  reset role;
  procedure_ok := v_admin is not null and (v_res ->> 'last_7_days')::bigint = v_want7 and (v_res ->> 'total')::bigint = v_wantall;
  if procedure_ok then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_log := v_log || ' admin:' || coalesce(v_res::text, 'null'); end if;

  -- 2. moderator: refused (skipped as a pass when there is no verified moderator)
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', coalesce(v_mod, gen_random_uuid()), 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.admin_home_message_counts();
    reset role; v_fail := v_fail + 1; v_log := v_log || ' moderator:allowed';
  exception when others then reset role; v_state := sqlstate;
    if v_state = '42501' then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_log := v_log || ' moderator:' || v_state; end if;
  end;

  -- 3. random signed-in id: refused
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.admin_home_message_counts();
    reset role; v_fail := v_fail + 1; v_log := v_log || ' random:allowed';
  exception when others then reset role; v_state := sqlstate;
    if v_state = '42501' then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_log := v_log || ' random:' || v_state; end if;
  end;

  -- 4. anon has no EXECUTE
  if not has_function_privilege('anon', 'public.admin_home_message_counts()', 'execute') then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; v_log := v_log || ' anon:execute'; end if;

  -- 5. the down removes it
  drop function if exists public.admin_home_message_counts();
  if to_regprocedure('public.admin_home_message_counts()') is null then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; v_log := v_log || ' down:still-there'; end if;

  raise exception 'DRYRUN % PASS, % FAIL%', v_pass, v_fail, case when v_log = '' then '' else ' |' || v_log end;
end $dr$;
