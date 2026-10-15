-- DRY RUN of supabase/migrations/20261016093000_log_org_event_definer_only.sql. NOT A MIGRATION.
-- ONE query text, ONE execute_sql call, BEFORE that file is applied (any order with Phase 3).
-- A snapshot, the migration verbatim, then cases as anon / a member / a verified admin / the
-- service role, each rolled back. Ends with RAISE EXCEPTION 'DRYRUN ...': everything rolls back.
-- Expected: "7 PASS, 0 FAIL".

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ─── A. Snapshot (read again after the migration, case S01: must be identical) ─
create function pg_temp.dr_snap() returns table (k text, v text) language sql as $f$
  select 'orgs', (select md5(coalesce(string_agg(concat_ws('/', o.id, o.name, o.access_status, o.organization_type, o.owner_user_id, o.updated_at), ',' order by o.id), '')) from public.organizations o)
  union all select 'audit', (select count(*)::text from public.organization_audit_log)
  union all select 'policies', (select md5(string_agg(format('%s|%s|%s|%s|%s', pl.tablename, pl.policyname, pl.roles, pl.qual, pl.with_check), ';' order by pl.tablename, pl.policyname))
                                  from pg_policies pl where pl.schemaname = 'public')
  union all select 'other_acls', (select md5(string_agg(p.oid::regprocedure::text || '=' || coalesce(array_to_string(p.proacl, ','), ''), ';' order by p.oid::regprocedure::text))
                                    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname <> 'log_org_event')
$f$;
create temp table _dr_before on commit drop as select * from pg_temp.dr_snap();

-- ─── B. The migration, verbatim ─────────────────────────────────────────────────
-- log_org_event(uuid, text, jsonb): no longer callable by visitors and members (fixer of the
-- Phase 3 integration, 15 Oct 2026). Independent of the Phase 3 parts; any order. NOT APPLIED.
-- Down: supabase/migrations/down/20261016093000_log_org_event_definer_only.down.sql.
-- Dry runs: supabase/dryrun/20261016093000_log_org_event_definer_only.dryrun.sql, .down.dryrun.sql.
--
-- public.log_org_event is SECURITY DEFINER and was EXECUTE-able by PUBLIC, anon and
-- authenticated: it inserts any event_type for any organization_id into organization_audit_log
-- without checking the caller, so anyone could forge a company's history. Phase 3's
-- Retro-review reads that log ('organization_auto_verified'), as earlier code reads
-- 'organization_pending_review' and 'ownership_claim_approved'.
-- Its callers (production, read 15 Oct): transfer_org_ownership, admin_set_org_claim_code,
-- create_organization and admin_set_org_owner, all SECURITY DEFINER owned by postgres, and the
-- Phase 3 definer functions admin_validate_person / admin_decide_claim. No client calls it
-- (neither main nor the redesign has rpc('log_org_event')), nor any edge function. A definer
-- function runs as its owner, who keeps EXECUTE: nothing changes for them or for the live site.
-- The service role keeps EXECUTE too.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
declare
  v_md5 text;
  v_bad text;
begin
  select md5(replace(p.prosrc, chr(13), '')) into v_md5
    from pg_proc p where p.oid = to_regprocedure('public.log_org_event(uuid,text,jsonb)');
  if v_md5 is distinct from 'f36ef2bcbab1e3396977f0c71c49c1e3' then
    raise exception 'log_org_event_definer_only: log_org_event changed (md5 %); check its callers again', v_md5;
  end if;
  -- A SECURITY INVOKER caller would run as the API role and lose it: refuse.
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) into v_bad
    from pg_proc p
   where p.prolang <> (select l.oid from pg_language l where l.lanname = 'c')
     and p.prosrc ilike '%log_org_event%'
     and p.oid <> to_regprocedure('public.log_org_event(uuid,text,jsonb)')
     and not p.prosecdef;
  if v_bad is not null then
    raise exception 'log_org_event_definer_only: callers that are not SECURITY DEFINER would lose it: %', v_bad;
  end if;
end
$pre$;

revoke all on function public.log_org_event(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.log_org_event(uuid, text, jsonb) to service_role;

-- After: every definer caller's owner still has EXECUTE (else the whole file rolls back).
do $post$
declare
  v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) into v_bad
    from pg_proc p
   where p.prolang <> (select l.oid from pg_language l where l.lanname = 'c')
     and p.prosrc ilike '%log_org_event%'
     and p.oid <> to_regprocedure('public.log_org_event(uuid,text,jsonb)')
     and not has_function_privilege(p.proowner, 'public.log_org_event(uuid,text,jsonb)', 'execute');
  if v_bad is not null then
    raise exception 'log_org_event_definer_only: the owner of % would lose log_org_event', v_bad;
  end if;
end
$post$;

