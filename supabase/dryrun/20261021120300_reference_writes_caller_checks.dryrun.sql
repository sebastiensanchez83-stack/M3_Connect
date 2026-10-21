-- DRY RUN of supabase/migrations/20261021120300_reference_writes_caller_checks.sql and of its down.
-- NOT A MIGRATION. ONE query text, ONE execute_sql call, BEFORE the file is applied.
-- Fixtures are read at run time: a reference whose creator exists and is a member of its company,
-- another company that creator is not a member of, a moderator, and a random signed-in id with no
-- company. The client writes (ReferenceRequestForm.tsx, main 2a332cf8 and refonte f952b592), the
-- service-role writes of send-reference-email and the signer page's RPC run as their real role
-- (set local role + request.jwt.claims) before the migration, after it and after the down, and
-- must give the same result each time; the forged writes must pass before and fail after. Each try
-- runs in a sub-transaction that is always undone (pg_temp._dr_try), so nothing it writes stays.
-- The reference number sequence is first restarted at its next value inside this transaction
-- (ALTER SEQUENCE RESTART is transactional), so the numbers the tries take are given back at the
-- rollback; it is locked for the second or two the run takes. Prints counts and SQLSTATEs only.
-- Independent of 20261021120000, 20261021120100 and 20261021120200 (applied or not).
-- Ends with RAISE EXCEPTION 'DRYRUN ...': everything rolls back. Expected: "24 PASS, 0 FAIL".

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- A. Helpers, snapshot, fixtures, the tries
create temp table _dr_res (n serial, ok boolean, label text) on commit drop;
create temp table _dr_case (n serial, phase text, k text, label text, role text, sub uuid, q text, want text, got text) on commit drop;
create temp table _dr_fx (k text primary key, u uuid, t text) on commit drop;

-- One try: runs p_sql as p_role with auth.uid() = p_sub and returns 'ok:<rows>' or the SQLSTATE.
-- The try always ends on a private error inside its own sub-transaction, so whatever it wrote,
-- and the role and claims it set, are undone before the next try.
create function pg_temp._dr_try(p_role text, p_sub uuid, p_sql text) returns text
language plpgsql as $f$
declare
  v_n bigint;
  v_state text;
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', p_role)::text, true);
    execute format('set local role %I', p_role);
    execute p_sql;
    get diagnostics v_n = row_count;
    raise exception using errcode = 'DRY01', message = 'undo';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  if v_state = 'DRY01' then
    return 'ok:' || v_n::text;
  end if;
  return v_state;
end
$f$;

create function pg_temp._dr_run(p_phase text) returns void
language plpgsql as $f$
declare
  v_c record;
  v_got text;
begin
  for v_c in select c.n, c.role, c.sub, c.q from pg_temp._dr_case c where c.phase = p_phase order by c.n loop
    v_got := pg_temp._dr_try(v_c.role, v_c.sub, v_c.q);
    update pg_temp._dr_case c set got = v_got where c.n = v_c.n;
  end loop;
end
$f$;

-- One result line per group of tries (k); a try with no expected value is only recorded.
create function pg_temp._dr_check(p_phase text) returns void
language plpgsql as $f$
begin
  insert into pg_temp._dr_res (ok, label)
  select coalesce(bool_and(c.got = c.want) filter (where c.want is not null), true) and bool_and(c.got is not null),
         c.k || ': ' || string_agg(c.label || ' ' || coalesce(c.got, 'not run')
                                     || case when c.want is null then ' (recorded)'
                                             when c.got = c.want then ''
                                             else ' (want ' || c.want || ')' end,
                                   '; ' order by c.n)
    from pg_temp._dr_case c
   where c.phase = p_phase
   group by c.k
   order by min(c.n);
end
$f$;

create function pg_temp._dr_fn() returns regprocedure language sql as $f$
  select to_regprocedure('public.create_reference_request(uuid, uuid, text, text, text, text, text, text, '
                         || 'date, date, date, text, text, text, text, text, text)')
$f$;
create function pg_temp._dr_privs(p_role name, p_tab regclass) returns text language sql as $f$
  select coalesce(string_agg(x.p, ',' order by x.p collate "C"), '')
    from unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) as x(p)
   where has_table_privilege(p_role, p_tab, x.p)
$f$;
create function pg_temp._dr_ucols(p_role name) returns text language sql as $f$
  select coalesce(string_agg(a.attname::text, ',' order by a.attname::text collate "C"), '')
    from pg_attribute a
   where a.attrelid = 'public.reference_requests'::regclass and a.attnum > 0 and not a.attisdropped
     and has_column_privilege(p_role, a.attrelid, a.attnum, 'update')
$f$;
create function pg_temp._dr_acl(p_acl aclitem[]) returns text language sql as $f$
  select coalesce(array_to_string(array(select x::text from unnest(p_acl) as x order by 1), ','), '')
