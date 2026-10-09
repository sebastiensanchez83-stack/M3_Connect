-- SM26 is over: participants can no longer change their registration, and the
-- database now enforces it (until now only the browser did).
-- Victor, 8 Oct 2026: "Smart Marina 2026 is over. Participants can no longer
-- modify their registration. Lock it in the database too; the SM26 admin must
-- keep working fully."
--
-- ════════════════════════════════════════════════════════════════════════════
-- What was still open (read-only audit of production, 9 Oct 2026)
-- ════════════════════════════════════════════════════════════════════════════
-- sm_event 'sm26' (c43ecba2-…) carries edit_locks_at = roster_locks_at =
-- '2026-09-21'. edit_locks_at was read by nobody but the browser
-- (useSm26EditLock.ts); roster_locks_at also by the sm_attendee_guard trigger and
-- by sm26-attendee-invite (sm_roster_locked). With a participant's own JWT:
--   RLS, participant branch = sm_can_access_registration / sm_owns_role_assignment
--     sm_registration_update            UPDATE  any column the guard triggers allow
--     sm_role_assignment_modify         ALL     module_data, status 'info_provided',
--                                               and DELETE, which cascades to the
--                                               e-catalogue page, jury reviews and
--                                               assignments, votes, ballot entries
--     sm_logistics_rw, sm_logistics_item_rw            ALL
--     sm_startup_owner, sm_architecture_owner,
--     sm_marina_extra_owner                            ALL
--     sm_ecat_comment_insert            INSERT
--     sm_attendee_rw                    ALL     (already refused by the trigger)
--   SECURITY DEFINER RPCs (they run as postgres, so no policy ever applies):
--     sm_restart_registration (deletes the caller's registration), sm_confirm_attendees,
--     sm_set_onsite_attendance, sm_ensure_module_row, sm_ecat_respond,
--     sm_ecat_apply_to_profile, sm_book_workshop, sm_switch_workshop,
--     sm_cancel_workshop, sm_startup_set_attendance, sm_startup_confirm_by_token
--     (anon, e-mailed token link).
--
-- ════════════════════════════════════════════════════════════════════════════
-- What this migration changes
-- ════════════════════════════════════════════════════════════════════════════
-- 1. public.sm_participant_edits_locked(p_event_id uuid, p_scope text default
--    'registration') returns boolean. STABLE, SECURITY DEFINER, search_path ''.
--    True when the caller is NOT staff and the event's deadline has passed:
--    settings.edit_locks_at, or settings.roster_locks_at when p_scope = 'roster'.
--      * staff = sm_is_staff() (verified admin or moderator), the test every SM26
--        admin console, admin RPC and staff policy already uses;
--      * 'YYYY-MM-DD' = open through that day in sm_event.timezone, locked from
--        00:00 the next day (sm_deadline_instant: the browser's and
--        sm_roster_locked's reading); any other value is read as a timestamp;
--      * no key, unknown event or null id: not locked; unreadable value: locked
--        (fail closed; staff already returned false);
--      * generic: the next edition locks on its own dates.
--    EXECUTE for anon and authenticated: the policies evaluate it as the caller,
--    and it only reveals a boolean.
-- 2. RLS: one RESTRICTIVE policy per participant-writable table and write command
--    (23, all named *_while_editable): not sm_participant_edits_locked(event_id).
--    Restrictive policies are AND-ed with the permissive ones, so each table now
--    reads "staff OR (participant AND not locked)": the staff branch stays open
--    and the existing policies are left byte-identical.
--    Why not add the clause inside the existing FOR ALL policies: their USING is
--    also the participants' ONLY read path on sm_attendee, sm_logistics,
--    sm_logistics_item, sm_startup_profile, sm_architecture_entry and
--    sm_marina_extra (none has a separate SELECT policy), so the read-only
--    dashboard would have lost the roster, logistics and module rows.
--    Not added: INSERT on sm_registration (new registrations follow
--    sm_registrations_open(), closed since 20261007124519), DELETE on
--    sm_registration (no permissive policy).
--    Scopes: sm_attendee follows roster_locks_at; everything else edit_locks_at.
-- 3. The 11 RPCs above: CREATE OR REPLACE with the exact current definition
--    (pg_get_functiondef, md5-checked by the precondition block) plus ONE block,
--    marked "-- Edition over:", that raises
--      'Smart Marina 2026 is over: registrations can no longer be changed.'
--    for a non-staff caller once locked. It sits after the existing sign-in /
--    authorisation checks and before the first write. Nothing else changes:
--    signature, defaults, SECURITY DEFINER, search_path, owner, ACL (kept by
--    CREATE OR REPLACE). Staff calls pass (AdminSM26Detail calls
--    sm_set_onsite_attendance and sm_ensure_module_row). sm_confirm_attendees
--    uses the roster scope (it is the roster's "confirmed" stamp).
--    sm_startup_confirm_by_token: the check is inside the "answer given" branch,
--    so the e-mailed link still SHOWS the pitch slot.
--    The precondition refuses to run if any of the 11 bodies changed since they
--    were read (md5 of prosrc = the reviewed body, or the patched body on a re-run).
--    The file is committed with LF endings, like production's bodies; apply it
--    from the committed blob if possible (a Windows checkout has CRLF, which only
--    adds carriage returns to the bodies; the checks ignore them).
--
-- ════════════════════════════════════════════════════════════════════════════
-- Deliberately NOT locked
-- ════════════════════════════════════════════════════════════════════════════
--   sm_claim_registration, sm_autoclaim_by_email: they only link an imported
--     registration to its person's account (the dashboard relies on it). They run
--     as postgres, so the new policies do not see their writes, nor those of the
--     triggers they fire (sm_link_primary_attendee writes sm_attendee).
--   Feedback: policy sm_feedback_response_own, sm_feedback_submit_public.
--   Networking: sm_my_networking_pass, sm_networking_pass_create, sm_connect_scan.
--   Public name vote (still open on 9 Oct: sm_public_vote_status() lists
--     architecture_pro and innovation): sm_public_cast_votes, vote tables.
--   Jury and architecture review (own close dates, 20261007124519): sm_review,
--     sm_criterion_score, the *_by_token scorers, sm_jury_set_availability,
--     sm_jury_availability_by_token.
--   Architecture submission files: sm_architecture_file_add/_remove, the
--     event-media "architecture" folder and project_renders are already closed by
--     architecture_closes_at (2026-08-19, 20260818120000). The other
--     sm_architecture_entry columns ARE locked here.
--   Session Q&A (sm_ask_question, sm_toggle_question_vote), notifications (mark
--     read), media-kit view stamps: not registration data.
--   Yacht Club partner RPCs (sm_partner_*, sm_catalogue_listing_set) and
--     sm_logistics_decide: partner/staff actions, not participant edits.
--   Staff-only RPCs, sm_ensure_badges, imports and edge functions using the
--     service role (it bypasses RLS), gl_* (WYS guest list), anything not sm_*.
--
-- Edge functions: none needs a change or a redeploy. The participant-facing
--   writers are sm26-register and sm26-draft (new registrations and drafts,
--   403 while sm_registrations_open() is false) and sm26-attendee-invite (403
--   for non-staff once sm_roster_locked()). Every other sm26-* function is
--   staff-, cron-, partner- or token-gated, inert, or read-only.
-- Front end: SM26_EDITION_OVER already hides every edit path. The raised message
--   reaches the existing toasts through error.message; SM26StartupRsvpPage now
--   maps it too.
--
-- ════════════════════════════════════════════════════════════════════════════
-- UNDO
-- ════════════════════════════════════════════════════════════════════════════
-- Reopen without code (config only), e.g. until the end of the year:
--   update public.sm_event
--      set settings = settings || '{"edit_locks_at": "2026-12-31", "roster_locks_at": "2026-12-31"}'
--    where slug = 'sm26';
--   (the admin Health tab sets the same keys through sm_set_edit_deadline /
--   sm_set_roster_deadline).
-- Full revert, in this order:
--   1. drop the 23 policies:
--      drop policy if exists sm_registration_update_while_editable on public.sm_registration;
--      drop policy if exists sm_role_assignment_insert_while_editable on public.sm_role_assignment;
--      drop policy if exists sm_role_assignment_update_while_editable on public.sm_role_assignment;
--      drop policy if exists sm_role_assignment_delete_while_editable on public.sm_role_assignment;
--      drop policy if exists sm_attendee_insert_while_editable on public.sm_attendee;
--      drop policy if exists sm_attendee_update_while_editable on public.sm_attendee;
--      drop policy if exists sm_attendee_delete_while_editable on public.sm_attendee;
--      drop policy if exists sm_logistics_insert_while_editable on public.sm_logistics;
--      drop policy if exists sm_logistics_update_while_editable on public.sm_logistics;
--      drop policy if exists sm_logistics_delete_while_editable on public.sm_logistics;
--      drop policy if exists sm_logistics_item_insert_while_editable on public.sm_logistics_item;
--      drop policy if exists sm_logistics_item_update_while_editable on public.sm_logistics_item;
--      drop policy if exists sm_logistics_item_delete_while_editable on public.sm_logistics_item;
--      drop policy if exists sm_startup_profile_insert_while_editable on public.sm_startup_profile;
--      drop policy if exists sm_startup_profile_update_while_editable on public.sm_startup_profile;
--      drop policy if exists sm_startup_profile_delete_while_editable on public.sm_startup_profile;
--      drop policy if exists sm_architecture_entry_insert_while_editable on public.sm_architecture_entry;
--      drop policy if exists sm_architecture_entry_update_while_editable on public.sm_architecture_entry;
--      drop policy if exists sm_architecture_entry_delete_while_editable on public.sm_architecture_entry;
--      drop policy if exists sm_marina_extra_insert_while_editable on public.sm_marina_extra;
--      drop policy if exists sm_marina_extra_update_while_editable on public.sm_marina_extra;
--      drop policy if exists sm_marina_extra_delete_while_editable on public.sm_marina_extra;
--      drop policy if exists sm_ecat_comment_insert_while_editable on public.sm_ecat_comment;
--   2. re-create the 11 functions from the previous definitions below (= the
--      bodies in this file minus each 4-line "-- Edition over:" block);
--   3. drop function if exists public.sm_participant_edits_locked(uuid, text);
--
-- Existing policies: NOT modified by this migration. For reference, at 9 Oct 2026:
--   sm_registration_update     UPDATE public  using/check (sm_can_access_registration(id) OR sm_is_staff())
--   sm_role_assignment_modify  ALL    public  using/check (sm_can_access_registration(registration_id) OR sm_is_staff())
--   sm_attendee_rw             ALL    authenticated  using/check (sm_is_staff() OR sm_can_access_registration(registration_id))
--   sm_logistics_rw            ALL    public  using/check (sm_can_access_registration(registration_id) OR sm_is_staff())
--   sm_logistics_item_rw       ALL    public  using/check (sm_can_access_registration(registration_id) OR sm_is_staff())
--   sm_startup_owner           ALL    public  using/check (sm_owns_role_assignment(role_assignment_id) OR sm_is_staff())
--   sm_architecture_owner      ALL    public  using/check (sm_owns_role_assignment(role_assignment_id) OR sm_is_staff())
--   sm_marina_extra_owner      ALL    public  using/check (sm_owns_role_assignment(role_assignment_id) OR sm_is_staff())
--   sm_ecat_comment_insert     INSERT authenticated  check (EXISTS (SELECT 1 FROM sm_ecat_page p JOIN sm_registration r
--                              ON r.id = p.registration_id WHERE p.id = sm_ecat_comment.ecat_page_id
--                              AND (r.user_id = auth.uid() OR sm_is_staff())))
--
-- Previous function definitions (pg_get_functiondef, production, 9 Oct 2026):
--
-- ── sm_restart_registration ── md5(prosrc) 7528623091de09b5b1d9cdfb87beff18
-- CREATE OR REPLACE FUNCTION public.sm_restart_registration(p_event_id uuid)
--  RETURNS jsonb
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public', 'pg_temp'
-- AS $function$
-- declare v_reg uuid; v_status text; v_settled boolean; v_n int;
-- begin
--   if auth.uid() is null then raise exception 'Not authorized'; end if;
--   select r.id, r.status into v_reg, v_status
--   from sm_registration r
--   where r.event_id = p_event_id and r.user_id = auth.uid()
--   order by r.created_at desc limit 1;
--   if v_reg is null then return jsonb_build_object('deleted', false, 'reason', 'none'); end if;
--   if v_status not in ('submitted','cancelled','waitlist') then
--     return jsonb_build_object('deleted', false, 'reason', 'status');
--   end if;
--   select exists(select 1 from sm_payment p where p.registration_id = v_reg and p.status in ('paid','waived')) into v_settled;
--   if v_settled then return jsonb_build_object('deleted', false, 'reason', 'settled'); end if;
--   delete from sm_registration r where r.id = v_reg;
--   get diagnostics v_n = row_count;
--   return jsonb_build_object('deleted', v_n > 0, 'reason', case when v_n > 0 then 'ok' else 'none' end);
-- end
-- $function$
-- ;
--
-- ── sm_confirm_attendees ── md5(prosrc) 8933eeb78bad25c0f8bd2d3753336b77
-- CREATE OR REPLACE FUNCTION public.sm_confirm_attendees(p_registration_id uuid, p_confirmed boolean DEFAULT true)
--  RETURNS timestamp with time zone
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- declare v_ts timestamptz;
-- begin
--   if not (sm_is_staff() or sm_can_access_registration(p_registration_id)) then
--     raise exception 'Not authorized';
--   end if;
--   v_ts := case when p_confirmed then now() else null end;
--   update sm_registration set attendees_confirmed_at = v_ts, updated_at = now() where id = p_registration_id;
--   return v_ts;
-- end $function$
-- ;
--
-- ── sm_set_onsite_attendance ── md5(prosrc) 1b330aca1f5691c4295550d5146dd21d
-- CREATE OR REPLACE FUNCTION public.sm_set_onsite_attendance(p_role_assignment_id uuid, p_attending boolean)
--  RETURNS boolean
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- declare v_reg uuid; v_event uuid; v_has_other boolean; v_att uuid; v_email text;
-- begin
--   select ra.registration_id, ra.event_id into v_reg, v_event
--   from sm_role_assignment ra where ra.id = p_role_assignment_id and ra.role = 'jury';
--   if v_reg is null then raise exception 'Not a jury role'; end if;
--   if not (public.sm_is_staff() or public.sm_can_access_registration(v_reg)) then
--     raise exception 'Not authorized';
--   end if;
--
--   update sm_role_assignment
--     set module_data = coalesce(module_data, '{}'::jsonb)
--                       || jsonb_build_object('onsite_attendance', case when p_attending then 'yes' else 'no' end)
--     where id = p_role_assignment_id;
--
--   select lower(trim(coalesce(email, ''))) into v_email from sm_registration where id = v_reg;
--
--   select id into v_att from (
--     select a.id,
--            case
--              when a.is_primary then 1
--              when v_email <> '' and lower(trim(coalesce(a.email, ''))) = v_email then 2
--              else 3
--            end as rank,
--            count(*) over () as total
--       from sm_attendee a
--      where a.registration_id = v_reg
--   ) c
--    where c.rank < 3 or c.total = 1
--    order by c.rank, c.id
--    limit 1;
--
--   v_has_other := exists (select 1 from sm_role_assignment ra
--                           where ra.registration_id = v_reg and ra.role <> 'jury'
--                             and ra.status <> 'declined');
--
--   if v_att is not null then
--     if p_attending or v_has_other then
--       insert into sm_badge (event_id, registration_id, attendee_id, checkin_token)
--       select v_event, v_reg, v_att, replace(gen_random_uuid()::text, '-', '')
--       where not exists (select 1 from sm_badge b where b.attendee_id = v_att);
--     else
--       -- Never strip a badge from someone already through the door.
--       delete from sm_badge b where b.attendee_id = v_att
--         and not exists (select 1 from sm_checkin c where c.attendee_id = v_att);
--     end if;
--   end if;
--
--   return p_attending;
-- end $function$
-- ;
--
-- ── sm_ensure_module_row ── md5(prosrc) 7d52947375c15a230ab206e992fbef99
-- CREATE OR REPLACE FUNCTION public.sm_ensure_module_row(p_role_assignment_id uuid, p_allow_architecture boolean DEFAULT false)
--  RETURNS text
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public', 'pg_temp'
-- AS $function$
-- declare v_role text; v_event uuid;
-- begin
--   if not (sm_owns_role_assignment(p_role_assignment_id) or sm_is_staff()) then
--     raise exception 'Not authorized';
--   end if;
--
--   select ra.role, r.event_id into v_role, v_event
--     from sm_role_assignment ra
--     join sm_registration r on r.id = ra.registration_id
--    where ra.id = p_role_assignment_id;
--   if v_role is null then raise exception 'role assignment not found'; end if;
--
--   if v_role = 'startup' then
--     insert into sm_startup_profile (role_assignment_id, event_id)
--       values (p_role_assignment_id, v_event)
--       on conflict (role_assignment_id) do nothing;
--     return 'sm_startup_profile';
--   elsif v_role = 'marina' then
--     insert into sm_marina_extra (role_assignment_id, event_id)
--       values (p_role_assignment_id, v_event)
--       on conflict (role_assignment_id) do nothing;
--     return 'sm_marina_extra';
--   elsif v_role in ('architect_pro', 'architect_student') and p_allow_architecture then
--     insert into sm_architecture_entry (role_assignment_id, event_id)
--       values (p_role_assignment_id, v_event)
--       on conflict (role_assignment_id) do nothing;
--     return 'sm_architecture_entry';
--   end if;
--
--   return 'none';
-- end $function$
-- ;
--
-- ── sm_ecat_respond ── md5(prosrc) d3df7c405c70682fbd24c6509826c1a1
-- CREATE OR REPLACE FUNCTION public.sm_ecat_respond(p_page_id uuid, p_action text, p_comment text DEFAULT NULL::text, p_attachments text[] DEFAULT NULL::text[])
--  RETURNS void
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public', 'pg_temp'
-- AS $function$
-- declare v_status text; v_reg uuid; v_has_note boolean; v_has_files boolean;
-- begin
--   select p.registration_id, p.status into v_reg, v_status from sm_ecat_page p where p.id = p_page_id;
--   if not public.sm_can_access_registration(v_reg) then raise exception 'not authorized'; end if;
--   if v_status <> 'uploaded' then raise exception 'no page awaiting your review'; end if;
--   if p_action = 'approve' then
--     update sm_ecat_page set status='approved', updated_at=now() where id=p_page_id;
--   elsif p_action = 'request_changes' then
--     v_has_note := p_comment is not null and length(trim(p_comment)) > 0;
--     v_has_files := p_attachments is not null and coalesce(array_length(p_attachments, 1), 0) > 0;
--     if not (v_has_note or v_has_files) then
--       raise exception 'Please describe the changes you would like';
--     end if;
--     update sm_ecat_page set status='changes_requested', updated_at=now() where id=p_page_id;
--     insert into sm_ecat_comment (ecat_page_id, author_user_id, author_role, body, attachment_paths)
--     values (p_page_id, auth.uid(), 'participant', trim(coalesce(p_comment,'')), p_attachments);
--   else
--     raise exception 'invalid action';
--   end if;
-- end $function$
-- ;
--
-- ── sm_ecat_apply_to_profile ── md5(prosrc) ab3db4cb83822b873c76326d8ea7ade0
-- CREATE OR REPLACE FUNCTION public.sm_ecat_apply_to_profile(p_page_id uuid, p_path text, p_field_key text)
--  RETURNS void
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public', 'pg_temp'
-- AS $function$
-- declare v_reg uuid; v_ra uuid; v_role text; v_md jsonb; v_is_array boolean; v_alias text;
-- begin
--   if p_path is null or length(trim(p_path))=0 or p_field_key is null or length(trim(p_field_key))=0 then
--     raise exception 'missing arguments';
--   end if;
--   if split_part(p_path, '/', 1) <> auth.uid()::text then
--     raise exception 'path not owned by caller';
--   end if;
--   select p.registration_id, p.role_assignment_id into v_reg, v_ra from sm_ecat_page p where p.id = p_page_id;
--   if v_ra is null then raise exception 'page not found'; end if;
--   if not public.sm_can_access_registration(v_reg) then raise exception 'not authorized'; end if;
--   select ra.role, coalesce(ra.module_data,'{}'::jsonb) into v_role, v_md from sm_role_assignment ra where ra.id = v_ra;
--
--   v_is_array := p_field_key in ('product_images','project_renders','renders','panels','slides');
--   if v_is_array then
--     v_md := jsonb_set(v_md, array[p_field_key],
--       (case when jsonb_typeof(v_md->p_field_key)='array' then v_md->p_field_key else '[]'::jsonb end) || to_jsonb(p_path), true);
--   else
--     v_alias := case when right(p_field_key,4)='_url' then left(p_field_key, length(p_field_key)-4) else p_field_key||'_url' end;
--     v_md := jsonb_set(v_md, array[p_field_key], jsonb_build_array(p_path), true);
--     if v_alias <> p_field_key then v_md := v_md - v_alias; end if;
--   end if;
--   update sm_role_assignment set module_data = v_md where id = v_ra;
--
--   if v_role = 'startup' then
--     -- Every update below matches on role_assignment_id and is zero-row tolerant.
--     -- Make the row exist rather than write into nothing and report success.
--     insert into sm_startup_profile (role_assignment_id, event_id)
--       select v_ra, r.event_id from sm_registration r where r.id = v_reg
--       on conflict (role_assignment_id) do nothing;
--     if p_field_key in ('logo','logo_url') then
--       update sm_startup_profile set logo_url = p_path where role_assignment_id = v_ra;
--     elsif p_field_key in ('deck','deck_url') then
--       update sm_startup_profile set deck_url = p_path where role_assignment_id = v_ra;
--     elsif p_field_key in ('pitch_media','pitch_media_url') then
--       update sm_startup_profile set pitch_media_url = p_path where role_assignment_id = v_ra;
--     elsif p_field_key = 'product_images' then
--       update sm_startup_profile set product_images = array_append(coalesce(product_images, '{}'::text[]), p_path) where role_assignment_id = v_ra;
--     end if;
--   end if;
-- end $function$
-- ;
--
-- ── sm_book_workshop ── md5(prosrc) 151a41ab78ba911808cde759b7ef8b67
-- CREATE OR REPLACE FUNCTION public.sm_book_workshop(p_session_id uuid)
--  RETURNS text
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public', 'pg_temp'
-- AS $function$
-- declare v_event uuid; v_cap int; v_type text; v_day date; v_booked int; v_uid uuid := auth.uid(); v_existing uuid;
-- begin
--   if v_uid is null then raise exception 'authentication required'; end if;
--   select event_id, capacity, type, date(starts_at) into v_event, v_cap, v_type, v_day
--     from sm_session where id = p_session_id for update;          -- serialise per session
--   if v_event is null then raise exception 'session not found'; end if;
--   if v_type <> 'workshop' then raise exception 'not a workshop'; end if;
--   select session_id into v_existing from sm_workshop_booking
--     where user_id = v_uid and event_id = v_event and day_date = v_day;
--   if v_existing is not null then
--     if v_existing = p_session_id then return 'already_booked'; end if;
--     raise exception 'You already have a workshop booked that day';
--   end if;
--   select count(*) into v_booked from sm_workshop_booking where session_id = p_session_id and status = 'booked';
--   if v_cap is null or v_booked < v_cap then
--     insert into sm_workshop_booking (event_id, session_id, user_id, day_date, status)
--       values (v_event, p_session_id, v_uid, v_day, 'booked');
--     return 'booked';
--   else
--     insert into sm_workshop_booking (event_id, session_id, user_id, day_date, status, waitlist_pos)
--       values (v_event, p_session_id, v_uid, v_day, 'waitlisted',
--         coalesce((select max(waitlist_pos) from sm_workshop_booking where session_id = p_session_id and status = 'waitlisted'), 0) + 1);
--     return 'waitlisted';
--   end if;
-- end $function$
-- ;
--
-- ── sm_switch_workshop ── md5(prosrc) 5060d29703d2a4c04f64c7d0f891eee9
-- CREATE OR REPLACE FUNCTION public.sm_switch_workshop(p_session_id uuid)
--  RETURNS text
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public', 'pg_temp'
-- AS $function$
-- declare
--   v_uid uuid := auth.uid();
--   v_event uuid; v_cap int; v_type text; v_day date; v_title text;
--   v_booked int; v_from uuid; v_from_status text; v_from_title text; v_promote uuid;
-- begin
--   if v_uid is null then raise exception 'authentication required'; end if;
--
--   select event_id, capacity, type, date(starts_at), title
--     into v_event, v_cap, v_type, v_day, v_title
--     from sm_session where id = p_session_id;
--   if v_event is null then raise exception 'session not found'; end if;
--   if v_type <> 'workshop' then raise exception 'not a workshop'; end if;
--
--   select session_id, status into v_from, v_from_status
--     from sm_workshop_booking
--    where user_id = v_uid and event_id = v_event and day_date = v_day;
--   if v_from is null then raise exception 'NO_BOOKING: nothing booked that day'; end if;
--   if v_from = p_session_id then return 'already_booked'; end if;
--
--   -- Both rooms, locked in id order. Two people switching in opposite
--   -- directions at the same moment would otherwise be able to deadlock.
--   perform id from sm_session where id in (p_session_id, v_from) order by id for update;
--
--   select count(*) into v_booked from sm_workshop_booking
--     where session_id = p_session_id and status = 'booked';
--   if v_cap is not null and v_booked >= v_cap then
--     select title into v_from_title from sm_session where id = v_from;
--     raise exception 'FULL: % is full, so you have been left in %.', v_title, v_from_title;
--   end if;
--
--   delete from sm_workshop_booking where session_id = v_from and user_id = v_uid;
--
--   -- Only a confirmed seat frees a seat; leaving a waitlist frees nothing.
--   if v_from_status = 'booked' then
--     select user_id into v_promote from sm_workshop_booking
--       where session_id = v_from and status = 'waitlisted'
--       order by waitlist_pos asc limit 1;
--     if v_promote is not null then
--       select title into v_from_title from sm_session where id = v_from;
--       update sm_workshop_booking set status = 'booked', waitlist_pos = null
--         where session_id = v_from and user_id = v_promote;
--       insert into sm_notification (user_id, type, title, body, link)
--         values (v_promote, 'sm26_workshop_promoted', 'A workshop seat opened up',
--                 'You''ve been moved off the waitlist into ' || v_from_title || '.', '/sm26/me');
--     end if;
--   end if;
--
--   insert into sm_workshop_booking (event_id, session_id, user_id, day_date, status)
--     values (v_event, p_session_id, v_uid, v_day, 'booked');
--   return 'booked';
-- end $function$
-- ;
--
-- ── sm_cancel_workshop ── md5(prosrc) 3a096e68ed057247584404aec9cbd2af
-- CREATE OR REPLACE FUNCTION public.sm_cancel_workshop(p_session_id uuid)
--  RETURNS text
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public', 'pg_temp'
-- AS $function$
-- declare v_uid uuid := auth.uid(); v_was text; v_promote uuid;
-- begin
--   if v_uid is null then raise exception 'authentication required'; end if;
--   perform 1 from sm_session where id = p_session_id for update;
--   select status into v_was from sm_workshop_booking where session_id = p_session_id and user_id = v_uid;
--   if v_was is null then return 'not_booked'; end if;
--   delete from sm_workshop_booking where session_id = p_session_id and user_id = v_uid;
--   if v_was = 'booked' then
--     select user_id into v_promote from sm_workshop_booking
--       where session_id = p_session_id and status = 'waitlisted' order by waitlist_pos asc limit 1;
--     if v_promote is not null then
--       update sm_workshop_booking set status = 'booked', waitlist_pos = null
--         where session_id = p_session_id and user_id = v_promote;
--       insert into sm_notification (user_id, type, title, body, link)
--         values (v_promote, 'sm26_workshop_promoted', 'A workshop seat opened up',
--                 'You''ve been moved off the waitlist into a workshop. Check the agenda.', '/sm26/agenda');
--     end if;
--   end if;
--   return 'cancelled';
-- end $function$
-- ;
--
-- ── sm_startup_set_attendance ── md5(prosrc) 149752432da55a2362a3b4f101349ea1
-- CREATE OR REPLACE FUNCTION public.sm_startup_set_attendance(p_session_id uuid, p_answer text)
--  RETURNS void
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- declare v_new text; v_hit int;
-- begin
--   if auth.uid() is null then raise exception 'Not authorized'; end if;
--   v_new := case lower(coalesce(p_answer,''))
--              when 'confirmed' then 'confirmed'
--              when 'declined' then 'declined'
--              else null end;
--   if v_new is null then raise exception 'Invalid answer'; end if;
--
--   update sm_jury_session_entry se
--      set status = v_new, responded_at = now()
--    where se.session_id = p_session_id
--      and exists (
--        select 1 from sm_role_assignment ra
--        join sm_registration r on r.id = ra.registration_id
--        where ra.id = se.entry_role_assignment_id
--          and sm_can_access_registration(r.id)
--      );
--   get diagnostics v_hit = row_count;
--   if v_hit = 0 then raise exception 'You are not in this session'; end if;
-- end $function$
-- ;
--
-- ── sm_startup_confirm_by_token ── md5(prosrc) 5d1c76455e054a68d2550c012d897c0e
-- CREATE OR REPLACE FUNCTION public.sm_startup_confirm_by_token(p_token text, p_answer text)
--  RETURNS jsonb
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- declare
--   v_row sm_jury_session_entry%rowtype;
--   v_new text;
--   v_s record;
--   v_e record;
--   v_company text;
--   v_first text;
-- begin
--   if coalesce(p_token, '') = '' then
--     return jsonb_build_object('ok', false, 'error', 'missing_token');
--   end if;
--
--   v_new := case lower(coalesce(p_answer, ''))
--              when 'confirmed' then 'confirmed'
--              when 'declined' then 'declined'
--              else null end;
--
--   select * into v_row from sm_jury_session_entry where token = p_token;
--   if not found then
--     return jsonb_build_object('ok', false, 'error', 'invalid_token');
--   end if;
--
--   select s.id, s.title, s.slot_label, s.scheduled_at, s.duration_minutes, s.status,
--          s.zoom_sent, s.zoom_join_url, s.event_id,
--          (select count(*) from sm_jury_session_juror sj where sj.session_id = s.id) as juror_count,
--          (select count(*) from sm_jury_session_entry se where se.session_id = s.id) as startup_count
--     into v_s
--     from sm_jury_session s where s.id = v_row.session_id;
--
--   select e.name, e.venue, e.start_date, e.end_date, e.timezone, e.settings->>'edition_label' as edition
--     into v_e from sm_event e where e.id = v_s.event_id;
--
--   select coalesce(nullif(trim(r.company_name), ''),
--                   nullif(trim(coalesce(r.first_name,'') || ' ' || coalesce(r.last_name,'')), ''),
--                   'your company'),
--          coalesce(nullif(trim(r.first_name), ''), 'there')
--     into v_company, v_first
--     from sm_role_assignment ra
--     join sm_registration r on r.id = ra.registration_id
--    where ra.id = v_row.entry_role_assignment_id;
--
--   if v_s.status = 'cancelled' then
--     return jsonb_build_object('ok', false, 'error', 'cancelled', 'title', v_s.title);
--   end if;
--
--   -- No answer in the URL means "just show me the slot": the landing page reads
--   -- the details first and the person clicks a button there. Following a link
--   -- from an inbox must never commit an answer the reader did not choose.
--   if v_new is not null then
--     update sm_jury_session_entry
--        set status = v_new, responded_at = now()
--      where session_id = v_row.session_id
--        and entry_role_assignment_id = v_row.entry_role_assignment_id
--      returning status into v_new;
--   else
--     v_new := v_row.status;
--   end if;
--
--   return jsonb_build_object(
--     'ok', true, 'status', v_new, 'company', v_company, 'first_name', v_first,
--     'session', jsonb_build_object(
--       'title', v_s.title, 'slot_label', v_s.slot_label, 'scheduled_at', v_s.scheduled_at,
--       'duration_minutes', v_s.duration_minutes,
--       'juror_count', v_s.juror_count, 'startup_count', v_s.startup_count,
--       'zoom_sent', v_s.zoom_sent,
--       -- The Zoom link is only real once it has actually been sent.
--       'zoom_join_url', case when v_s.zoom_sent then v_s.zoom_join_url else null end),
--     'event', jsonb_build_object(
--       'name', v_e.name, 'venue', v_e.venue, 'start_date', v_e.start_date,
--       'end_date', v_e.end_date, 'timezone', v_e.timezone, 'edition_label', v_e.edition));
-- end $function$
-- ;

-- ─── 0. Precondition: the 11 bodies are still the ones this file was built from ──
do $pre$
declare
  r record;
  v_md5 text;
begin
  for r in
    select * from (values
      ('public.sm_restart_registration(uuid)', '7528623091de09b5b1d9cdfb87beff18', '8645da374cacd1bfab19c41bad3b1204'),
      ('public.sm_confirm_attendees(uuid, boolean)', '8933eeb78bad25c0f8bd2d3753336b77', '5207c34f2083b122280c21aec567d350'),
      ('public.sm_set_onsite_attendance(uuid, boolean)', '1b330aca1f5691c4295550d5146dd21d', '156d91c3e479363a43b01cf85096a921'),
      ('public.sm_ensure_module_row(uuid, boolean)', '7d52947375c15a230ab206e992fbef99', '5ad7008715ba3e3f7d7de9beee6ebea0'),
      ('public.sm_ecat_respond(uuid, text, text, text[])', 'd3df7c405c70682fbd24c6509826c1a1', 'ceb4e61f4b99d1f1580899721e042f8e'),
      ('public.sm_ecat_apply_to_profile(uuid, text, text)', 'ab3db4cb83822b873c76326d8ea7ade0', '12d393c58462562b218dcb5c89dddb31'),
      ('public.sm_book_workshop(uuid)', '151a41ab78ba911808cde759b7ef8b67', '5da1e23e2c9043b14f7d788eed76f142'),
      ('public.sm_switch_workshop(uuid)', '5060d29703d2a4c04f64c7d0f891eee9', '7752c87470a512417bc10d065c9ea22a'),
      ('public.sm_cancel_workshop(uuid)', '3a096e68ed057247584404aec9cbd2af', 'dbe46248a1aa2ab7dae7c400258ba36a'),
      ('public.sm_startup_set_attendance(uuid, text)', '149752432da55a2362a3b4f101349ea1', '5a1d28df7036e18d1b553b5a1d7c2ac1'),
      ('public.sm_startup_confirm_by_token(text, text)', '5d1c76455e054a68d2550c012d897c0e', '936e21598779fce4eba352bf943a6a26')
    ) v(fn, reviewed_md5, patched_md5)
  loop
    -- chr(13) stripped: a CRLF working copy of this file must not look like drift.
    select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p where p.oid = r.fn::regprocedure;
    if v_md5 is distinct from r.reviewed_md5 and v_md5 is distinct from r.patched_md5 then
      raise exception 'sm26 participant lock: % changed since 9 Oct 2026 (md5 %); re-read it with pg_get_functiondef and rebuild this migration', r.fn, v_md5;
    end if;
  end loop;
end
$pre$;

-- ─── 1. The guard ────────────────────────────────────────────────────────────
create or replace function public.sm_participant_edits_locked(p_event_id uuid, p_scope text default 'registration')
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_raw   text;
  v_tz    text;
  v_close timestamptz;
begin
  -- No event to lock against: leave the decision to the caller's other checks.
  if p_event_id is null then
    return false;
  end if;
  -- Staff (verified admin / moderator) are never locked: the admin consoles keep working.
  if public.sm_is_staff() then
    return false;
  end if;

  select nullif(btrim(e.settings ->> (case when p_scope = 'roster' then 'roster_locks_at' else 'edit_locks_at' end)), ''),
         e.timezone
    into v_raw, v_tz
    from public.sm_event e
   where e.id = p_event_id;

  -- Unknown event, or no deadline set: open (the browser reads it the same way).
  if v_raw is null then
    return false;
  end if;

  -- 'YYYY-MM-DD': open through that day in the event's timezone, locked from
  -- 00:00 the next day. Anything else is read as a timestamp. The exception
  -- block sits here, not around the whole body, so staff and events without a
  -- deadline never open a sub-transaction (policies call this once per row).
  begin
    v_close := public.sm_deadline_instant(v_raw, v_tz);
  exception when others then
    return true;  -- unreadable deadline: fail closed (staff returned above)
  end;
  return v_close is not null and now() >= v_close;
end
$function$;

comment on function public.sm_participant_edits_locked(uuid, text) is
  'True when the caller is not SM staff and the event''s participant deadline has passed '
  '(settings.edit_locks_at, or roster_locks_at for p_scope = ''roster''). Used by the '
  '*_while_editable RLS policies and the participant RPCs. 20261009160000.';

revoke all on function public.sm_participant_edits_locked(uuid, text) from public;
grant execute on function public.sm_participant_edits_locked(uuid, text) to anon, authenticated, service_role;

-- ─── 2. RLS: restrictive write policies (staff OR not locked) ────────────────
drop policy if exists sm_registration_update_while_editable on public.sm_registration;
create policy sm_registration_update_while_editable on public.sm_registration
  as restrictive for update
  using (not public.sm_participant_edits_locked(event_id))
  with check (not public.sm_participant_edits_locked(event_id));

drop policy if exists sm_role_assignment_insert_while_editable on public.sm_role_assignment;
create policy sm_role_assignment_insert_while_editable on public.sm_role_assignment
  as restrictive for insert
  with check (not public.sm_participant_edits_locked(event_id));

drop policy if exists sm_role_assignment_update_while_editable on public.sm_role_assignment;
create policy sm_role_assignment_update_while_editable on public.sm_role_assignment
  as restrictive for update
  using (not public.sm_participant_edits_locked(event_id))
  with check (not public.sm_participant_edits_locked(event_id));

drop policy if exists sm_role_assignment_delete_while_editable on public.sm_role_assignment;
create policy sm_role_assignment_delete_while_editable on public.sm_role_assignment
  as restrictive for delete
  using (not public.sm_participant_edits_locked(event_id));

drop policy if exists sm_attendee_insert_while_editable on public.sm_attendee;
create policy sm_attendee_insert_while_editable on public.sm_attendee
  as restrictive for insert
  with check (not public.sm_participant_edits_locked(event_id, 'roster'));

drop policy if exists sm_attendee_update_while_editable on public.sm_attendee;
create policy sm_attendee_update_while_editable on public.sm_attendee
  as restrictive for update
  using (not public.sm_participant_edits_locked(event_id, 'roster'))
  with check (not public.sm_participant_edits_locked(event_id, 'roster'));

drop policy if exists sm_attendee_delete_while_editable on public.sm_attendee;
create policy sm_attendee_delete_while_editable on public.sm_attendee
  as restrictive for delete
  using (not public.sm_participant_edits_locked(event_id, 'roster'));

drop policy if exists sm_logistics_insert_while_editable on public.sm_logistics;
create policy sm_logistics_insert_while_editable on public.sm_logistics
  as restrictive for insert
  with check (not public.sm_participant_edits_locked(event_id));

drop policy if exists sm_logistics_update_while_editable on public.sm_logistics;
create policy sm_logistics_update_while_editable on public.sm_logistics
  as restrictive for update
  using (not public.sm_participant_edits_locked(event_id))
  with check (not public.sm_participant_edits_locked(event_id));

drop policy if exists sm_logistics_delete_while_editable on public.sm_logistics;
create policy sm_logistics_delete_while_editable on public.sm_logistics
  as restrictive for delete
  using (not public.sm_participant_edits_locked(event_id));

drop policy if exists sm_logistics_item_insert_while_editable on public.sm_logistics_item;
create policy sm_logistics_item_insert_while_editable on public.sm_logistics_item
  as restrictive for insert
  with check (not public.sm_participant_edits_locked(event_id));

drop policy if exists sm_logistics_item_update_while_editable on public.sm_logistics_item;
create policy sm_logistics_item_update_while_editable on public.sm_logistics_item
  as restrictive for update
  using (not public.sm_participant_edits_locked(event_id))
  with check (not public.sm_participant_edits_locked(event_id));

drop policy if exists sm_logistics_item_delete_while_editable on public.sm_logistics_item;
create policy sm_logistics_item_delete_while_editable on public.sm_logistics_item
  as restrictive for delete
  using (not public.sm_participant_edits_locked(event_id));

drop policy if exists sm_startup_profile_insert_while_editable on public.sm_startup_profile;
create policy sm_startup_profile_insert_while_editable on public.sm_startup_profile
  as restrictive for insert
  with check (not public.sm_participant_edits_locked(event_id));

drop policy if exists sm_startup_profile_update_while_editable on public.sm_startup_profile;
create policy sm_startup_profile_update_while_editable on public.sm_startup_profile
  as restrictive for update
  using (not public.sm_participant_edits_locked(event_id))
  with check (not public.sm_participant_edits_locked(event_id));

drop policy if exists sm_startup_profile_delete_while_editable on public.sm_startup_profile;
create policy sm_startup_profile_delete_while_editable on public.sm_startup_profile
  as restrictive for delete
  using (not public.sm_participant_edits_locked(event_id));

drop policy if exists sm_architecture_entry_insert_while_editable on public.sm_architecture_entry;
create policy sm_architecture_entry_insert_while_editable on public.sm_architecture_entry
  as restrictive for insert
  with check (not public.sm_participant_edits_locked(event_id));

drop policy if exists sm_architecture_entry_update_while_editable on public.sm_architecture_entry;
create policy sm_architecture_entry_update_while_editable on public.sm_architecture_entry
  as restrictive for update
  using (not public.sm_participant_edits_locked(event_id))
  with check (not public.sm_participant_edits_locked(event_id));

drop policy if exists sm_architecture_entry_delete_while_editable on public.sm_architecture_entry;
create policy sm_architecture_entry_delete_while_editable on public.sm_architecture_entry
  as restrictive for delete
  using (not public.sm_participant_edits_locked(event_id));

drop policy if exists sm_marina_extra_insert_while_editable on public.sm_marina_extra;
create policy sm_marina_extra_insert_while_editable on public.sm_marina_extra
  as restrictive for insert
  with check (not public.sm_participant_edits_locked(event_id));

drop policy if exists sm_marina_extra_update_while_editable on public.sm_marina_extra;
create policy sm_marina_extra_update_while_editable on public.sm_marina_extra
  as restrictive for update
  using (not public.sm_participant_edits_locked(event_id))
  with check (not public.sm_participant_edits_locked(event_id));

drop policy if exists sm_marina_extra_delete_while_editable on public.sm_marina_extra;
create policy sm_marina_extra_delete_while_editable on public.sm_marina_extra
  as restrictive for delete
  using (not public.sm_participant_edits_locked(event_id));

drop policy if exists sm_ecat_comment_insert_while_editable on public.sm_ecat_comment;
create policy sm_ecat_comment_insert_while_editable on public.sm_ecat_comment
  as restrictive for insert
  with check (not public.sm_participant_edits_locked((select p.event_id from public.sm_ecat_page p where p.id = sm_ecat_comment.ecat_page_id)));

-- ─── 3. Participant RPCs: same definitions + one "Edition over" check ─────────
CREATE OR REPLACE FUNCTION public.sm_restart_registration(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_reg uuid; v_status text; v_settled boolean; v_n int;
begin
  if auth.uid() is null then raise exception 'Not authorized'; end if;
  -- Edition over: participants can no longer change this; staff still can (sm_participant_edits_locked).
  if public.sm_participant_edits_locked(p_event_id) then
    raise exception 'Smart Marina 2026 is over: registrations can no longer be changed.';
  end if;
  select r.id, r.status into v_reg, v_status
  from sm_registration r
  where r.event_id = p_event_id and r.user_id = auth.uid()
  order by r.created_at desc limit 1;
  if v_reg is null then return jsonb_build_object('deleted', false, 'reason', 'none'); end if;
  if v_status not in ('submitted','cancelled','waitlist') then
    return jsonb_build_object('deleted', false, 'reason', 'status');
  end if;
  select exists(select 1 from sm_payment p where p.registration_id = v_reg and p.status in ('paid','waived')) into v_settled;
  if v_settled then return jsonb_build_object('deleted', false, 'reason', 'settled'); end if;
  delete from sm_registration r where r.id = v_reg;
  get diagnostics v_n = row_count;
  return jsonb_build_object('deleted', v_n > 0, 'reason', case when v_n > 0 then 'ok' else 'none' end);
end
$function$;

CREATE OR REPLACE FUNCTION public.sm_confirm_attendees(p_registration_id uuid, p_confirmed boolean DEFAULT true)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_ts timestamptz;
begin
  if not (sm_is_staff() or sm_can_access_registration(p_registration_id)) then
    raise exception 'Not authorized';
  end if;
  -- Edition over: participants can no longer change this; staff still can (sm_participant_edits_locked).
  if public.sm_participant_edits_locked((select r.event_id from public.sm_registration r where r.id = p_registration_id), 'roster') then
    raise exception 'Smart Marina 2026 is over: registrations can no longer be changed.';
  end if;
  v_ts := case when p_confirmed then now() else null end;
  update sm_registration set attendees_confirmed_at = v_ts, updated_at = now() where id = p_registration_id;
  return v_ts;
end $function$;

CREATE OR REPLACE FUNCTION public.sm_set_onsite_attendance(p_role_assignment_id uuid, p_attending boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_reg uuid; v_event uuid; v_has_other boolean; v_att uuid; v_email text;
begin
  select ra.registration_id, ra.event_id into v_reg, v_event
  from sm_role_assignment ra where ra.id = p_role_assignment_id and ra.role = 'jury';
  if v_reg is null then raise exception 'Not a jury role'; end if;
  if not (public.sm_is_staff() or public.sm_can_access_registration(v_reg)) then
    raise exception 'Not authorized';
  end if;
  -- Edition over: participants can no longer change this; staff still can (sm_participant_edits_locked).
  if public.sm_participant_edits_locked(v_event) then
    raise exception 'Smart Marina 2026 is over: registrations can no longer be changed.';
  end if;

  update sm_role_assignment
    set module_data = coalesce(module_data, '{}'::jsonb)
                      || jsonb_build_object('onsite_attendance', case when p_attending then 'yes' else 'no' end)
    where id = p_role_assignment_id;

  select lower(trim(coalesce(email, ''))) into v_email from sm_registration where id = v_reg;

  select id into v_att from (
    select a.id,
           case
             when a.is_primary then 1
             when v_email <> '' and lower(trim(coalesce(a.email, ''))) = v_email then 2
             else 3
           end as rank,
           count(*) over () as total
      from sm_attendee a
     where a.registration_id = v_reg
  ) c
   where c.rank < 3 or c.total = 1
   order by c.rank, c.id
   limit 1;

  v_has_other := exists (select 1 from sm_role_assignment ra
                          where ra.registration_id = v_reg and ra.role <> 'jury'
                            and ra.status <> 'declined');

  if v_att is not null then
    if p_attending or v_has_other then
      insert into sm_badge (event_id, registration_id, attendee_id, checkin_token)
      select v_event, v_reg, v_att, replace(gen_random_uuid()::text, '-', '')
      where not exists (select 1 from sm_badge b where b.attendee_id = v_att);
    else
      -- Never strip a badge from someone already through the door.
      delete from sm_badge b where b.attendee_id = v_att
        and not exists (select 1 from sm_checkin c where c.attendee_id = v_att);
    end if;
  end if;

  return p_attending;
end $function$;

CREATE OR REPLACE FUNCTION public.sm_ensure_module_row(p_role_assignment_id uuid, p_allow_architecture boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_role text; v_event uuid;
begin
  if not (sm_owns_role_assignment(p_role_assignment_id) or sm_is_staff()) then
    raise exception 'Not authorized';
  end if;

  select ra.role, r.event_id into v_role, v_event
    from sm_role_assignment ra
    join sm_registration r on r.id = ra.registration_id
   where ra.id = p_role_assignment_id;
  if v_role is null then raise exception 'role assignment not found'; end if;
  -- Edition over: participants can no longer change this; staff still can (sm_participant_edits_locked).
  if public.sm_participant_edits_locked(v_event) then
    raise exception 'Smart Marina 2026 is over: registrations can no longer be changed.';
  end if;

  if v_role = 'startup' then
    insert into sm_startup_profile (role_assignment_id, event_id)
      values (p_role_assignment_id, v_event)
      on conflict (role_assignment_id) do nothing;
    return 'sm_startup_profile';
  elsif v_role = 'marina' then
    insert into sm_marina_extra (role_assignment_id, event_id)
      values (p_role_assignment_id, v_event)
      on conflict (role_assignment_id) do nothing;
    return 'sm_marina_extra';
  elsif v_role in ('architect_pro', 'architect_student') and p_allow_architecture then
    insert into sm_architecture_entry (role_assignment_id, event_id)
      values (p_role_assignment_id, v_event)
      on conflict (role_assignment_id) do nothing;
    return 'sm_architecture_entry';
  end if;

  return 'none';
end $function$;

CREATE OR REPLACE FUNCTION public.sm_ecat_respond(p_page_id uuid, p_action text, p_comment text DEFAULT NULL::text, p_attachments text[] DEFAULT NULL::text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_status text; v_reg uuid; v_has_note boolean; v_has_files boolean;
begin
  select p.registration_id, p.status into v_reg, v_status from sm_ecat_page p where p.id = p_page_id;
  if not public.sm_can_access_registration(v_reg) then raise exception 'not authorized'; end if;
  -- Edition over: participants can no longer change this; staff still can (sm_participant_edits_locked).
  if public.sm_participant_edits_locked((select p.event_id from public.sm_ecat_page p where p.id = p_page_id)) then
    raise exception 'Smart Marina 2026 is over: registrations can no longer be changed.';
  end if;
  if v_status <> 'uploaded' then raise exception 'no page awaiting your review'; end if;
  if p_action = 'approve' then
    update sm_ecat_page set status='approved', updated_at=now() where id=p_page_id;
  elsif p_action = 'request_changes' then
    v_has_note := p_comment is not null and length(trim(p_comment)) > 0;
    v_has_files := p_attachments is not null and coalesce(array_length(p_attachments, 1), 0) > 0;
    if not (v_has_note or v_has_files) then
      raise exception 'Please describe the changes you would like';
    end if;
    update sm_ecat_page set status='changes_requested', updated_at=now() where id=p_page_id;
    insert into sm_ecat_comment (ecat_page_id, author_user_id, author_role, body, attachment_paths)
    values (p_page_id, auth.uid(), 'participant', trim(coalesce(p_comment,'')), p_attachments);
  else
    raise exception 'invalid action';
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.sm_ecat_apply_to_profile(p_page_id uuid, p_path text, p_field_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_reg uuid; v_ra uuid; v_role text; v_md jsonb; v_is_array boolean; v_alias text;
begin
  if p_path is null or length(trim(p_path))=0 or p_field_key is null or length(trim(p_field_key))=0 then
    raise exception 'missing arguments';
  end if;
  if split_part(p_path, '/', 1) <> auth.uid()::text then
    raise exception 'path not owned by caller';
  end if;
  select p.registration_id, p.role_assignment_id into v_reg, v_ra from sm_ecat_page p where p.id = p_page_id;
  if v_ra is null then raise exception 'page not found'; end if;
  if not public.sm_can_access_registration(v_reg) then raise exception 'not authorized'; end if;
  -- Edition over: participants can no longer change this; staff still can (sm_participant_edits_locked).
  if public.sm_participant_edits_locked((select r.event_id from public.sm_registration r where r.id = v_reg)) then
    raise exception 'Smart Marina 2026 is over: registrations can no longer be changed.';
  end if;
  select ra.role, coalesce(ra.module_data,'{}'::jsonb) into v_role, v_md from sm_role_assignment ra where ra.id = v_ra;

  v_is_array := p_field_key in ('product_images','project_renders','renders','panels','slides');
  if v_is_array then
    v_md := jsonb_set(v_md, array[p_field_key],
      (case when jsonb_typeof(v_md->p_field_key)='array' then v_md->p_field_key else '[]'::jsonb end) || to_jsonb(p_path), true);
  else
    v_alias := case when right(p_field_key,4)='_url' then left(p_field_key, length(p_field_key)-4) else p_field_key||'_url' end;
    v_md := jsonb_set(v_md, array[p_field_key], jsonb_build_array(p_path), true);
    if v_alias <> p_field_key then v_md := v_md - v_alias; end if;
  end if;
  update sm_role_assignment set module_data = v_md where id = v_ra;

  if v_role = 'startup' then
    -- Every update below matches on role_assignment_id and is zero-row tolerant.
    -- Make the row exist rather than write into nothing and report success.
    insert into sm_startup_profile (role_assignment_id, event_id)
      select v_ra, r.event_id from sm_registration r where r.id = v_reg
      on conflict (role_assignment_id) do nothing;
    if p_field_key in ('logo','logo_url') then
      update sm_startup_profile set logo_url = p_path where role_assignment_id = v_ra;
    elsif p_field_key in ('deck','deck_url') then
      update sm_startup_profile set deck_url = p_path where role_assignment_id = v_ra;
    elsif p_field_key in ('pitch_media','pitch_media_url') then
      update sm_startup_profile set pitch_media_url = p_path where role_assignment_id = v_ra;
    elsif p_field_key = 'product_images' then
      update sm_startup_profile set product_images = array_append(coalesce(product_images, '{}'::text[]), p_path) where role_assignment_id = v_ra;
    end if;
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.sm_book_workshop(p_session_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_event uuid; v_cap int; v_type text; v_day date; v_booked int; v_uid uuid := auth.uid(); v_existing uuid;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  select event_id, capacity, type, date(starts_at) into v_event, v_cap, v_type, v_day
    from sm_session where id = p_session_id for update;          -- serialise per session
  if v_event is null then raise exception 'session not found'; end if;
  if v_type <> 'workshop' then raise exception 'not a workshop'; end if;
  -- Edition over: participants can no longer change this; staff still can (sm_participant_edits_locked).
  if public.sm_participant_edits_locked(v_event) then
    raise exception 'Smart Marina 2026 is over: registrations can no longer be changed.';
  end if;
  select session_id into v_existing from sm_workshop_booking
    where user_id = v_uid and event_id = v_event and day_date = v_day;
  if v_existing is not null then
    if v_existing = p_session_id then return 'already_booked'; end if;
    raise exception 'You already have a workshop booked that day';
  end if;
  select count(*) into v_booked from sm_workshop_booking where session_id = p_session_id and status = 'booked';
  if v_cap is null or v_booked < v_cap then
    insert into sm_workshop_booking (event_id, session_id, user_id, day_date, status)
      values (v_event, p_session_id, v_uid, v_day, 'booked');
    return 'booked';
  else
    insert into sm_workshop_booking (event_id, session_id, user_id, day_date, status, waitlist_pos)
      values (v_event, p_session_id, v_uid, v_day, 'waitlisted',
        coalesce((select max(waitlist_pos) from sm_workshop_booking where session_id = p_session_id and status = 'waitlisted'), 0) + 1);
    return 'waitlisted';
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.sm_switch_workshop(p_session_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_event uuid; v_cap int; v_type text; v_day date; v_title text;
  v_booked int; v_from uuid; v_from_status text; v_from_title text; v_promote uuid;
begin
  if v_uid is null then raise exception 'authentication required'; end if;

  select event_id, capacity, type, date(starts_at), title
    into v_event, v_cap, v_type, v_day, v_title
    from sm_session where id = p_session_id;
  if v_event is null then raise exception 'session not found'; end if;
  if v_type <> 'workshop' then raise exception 'not a workshop'; end if;
  -- Edition over: participants can no longer change this; staff still can (sm_participant_edits_locked).
  if public.sm_participant_edits_locked(v_event) then
    raise exception 'Smart Marina 2026 is over: registrations can no longer be changed.';
  end if;

  select session_id, status into v_from, v_from_status
    from sm_workshop_booking
   where user_id = v_uid and event_id = v_event and day_date = v_day;
  if v_from is null then raise exception 'NO_BOOKING: nothing booked that day'; end if;
  if v_from = p_session_id then return 'already_booked'; end if;

  -- Both rooms, locked in id order. Two people switching in opposite
  -- directions at the same moment would otherwise be able to deadlock.
  perform id from sm_session where id in (p_session_id, v_from) order by id for update;

  select count(*) into v_booked from sm_workshop_booking
    where session_id = p_session_id and status = 'booked';
  if v_cap is not null and v_booked >= v_cap then
    select title into v_from_title from sm_session where id = v_from;
    raise exception 'FULL: % is full, so you have been left in %.', v_title, v_from_title;
  end if;

  delete from sm_workshop_booking where session_id = v_from and user_id = v_uid;

  -- Only a confirmed seat frees a seat; leaving a waitlist frees nothing.
  if v_from_status = 'booked' then
    select user_id into v_promote from sm_workshop_booking
      where session_id = v_from and status = 'waitlisted'
      order by waitlist_pos asc limit 1;
    if v_promote is not null then
      select title into v_from_title from sm_session where id = v_from;
      update sm_workshop_booking set status = 'booked', waitlist_pos = null
        where session_id = v_from and user_id = v_promote;
      insert into sm_notification (user_id, type, title, body, link)
        values (v_promote, 'sm26_workshop_promoted', 'A workshop seat opened up',
                'You''ve been moved off the waitlist into ' || v_from_title || '.', '/sm26/me');
    end if;
  end if;

  insert into sm_workshop_booking (event_id, session_id, user_id, day_date, status)
    values (v_event, p_session_id, v_uid, v_day, 'booked');
  return 'booked';
end $function$;

CREATE OR REPLACE FUNCTION public.sm_cancel_workshop(p_session_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid := auth.uid(); v_was text; v_promote uuid;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  -- Edition over: participants can no longer change this; staff still can (sm_participant_edits_locked).
  if public.sm_participant_edits_locked((select s.event_id from public.sm_session s where s.id = p_session_id)) then
    raise exception 'Smart Marina 2026 is over: registrations can no longer be changed.';
  end if;
  perform 1 from sm_session where id = p_session_id for update;
  select status into v_was from sm_workshop_booking where session_id = p_session_id and user_id = v_uid;
  if v_was is null then return 'not_booked'; end if;
  delete from sm_workshop_booking where session_id = p_session_id and user_id = v_uid;
  if v_was = 'booked' then
    select user_id into v_promote from sm_workshop_booking
      where session_id = p_session_id and status = 'waitlisted' order by waitlist_pos asc limit 1;
    if v_promote is not null then
      update sm_workshop_booking set status = 'booked', waitlist_pos = null
        where session_id = p_session_id and user_id = v_promote;
      insert into sm_notification (user_id, type, title, body, link)
        values (v_promote, 'sm26_workshop_promoted', 'A workshop seat opened up',
                'You''ve been moved off the waitlist into a workshop. Check the agenda.', '/sm26/agenda');
    end if;
  end if;
  return 'cancelled';
end $function$;

CREATE OR REPLACE FUNCTION public.sm_startup_set_attendance(p_session_id uuid, p_answer text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_new text; v_hit int;
begin
  if auth.uid() is null then raise exception 'Not authorized'; end if;
  v_new := case lower(coalesce(p_answer,''))
             when 'confirmed' then 'confirmed'
             when 'declined' then 'declined'
             else null end;
  if v_new is null then raise exception 'Invalid answer'; end if;
  -- Edition over: participants can no longer change this; staff still can (sm_participant_edits_locked).
  if public.sm_participant_edits_locked((select s.event_id from public.sm_jury_session s where s.id = p_session_id)) then
    raise exception 'Smart Marina 2026 is over: registrations can no longer be changed.';
  end if;

  update sm_jury_session_entry se
     set status = v_new, responded_at = now()
   where se.session_id = p_session_id
     and exists (
       select 1 from sm_role_assignment ra
       join sm_registration r on r.id = ra.registration_id
       where ra.id = se.entry_role_assignment_id
         and sm_can_access_registration(r.id)
     );
  get diagnostics v_hit = row_count;
  if v_hit = 0 then raise exception 'You are not in this session'; end if;
end $function$;

CREATE OR REPLACE FUNCTION public.sm_startup_confirm_by_token(p_token text, p_answer text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row sm_jury_session_entry%rowtype;
  v_new text;
  v_s record;
  v_e record;
  v_company text;
  v_first text;
begin
  if coalesce(p_token, '') = '' then
    return jsonb_build_object('ok', false, 'error', 'missing_token');
  end if;

  v_new := case lower(coalesce(p_answer, ''))
             when 'confirmed' then 'confirmed'
             when 'declined' then 'declined'
             else null end;

  select * into v_row from sm_jury_session_entry where token = p_token;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  select s.id, s.title, s.slot_label, s.scheduled_at, s.duration_minutes, s.status,
         s.zoom_sent, s.zoom_join_url, s.event_id,
         (select count(*) from sm_jury_session_juror sj where sj.session_id = s.id) as juror_count,
         (select count(*) from sm_jury_session_entry se where se.session_id = s.id) as startup_count
    into v_s
    from sm_jury_session s where s.id = v_row.session_id;

  select e.name, e.venue, e.start_date, e.end_date, e.timezone, e.settings->>'edition_label' as edition
    into v_e from sm_event e where e.id = v_s.event_id;

  select coalesce(nullif(trim(r.company_name), ''),
                  nullif(trim(coalesce(r.first_name,'') || ' ' || coalesce(r.last_name,'')), ''),
                  'your company'),
         coalesce(nullif(trim(r.first_name), ''), 'there')
    into v_company, v_first
    from sm_role_assignment ra
    join sm_registration r on r.id = ra.registration_id
   where ra.id = v_row.entry_role_assignment_id;

  if v_s.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'error', 'cancelled', 'title', v_s.title);
  end if;

  -- No answer in the URL means "just show me the slot": the landing page reads
  -- the details first and the person clicks a button there. Following a link
  -- from an inbox must never commit an answer the reader did not choose.
  if v_new is not null then
    -- Edition over: participants can no longer change this; staff still can (sm_participant_edits_locked).
    if public.sm_participant_edits_locked(v_s.event_id) then
      raise exception 'Smart Marina 2026 is over: registrations can no longer be changed.';
    end if;
    update sm_jury_session_entry
       set status = v_new, responded_at = now()
     where session_id = v_row.session_id
       and entry_role_assignment_id = v_row.entry_role_assignment_id
     returning status into v_new;
  else
    v_new := v_row.status;
  end if;

  return jsonb_build_object(
    'ok', true, 'status', v_new, 'company', v_company, 'first_name', v_first,
    'session', jsonb_build_object(
      'title', v_s.title, 'slot_label', v_s.slot_label, 'scheduled_at', v_s.scheduled_at,
      'duration_minutes', v_s.duration_minutes,
      'juror_count', v_s.juror_count, 'startup_count', v_s.startup_count,
      'zoom_sent', v_s.zoom_sent,
      -- The Zoom link is only real once it has actually been sent.
      'zoom_join_url', case when v_s.zoom_sent then v_s.zoom_join_url else null end),
    'event', jsonb_build_object(
      'name', v_e.name, 'venue', v_e.venue, 'start_date', v_e.start_date,
      'end_date', v_e.end_date, 'timezone', v_e.timezone, 'edition_label', v_e.edition));
end $function$;
