-- DRY RUN of supabase/migrations/20261021120000_reference_requests_hide_signer_columns.sql and of its down.
-- NOT A MIGRATION. ONE query text, ONE execute_sql call, BEFORE the file is applied.
-- Fixtures are read at run time: a confirmed reference with its company, a reference whose creator
-- exists, a moderator, and a random signed-in id with no company. Every client read and write of
-- reference_requests (main 2a332cf8, refonte 02559e58) runs as its real role (set local role +
-- request.jwt.claims) before the migration, after it and after the down, and must return the same
-- rows each time. Each try runs in a sub-transaction that is always undone (pg_temp._dr_try), so the
-- one client update writes nothing. Prints counts and SQLSTATEs only. Independent of 20261021120100
-- and 20261021120200 (applied or not).
-- Ends with RAISE EXCEPTION 'DRYRUN ...': everything rolls back. Expected: "25 PASS, 0 FAIL".

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
    perform set_config('storage.allow_delete_query', 'true', true);
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
create function pg_temp._dr_privs(p_role name) returns text language sql as $f$
  select string_agg(x.p, ',' order by x.p collate "C")
    from unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) as x(p)
   where has_table_privilege(p_role, 'public.reference_requests', x.p)
$f$;
create function pg_temp._dr_cols(p_role name) returns text language sql as $f$
  select string_agg(a.attname::text, ',' order by a.attname::text collate "C")
    from pg_attribute a
   where a.attrelid = 'public.reference_requests'::regclass and a.attnum > 0 and not a.attisdropped
     and has_column_privilege(p_role, a.attrelid, a.attnum, 'select')
$f$;

do $a$
declare
  v_conf_org uuid;
  v_req uuid;
  v_creator uuid;
  v_creator_org uuid;
  v_client_org uuid;
  v_is_member boolean;
  v_mod uuid;
  v_str uuid := gen_random_uuid();
  v_n_total bigint;
  v_n_conf bigint;
  v_public text;
  v_k text;
