-- DOWN for supabase/migrations/20261021143000_events_hide_drafts.sql
-- The two events policies read as on 21 Oct 2026 again: a draft is readable by its address by
-- anyone (anon: public access level; signed in: per can_access_resource). Harmless for both clients.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter policy events_anon_public on public.events
  using (lower(coalesce(access_level, 'public')) = 'public');

alter policy events_select_by_access_level on public.events
  using (public.is_moderator() or public.can_access_resource(access_level));
