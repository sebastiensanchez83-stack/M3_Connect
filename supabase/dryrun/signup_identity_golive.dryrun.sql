-- DRY RUN of supabase/migrations/held/signup_identity_golive.sql and of its DOWN. NOT A
-- MIGRATION. ONE query text, ONE execute_sql call, after 20261012113000_signup_identity_orgs
-- and 20261012113500_signup_identity are applied. To let the held file's precondition pass,
-- this dry run switches the flags account_signup_v2 and front_door on and creates a stand-in
-- admin_validate_person when Phase 3 is not there yet: all of it rolls back with the rest
-- (it ends with RAISE EXCEPTION 'DRYRUN ...'). Then: the held file verbatim, cases, the down
-- verbatim, checks that the grants and request_org_join are back.
-- Expected: "13 PASS, 0 FAIL" (10 cases + 3 down checks).

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ─── A. Scaffolding (rolled back) ─────────────────────────────────────────────
update public.platform_settings set value = value || '{"account_signup_v2": true, "front_door": true}'::jsonb
 where key = 'registration_flags';
do $scaffold$
begin
  if not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'admin_validate_person') then
    execute 'create function public.admin_validate_person(uuid, jsonb) returns jsonb language sql as $f$ select null::jsonb $f$';
  end if;
end
$scaffold$;

-- ─── B. The held file, verbatim ───────────────────────────────────────────────
-- HELD for the go-live of the redesign: NOT a normal migration. Apply it only on the day
-- the redesign replaces the live main site, AFTER the flags account_signup_v2 and front_door
-- are on and Phase 3's admin_validate_person exists (all checked below), and after
-- 20261012113500_signup_identity. It breaks the OLD client on purpose:
--   1. create_organization: EXECUTE revoked from authenticated (spec §3.9). Companies are
--      created by M3 only (Phase 3 admin_validate_person). main's OnboardingPage and
--      OrganizationTab call it, and so does the redesign while account_signup_v2 is off.
--   2. claim_organization: EXECUTE revoked from authenticated, anon and PUBLIC (Victor,
--      11 Oct: M3 decides every claim; with a code, the new sign-up files a claim_requested
--      through complete_signup_for / submit_signup_intent). main's OnboardingPage calls it.
--      claim_organization_for_user stays (service role only).
--   3. request_org_join: files a join request only for an address the person PROVED
--      (spec §3.9); an open claim counts as an open request. main's OnboardingPage calls it.
--   4. accept_org_invitation: only for a PROVEN address (integration review, 15 Oct 2026).
--      Confirm email was off from May to go-live, so a confirmed address proves nothing, and
--      the policy invitees_can_view_own_invitation (current_user_email()) shows the
--      invitation id to anyone who signed up with the invitee's address. An unproven
--      invitee proves the address with the dashboard banner, or joins from the signed
--      /join/<token> link (accept-invite accept_existing: the link proves the inbox, a
--      PASSWORD session proves the account). main's OnboardingPage and /join/<id> call it.
--   5. approve_join_request: the requester must have PROVED the address too.
-- Before applying, check that the redesign's flag-on pages never call the first three
-- (grep src for create_organization, claim_organization and request_org_join).
-- Not here (decide separately): dropping trg_link_guest_registrations (contract §7 item 13),
-- revoking sm_autoclaim_by_email (contract §9).
-- Down: supabase/migrations/down/signup_identity_golive.down.sql.
-- Dry run: supabase/dryrun/signup_identity_golive.dryrun.sql.

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $pre$
declare
  v_flags jsonb;
  v_md5 text;