$f$;
create function pg_temp._dr_attacl() returns text language sql as $f$
  select coalesce(string_agg(a.attname::text || ':' || pg_temp._dr_acl(a.attacl), ';' order by a.attname::text collate "C"), '')
    from pg_attribute a
   where a.attrelid = 'public.reference_requests'::regclass and a.attnum > 0 and not a.attisdropped
     and a.attacl is not null
$f$;
create function pg_temp._dr_pols(p_skip boolean) returns text language sql as $f$
  select coalesce(string_agg(format('%s|%s|%s|%s|%s|%s|%s', p.tablename::text, p.policyname::text, p.cmd, p.roles::text,
                                    p.permissive, coalesce(p.qual, '(none)'), coalesce(p.with_check, '(none)')),
                             ';' order by p.tablename::text collate "C", p.policyname::text collate "C"), '')
    from pg_policies p
   where p.schemaname = 'public'
     and p.tablename in ('reference_requests', 'reference_recipients', 'reference_events')
     and not (p_skip and p.policyname in ('reference_requests_insert', 'reference_recipients_insert'))
$f$;

do $a$
declare
  v_req uuid;
  v_ref_id text;
  v_status text;
  v_creator uuid;
  v_org uuid;
  v_client_org uuid;
  v_dom text;
  v_other_org uuid;
  v_mod uuid;
  v_str uuid := gen_random_uuid();
  v_fn regprocedure := pg_temp._dr_fn();
  v_next bigint;
  v_n_own bigint;
  v_rpc text;
  v_ins text;
  v_rcpt text;
  v_k text;
