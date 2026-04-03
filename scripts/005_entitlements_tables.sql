-- ============================================================
-- 005: Entitlements & Feature Usage Tables
-- ============================================================

-- Feature entitlements per organization
CREATE TABLE IF NOT EXISTS entitlements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  enabled     boolean NOT NULL DEFAULT false,
  quota       integer,  -- NULL = unlimited when enabled
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, feature_key)
);

-- Feature usage tracking (monthly periods)
CREATE TABLE IF NOT EXISTS feature_usage (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  feature_key     text NOT NULL,
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  usage_count     integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, feature_key, period_start)
);

-- Enable RLS
ALTER TABLE entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_usage ENABLE ROW LEVEL SECURITY;

-- RLS: Org members can read their own entitlements
CREATE POLICY "Members read own entitlements"
  ON entitlements FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = entitlements.organization_id
        AND organization_members.user_id = auth.uid()
    )
  );

-- RLS: Admins/moderators can manage all entitlements
CREATE POLICY "Admins manage entitlements"
  ON entitlements FOR ALL
  USING (is_moderator());

-- RLS: Org members can read their own usage
CREATE POLICY "Members read own usage"
  ON feature_usage FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = feature_usage.organization_id
        AND organization_members.user_id = auth.uid()
    )
  );

-- RLS: Admins/moderators can manage all usage
CREATE POLICY "Admins manage usage"
  ON feature_usage FOR ALL
  USING (is_moderator());

-- Allow org members to increment their own usage (INSERT + UPDATE)
CREATE POLICY "Members track own usage"
  ON feature_usage FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = feature_usage.organization_id
        AND organization_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Members update own usage"
  ON feature_usage FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = feature_usage.organization_id
        AND organization_members.user_id = auth.uid()
    )
  );

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_entitlements_org_feature ON entitlements(organization_id, feature_key);
CREATE INDEX IF NOT EXISTS idx_feature_usage_org_period ON feature_usage(organization_id, feature_key, period_start);

-- ============================================================
-- Seed default feature keys for reference:
-- marketplace_access   — Can browse marketplace & express interest
-- submit_project       — Can submit marina projects
-- submit_rfp           — Can create RFPs
-- submit_consultation  — Can create consultations
-- request_webinar      — Can propose webinars
-- b2b_matching         — Can send/receive B2B partner requests
-- analytics_dashboard  — Can see profile analytics
-- team_management      — Can invite team members
-- document_upload      — Can upload org documents
-- expo_request         — Can request expo booths
-- sponsorship_upgrade  — Can request tier upgrades
-- ============================================================