begin
  select r.partner_organization_id into v_conf_org
    from public.reference_requests r
   where r.status = 'confirmed' and r.partner_organization_id is not null
   order by r.created_at, r.id
   limit 1;
  select r.id, r.created_by, r.partner_organization_id, r.client_organization_id,
         exists (select 1 from public.organization_members m
                  where m.user_id = r.created_by and m.organization_id = r.partner_organization_id)
    into v_req, v_creator, v_creator_org, v_client_org, v_is_member
    from public.reference_requests r
    join auth.users u on u.id = r.created_by
   where r.partner_organization_id is not null
   order by exists (select 1 from public.organization_members m
                     where m.user_id = r.created_by and m.organization_id = r.partner_organization_id) desc,
            r.created_at, r.id
   limit 1;
  select p.user_id into v_mod
    from public.profiles p
    join auth.users u on u.id = p.user_id
   where p.access_status = 'verified' and p.persona::text in ('admin', 'moderator')
   order by p.user_id
   limit 1;
  if v_conf_org is null or v_req is null or v_mod is null then
    raise exception 'DRYRUN 0 PASS, 1 FAIL (fixtures missing: confirmed reference with a company %, reference with an existing creator %, moderator %)',
      v_conf_org is not null, v_req is not null, v_mod is not null;
  end if;
  select count(*), count(*) filter (where r.status = 'confirmed') into v_n_total, v_n_conf from public.reference_requests r;
  insert into _dr_fx (k, u, t) values
    ('req', v_req, null),
    ('creator', v_creator, null),
    ('n_total', null, v_n_total::text),
    ('acl', null, (select array_to_string(array(select x::text from unnest(c.relacl) as x order by 1), ',')
                     from pg_class c where c.oid = 'public.reference_requests'::regclass)),
    ('privs_anon', null, pg_temp._dr_privs('anon')),
    ('privs_auth', null, pg_temp._dr_privs('authenticated'));
  insert into _dr_res (ok, label) values (true,
    format('F0 fixtures: a confirmed reference with its company; a reference whose creator exists%s; a moderator; %s reference(s), %s confirmed',
           case when v_is_member then ' (a member of its company)' else ' (NOT a member of its company)' end, v_n_total, v_n_conf));

  -- The client reads and the client update, recorded before the migration (S1-S12)
  v_public := format('select client_legal_name, client_country, project_name, confirmed_signer_name, confirmed_signer_title, confirmed_at '
                     || 'from public.reference_requests where partner_organization_id = %L and status = %L order by confirmed_at desc',
                     v_conf_org, 'confirmed');
  insert into _dr_case (phase, k, label, role, sub, q) values
    ('b0', 'anon, company page references (main OrganizationPublicPage.tsx:384, refonte :548)', 'S1', 'anon', null, v_public),
    ('b0', 'signed-in account with no company, the same company page', 'S2', 'authenticated', v_str, v_public),
    ('b0', 'creator, recommendation list (ReferenceRequestForm.tsx:52, both)', 'S3', 'authenticated', v_creator,
     format('select id, reference_id, client_legal_name, project_name, status, created_at, confirmed_at, created_by '
            || 'from public.reference_requests where partner_organization_id = %L order by created_at desc', v_creator_org)),
    ('b0', 'creator, inbox (main InboxTab.tsx:127)', 'S4', 'authenticated', v_creator,
     format('select id, reference_id, client_legal_name, project_name, status, created_at, confirmed_at '
            || 'from public.reference_requests where partner_organization_id = %L order by created_at desc', v_creator_org)),
    ('b0', 'creator, recommendation count (main AccountPage.tsx:543, :705)', 'S5', 'authenticated', v_creator,
     format('select id from public.reference_requests where partner_organization_id = %L', v_creator_org)),
    ('b0', 'creator, dashboard (refonte useDashboardData.ts:222)', 'S6', 'authenticated', v_creator,
     format('select status from public.reference_requests where partner_organization_id = %L', v_creator_org)),
    ('b0', 'moderator, users list (AdminUsers.tsx main :136, refonte :155)', 'S7', 'authenticated', v_mod,
     format('select id, partner_organization_id, status, client_legal_name, confirmed_at, created_at '
            || 'from public.reference_requests where partner_organization_id = any(%L::uuid[]) order by created_at desc',
            array[v_creator_org, v_conf_org])),
    ('b0', 'moderator, user detail (AdminUserDetail.tsx main :193, refonte :206)', 'S8', 'authenticated', v_mod,
     format('select id, partner_organization_id, status, client_legal_name, confirmed_at, created_at '
            || 'from public.reference_requests where partner_organization_id = %L order by created_at desc', v_creator_org)),
    ('b0', 'creator, link to the client company (ReferenceRequestForm.tsx:188, both; undone)', 'S9', 'authenticated', v_creator,
     format('update public.reference_requests set client_organization_id = %L::uuid where id = %L', v_client_org, v_req)),
    ('b0', 'creator, its recipients (their policy reads reference_requests.id, created_by)', 'S10', 'authenticated', v_creator,
     'select 1 from public.reference_recipients'),
    ('b0', 'creator, its events (same)', 'S11', 'authenticated', v_creator, 'select 1 from public.reference_events'),
    ('b0', 'service role, send-reference-email select(*) (index.ts main :167, refonte :484)', 'S12', 'service_role', null,
     format('select * from public.reference_requests where id = %L', v_req));

  -- Before the migration: the hole
  v_k := 'B1 today visitors and signed-in accounts read the signer e-mail and the verification code (the hole)';
  insert into _dr_case (phase, k, label, role, sub, q, want) values
    ('b', v_k, 'anon e-mail', 'anon', null, 'select confirmed_signer_email from public.reference_requests', 'ok:' || v_n_conf::text),
    ('b', v_k, 'anon code', 'anon', null, 'select verification_code from public.reference_requests', 'ok:' || v_n_conf::text),
    ('b', v_k, 'signed-in e-mail', 'authenticated', v_str, 'select confirmed_signer_email from public.reference_requests', 'ok:' || v_n_conf::text),
    ('b', v_k, 'signed-in code', 'authenticated', v_str, 'select verification_code from public.reference_requests', 'ok:' || v_n_conf::text);

  -- After the migration (the S1-S12 comparisons are added in part C)
  v_k := 'C05 visitors (anon) no longer read the two columns, nor select *, nor a column outside their 8';
  insert into _dr_case (phase, k, label, role, sub, q, want) values
    ('c', v_k, 'e-mail', 'anon', null, 'select confirmed_signer_email from public.reference_requests', '42501'),
    ('c', v_k, 'code', 'anon', null, 'select verification_code from public.reference_requests', '42501'),
    ('c', v_k, 'select *', 'anon', null, 'select * from public.reference_requests', '42501'),
    ('c', v_k, 'id', 'anon', null, 'select id from public.reference_requests', '42501');
  v_k := 'C06 signed-in accounts no longer read the two columns (staff included: no admin page reads them)';
  insert into _dr_case (phase, k, label, role, sub, q, want) values
    ('c', v_k, 'no-company account e-mail', 'authenticated', v_str, 'select confirmed_signer_email from public.reference_requests', '42501'),
    ('c', v_k, 'creator code', 'authenticated', v_creator,
     format('select verification_code from public.reference_requests where partner_organization_id = %L', v_creator_org), '42501'),
    ('c', v_k, 'creator e-mail', 'authenticated', v_creator,
     format('select confirmed_signer_email from public.reference_requests where partner_organization_id = %L', v_creator_org), '42501'),
    ('c', v_k, 'creator select *', 'authenticated', v_creator, 'select * from public.reference_requests', '42501'),
    ('c', v_k, 'moderator e-mail', 'authenticated', v_mod, 'select confirmed_signer_email from public.reference_requests', '42501');
  v_k := 'C07 the service role still reads both columns (send-reference-email)';
  insert into _dr_case (phase, k, label, role, sub, q, want) values
    ('c', v_k, 'service role', 'service_role', null, 'select confirmed_signer_email, verification_code from public.reference_requests',
     'ok:' || v_n_total::text);

  -- After the down (E3, the S1-S12 comparisons, is added in part E)
  v_k := 'E2 after the down, visitors and signed-in accounts read the e-mail again (previous state)';
  insert into _dr_case (phase, k, label, role, sub, q, want) values
    ('e', v_k, 'anon', 'anon', null, 'select confirmed_signer_email from public.reference_requests', 'ok:' || v_n_conf::text),
    ('e', v_k, 'signed-in', 'authenticated', v_str, 'select confirmed_signer_email from public.reference_requests', 'ok:' || v_n_conf::text);
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
-- Hole 1 of 3 of the go-live runbook (P2.4, Q8 = a), 21 Oct 2026: visitors AND signed-in
-- accounts read the signer's e-mail and the verification code of every confirmed recommendation.
-- Down: supabase/migrations/down/20261021120000_reference_requests_hide_signer_columns.down.sql
-- Dry run: supabase/dryrun/20261021120000_reference_requests_hide_signer_columns.dryrun.sql
-- (runs this file, every client read of the table as its real role, then the down, in one
-- rolled-back transaction).
--
-- The policy reference_requests_public_select_confirmed lets {anon, authenticated} read every
-- confirmed row, and both roles hold table-level SELECT, so both read confirmed_signer_email and
-- verification_code. This file swaps the table-level SELECT of these two roles for column grants:
--   - anon: the 8 columns the company page reads signed out: client_legal_name, client_country,
--     project_name, confirmed_signer_name, confirmed_signer_title, confirmed_at, and its two
--     filter columns partner_organization_id and status;
--   - authenticated: every column except confirmed_signer_email and verification_code.
-- Client reads, grepped on 21 Oct (main 2a332cf8, refonte 02559e58): each one names its columns,
-- none reads the two columns, none uses select('*'):
--   main:    AdminUserDetail.tsx:193, AdminUsers.tsx:136, InboxTab.tsx:127,
--            ReferenceRequestForm.tsx:52 (and its update at :188, WHERE id),
--            AccountPage.tsx:543 and :705 (count of id), OrganizationPublicPage.tsx:384;
--   refonte: AdminUserDetail.tsx:206, AdminUsers.tsx:155, useDashboardData.ts:222,
--            ReferenceRequestForm.tsx:52 (and :188), OrganizationPublicPage.tsx:548.
--   The /reference/confirm and /reference/reject pages only call the RPCs below.
-- Unchanged: the RLS policies; the other table privileges of anon and authenticated; the service
-- role (send-reference-email reads select('*') with it); the writes, which go through
-- create_reference_request, confirm_reference_by_token and reject_reference_by_token, all
-- SECURITY DEFINER (their owner keeps every privilege).
-- Later columns: a column added to this table is NOT readable by authenticated or anon until it
-- is granted (there is no table-level SELECT any more).
-- Side effect, no client concerned: the trigger validate_recipient_domain (SECURITY INVOKER,
-- "select *" from this table) now stops a signed-in account's direct insert into
-- reference_recipients with 42501. Recipients are only inserted by send-reference-email (service
-- role).

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
declare
  v_cols text;
