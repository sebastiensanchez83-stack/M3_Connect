-- DRY RUN of the DOWN of supabase/migrations/20261012112000_org_invitations_expiry.sql. NOT A
-- MIGRATION. ONE query text, ONE execute_sql call, after 20261009210000_registration_core and
-- BEFORE 20261012113000_signup_identity_orgs (the down refuses to run while part 1 is
-- applied). Snapshot, the migration verbatim, the down verbatim, then checks that production
-- is back (bodies, cron job gone, expired invitations stay expired, snapshot). Ends with
-- RAISE EXCEPTION 'DRYRUN ...'; everything rolls back. Expected: "4 PASS, 0 FAIL".

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

-- ─── C. The DOWN, verbatim ────────────────────────────────────────────────────
-- DOWN for supabase/migrations/20261012112000_org_invitations_expiry.sql.
-- Refused while 20261012113000_signup_identity_orgs is applied (its accept_org_invitation
-- refuses expired invitations: the onboarding pages must not offer them again). Puts back
-- check_pending_invitation (production md5 c384e225...) and approve_join_request
-- (6fb0ce33...), and unschedules the pg_cron job 'org-invitations-expire'. Invitations set to
-- 'expired' stay so (a status of the CHECK before and after).

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $pre$
declare
  v_md5 text;
  v_row record;
begin
  if to_regprocedure('public.company_search(text,integer)') is not null then
    raise exception 'org_invitations_expiry DOWN: run the down of 20261012113000_signup_identity_orgs first';
  end if;
  for v_row in
    select * from (values
      ('public.check_pending_invitation(text)', 'c384e225cd6336fdeff22952526d2e65', '870eeb3c5741c0e5d2eb001991529509'),
      ('public.approve_join_request(uuid)', '6fb0ce33247218c832d738c97bb59f2d', 'ac9d150a92163841e383c7e80a5028b2')
    ) as x(sig, prod, mine)
  loop
    select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p where p.oid = to_regprocedure(v_row.sig);
    if v_md5 is distinct from v_row.prod and v_md5 is distinct from v_row.mine then
      raise exception 'org_invitations_expiry DOWN: % changed since the up migration (md5 %); restore it by hand', v_row.sig, v_md5;
    end if;
  end loop;
end
$pre$;

select cron.unschedule(j.jobid) from cron.job j where j.jobname = 'org-invitations-expire';

-- Production bodies (CREATE OR REPLACE keeps owner and ACL).
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
    where lower(oi.email) = lower(v_email) and oi.status = 'pending';
end;
$function$;

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
    UPDATE profiles SET access_status='verified', onboarding_status='completed', updated_at=now()
     WHERE user_id = v_requester_id;
  ELSE
    UPDATE profiles SET onboarding_status='submitted', updated_at=now()
     WHERE user_id = v_requester_id AND access_status <> 'verified';
  END IF;
END;
$function$;

-- ─── D. After the down ────────────────────────────────────────────────────────
do $after$
declare
  results text := '';
  n_pass integer := 0;
  n_fail integer := 0;
  v_c record;
  v_ok boolean;
  v_err text;
begin
  for v_c in select * from (values
    ('D01', 'check_pending_invitation and approve_join_request = production bodies',
     $q$select count(*) = 2 and bool_and(md5(replace(p.prosrc, chr(13), '')) = x.m) from (values ('public.check_pending_invitation(text)', 'c384e225cd6336fdeff22952526d2e65'), ('public.approve_join_request(uuid)', '6fb0ce33247218c832d738c97bb59f2d')) x(s, m) join pg_proc p on p.oid = to_regprocedure(x.s)$q$),
    ('D02', 'pg_cron job org-invitations-expire gone',
     $q$select not exists (select 1 from cron.job j where j.jobname = 'org-invitations-expire')$q$),
    ('D03', 'invitations set to expired stay expired (no pending invitation past its expiry)',
     $q$select not exists (select 1 from public.organization_invitations where status = 'pending' and expires_at < now())$q$),
    ('D04', 'snapshot = before (SM26, gl_guest, invitations, companies, members, profiles, policies, ACLs and owners)',
     $q$select count(*) = (select count(*) from _dr_before) and bool_and(b.v = a.v) from _dr_before b join pg_temp.dr_snap() a on a.k = b.k$q$)
  ) x(id, label, q)
  loop
    v_err := null;
    begin
      execute v_c.q into v_ok;
    exception when others then
      v_ok := false; v_err := sqlerrm;
    end;
    if coalesce(v_ok, false) then n_pass := n_pass + 1; else n_fail := n_fail + 1; end if;
    results := results || format(E'\n%s %s down: %s%s', case when coalesce(v_ok, false) then 'PASS' else 'FAIL' end,
                                 v_c.id, v_c.label, coalesce(' | error ' || v_err, ''));
  end loop;
  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (org_invitations_expiry DOWN, run %s)', n_pass, n_fail, now()) || results;
end
$after$;
