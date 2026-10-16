-- DOWN for supabase/migrations/20261017091000_invitation_guest_link.sql
-- Drops invitation_link_guest and invitation_set_answer. Run it before part 1's down.
-- Dry run: supabase/dryrun/20261017091000_invitation_module.down.dryrun.sql (both downs).
--
-- DATA: nothing is deleted. The guest-list rows these functions created or changed (gl_guest
-- 'invited' / 'confirmed' / 'declined') STAY as they are: they are the event's guest list,
-- with tokens and QR codes already e-mailed; staff keep managing them in "WYS 2026".

set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop function if exists public.invitation_set_answer(uuid, text, boolean);
drop function if exists public.invitation_link_guest(uuid, boolean, boolean);