begin
  select string_agg(a.attname::text, ',' order by a.attnum) into v_cols
    from pg_attribute a
   where a.attrelid = 'public.reference_requests'::regclass and a.attnum > 0 and not a.attisdropped;
  if v_cols is distinct from 'id,reference_id,verification_code,partner_organization_id,created_by,'
       || 'client_organization_id,client_legal_name,client_country,client_website,client_primary_domain,'
       || 'project_name,project_location,project_start_date,project_end_date,project_delivery_date,'
       || 'contract_reference,solution_product,scope_description,results_summary,key_kpis,'
       || 'recommendation_statement,status,confirmed_signer_name,confirmed_signer_title,'
       || 'confirmed_signer_email,confirmed_at,expires_at,created_at,updated_at' then
    raise exception 'reference_requests: the columns changed since this file was written: %', v_cols;
  end if;
  if exists (select 1 from pg_attribute a
              where a.attrelid = 'public.reference_requests'::regclass and a.attnum > 0 and a.attacl is not null) then
    raise exception 'reference_requests: column grants exist already (applied twice?)';
  end if;
  if not (has_table_privilege('anon', 'public.reference_requests', 'select')
          and has_table_privilege('authenticated', 'public.reference_requests', 'select')) then
    raise exception 'reference_requests: anon or authenticated has no table-level SELECT (applied already?)';
  end if;
  if (select count(*) from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname in ('create_reference_request', 'confirm_reference_by_token', 'reject_reference_by_token')
         and p.prosecdef) <> 3 then
    raise exception 'reference_requests: a write function is missing, doubled or no longer SECURITY DEFINER';
  end if;
