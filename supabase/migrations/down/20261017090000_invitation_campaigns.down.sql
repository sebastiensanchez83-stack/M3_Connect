-- DOWN for supabase/migrations/20261017090000_invitation_campaigns.sql
-- Removes part 1 of the Invitation campaigns module: the 3 tables (with the campaigns,
-- their guests and the journal), its 8 functions, the 4 storage policies and the bucket
-- "invitation-files" when it is empty. Run part 2's down first (20261017091000; this file
-- also drops part 2's two functions if they are still there, so nothing is left dangling).
-- Dry run: supabase/dryrun/20261017091000_invitation_module.down.dryrun.sql (both downs).
--
-- DATA: campaigns, campaign guests and the journal are DELETED with their tables (export
-- them first if they matter). The guest-list rows the module created or adopted (gl_guest,
-- source 'invitation', or adopted requests) STAY: they are the event's guest list, with
-- their tokens and QR codes already e-mailed; staff manage them in "WYS 2026" as before.
-- Files: Supabase refuses direct deletes from storage tables, so a bucket that still holds
-- files (generated PDFs, letterhead/signature.png) is KEPT, private and with no policy left:
-- nobody but the service role can read it. Empty it from the dashboard, then run this
-- file again to drop it. The SM26 letters lose their signature until it is served again.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop policy if exists invitation_files_staff_select on storage.objects;
drop policy if exists invitation_files_staff_insert on storage.objects;
drop policy if exists invitation_files_staff_update on storage.objects;
drop policy if exists invitation_files_staff_delete on storage.objects;

do $down$
begin
  if exists (select 1 from storage.buckets where id = 'invitation-files')
     and not exists (select 1 from storage.objects where bucket_id = 'invitation-files') then
    perform set_config('storage.allow_delete_query', 'true', true);
    delete from storage.buckets where id = 'invitation-files';
    perform set_config('storage.allow_delete_query', 'false', true);
  else
    raise notice 'invitation_campaigns down: bucket invitation-files kept (it holds files, or is already gone)';
  end if;
end
$down$;

-- Part 2's functions and the duplicate check first, then the tables (their triggers and
-- policies go with them; DROP TABLE fires no row trigger, so the journal's append-only
-- guard does not stop it), then the trigger functions and the helper.
drop function if exists public.invitation_set_answer(uuid, text, boolean);
drop function if exists public.invitation_link_guest(uuid, boolean, boolean);
drop function if exists public.invitation_find_duplicates(uuid, uuid);
drop table if exists public.invitation_log;
drop table if exists public.invitation_recipient;
drop table if exists public.invitation_campaign;
drop function if exists public.invitation_log_append_only();
drop function if exists public.invitation_campaign_log();
drop function if exists public.invitation_campaign_guard();
drop function if exists public.invitation_recipient_log();
drop function if exists public.invitation_recipient_guard();
drop function if exists public.invitation_recipient_normalize();
drop function if exists public.invitation_norm(text, boolean);
