-- UNDO of supabase/migrations/20261009210000_registration_core.sql
--
-- Safe only while no data depends on the new structures:
--   * no gl_guest row with a v2-only status or source (refused below);
--   * no core_v2 event other than canary-v2 (refused below: an event made with
--     admin_save_event also has a row in public.events; delete both first);
--   * the new profile columns (country, phone, LinkedIn, affiliation, sign-up
--     record, e-mail proof) and profile_interest_sectors are DROPPED: export them
--     first if they hold anything worth keeping;
--   * user_id links set on gl_guest by attach / provisioning are dropped with the
--     column (event_registrations links set by attach stay);
--   * account_provision_job (queued jobs included, backfilled ones too) and
--     review_log are DROPPED.
-- Edge functions that use these objects (registration, registration-cron,
-- provision-person) must be switched off first (flags off, functions removed).
-- Then undo 20261009200000_registration_prereqs if needed.
-- On "canceling statement due to lock timeout": run it again a little later.

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $pre$
begin
  if exists (select 1 from public.gl_guest
              where status not in ('requested', 'invited', 'confirmed', 'declined', 'rejected', 'cancelled')
                 or source not in ('request', 'invitation', 'plus_one')) then
    raise exception 'registration_core down: gl_guest rows use v2-only statuses or sources; delete or convert them first';
  end if;
  if exists (select 1 from public.gl_event where engine = 'core_v2' and slug <> 'canary-v2') then
    raise exception 'registration_core down: core_v2 events exist (admin_save_event); delete them and their events rows first';
  end if;
end
$pre$;

-- 15. cron
select cron.unschedule(jobname) from cron.job
 where jobname in ('registration-cron-provision', 'registration-cron-reminders', 'registration-cron-digest');
drop function if exists public.invoke_registration_cron(text);

-- 11. auth.users triggers. The migration creates only on_auth_user_email_changed
--     (integration review, 10 Oct 2026: no trigger on e-mail confirmation);
--     on_auth_user_email_confirmed is handled too, in case an earlier draft of
--     the migration was applied somewhere (if absent, its no-op function is
--     created and dropped again below, harmless).
--     auth.users belongs to supabase_auth_admin: postgres
--     may not DROP a trigger there. First make both trigger functions no-ops
--     (always possible: postgres owns them), then try to drop the triggers; if
--     refused, they stay, harmless, and their functions are kept (a function
--     cannot be dropped while a trigger uses it). Ask Supabase support, or run
--     "drop function public.on_auth_email_confirmed() cascade" (and the same for
--     on_auth_email_changed) if they must go.
create or replace function public.on_auth_email_confirmed()
returns trigger language plpgsql security definer set search_path = ''
as $function$ begin return null; end $function$;
create or replace function public.on_auth_email_changed()
returns trigger language plpgsql security definer set search_path = ''
as $function$ begin return null; end $function$;
do $d$
begin
  begin
    drop trigger if exists on_auth_user_email_confirmed on auth.users;
    drop trigger if exists on_auth_user_email_changed on auth.users;
  exception when insufficient_privilege then
    raise notice 'registration_core down: the two auth.users triggers stay (no-op functions): postgres does not own auth.users';
  end;
  if not exists (select 1 from pg_trigger where tgname = 'on_auth_user_email_confirmed') then
    drop function if exists public.on_auth_email_confirmed();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'on_auth_user_email_changed') then
    drop function if exists public.on_auth_email_changed();
  end if;
end
$d$;

-- trg_link_guest_registrations: the migration keeps it; re-created here (same
-- definition) so it is in place whatever happened to it since.
drop trigger if exists trg_link_guest_registrations on public.profiles;
create trigger trg_link_guest_registrations
  after insert on public.profiles
  for each row execute function public.link_guest_registrations_on_profile_insert();

-- 10. gl_guest triggers
drop trigger if exists gl_guest_queue_provisioning on public.gl_guest;
drop trigger if exists gl_guest_engine_guard on public.gl_guest;

-- 14b. guards on events / event_registrations
drop trigger if exists events_publish_guard on public.events;
drop trigger if exists event_registrations_engine_guard on public.event_registrations;
drop function if exists public.events_publish_guard();
drop function if exists public.event_registrations_engine_guard();

