-- Sponsor banners: allow animated GIF (and WebP, which the admin form already
-- offered but the bucket silently rejected). Files are uploaded as-is (no canvas
-- re-encode), so GIF animation is preserved. Size cap unchanged (10 MB).
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
where id = 'ad-banners';
