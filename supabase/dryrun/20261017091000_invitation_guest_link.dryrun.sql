-- DRY RUN of supabase/migrations/20261017091000_invitation_guest_link.sql. NOT A MIGRATION.
-- Run it AFTER 20261017090000_invitation_campaigns is applied and BEFORE this file is.
-- ONE query text, ONE execute_sql call. Everything rolls back: the last statement raises
-- 'DRYRUN ...'; the result is in that error message.
-- A. a snapshot of what must not change; B. the migration, verbatim; C. test helpers;
-- D. cases as a visitor (anon), a verified member, a verified moderator, a verified admin
-- and the service role, each in its own rolled-back sub-transaction, on a throw-away
-- guest-list event (capacity 3) created inside the run: the real wys26 list is not touched.
-- The cases compare every gl_guest column the guest-list function v6 "invite" writes, and
-- check that no e-mail is logged (nothing is sent from SQL). No sm_* row is written.
-- Expected: "31 PASS, 0 FAIL".

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- A. Snapshot (case S01 reads it again after the migration: must be identical)
create function pg_temp.dr_snap() returns table (k text, v text) language sql as $f$
  select 'gl_guest', (select md5(coalesce(string_agg(g::text, ',' order by g.id), '')) from public.gl_guest g)
  union all select 'gl_event', (select md5(coalesce(string_agg(e::text, ',' order by e.id), '')) from public.gl_event e)
  union all select 'gl_email_log', (select count(*) || '/' || coalesce(max(l.id), 0) from public.gl_email_log l)
  union all select 'sm', concat_ws('/', (select count(*) from public.sm_registration), (select count(*) from public.sm_attendee),
                                   (select count(*) from public.sm_badge), (select count(*) from public.sm_invitation))
  union all select 'policies', (select md5(string_agg(format('%s.%s.%s|%s|%s|%s|%s', pl.schemaname, pl.tablename, pl.policyname,
                                  pl.cmd, pl.roles, pl.qual, pl.with_check), ';' order by pl.schemaname, pl.tablename, pl.policyname))
                                  from pg_policies pl where pl.policyname not like 'invitation%')
  union all select 'acls', (select md5(string_agg(p.oid::regprocedure::text || '=' || coalesce(array_to_string(p.proacl, ','), ''), ';'
                              order by p.oid::regprocedure::text))
                              from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname not like 'invitation%')
  union all select 'pins', (select md5(string_agg(p.proname || ':' || md5(p.prosrc), ',' order by p.proname, md5(p.prosrc)))
                              from pg_proc p where p.pronamespace = 'public'::regnamespace
                               and p.proname in ('gl_checkin', 'gl_checkin_v2', 'gl_guest_engine_guard', 'gl_guest_queue_provisioning',
                                 'invoke_registration_cron', 'invoke_send_profile_reminders', 'invoke_guest_webinar_reminders',
                                 'handle_new_user', 'has_capability', 'capability_set', 'complete_signup_for', 'is_moderator', 'is_admin'))
  union all select 'triggers', (select md5(string_agg(t.tgrelid::regclass::text || ':' || t.tgname || ':' || t.tgenabled, ','
                                  order by t.tgrelid::regclass::text, t.tgname))
                                  from pg_trigger t where not t.tgisinternal and t.tgrelid::regclass::text not like 'invitation%')
  union all select 'tables', (select md5(string_agg(c.oid::regclass::text || ':' || c.relrowsecurity::text || ':'
                                || coalesce(array_to_string(c.relacl, ','), ''), ';' order by c.oid::regclass::text))
                                from pg_class c where c.relnamespace in ('public'::regnamespace, 'storage'::regnamespace)
                                 and c.relkind = 'r' and c.relname not like 'invitation%')
  union all select 'buckets', (select md5(string_agg(b::text, ',' order by b.id)) from storage.buckets b where b.id <> 'invitation-files')
  union all select 'invitation', concat_ws('/', (select count(*) from public.invitation_campaign), (select count(*) from public.invitation_recipient),
                                           (select count(*) from public.invitation_log))
$f$;
create temp table _dr_before on commit drop as select * from pg_temp.dr_snap();

