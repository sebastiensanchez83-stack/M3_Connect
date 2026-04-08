-- Ad banners table
CREATE TABLE IF NOT EXISTS ad_banners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  image_url TEXT NOT NULL,
  target_url TEXT NOT NULL,
  placement TEXT NOT NULL CHECK (placement IN ('homepage', 'marketplace', 'resources', 'events')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  click_count INTEGER NOT NULL DEFAULT 0,
  impression_count INTEGER NOT NULL DEFAULT 0,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE ad_banners ENABLE ROW LEVEL SECURITY;

-- Everyone can read active banners
CREATE POLICY "Anyone can view active banners" ON ad_banners
  FOR SELECT USING (is_active = true AND (start_date IS NULL OR start_date <= now()) AND (end_date IS NULL OR end_date >= now()));

-- Admins can do everything (via is_moderator() function which checks admin+moderator)
CREATE POLICY "Admins manage banners" ON ad_banners
  FOR ALL USING (public.is_moderator());

-- ─── Storage bucket for banner images (private from regular users) ───
-- Run this in Supabase Dashboard > Storage > Create new bucket:
--   Name: ad-banners
--   Public: YES (images need to be served publicly)
--   File size limit: 10MB
--   Allowed MIME types: image/jpeg, image/png, image/webp
--
-- Then add these RLS policies on the ad-banners bucket:
--   SELECT (read): Allow public access (anyone can view banner images)
--   INSERT: Only admins/moderators → using: public.is_moderator()
--   UPDATE: Only admins/moderators → using: public.is_moderator()
--   DELETE: Only admins/moderators → using: public.is_moderator()
--
-- This keeps banner images separate from resource-images and profile-images,
-- so regular users cannot browse or reuse sponsor branding.

-- Increment functions
CREATE OR REPLACE FUNCTION increment_banner_clicks(banner_id UUID)
RETURNS void AS $$
  UPDATE ad_banners SET click_count = click_count + 1 WHERE id = banner_id;
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION increment_banner_impressions(banner_id UUID)
RETURNS void AS $$
  UPDATE ad_banners SET impression_count = impression_count + 1 WHERE id = banner_id;
$$ LANGUAGE sql SECURITY DEFINER;
