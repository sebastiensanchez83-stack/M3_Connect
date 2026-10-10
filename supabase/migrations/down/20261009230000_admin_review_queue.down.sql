-- DOWN for supabase/migrations/20261009230000_admin_review_queue.sql
--
-- Removes the two read-only functions of the M3 review queue. No data is lost:
-- they only read. Run it only together with a front end that no longer calls
-- them (the refonte's /admin/review page, the "To review" sidebar badge and the
-- dashboard card); a front end that still calls them shows "The review list is
-- not available yet" and no badge, nothing breaks.

drop function if exists public.admin_review_queue_count();
drop function if exists public.admin_review_queue();