end
$pre$;

revoke select on table public.reference_requests from anon, authenticated;

grant select (client_legal_name, client_country, project_name, confirmed_signer_name, confirmed_signer_title,
              confirmed_at, partner_organization_id, status)
  on table public.reference_requests to anon;

grant select (id, reference_id, partner_organization_id, created_by, client_organization_id, client_legal_name,
              client_country, client_website, client_primary_domain, project_name, project_location,
              project_start_date, project_end_date, project_delivery_date, contract_reference, solution_product,
              scope_description, results_summary, key_kpis, recommendation_statement, status,
              confirmed_signer_name, confirmed_signer_title, confirmed_at, expires_at, created_at, updated_at)
  on table public.reference_requests to authenticated;

do $post$
begin
  if has_column_privilege('anon', 'public.reference_requests', 'confirmed_signer_email', 'select')
     or has_column_privilege('anon', 'public.reference_requests', 'verification_code', 'select')
     or has_column_privilege('authenticated', 'public.reference_requests', 'confirmed_signer_email', 'select')
     or has_column_privilege('authenticated', 'public.reference_requests', 'verification_code', 'select') then
    raise exception 'reference_requests: the two columns are still readable (a grant through another role?)';
  end if;
end
$post$;

-- C. Checks after the migration
do $c$
declare
  v_privs_anon text;
  v_privs_auth text;
  v_req uuid;
  v_creator uuid;
  v_q_rcpt text;
  v_k text;