-- ─── C. Test helpers (temporary, gone with the rollback) ───────────────────────
create function pg_temp.dr_user(p_id uuid, p_email text, p_status text, p_persona text)
returns void language plpgsql as $f$
begin
  insert into auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
  values (p_id, p_email, 'authenticated', 'authenticated', '{}'::jsonb, now(), now(), now());
  update public.profiles
     set email_proven_at = now(), access_status = p_status::public.access_status_enum,
         persona = p_persona::public.persona_enum,
         onboarding_status = (case when p_status = 'verified' then 'completed' else 'submitted' end)::public.onboarding_status_enum
   where user_id = p_id;
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
  vars := jsonb_build_object('admin', gen_random_uuid(), 'owner', gen_random_uuid(), 'org', gen_random_uuid(),
    'e_admin', 'dryrun-admin-' || r8 || '@example.invalid', 'e_owner', 'dryrun-owner-' || r8 || '@example.invalid',
    'code', 'DRYRUN-' || upper(r8), 'r8', r8);
  s0 := $s$select pg_temp.dr_user({admin}, {e_admin}, 'verified', 'admin');
select pg_temp.dr_user({owner}, {e_owner}, 'verified', 'marina');
insert into public.organizations (id, name, slug, access_status, onboarding_status, organization_type, owner_user_id, created_by_user_id)
values ({org}, 'Dryrun Audit ' || {r8}, 'dryrun-audit-' || {r8}, 'verified', 'completed', 'marina', {owner}, {owner});
insert into public.organization_members (organization_id, user_id, role) values ({org}, {owner}, 'owner')$s$;

  tests := jsonb_build_array(
    jsonb_build_object('id', 'S01', 'who', 'postgres', 'bare', true, 'expect', 'ret:0', 'label', 'the migration changes no row, no policy and no other function''s EXECUTE',
      'q', $q$select count(*)::text from ((select * from _dr_before except select * from pg_temp.dr_snap()) union all (select * from pg_temp.dr_snap() except select * from _dr_before)) d$q$),
    jsonb_build_object('id', 'S02', 'who', 'postgres', 'bare', true, 'expect', 'ret:false/false/false/true/true', 'label', 'EXECUTE: not PUBLIC, anon or members; the service role and the owner keep it',
      'q', $q$select concat_ws('/', coalesce((select bool_or(a.grantee = 0) from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.log_org_event(uuid,text,jsonb)'::regprocedure and a.privilege_type = 'EXECUTE'), false)::text,
                has_function_privilege('anon', 'public.log_org_event(uuid,text,jsonb)', 'execute')::text,
                has_function_privilege('authenticated', 'public.log_org_event(uuid,text,jsonb)', 'execute')::text,
                has_function_privilege('service_role', 'public.log_org_event(uuid,text,jsonb)', 'execute')::text,
                has_function_privilege((select p.proowner from pg_proc p where p.oid = 'public.log_org_event(uuid,text,jsonb)'::regprocedure), 'public.log_org_event(uuid,text,jsonb)', 'execute')::text)$q$),
    jsonb_build_object('id', 'S03', 'who', 'postgres', 'bare', true, 'expect', 'ret:0', 'label', 'every function that calls it is SECURITY DEFINER and its owner keeps EXECUTE',
      'q', $q$select count(*)::text from pg_proc p
               where p.prolang <> (select l.oid from pg_language l where l.lanname = 'c') and p.prosrc ilike '%log_org_event%'
                 and p.oid <> 'public.log_org_event(uuid,text,jsonb)'::regprocedure
                 and not (p.prosecdef and has_function_privilege(p.proowner, 'public.log_org_event(uuid,text,jsonb)', 'execute'))$q$),
    jsonb_build_object('id', 'L01', 'who', 'owner', 'expect', 'rls', 'label', 'a member (even the owner) can no longer write their company''s history',
      'q', $q$select count(*)::text from (select public.log_org_event({org}, 'organization_auto_verified', '{}'::jsonb)) x$q$,
      'chk', $c$select not exists (select 1 from public.organization_audit_log l where l.organization_id = {org} and l.event_type = 'organization_auto_verified')$c$),
    jsonb_build_object('id', 'L02', 'who', 'anon', 'expect', 'rls', 'label', 'nor can a visitor',
      'q', $q$select count(*)::text from (select public.log_org_event({org}, 'ownership_claim_approved', '{}'::jsonb)) x$q$,
      'chk', $c$select not exists (select 1 from public.organization_audit_log l where l.organization_id = {org} and l.event_type = 'ownership_claim_approved')$c$),
    jsonb_build_object('id', 'L03', 'who', 'admin', 'expect', 'ret:<code>', 'label', 'a definer caller still logs: an admin sets a claim code (admin_set_org_claim_code), the event is written',
      'q', $q$select public.admin_set_org_claim_code({org}, {code})$q$,
      'chk', $c$select exists (select 1 from public.organization_audit_log l where l.organization_id = {org} and l.event_type = 'claim_code_set_by_admin')$c$),
    jsonb_build_object('id', 'L04', 'who', 'service', 'expect', 'ret:1', 'label', 'the service role still calls it',
      'q', $q$select count(*)::text from (select public.log_org_event({org}, 'dryrun_service', '{}'::jsonb)) x$q$,
      'chk', $c$select exists (select 1 from public.organization_audit_log l where l.organization_id = {org} and l.event_type = 'dryrun_service')$c$)
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

  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (log_org_event_definer_only dry run, run %s)', n_pass, n_fail, now()) || results;
end
$dryrun$;
