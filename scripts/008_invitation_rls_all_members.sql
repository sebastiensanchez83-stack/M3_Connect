-- =============================================================================
-- 008_invitation_rls_all_members.sql
-- Allow all organization members to read invitations for their org
-- (not just owners). Action RPCs still enforce owner-only for mutations.
--
-- Run in Supabase SQL Editor.
-- =============================================================================

-- Drop old policy if it exists (safe to run multiple times)
DROP POLICY IF EXISTS "Org members can read invitations" ON organization_invitations;

-- All members of an organization can see its invitations
CREATE POLICY "Org members can read invitations"
  ON organization_invitations
  FOR SELECT
  USING (
    organization_id IN (
      SELECT om.organization_id
      FROM organization_members om
      WHERE om.user_id = auth.uid()
    )
  );
