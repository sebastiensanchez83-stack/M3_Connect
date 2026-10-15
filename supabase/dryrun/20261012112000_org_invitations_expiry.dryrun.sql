-- DRY RUN of supabase/migrations/20261012112000_org_invitations_expiry.sql. NOT A MIGRATION.
-- ONE query text, ONE execute_sql call, after 20261009210000_registration_core. Harness of the
-- signup_identity_orgs dry runs: snapshot, the migration verbatim, helpers, then checks and
-- cases, each case in its own sub-transaction (setup as postgres, the statement as the
-- caller, chk as postgres). Test people and companies per case (example.invalid, random ids).
-- X03 compares SM26, gl_guest, invitations (a pending one past its expiry read as expired),
-- companies, members, profiles, policies and ACLs before/after. Ends with RAISE EXCEPTION
-- 'DRYRUN ...'; everything rolls back. Expected: "8 PASS, 0 FAIL".

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ─── A. Snapshot (read again after the migration: must be identical) ─────────
-- A pending invitation past its expiry is read as 'expired' (part 1 sets it so).
create function pg_temp.dr_snap() returns table (k text, v text) language sql as $f$
  select 'acl ' || p.oid::regprocedure::text, coalesce(p.proacl::text, '') || ' ' || pg_get_userbyid(p.proowner)
    from pg_proc p
   where p.oid in ('public.accept_org_invitation(uuid)'::regprocedure, 'public.claim_organization(text)'::regprocedure,
                   'public.claim_organization_for_user(uuid,text)'::regprocedure, 'public.reject_join_request(uuid)'::regprocedure,
                   'public.approve_join_request(uuid)'::regprocedure, 'public.check_pending_invitation(text)'::regprocedure, 'public.handle_new_user()'::regprocedure,
                   'public.complete_signup_for(uuid)'::regprocedure, 'public.request_org_join(uuid)'::regprocedure,
                   'public.create_organization(text,text,text,text,text,text,text)'::regprocedure)
  union all select 'sm26', md5(concat_ws('|',
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_registration x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_role_assignment x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_attendee x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_badge x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_payment x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_invoice x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_networking_pass x)))
  union all select 'gl_guest', (select md5(coalesce(string_agg(g.id::text || g.token::text || g.status, ',' order by g.id), '')) from public.gl_guest g)
  union all select 'invitations', (select md5(coalesce(string_agg(i.id::text || case when i.status = 'pending' and i.expires_at < now() then 'expired' else i.status end || i.email || i.expires_at::text, ',' order by i.id), '')) from public.organization_invitations i)
  union all select 'orgs', (select md5(coalesce(string_agg(o.id::text || o.name || coalesce(o.access_status, '') || coalesce(o.owner_user_id::text, ''), ',' order by o.id), '')) from public.organizations o)
  union all select 'members', (select md5(coalesce(string_agg(m.id::text || m.user_id::text || m.role, ',' order by m.id), '')) from public.organization_members m)
  union all select 'profiles', (select md5(coalesce(string_agg(pr.user_id::text || pr.access_status::text || pr.onboarding_status::text || pr.persona::text || pr.updated_at::text, ',' order by pr.user_id), '')) from public.profiles pr)
  union all select 'other_policies', (select md5(string_agg(format('%s|%s|%s|%s|%s', pl.tablename, pl.policyname, pl.cmd, pl.qual, pl.with_check), ';' order by pl.tablename, pl.policyname))
                                        from pg_policies pl where pl.schemaname = 'public'
                                         and pl.tablename in ('organization_invitations', 'organization_members', 'profiles', 'organizations')
                                         and pl.policyname <> 'owners_can_create_invitations')
$f$;
create temp table _dr_before on commit drop as select * from pg_temp.dr_snap();

