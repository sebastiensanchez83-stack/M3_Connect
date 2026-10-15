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
