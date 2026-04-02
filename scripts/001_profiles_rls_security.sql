-- ============================================================================
-- M3 Connect — Profiles RLS Security Hardening
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ============================================================================
--
-- WHAT THIS DOES:
-- 1. Creates a public VIEW (profiles_public) exposing only safe columns
-- 2. Creates SECURITY DEFINER RPCs for admin batch-fetch and public lookups
-- 3. Tightens the profiles table RLS so only own-profile is directly readable
-- 4. Admins/moderators bypass via the RPC functions (not direct table access)
--
-- IMPORTANT: After running this SQL, deploy the frontend changes that switch
-- MarketplacePage and UserProfilePage to use the new RPC functions.
-- ============================================================================

-- ── Step 0: Check current policies (informational — review output before proceeding)
-- SELECT policyname, cmd, qual FROM pg_policies WHERE tablename = 'profiles';

BEGIN;

-- ── Step 1: Create a public view with safe columns only ─────────────────────
-- This view is used by cross-user lookups (marketplace, user profiles, etc.)
-- It does NOT expose email, phone, or other sensitive fields.
CREATE OR REPLACE VIEW public.profiles_public AS
SELECT
  user_id,
  first_name,
  last_name,
  avatar_url,
  persona,
  job_title,
  access_status,
  created_at
FROM public.profiles
WHERE access_status = 'verified';

-- Grant access to the view for authenticated users
GRANT SELECT ON public.profiles_public TO authenticated;
GRANT SELECT ON public.profiles_public TO anon;

-- ── Step 2: Create SECURITY DEFINER RPCs ────────────────────────────────────

-- 2a. Public profile lookup by user_id (limited columns, verified only)
CREATE OR REPLACE FUNCTION public.get_public_profile(target_user_id UUID)
RETURNS TABLE(
  user_id UUID,
  first_name TEXT,
  last_name TEXT,
  avatar_url TEXT,
  persona TEXT,
  job_title TEXT,
  access_status TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT p.user_id, p.first_name, p.last_name, p.avatar_url,
         p.persona::text, p.job_title, p.access_status
  FROM profiles p
  WHERE p.user_id = target_user_id
    AND p.access_status = 'verified';
$$;

-- 2b. Batch public profile lookup (for marketplace, RFP/consultation name resolution)
CREATE OR REPLACE FUNCTION public.get_public_profiles(target_user_ids UUID[])
RETURNS TABLE(
  user_id UUID,
  first_name TEXT,
  last_name TEXT,
  avatar_url TEXT,
  persona TEXT,
  job_title TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT p.user_id, p.first_name, p.last_name, p.avatar_url,
         p.persona::text, p.job_title
  FROM profiles p
  WHERE p.user_id = ANY(target_user_ids)
    AND p.access_status = 'verified';
$$;

-- 2c. Admin profile lookup (all columns, checks is_moderator)
CREATE OR REPLACE FUNCTION public.admin_get_profiles(
  filter_access_status TEXT DEFAULT NULL,
  filter_persona TEXT DEFAULT NULL,
  result_limit INT DEFAULT 200
)
RETURNS TABLE(
  user_id UUID,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  persona TEXT,
  access_status TEXT,
  onboarding_status TEXT,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  -- Verify caller is admin/moderator
  IF NOT public.is_moderator() THEN
    RAISE EXCEPTION 'Access denied: admin privileges required';
  END IF;

  RETURN QUERY
  SELECT p.user_id, p.first_name, p.last_name, p.email,
         p.persona::text, p.access_status, p.onboarding_status,
         p.rejection_reason, p.created_at
  FROM profiles p
  WHERE (filter_access_status IS NULL OR p.access_status = filter_access_status)
    AND (filter_persona IS NULL OR p.persona::text = filter_persona)
  ORDER BY p.created_at DESC
  LIMIT result_limit;
END;
$$;

-- 2d. Admin batch lookup by user IDs (for joining names to other tables)
CREATE OR REPLACE FUNCTION public.admin_get_profiles_by_ids(target_user_ids UUID[])
RETURNS TABLE(
  user_id UUID,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  persona TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  IF NOT public.is_moderator() THEN
    RAISE EXCEPTION 'Access denied: admin privileges required';
  END IF;

  RETURN QUERY
  SELECT p.user_id, p.first_name, p.last_name, p.email, p.persona::text
  FROM profiles p
  WHERE p.user_id = ANY(target_user_ids);
END;
$$;

-- Grant execute to authenticated users (the functions enforce their own access)
GRANT EXECUTE ON FUNCTION public.get_public_profile(UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_public_profiles(UUID[]) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_profiles(TEXT, TEXT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_profiles_by_ids(UUID[]) TO authenticated;

-- ── Step 3: Tighten RLS on profiles table ───────────────────────────────────
-- Drop overly permissive existing policies
-- NOTE: Run the informational query in Step 0 first to see exact policy names.
-- Adjust the DROP statements below to match your actual policy names.

-- Common policy names — uncomment/adjust based on your actual policies:
-- DROP POLICY IF EXISTS "Anyone can view profiles" ON profiles;
-- DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON profiles;
-- DROP POLICY IF EXISTS "Users can view all profiles" ON profiles;
-- DROP POLICY IF EXISTS "Authenticated users can view profiles" ON profiles;
-- DROP POLICY IF EXISTS "Enable read access for authenticated users" ON profiles;

-- Keep/create own-profile policy
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = user_id);

-- Keep existing insert/update policies (users manage their own profile)
-- These should already exist; verify they have auth.uid() = user_id in USING/WITH CHECK

COMMIT;

-- ============================================================================
-- VERIFICATION QUERIES (run after the migration)
-- ============================================================================
--
-- 1. Check new policies:
--    SELECT policyname, cmd, qual FROM pg_policies WHERE tablename = 'profiles';
--
-- 2. Test public profile RPC:
--    SELECT * FROM get_public_profile('some-verified-user-uuid');
--
-- 3. Test that direct cross-user query fails for non-admin:
--    SET ROLE authenticated;
--    SET request.jwt.claims = '{"sub": "some-user-id"}';
--    SELECT * FROM profiles WHERE user_id != 'some-user-id'; -- Should return 0 rows
--
-- 4. Test admin RPC works:
--    SELECT * FROM admin_get_profiles(NULL, NULL, 10);
-- ============================================================================
