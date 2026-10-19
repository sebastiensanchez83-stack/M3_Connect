-- DOWN for supabase/migrations/20261017093000_invitation_adopt_request.sql
-- Drops invitation_relink_guest, invitation_mark_sent, invitation_unadopt_request and
-- invitation_adopt_request. Run it
-- before step 1's downs (20261017091000, then 20261017090000). Stop the edge function
-- invitation-campaign first: without these functions it can no longer adopt a request or
-- record a send (it then reports an error and sends nothing more).
-- Dry run: supabase/dryrun/20261017093000_invitation_adopt_request.down.dryrun.sql.
--
-- DATA: nothing is deleted or changed. Requests adopted into a campaign stay 'invited' on the
-- guest list (their invitation went out, with their token); the gl_email_log lines and the
-- journal lines stay.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop function if exists public.invitation_relink_guest(uuid, boolean, uuid);
drop function if exists public.invitation_mark_sent(uuid, uuid, boolean, text);
drop function if exists public.invitation_unadopt_request(uuid, uuid);
drop function if exists public.invitation_adopt_request(uuid, boolean, uuid);