-- B. The migration, verbatim ───────────────────────────────────────────────────
-- invitation_guest_link: step 1 (part 2 of 2) of the "Invitation campaigns" admin module.
-- NOT APPLIED. Needs part 1 (20261017090000_invitation_campaigns) applied. Apply only with
-- Victor's OK, after its dry run: supabase/dryrun/20261017091000_invitation_guest_link.dryrun.sql.
-- Down: supabase/migrations/down/20261017091000_invitation_guest_link.down.sql (run it before
-- part 1's down). Plan: "9 M3 Connect/Module invitations - etape 0 - plan.md" (16 Oct 2026).
--
-- ADDITIVE ONLY: 2 functions. invitation_link_guest() puts a campaign guest on the event's
-- guest list (gl_guest) exactly as the guest-list edge function's "invite" action (live v6,
-- WYS freeze until 28 Nov) does, but sends NO e-mail: the module's sender (step 4) e-mails
-- the letter and the ticket and logs gl_email_log kind 'invitation' itself, because the
-- health monitor expects that log for every invited row. invitation_set_answer() records an
-- answer received by e-mail as v6's public "rsvp" action does; the entry pass is then sent
-- by guest-list's existing staff "resend" action (for a confirmed guest it sends the pass),
-- never from SQL. Neither touches gl_guest's token, plus-one fields, user_id or admin_note.
-- No gl_* function, trigger or policy is redefined.
--
-- Callers: verified admins and moderators (public.is_moderator()), or the service role.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if to_regclass('public.invitation_recipient') is null or to_regclass('public.invitation_log') is null
     or to_regprocedure('public.invitation_find_duplicates(uuid,uuid)') is null then
    raise exception 'invitation_guest_link: apply 20261017090000_invitation_campaigns first';
  end if;
  if to_regprocedure('public.invitation_link_guest(uuid,boolean,boolean)') is not null
     or to_regprocedure('public.invitation_set_answer(uuid,text,boolean)') is not null then
    raise exception 'invitation_guest_link: already applied';
  end if;
  -- The columns written below, as guest-list v6 "invite" and "rsvp" write them.
  if (select count(*) from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = 'gl_guest'
         and c.column_name in ('first_name', 'last_name', 'email', 'company', 'job_title', 'phone', 'country', 'event_id',
                               'source', 'status', 'conference', 'gala', 'wants_conference', 'wants_gala', 'invited_at',
                               'decided_by', 'decided_at', 'responded_at', 'token', 'plus_one_of')) <> 20
     or (select count(*) from information_schema.columns c
          where c.table_schema = 'public' and c.table_name = 'gl_event' and c.column_name in ('capacity', 'engine')) <> 2 then
    raise exception 'invitation_guest_link: gl_guest / gl_event are not the shape guest-list v6 uses';
  end if;
end
$pre$;

