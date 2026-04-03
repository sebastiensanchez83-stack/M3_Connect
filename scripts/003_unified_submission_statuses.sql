-- ============================================================
-- 003_unified_submission_statuses.sql
-- Standardize submission statuses across RFPs, Consultations,
-- and Projects with admin approval gate + rejection workflow.
-- Idempotent — safe to run multiple times.
-- ============================================================

-- -----------------------------------------------------------
-- 1. RFPs — add status, rejection_reason, admin_notes
-- -----------------------------------------------------------
ALTER TABLE rfps
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'submitted';

ALTER TABLE rfps
  ADD COLUMN IF NOT EXISTS rejection_reason text;

ALTER TABLE rfps
  ADD COLUMN IF NOT EXISTS admin_notes text;

-- Add CHECK constraint for allowed status values (skip if exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rfps_status_check'
  ) THEN
    ALTER TABLE rfps
      ADD CONSTRAINT rfps_status_check
      CHECK (status IN ('submitted', 'under_review', 'approved', 'closed', 'rejected', 'archived'));
  END IF;
END $$;

-- -----------------------------------------------------------
-- 2. Consultations — add status, rejection_reason, admin_notes
-- -----------------------------------------------------------
ALTER TABLE consultations
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'submitted';

ALTER TABLE consultations
  ADD COLUMN IF NOT EXISTS rejection_reason text;

ALTER TABLE consultations
  ADD COLUMN IF NOT EXISTS admin_notes text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'consultations_status_check'
  ) THEN
    ALTER TABLE consultations
      ADD CONSTRAINT consultations_status_check
      CHECK (status IN ('submitted', 'under_review', 'approved', 'closed', 'rejected', 'archived'));
  END IF;
END $$;

-- -----------------------------------------------------------
-- 3. Marina Projects — add rejection_reason, expand status values
--    Current values: new, in_progress, completed
--    New additions: submitted, under_review, approved, rejected, archived
-- -----------------------------------------------------------
ALTER TABLE marina_projects
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- Drop old CHECK constraint (if any) and replace with expanded one.
-- marina_projects may or may not have a CHECK on status already.
DO $$
BEGIN
  -- Drop existing status check if present
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'marina_projects_status_check'
      AND conrelid = 'marina_projects'::regclass
  ) THEN
    ALTER TABLE marina_projects DROP CONSTRAINT marina_projects_status_check;
  END IF;

  -- Add expanded constraint
  ALTER TABLE marina_projects
    ADD CONSTRAINT marina_projects_status_check
    CHECK (status IN (
      'new', 'in_progress', 'completed',
      'submitted', 'under_review', 'approved',
      'rejected', 'archived'
    ));
END $$;

-- -----------------------------------------------------------
-- 4. RLS UPDATE policies — admin/moderator can update all rows
-- -----------------------------------------------------------

-- RFPs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'rfps' AND policyname = 'admin_update_rfps'
  ) THEN
    CREATE POLICY "admin_update_rfps" ON rfps
      FOR UPDATE
      USING (EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.user_id = auth.uid()
          AND profiles.persona IN ('admin', 'moderator')
      ));
  END IF;
END $$;

-- Consultations
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'consultations' AND policyname = 'admin_update_consultations'
  ) THEN
    CREATE POLICY "admin_update_consultations" ON consultations
      FOR UPDATE
      USING (EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.user_id = auth.uid()
          AND profiles.persona IN ('admin', 'moderator')
      ));
  END IF;
END $$;

-- Marina Projects
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'marina_projects' AND policyname = 'admin_update_marina_projects'
  ) THEN
    CREATE POLICY "admin_update_marina_projects" ON marina_projects
      FOR UPDATE
      USING (EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.user_id = auth.uid()
          AND profiles.persona IN ('admin', 'moderator')
      ));
  END IF;
END $$;

-- -----------------------------------------------------------
-- 5. Migrate existing boolean is_open → new status column
--    (only for rows still at default 'submitted')
-- -----------------------------------------------------------

-- RFPs: if is_open = false, mark as 'closed'
UPDATE rfps
  SET status = 'closed'
  WHERE status = 'submitted'
    AND is_open IS NOT NULL
    AND is_open = false;

-- RFPs: if is_open = true, mark as 'approved' (was already live)
UPDATE rfps
  SET status = 'approved'
  WHERE status = 'submitted'
    AND is_open IS NOT NULL
    AND is_open = true;

-- Consultations: same logic
UPDATE consultations
  SET status = 'closed'
  WHERE status = 'submitted'
    AND is_open IS NOT NULL
    AND is_open = false;

UPDATE consultations
  SET status = 'approved'
  WHERE status = 'submitted'
    AND is_open IS NOT NULL
    AND is_open = true;

-- Done. The is_open columns are left in place for now to avoid
-- breaking existing frontend code. They can be dropped in a
-- future migration once the frontend is fully switched over.
