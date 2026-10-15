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