-- ─── B. The migration, verbatim ───────────────────────────────────────────────
-- Team invitations expire on the live site too (Phase 2 DB lane, fixer pass 15 Oct 2026).
-- NOT APPLIED. Apply after 20261009210000_registration_core and BEFORE
-- 20261012113000_signup_identity_orgs (which checks for it): that file makes
-- accept_org_invitation refuse an invitation past its expires_at, and both onboarding pages
-- (main's and the redesign's OnboardingPage) offer a pending invitation with a single
-- Accept button: a stored invitation id read with status 'pending' (priority 1), or
-- check_pending_invitation (priority 2). Offered an expired invitation, the person could
-- neither accept it nor go on to create or join a company.
-- Down: supabase/migrations/down/20261012112000_org_invitations_expiry.down.sql (refused while
-- part 1 is applied). Dry run: supabase/dryrun/20261012112000_org_invitations_expiry.dryrun.sql.
--  1. A pending invitation past expires_at becomes 'expired' (a status of today's CHECK),
--     now and every 5 minutes (pg_cron 'org-invitations-expire'; integration review of
--     15 Oct 2026: hourly left the old site's onboarding offering an Accept button that fails
--     for up to an hour). The old /join/<id> page then shows "no longer valid"
--     (get_invitation_for_join returns the status).
--     On 15 Oct 2026: 1 row (the only pending invitation, 18 May, expired 17 Jun).
--  2. check_pending_invitation leaves out an invitation past its expiry.
--  3. approve_join_request never turns a suspended account into a verified one (as
--     accept_org_invitation in part 1): join requests are filed by complete_signup_for too.

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $pre$
declare
  v_md5 text;
  v_row record;
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise exception 'org_invitations_expiry: pg_cron (cron.schedule) is missing';
  end if;
  for v_row in
    select * from (values
      ('public.check_pending_invitation(text)', 'c384e225cd6336fdeff22952526d2e65', '870eeb3c5741c0e5d2eb001991529509'),
      ('public.approve_join_request(uuid)', '6fb0ce33247218c832d738c97bb59f2d', 'ac9d150a92163841e383c7e80a5028b2')
    ) as x(sig, prod, mine)
  loop
    select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p where p.oid = to_regprocedure(v_row.sig);
    if v_md5 is distinct from v_row.prod and v_md5 is distinct from v_row.mine then
      raise exception 'org_invitations_expiry: % changed (md5 %); rebuild this migration from pg_get_functiondef', v_row.sig, v_md5;
    end if;
  end loop;
end
$pre$;

-- ---- 1. Expired invitations ------------------------------------------------------
do $expire$
declare
  v_n integer;
begin
  update public.organization_invitations set status = 'expired' where status = 'pending' and expires_at < now();
  get diagnostics v_n = row_count;
  raise notice 'org_invitations_expiry: % pending invitation(s) past their expiry set to expired', v_n;
end
$expire$;
-- cron.schedule with an existing name updates that job (pg_cron 1.6.4). GMT.
select cron.schedule('org-invitations-expire', '*/5 * * * *',
  $cmd$update public.organization_invitations set status = 'expired' where status = 'pending' and expires_at < now()$cmd$);

-- ---- 2. check_pending_invitation, 3. approve_join_request -------------------------
-- Production body (md5 c384e225...) plus the expiry (marked 12 Oct 2026): what main's and
-- the redesign's onboarding offer with an Accept button. Signature, owner, ACL unchanged.
CREATE OR REPLACE FUNCTION public.check_pending_invitation(p_email text)
 RETURNS TABLE(invitation_id uuid, organization_id uuid, organization_name text, invited_by_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email text;
begin
  -- p_email is ignored on purpose: the only address anyone may look up is their
  -- own, verified sign-in address. The parameter stays for existing callers.
  if auth.uid() is null then
    raise exception 'Not authorized';
  end if;
  select u.email into v_email from auth.users u
   where u.id = auth.uid() and u.email_confirmed_at is not null;
  if btrim(coalesce(v_email, '')) = '' then
    return;
  end if;
  return query
    select oi.id, oi.organization_id, o.name,
           coalesce(p.first_name || ' ' || p.last_name, 'Unknown')
    from organization_invitations oi
    join organizations o on o.id = oi.organization_id
    left join profiles p on p.user_id = oi.invited_by_user_id
    where lower(oi.email) = lower(v_email) and oi.status = 'pending'
      -- 12 Oct 2026: never an invitation past its expiry (accept_org_invitation refuses it).
      and oi.expires_at >= now();
end;
$function$;

-- Production body (md5 6fb0ce33..., 20261011083257) plus "never un-suspend" (marked
-- 12 Oct 2026): complete_signup_for now files join requests too, and a person suspended
-- after requesting must stay suspended when the owner approves.
CREATE OR REPLACE FUNCTION public.approve_join_request(p_invitation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invitation   RECORD;
  v_org_verified BOOLEAN;
  v_requester_id UUID;
BEGIN
  SELECT oi.id, oi.organization_id, oi.email, oi.status, oi.invited_by_user_id
    INTO v_invitation FROM organization_invitations oi WHERE oi.id = p_invitation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Join request not found'; END IF;
  IF v_invitation.status <> 'join_requested' THEN
    RAISE EXCEPTION 'This request is not in join_requested status (current: %)', v_invitation.status;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM organization_members om
     WHERE om.organization_id = v_invitation.organization_id
       AND om.user_id = auth.uid() AND om.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Only the organization owner can approve join requests';
  END IF;

  -- 10 Oct 2026: a join request is filed by the requester themself (request_org_join
  -- leaves invited_by_user_id NULL). A row an owner wrote is an invitation: only the
  -- invited person can accept it (accept_org_invitation).
  IF v_invitation.invited_by_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'This is an invitation, not a join request: only the invited person can accept it';
  END IF;

  -- Only an account whose address is confirmed can be the requester.
  SELECT u.id INTO v_requester_id FROM auth.users u
   WHERE lower(u.email) = lower(v_invitation.email)
     AND u.email_confirmed_at IS NOT NULL;
  IF v_requester_id IS NULL THEN RAISE EXCEPTION 'Requesting user account not found'; END IF;

  UPDATE organization_invitations SET status='accepted', updated_at=now() WHERE id = p_invitation_id;
  INSERT INTO organization_members (user_id, organization_id, role)
  VALUES (v_requester_id, v_invitation.organization_id, 'collaborator')
  ON CONFLICT DO NOTHING;

  SELECT (o.access_status = 'verified') INTO v_org_verified
    FROM organizations o WHERE o.id = v_invitation.organization_id;

  IF v_org_verified THEN
    -- 12 Oct 2026: a suspended account stays suspended.
    UPDATE profiles SET access_status='verified', onboarding_status='completed', updated_at=now()
     WHERE user_id = v_requester_id AND access_status <> 'suspended';
  ELSE
    UPDATE profiles SET onboarding_status='submitted', updated_at=now()
     WHERE user_id = v_requester_id AND access_status <> 'verified';
  END IF;
END;
$function$;

-- ─── C. Test helpers (temporary, gone with the rollback) ─────────────────────
create function pg_temp.dr_user(p_id uuid, p_email text, p_meta jsonb, p_proven boolean, p_status text)
returns void language plpgsql as $f$
begin
  insert into auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
  values (p_id, p_email, 'authenticated', 'authenticated', p_meta, now(), now(), now());
  update public.profiles set email_proven_at = case when p_proven then now() end,
         access_status = p_status::public.access_status_enum
   where user_id = p_id;
end
$f$;
create function pg_temp.dr_org(p_id uuid, p_name text, p_status text, p_owner uuid, p_code text)
returns void language plpgsql as $f$
begin
  insert into public.organizations (id, name, slug, access_status, organization_type, owner_user_id, created_by_user_id, claim_code)
  values (p_id, p_name, 'dryrun-' || p_id, p_status, 'marina', p_owner, p_owner, p_code);
  if p_owner is not null then
    insert into public.organization_members (organization_id, user_id, role) values (p_id, p_owner, 'owner');
  end if;
end
$f$;
create function pg_temp.dr_person(p_id uuid, p_email text, p_intent jsonb, p_proven boolean, p_status text)
returns void language sql as $f$
  select pg_temp.dr_user(p_id, p_email, jsonb_build_object('first_name', 'Pat', 'last_name', 'Doe', 'signup_intent', p_intent), p_proven, p_status)
$f$;
-- runs a pg_cron job's command now (as postgres); the number of rows it wrote
create function pg_temp.dr_cron(p_name text) returns bigint language plpgsql as $f$
declare
  v_n bigint;
begin
  execute (select j.command from cron.job j where j.jobname = p_name);
  get diagnostics v_n = row_count;
  return v_n;
end
$f$;

-- ─── D. Checks and cases ──────────────────────────────────────────────────────
do $dryrun$
declare
  tests jsonb := '[]'::jsonb;
  t jsonb;
  kv record;
  vars jsonb;
  s0 text;
  v_q text; v_setup text; v_chkq text; v_exp text;
  v_uid uuid; v_claims jsonb; v_dml boolean; v_ret text; v_n bigint;
  v_err text; v_state text; v_chk boolean; v_pass boolean;
  n_pass integer := 0; n_fail integer := 0;
  results text := '';
  r8 text := substr(md5(random()::text), 1, 8);
begin
  vars := jsonb_build_object(
    'owner', gen_random_uuid(), 'inv', gen_random_uuid(), 'other', gen_random_uuid(),
    'e_owner', 'dryrun-owner-' || r8 || '@example.invalid', 'e_inv', 'dryrun-inv-' || r8 || '@example.invalid',
    'e_other', 'dryrun-other-' || r8 || '@example.invalid',
    'org_v', gen_random_uuid(), 'org_n', gen_random_uuid(), 'org_p', gen_random_uuid(), 'org_r', gen_random_uuid(),
    'code_v', 'DRYV' || upper(r8), 'code_n', 'DRYN' || upper(r8),
    'inv_p', gen_random_uuid(), 'inv_j', gen_random_uuid());
  s0 := $s$select pg_temp.dr_user({owner}, {e_owner}, '{}', true, 'verified');
select pg_temp.dr_user({inv}, {e_inv}, '{}', false, 'pending');
select pg_temp.dr_user({other}, {e_other}, '{}', false, 'pending');
select pg_temp.dr_org({org_v}, 'Dryrun Zebramarina S.A.R.L.', 'verified', {owner}, {code_v});
select pg_temp.dr_org({org_n}, 'Dryrun Ownerless Yard', 'verified', null, {code_n});
select pg_temp.dr_org({org_p}, 'Dryrun Pending Docks', 'pending', null, null)$s$;

  tests := jsonb_build_array(
    jsonb_build_object('id', 'X01', 'who', 'postgres', 'bare', true, 'expect', 'ret:true', 'label', 'check_pending_invitation and approve_join_request carry this file''s bodies',
      'q', $q$select count(*) = 2 and bool_and(md5(replace(p.prosrc, chr(13), '')) = x.m) from (values ('public.check_pending_invitation(text)', '870eeb3c5741c0e5d2eb001991529509'), ('public.approve_join_request(uuid)', 'ac9d150a92163841e383c7e80a5028b2')) x(s, m) join pg_proc p on p.oid = to_regprocedure(x.s)$q$),
    jsonb_build_object('id', 'X02', 'who', 'postgres', 'bare', true, 'expect', 'ret:true', 'label', 'no pending invitation past its expiry is left; job org-invitations-expire scheduled every 5 minutes',
      'q', $q$select not exists (select 1 from public.organization_invitations where status = 'pending' and expires_at < now()) and exists (select 1 from cron.job j where j.jobname = 'org-invitations-expire' and j.schedule = '*/5 * * * *' and j.active and j.command like '%set status = ''expired'' where status = ''pending'' and expires_at < now()%')$q$),
    jsonb_build_object('id', 'X04', 'who', 'inv', 'expect', 'ret:<inv_j>', 'label', 'check_pending_invitation (both onboarding pages) leaves out an invitation past its expiry',
      'setup', $s$insert into public.organization_invitations (id, organization_id, email, invited_by_user_id, expires_at, created_at) values ({inv_p}, {org_v}, {e_inv}, {owner}, now() - interval '1 day', now() - interval '31 days'); insert into public.organization_invitations (id, organization_id, email, invited_by_user_id) values ({inv_j}, {org_n}, {e_inv}, {owner})$s$,
      'q', $q$select string_agg(invitation_id::text, ',') from public.check_pending_invitation('ignored@example.invalid')$q$),
    jsonb_build_object('id', 'X05', 'who', 'postgres', 'expect', 'ret:1', 'label', 'the job sets an invitation past its expiry to expired, a valid one stays pending',
      'setup', $s$insert into public.organization_invitations (id, organization_id, email, invited_by_user_id, expires_at, created_at) values ({inv_p}, {org_v}, {e_inv}, {owner}, now() - interval '1 minute', now() - interval '30 days'); insert into public.organization_invitations (id, organization_id, email, invited_by_user_id) values ({inv_j}, {org_v}, {e_other}, {owner})$s$,
      'q', $q$select pg_temp.dr_cron('org-invitations-expire')::text$q$,
      'chk', $c$select (select status = 'expired' from public.organization_invitations where id = {inv_p}) and (select status = 'pending' from public.organization_invitations where id = {inv_j})$c$),
    jsonb_build_object('id', 'X06', 'who', 'owner', 'expect', 'allow', 'label', 'approve_join_request: a suspended requester joins but stays suspended',
      'setup', $s$insert into public.organization_invitations (id, organization_id, email, status) values ({inv_j}, {org_v}, {e_other}, 'join_requested'); update public.profiles set access_status = 'suspended' where user_id = {other}$s$,
      'q', $q$select public.approve_join_request({inv_j})$q$,
      'chk', $c$select (select access_status::text = 'suspended' from public.profiles where user_id = {other}) and exists (select 1 from public.organization_members where organization_id = {org_v} and user_id = {other} and role = 'collaborator')$c$),
    jsonb_build_object('id', 'X07', 'who', 'owner', 'expect', 'allow', 'label', 'approve_join_request unchanged otherwise: collaborator, verified with the company',
      'setup', $s$insert into public.organization_invitations (id, organization_id, email, status) values ({inv_j}, {org_v}, {e_other}, 'join_requested')$s$,
      'q', $q$select public.approve_join_request({inv_j})$q$,
      'chk', $c$select (select access_status::text = 'verified' and onboarding_status::text = 'completed' from public.profiles where user_id = {other}) and (select status = 'accepted' from public.organization_invitations where id = {inv_j})$c$)
    ,
    jsonb_build_object('id', 'X03', 'who', 'postgres', 'bare', true, 'expect', 'ret:true', 'label', 'unchanged: SM26, gl_guest tokens, invitations (expired ones read as expired), companies, members, profiles, policies, ACLs and owners',
      'q', $q$select count(*) = (select count(*) from _dr_before) and bool_and(b.v = a.v) from _dr_before b join pg_temp.dr_snap() a on a.k = b.k$q$),
    jsonb_build_object('id', 'X08', 'who', 'other', 'expect', 'err:Only the organization owner', 'label', 'approve_join_request: still the owner only',
      'setup', $s$insert into public.organization_invitations (id, organization_id, email, status) values ({inv_j}, {org_v}, {e_inv}, 'join_requested')$s$,
      'q', $q$select public.approve_join_request({inv_j})::text$q$)
  );

  -- ── Runner ── each case: common setup s0 (unless bare), its setup (postgres), the
  -- statement as the caller, chk (postgres), then rolled back. {name} in SQL = the
  -- quoted value of vars.name; <name> in an expectation = its raw value.
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
      if btrim(v_setup, ' ;') <> '' then execute v_setup; end if;
      perform set_config('request.jwt.claim.sub', '', true);
      if t ->> 'who' = 'postgres' then
        perform set_config('request.jwt.claims', '', true);
      elsif t ->> 'who' = 'anon' then
        perform set_config('request.jwt.claims', '{"role": "anon"}', true);
        set local role anon;
      elsif t ->> 'who' = 'service' then
        perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
        set local role service_role;
      else
        v_uid := (vars ->> (t ->> 'who'))::uuid;
        v_claims := jsonb_build_object('sub', v_uid, 'role', 'authenticated',
                                       'email', (select u.email from auth.users u where u.id = v_uid))
                    || coalesce(t -> 'claims', '{}'::jsonb);
        perform set_config('request.jwt.claims', v_claims::text, true);
        set local role authenticated;
      end if;
      if v_dml then
        execute v_q;
        get diagnostics v_n = row_count;
      else
        execute v_q into v_ret;
      end if;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      if v_chkq <> '' then execute v_chkq into v_chk; end if;
      raise exception using errcode = 'DRY01', message = 'case finished';
    exception
      when sqlstate 'DRY01' then null;
      when others then v_err := sqlerrm; v_state := sqlstate;
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
                else 'returned ' || coalesce(v_ret, 'null') end, 200),
      case when v_chkq <> '' then ' | chk ' || coalesce(v_chk::text, 'null') else '' end);
  end loop;

  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (org_invitations_expiry, run %s)', n_pass, n_fail, now()) || results;
end
$dryrun$;
