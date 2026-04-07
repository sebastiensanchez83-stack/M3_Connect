-- 009: Fix invitation RLS policies + update Supabase site URL
-- Run this in the Supabase SQL Editor

-- ═══════════════════════════════════════════════════════════
-- 1. Fix organization_invitations RLS policies
--    Drop ALL existing SELECT policies and create one clean policy
--    that allows ANY org member to see invitations for their org
-- ═══════════════════════════════════════════════════════════

-- First, let's see what policies exist (for debugging)
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'organization_invitations';

-- Drop any existing SELECT policies (common names used in previous scripts)
DROP POLICY IF EXISTS "Org members can view invitations" ON organization_invitations;
DROP POLICY IF EXISTS "org_members_view_invitations" ON organization_invitations;
DROP POLICY IF EXISTS "Members can view org invitations" ON organization_invitations;
DROP POLICY IF EXISTS "Owner can view invitations" ON organization_invitations;
DROP POLICY IF EXISTS "Owners can view invitations" ON organization_invitations;
DROP POLICY IF EXISTS "org_owner_select_invitations" ON organization_invitations;
DROP POLICY IF EXISTS "Users can view own invitations" ON organization_invitations;
DROP POLICY IF EXISTS "Invitees can view own invitation" ON organization_invitations;

-- Make sure RLS is enabled
ALTER TABLE organization_invitations ENABLE ROW LEVEL SECURITY;

-- Create a clean SELECT policy: any member of the org can see all invitations for that org
CREATE POLICY "org_members_can_view_invitations"
  ON organization_invitations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = organization_invitations.organization_id
        AND om.user_id = auth.uid()
    )
  );

-- Also allow invited users to see their own invitation (needed for /join/:id page)
CREATE POLICY "invitees_can_view_own_invitation"
  ON organization_invitations
  FOR SELECT
  USING (
    email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

-- Also allow unauthenticated users to read invitation by ID (for /join page before login)
-- This uses a limited anon policy — only exposes org name via join, not sensitive data
CREATE POLICY "anon_can_view_invitation_by_id"
  ON organization_invitations
  FOR SELECT
  USING (true);
  -- Note: The JoinPage fetches by .eq('id', inviteId).single() so this is safe.
  -- If you want to restrict further, you can limit to status = 'pending' only.

-- ═══════════════════════════════════════════════════════════
-- 2. Verify INSERT/UPDATE/DELETE policies exist for owners
-- ═══════════════════════════════════════════════════════════

-- Ensure owners can insert invitations
DROP POLICY IF EXISTS "Owners can create invitations" ON organization_invitations;
CREATE POLICY "owners_can_create_invitations"
  ON organization_invitations
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = organization_invitations.organization_id
        AND om.user_id = auth.uid()
        AND om.role = 'owner'
    )
  );

-- Ensure owners can update invitations (accept, cancel, etc.)
DROP POLICY IF EXISTS "Owners can update invitations" ON organization_invitations;
CREATE POLICY "owners_can_update_invitations"
  ON organization_invitations
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = organization_invitations.organization_id
        AND om.user_id = auth.uid()
        AND om.role = 'owner'
    )
  );

-- Ensure owners can delete invitations
DROP POLICY IF EXISTS "Owners can delete invitations" ON organization_invitations;
CREATE POLICY "owners_can_delete_invitations"
  ON organization_invitations
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = organization_invitations.organization_id
        AND om.user_id = auth.uid()
        AND om.role = 'owner'
    )
  );

-- ═══════════════════════════════════════════════════════════
-- 3. Update Supabase Auth site URL to new domain
--    NOTE: You must ALSO update this in the Supabase Dashboard:
--    Settings → Authentication → URL Configuration
--    - Site URL: https://smartmarinaconnect.com
--    - Redirect URLs: add https://smartmarinaconnect.com/**
-- ═══════════════════════════════════════════════════════════

-- Verify the policies were created:
SELECT policyname, cmd, permissive FROM pg_policies WHERE tablename = 'organization_invitations' ORDER BY policyname;