begin
  select f.t into v_privs_anon from _dr_fx f where f.k = 'privs_anon';
  select f.t into v_privs_auth from _dr_fx f where f.k = 'privs_auth';
  select f.u into v_req from _dr_fx f where f.k = 'req';
  select f.u into v_creator from _dr_fx f where f.k = 'creator';

  insert into _dr_res (ok, label) values (
    strpos(v_privs_anon, 'select') > 0 and strpos(v_privs_auth, 'select') > 0
      and coalesce(pg_temp._dr_privs('anon'), '') = array_to_string(array_remove(string_to_array(v_privs_anon, ','), 'select'), ',')
      and coalesce(pg_temp._dr_privs('authenticated'), '') = array_to_string(array_remove(string_to_array(v_privs_auth, ','), 'select'), ',')
      and has_table_privilege('service_role', 'public.reference_requests', 'select'),
    format('C01 table-level SELECT gone for anon and authenticated, their other table privileges unchanged, service_role keeps it '
           || '(anon %s -> %s; authenticated %s -> %s)',
           v_privs_anon, coalesce(pg_temp._dr_privs('anon'), 'none'), v_privs_auth, coalesce(pg_temp._dr_privs('authenticated'), 'none')));

  insert into _dr_res (ok, label) values (
    pg_temp._dr_cols('anon') = (select string_agg(x.c, ',' order by x.c collate "C")
                                  from unnest(array['client_legal_name', 'client_country', 'project_name', 'confirmed_signer_name',
                                                    'confirmed_signer_title', 'confirmed_at', 'partner_organization_id', 'status']) as x(c)),
    'C02 anon reads exactly these 8 columns: ' || coalesce(pg_temp._dr_cols('anon'), 'none'));

  insert into _dr_res (ok, label) values (
    pg_temp._dr_cols('authenticated') = (select string_agg(a.attname::text, ',' order by a.attname::text collate "C")
                                           from pg_attribute a
                                          where a.attrelid = 'public.reference_requests'::regclass and a.attnum > 0 and not a.attisdropped
                                            and a.attname not in ('confirmed_signer_email', 'verification_code'))
      and (select count(*) from pg_attribute a
            where a.attrelid = 'public.reference_requests'::regclass and a.attnum > 0 and not a.attisdropped
              and has_column_privilege('authenticated', a.attrelid, a.attnum, 'select')) = 27,
    format('C03 authenticated reads the %s other columns, not confirmed_signer_email nor verification_code',
           (select count(*) from pg_attribute a
             where a.attrelid = 'public.reference_requests'::regclass and a.attnum > 0 and not a.attisdropped
               and has_column_privilege('authenticated', a.attrelid, a.attnum, 'select'))));

  insert into _dr_res (ok, label) values (
    (select count(*) from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname in ('create_reference_request', 'confirm_reference_by_token', 'reject_reference_by_token')
        and p.prosecdef
        and has_column_privilege(p.proowner, 'public.reference_requests'::regclass, 'verification_code', 'select')
        and has_column_privilege(p.proowner, 'public.reference_requests'::regclass, 'confirmed_signer_email', 'update')) = 3,
    'C04 create_reference_request, confirm_reference_by_token, reject_reference_by_token: SECURITY DEFINER, their owner still reads and writes every column');

  -- C08-C19: each client read (S1-S12) returns after the migration what it returned before
  insert into _dr_case (phase, k, label, role, sub, q, want)
  select 'c', 'C' || lpad((7 + substr(b.label, 2)::int)::text, 2, '0') || ' ' || b.k,
         'before ' || coalesce(b.got, 'not run') || ', after', b.role, b.sub, b.q,
         case when b.got is null or b.got not like 'ok:%' or (b.label in ('S1', 'S3') and b.got = 'ok:0')
              then 'ok:(before: ' || coalesce(b.got, 'not run') || ')'
              else b.got end
    from _dr_case b
   where b.phase = 'b0'
   order by b.n;

  -- C20: the recipients trigger (no client inserts recipients directly)
  v_q_rcpt := format('insert into public.reference_recipients (reference_request_id, email, confirm_token_hash) values (%L, %L, %L)',
                     v_req, 'dr@dryrun.invalid', 'dryrun');
  v_k := 'C20 recipients: a signed-in direct insert now stops at validate_recipient_domain''s select * (no client does it); '
         || 'the service-role path (send-reference-email) still reaches the domain check';
  insert into _dr_case (phase, k, label, role, sub, q, want) values
    ('c', v_k, 'creator', 'authenticated', v_creator, v_q_rcpt, '42501'),
    ('c', v_k, 'service role (test address refused by the domain check)', 'service_role', null, v_q_rcpt, 'P0001');

  perform pg_temp._dr_run('c');
  perform pg_temp._dr_check('c');
