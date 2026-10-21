-- Draft events are no longer readable by their address (go-live runbook P2 item 5; Victor, 21 Oct
-- 2026, Q10 = a: "corriges tout de suite").
-- Down: supabase/migrations/down/20261021143000_events_hide_drafts.down.sql
-- Dry run: supabase/dryrun/20261021143000_events_hide_drafts.dryrun.sql (this file, cases as anon,
-- a validated member and M3 staff on a draft, then the down, in one rolled-back transaction).
--
-- SAFE FOR MAIN. Two policies of public.events get the "published" condition; nothing else changes.
--   - Today events_anon_public (anon) and events_select_by_access_level (authenticated, outside its
--     is_moderator() branch) do not look at events.published: anyone who knows the id or the slug
--     of a draft reads it through the API (the 4 events of 21 Oct 2026 are all published, so
--     nothing leaks today; the next draft, SM27 for instance, would).
--   - "Published" is `published is not false`, the rule both clients and the sitemap already use
--     (`.not('published', 'is', false)`, `published=not.is.false`): the column defaults to true
--     and a null counts as published. Staff (public.is_moderator()) still read every draft.
--   - Both clients already hide a draft on screen from everyone but staff (main and refonte
--     EventsPage / EventDetailPage), so no screen changes. The functions that read events are all
--     SECURITY DEFINER (event_slug_lookup already skips drafts, admin_save_event, my_participations,
--     public_registration_events, get_my_event_access...) and are not affected by policies.
--   - NOT here: the webinar meeting link (events.meeting_url) stays readable signed out until
--     go-live, because main reads events with select('*'); its revoke is in
--     held/directory_visitor_basic.sql.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if not exists (select 1 from pg_policies p
                  where p.schemaname = 'public' and p.tablename = 'events' and p.policyname = 'events_anon_public'
                    and p.roles = '{anon}'::name[] and p.cmd = 'SELECT' and p.permissive = 'PERMISSIVE'
                    and p.qual = '(lower(COALESCE(access_level, ''public''::text)) = ''public''::text)') then
    raise exception 'events_hide_drafts: events_anon_public is not as on 21 Oct 2026 (applied already?); rebuild this file';
  end if;
  if not exists (select 1 from pg_policies p
                  where p.schemaname = 'public' and p.tablename = 'events' and p.policyname = 'events_select_by_access_level'
                    and p.roles = '{authenticated}'::name[] and p.cmd = 'SELECT' and p.permissive = 'PERMISSIVE'
                    and p.qual = '(is_moderator() OR can_access_resource(access_level))') then
    raise exception 'events_hide_drafts: events_select_by_access_level is not as on 21 Oct 2026 (applied already?); rebuild this file';
  end if;
  if not exists (select 1 from information_schema.columns c
                  where c.table_schema = 'public' and c.table_name = 'events' and c.column_name = 'published' and c.data_type = 'boolean') then
    raise exception 'events_hide_drafts: events.published (boolean) is missing';
  end if;
end
$pre$;

alter policy events_anon_public on public.events
  using (lower(coalesce(access_level, 'public')) = 'public' and published is not false);

alter policy events_select_by_access_level on public.events
  using (public.is_moderator() or (published is not false and public.can_access_resource(access_level)));