-- 1. Put a campaign guest on the event's guest list
-- Called just before the invitation e-mail goes out (step 4), or by staff to settle a
-- duplicate. Returns {ok, ...} or {ok:false, error}. No e-mail is sent here.
--  - Already linked: returns the row (idempotent).
--  - New address: inserts the row exactly as guest-list v6 "invite" does (source
--    'invitation', status 'invited', conference/gala and wants_* from the campaign or the
--    guest, invited_at = decided_at = now, decided_by = caller, empty strings for missing
--    company/job title/phone/country, token by default). Capacity as v6: confirmed +
--    invited + 1 must fit, unless p_force.
--  - The address is already on the list: refused ('already_on_list', with its status),
--    unless p_adopt: a pending public request (source 'request') becomes 'invited' (same
--    row, same token; capacity checked); an invited, confirmed or declined row is linked
--    as it is (the guest's answer is copied); rejected, cancelled rows and pending
--    plus-one requests are not adoptable. A row already linked to another campaign guest
--    is never taken ('guest_linked_elsewhere').
create function public.invitation_link_guest(p_recipient_id uuid, p_force boolean default false, p_adopt boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_uid uuid := auth.uid();
  v_rec public.invitation_recipient;
  v_camp public.invitation_campaign;
  v_ev public.gl_event;
  v_guest public.gl_guest;
  v_other uuid;
  v_prev text;
  v_held integer;
  v_conf boolean;
  v_gala boolean;
begin
  if not (coalesce(public.is_moderator(), false) or coalesce(auth.role(), '') = 'service_role') then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  select * into v_rec from public.invitation_recipient where id = p_recipient_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'recipient_not_found');
  end if;
  if v_rec.gl_guest_id is not null then
    select * into v_guest from public.gl_guest where id = v_rec.gl_guest_id;
    return jsonb_build_object('ok', true, 'already_linked', true, 'created', false, 'adopted', false,
      'guest_id', v_guest.id, 'guest_status', v_guest.status);
  end if;
  select * into v_camp from public.invitation_campaign where id = v_rec.campaign_id;
  if v_camp.archived_at is not null then
    return jsonb_build_object('ok', false, 'error', 'campaign_archived');
  end if;
  select * into v_ev from public.gl_event where id = v_camp.gl_event_id;
  if v_ev.engine is distinct from 'guest_list_v1' then
    return jsonb_build_object('ok', false, 'error', 'engine_not_supported', 'engine', v_ev.engine);
  end if;
  if v_rec.email is null then
    return jsonb_build_object('ok', false, 'error', 'no_email');
  end if;
  if v_rec.first_name is null or v_rec.last_name is null then
    return jsonb_build_object('ok', false, 'error', 'missing_name');
  end if;
  v_conf := coalesce(v_rec.conference, v_camp.conference);
  v_gala := coalesce(v_rec.gala, v_camp.gala);
  if not (v_conf or v_gala) then
    return jsonb_build_object('ok', false, 'error', 'no_part');
  end if;

  -- One link at a time per event, so the seat count and the address check hold until commit.
  perform pg_advisory_xact_lock(hashtext('invitation_link_guest'), hashtext(v_ev.id::text));

  select * into v_guest from public.gl_guest where event_id = v_ev.id and lower(email) = v_rec.email for update;
  if found then
    select r.id into v_other from public.invitation_recipient r where r.gl_guest_id = v_guest.id;
    if v_other is not null then
      return jsonb_build_object('ok', false, 'error', 'guest_linked_elsewhere', 'guest_id', v_guest.id,
        'other_recipient_id', v_other);
    end if;
    if not p_adopt then
      return jsonb_build_object('ok', false, 'error', 'already_on_list', 'guest_id', v_guest.id,
        'guest_status', v_guest.status, 'guest_source', v_guest.source);
    end if;
    v_prev := v_guest.status;
    if v_guest.status = 'requested' and v_guest.source = 'request' then
      if v_ev.capacity is not null and not p_force then
        select count(*) into v_held from public.gl_guest where event_id = v_ev.id and status in ('confirmed', 'invited');
        if v_held + 1 > v_ev.capacity then
          return jsonb_build_object('ok', false, 'error', 'capacity', 'held', v_held, 'capacity', v_ev.capacity);
        end if;
      end if;
      update public.gl_guest
         set status = 'invited', conference = v_conf, gala = v_gala, invited_at = now(), decided_at = now(), decided_by = v_uid
       where id = v_guest.id
      returning * into v_guest;
    elsif v_guest.status not in ('invited', 'confirmed', 'declined') then
      return jsonb_build_object('ok', false, 'error', 'not_adoptable', 'guest_id', v_guest.id,
        'guest_status', v_guest.status, 'guest_source', v_guest.source);
    end if;
    update public.invitation_recipient
       set gl_guest_id = v_guest.id,
           status = case v_guest.status when 'confirmed' then 'accepted' when 'declined' then 'declined' else status end,
           responded_at = case when v_guest.status in ('confirmed', 'declined')
                               then coalesce(v_guest.responded_at, v_guest.decided_at, now()) else responded_at end
     where id = v_rec.id;
    insert into public.invitation_log (campaign_id, recipient_id, action, payload)
    values (v_rec.campaign_id, v_rec.id, 'guest_adopted', jsonb_build_object('guest_id', v_guest.id,
      'previous_status', v_prev, 'guest_status', v_guest.status, 'forced', p_force));
    return jsonb_build_object('ok', true, 'created', false, 'adopted', true, 'guest_id', v_guest.id,
      'guest_status', v_guest.status, 'previous_status', v_prev);
  end if;

  if v_ev.capacity is not null and not p_force then
    select count(*) into v_held from public.gl_guest where event_id = v_ev.id and status in ('confirmed', 'invited');
    if v_held + 1 > v_ev.capacity then
      return jsonb_build_object('ok', false, 'error', 'capacity', 'held', v_held, 'capacity', v_ev.capacity);
    end if;
  end if;
  begin
    insert into public.gl_guest (first_name, last_name, email, company, job_title, phone, country, event_id,
                                 source, status, conference, gala, wants_conference, wants_gala,
                                 invited_at, decided_by, decided_at)
    values (left(v_rec.first_name, 80), left(v_rec.last_name, 80), left(v_rec.email, 200),
            coalesce(left(v_rec.organisation, 160), ''), coalesce(left(v_rec.position, 160), ''),
            coalesce(left(v_rec.phone, 40), ''), coalesce(left(v_rec.country, 80), ''), v_ev.id,
            'invitation', 'invited', v_conf, v_gala, v_conf, v_gala,
            now(), v_uid, now())
    returning * into v_guest;
  exception when unique_violation then
    -- A public request for this address arrived in between.
    return jsonb_build_object('ok', false, 'error', 'already_on_list');
  end;
  update public.invitation_recipient set gl_guest_id = v_guest.id where id = v_rec.id;
  insert into public.invitation_log (campaign_id, recipient_id, action, payload)
  values (v_rec.campaign_id, v_rec.id, 'guest_created', jsonb_build_object('guest_id', v_guest.id, 'forced', p_force));
  return jsonb_build_object('ok', true, 'created', true, 'adopted', false, 'guest_id', v_guest.id,
    'guest_status', v_guest.status);
end
$f$;

-- 2. Record an answer received by e-mail
-- accepted: the guest-list row becomes 'confirmed' with responded_at, as v6's public
--   "rsvp accept" does (invited: the seat is already held; declined: a seat must be free,
--   unless p_force). The caller then sends the entry pass with guest-list "resend"
--   ('pass_needed' says whether no pass was logged yet).
-- declined: invited or confirmed becomes 'declined' with responded_at (v6 "rsvp decline").
--   A guest who was never linked is only marked declined in the campaign.
-- no_answer: campaign status only, while the row is still 'invited' (it keeps its seat).
create function public.invitation_set_answer(p_recipient_id uuid, p_answer text, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_rec public.invitation_recipient;
  v_ev public.gl_event;
  v_guest public.gl_guest;
  v_before text;
  v_held integer;
begin
  if not (coalesce(public.is_moderator(), false) or coalesce(auth.role(), '') = 'service_role') then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if p_answer is null or p_answer not in ('accepted', 'declined', 'no_answer') then
    raise exception using errcode = '22023', message = 'bad_answer';
  end if;
  select * into v_rec from public.invitation_recipient where id = p_recipient_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'recipient_not_found');
  end if;

  if v_rec.gl_guest_id is null then
    if p_answer <> 'declined' then
      return jsonb_build_object('ok', false, 'error', 'not_linked');
    end if;
    update public.invitation_recipient set status = 'declined', responded_at = now() where id = v_rec.id;
    insert into public.invitation_log (campaign_id, recipient_id, action, payload)
    values (v_rec.campaign_id, v_rec.id, 'answer', jsonb_build_object('answer', p_answer, 'guest_id', null));
    return jsonb_build_object('ok', true, 'guest_id', null, 'guest_status', null, 'changed', false, 'pass_needed', false);
  end if;

  select * into v_guest from public.gl_guest where id = v_rec.gl_guest_id for update;
  v_before := v_guest.status;

  if p_answer = 'accepted' then
    if v_guest.status = 'declined' then
      select * into v_ev from public.gl_event where id = v_guest.event_id;
      if v_ev.capacity is not null and not p_force then
        select count(*) into v_held from public.gl_guest where event_id = v_ev.id and status in ('confirmed', 'invited');
        if v_held >= v_ev.capacity then
          return jsonb_build_object('ok', false, 'error', 'capacity', 'held', v_held, 'capacity', v_ev.capacity);
        end if;
      end if;
    elsif v_guest.status not in ('invited', 'confirmed') then
      return jsonb_build_object('ok', false, 'error', 'guest_' || v_guest.status, 'guest_status', v_guest.status);
    end if;
    if v_guest.status <> 'confirmed' then
      update public.gl_guest set status = 'confirmed', responded_at = now() where id = v_guest.id
      returning * into v_guest;
    end if;
    update public.invitation_recipient
       set status = 'accepted', responded_at = coalesce(v_guest.responded_at, now())
     where id = v_rec.id;
  elsif p_answer = 'declined' then
    if v_guest.status in ('invited', 'confirmed') then
      update public.gl_guest set status = 'declined', responded_at = now() where id = v_guest.id
      returning * into v_guest;
    elsif v_guest.status <> 'declined' then
      return jsonb_build_object('ok', false, 'error', 'guest_' || v_guest.status, 'guest_status', v_guest.status);
    end if;
    update public.invitation_recipient
       set status = 'declined', responded_at = coalesce(v_guest.responded_at, now())
     where id = v_rec.id;
  else
    if v_guest.status <> 'invited' then
      return jsonb_build_object('ok', false, 'error', 'guest_answered', 'guest_status', v_guest.status);
    end if;
    update public.invitation_recipient set status = 'no_answer' where id = v_rec.id;
  end if;

  insert into public.invitation_log (campaign_id, recipient_id, action, payload)
  values (v_rec.campaign_id, v_rec.id, 'answer', jsonb_build_object('answer', p_answer, 'guest_id', v_guest.id,
    'guest_before', v_before, 'guest_after', v_guest.status, 'forced', p_force));
  return jsonb_build_object('ok', true, 'guest_id', v_guest.id, 'guest_status', v_guest.status,
    'changed', v_before is distinct from v_guest.status,
    'pass_needed', v_guest.status = 'confirmed'
      and not exists (select 1 from public.gl_email_log l where l.guest_id = v_guest.id and l.kind = 'pass'));
end
$f$;

-- 3. Function privileges
revoke all on function public.invitation_link_guest(uuid, boolean, boolean) from public, anon;
revoke all on function public.invitation_set_answer(uuid, text, boolean) from public, anon;
grant execute on function public.invitation_link_guest(uuid, boolean, boolean) to authenticated, service_role;
grant execute on function public.invitation_set_answer(uuid, text, boolean) to authenticated, service_role;

-- C. Test helpers ──────────────────────────────────────────────────────────────
set local statement_timeout = '120s';

-- A verified user with a proven address (handle_new_user creates the profile).
create function pg_temp.dr_user(p_id uuid, p_email text, p_persona text)
returns void language plpgsql as $f$
begin
  insert into auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
  values (p_id, p_email, 'authenticated', 'authenticated', '{}'::jsonb, now(), now(), now());
  update public.profiles
     set email_proven_at = now(), access_status = 'verified'::public.access_status_enum,
         persona = p_persona::public.persona_enum, onboarding_status = 'completed'::public.onboarding_status_enum
   where user_id = p_id;
end
$f$;

-- Act as a signed-in user inside a case's setup (the runner resets this before each case).
create function pg_temp.dr_as(p_uid uuid)
returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end
$f$;

-- D. Cases ─────────────────────────────────────────────────────────────────────
do $dryrun$
declare
  tests jsonb := '[]'::jsonb;
  t jsonb;
  kv record;
  vars jsonb;
  s0 text;
  v_q text; v_setup text; v_chkq text; v_exp text;
  v_uid uuid; v_dml boolean; v_ret text; v_n bigint;
  v_err text; v_state text; v_chk boolean; v_pass boolean;
  n_pass integer := 0; n_fail integer := 0;
  results text := '';
  r8 text := substr(md5(random()::text), 1, 8);
begin
  vars := jsonb_build_object('admin', gen_random_uuid(), 'moder', gen_random_uuid(), 'member', gen_random_uuid(),
    'ev', gen_random_uuid(), 'c1', gen_random_uuid(), 'c2', gen_random_uuid(),
    'r1', gen_random_uuid(), 'r2', gen_random_uuid(), 'r3', gen_random_uuid(), 'r4', gen_random_uuid(),
    'r5', gen_random_uuid(), 'r6', gen_random_uuid(), 'g_req', gen_random_uuid(), 'g_rej', gen_random_uuid(),
    'tok', gen_random_uuid(),
    'e_admin', 'dryrun-admin-' || r8 || '@example.invalid', 'e_moder', 'dryrun-moder-' || r8 || '@example.invalid',
    'e_member', 'dryrun-member-' || r8 || '@example.invalid', 'e_r1', 'dryrun-leo-' || r8 || '@example.invalid',
    'e_req', 'dryrun-ines-' || r8 || '@example.invalid', 'e_rej', 'dryrun-rex-' || r8 || '@example.invalid',
    'e_r6', 'dryrun-prof-' || r8 || '@example.invalid', 'r8', r8);
  -- Shared setup (as the owner): 3 users; a throw-away guest-list event, capacity 3, with a
  -- pending public request (g_req) and a refused one (g_rej); campaign c1: r1 new address,
  -- r2 = g_req's address, r3 no address, r4 = g_rej's address, r6 no first/last name;
  -- campaign c2: r5 = r1's address.
  s0 := $s$select pg_temp.dr_user({admin}, {e_admin}, 'admin');
select pg_temp.dr_user({moder}, {e_moder}, 'moderator');
select pg_temp.dr_user({member}, {e_member}, 'marina');
insert into public.gl_event (id, slug, title, capacity) values ({ev}, 'dryrun-inv-' || {r8}, 'Dryrun invitations', 3);
insert into public.gl_guest (id, event_id, source, status, first_name, last_name, email, company, token) values
  ({g_req}, {ev}, 'request', 'requested', 'Ines', 'Dryrun', {e_req}, 'Acme SA', {tok}),
  ({g_rej}, {ev}, 'request', 'rejected', 'Rex', 'Jected', {e_rej}, 'Rex Ltd', gen_random_uuid());
insert into public.invitation_campaign (id, gl_event_id, name) values ({c1}, {ev}, 'Dryrun C1'), ({c2}, {ev}, 'Dryrun C2');
insert into public.invitation_recipient (id, campaign_id, first_name, last_name, name_on_ticket, email, organisation, status) values
  ({r1}, {c1}, 'Leo', 'Sample', 'Mr Leo Sample', {e_r1}, 'Sample & Co', 'ready'),
  ({r2}, {c1}, 'Ines', 'Dryrun', 'Dr Ines Dryrun', {e_req}, 'ACME S.A.', 'ready'),
  ({r3}, {c1}, 'No', 'Mail', 'No Mail', null, null, 'draft'),
  ({r4}, {c1}, 'Rex', 'Jected', 'Rex Jected', {e_rej}, null, 'ready'),
  ({r6}, {c1}, null, null, 'Prof. Someone', {e_r6}, null, 'ready'),
  ({r5}, {c2}, 'Lucky', 'Twin', 'Lucky Twin', upper({e_r1}), null, 'ready')$s$;

  tests := jsonb_build_array(
    jsonb_build_object('id', 'S01', 'who', 'postgres', 'bare', true, 'expect', 'ret:0',
      'label', 'nothing else changed: guest list, campaigns, SM26 counts, policies, function ACLs, ops_health pins, triggers, buckets',
      'q', $q$select count(*)::text from ((select * from _dr_before except select * from pg_temp.dr_snap())
               union all (select * from pg_temp.dr_snap() except select * from _dr_before)) d$q$),
    jsonb_build_object('id', 'S02', 'who', 'postgres', 'bare', true, 'expect', 'ret:false/false/true/true',
      'label', 'EXECUTE: not for visitors; signed-in callers (checked staff inside) and the service role',
      'q', $q$select concat_ws('/', has_function_privilege('anon', 'public.invitation_link_guest(uuid,boolean,boolean)', 'execute')::text,
               has_function_privilege('anon', 'public.invitation_set_answer(uuid,text,boolean)', 'execute')::text,
               has_function_privilege('authenticated', 'public.invitation_link_guest(uuid,boolean,boolean)', 'execute')::text,
               has_function_privilege('service_role', 'public.invitation_set_answer(uuid,text,boolean)', 'execute')::text)$q$),
    -- Linking a campaign guest to the guest list
    jsonb_build_object('id', 'K01', 'who', 'anon', 'expect', 'rls', 'label', 'a visitor cannot link',
      'q', $q$select public.invitation_link_guest({r1})::text$q$),
    jsonb_build_object('id', 'K02', 'who', 'member', 'expect', 'rls', 'label', 'a verified member cannot link',
      'q', $q$select public.invitation_link_guest({r1})::text$q$,
      'chk', $c$select not exists (select 1 from public.gl_guest g where g.event_id = {ev} and g.email = {e_r1})$c$),
    jsonb_build_object('id', 'K03', 'who', 'admin', 'expect', 'ret:true/true/invited',
      'label', 'new address: an "invited" row exactly as guest-list v6 invite writes it, no e-mail logged, journalled',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'created', x ->> 'guest_status') from (select public.invitation_link_guest({r1}) as x) s$q$,
      'chk', $c$select exists (select 1 from public.gl_guest g join public.invitation_recipient r on r.gl_guest_id = g.id
               where r.id = {r1} and r.status = 'ready' and g.event_id = {ev} and g.source = 'invitation' and g.status = 'invited'
                 and g.email = {e_r1} and g.first_name = 'Leo' and g.last_name = 'Sample' and g.company = 'Sample & Co'
                 and g.job_title = '' and g.phone = '' and g.country = '' and g.motivation is null
                 and g.conference and g.gala and g.wants_conference and g.wants_gala
                 and g.invited_at is not null and g.decided_at = g.invited_at and g.decided_by = {admin} and g.responded_at is null
                 and g.plus_one_of is null and g.user_id is null and g.admin_note is null and g.token is not null)
             and not exists (select 1 from public.gl_email_log l where l.event_id = {ev})
             and exists (select 1 from public.invitation_log l where l.recipient_id = {r1} and l.action = 'guest_created'
               and l.actor_id = {admin})$c$),
    jsonb_build_object('id', 'K04', 'who', 'admin', 'expect', 'ret:true', 'label', 'linking twice returns the same row',
      'setup', $s$select pg_temp.dr_as({admin}); select public.invitation_link_guest({r1})$s$,
      'q', $q$select x ->> 'already_linked' from (select public.invitation_link_guest({r1}) as x) s$q$,
      'chk', $c$select (select count(*) from public.gl_guest g where g.event_id = {ev} and g.email = {e_r1}) = 1$c$),
    jsonb_build_object('id', 'K05', 'who', 'admin', 'expect', 'ret:false/capacity',
      'label', 'capacity as v6: confirmed + invited + 1 must fit',
      'setup', $s$insert into public.gl_guest (event_id, source, status, first_name, last_name, email)
               select {ev}::uuid, 'invitation', 'invited', 'Seat', 'No ' || n, 'dryrun-seat-' || n || '-' || {r8} || '@example.invalid'
                 from generate_series(1, 3) n$s$,
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_link_guest({r1}) as x) s$q$,
      'chk', $c$select not exists (select 1 from public.gl_guest g where g.event_id = {ev} and g.email = {e_r1})$c$),
    jsonb_build_object('id', 'K06', 'who', 'admin', 'expect', 'ret:true/true', 'label', 'unless forced',
      'setup', $s$insert into public.gl_guest (event_id, source, status, first_name, last_name, email)
               select {ev}::uuid, 'invitation', 'invited', 'Seat', 'No ' || n, 'dryrun-seat-' || n || '-' || {r8} || '@example.invalid'
                 from generate_series(1, 3) n$s$,
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'created') from (select public.invitation_link_guest({r1}, true) as x) s$q$),
    jsonb_build_object('id', 'K07', 'who', 'admin', 'expect', 'ret:false/already_on_list/requested',
      'label', 'an address with a pending public request is refused without adopt, nothing changes',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error', x ->> 'guest_status') from (select public.invitation_link_guest({r2}) as x) s$q$,
      'chk', $c$select (select g.status from public.gl_guest g where g.id = {g_req}) = 'requested'
             and (select r.gl_guest_id from public.invitation_recipient r where r.id = {r2}) is null$c$),
    jsonb_build_object('id', 'K08', 'who', 'admin', 'expect', 'ret:true/true/invited',
      'label', 'adopt: the pending request becomes invited, same row, same token, access from the campaign',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'adopted', x ->> 'guest_status') from (select public.invitation_link_guest({r2}, false, true) as x) s$q$,
      'chk', $c$select exists (select 1 from public.gl_guest g join public.invitation_recipient r on r.gl_guest_id = g.id
               where r.id = {r2} and g.id = {g_req} and g.status = 'invited' and g.source = 'request' and g.token = {tok}
                 and g.invited_at is not null and g.decided_at = g.invited_at and g.decided_by = {admin} and g.conference and g.gala)
             and exists (select 1 from public.invitation_log l where l.recipient_id = {r2} and l.action = 'guest_adopted'
               and l.payload ->> 'previous_status' = 'requested')$c$),
    jsonb_build_object('id', 'K09', 'who', 'admin', 'expect', 'ret:false/capacity', 'label', 'adopting a request takes a seat too',
      'setup', $s$insert into public.gl_guest (event_id, source, status, first_name, last_name, email)
               select {ev}::uuid, 'invitation', 'invited', 'Seat', 'No ' || n, 'dryrun-seat-' || n || '-' || {r8} || '@example.invalid'
                 from generate_series(1, 3) n$s$,
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_link_guest({r2}, false, true) as x) s$q$),
    jsonb_build_object('id', 'K10', 'who', 'admin', 'expect', 'ret:false/not_adoptable', 'label', 'a refused request is not adoptable',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_link_guest({r4}, false, true) as x) s$q$,
      'chk', $c$select (select g.status from public.gl_guest g where g.id = {g_rej}) = 'rejected'$c$),
    jsonb_build_object('id', 'K11', 'who', 'admin', 'expect', 'ret:true/true/confirmed',
      'label', 'adopting a row that already accepted copies the answer (guest-list row untouched)',
      'setup', $s$update public.gl_guest set status = 'confirmed', responded_at = now() where id = {g_req}$s$,
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'adopted', x ->> 'guest_status') from (select public.invitation_link_guest({r2}, false, true) as x) s$q$,
      'chk', $c$select exists (select 1 from public.invitation_recipient r where r.id = {r2} and r.status = 'accepted'
               and r.responded_at is not null and r.gl_guest_id = {g_req})
             and (select g.decided_by from public.gl_guest g where g.id = {g_req}) is null$c$),
    jsonb_build_object('id', 'K12', 'who', 'admin', 'expect', 'ret:false/no_email', 'label', 'no address, no link',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_link_guest({r3}) as x) s$q$),
    jsonb_build_object('id', 'K13', 'who', 'admin', 'expect', 'ret:false/guest_linked_elsewhere',
      'label', 'the same address in another campaign is never linked twice, even with adopt',
      'setup', $s$select pg_temp.dr_as({admin}); select public.invitation_link_guest({r1})$s$,
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_link_guest({r5}, false, true) as x) s$q$),
    jsonb_build_object('id', 'K14', 'who', 'service', 'expect', 'ret:true/true', 'label', 'the service role may link (decided_by stays empty)',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'created') from (select public.invitation_link_guest({r1}) as x) s$q$,
      'chk', $c$select exists (select 1 from public.gl_guest g where g.event_id = {ev} and g.email = {e_r1} and g.decided_by is null)$c$),
    jsonb_build_object('id', 'K15', 'who', 'admin', 'expect', 'ret:false/campaign_archived', 'label', 'an archived campaign links nobody',
      'setup', $s$update public.invitation_campaign set archived_at = now() where id = {c1}$s$,
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_link_guest({r1}) as x) s$q$),
    jsonb_build_object('id', 'K16', 'who', 'moder', 'expect', 'ret:false/missing_name', 'label', 'the guest list needs a first and a last name',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_link_guest({r6}) as x) s$q$),
    -- Answers received by e-mail
    jsonb_build_object('id', 'A01', 'who', 'member', 'expect', 'rls', 'label', 'a verified member cannot record an answer',
      'q', $q$select public.invitation_set_answer({r1}, 'declined')::text$q$),
    jsonb_build_object('id', 'A02', 'who', 'admin', 'expect', 'err:bad_answer', 'label', 'only accepted, declined or no_answer',
      'q', $q$select public.invitation_set_answer({r1}, 'maybe')::text$q$),
    jsonb_build_object('id', 'A03', 'who', 'admin', 'expect', 'ret:true/confirmed/true/true',
      'label', 'accepted: the row becomes confirmed as v6 rsvp accept does; no e-mail from SQL, the pass is still to send',
      'setup', $s$select pg_temp.dr_as({admin}); select public.invitation_link_guest({r1})$s$,
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'guest_status', x ->> 'changed', x ->> 'pass_needed')
               from (select public.invitation_set_answer({r1}, 'accepted') as x) s$q$,
      'chk', $c$select exists (select 1 from public.invitation_recipient r join public.gl_guest g on g.id = r.gl_guest_id
               where r.id = {r1} and r.status = 'accepted' and r.responded_at is not null and g.status = 'confirmed'
                 and g.responded_at is not null and g.token is not null)
             and not exists (select 1 from public.gl_email_log l where l.event_id = {ev})
             and exists (select 1 from public.invitation_log l where l.recipient_id = {r1} and l.action = 'answer'
               and l.payload ->> 'guest_after' = 'confirmed' and l.actor_id = {admin})$c$),
    jsonb_build_object('id', 'A04', 'who', 'admin', 'expect', 'ret:true/confirmed/false', 'label', 'accepting twice changes nothing',
      'setup', $s$select pg_temp.dr_as({admin}); select public.invitation_link_guest({r1}); select public.invitation_set_answer({r1}, 'accepted')$s$,
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'guest_status', x ->> 'changed') from (select public.invitation_set_answer({r1}, 'accepted') as x) s$q$),
    jsonb_build_object('id', 'A05', 'who', 'admin', 'expect', 'ret:true/declined', 'label', 'declined: invited becomes declined (v6 rsvp decline)',
      'setup', $s$select pg_temp.dr_as({admin}); select public.invitation_link_guest({r1})$s$,
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'guest_status') from (select public.invitation_set_answer({r1}, 'declined') as x) s$q$,
      'chk', $c$select exists (select 1 from public.invitation_recipient r join public.gl_guest g on g.id = r.gl_guest_id
               where r.id = {r1} and r.status = 'declined' and g.status = 'declined' and g.responded_at is not null)$c$),
    jsonb_build_object('id', 'A06', 'who', 'admin', 'expect', 'ret:true/invited', 'label', 'no answer: campaign status only, the seat stays held',
      'setup', $s$select pg_temp.dr_as({admin}); select public.invitation_link_guest({r1})$s$,
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'guest_status') from (select public.invitation_set_answer({r1}, 'no_answer') as x) s$q$,
      'chk', $c$select exists (select 1 from public.invitation_recipient r join public.gl_guest g on g.id = r.gl_guest_id
               where r.id = {r1} and r.status = 'no_answer' and g.status = 'invited' and g.responded_at is null)$c$),
    jsonb_build_object('id', 'A07', 'who', 'admin', 'expect', 'ret:false/guest_answered', 'label', 'no answer is refused once the guest answered',
      'setup', $s$select pg_temp.dr_as({admin}); select public.invitation_link_guest({r1}); select public.invitation_set_answer({r1}, 'accepted')$s$,
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_set_answer({r1}, 'no_answer') as x) s$q$),
    jsonb_build_object('id', 'A08', 'who', 'admin', 'expect', 'ret:false/capacity', 'label', 'accepting after declining needs a free seat (v6)',
      'setup', $s$select pg_temp.dr_as({admin}); select public.invitation_link_guest({r1}); select public.invitation_set_answer({r1}, 'declined');
               insert into public.gl_guest (event_id, source, status, first_name, last_name, email)
               select {ev}::uuid, 'invitation', 'invited', 'Seat', 'No ' || n, 'dryrun-seat-' || n || '-' || {r8} || '@example.invalid'
                 from generate_series(1, 3) n$s$,
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_set_answer({r1}, 'accepted') as x) s$q$,
      'chk', $c$select (select g.status from public.gl_guest g where g.event_id = {ev} and g.email = {e_r1}) = 'declined'$c$),
    jsonb_build_object('id', 'A09', 'who', 'admin', 'expect', 'ret:true/confirmed', 'label', 'unless forced',
      'setup', $s$select pg_temp.dr_as({admin}); select public.invitation_link_guest({r1}); select public.invitation_set_answer({r1}, 'declined');
               insert into public.gl_guest (event_id, source, status, first_name, last_name, email)
               select {ev}::uuid, 'invitation', 'invited', 'Seat', 'No ' || n, 'dryrun-seat-' || n || '-' || {r8} || '@example.invalid'
                 from generate_series(1, 3) n$s$,
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'guest_status') from (select public.invitation_set_answer({r1}, 'accepted', true) as x) s$q$),
    jsonb_build_object('id', 'A10', 'who', 'admin', 'expect', 'ret:false/not_linked', 'label', 'a guest never invited cannot accept',
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_set_answer({r1}, 'accepted') as x) s$q$),
    jsonb_build_object('id', 'A11', 'who', 'admin', 'expect', 'ret:true', 'label', 'but may be marked declined (campaign only, no guest-list row)',
      'q', $q$select x ->> 'ok' from (select public.invitation_set_answer({r1}, 'declined') as x) s$q$,
      'chk', $c$select (select r.status from public.invitation_recipient r where r.id = {r1}) = 'declined'
             and not exists (select 1 from public.gl_guest g where g.event_id = {ev} and g.email = {e_r1})$c$),
    jsonb_build_object('id', 'A12', 'who', 'admin', 'expect', 'ret:false/guest_cancelled', 'label', 'a guest cancelled in WYS 2026 cannot be accepted here',
      'setup', $s$select pg_temp.dr_as({admin}); select public.invitation_link_guest({r1});
               update public.gl_guest set status = 'cancelled' where event_id = {ev} and email = {e_r1}$s$,
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'error') from (select public.invitation_set_answer({r1}, 'accepted') as x) s$q$),
    jsonb_build_object('id', 'A13', 'who', 'moder', 'expect', 'ret:true/confirmed', 'label', 'a moderator records an acceptance',
      'setup', $s$select pg_temp.dr_as({admin}); select public.invitation_link_guest({r1})$s$,
      'q', $q$select concat_ws('/', x ->> 'ok', x ->> 'guest_status') from (select public.invitation_set_answer({r1}, 'accepted') as x) s$q$)
  );

  -- Runner: setup s0 + setup (owner), q as the caller (an expected error is caught around q
  -- only, so chk still runs), chk (owner), all rolled back. {x} = quoted vars.x; <x> = raw.
  for t in select * from jsonb_array_elements(tests) loop
    v_q := t ->> 'q'; v_setup := coalesce(t ->> 'setup', ''); v_chkq := coalesce(t ->> 'chk', ''); v_exp := t ->> 'expect';
    if not coalesce((t ->> 'bare')::boolean, false) then v_setup := s0 || ';' || v_setup; end if;
    for kv in select * from jsonb_each_text(vars) loop
      v_q := replace(v_q, '{' || kv.key || '}', quote_literal(kv.value));
      v_setup := replace(v_setup, '{' || kv.key || '}', quote_literal(kv.value));
      v_chkq := replace(v_chkq, '{' || kv.key || '}', quote_literal(kv.value));
      v_exp := replace(v_exp, '<' || kv.key || '>', kv.value);
    end loop;
    v_dml := lower(left(ltrim(v_q), 6)) in ('insert', 'update', 'delete');
    v_ret := null; v_n := null; v_err := null; v_state := null; v_chk := null;
    begin
      perform set_config('request.jwt.claims', '', true);
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claim.role', '', true);
      if btrim(v_setup, ' ;') <> '' then execute v_setup; end if;
      if t ->> 'who' = 'postgres' then
        null;
      elsif t ->> 'who' = 'anon' then
        perform set_config('request.jwt.claims', '{"role": "anon"}', true);
        set local role anon;
      elsif t ->> 'who' = 'service' then
        perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
        set local role service_role;
      else
        v_uid := (vars ->> (t ->> 'who'))::uuid;
        perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated',
          'email', (select u.email from auth.users u where u.id = v_uid))::text, true);
        set local role authenticated;
      end if;
      begin
        if v_dml then
          execute v_q;
          get diagnostics v_n = row_count;
        else
          execute v_q into v_ret;
        end if;
      exception when others then
        if v_exp like 'err:%' or v_exp = 'rls' then v_err := sqlerrm; v_state := sqlstate; else raise; end if;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      if v_chkq <> '' then execute v_chkq into v_chk; end if;
      raise exception using errcode = 'DRY01', message = 'case finished';
    exception
      when sqlstate 'DRY01' then null;
      when others then v_err := coalesce(v_err, sqlerrm); v_state := coalesce(v_state, sqlstate);
    end;
    v_pass := coalesce(case
                when v_exp = 'allow' then v_err is null and (not v_dml or v_n > 0)
                when v_exp = 'rls' then v_state = '42501' or (v_err is null and v_dml and v_n = 0)
                when v_exp like 'err:%' then strpos(v_err, substr(v_exp, 5)) > 0
                when v_exp like 'ret:%' then v_err is null and v_ret is not distinct from substr(v_exp, 5)
              end, false)
              and (v_chkq = '' or v_chk is true);
    if v_pass then n_pass := n_pass + 1; else n_fail := n_fail + 1; end if;
    results := results || format(E'\n%s %s %s: %s | expect %s | %s%s',
      case when v_pass then 'PASS' else 'FAIL' end, t ->> 'id', t ->> 'who', t ->> 'label', v_exp,
      left(case when v_err is not null then format('error %s: %s', v_state, v_err)
                when v_dml then v_n || ' row(s) written'
                else 'returned ' || coalesce(v_ret, 'null') end, 300),
      case when v_chkq <> '' then ' | chk ' || coalesce(v_chk::text, 'null') else '' end);
  end loop;

  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (invitation_guest_link dry run, run %s)', n_pass, n_fail, now()) || results;
end
$dryrun$;