begin
  select ps.value into v_flags from public.platform_settings ps where ps.key = 'registration_flags';
  if (v_flags -> 'account_signup_v2') is distinct from 'true'::jsonb or (v_flags -> 'front_door') is distinct from 'true'::jsonb then
    raise exception 'signup_identity_golive: switch registration_flags account_signup_v2 and front_door on first (JSON true)';
  end if;
  if not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'admin_validate_person') then
    raise exception 'signup_identity_golive: Phase 3 admin_validate_person is missing; M3 would have no way to create a company';
  end if;
  if to_regprocedure('public.submit_signup_intent(jsonb)') is null then
    raise exception 'signup_identity_golive: apply 20261012113500_signup_identity first';
  end if;
  if to_regprocedure('public.create_organization(text,text,text,text,text,text,text)') is null
     or to_regprocedure('public.claim_organization(text)') is null then
    raise exception 'signup_identity_golive: create_organization or claim_organization changed signature; rebuild this file';
  end if;
  select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p where p.oid = to_regprocedure('public.request_org_join(uuid)');
  if v_md5 is distinct from '966803f30484c2bf363c925bd77f1f63' and v_md5 is distinct from '06ff2f219deb4b7cf7332bb61ea8a0a6' then
    raise exception 'signup_identity_golive: request_org_join changed (md5 %); rebuild this file', v_md5;
  end if;
  -- part 1's accept_org_invitation, the expiry file's approve_join_request (or this file's).
  select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p where p.oid = to_regprocedure('public.accept_org_invitation(uuid)');
  if v_md5 is distinct from 'd2931bc02461e4f80fdda4aefa29fd41' and v_md5 is distinct from 'ef758ac60b7753a04b9e3091c2bc56dc' then
    raise exception 'signup_identity_golive: accept_org_invitation changed (md5 %); rebuild this file', v_md5;
  end if;
  select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p where p.oid = to_regprocedure('public.approve_join_request(uuid)');
  if v_md5 is distinct from 'ac9d150a92163841e383c7e80a5028b2' and v_md5 is distinct from '8ae51462f91e269160978c2f6f6c1dd6' then
    raise exception 'signup_identity_golive: approve_join_request changed (md5 %); rebuild this file', v_md5;
  end if;
end
$pre$;

revoke execute on function public.create_organization(text, text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.claim_organization(text) from public, anon, authenticated;

-- Production body (md5 966803f3...) plus the proof check and claim_requested, marked go-live.
CREATE OR REPLACE FUNCTION public.request_org_join(p_organization_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_email  TEXT;
  v_confirmed   BOOLEAN;
  v_first_name  TEXT;
  v_last_name   TEXT;
  v_existing    UUID;
BEGIN
  -- Get calling user's email (the verified sign-in address, never profiles.email)
  SELECT email, (email_confirmed_at IS NOT NULL)
    INTO v_user_email, v_confirmed
    FROM auth.users
   WHERE id = auth.uid();

  IF v_user_email IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT v_confirmed THEN
    RAISE EXCEPTION 'Please confirm your email address before requesting to join an organization';
  END IF;

  -- go-live (held/signup_identity_golive.sql): only for an address the person PROVED.
  IF NOT EXISTS (SELECT 1 FROM profiles p
                  WHERE p.user_id = auth.uid() AND p.email_proven_at IS NOT NULL
                    AND lower(p.email) = lower(v_user_email)) THEN
    RAISE EXCEPTION 'Please confirm your email address first: use the link in the banner on your dashboard';
  END IF;

  -- Verify the organization exists
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_organization_id) THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  -- Check for an existing pending, join_requested or claim_requested row for this email + org
  SELECT oi.id INTO v_existing
    FROM organization_invitations oi
   WHERE lower(oi.email) = lower(v_user_email)
     AND oi.organization_id = p_organization_id
     AND oi.status IN ('pending', 'join_requested', 'claim_requested');

  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'A request or invitation already exists for this email and organization';
  END IF;

  -- Get the user's name from their profile
  SELECT p.first_name, p.last_name
    INTO v_first_name, v_last_name
    FROM profiles p
   WHERE p.user_id = auth.uid();

  -- Create the join request (invited_by_user_id is NULL for self-requests)
  INSERT INTO organization_invitations (
    organization_id,
    email,
    first_name,
    last_name,
    status,
    invited_by_user_id
  ) VALUES (
    p_organization_id,
    v_user_email,
    v_first_name,
    v_last_name,
    'join_requested',
    NULL
  );
END;
$function$;

-- Part 1's body (md5 d2931bc0...) plus the proof check, marked go-live.
CREATE OR REPLACE FUNCTION public.accept_org_invitation(p_invitation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invitation   RECORD;
  v_user_email   TEXT;
  v_confirmed    BOOLEAN;
  v_org_verified BOOLEAN;
BEGIN
  SELECT email, (email_confirmed_at IS NOT NULL) INTO v_user_email, v_confirmed
    FROM auth.users WHERE id = auth.uid();
  IF v_user_email IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT v_confirmed THEN
    RAISE EXCEPTION 'Please confirm your email address before joining an organization';
  END IF;
  -- go-live (held/signup_identity_golive.sql): a PROVEN address only. With Confirm email off
  -- (May to go-live) anyone could sign up with the invitee's address and read the invitation
  -- id (current_user_email). A signed /join/<token> link proves it through accept-invite.
  IF NOT EXISTS (SELECT 1 FROM profiles p
                  WHERE p.user_id = auth.uid() AND p.email_proven_at IS NOT NULL
                    AND lower(p.email) = lower(v_user_email)) THEN
    RAISE EXCEPTION 'Please confirm your email address first: use the link in the banner on your dashboard';
  END IF;

  SELECT oi.id, oi.organization_id, oi.email, oi.status, oi.expires_at
    INTO v_invitation FROM organization_invitations oi WHERE oi.id = p_invitation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation not found'; END IF;
  IF v_invitation.status <> 'pending' THEN
    RAISE EXCEPTION 'Invitation is no longer pending (current status: %)', v_invitation.status;
  END IF;
  -- 12 Oct 2026: an invitation is valid until expires_at (30 days after it was sent).
  IF v_invitation.expires_at < now() THEN
    RAISE EXCEPTION 'This invitation has expired. Ask the person who invited you to send a new one.';
  END IF;
  IF lower(v_user_email) <> lower(v_invitation.email) THEN
    RAISE EXCEPTION 'Your email does not match this invitation';
  END IF;

  UPDATE organization_invitations SET status = 'accepted' WHERE id = p_invitation_id;
  INSERT INTO organization_members (user_id, organization_id, role)
  VALUES (auth.uid(), v_invitation.organization_id, 'collaborator')
  ON CONFLICT DO NOTHING;

  SELECT (o.access_status = 'verified') INTO v_org_verified
    FROM organizations o WHERE o.id = v_invitation.organization_id;

  IF v_org_verified THEN
    -- 12 Oct 2026: a suspended account stays suspended.
    UPDATE profiles SET access_status='verified', onboarding_status='completed', updated_at=now()
     WHERE user_id = auth.uid() AND access_status <> 'suspended';
  ELSE
    UPDATE profiles SET onboarding_status='submitted', updated_at=now()
     WHERE user_id = auth.uid() AND access_status <> 'verified';
  END IF;
END;
$function$;

-- The expiry file's body (md5 ac9d150a...) plus the requester's proof, marked go-live.
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

  -- Only an account whose address is confirmed can be the requester; go-live
  -- (held/signup_identity_golive.sql): and PROVEN (profiles.email_proven_at, same address).
  SELECT u.id INTO v_requester_id FROM auth.users u
   WHERE lower(u.email) = lower(v_invitation.email)
     AND u.email_confirmed_at IS NOT NULL;
  IF v_requester_id IS NULL THEN RAISE EXCEPTION 'Requesting user account not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles p
                  WHERE p.user_id = v_requester_id AND p.email_proven_at IS NOT NULL
                    AND lower(p.email) = lower(v_invitation.email)) THEN
    RAISE EXCEPTION 'This person has not confirmed their email address yet. Ask them to use the link in the banner on their dashboard, then approve the request again.';
  END IF;

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

-- ─── D. Cases ─────────────────────────────────────────────────────────────────
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
  vars := jsonb_build_object('owner', gen_random_uuid(), 'u1', gen_random_uuid(), 'u2', gen_random_uuid(),
    'e_owner', 'dryrun-owner-' || r8 || '@example.invalid', 'e_u1', 'dryrun-u1-' || r8 || '@example.invalid',
    'e_u2', 'dryrun-u2-' || r8 || '@example.invalid', 'org_v', gen_random_uuid(), 'code_n', 'DRYN' || upper(r8), 'org_n', gen_random_uuid(),
    'inv', gen_random_uuid());
  s0 := $s$select pg_temp.dr_user({owner}, {e_owner}, '{}', true, 'verified');
select pg_temp.dr_user({u1}, {e_u1}, '{}', false, 'pending');
select pg_temp.dr_user({u2}, {e_u2}, '{}', true, 'pending');
select pg_temp.dr_org({org_v}, 'Dryrun Golive Marina', 'verified', {owner}, null);
select pg_temp.dr_org({org_n}, 'Dryrun Golive Ownerless', 'verified', null, {code_n})$s$;

  tests := jsonb_build_array(
    jsonb_build_object('id', 'G01', 'who', 'postgres', 'bare', true, 'expect', 'ret:true', 'label', 'create_organization and claim_organization: no EXECUTE for authenticated, anon or PUBLIC; service role keeps them',
      'q', $q$select not has_function_privilege('authenticated', 'public.create_organization(text,text,text,text,text,text,text)', 'execute') and not has_function_privilege('anon', 'public.create_organization(text,text,text,text,text,text,text)', 'execute') and has_function_privilege('service_role', 'public.create_organization(text,text,text,text,text,text,text)', 'execute') and not has_function_privilege('authenticated', 'public.claim_organization(text)', 'execute') and not has_function_privilege('anon', 'public.claim_organization(text)', 'execute') and has_function_privilege('service_role', 'public.claim_organization_for_user(uuid,text)', 'execute') and not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.claim_organization(text)'::regprocedure and a.grantee = 0)$q$),
    jsonb_build_object('id', 'G02', 'who', 'owner', 'expect', 'rls', 'label', 'a person can no longer create a company',
      'q', $q$select public.create_organization('Dryrun Golive New', 'partner')::text$q$),
    jsonb_build_object('id', 'G03', 'who', 'u2', 'expect', 'rls', 'label', 'a person can no longer claim with a code',
      'q', $q$select public.claim_organization({code_n})::text$q$),
    jsonb_build_object('id', 'G04', 'who', 'u1', 'expect', 'err:confirm your email address first', 'label', 'request_org_join: an unproven address is refused',
      'q', $q$select public.request_org_join({org_v})::text$q$),
    jsonb_build_object('id', 'G05', 'who', 'u2', 'expect', 'allow', 'label', 'request_org_join: a proven address files the request',
      'q', $q$select public.request_org_join({org_v})::text$q$,
      'chk', $c$select count(*) = 1 from public.organization_invitations where organization_id = {org_v} and email = {e_u2} and status = 'join_requested' and invited_by_user_id is null$c$),
    jsonb_build_object('id', 'G06', 'who', 'u2', 'expect', 'err:already exists', 'label', 'request_org_join: an open claim counts as an open request',
      'setup', $s$insert into public.organization_invitations (organization_id, email, status) values ({org_v}, {e_u2}, 'claim_requested')$s$,
      'q', $q$select public.request_org_join({org_v})::text$q$),
    jsonb_build_object('id', 'G07', 'who', 'u1', 'expect', 'err:confirm your email address first', 'label', 'accept_org_invitation: an unproven (merely confirmed) invitee is refused',
      'setup', $s$insert into public.organization_invitations (id, organization_id, email, invited_by_user_id) values ({inv}, {org_v}, {e_u1}, {owner})$s$,
      'q', $q$select public.accept_org_invitation({inv})::text$q$,
      'chk', $c$select not exists (select 1 from public.organization_members where organization_id = {org_v} and user_id = {u1})$c$),
    jsonb_build_object('id', 'G08', 'who', 'u2', 'expect', 'allow', 'label', 'accept_org_invitation: a proven invitee joins (collaborator, verified with the company)',
      'setup', $s$insert into public.organization_invitations (id, organization_id, email, invited_by_user_id) values ({inv}, {org_v}, {e_u2}, {owner})$s$,
      'q', $q$select public.accept_org_invitation({inv})::text$q$,
      'chk', $c$select exists (select 1 from public.organization_members where organization_id = {org_v} and user_id = {u2} and role = 'collaborator') and (select access_status::text = 'verified' from public.profiles where user_id = {u2})$c$),
    jsonb_build_object('id', 'G09', 'who', 'owner', 'expect', 'err:has not confirmed their email address', 'label', 'approve_join_request: an unproven requester is not let in',
      'setup', $s$insert into public.organization_invitations (id, organization_id, email, status) values ({inv}, {org_v}, {e_u1}, 'join_requested')$s$,
      'q', $q$select public.approve_join_request({inv})::text$q$,
      'chk', $c$select not exists (select 1 from public.organization_members where organization_id = {org_v} and user_id = {u1})$c$),
    jsonb_build_object('id', 'G10', 'who', 'owner', 'expect', 'allow', 'label', 'approve_join_request: a proven requester joins',
      'setup', $s$insert into public.organization_invitations (id, organization_id, email, status) values ({inv}, {org_v}, {e_u2}, 'join_requested')$s$,
      'q', $q$select public.approve_join_request({inv})::text$q$,
      'chk', $c$select exists (select 1 from public.organization_members where organization_id = {org_v} and user_id = {u2} and role = 'collaborator') and (select status = 'accepted' from public.organization_invitations where id = {inv})$c$)
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
      -- An expected error is caught here, so the case's check (chk) still runs on the
      -- state the setup made; any other error goes to the handler below as before.
      begin
        if v_dml then
          execute v_q;
          get diagnostics v_n = row_count;
        else
          execute v_q into v_ret;
        end if;
      exception when others then
        if v_exp like 'err:%' then v_err := sqlerrm; v_state := sqlstate; else raise; end if;
      end;
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

  perform set_config('dr.report', results, true);
  perform set_config('dr.npass', n_pass::text, true);
  perform set_config('dr.nfail', n_fail::text, true);
end
$dryrun$;

-- ─── E. The DOWN, verbatim ────────────────────────────────────────────────────
-- DOWN for supabase/migrations/held/signup_identity_golive.sql: the EXECUTE grants of
-- before, the request_org_join body of before (production md5 966803f3...), part 1's
-- accept_org_invitation (d2931bc0...) and the expiry file's approve_join_request (ac9d150a...).

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $pre$
declare
  v_md5 text;
begin
  select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p where p.oid = to_regprocedure('public.request_org_join(uuid)');
  if v_md5 is distinct from '966803f30484c2bf363c925bd77f1f63' and v_md5 is distinct from '06ff2f219deb4b7cf7332bb61ea8a0a6' then
    raise exception 'signup_identity_golive DOWN: request_org_join changed since (md5 %); restore it by hand', v_md5;
  end if;
  select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p where p.oid = to_regprocedure('public.accept_org_invitation(uuid)');
  if v_md5 is distinct from 'd2931bc02461e4f80fdda4aefa29fd41' and v_md5 is distinct from 'ef758ac60b7753a04b9e3091c2bc56dc' then
    raise exception 'signup_identity_golive DOWN: accept_org_invitation changed since (md5 %); restore it by hand', v_md5;
  end if;
  select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p where p.oid = to_regprocedure('public.approve_join_request(uuid)');
  if v_md5 is distinct from 'ac9d150a92163841e383c7e80a5028b2' and v_md5 is distinct from '8ae51462f91e269160978c2f6f6c1dd6' then
    raise exception 'signup_identity_golive DOWN: approve_join_request changed since (md5 %); restore it by hand', v_md5;
  end if;
end
$pre$;

grant execute on function public.create_organization(text, text, text, text, text, text, text) to authenticated;
grant execute on function public.claim_organization(text) to public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.request_org_join(p_organization_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_email  TEXT;
  v_confirmed   BOOLEAN;
  v_first_name  TEXT;
  v_last_name   TEXT;
  v_existing    UUID;
BEGIN
  -- Get calling user's email (the verified sign-in address, never profiles.email)
  SELECT email, (email_confirmed_at IS NOT NULL)
    INTO v_user_email, v_confirmed
    FROM auth.users
   WHERE id = auth.uid();

  IF v_user_email IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT v_confirmed THEN
    RAISE EXCEPTION 'Please confirm your email address before requesting to join an organization';
  END IF;

  -- Verify the organization exists
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_organization_id) THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  -- Check for an existing pending or join_requested row for this email + org
  SELECT oi.id INTO v_existing
    FROM organization_invitations oi
   WHERE lower(oi.email) = lower(v_user_email)
     AND oi.organization_id = p_organization_id
     AND oi.status IN ('pending', 'join_requested');

  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'A request or invitation already exists for this email and organization';
  END IF;

  -- Get the user's name from their profile
  SELECT p.first_name, p.last_name
    INTO v_first_name, v_last_name
    FROM profiles p
   WHERE p.user_id = auth.uid();

  -- Create the join request (invited_by_user_id is NULL for self-requests)
  INSERT INTO organization_invitations (
    organization_id,
    email,
    first_name,
    last_name,
    status,
    invited_by_user_id
  ) VALUES (
    p_organization_id,
    v_user_email,
    v_first_name,
    v_last_name,
    'join_requested',
    NULL
  );
END;
$function$;

-- Part 1's body (20261012113000_signup_identity_orgs).
CREATE OR REPLACE FUNCTION public.accept_org_invitation(p_invitation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invitation   RECORD;
  v_user_email   TEXT;
  v_confirmed    BOOLEAN;
  v_org_verified BOOLEAN;
BEGIN
  SELECT email, (email_confirmed_at IS NOT NULL) INTO v_user_email, v_confirmed
    FROM auth.users WHERE id = auth.uid();
  IF v_user_email IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT v_confirmed THEN
    RAISE EXCEPTION 'Please confirm your email address before joining an organization';
  END IF;

  SELECT oi.id, oi.organization_id, oi.email, oi.status, oi.expires_at
    INTO v_invitation FROM organization_invitations oi WHERE oi.id = p_invitation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation not found'; END IF;
  IF v_invitation.status <> 'pending' THEN
    RAISE EXCEPTION 'Invitation is no longer pending (current status: %)', v_invitation.status;
  END IF;
  -- 12 Oct 2026: an invitation is valid until expires_at (30 days after it was sent).
  IF v_invitation.expires_at < now() THEN
    RAISE EXCEPTION 'This invitation has expired. Ask the person who invited you to send a new one.';
  END IF;
  IF lower(v_user_email) <> lower(v_invitation.email) THEN
    RAISE EXCEPTION 'Your email does not match this invitation';
  END IF;

  UPDATE organization_invitations SET status = 'accepted' WHERE id = p_invitation_id;
  INSERT INTO organization_members (user_id, organization_id, role)
  VALUES (auth.uid(), v_invitation.organization_id, 'collaborator')
  ON CONFLICT DO NOTHING;

  SELECT (o.access_status = 'verified') INTO v_org_verified
    FROM organizations o WHERE o.id = v_invitation.organization_id;

  IF v_org_verified THEN
    -- 12 Oct 2026: a suspended account stays suspended.
    UPDATE profiles SET access_status='verified', onboarding_status='completed', updated_at=now()
     WHERE user_id = auth.uid() AND access_status <> 'suspended';
  ELSE
    UPDATE profiles SET onboarding_status='submitted', updated_at=now()
     WHERE user_id = auth.uid() AND access_status <> 'verified';
  END IF;
END;
$function$;

-- The expiry file's body (20261012112000_org_invitations_expiry).
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

-- ─── F. After the down ────────────────────────────────────────────────────────
do $after$
declare
  results text := current_setting('dr.report');
  n_pass integer := current_setting('dr.npass')::integer;
  n_fail integer := current_setting('dr.nfail')::integer;
  v_ok boolean;
begin
  v_ok := has_function_privilege('authenticated', 'public.create_organization(text,text,text,text,text,text,text)', 'execute')
      and not has_function_privilege('anon', 'public.create_organization(text,text,text,text,text,text,text)', 'execute')
      and has_function_privilege('anon', 'public.claim_organization(text)', 'execute')
      and has_function_privilege('authenticated', 'public.claim_organization(text)', 'execute')
      and exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.claim_organization(text)'::regprocedure and a.grantee = 0);
  if v_ok then n_pass := n_pass + 1; else n_fail := n_fail + 1; end if;
  results := results || format(E'\n%s GD1 down: EXECUTE grants as before (create_organization: authenticated; claim_organization: PUBLIC, anon, authenticated)', case when v_ok then 'PASS' else 'FAIL' end);
  v_ok := (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = 'public.request_org_join(uuid)'::regprocedure) = '966803f30484c2bf363c925bd77f1f63';
  if v_ok then n_pass := n_pass + 1; else n_fail := n_fail + 1; end if;
  results := results || format(E'\n%s GD2 down: request_org_join = production body', case when v_ok then 'PASS' else 'FAIL' end);
  v_ok := (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = 'public.accept_org_invitation(uuid)'::regprocedure) = 'd2931bc02461e4f80fdda4aefa29fd41'
      and (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = 'public.approve_join_request(uuid)'::regprocedure) = 'ac9d150a92163841e383c7e80a5028b2';
  if v_ok then n_pass := n_pass + 1; else n_fail := n_fail + 1; end if;
  results := results || format(E'\n%s GD3 down: accept_org_invitation = part 1 body, approve_join_request = expiry file body', case when v_ok then 'PASS' else 'FAIL' end);
  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (signup_identity_golive + down, run %s)', n_pass, n_fail, now()) || results;
end
$after$;