begin
  select r.id, r.reference_id, r.status, r.created_by, r.partner_organization_id, r.client_organization_id,
         public.normalize_domain(r.client_primary_domain)
    into v_req, v_ref_id, v_status, v_creator, v_org, v_client_org, v_dom
    from public.reference_requests r
    join auth.users u on u.id = r.created_by
   where exists (select 1 from public.organization_members m
                  where m.user_id = r.created_by and m.organization_id = r.partner_organization_id)
     and coalesce(public.normalize_domain(r.client_primary_domain), '') <> ''
     and not exists (select 1 from public.email_domain_blocklist b
                      where b.domain = public.normalize_domain(r.client_primary_domain))
   order by (r.status in ('pending', 'sent')) desc, r.created_at, r.id
   limit 1;
  select o.id into v_other_org
    from public.organizations o
   where not exists (select 1 from public.organization_members m where m.organization_id = o.id and m.user_id = v_creator)
   order by o.id
   limit 1;
  select p.user_id into v_mod
    from public.profiles p
    join auth.users u on u.id = p.user_id
   where p.access_status = 'verified' and p.persona::text in ('admin', 'moderator')
     and p.user_id is distinct from v_creator
   order by p.user_id
   limit 1;
  if v_req is null or v_other_org is null or v_mod is null or v_fn is null then
    raise exception 'DRYRUN 0 PASS, 1 FAIL (fixtures missing: reference with a member creator %, other company %, moderator %, function %)',
      v_req is not null, v_other_org is not null, v_mod is not null, v_fn is not null;
  end if;
  select count(*) into v_n_own from public.reference_requests r where r.partner_organization_id = v_org;

  insert into _dr_fx (k, u, t) values
    ('acl_rr', null, (select pg_temp._dr_acl(c.relacl) from pg_class c where c.oid = 'public.reference_requests'::regclass)),
    ('acl_rc', null, (select pg_temp._dr_acl(c.relacl) from pg_class c where c.oid = 'public.reference_recipients'::regclass)),
    ('attacl', null, pg_temp._dr_attacl()),
    ('fn_acl', null, (select pg_temp._dr_acl(p.proacl) from pg_proc p where p.oid = v_fn)),
    ('fn_md5', null, (select md5(p.prosrc) from pg_proc p where p.oid = v_fn)),
    ('fn_cfg', null, (select p.proconfig::text from pg_proc p where p.oid = v_fn)),
    ('pol_all', null, pg_temp._dr_pols(false)),
    ('pol_kept', null, pg_temp._dr_pols(true)),
    ('anon_rr', null, pg_temp._dr_privs('anon', 'public.reference_requests')),
    ('anon_rc', null, pg_temp._dr_privs('anon', 'public.reference_recipients')),
    ('auth_rr', null, pg_temp._dr_privs('authenticated', 'public.reference_requests')),
    ('auth_rc', null, pg_temp._dr_privs('authenticated', 'public.reference_recipients')),
    ('svc_rr', null, pg_temp._dr_privs('service_role', 'public.reference_requests')),
    ('svc_rc', null, pg_temp._dr_privs('service_role', 'public.reference_recipients'));
  insert into _dr_res (ok, label) values (true,
    format('F0 fixtures: a %s reference whose creator is a member of its company (%s reference(s) for that company); '
           || 'another company; a moderator; a random signed-in id', v_status, v_n_own));

  -- The numbers the tries take come from a sequence restarted inside this transaction.
  select case when s.is_called then s.last_value + q.seqincrement else s.last_value end into v_next
    from public.reference_request_seq s, pg_sequence q
   where q.seqrelid = 'public.reference_request_seq'::regclass;
  execute format('alter sequence public.reference_request_seq restart with %s', v_next);
  insert into _dr_res (ok, label) values (
    (select s.last_value = v_next and not s.is_called from public.reference_request_seq s),
    'F1 the reference number sequence is restarted at its next value inside this transaction '
    || '(RESTART is transactional: the numbers the tries take are given back at the rollback)');

  -- Statements (17 arguments for the RPC; only ids and fixed test texts)
  v_rpc := 'select public.create_reference_request(%L::uuid, %L::uuid, %L, null, null, %L, %L, '
           || 'null, null, null, null, null, null, null, null, null, %L)';
  v_ins := 'insert into public.reference_requests (reference_id, verification_code, partner_organization_id, created_by, '
           || 'client_legal_name, client_primary_domain, project_name, recommendation_statement, status, '
           || 'confirmed_signer_name, confirmed_signer_title, confirmed_at) '
           || 'values (%L, %L, %L::uuid, %L::uuid, %L, %L, %L, %L, %L, %L, %L, now())';
  v_rcpt := format('insert into public.reference_recipients (reference_request_id, email, first_name, job_title, confirm_token_hash) '
                   || 'values (%L::uuid, %L, %L, %L, %L)', v_req, 'dryrun-check@' || v_dom, 'Dry', 'Dry run', md5('dryrun'));

  -- The legitimate writes, recorded before the migration (S1-S7)
  insert into _dr_case (phase, k, label, role, sub, q) values
    ('b0', 'creator creates a recommendation for its company (ReferenceRequestForm.tsx:164, main and refonte)', 'S1',
     'authenticated', v_creator, format(v_rpc, v_org, v_creator, 'Dry run', 'dryrun.invalid', 'Dry run', 'Dry run')),
    ('b0', 'creator links the client company (ReferenceRequestForm.tsx:188, both)', 'S2', 'authenticated', v_creator,
     format('update public.reference_requests set client_organization_id = %L::uuid where id = %L::uuid', v_client_org, v_req)),
    ('b0', 'creator, its recommendation list (ReferenceRequestForm.tsx:52, both)', 'S3', 'authenticated', v_creator,
     format('select id, reference_id, client_legal_name, project_name, status, created_at, confirmed_at, created_by '
            || 'from public.reference_requests where partner_organization_id = %L::uuid order by created_at desc', v_org)),
    ('b0', 'service role adds a recipient in the client domain (send-reference-email)', 'S4', 'service_role', null, v_rcpt),
    ('b0', 'service role marks the request sent (send-reference-email)', 'S5', 'service_role', null,
     format('update public.reference_requests set status = %L where id = %L::uuid', 'sent', v_req)),
    ('b0', 'visitor opens a confirmation link (confirm_reference_by_token, wrong token: nothing written)', 'S6', 'anon', null,
     format('select public.confirm_reference_by_token(%L, %L)', v_ref_id, 'dryrun-wrong-token')),
    ('b0', 'moderator creates a recommendation for another company in its own name (staff; no screen does it)', 'S7',
     'authenticated', v_mod, format(v_rpc, v_other_org, v_mod, 'Dry run', 'dryrun.invalid', 'Dry run', 'Dry run'));

  -- Before the migration: the hole
  insert into _dr_case (phase, k, label, role, sub, q, want) values
    ('b', 'B1 today a signed-in account publishes a confirmed recommendation on another company''s page (direct insert, the hole)',
     'creator', 'authenticated', v_creator,
     format(v_ins, 'DRYRUN-REF-1', 'DRYRUN', v_other_org, v_creator, 'Dry run', 'dryrun.invalid', 'Dry run', 'Dry run',
            'confirmed', 'Dry run', 'Dry run'), 'ok:1'),
    ('b', 'B2 today a creator sets the status and the signer of its own request (direct update, the hole)',
     'creator', 'authenticated', v_creator,
     format('update public.reference_requests set status = %L, confirmed_signer_name = %L, confirmed_at = now() where id = %L::uuid',
            'confirmed', 'Dry run', v_req), 'ok:1'),
    ('b', 'B3 today a visitor creates a request for another company in the name of a member (RPC, the hole)',
     'anon', 'anon', null, format(v_rpc, v_other_org, v_creator, 'Dry run', 'dryrun.invalid', 'Dry run', 'Dry run'), 'ok:1'),
    ('b', 'B4 today a creator adds a recipient whose token it chose (ok:1 before 20261021120000, 42501 after it)',
     'creator', 'authenticated', v_creator, v_rcpt, null);

  -- After the migration (the S1-S7 comparisons are added in part C)
  v_k := 'C04 direct inserts into reference_requests are refused';
  insert into _dr_case (phase, k, label, role, sub, q, want) values
    ('c', v_k, 'signed-in, confirmed, another company', 'authenticated', v_creator,
     format(v_ins, 'DRYRUN-REF-1', 'DRYRUN', v_other_org, v_creator, 'Dry run', 'dryrun.invalid', 'Dry run', 'Dry run',
            'confirmed', 'Dry run', 'Dry run'), '42501'),
    ('c', v_k, 'creator, pending, its own company', 'authenticated', v_creator,
     format(v_ins, 'DRYRUN-REF-2', 'DRYRUN', v_org, v_creator, 'Dry run', 'dryrun.invalid', 'Dry run', 'Dry run',
            'pending', null, null), '42501'),
    ('c', v_k, 'anon', 'anon', null,
     format(v_ins, 'DRYRUN-REF-3', 'DRYRUN', v_other_org, v_creator, 'Dry run', 'dryrun.invalid', 'Dry run', 'Dry run',
            'confirmed', 'Dry run', 'Dry run'), '42501');
  v_k := 'C05 direct updates other than client_organization_id, and deletes, are refused (staff included: no screen does them)';
  insert into _dr_case (phase, k, label, role, sub, q, want) values
    ('c', v_k, 'creator status', 'authenticated', v_creator,
     format('update public.reference_requests set status = %L where id = %L::uuid', 'confirmed', v_req), '42501'),
    ('c', v_k, 'creator signer', 'authenticated', v_creator,
     format('update public.reference_requests set confirmed_signer_name = %L where id = %L::uuid', 'Dry run', v_req), '42501'),
    ('c', v_k, 'creator delete', 'authenticated', v_creator,
     format('delete from public.reference_requests where id = %L::uuid', v_req), '42501'),
    ('c', v_k, 'moderator status', 'authenticated', v_mod,
     format('update public.reference_requests set status = %L where id = %L::uuid', 'confirmed', v_req), '42501');
  v_k := 'C06 create_reference_request is refused unless signed in, in its own name, for its own company (or staff)';
  insert into _dr_case (phase, k, label, role, sub, q, want) values
    ('c', v_k, 'anon, a real member''s company', 'anon', null,
     format(v_rpc, v_org, v_creator, 'Dry run', 'dryrun.invalid', 'Dry run', 'Dry run'), '42501'),
    ('c', v_k, 'signed-in with no company', 'authenticated', v_str,
     format(v_rpc, v_org, v_str, 'Dry run', 'dryrun.invalid', 'Dry run', 'Dry run'), '42501'),
    ('c', v_k, 'creator, another company', 'authenticated', v_creator,
     format(v_rpc, v_other_org, v_creator, 'Dry run', 'dryrun.invalid', 'Dry run', 'Dry run'), '42501'),
    ('c', v_k, 'creator, its company, in the moderator''s name', 'authenticated', v_creator,
     format(v_rpc, v_org, v_mod, 'Dry run', 'dryrun.invalid', 'Dry run', 'Dry run'), '42501');
  v_k := 'C07 a creator can no longer add a recipient directly (the service role still can: C11)';
  insert into _dr_case (phase, k, label, role, sub, q, want) values
    ('c', v_k, 'creator', 'authenticated', v_creator, v_rcpt, '42501');

  -- After the down (E4, the S1-S7 comparisons, is added in part E)
  v_k := 'E3 after the down, the forged writes pass again (previous state)';
  insert into _dr_case (phase, k, label, role, sub, q, want) values
    ('e', v_k, 'signed-in direct insert, confirmed, another company', 'authenticated', v_creator,
     format(v_ins, 'DRYRUN-REF-1', 'DRYRUN', v_other_org, v_creator, 'Dry run', 'dryrun.invalid', 'Dry run', 'Dry run',
            'confirmed', 'Dry run', 'Dry run'), 'ok:1'),
    ('e', v_k, 'visitor RPC, another company', 'anon', null,
     format(v_rpc, v_other_org, v_creator, 'Dry run', 'dryrun.invalid', 'Dry run', 'Dry run'), 'ok:1');
