-- =============================================================================
-- 006_invitation_rpcs.sql
-- RPC functions for organization invitation & join-request workflows
-- =============================================================================

-- Drop existing functions first (to handle return type changes)
DROP FUNCTION IF EXISTS check_pending_invitation(TEXT);
DROP FUNCTION IF EXISTS accept_org_invitation(UUID);
DROP FUNCTION IF EXISTS request_org_join(UUID);
DROP FUNCTION IF EXISTS approve_join_request(UUID);
DROP FUNCTION IF EXISTS reject_join_request(UUID);

-- -----------------------------------------------------------------------------
-- 1. check_pending_invitation(p_email TEXT)
--    Returns any pending invitations for the given email address.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_pending_invitation(p_email TEXT)
RETURNS TABLE (
  invitation_id    UUID,
  organization_id  UUID,
  organization_name TEXT,
  invited_by_name  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT
      oi.id            AS invitation_id,
      oi.organization_id,
      o.name           AS organization_name,
      COALESCE(p.first_name || ' ' || p.last_name, 'Unknown') AS invited_by_name
    FROM organization_invitations oi
    JOIN organizations o ON o.id = oi.organization_id
    LEFT JOIN profiles p ON p.user_id = oi.invited_by_user_id
    WHERE lower(oi.email) = lower(p_email)
      AND oi.status = 'pending';
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. accept_org_invitation(p_invitation_id UUID)
--    Called by the invited user to accept a pending invitation.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION accept_org_invitation(p_invitation_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invitation   RECORD;
  v_user_email   TEXT;
  v_org_verified BOOLEAN;
BEGIN
  -- Get the calling user's email
  SELECT email INTO v_user_email
    FROM auth.users
   WHERE id = auth.uid();

  IF v_user_email IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Look up the invitation
  SELECT oi.id, oi.organization_id, oi.email, oi.status
    INTO v_invitation
    FROM organization_invitations oi
   WHERE oi.id = p_invitation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found';
  END IF;

  IF v_invitation.status <> 'pending' THEN
    RAISE EXCEPTION 'Invitation is no longer pending (current status: %)', v_invitation.status;
  END IF;

  -- Verify the calling user's email matches the invitation
  IF lower(v_user_email) <> lower(v_invitation.email) THEN
    RAISE EXCEPTION 'Your email does not match this invitation';
  END IF;

  -- Mark invitation as accepted
  UPDATE organization_invitations
     SET status     = 'accepted',
         updated_at = now()
   WHERE id = p_invitation_id;

  -- Add user as collaborator
  INSERT INTO organization_members (user_id, organization_id, role)
  VALUES (auth.uid(), v_invitation.organization_id, 'collaborator')
  ON CONFLICT DO NOTHING;

  -- Check if the organization is verified
  SELECT (o.access_status = 'verified') INTO v_org_verified
    FROM organizations o
   WHERE o.id = v_invitation.organization_id;

  -- Update the user's profile status accordingly
  IF v_org_verified THEN
    UPDATE profiles
       SET access_status     = 'verified',
           onboarding_status = 'completed',
           updated_at        = now()
     WHERE user_id = auth.uid();
  ELSE
    UPDATE profiles
       SET onboarding_status = 'submitted',
           updated_at        = now()
     WHERE user_id = auth.uid();
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. request_org_join(p_organization_id UUID)
--    For users who sign up with a matching domain but have no invitation.
--    Creates a self-initiated join request.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION request_org_join(p_organization_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_email  TEXT;
  v_first_name  TEXT;
  v_last_name   TEXT;
  v_existing    UUID;
BEGIN
  -- Get calling user's email
  SELECT email INTO v_user_email
    FROM auth.users
   WHERE id = auth.uid();

  IF v_user_email IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
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
$$;

-- -----------------------------------------------------------------------------
-- 4. approve_join_request(p_invitation_id UUID)
--    For org owners to approve a domain-match join request.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION approve_join_request(p_invitation_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invitation   RECORD;
  v_org_verified BOOLEAN;
  v_requester_id UUID;
BEGIN
  -- Look up the invitation / join request
  SELECT oi.id, oi.organization_id, oi.email, oi.status
    INTO v_invitation
    FROM organization_invitations oi
   WHERE oi.id = p_invitation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Join request not found';
  END IF;

  IF v_invitation.status <> 'join_requested' THEN
    RAISE EXCEPTION 'This request is not in join_requested status (current: %)', v_invitation.status;
  END IF;

  -- Validate the calling user is the owner of the organization
  IF NOT EXISTS (
    SELECT 1 FROM organization_members om
     WHERE om.organization_id = v_invitation.organization_id
       AND om.user_id = auth.uid()
       AND om.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Only the organization owner can approve join requests';
  END IF;

  -- Find the user who requested to join (by email)
  SELECT u.id INTO v_requester_id
    FROM auth.users u
   WHERE lower(u.email) = lower(v_invitation.email);

  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'Requesting user account not found';
  END IF;

  -- Mark the request as accepted
  UPDATE organization_invitations
     SET status     = 'accepted',
         updated_at = now()
   WHERE id = p_invitation_id;

  -- Add user as collaborator
  INSERT INTO organization_members (user_id, organization_id, role)
  VALUES (v_requester_id, v_invitation.organization_id, 'collaborator')
  ON CONFLICT DO NOTHING;

  -- Check if the organization is verified
  SELECT (o.access_status = 'verified') INTO v_org_verified
    FROM organizations o
   WHERE o.id = v_invitation.organization_id;

  -- Update the requester's profile status
  IF v_org_verified THEN
    UPDATE profiles
       SET access_status     = 'verified',
           onboarding_status = 'completed',
           updated_at        = now()
     WHERE user_id = v_requester_id;
  ELSE
    UPDATE profiles
       SET onboarding_status = 'submitted',
           updated_at        = now()
     WHERE user_id = v_requester_id;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. reject_join_request(p_invitation_id UUID)
--    For org owners to reject a join request.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reject_join_request(p_invitation_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invitation RECORD;
BEGIN
  -- Look up the invitation / join request
  SELECT oi.id, oi.organization_id, oi.status
    INTO v_invitation
    FROM organization_invitations oi
   WHERE oi.id = p_invitation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Join request not found';
  END IF;

  IF v_invitation.status <> 'join_requested' THEN
    RAISE EXCEPTION 'This request is not in join_requested status (current: %)', v_invitation.status;
  END IF;

  -- Validate the calling user is the owner of the organization
  IF NOT EXISTS (
    SELECT 1 FROM organization_members om
     WHERE om.organization_id = v_invitation.organization_id
       AND om.user_id = auth.uid()
       AND om.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Only the organization owner can reject join requests';
  END IF;

  -- Mark the request as rejected
  UPDATE organization_invitations
     SET status     = 'rejected',
         updated_at = now()
   WHERE id = p_invitation_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. RLS policy: Users can read invitations addressed to their own email
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'organization_invitations'
      AND policyname = 'Users can read own invitations by email'
  ) THEN
    EXECUTE 'CREATE POLICY "Users can read own invitations by email"
      ON organization_invitations
      FOR SELECT
      USING (
        lower(email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
      )';
  END IF;
END
$$;
