-- DRY RUN of supabase/migrations/20261009160000_sm26_participant_edit_lock.sql
-- NOTHING IS KEPT.
--
-- How to run: the WHOLE file in ONE execute_sql call (one implicit transaction).
-- Do not add BEGIN/COMMIT and do not run it statement by statement. The last
-- statement ends with RAISE EXCEPTION 'DRYRUN ...', so the migration and every
-- test write roll back; the error text IS the report ("n PASS, m FAIL" first,
-- then one line per check).
--
-- Layout
--   A. snapshot of every policy (public + storage) and of the ACL of every sm_*
--      function, taken before the migration;
--   B. the migration body, verbatim;
--   C. one DO block: structural checks (S1-S4), then the cases. Each case runs in
--      its own sub-transaction as the simulated caller (set local role
--      authenticated/anon + request.jwt.claims), records its outcome, and is rolled
--      back before the next case starts, so cases cannot affect each other.
--      Cases marked OPEN first move edit_locks_at and roster_locks_at to
--      2099-12-31 inside that case only: they show the pre-lock behaviour, i.e.
--      that a LOCKED denial comes from the lock and not from something else.
--
-- Callers (looked up read-only on production, 9 Oct 2026)
--   participant 79a8edb6-81f3-45e4-8af8-80b737294e6e (persona partner, verified),
--     owns confirmed registration af4f3341-e527-48b6-8fd2-dca6deee082b (startup role,
--     3 attendees, logistics, 2 workshop bookings, 2 pitch slots, 1 e-catalogue page)
--   juror e327ed64-c8c6-40ad-a4d1-afb4d59105ef, jury role e62abacf-2cda-4e4f-b115-26bdbf480031
--   staff 9e51b498-d4d9-4a66-91f5-0c4e66185179 (persona admin, verified)
--   claimer: the oldest verified non-staff account with no SM26 registration
--     (resolved at run time), claiming one of the 2 unclaimed imported registrations
--   anon: no sub
--
-- Expectations: LOCKED participant writes and RPCs denied (RPCs with the
-- "Smart Marina 2026 is over" message); claim, autoclaim, feedback, networking
-- pass and reads still work; staff writes and staff RPCs (sm_ensure_badges
-- included) work; anon unchanged; S4: no existing policy or ACL changed, only the
-- 23 new policies and the guard's ACL added.

-- ─── A. Snapshot ─────────────────────────────────────────────────────────────
create temp table _dryrun_before on commit drop as
  select 'acl ' || p.oid::regprocedure::text as k, coalesce(p.proacl::text, '') as v
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'sm\_%'
  union all
  select 'policy ' || schemaname || '.' || tablename || '.' || policyname,
         permissive || '|' || cmd || '|' || roles::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '')
    from pg_policies
   where schemaname in ('public', 'storage');

-- ─── B. The migration: every statement, verbatim (only its header comment is left out)
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