end
$c$;

-- D. The down, verbatim
-- DOWN for supabase/migrations/20261021120000_reference_requests_hide_signer_columns.sql
-- Gives anon and authenticated their table-level SELECT back and drops their column grants:
-- visitors and signed-in accounts read confirmed_signer_email and verification_code again.
-- Harmless for main and refonte (both read named columns only).

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if has_table_privilege('anon', 'public.reference_requests', 'select')
     or has_table_privilege('authenticated', 'public.reference_requests', 'select') then
    raise exception 'reference_requests down: anon or authenticated already holds table-level SELECT (nothing to undo)';
  end if;
end
$pre$;

-- A table-level REVOKE also removes these roles' column grants.
revoke select on table public.reference_requests from anon, authenticated;
grant select on table public.reference_requests to anon, authenticated;

-- E. Checks after the down, then the report (rolls everything back)
do $e$
declare
  v_txt text;
begin
  insert into _dr_res (ok, label) values (
    (select array_to_string(array(select x::text from unnest(c.relacl) as x order by 1), ',')
       from pg_class c where c.oid = 'public.reference_requests'::regclass) = (select f.t from _dr_fx f where f.k = 'acl')
      and not exists (select 1 from pg_attribute a
                       where a.attrelid = 'public.reference_requests'::regclass and a.attnum > 0 and a.attacl is not null),
    'E1 after the down, the table ACL is the snapshot again and no column grant is left');

  -- E3: each client read (S1-S12) returns after the down what it returned before
  insert into _dr_case (phase, k, label, role, sub, q, want)
  select 'e', 'E3 after the down, every client read (S1-S12) returns what it returned before', b.label, b.role, b.sub, b.q,
         case when b.got is null or b.got not like 'ok:%' then 'ok:(before: ' || coalesce(b.got, 'not run') || ')' else b.got end
    from _dr_case b
   where b.phase = 'b0'
   order by b.n;

  perform pg_temp._dr_run('e');
  perform pg_temp._dr_check('e');

  select string_agg(case when r.ok then 'PASS ' else 'FAIL ' end || r.label, chr(10) order by r.n) into v_txt from _dr_res r;
  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (reference_requests_hide_signer_columns, run %s)',
    (select count(*) from _dr_res where ok), (select count(*) from _dr_res where ok is not true), now()) || chr(10) || v_txt;
end
$e$;
