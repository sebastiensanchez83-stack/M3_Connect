-- Events get a cover image of their own. Until now the only event with a photo
-- was the SM26 6th edition, through a hard-coded map in src/lib/siteMedia.ts
-- (EVENT_COVERS); every other card and event page drew a gradient. Admins now
-- upload a cover in Admin -> Events -> (event) -> Cover Image, and the public
-- card and page header prefer it over the hard-coded photo.
--
-- No new bucket: the file goes to `resource-images`, the public bucket the
-- admin already uploads resource thumbnails into. Its policies already match
-- what an event cover needs, and mirror the events table's own write rule
-- (events_write_moderator = is_moderator()):
--   SELECT  public                  bucket_id = 'resource-images'
--   INSERT  authenticated           bucket_id = 'resource-images' and is_moderator()
--   DELETE  authenticated           bucket_id = 'resource-images' and is_moderator()
-- (no UPDATE policy, so the admin uploads under a new name each time and never
-- overwrites). Bucket limits: 5 MB, JPEG/PNG/WebP/GIF; the form resizes to at
-- most 1800x1200 before upload.
--
-- events has table-level grants for anon/authenticated, so the new column is
-- readable by the public events pages (select '*') with no extra grant, and the
-- existing row policies (events_anon_public, events_select_by_access_level)
-- already decide which rows are visible.
--
-- Deploy order: apply this before the front end ships, or saving an event in
-- the admin fails ("Could not find the 'image_url' column").
--
-- Undo:
--   alter table public.events drop column if exists image_url;

alter table public.events
  add column if not exists image_url text;

comment on column public.events.image_url is
  'Public URL of the event cover (card + page header). Null = the built-in photo for that event in src/lib/siteMedia.ts EVENT_COVERS, else a gradient.';
