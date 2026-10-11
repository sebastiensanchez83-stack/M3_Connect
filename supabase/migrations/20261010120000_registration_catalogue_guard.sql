-- Registration core: the old event editor can no longer leak a join link or orphan an event.
-- 10 Oct 2026, integration of the unified-registration Phase 1 (branch rf-reg).
--
-- NOT APPLIED. Apply AFTER 20261009210000_registration_core (it reads gl_event.engine).
-- Dry run: supabase/dryrun/20261010120000_registration_catalogue_guard.dryrun.sql
-- Undo:    supabase/migrations/down/20261010120000_registration_catalogue_guard.down.sql
--
-- Why
--   A core_v2 event (made in the new event editor) has a row in public.events (its
--   catalogue page) and a row in public.gl_event (how people register). The join link of a
--   webinar lives in gl_event.meeting_url only: events.meeting_url is readable through the
--   API by anyone (policy events_anon_public, no "published" filter), drafts included.
--   The OLD event editor (AdminEventDetail, still live on main, and kept on the redesign for
--   the other events) writes events.meeting_url on save and deletes events rows. On a core_v2
--   event that would
--     * publish the join link to anyone who reads the events table, and
--     * delete the catalogue row: gl_event.legacy_event_id becomes NULL (ON DELETE SET NULL),
--       and the orphan registration keeps taking registrations through its link.
--   The redesign routes core_v2 events to the new editor; main cannot be changed. So the
--   rule is held at the table.
--
-- What it adds (two triggers on public.events, nothing else)
--   events_core_v2_meeting_url  BEFORE UPDATE OF meeting_url: on a core_v2 event the
--                               value is forced to NULL (no error: the old editor's save
--                               still goes through). admin_save_event already writes NULL.
--   events_core_v2_delete       BEFORE DELETE: a core_v2 event that has registrations
--                               (any gl_guest row) cannot be deleted (SQLSTATE 23514,
--                               message starts "events_core_v2_delete"). Without
--                               registrations, its gl_event row (and its participation
--                               types and questions, ON DELETE CASCADE) goes with it, so
--                               nothing is left orphaned.
--   Both functions are SECURITY DEFINER (gl_event and gl_guest are staff-only under RLS)
--   and read gl_event.engine through to_jsonb(), so they keep working (and do nothing)
--   if the registration core is ever undone before this file's undo.
--
-- Safety
--   Additive. No core_v2 event exists today except the hidden canary-v2, which has no
--   catalogue row: both triggers change nothing for any existing event, for the old live
--   client or for the guest list (wys26 is guest_list_v1). No sm_* row, no gl_guest token,
--   no policy or grant changes.
--
-- Checks after applying (read-only)
--   select tgname from pg_trigger where tgrelid = 'public.events'::regclass and not tgisinternal order by 1;
--     -> events_core_v2_delete, events_core_v2_meeting_url, events_publish_guard

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $pre$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'gl_event' and column_name = 'engine') then
    raise exception 'registration_catalogue_guard: apply 20261009210000_registration_core first (gl_event.engine is missing)';
  end if;
end
$pre$;

-- The join link of a core_v2 event never goes into its public catalogue row.
create or replace function public.events_core_v2_meeting_url()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if exists (select 1 from public.gl_event g
              where g.legacy_event_id = new.id
                and to_jsonb(g) ->> 'engine' = 'core_v2') then
    new.meeting_url := null;
  end if;
  return new;
end
$function$;

drop trigger if exists events_core_v2_meeting_url on public.events;
create trigger events_core_v2_meeting_url
  before update of meeting_url on public.events
  for each row
  when (new.meeting_url is not null)
  execute function public.events_core_v2_meeting_url();

-- A core_v2 event is deleted with its registration settings, never left orphaned, and
-- never while people are registered.
create or replace function public.events_core_v2_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_gl uuid;
begin
  select g.id into v_gl
    from public.gl_event g
   where g.legacy_event_id = old.id
     and to_jsonb(g) ->> 'engine' = 'core_v2';
  if v_gl is null then
    return old;
  end if;
  if exists (select 1 from public.gl_guest x where x.event_id = v_gl) then
    raise exception using errcode = '23514',
      message = 'events_core_v2_delete: people are registered for this event, so it cannot be deleted',
      hint = 'Unpublish it instead, or ask the developer.';
  end if;
  delete from public.gl_event g where g.id = v_gl;
  return old;
end
$function$;

drop trigger if exists events_core_v2_delete on public.events;
create trigger events_core_v2_delete
  before delete on public.events
  for each row
  execute function public.events_core_v2_delete();

-- Trigger functions only: nobody calls them directly.
revoke all on function public.events_core_v2_meeting_url() from public, anon, authenticated;
revoke all on function public.events_core_v2_delete() from public, anon, authenticated;

comment on function public.events_core_v2_meeting_url() is
  'events trigger (registration_catalogue_guard): a core_v2 event keeps its join link in gl_event.meeting_url only; events.meeting_url is forced to NULL.';
comment on function public.events_core_v2_delete() is
  'events trigger (registration_catalogue_guard): deleting a core_v2 catalogue row also deletes its gl_event; refused (23514) while any gl_guest row exists.';
