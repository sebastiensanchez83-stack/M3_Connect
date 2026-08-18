-- The architecture deadline gated exactly one thing: rows in sm_architecture_file,
-- written only through sm_architecture_file_add / _remove. Everything else an
-- entrant can do to their submission was still open afterwards:
--
--   * event_media_update_own let them re-upload over their own existing panel
--     path (upsert:true) — same row, new PDF, and the jury is served the new one.
--   * event_media_delete_own let them delete the bytes, leaving the row and the
--     admin's file count intact while the jury's links 404.
--   * event_media_insert_own let bytes land even when the RPC then refused the
--     row, leaving orphans in the bucket.
--   * sm_architecture_entry carries one ALL policy with no deadline clause, so
--     project_renders stayed editable forever — and for 10 of the 12 live
--     entries the renders ARE the submission.
--
-- None of that is reachable through the UI, which hides the controls once the
-- date passes. All of it is reachable through the API with a normal user token.
--
-- Fixed narrowly. The storage policies above are shared by every event-media
-- upload on the platform (e-catalogue, marina evidence, decks, logistics
-- photos), so they are NOT modified — a RESTRICTIVE policy is added instead,
-- which can only ever narrow, and which short-circuits to "allowed" for any
-- other bucket and any path outside the architecture submission folder.

-- Is this object a locked SM26 architecture submission for THIS caller?
-- Submission paths are <user_id>/architecture/<role_assignment_id>/<file>, so
-- segment 2 is the discriminator. Staff are never locked — they have to be able
-- to fix a broken entry after the close.
create or replace function public.sm_architecture_upload_locked(p_name text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select case
    when p_name is null then false
    when (storage.foldername(p_name))[2] is distinct from 'architecture' then false
    when public.sm_is_staff() then false
    else exists (
      select 1 from public.sm_event e
       where e.slug = 'sm26'
         and e.settings->>'architecture_closes_at' is not null
         -- Same comparison as sm_architecture_file_add: the whole of the chosen
         -- day stays open, and it shuts at 00:00 Monaco the next morning.
         and to_char(now() at time zone 'Europe/Monaco', 'YYYY-MM-DD')
             > (e.settings->>'architecture_closes_at'))
  end;
$function$;

comment on function public.sm_architecture_upload_locked(text) is
  'True when this event-media object is an SM26 architecture submission whose deadline has passed, for a non-staff caller.';

-- RESTRICTIVE: AND-ed with the permissive policies, so it can only take access
-- away. Scoped `to authenticated` — service_role bypasses RLS entirely and the
-- importer must keep working.
drop policy if exists event_media_arch_closed_insert on storage.objects;
drop policy if exists event_media_arch_closed_update on storage.objects;
drop policy if exists event_media_arch_closed_delete on storage.objects;

create policy event_media_arch_closed_insert on storage.objects
  as restrictive for insert to authenticated
  with check (bucket_id <> 'event-media' or not public.sm_architecture_upload_locked(name));

create policy event_media_arch_closed_update on storage.objects
  as restrictive for update to authenticated
  using (bucket_id <> 'event-media' or not public.sm_architecture_upload_locked(name))
  with check (bucket_id <> 'event-media' or not public.sm_architecture_upload_locked(name));

create policy event_media_arch_closed_delete on storage.objects
  as restrictive for delete to authenticated
  using (bucket_id <> 'event-media' or not public.sm_architecture_upload_locked(name));

-- project_renders is the submission for the imported entries, so it freezes on
-- the same date. Everything else on the row — the e-catalogue company fields —
-- is governed by the general edit deadline (edit_locks_at) and must stay
-- editable, which is why this is a column-level trigger and not a policy.
create or replace function public.sm_architecture_freeze_renders()
returns trigger
language plpgsql
as $function$
begin
  if new.project_renders is distinct from old.project_renders
     -- service_role runs the importer and sm26-register; RLS does not apply to
     -- it but triggers do, so exempt it explicitly or the import breaks.
     and current_user <> 'service_role'
     and not public.sm_is_staff()
     and exists (
       select 1 from public.sm_event e
        where e.id = new.event_id
          and e.settings->>'architecture_closes_at' is not null
          and to_char(now() at time zone 'Europe/Monaco', 'YYYY-MM-DD')
              > (e.settings->>'architecture_closes_at'))
  then
    raise exception 'Submissions are closed';
  end if;
  return new;
end $function$;

drop trigger if exists trg_sm_architecture_freeze_renders on public.sm_architecture_entry;
create trigger trg_sm_architecture_freeze_renders
  before update on public.sm_architecture_entry
  for each row execute function public.sm_architecture_freeze_renders();