-- ─── C. Checks and cases ─────────────────────────────────────────────────────
do $dryrun$
declare
  c_ev      constant uuid := 'c43ecba2-02d0-49f3-8e7d-36e44be2b551';  -- sm_event 'sm26'
  c_p_uid   constant uuid := '79a8edb6-81f3-45e4-8af8-80b737294e6e';  -- participant
  c_p_reg   constant uuid := 'af4f3341-e527-48b6-8fd2-dca6deee082b';  -- their confirmed registration
  c_j_uid   constant uuid := 'e327ed64-c8c6-40ad-a4d1-afb4d59105ef';  -- participant juror
  c_j_ra    constant uuid := 'e62abacf-2cda-4e4f-b115-26bdbf480031';  -- their jury role assignment
  c_s_uid   constant uuid := '9e51b498-d4d9-4a66-91f5-0c4e66185179';  -- staff (admin, verified)
  c_new_md5 constant jsonb := '{"public.sm_restart_registration(uuid)":"8645da374cacd1bfab19c41bad3b1204","public.sm_confirm_attendees(uuid, boolean)":"5207c34f2083b122280c21aec567d350","public.sm_set_onsite_attendance(uuid, boolean)":"156d91c3e479363a43b01cf85096a921","public.sm_ensure_module_row(uuid, boolean)":"5ad7008715ba3e3f7d7de9beee6ebea0","public.sm_ecat_respond(uuid, text, text, text[])":"ceb4e61f4b99d1f1580899721e042f8e","public.sm_ecat_apply_to_profile(uuid, text, text)":"12d393c58462562b218dcb5c89dddb31","public.sm_book_workshop(uuid)":"5da1e23e2c9043b14f7d788eed76f142","public.sm_switch_workshop(uuid)":"7752c87470a512417bc10d065c9ea22a","public.sm_cancel_workshop(uuid)":"dbe46248a1aa2ab7dae7c400258ba36a","public.sm_startup_set_attendance(uuid, text)":"5a1d28df7036e18d1b553b5a1d7c2ac1","public.sm_startup_confirm_by_token(text, text)":"936e21598779fce4eba352bf943a6a26"}';
  -- resolved below, as postgres, before any role switch
  v_p_ra uuid; v_p_att uuid; v_p_item uuid; v_p_page uuid; v_p_ws uuid; v_p_jsess uuid; v_p_token text;
  v_c_uid uuid; v_c_email text; v_code text; v_unclaimed2 uuid; v_reads text; v_reads_q text;
  v_q_guard text; v_q_reg text; v_q_ra text; v_q_att_ins text; v_q_att_upd text; v_q_log text;
  v_q_item_ins text; v_q_sp text; v_q_comment text; v_q_confirm text; v_q_restart text; v_q_onsite text;
  v_q_module text;
  tests jsonb;
  t jsonb;
  d record;
  v_uid uuid; v_dml boolean; v_ret text; v_n bigint; v_err text; v_exp text; v_pass boolean; v_out text;
  v_added int := 0; v_added_list text := ''; v_bad int := 0;
  n_pass int := 0; n_fail int := 0;
  results text := '';
