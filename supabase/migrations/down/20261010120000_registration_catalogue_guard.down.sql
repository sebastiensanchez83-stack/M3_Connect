-- UNDO of supabase/migrations/20261010120000_registration_catalogue_guard.sql
--
-- Removes the two triggers on public.events and their functions. Nothing else changes:
-- no data was written by the migration itself. After this, the old event editor can again
-- write events.meeting_url and delete the catalogue row of a core_v2 event (see the
-- migration header). Run it BEFORE the undo of 20261009210000_registration_core, if both
-- are undone (the guards also survive that order: they read gl_event.engine through to_jsonb).
-- On "canceling statement due to lock timeout": run it again a little later.

set local lock_timeout = '5s';
set local statement_timeout = '120s';

drop trigger if exists events_core_v2_meeting_url on public.events;
drop trigger if exists events_core_v2_delete on public.events;
drop function if exists public.events_core_v2_meeting_url();
drop function if exists public.events_core_v2_delete();