-- New functions
drop function if exists public.admin_clone_event(uuid, jsonb);
drop function if exists public.admin_save_event(jsonb);
drop function if exists public.gl_checkin_v2(uuid, uuid, uuid, boolean);
drop function if exists public.my_participations();
drop function if exists public.mark_email_proven();
drop function if exists public.on_email_proven(uuid);
drop function if exists public.attach_my_records();
drop function if exists public.attach_my_records_for(uuid);
drop function if exists public.complete_signup_for(uuid);
drop function if exists public.gl_guest_queue_provisioning();
drop function if exists public.gl_guest_engine_guard();
drop function if exists public.public_registration_events();
drop function if exists public.gl_resolve_access_token(text, boolean);
drop function if exists public.gl_issue_access_token(uuid);
drop function if exists public.gl_register_v2(jsonb);
drop function if exists public.gl_decide_v2(uuid, uuid[], text, uuid, jsonb, boolean, boolean, text, text);
drop function if exists public.gl_registration_state(uuid, uuid, text);
drop function if exists public.gl_seats_held(uuid, text);
drop function if exists public.gl_event_window(uuid);
drop function if exists public.gl_try_ts(text);
drop function if exists public.review_log_add(text, uuid, text, text, jsonb);

-- 12. get_my_event_access: the previous definition (md5 d02afdef0bb982e128b33da6d03025be)
--     and ACL {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}.
drop function if exists public.get_my_event_access(uuid[]);
CREATE FUNCTION public.get_my_event_access(p_event_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(event_id uuid, is_registered boolean, meeting_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with me as (
    select auth.uid() as uid,
           public.is_moderator() as staff,
           -- guest rows count as mine only for a CONFIRMED auth e-mail
           (select lower(u.email)
              from auth.users u
             where u.id = auth.uid()
               and u.email_confirmed_at is not null) as email
  ),
  mine as (
    select distinct r.event_id
      from public.event_registrations r
      join public.events e on e.id = r.event_id
      cross join me
     where me.uid is not null
       and (r.user_id = me.uid
            or (r.user_id is null
                and me.email is not null
                and lower(r.guest_email) = me.email))
       -- an invitation request is not a seat until staff approve it
       and not (coalesce(e.invitation_only, false) and r.payment_status = 'pending_approval')
       and (p_event_ids is null or r.event_id = any(p_event_ids))
  )
  select e.id,
         (m.event_id is not null),
         case when m.event_id is not null or me.staff then e.meeting_url end
    from public.events e
    cross join me
    left join mine m on m.event_id = e.id
   where me.uid is not null
     and (me.staff or public.can_access_resource(e.access_level))
     and case
           when p_event_ids is null then m.event_id is not null
           else e.id = any(p_event_ids) and (m.event_id is not null or me.staff)
         end;
$function$;
revoke all on function public.get_my_event_access(uuid[]) from public, anon;
grant execute on function public.get_my_event_access(uuid[]) to authenticated, service_role;

-- 7. profile guard: the previous body (md5 e29979e16e96d0552bfae5474e909c76),
--    restored BEFORE its new columns are dropped.
CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  -- SECURITY INVOKER on purpose: current_user is the role doing the write.
  -- 'authenticated'/'anon' = a direct PostgREST write by a user;
  -- postgres = inside a SECURITY DEFINER RPC (claim_organization,
  -- accept_org_invitation, handle_new_user, ...) or a migration/SQL editor/cron;
  -- 'service_role' = an edge function on the service key.
  v_api_write boolean := current_user IN ('authenticated', 'anon');
  v_becoming  boolean := false;
  v_jwt_role  text;
  v_trusted   boolean;
BEGIN
  -- 1. Self-freeze: a user's own direct API write cannot change persona or
  --    access_status (kept silently, as this trigger always intended), unless the
  --    user is a verified admin. Trusted server code (RPCs, service role) may.
  IF v_api_write AND NOT public.is_admin() THEN
    IF TG_OP = 'UPDATE' THEN
      IF auth.uid() = OLD.user_id THEN
        NEW.persona       := OLD.persona;
        NEW.access_status := OLD.access_status;
      END IF;
    ELSIF TG_OP = 'INSERT' THEN
      NEW.access_status := 'pending';
    END IF;
  END IF;

  -- 2. Staff guard: a row becomes staff, or a staff row becomes verified, only
  --    by the service role, a verified admin, or a session with no API JWT.
  IF NEW.persona IN ('admin', 'moderator') THEN
    IF TG_OP = 'INSERT' THEN
      v_becoming := true;
    ELSE
      v_becoming := OLD.persona IS DISTINCT FROM NEW.persona
                 OR (NEW.access_status = 'verified'
                     AND OLD.access_status IS DISTINCT FROM NEW.access_status);
    END IF;

    IF v_becoming THEN
      v_jwt_role := auth.role();
      v_trusted  := current_user = 'service_role'
                 OR v_jwt_role = 'service_role'
                 OR public.is_admin()
                 OR (v_jwt_role IS NULL AND auth.uid() IS NULL AND NOT v_api_write);
      IF NOT coalesce(v_trusted, false) THEN
        RAISE EXCEPTION 'Only a verified admin can grant or verify a staff profile'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- New tables (6, 5, 4, 2, 7)
drop table if exists public.review_log;
drop table if exists public.account_provision_job;
drop table if exists public.gl_access_token;
drop table if exists public.gl_question;
drop table if exists public.gl_ticket;
drop table if exists public.profile_interest_sectors;

-- 8. rate-limit scope
drop index if exists public.idx_guest_rate_scope_email;
drop index if exists public.idx_guest_rate_scope_ip;
alter table public.guest_signup_rate_limits drop column if exists scope;

-- 7. profile columns
alter table public.profiles
  drop column if exists country,
  drop column if exists phone,
  drop column if exists linkedin_url,
  drop column if exists affiliation,
  drop column if exists signup_source,
  drop column if exists signup_intent,
  drop column if exists email_proven_at,
  drop column if exists email_changed_at;

-- Comments the up script set on columns that stay (none existed before).
comment on column public.profiles.email is null;
comment on column public.gl_guest.token is null;

-- 3. gl_guest: legacy CHECKs back, new columns and indexes off
alter table public.gl_guest drop constraint if exists gl_guest_status_check;
alter table public.gl_guest add constraint gl_guest_status_check check (status = any (array['requested', 'invited', 'confirmed', 'declined', 'rejected', 'cancelled']));
alter table public.gl_guest drop constraint if exists gl_guest_source_check;
alter table public.gl_guest add constraint gl_guest_source_check check (source = any (array['request', 'invitation', 'plus_one']));
drop index if exists public.gl_guest_event_user_uq;
drop index if exists public.gl_guest_user_idx;
drop index if exists public.gl_guest_email_lower_idx;
alter table public.gl_guest
  drop column if exists user_id,
  drop column if exists organization_id,
  drop column if exists ticket_key,
  drop column if exists answers,
  drop column if exists consents,
  drop column if exists source_detail,
  drop column if exists payment_status,
  drop column if exists amount_cents,
  drop column if exists currency,
  drop column if exists checkin_token,
  drop column if exists info_request,
  drop column if exists info_requested_at,
  drop column if exists link_opened_at,
  drop column if exists cancelled_at,
  drop column if exists reminders_sent,
  drop column if exists account_action,
  drop column if exists provisioned_at,
  drop column if exists updated_at;

-- 1. gl_event columns
alter table public.gl_event drop constraint if exists gl_event_instant_is_webinar;
alter table public.gl_event drop constraint if exists gl_event_v2_no_legacy_requests;
alter table public.gl_event drop constraint if exists gl_event_door_matches_engine;
drop index if exists public.gl_event_legacy_event_uq;
alter table public.gl_event
  drop column if exists engine,
  drop column if exists kind,
  drop column if exists registration_mode,
  drop column if exists public_requests,
  drop column if exists access,
  drop column if exists opens_at,
  drop column if exists closes_at,
  drop column if exists edit_locks_at,
  drop column if exists waitlist,
  drop column if exists plus_ones,
  drop column if exists standard_fields,
  drop column if exists account_email_timing,
  drop column if exists account_email_send_at,
  drop column if exists meeting_url,
  drop column if exists replay_url,
  drop column if exists reminders,
  drop column if exists door_token,
  drop column if exists staff_alert_mode,
  drop column if exists updated_at;

-- Checks after the undo:
--   md5(prosrc) get_my_event_access = d02afdef0bb982e128b33da6d03025be
--   md5(prosrc) prevent_profile_privilege_escalation = e29979e16e96d0552bfae5474e909c76
--   select tgname from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 'trg_link_guest_registrations';  -> 1 row
--   select count(*) from pg_trigger where tgname in ('event_registrations_engine_guard', 'events_publish_guard');  -> 0