end
$a$;

do $b$
begin
  perform pg_temp._dr_run('b0');
  perform pg_temp._dr_run('b');
  perform pg_temp._dr_check('b');
end
$b$;

-- B. The migration, verbatim
-- Fake recommendations, 21 Oct 2026. Found by the review of the go-live runbook's three holes
-- (P2.4, Q8 = a), outside them: any signed-in account can publish a "confirmed" recommendation
-- on any company's page, and a visitor can get one mailed out for any company.
-- Down: supabase/migrations/down/20261021120300_reference_writes_caller_checks.down.sql
-- Dry run: supabase/dryrun/20261021120300_reference_writes_caller_checks.dryrun.sql
--
-- The routes, all open today:
--   - reference_requests: reference_requests_insert only checks created_by = auth.uid(), and the
--     status check allows 'confirmed'. A direct insert of a confirmed row, with any
--     partner_organization_id and a made-up signer, shows on that company's page.
--     reference_requests_update lets a creator set the status and the signer columns of its rows;
--   - reference_recipients: reference_recipients_insert lets a creator add a recipient whose token
--     hash it chose, then confirm through confirm_reference_by_token with no e-mail sent (the
--     recipients trigger's "select *" only stops this once 20261021120000 is applied, by accident);
--   - create_reference_request (SECURITY DEFINER, EXECUTE to PUBLIC and anon) trusts
--     p_partner_org_id and p_created_by: a visitor creates a request for any company, in the name
--     of any of its members (organization_members is readable by anon), and send-reference-email
--     (no caller check before this change) mails the link to an address of the visitor's domain.
-- This file:
--   - anon and authenticated lose INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER on
--     reference_requests and reference_recipients. authenticated gets back UPDATE on
--     reference_requests.client_organization_id only. SELECT (20261021120000's subject) and
--     MAINTAIN are not touched; the service role and the table owner keep every privilege;
--   - the policies reference_requests_insert and reference_recipients_insert are dropped (no
--     privilege is left for them). reference_requests_update stays, for client_organization_id;
--   - create_reference_request refuses with 42501 unless the caller is signed in, p_created_by is
--     the caller, and the caller is a member of p_partner_org_id or staff (is_moderator()). The
--     rest of its body is unchanged. EXECUTE is revoked from PUBLIC and anon.
-- Client writes, grepped on 21 Oct on every branch (main 2a332cf8, refonte f952b592): only
-- ReferenceRequestForm.tsx, :164 the RPC (p_partner_org_id = the company from organization_members
-- via AuthContext, p_created_by = user.id) and :188 the UPDATE of client_organization_id WHERE id,
-- then :193 send-reference-email. No client writes reference_recipients or reference_events.
-- send-reference-email uses the service role (grants and RLS do not apply). Its caller check is
-- in the function (same commit; to deploy separately).
-- Not changed: reference_events (a creator can still add events to its own requests; nothing reads
-- them to decide anything); the confirm and reject RPCs.
-- Order: after 20261021120000, whose pre-check refuses any column grant on the table (this file
-- adds one). Independent of 20261021120100 and 20261021120200.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
declare
  v_fn regprocedure := to_regprocedure('public.create_reference_request(uuid, uuid, text, text, text, text, text, text, '
                                       || 'date, date, date, text, text, text, text, text, text)');
begin
  if not (has_table_privilege('authenticated', 'public.reference_requests', 'insert')
          and has_table_privilege('authenticated', 'public.reference_requests', 'update')
          and has_table_privilege('authenticated', 'public.reference_recipients', 'insert')) then
    raise exception 'reference writes: authenticated no longer holds INSERT and UPDATE on the two tables (applied already?)';
  end if;
  if (select count(*) from pg_policies p
       where p.schemaname = 'public' and p.cmd = 'INSERT' and p.roles = '{authenticated}'::name[]
         and ((p.tablename = 'reference_requests' and p.policyname = 'reference_requests_insert')
              or (p.tablename = 'reference_recipients' and p.policyname = 'reference_recipients_insert'))) <> 2 then
    raise exception 'reference writes: the policies reference_requests_insert / reference_recipients_insert are missing or changed';
  end if;
  if v_fn is null then
    raise exception 'reference writes: create_reference_request is missing or its arguments changed';
  end if;
  if (select md5(p.prosrc) from pg_proc p where p.oid = v_fn) is distinct from '5c9884a8330cdab64303a2708932e903'
     or not (select p.prosecdef from pg_proc p where p.oid = v_fn)
     or (select p.proconfig::text from pg_proc p where p.oid = v_fn) is distinct from '{"search_path=public, pg_temp"}'
     or (select p.prorettype from pg_proc p where p.oid = v_fn) is distinct from 'public.reference_requests'::regtype::oid then
    raise exception 'reference writes: create_reference_request changed since this file was written (body, SECURITY DEFINER, search_path or return type)';
  end if;
  if not has_function_privilege('anon', v_fn, 'execute') then
    raise exception 'reference writes: anon cannot execute create_reference_request any more (applied already?)';
  end if;
end
$pre$;

revoke insert, update, delete, truncate, references, trigger on table public.reference_requests from anon, authenticated;
grant update (client_organization_id) on table public.reference_requests to authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.reference_recipients from anon, authenticated;

drop policy reference_requests_insert on public.reference_requests;
drop policy reference_recipients_insert on public.reference_recipients;

create or replace function public.create_reference_request(p_partner_org_id uuid, p_created_by uuid,
  p_client_legal_name text, p_client_country text, p_client_website text, p_client_primary_domain text,
  p_project_name text, p_project_location text, p_project_start_date date, p_project_end_date date,
  p_project_delivery_date date, p_contract_reference text, p_solution_product text, p_scope_description text,
  p_results_summary text, p_key_kpis text, p_recommendation_statement text)
 returns public.reference_requests
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  new_ref reference_requests;
BEGIN
  -- Caller check (20261021120300): signed in, in its own name, for its own company (or staff).
  IF auth.uid() IS NULL
     OR p_created_by IS DISTINCT FROM auth.uid()
     OR NOT (EXISTS (SELECT 1 FROM public.organization_members m
                      WHERE m.organization_id = p_partner_org_id AND m.user_id = auth.uid())
             OR public.is_moderator()) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  INSERT INTO reference_requests (
    reference_id, verification_code,
    partner_organization_id, created_by,
    client_legal_name, client_country, client_website, client_primary_domain,
    project_name, project_location, project_start_date, project_end_date,
    project_delivery_date, contract_reference, solution_product, scope_description,
    results_summary, key_kpis, recommendation_statement
  ) VALUES (
    generate_reference_id(), generate_verification_code(),
    p_partner_org_id, p_created_by,
    p_client_legal_name, p_client_country, p_client_website, p_client_primary_domain,
    p_project_name, p_project_location, p_project_start_date, p_project_end_date,
    p_project_delivery_date, p_contract_reference, p_solution_product, p_scope_description,
    p_results_summary, p_key_kpis, p_recommendation_statement
  ) RETURNING * INTO new_ref;

  -- Log creation event
  INSERT INTO reference_events (reference_request_id, event_type, actor_type, actor_id)
  VALUES (new_ref.id, 'created', 'partner', p_created_by::text);

  RETURN new_ref;
END;
$function$;

revoke execute on function public.create_reference_request(uuid, uuid, text, text, text, text, text, text,
  date, date, date, text, text, text, text, text, text) from public, anon;

do $post$
declare
  v_fn regprocedure := to_regprocedure('public.create_reference_request(uuid, uuid, text, text, text, text, text, text, '
                                       || 'date, date, date, text, text, text, text, text, text)');
  v_r text;
begin
  foreach v_r in array array['anon', 'authenticated'] loop
    if has_table_privilege(v_r, 'public.reference_requests', 'insert')
       or has_table_privilege(v_r, 'public.reference_requests', 'update')
       or has_table_privilege(v_r, 'public.reference_requests', 'delete')
       or has_table_privilege(v_r, 'public.reference_recipients', 'insert')
       or has_table_privilege(v_r, 'public.reference_recipients', 'update')
       or has_table_privilege(v_r, 'public.reference_recipients', 'delete')
       or has_column_privilege(v_r, 'public.reference_requests', 'status', 'update')
       or has_column_privilege(v_r, 'public.reference_requests', 'confirmed_signer_name', 'update') then
      raise exception 'reference writes: % still writes the tables (a grant through another role?)', v_r;
    end if;
  end loop;
  if not has_column_privilege('authenticated', 'public.reference_requests', 'client_organization_id', 'update')
     or has_column_privilege('anon', 'public.reference_requests', 'client_organization_id', 'update') then
    raise exception 'reference writes: UPDATE of client_organization_id is not authenticated-only';
  end if;
  if has_function_privilege('anon', v_fn, 'execute')
     or not has_function_privilege('authenticated', v_fn, 'execute')
     or not has_function_privilege('service_role', v_fn, 'execute')
     or strpos((select p.prosrc from pg_proc p where p.oid = v_fn), 'Caller check (20261021120300)') = 0 then
    raise exception 'reference writes: create_reference_request is not guarded as expected';
  end if;
end
$post$;

-- C. Checks after the migration
do $c$
declare
  v_fn regprocedure := pg_temp._dr_fn();
  v_fx record;
  v_ok boolean := true;
  v_txt text := '';
  v_now text;
  v_want text;
begin
  -- C01: table privileges of anon and authenticated (only SELECT, if they had it, stays) and the one column UPDATE
  for v_fx in
    select f.k, f.t,
           case f.k when 'anon_rr' then 'anon' when 'anon_rc' then 'anon' else 'authenticated' end::name as r,
           case f.k when 'anon_rr' then 'public.reference_requests' when 'auth_rr' then 'public.reference_requests'
                    else 'public.reference_recipients' end::regclass as tab
      from _dr_fx f
     where f.k in ('anon_rr', 'anon_rc', 'auth_rr', 'auth_rc')
     order by f.k
  loop
    v_now := pg_temp._dr_privs(v_fx.r, v_fx.tab);
    v_want := case when strpos(v_fx.t, 'select') > 0 then 'select' else '' end;
    v_ok := v_ok and v_now = v_want;
    v_txt := v_txt || format('; %s %s -> %s', v_fx.k, v_fx.t, coalesce(nullif(v_now, ''), 'none'));
  end loop;
  insert into _dr_res (ok, label) values (
    v_ok
      and pg_temp._dr_ucols('authenticated') = 'client_organization_id'
      and pg_temp._dr_ucols('anon') = ''
      and pg_temp._dr_privs('service_role', 'public.reference_requests') = (select f.t from _dr_fx f where f.k = 'svc_rr')
      and pg_temp._dr_privs('service_role', 'public.reference_recipients') = (select f.t from _dr_fx f where f.k = 'svc_rc'),
    format('C01 anon and authenticated keep only SELECT on reference_requests and reference_recipients; authenticated updates '
           || 'only %s; anon updates none; service_role unchanged', coalesce(nullif(pg_temp._dr_ucols('authenticated'), ''), 'none'))
    || v_txt);

  -- C02: the two INSERT policies are gone, every other policy of the three tables is unchanged
  insert into _dr_res (ok, label) values (
    pg_temp._dr_pols(false) = (select f.t from _dr_fx f where f.k = 'pol_kept')
      and not exists (select 1 from pg_policies p
                       where p.schemaname = 'public' and p.policyname in ('reference_requests_insert', 'reference_recipients_insert')),
    'C02 reference_requests_insert and reference_recipients_insert are dropped; the other policies of reference_requests, '
    || 'reference_recipients and reference_events are unchanged');

  -- C03: the function
  insert into _dr_res (ok, label) values (
    (select strpos(p.prosrc, 'Caller check (20261021120300)') > 0 and p.prosecdef
            and p.proconfig::text = (select f.t from _dr_fx f where f.k = 'fn_cfg')
       from pg_proc p where p.oid = v_fn)
      and (select pg_temp._dr_acl(p.proacl) from pg_proc p where p.oid = v_fn)
          = (select coalesce(array_to_string(array(select x.a from unnest(string_to_array(f.t, ',')) as x(a)
                                                     where x.a not like '=%' and x.a not like 'anon=%' order by 1), ','), '')
               from _dr_fx f where f.k = 'fn_acl')
      and not has_function_privilege('anon', v_fn, 'execute')
      and has_function_privilege('authenticated', v_fn, 'execute')
      and has_function_privilege('service_role', v_fn, 'execute'),
    'C03 create_reference_request: caller check in, still SECURITY DEFINER with the same search_path; EXECUTE no longer '
    || 'for PUBLIC and anon, still for authenticated and service_role');

  -- C08-C14: each legitimate write (S1-S7) gives after the migration what it gave before
  insert into _dr_case (phase, k, label, role, sub, q, want)
  select 'c', 'C' || lpad((7 + substr(b.label, 2)::int)::text, 2, '0') || ' ' || b.k,
         'before ' || coalesce(b.got, 'not run') || ', after', b.role, b.sub, b.q,
         case when b.got is null or b.got not like 'ok:%' or b.got = 'ok:0'
              then 'ok:(before: ' || coalesce(b.got, 'not run') || ')'
              else b.got end
    from _dr_case b
   where b.phase = 'b0'
   order by b.n;

  perform pg_temp._dr_run('c');
  perform pg_temp._dr_check('c');
end
$c$;

-- D. The down, verbatim
-- DOWN for supabase/migrations/20261021120300_reference_writes_caller_checks.sql
-- Gives anon and authenticated their write privileges on reference_requests and
-- reference_recipients back, recreates the two INSERT policies, restores create_reference_request
-- without its caller check (body identical to before, md5 5c9884a8330cdab64303a2708932e903) and
-- its EXECUTE for PUBLIC and anon: any signed-in account can fake a confirmed recommendation
-- again. Harmless for main and refonte (they only use the RPC and the client_organization_id
-- update). Undo the send-reference-email caller check separately if wanted (it does not depend on
-- this file).

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if has_table_privilege('authenticated', 'public.reference_requests', 'insert')
     or exists (select 1 from pg_policies p
                 where p.schemaname = 'public'
                   and p.policyname in ('reference_requests_insert', 'reference_recipients_insert')) then
    raise exception 'reference writes down: the write privileges or policies are already there (nothing to undo)';
  end if;
end
$pre$;

revoke update (client_organization_id) on table public.reference_requests from authenticated;
grant insert, update, delete, truncate, references, trigger on table public.reference_requests to anon, authenticated;
grant insert, update, delete, truncate, references, trigger on table public.reference_recipients to anon, authenticated;

create policy reference_requests_insert on public.reference_requests
  for insert to authenticated
  with check (created_by = (select auth.uid()));

create policy reference_recipients_insert on public.reference_recipients
  for insert to authenticated
  with check (reference_request_id in (select reference_requests.id
                                         from public.reference_requests
                                        where reference_requests.created_by = (select auth.uid())));

create or replace function public.create_reference_request(p_partner_org_id uuid, p_created_by uuid,
  p_client_legal_name text, p_client_country text, p_client_website text, p_client_primary_domain text,
  p_project_name text, p_project_location text, p_project_start_date date, p_project_end_date date,
  p_project_delivery_date date, p_contract_reference text, p_solution_product text, p_scope_description text,
  p_results_summary text, p_key_kpis text, p_recommendation_statement text)
 returns public.reference_requests
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  new_ref reference_requests;
BEGIN
  INSERT INTO reference_requests (
    reference_id, verification_code,
    partner_organization_id, created_by,
    client_legal_name, client_country, client_website, client_primary_domain,
    project_name, project_location, project_start_date, project_end_date,
    project_delivery_date, contract_reference, solution_product, scope_description,
    results_summary, key_kpis, recommendation_statement
  ) VALUES (
    generate_reference_id(), generate_verification_code(),
    p_partner_org_id, p_created_by,
    p_client_legal_name, p_client_country, p_client_website, p_client_primary_domain,
    p_project_name, p_project_location, p_project_start_date, p_project_end_date,
    p_project_delivery_date, p_contract_reference, p_solution_product, p_scope_description,
    p_results_summary, p_key_kpis, p_recommendation_statement
  ) RETURNING * INTO new_ref;
  
  -- Log creation event
  INSERT INTO reference_events (reference_request_id, event_type, actor_type, actor_id)
  VALUES (new_ref.id, 'created', 'partner', p_created_by::text);
  
  RETURN new_ref;
END;
$function$;

grant execute on function public.create_reference_request(uuid, uuid, text, text, text, text, text, text,
  date, date, date, text, text, text, text, text, text) to public, anon;

do $post$
declare
  v_fn regprocedure := to_regprocedure('public.create_reference_request(uuid, uuid, text, text, text, text, text, text, '
                                       || 'date, date, date, text, text, text, text, text, text)');
  v_src text;
begin
  select p.prosrc into v_src from pg_proc p where p.oid = v_fn;
  -- The body above keeps two lines of two spaces, as before. If an editor stripped them, the body
  -- is the same once trailing spaces are removed (md5 d598685bf18afc9f38d58d9794b9dfa1).
  if (md5(v_src) is distinct from '5c9884a8330cdab64303a2708932e903'
      and md5(regexp_replace(v_src, ' +' || chr(10), chr(10), 'g')) is distinct from 'd598685bf18afc9f38d58d9794b9dfa1')
     or not has_function_privilege('anon', v_fn, 'execute')
     or not has_table_privilege('authenticated', 'public.reference_requests', 'insert')
     or not has_table_privilege('authenticated', 'public.reference_recipients', 'insert') then
    raise exception 'reference writes down: the previous state is not fully back';
  end if;
end
$post$;

-- E. Checks after the down, then the report (rolls everything back)
do $e$
declare
  v_fn regprocedure := pg_temp._dr_fn();
  v_txt text;
begin
  insert into _dr_res (ok, label) values (
    (select pg_temp._dr_acl(c.relacl) from pg_class c where c.oid = 'public.reference_requests'::regclass)
        = (select f.t from _dr_fx f where f.k = 'acl_rr')
      and (select pg_temp._dr_acl(c.relacl) from pg_class c where c.oid = 'public.reference_recipients'::regclass)
          = (select f.t from _dr_fx f where f.k = 'acl_rc')
      and pg_temp._dr_attacl() = (select f.t from _dr_fx f where f.k = 'attacl')
      and (select pg_temp._dr_acl(p.proacl) from pg_proc p where p.oid = v_fn) = (select f.t from _dr_fx f where f.k = 'fn_acl')
      and (select md5(p.prosrc) from pg_proc p where p.oid = v_fn) = (select f.t from _dr_fx f where f.k = 'fn_md5')
      and (select p.proconfig::text from pg_proc p where p.oid = v_fn) = (select f.t from _dr_fx f where f.k = 'fn_cfg')
      and (select p.prosecdef from pg_proc p where p.oid = v_fn),
    'E1 after the down, the ACLs of both tables, the column grants of reference_requests, and create_reference_request '
    || '(exact body md5, search_path, SECURITY DEFINER, EXECUTE list) are the snapshot again');

  insert into _dr_res (ok, label) values (
    pg_temp._dr_pols(false) = (select f.t from _dr_fx f where f.k = 'pol_all'),
    'E2 after the down, the policies of reference_requests, reference_recipients and reference_events are exactly the snapshot again');

  -- E4: each legitimate write (S1-S7) gives after the down what it gave before
  insert into _dr_case (phase, k, label, role, sub, q, want)
  select 'e', 'E4 after the down, every legitimate write (S1-S7) gives what it gave before', b.label, b.role, b.sub, b.q,
         case when b.got is null or b.got not like 'ok:%' or b.got = 'ok:0'
              then 'ok:(before: ' || coalesce(b.got, 'not run') || ')'
              else b.got end
    from _dr_case b
   where b.phase = 'b0'
   order by b.n;

  perform pg_temp._dr_run('e');
  perform pg_temp._dr_check('e');

  select string_agg(case when r.ok then 'PASS ' else 'FAIL ' end || r.label, chr(10) order by r.n) into v_txt from _dr_res r;
  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (reference_writes_caller_checks, run %s)',
    (select count(*) from _dr_res where ok), (select count(*) from _dr_res where ok is not true), now()) || chr(10) || v_txt;
end
$e$;