begin
  -- ── Lookups ────────────────────────────────────────────────────────────────
  select ra.id into v_p_ra from public.sm_role_assignment ra
   where ra.registration_id = c_p_reg and ra.role = 'startup' order by ra.created_at limit 1;
  select a.id into v_p_att from public.sm_attendee a
   where a.registration_id = c_p_reg and not a.is_primary order by a.created_at, a.id limit 1;
  select i.id into v_p_item from public.sm_logistics_item i
   where i.registration_id = c_p_reg order by i.created_at, i.id limit 1;
  select pg.id into v_p_page from public.sm_ecat_page pg where pg.registration_id = c_p_reg limit 1;
  select w.session_id into v_p_ws from public.sm_workshop_booking w
   where w.user_id = c_p_uid and w.event_id = c_ev and w.status = 'booked' order by w.day_date limit 1;
  select se.session_id, se.token into v_p_jsess, v_p_token from public.sm_jury_session_entry se
   where se.entry_role_assignment_id = v_p_ra and se.token is not null order by se.session_id limit 1;
  select pr.user_id, u.email into v_c_uid, v_c_email
    from public.profiles pr join auth.users u on u.id = pr.user_id
   where pr.persona::text not in ('admin', 'moderator') and pr.access_status::text = 'verified'
     and coalesce(u.email, '') <> ''
     and not exists (select 1 from public.sm_registration rg where rg.event_id = c_ev and rg.user_id = pr.user_id)
   order by pr.created_at, pr.user_id limit 1;
  select rg.claim_code into v_code from public.sm_registration rg
   where rg.event_id = c_ev and rg.user_id is null and rg.claim_code is not null order by rg.id limit 1;
  select rg.id into v_unclaimed2 from public.sm_registration rg
   where rg.event_id = c_ev and rg.user_id is null and rg.claim_code is distinct from v_code order by rg.id limit 1;

  if v_p_ra is null or v_p_att is null or v_p_item is null or v_p_page is null or v_p_ws is null
     or v_p_jsess is null or v_c_uid is null or v_code is null or v_unclaimed2 is null then
    n_fail := n_fail + 1;
    results := results || format(E'\nFAIL LOOKUP ra=%s att=%s item=%s page=%s ws=%s jsess=%s claimer=%s code=%s unclaimed2=%s',
      v_p_ra, v_p_att, v_p_item, v_p_page, v_p_ws, v_p_jsess, v_c_uid, v_code is not null, v_unclaimed2);
  end if;

  -- What the participant reads today; D07 must read exactly the same as them.
  v_reads_q := format($q$select format('attendees %%s, logistics %%s, items %%s, roles %%s, startup profile %%s, registration %%s',
      (select count(*) from public.sm_attendee where registration_id = %1$L),
      (select count(*) from public.sm_logistics where registration_id = %1$L),
      (select count(*) from public.sm_logistics_item where registration_id = %1$L),
      (select count(*) from public.sm_role_assignment where registration_id = %1$L),
      (select count(*) from public.sm_startup_profile where role_assignment_id = %2$L),
      (select count(*) from public.sm_registration where id = %1$L))$q$, c_p_reg, v_p_ra);
  execute v_reads_q into v_reads;  -- as postgres: the true counts

  -- ── S1. Each patched function holds exactly the body the migration installs ──
  -- (carriage returns ignored: pasting from a CRLF checkout adds them, harmlessly)
  for d in select key as fn, value #>> '{}' as want_md5 from jsonb_each(c_new_md5) loop
    if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = d.fn::regprocedure) = d.want_md5 then
      n_pass := n_pass + 1;
      results := results || format(E'\nPASS S1 body installed: %s', d.fn);
    else
      n_fail := n_fail + 1;
      results := results || format(E'\nFAIL S1 body differs: %s', d.fn);
    end if;
  end loop;

  -- ── S2. The restrictive policies exist ────────────────────────────────────
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and policyname like '%\_while\_editable' and permissive = 'RESTRICTIVE';
  if v_n = 23 then n_pass := n_pass + 1; else n_fail := n_fail + 1; end if;
  results := results || format(E'\n%s S2 restrictive *_while_editable policies: %s (want 23)',
    case when v_n = 23 then 'PASS' else 'FAIL' end, v_n);

  -- ── S3. The guard: SECURITY DEFINER, STABLE, search_path '' ───────────────
  select p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=""']
    into v_pass from pg_proc p where p.oid = 'public.sm_participant_edits_locked(uuid, text)'::regprocedure;
  if coalesce(v_pass, false) then n_pass := n_pass + 1; else n_fail := n_fail + 1; end if;
  results := results || format(E'\n%s S3 guard is security definer, stable, search_path empty',
    case when coalesce(v_pass, false) then 'PASS' else 'FAIL' end);

  -- ── S4. Nothing else changed: existing policies and sm_* ACLs identical ────
  for d in
    with now_ as (
      select 'acl ' || p.oid::regprocedure::text as k, coalesce(p.proacl::text, '') as v
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname like 'sm\_%'
      union all
      select 'policy ' || pp.schemaname || '.' || pp.tablename || '.' || pp.policyname,
             pp.permissive || '|' || pp.cmd || '|' || pp.roles::text || '|' || coalesce(pp.qual, '') || '|' || coalesce(pp.with_check, '')
        from pg_policies pp
       where pp.schemaname in ('public', 'storage'))
    select coalesce(b.k, x.k) as k, b.v as before_v, x.v as after_v
      from _dryrun_before b full join now_ x on x.k = b.k
     where b.v is distinct from x.v
     order by 1
  loop
    if d.before_v is null then
      v_added := v_added + 1;
      v_added_list := v_added_list || ' ' || d.k;
    else
      v_bad := v_bad + 1;
      results := results || format(E'\nFAIL S4 %s: %s', case when d.after_v is null then 'removed' else 'changed' end, d.k);
    end if;
  end loop;
  if v_bad = 0 and v_added = 23 + 1 then
    n_pass := n_pass + 1;
    results := results || format(E'\nPASS S4 no existing policy or sm_* ACL changed; added %s (23 policies + the guard''s ACL)', v_added);
  else
    n_fail := n_fail + 1;
    results := results || format(E'\nFAIL S4 changed/removed %s, added %s:%s', v_bad, v_added, v_added_list);
  end if;

  -- ── The cases ─────────────────────────────────────────────────────────────
  v_q_guard   := format('select public.sm_participant_edits_locked(%L)::text', c_ev);
  v_q_reg     := format('update public.sm_registration set objective = coalesce(objective, %L) || %L where id = %L', '', ' (dry run)', c_p_reg);
  v_q_ra      := format('update public.sm_role_assignment set module_data = coalesce(module_data, %L::jsonb) || %L::jsonb where id = %L', '{}', '{"_dry_run": true}', v_p_ra);
  v_q_att_ins := format('insert into public.sm_attendee (registration_id, event_id, first_name, last_name, email) values (%L, %L, %L, %L, %L)', c_p_reg, c_ev, 'Dry', 'Run', 'dry-run@example.invalid');
  v_q_att_upd := format('update public.sm_attendee set job_title = coalesce(job_title, %L) where id = %L', '', v_p_att);
  v_q_log     := format('update public.sm_logistics set power_needed = power_needed where registration_id = %L', c_p_reg);
  v_q_item_ins:= format('insert into public.sm_logistics_item (registration_id, event_id) values (%L, %L)', c_p_reg, c_ev);
  v_q_sp      := format('update public.sm_startup_profile set updated_at = now() where role_assignment_id = %L', v_p_ra);
  v_q_comment := format('insert into public.sm_ecat_comment (ecat_page_id, author_user_id, author_role, body) values (%L, %L, %L, %L)', v_p_page, c_p_uid, 'participant', 'dry run');
  v_q_confirm := format('select public.sm_confirm_attendees(%L, true)::text', c_p_reg);
  v_q_restart := format('select public.sm_restart_registration(%L)::text', c_ev);
  v_q_onsite  := format('select public.sm_set_onsite_attendance(%L, true)::text', c_j_ra);
  v_q_module  := format('select public.sm_ensure_module_row(%L)', v_p_ra);

  select jsonb_agg(jsonb_build_object('id', c.id, 'who', c.who, 'open', c.is_open, 'expect', c.expect,
                                      'label', c.label, 'q', c.q, 'setup', c.setup) order by c.ord)
    into tests
    from (values
      -- A. The guard itself
      (101, 'A01', 'participant', false, 'ret:true',  'guard, edit scope', v_q_guard, null::text),
      (102, 'A02', 'participant', false, 'ret:true',  'guard, roster scope', format('select public.sm_participant_edits_locked(%L, %L)::text', c_ev, 'roster'), null),
      (103, 'A03', 'participant', true,  'ret:false', 'guard, deadlines in 2099', v_q_guard, null),
      (104, 'A04', 'staff',       false, 'ret:false', 'guard, staff never locked', v_q_guard, null),
      (105, 'A05', 'anon',        false, 'ret:true',  'guard, anon (a boolean, nothing else)', v_q_guard, null),
      (106, 'A06', 'participant', false, 'ret:false', 'guard, no edit_locks_at key = open', v_q_guard,
            format('update public.sm_event set settings = settings - %L where id = %L', 'edit_locks_at', c_ev)),
      (107, 'A07', 'participant', false, 'ret:true',  'guard, unreadable deadline fails closed', v_q_guard,
            format('update public.sm_event set settings = jsonb_set(settings, %L, %L::jsonb) where id = %L', '{edit_locks_at}', '"not a date"', c_ev)),
      (108, 'A08', 'participant', false, 'ret:false', 'guard, deadline today (Monaco) = open all day', v_q_guard,
            format('update public.sm_event set settings = jsonb_set(settings, %L, to_jsonb(to_char((now() at time zone %L)::date, %L))) where id = %L', '{edit_locks_at}', 'Europe/Monaco', 'YYYY-MM-DD', c_ev)),
      (109, 'A09', 'participant', false, 'ret:true',  'guard, deadline yesterday (Monaco) = locked', v_q_guard,
            format('update public.sm_event set settings = jsonb_set(settings, %L, to_jsonb(to_char((now() at time zone %L)::date - 1, %L))) where id = %L', '{edit_locks_at}', 'Europe/Monaco', 'YYYY-MM-DD', c_ev)),
      (110, 'A10', 'participant', false, 'ret:false', 'guard, null event id', 'select public.sm_participant_edits_locked(null)::text', null),

      -- B. Participant writes through the API (RLS)
      (201, 'B01', 'participant', false, 'deny',  'update own registration', v_q_reg, null),
      (202, 'B01', 'participant', true,  'allow', 'update own registration', v_q_reg, null),
      (203, 'B02', 'participant', false, 'deny',  'update own role assignment module_data', v_q_ra, null),
      (204, 'B02', 'participant', true,  'allow', 'update own role assignment module_data', v_q_ra, null),
      (205, 'B03', 'participant', false, 'deny',  'delete own role assignment (would cascade to reviews, votes, e-catalogue)',
            format('delete from public.sm_role_assignment where id = %L', v_p_ra), null),
      (206, 'B04', 'participant', false, 'deny',  'insert an attendee', v_q_att_ins, null),
      (207, 'B04', 'participant', true,  'allow', 'insert an attendee', v_q_att_ins, null),
      (208, 'B05', 'participant', false, 'deny',  'update an attendee', v_q_att_upd, null),
      (209, 'B05', 'participant', true,  'allow', 'update an attendee', v_q_att_upd, null),
      (210, 'B06', 'participant', false, 'deny',  'delete an attendee', format('delete from public.sm_attendee where id = %L', v_p_att), null),
      (211, 'B06', 'participant', true,  'allow', 'delete an attendee', format('delete from public.sm_attendee where id = %L', v_p_att), null),
      (212, 'B07', 'participant', false, 'deny',  'update logistics', v_q_log, null),
      (213, 'B07', 'participant', true,  'allow', 'update logistics', v_q_log, null),
      (214, 'B08', 'participant', false, 'deny',  'insert a logistics item', v_q_item_ins, null),
      (215, 'B08', 'participant', true,  'allow', 'insert a logistics item', v_q_item_ins, null),
      (216, 'B09', 'participant', false, 'deny',  'update a logistics item', format('update public.sm_logistics_item set needs_approval = needs_approval where id = %L', v_p_item), null),
      (217, 'B09', 'participant', true,  'allow', 'update a logistics item', format('update public.sm_logistics_item set needs_approval = needs_approval where id = %L', v_p_item), null),
      (218, 'B10', 'participant', false, 'deny',  'delete a logistics item', format('delete from public.sm_logistics_item where id = %L', v_p_item), null),
      (219, 'B10', 'participant', true,  'allow', 'delete a logistics item', format('delete from public.sm_logistics_item where id = %L', v_p_item), null),
      (220, 'B11', 'participant', false, 'deny',  'update startup profile', v_q_sp, null),
      (221, 'B11', 'participant', true,  'allow', 'update startup profile', v_q_sp, null),
      (222, 'B12', 'participant', false, 'deny',  'insert a marina module row', format('insert into public.sm_marina_extra (role_assignment_id, event_id) values (%L, %L)', v_p_ra, c_ev), null),
      (223, 'B12', 'participant', true,  'allow', 'insert a marina module row', format('insert into public.sm_marina_extra (role_assignment_id, event_id) values (%L, %L)', v_p_ra, c_ev), null),
      (224, 'B13', 'participant', false, 'deny',  'insert an e-catalogue comment', v_q_comment, null),
      (225, 'B13', 'participant', true,  'allow', 'insert an e-catalogue comment', v_q_comment, null),

      -- C. Participant RPCs (SECURITY DEFINER)
      (301, 'C01', 'participant', false, 'lock',  'sm_restart_registration', v_q_restart, null),
      (302, 'C01', 'participant', true,  'allow', 'sm_restart_registration (confirmed: answers status, deletes nothing)', v_q_restart, null),
      (303, 'C02', 'participant', false, 'lock',  'sm_confirm_attendees', v_q_confirm, null),
      (304, 'C02', 'participant', true,  'allow', 'sm_confirm_attendees', v_q_confirm, null),
      (305, 'C03', 'participant', false, 'lock',  'sm_book_workshop', format('select public.sm_book_workshop(%L)', v_p_ws), null),
      (306, 'C03', 'participant', true,  'ret:already_booked', 'sm_book_workshop', format('select public.sm_book_workshop(%L)', v_p_ws), null),
      (307, 'C04', 'participant', false, 'lock',  'sm_switch_workshop', format('select public.sm_switch_workshop(%L)', v_p_ws), null),
      (308, 'C04', 'participant', true,  'ret:already_booked', 'sm_switch_workshop', format('select public.sm_switch_workshop(%L)', v_p_ws), null),
      (309, 'C05', 'participant', false, 'lock',  'sm_cancel_workshop', format('select public.sm_cancel_workshop(%L)', v_p_ws), null),
      (310, 'C05', 'participant', true,  'ret:cancelled', 'sm_cancel_workshop', format('select public.sm_cancel_workshop(%L)', v_p_ws), null),
      (311, 'C06', 'participant', false, 'lock',  'sm_ecat_respond', format('select public.sm_ecat_respond(%L, %L)::text', v_p_page, 'approve'), null),
      (312, 'C06', 'participant', true,  'info',  'sm_ecat_respond (page already approved: refused on its own)', format('select public.sm_ecat_respond(%L, %L)::text', v_p_page, 'approve'), null),
      (313, 'C07', 'participant', false, 'lock',  'sm_ecat_apply_to_profile', format('select public.sm_ecat_apply_to_profile(%L, %L, %L)::text', v_p_page, c_p_uid::text || '/dry-run/logo.png', 'logo'), null),
      (314, 'C07', 'participant', true,  'allow', 'sm_ecat_apply_to_profile', format('select public.sm_ecat_apply_to_profile(%L, %L, %L)::text', v_p_page, c_p_uid::text || '/dry-run/logo.png', 'logo'), null),
      (315, 'C08', 'participant', false, 'lock',  'sm_startup_set_attendance', format('select public.sm_startup_set_attendance(%L, %L)::text', v_p_jsess, 'confirmed'), null),
      (316, 'C08', 'participant', true,  'allow', 'sm_startup_set_attendance', format('select public.sm_startup_set_attendance(%L, %L)::text', v_p_jsess, 'confirmed'), null),
      (317, 'C09', 'participant', false, 'lock',  'sm_ensure_module_row', v_q_module, null),
      (318, 'C09', 'participant', true,  'ret:sm_startup_profile', 'sm_ensure_module_row', v_q_module, null),
      (319, 'C10', 'juror',       false, 'lock',  'sm_set_onsite_attendance', v_q_onsite, null),
      (320, 'C10', 'juror',       true,  'ret:true', 'sm_set_onsite_attendance', v_q_onsite, null),
      (321, 'C11', 'anon',        false, 'lock',  'sm_startup_confirm_by_token with an answer', format('select public.sm_startup_confirm_by_token(%L, %L) ->> %L', v_p_token, 'confirmed', 'ok'), null),
      (322, 'C11', 'anon',        true,  'ret:true', 'sm_startup_confirm_by_token with an answer', format('select public.sm_startup_confirm_by_token(%L, %L) ->> %L', v_p_token, 'confirmed', 'ok'), null),
      (323, 'C12', 'anon',        false, 'ret:true', 'sm_startup_confirm_by_token without answer still shows the slot', format('select public.sm_startup_confirm_by_token(%L, null::text) ->> %L', v_p_token, 'ok'), null),

      -- D. Still allowed for participants while locked
      (401, 'D01', 'claimer',     false, 'ret:true', 'sm_claim_registration links an imported registration', format('select (public.sm_claim_registration(%L) is not null)::text', v_code), null),
      (402, 'D02', 'claimer',     false, 'ret:1',    'sm_autoclaim_by_email links a registration with the account''s e-mail', 'select public.sm_autoclaim_by_email()::text',
            format('update public.sm_registration set email = %L where id = %L', v_c_email, v_unclaimed2)),
      (403, 'D03', 'participant', false, 'ret:0',    'sm_autoclaim_by_email (nothing to link) does not raise', 'select public.sm_autoclaim_by_email()::text', null),
      (404, 'D04', 'participant', false, 'allow',    'feedback survey answer', format('insert into public.sm_feedback_response (event_id, user_id, answers) values (%L, %L, %L::jsonb)', c_ev, c_p_uid, '{"dry_run": true}'), null),
      (405, 'D05', 'anon',        false, 'ret:true', 'public feedback form', format('select public.sm_feedback_submit_public(%L, %L, %L, %L::jsonb) ->> %L', 'Dry', 'Run', 'dry-run.lock-test@example.invalid', '{"dry_run": true}', 'ok'), null),
      (406, 'D06', 'participant', false, 'allow',    'networking pass', 'select public.sm_my_networking_pass()::text', null),
      (407, 'D07', 'participant', false, 'ret:' || v_reads, 'reads unchanged (roster, logistics, module rows)', v_reads_q, null),
      (408, 'D08', 'participant', false, 'allow',    'sm_my_sm26_participation', 'select public.sm_my_sm26_participation()::text', null),

      -- E. Staff while locked
      (501, 'E01', 'staff', false, 'allow', 'update a participant registration', v_q_reg, null),
      (502, 'E02', 'staff', false, 'allow', 'update an attendee', v_q_att_upd, null),
      (503, 'E03', 'staff', false, 'allow', 'insert an attendee', v_q_att_ins, null),
      (504, 'E04', 'staff', false, 'allow', 'update a role assignment', v_q_ra, null),
      (505, 'E05', 'staff', false, 'allow', 'update logistics', v_q_log, null),
      (506, 'E06', 'staff', false, 'allow', 'insert a logistics item', v_q_item_ins, null),
      (507, 'E07', 'staff', false, 'allow', 'update a startup profile', v_q_sp, null),
      (508, 'E08', 'staff', false, 'allow', 'insert an e-catalogue comment', format('insert into public.sm_ecat_comment (ecat_page_id, author_user_id, author_role, body) values (%L, %L, %L, %L)', v_p_page, c_s_uid, 'staff', 'dry run'), null),
      (509, 'E09', 'staff', false, 'allow', 'sm_confirm_attendees', v_q_confirm, null),
      (510, 'E10', 'staff', false, 'ret:true', 'sm_set_onsite_attendance (admin console)', v_q_onsite, null),
      (511, 'E11', 'staff', false, 'ret:sm_startup_profile', 'sm_ensure_module_row (admin console)', v_q_module, null),
      (512, 'E12', 'staff', false, 'allow', 'sm_ensure_badges (check-in console)', format('select public.sm_ensure_badges(%L)::text', c_ev), null),

      -- F. Anon: unchanged (denied before the lock too)
      (601, 'F01', 'anon', false, 'deny',  'update a registration', v_q_reg, null),
      (602, 'F01', 'anon', true,  'deny',  'update a registration', v_q_reg, null),
      (603, 'F02', 'anon', false, 'deny',  'insert an attendee', v_q_att_ins, null),
      (604, 'F03', 'anon', false, 'deny',  'sm_restart_registration', v_q_restart, null),
      (605, 'F03', 'anon', true,  'deny',  'sm_restart_registration', v_q_restart, null),
      (606, 'F04', 'anon', false, 'allow', 'public vote status (read)', 'select public.sm_public_vote_status()::text', null)
    ) as c(ord, id, who, is_open, expect, label, q, setup);

  for t in select value from jsonb_array_elements(tests) loop
    v_uid := case t->>'who'
               when 'participant' then c_p_uid
               when 'juror'       then c_j_uid
               when 'staff'       then c_s_uid
               when 'claimer'     then v_c_uid
             end;
    v_dml := upper(left(ltrim(t->>'q'), 6)) <> 'SELECT';
    v_ret := null; v_n := null; v_err := null;
    begin
      if (t->>'open')::boolean then
        update public.sm_event
           set settings = settings || jsonb_build_object('edit_locks_at', '2099-12-31', 'roster_locks_at', '2099-12-31')
         where id = c_ev;
      end if;
      if coalesce(t->>'setup', '') <> '' then
        execute t->>'setup';
      end if;
      perform set_config('request.jwt.claim.sub', '', true);
      if t->>'who' = 'anon' then
        perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
        set local role anon;
      else
        perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
        set local role authenticated;
      end if;
      if v_dml then
        execute t->>'q';
        get diagnostics v_n = row_count;
      else
        execute t->>'q' into v_ret;
      end if;
      -- Undo this case (role, claims, settings, writes) before the next one.
      raise exception using errcode = 'DRY01', message = 'case finished';
    exception
      when sqlstate 'DRY01' then null;
      when others then v_err := sqlerrm;
    end;

    v_exp := t->>'expect';
    v_out := case
               when v_err is not null then 'error: ' || v_err
               when v_dml then v_n || ' row(s) written'
               else 'returned ' || coalesce(v_ret, 'null')
             end;
    v_pass := coalesce(case
                when v_exp = 'allow' then v_err is null and (not v_dml or v_n > 0)
                when v_exp = 'deny'  then v_err is not null or (v_dml and v_n = 0)
                when v_exp = 'lock'  then v_err like '%is over: registrations can no longer be changed%'
                when v_exp like 'ret:%' then v_err is null and v_ret is not distinct from substr(v_exp, 5)
                when v_exp = 'info'  then true
              end, false);
    if v_pass then n_pass := n_pass + 1; else n_fail := n_fail + 1; end if;
    results := results || format(E'\n%s %s %s%s: %s | expect %s | %s',
      case when v_pass then 'PASS' else 'FAIL' end, t->>'id', t->>'who',
      case when (t->>'open')::boolean then ' OPEN' else ' LOCKED' end,
      t->>'label', v_exp, left(v_out, 300));
  end loop;

  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (sm26 participant edit lock, run %s)', n_pass, n_fail, now()) || results;
end
$dryrun$;
