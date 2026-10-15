-- DRY RUN of supabase/migrations/down/20261016092000_onsite_invitations.down.sql. NOT A MIGRATION.
-- ONE query text, ONE execute_sql call, before OR after 20261016092000_onsite_invitations is
-- applied: it applies the migration verbatim (a re-run when already applied), then the down
-- verbatim, then checks that the production state is back. Ends with RAISE EXCEPTION
-- 'DRYRUN ...': everything rolls back. Expected: "5 PASS, 0 FAIL".

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create function pg_temp.dr_snap() returns table (k text, v text) language sql as $f$
  select 'gl_guest', (select md5(coalesce(string_agg(concat_ws('/', g.id, g.token, g.status, g.user_id, g.checkin_token, g.updated_at), ',' order by g.id), '')) from public.gl_guest g)
  union all select 'jobs', (select md5(coalesce(string_agg(concat_ws('/', j.id, j.status, j.validate_person, j.created_by), ',' order by j.id), '')) from public.account_provision_job j)
  union all select 'review_log', (select count(*)::text from public.review_log)
  union all select 'settings', (select md5(string_agg(s.key || '=' || s.value::text, ';' order by s.key)) from public.platform_settings s)
  union all select 'policies', (select md5(string_agg(format('%s|%s|%s|%s|%s|%s', pl.tablename, pl.policyname, pl.permissive, pl.roles, pl.qual, pl.with_check), ';' order by pl.tablename, pl.policyname))
                                  from pg_policies pl where pl.schemaname = 'public' and pl.policyname not like 'platform_settings_flags_admin_%')
$f$;
create temp table _dr_before on commit drop as select * from pg_temp.dr_snap();

-- ─── The migration, verbatim ────────────────────────────────────────────────────
-- Registration Phase 3 (integration of the four lanes, 15 Oct 2026): the database side of the
-- invitations of core_v2 events (EVENT lane's requests) and the registration switches written by
-- verified admins only (ADMIN lane, finding 9). Contract docs/registration-contract.md §11.11.
-- NOT APPLIED. Independent of parts 1-4 (20261016090000 .. 091500); needs the registration core
-- (20261009210000). Down: supabase/migrations/down/20261016092000_onsite_invitations.down.sql.
-- Dry runs: supabase/dryrun/20261016092000_onsite_invitations.dryrun.sql, .down.dryrun.sql.
--
-- Nothing calls the two new functions yet: the registration function's staff action `invite`, its
-- `respond` action (the status page's Accept / Decline) and the invitation e-mail are a follow-up.
-- The event editor offers invitations only once that function reports them ({action:
-- "capabilities"}). With every flag off nothing changes for the live site; WYS (guest_list_v1:
-- gl_decide_v2 refuses it, guest-list is untouched) and SM26 (never read) are out of reach.
--  1. gl_decide_v2 (production md5 0b3760d1af5422ea754c46ad50c529e7), core_v2 only:
--       approve also takes an 'invited' row: M3 records a reply given by phone or e-mail
--         ('confirmed', responded_at, review_log 'accepted_for_them'). Its seat was already held
--         (seats held = confirmed + invited + approved), so it is not counted twice against
--         the event's or the type's capacity.
--       reject also takes an 'invited' row: the invitation is WITHDRAWN ('cancelled',
--         cancelled_at, review_log 'invitation_withdrawn'), and its status links are revoked.
--       The result lists them apart ('accepted_for_them', 'withdrawn'): the caller words the
--       e-mail (the editor sends none for a withdrawal unless asked). Everything else unchanged.
--  2. gl_invite_v2(...) (service role: the registration function, after its own staff check;
--     the actor is checked again here). 'invited' rows, source 'invitation', at most 500 per call,
--     an address already on the event is skipped ('already'). M3's choice for the person
--     (validate_person, org_action) and the author are kept on the review_log row 'invited'.
--     A real (not hidden) event takes invitations only once its registration switch is on
--     (onsite_v2 / webinar_v2: before that the e-mails would point at pages the live site does
--     not have). A hidden test event takes at most 10 test addresses (@m3monaco.com,
--     @smartmarinaconnect.com, or the inviting staff member's own address, +tag allowed).
--  3. gl_respond_invitation_v2(p_guest_id, p_accept) (service role, called only once the
--     registration function has resolved the person's status token): 'invited' rows of core_v2
--     events only. Accept = 'confirmed' + responded_at (never refused for capacity, spec §4.1);
--     in the same transaction the provisioning job the trigger just queued (on-site) gets the
--     choice recorded at the invitation (validate_person, org_action, created_by = the inviting
--     staff member; no record = NOT validated: M3 validates every person). Decline = 'declined'.
--     review_log 'invitation_accepted' / 'invitation_declined'.
--  4. platform_settings: the row registration_flags is written by verified ADMINS only
--     (restrictive policies; moderators keep every other key; reads unchanged). The admin page of
--     the switches is already admin-only; this closes the direct API path.

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $pre$
declare
  v_md5 text;
begin
  if to_regprocedure('public.gl_seats_held(uuid,text)') is null or to_regclass('public.gl_access_token') is null
     or to_regclass('public.review_log') is null or to_regprocedure('public.is_admin()') is null then
    raise exception 'onsite_invitations: apply 20261009210000_registration_core first';
  end if;
  select md5(replace(p.prosrc, chr(13), '')) into v_md5
    from pg_proc p where p.oid = to_regprocedure('public.gl_decide_v2(uuid,uuid[],text,uuid,jsonb,boolean,boolean,text,text)');
  if v_md5 is distinct from '0b3760d1af5422ea754c46ad50c529e7' and v_md5 is distinct from 'ad3db18f38b1509741b80c6e7014b0a0' then
    raise exception 'onsite_invitations: gl_decide_v2 changed (md5 %); rebuild this migration from pg_get_functiondef', v_md5;
  end if;
end
$pre$;

-- ---- 1. gl_decide_v2: invited rows (approve = accepted for them, reject = withdrawn) ---------
create or replace function public.gl_decide_v2(
  p_gl_event_id uuid,
  p_guest_ids uuid[],
  p_decision text,
  p_actor uuid,
  p_org_action jsonb default '{"mode": "none"}'::jsonb,
  p_validate_person boolean default true,
  p_force boolean default false,
  p_info_request text default null,
  p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  ev public.gl_event;
  v_from text[];
  v_to text;
  v_ids uuid[];
  v_invited uuid[];
  v_changed uuid[];
  v_held integer;
  v_adding integer;
  v_jobs integer := 0;
  v_info text := nullif(left(btrim(coalesce(p_info_request, '')), 2000), '');
  v_mode text;
  t record;
begin
  if p_decision is null or p_decision not in ('approve', 'reject', 'waitlist', 'request_info') then
    return jsonb_build_object('ok', false, 'error', 'bad_decision');
  end if;
  if p_guest_ids is null or cardinality(p_guest_ids) = 0 or cardinality(p_guest_ids) > 200 then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;
  if p_actor is null or not exists (select 1 from public.profiles pr
                                     where pr.user_id = p_actor
                                       and pr.persona in ('admin', 'moderator')
                                       and pr.access_status = 'verified') then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  -- {mode: none|link|create, org_id, type, name, website, country, as_owner}
  v_mode := case when jsonb_typeof(p_org_action) = 'object' then coalesce(p_org_action ->> 'mode', '') else '' end;
  if v_mode not in ('none', 'link', 'create') then
    return jsonb_build_object('ok', false, 'error', 'bad_org_action');
  end if;
  if v_mode = 'link' then
    begin
      if not exists (select 1 from public.organizations o where o.id = (p_org_action ->> 'org_id')::uuid) then
        return jsonb_build_object('ok', false, 'error', 'bad_org_action');
      end if;
    exception when others then
      return jsonb_build_object('ok', false, 'error', 'bad_org_action');
    end;
  elsif v_mode = 'create' and coalesce(btrim(p_org_action ->> 'name'), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'bad_org_action');
  end if;
  if p_decision = 'request_info' and v_info is null then
    return jsonb_build_object('ok', false, 'error', 'info_request_required');
  end if;

  select * into ev from public.gl_event where id = p_gl_event_id for update;
  if ev.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if ev.engine <> 'core_v2' then
    return jsonb_build_object('ok', false, 'error', 'wrong_engine');
  end if;

  -- 'invited' (integration, 15 Oct 2026): approve = the person accepted by phone or e-mail
  -- (accepted_for_them); reject = M3 withdraws the invitation (cancelled).
  v_from := case p_decision
              when 'approve' then array['requested', 'needs_info', 'waitlisted', 'invited']
              when 'reject' then array['requested', 'needs_info', 'waitlisted', 'invited']
              when 'waitlist' then array['requested', 'needs_info']
              else array['requested', 'waitlisted'] end;
  v_to := case p_decision
            when 'approve' then 'confirmed'
            when 'reject' then 'rejected'
            when 'waitlist' then 'waitlisted'
            else 'needs_info' end;

  select coalesce(array_agg(x.id), '{}'), coalesce(array_agg(x.id) filter (where x.status = 'invited'), '{}')
    into v_ids, v_invited
    from (select g.id, g.status from public.gl_guest g
           where g.event_id = ev.id and g.id = any (p_guest_ids) and g.status = any (v_from)
           order by g.created_at
           for update) x;

  -- Capacity (spec 4.1: seats held = confirmed + invited + approved), event and
  -- tickets. p_force = staff chose to go over. An invited row already holds its seat.
  v_adding := cardinality(v_ids) - cardinality(v_invited);
  if p_decision = 'approve' and not coalesce(p_force, false) and v_adding > 0 then
    v_held := public.gl_seats_held(ev.id);
    if ev.capacity is not null and v_held + v_adding > ev.capacity then
      return jsonb_build_object('ok', false, 'error', 'capacity', 'held', v_held,
                                'capacity', ev.capacity, 'adding', v_adding);
    end if;
    for t in
      select k.ticket_key, count(*)::integer as adding, tk.capacity
        from public.gl_guest k
        join public.gl_ticket tk on tk.event_id = ev.id and tk.key = k.ticket_key
       where k.id = any (v_ids) and k.id <> all (v_invited) and tk.capacity is not null
       group by k.ticket_key, tk.capacity
    loop
      v_held := public.gl_seats_held(ev.id, t.ticket_key);
      if v_held + t.adding > t.capacity then
        return jsonb_build_object('ok', false, 'error', 'ticket_capacity', 'ticket_key', t.ticket_key,
                                  'held', v_held, 'capacity', t.capacity, 'adding', t.adding);
      end if;
    end loop;
  end if;

  with up as (
    update public.gl_guest g
       set status = case when g.status = 'invited' and p_decision = 'reject' then 'cancelled' else v_to end,
           cancelled_at = case when g.status = 'invited' and p_decision = 'reject' then now() else g.cancelled_at end,
           responded_at = case when g.status = 'invited' and p_decision = 'approve' then now() else g.responded_at end,
           decided_at = now(),
           decided_by = p_actor,
           info_request = case when v_to = 'needs_info' then v_info else g.info_request end,
           info_requested_at = case when v_to = 'needs_info' then now() else g.info_requested_at end
     where g.id = any (v_ids) and g.status = any (v_from)
    returning g.id
  )
  select coalesce(array_agg(up.id), '{}') into v_changed from up;

  -- A withdrawn invitation's status links stop working (its door pass was never minted).
  if p_decision = 'reject' and cardinality(v_invited) > 0 then
    update public.gl_access_token a set revoked_at = now()
     where a.guest_id = any (v_invited) and a.guest_id = any (v_changed) and a.revoked_at is null;
  end if;

  -- The provisioning trigger queued the jobs of on-site confirmations with the
  -- defaults; the staff choices land on them in this same transaction.
  if v_to = 'confirmed' and cardinality(v_changed) > 0 then
    update public.account_provision_job j
       set org_action = p_org_action,
           validate_person = coalesce(p_validate_person, true),
           created_by = p_actor
     where j.source_kind = 'gl_guest' and j.source_id = any (v_changed) and j.status = 'queued';
    get diagnostics v_jobs = row_count;
  end if;

  insert into public.review_log (subject_type, subject_id, action, note, details, actor_id)
  select 'registration', x.id,
         case when x.id = any (v_invited) then (case p_decision when 'approve' then 'accepted_for_them' else 'invitation_withdrawn' end)
              else p_decision end,
         nullif(left(btrim(coalesce(p_note, '')), 4000), ''),
         jsonb_strip_nulls(jsonb_build_object(
           'gl_event_id', ev.id,
           'status', case when x.id = any (v_invited) and p_decision = 'reject' then 'cancelled' else v_to end,
           'org_action', case when v_to = 'confirmed' then p_org_action end,
           'validate_person', case when v_to = 'confirmed' then coalesce(p_validate_person, true) end,
           'forced', case when coalesce(p_force, false) then true end,
           'info_request', case when v_to = 'needs_info' then v_info end)),
         p_actor
    from unnest(v_changed) as x(id);

  return jsonb_build_object('ok', true, 'decision', p_decision, 'status', v_to,
                            'changed', to_jsonb(v_changed),
                            'skipped', to_jsonb(array(select u from unnest(p_guest_ids) u where u <> all (v_changed))),
                            'accepted_for_them', to_jsonb(array(select u from unnest(v_changed) u
                                                                 where u = any (v_invited) and p_decision = 'approve')),
                            'withdrawn', to_jsonb(array(select u from unnest(v_changed) u
                                                         where u = any (v_invited) and p_decision = 'reject')),
                            'jobs', v_jobs);
end
$function$;

-- ---- 2. gl_invite_v2: M3 invites people (service role) --------------------------------------
create or replace function public.gl_invite_v2(
  p_gl_event_id uuid,
  p_people jsonb,
  p_ticket_key text default null,
  p_actor uuid default null,
  p_validate_person boolean default true,
  p_org_action jsonb default '{"mode": "none"}'::jsonb,
  p_message text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  ev public.gl_event;
  v_actor_email text;
  v_mode text;
  v_ticket text := nullif(btrim(coalesce(p_ticket_key, '')), '');
  v_active integer;
  v_ends timestamptz;
  v_message text := nullif(left(btrim(coalesce(p_message, '')), 1000), '');
  v_validate boolean := coalesce(p_validate_person, true);
  v_flag text;
  x jsonb;
  v_email text;
  v_local text;
  v_domain text;
  v_id uuid;
  v_seen text[] := '{}';
  v_invited jsonb := '[]'::jsonb;
  v_already jsonb := '[]'::jsonb;
  v_invalid jsonb := '[]'::jsonb;
begin
  if p_actor is null or not exists (select 1 from public.profiles pr
                                     where pr.user_id = p_actor
                                       and pr.persona in ('admin', 'moderator')
                                       and pr.access_status = 'verified') then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_gl_event_id is null or jsonb_typeof(p_people) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;
  if jsonb_array_length(p_people) = 0 or jsonb_array_length(p_people) > 500 then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;
  -- The account choices applied when the person accepts (as gl_decide_v2 takes them).
  v_mode := case when jsonb_typeof(p_org_action) = 'object' then coalesce(p_org_action ->> 'mode', '') else '' end;
  if v_mode not in ('none', 'link', 'create') then
    return jsonb_build_object('ok', false, 'error', 'bad_org_action');
  end if;
  if v_mode = 'link' then
    begin
      if not exists (select 1 from public.organizations o where o.id = (p_org_action ->> 'org_id')::uuid) then
        return jsonb_build_object('ok', false, 'error', 'bad_org_action');
      end if;
    exception when others then
      return jsonb_build_object('ok', false, 'error', 'bad_org_action');
    end;
  elsif v_mode = 'create' and coalesce(btrim(p_org_action ->> 'name'), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'bad_org_action');
  end if;

  select * into ev from public.gl_event where id = p_gl_event_id for update;
  if ev.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if ev.engine <> 'core_v2' then
    return jsonb_build_object('ok', false, 'error', 'wrong_engine');
  end if;
  select w.ends_at into v_ends from public.gl_event_window(ev.id) w;
  if v_ends is not null and v_ends < now() then
    return jsonb_build_object('ok', false, 'error', 'event_ended');
  end if;
  -- A real event invites only once its pages are live (the switch of its type).
  if not ev.hidden then
    v_flag := case ev.kind when 'webinar' then 'webinar_v2' else 'onsite_v2' end;
    if not coalesce((select (ps.value -> v_flag) = 'true'::jsonb from public.platform_settings ps
                      where ps.key = 'registration_flags'), false) then
      return jsonb_build_object('ok', false, 'error', ev.kind || '_not_live');
    end if;
  end if;

  -- The participation type: the one named (an active type of this event), else the only active
  -- one; with several, one must be named.
  select count(*)::integer into v_active from public.gl_ticket tk where tk.event_id = ev.id and tk.active;
  if v_ticket is null then
    if v_active > 1 then
      return jsonb_build_object('ok', false, 'error', 'ticket_required');
    elsif v_active = 1 then
      select tk.key into v_ticket from public.gl_ticket tk where tk.event_id = ev.id and tk.active;
    end if;
  elsif not exists (select 1 from public.gl_ticket tk where tk.event_id = ev.id and tk.key = v_ticket and tk.active) then
    return jsonb_build_object('ok', false, 'error', 'unknown_ticket');
  end if;

  -- A hidden test e-mails only M3's own addresses (the editor checks the same rule).
  if ev.hidden then
    if jsonb_array_length(p_people) > 10 then
      return jsonb_build_object('ok', false, 'error', 'test_addresses_only');
    end if;
    select lower(btrim(u.email)) into v_actor_email from auth.users u where u.id = p_actor;
    for x in select * from jsonb_array_elements(p_people) loop
      v_email := lower(btrim(coalesce(case when jsonb_typeof(x) = 'object' then x ->> 'email' end, '')));
      v_local := regexp_replace(split_part(v_email, '@', 1), '\+.*$', '');
      v_domain := split_part(v_email, '@', 2);
      if v_email <> '' and not (v_domain in ('m3monaco.com', 'smartmarinaconnect.com')
              or (v_actor_email is not null and v_domain = split_part(v_actor_email, '@', 2)
                  and v_local = regexp_replace(split_part(v_actor_email, '@', 1), '\+.*$', ''))) then
        return jsonb_build_object('ok', false, 'error', 'test_addresses_only');
      end if;
    end loop;
  end if;

  for x in select * from jsonb_array_elements(p_people) loop
    v_email := lower(btrim(coalesce(case when jsonb_typeof(x) = 'object' then x ->> 'email' end, '')));
    if length(v_email) > 254 or v_email !~ '^[^[:space:]@,;<>"()]+@[^[:space:]@,;<>"()]+\.[^[:space:]@,;<>"()]{2,}$' then
      v_invalid := v_invalid || to_jsonb(left(coalesce(case when jsonb_typeof(x) = 'object' then x ->> 'email' end, ''), 254));
      continue;
    end if;
    if v_email = any (v_seen) then
      continue;
    end if;
    v_seen := v_seen || v_email;
    v_id := null;
    insert into public.gl_guest as g (event_id, source, status, first_name, last_name, email, company, ticket_key,
                                      invited_at, source_detail)
    values (ev.id, 'invitation', 'invited',
            left(btrim(coalesce(x ->> 'first_name', '')), 100),
            left(btrim(coalesce(x ->> 'last_name', '')), 100),
            v_email,
            nullif(left(btrim(coalesce(x ->> 'company', '')), 200), ''),
            v_ticket, now(), jsonb_build_object('entry', 'invitation'))
    on conflict do nothing
    returning g.id into v_id;
    if v_id is null then
      v_already := v_already || to_jsonb(v_email);
      continue;
    end if;
    insert into public.review_log (subject_type, subject_id, action, note, details, actor_id)
    values ('registration', v_id, 'invited', null,
            jsonb_strip_nulls(jsonb_build_object('gl_event_id', ev.id, 'ticket_key', v_ticket,
              'validate_person', v_validate, 'org_action', p_org_action, 'message', v_message)),
            p_actor);
    v_invited := v_invited || jsonb_build_object('guest_id', v_id, 'email', v_email);
  end loop;

  return jsonb_build_object('ok', true, 'invited', v_invited, 'already', v_already, 'invalid', v_invalid,
                            'ticket_key', v_ticket, 'seats_held', public.gl_seats_held(ev.id), 'capacity', ev.capacity);
end
$function$;

-- ---- 3. gl_respond_invitation_v2: the person's answer (service role) ------------------------
create or replace function public.gl_respond_invitation_v2(p_guest_id uuid, p_accept boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  g public.gl_guest;
  ev public.gl_event;
  v_ends timestamptz;
  v_to text;
  v_inv_details jsonb;
  v_inv_actor uuid;
  v_validate boolean;
  v_org jsonb;
  v_jobs integer := 0;
begin
  if p_guest_id is null or p_accept is null then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;
  select * into g from public.gl_guest where id = p_guest_id for update;
  if g.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select * into ev from public.gl_event where id = g.event_id;
  if ev.engine is distinct from 'core_v2' then
    return jsonb_build_object('ok', false, 'error', 'wrong_engine');
  end if;
  v_to := case when p_accept then 'confirmed' else 'declined' end;
  if g.status <> 'invited' then
    -- A second click on the same answer is fine; anything else is not an open invitation.
    if g.status = v_to then
      return jsonb_build_object('ok', true, 'already', true, 'status', g.status, 'guest_id', g.id);
    end if;
    return jsonb_build_object('ok', false, 'error', 'not_invited', 'status', g.status);
  end if;
  if p_accept then
    select w.ends_at into v_ends from public.gl_event_window(ev.id) w;
    if v_ends is not null and v_ends < now() then
      return jsonb_build_object('ok', false, 'error', 'event_ended');
    end if;
  end if;

  -- The invitation as M3 recorded it (gl_invite_v2): the choice for the person and its author.
  select l.details, l.actor_id into v_inv_details, v_inv_actor
    from public.review_log l
   where l.subject_type = 'registration' and l.subject_id = g.id and l.action = 'invited'
   order by l.created_at desc, l.id desc
   limit 1;
  -- No record: NOT validated (M3 validates every person; the queue shows them).
  v_validate := case when jsonb_typeof(v_inv_details -> 'validate_person') = 'boolean'
                     then (v_inv_details ->> 'validate_person')::boolean else false end;
  v_org := case when jsonb_typeof(v_inv_details -> 'org_action') = 'object'
                then v_inv_details -> 'org_action' else '{"mode": "none"}'::jsonb end;

  update public.gl_guest set status = v_to, responded_at = now()
   where id = g.id and status = 'invited';
  -- On-site: the provisioning trigger queued the job with the defaults; M3's recorded choice
  -- lands on it in this same transaction, before any cron can see it.
  if p_accept then
    update public.account_provision_job j
       set org_action = v_org, validate_person = v_validate, created_by = v_inv_actor
     where j.source_kind = 'gl_guest' and j.source_id = g.id and j.status = 'queued';
    get diagnostics v_jobs = row_count;
  end if;

  insert into public.review_log (subject_type, subject_id, action, note, details, actor_id)
  values ('registration', g.id, case when p_accept then 'invitation_accepted' else 'invitation_declined' end, null,
          jsonb_strip_nulls(jsonb_build_object('gl_event_id', ev.id, 'status', v_to,
            'validated_by', case when p_accept and v_validate then v_inv_actor end,
            'validate_person', case when p_accept then v_validate end,
            'org_mode', case when p_accept then v_org ->> 'mode' end)),
          null);

  return jsonb_build_object('ok', true, 'status', v_to, 'guest_id', g.id, 'jobs', v_jobs);
end
$function$;

revoke all on function public.gl_decide_v2(uuid, uuid[], text, uuid, jsonb, boolean, boolean, text, text) from public, anon, authenticated;
grant execute on function public.gl_decide_v2(uuid, uuid[], text, uuid, jsonb, boolean, boolean, text, text) to service_role;
revoke all on function public.gl_invite_v2(uuid, jsonb, text, uuid, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function public.gl_invite_v2(uuid, jsonb, text, uuid, boolean, jsonb, text) to service_role;
revoke all on function public.gl_respond_invitation_v2(uuid, boolean) from public, anon, authenticated;
grant execute on function public.gl_respond_invitation_v2(uuid, boolean) to service_role;

comment on function public.gl_invite_v2(uuid, jsonb, text, uuid, boolean, jsonb, text) is 'Phase 3 (integration): M3 invites people to a core_v2 event (invited rows); M3''s choice for the person is kept on review_log ''invited''. Service role (registration function).';
comment on function public.gl_respond_invitation_v2(uuid, boolean) is 'Phase 3 (integration): the invited person accepts (confirmed; M3''s recorded choice lands on the provisioning job) or declines. Service role, after the status token.';

-- ---- 4. The registration switches: verified admins only ------------------------------------
drop policy if exists platform_settings_flags_admin_insert on public.platform_settings;
drop policy if exists platform_settings_flags_admin_update on public.platform_settings;
drop policy if exists platform_settings_flags_admin_delete on public.platform_settings;
create policy platform_settings_flags_admin_insert on public.platform_settings as restrictive for insert
  with check (key <> 'registration_flags' or public.is_admin());
create policy platform_settings_flags_admin_update on public.platform_settings as restrictive for update
  using (key <> 'registration_flags' or public.is_admin())
  with check (key <> 'registration_flags' or public.is_admin());
create policy platform_settings_flags_admin_delete on public.platform_settings as restrictive for delete
  using (key <> 'registration_flags' or public.is_admin());

-- ─── The down, verbatim ─────────────────────────────────────────────────────────
-- DOWN for supabase/migrations/20261016092000_onsite_invitations.sql
-- Puts back the production body of gl_decide_v2 (md5 0b3760d1af5422ea754c46ad50c529e7), verbatim
-- from 20261009210000_registration_core.sql (no 'invited' rows: approve and reject skip them again),
-- drops gl_invite_v2 and gl_respond_invitation_v2, and the three restrictive policies on
-- platform_settings (moderators may write registration_flags again, as before). Rows written in
-- between stay as they are: invitations ('invited'), withdrawn ones ('cancelled', links revoked),
-- answers ('confirmed' / 'declined') and their review_log rows.

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $pre$
declare
  v_md5 text;
begin
  select md5(replace(p.prosrc, chr(13), '')) into v_md5
    from pg_proc p where p.oid = to_regprocedure('public.gl_decide_v2(uuid,uuid[],text,uuid,jsonb,boolean,boolean,text,text)');
  if v_md5 is distinct from 'ad3db18f38b1509741b80c6e7014b0a0' and v_md5 is distinct from '0b3760d1af5422ea754c46ad50c529e7' then
    raise exception 'onsite_invitations down: gl_decide_v2 changed since (md5 %); rebuild this down', v_md5;
  end if;
end
$pre$;

create or replace function public.gl_decide_v2(
  p_gl_event_id uuid,
  p_guest_ids uuid[],
  p_decision text,
  p_actor uuid,
  p_org_action jsonb default '{"mode": "none"}'::jsonb,
  p_validate_person boolean default true,
  p_force boolean default false,
  p_info_request text default null,
  p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  ev public.gl_event;
  v_from text[];
  v_to text;
  v_ids uuid[];
  v_changed uuid[];
  v_held integer;
  v_jobs integer := 0;
  v_info text := nullif(left(btrim(coalesce(p_info_request, '')), 2000), '');
  v_mode text;
  t record;
begin
  if p_decision is null or p_decision not in ('approve', 'reject', 'waitlist', 'request_info') then
    return jsonb_build_object('ok', false, 'error', 'bad_decision');
  end if;
  if p_guest_ids is null or cardinality(p_guest_ids) = 0 or cardinality(p_guest_ids) > 200 then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;
  if p_actor is null or not exists (select 1 from public.profiles pr
                                     where pr.user_id = p_actor
                                       and pr.persona in ('admin', 'moderator')
                                       and pr.access_status = 'verified') then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  -- {mode: none|link|create, org_id, type, name, website, country, as_owner}
  v_mode := case when jsonb_typeof(p_org_action) = 'object' then coalesce(p_org_action ->> 'mode', '') else '' end;
  if v_mode not in ('none', 'link', 'create') then
    return jsonb_build_object('ok', false, 'error', 'bad_org_action');
  end if;
  if v_mode = 'link' then
    begin
      if not exists (select 1 from public.organizations o where o.id = (p_org_action ->> 'org_id')::uuid) then
        return jsonb_build_object('ok', false, 'error', 'bad_org_action');
      end if;
    exception when others then
      return jsonb_build_object('ok', false, 'error', 'bad_org_action');
    end;
  elsif v_mode = 'create' and coalesce(btrim(p_org_action ->> 'name'), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'bad_org_action');
  end if;
  if p_decision = 'request_info' and v_info is null then
    return jsonb_build_object('ok', false, 'error', 'info_request_required');
  end if;

  select * into ev from public.gl_event where id = p_gl_event_id for update;
  if ev.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if ev.engine <> 'core_v2' then
    return jsonb_build_object('ok', false, 'error', 'wrong_engine');
  end if;

  v_from := case p_decision
              when 'approve' then array['requested', 'needs_info', 'waitlisted']
              when 'reject' then array['requested', 'needs_info', 'waitlisted']
              when 'waitlist' then array['requested', 'needs_info']
              else array['requested', 'waitlisted'] end;
  v_to := case p_decision
            when 'approve' then 'confirmed'
            when 'reject' then 'rejected'
            when 'waitlist' then 'waitlisted'
            else 'needs_info' end;

  select coalesce(array_agg(x.id), '{}') into v_ids
    from (select g.id from public.gl_guest g
           where g.event_id = ev.id and g.id = any (p_guest_ids) and g.status = any (v_from)
           order by g.created_at
           for update) x;

  -- Capacity (spec 4.1: seats held = confirmed + invited + approved), event and
  -- tickets. p_force = staff chose to go over.
  if p_decision = 'approve' and not coalesce(p_force, false) and cardinality(v_ids) > 0 then
    v_held := public.gl_seats_held(ev.id);
    if ev.capacity is not null and v_held + cardinality(v_ids) > ev.capacity then
      return jsonb_build_object('ok', false, 'error', 'capacity', 'held', v_held,
                                'capacity', ev.capacity, 'adding', cardinality(v_ids));
    end if;
    for t in
      select k.ticket_key, count(*)::integer as adding, tk.capacity
        from public.gl_guest k
        join public.gl_ticket tk on tk.event_id = ev.id and tk.key = k.ticket_key
       where k.id = any (v_ids) and tk.capacity is not null
       group by k.ticket_key, tk.capacity
    loop
      v_held := public.gl_seats_held(ev.id, t.ticket_key);
      if v_held + t.adding > t.capacity then
        return jsonb_build_object('ok', false, 'error', 'ticket_capacity', 'ticket_key', t.ticket_key,
                                  'held', v_held, 'capacity', t.capacity, 'adding', t.adding);
      end if;
    end loop;
  end if;

  with up as (
    update public.gl_guest g
       set status = v_to,
           decided_at = now(),
           decided_by = p_actor,
           info_request = case when v_to = 'needs_info' then v_info else g.info_request end,
           info_requested_at = case when v_to = 'needs_info' then now() else g.info_requested_at end
     where g.id = any (v_ids) and g.status = any (v_from)
    returning g.id
  )
  select coalesce(array_agg(up.id), '{}') into v_changed from up;

  -- The provisioning trigger queued the jobs of on-site confirmations with the
  -- defaults; the staff choices land on them in this same transaction.
  if v_to = 'confirmed' and cardinality(v_changed) > 0 then
    update public.account_provision_job j
       set org_action = p_org_action,
           validate_person = coalesce(p_validate_person, true),
           created_by = p_actor
     where j.source_kind = 'gl_guest' and j.source_id = any (v_changed) and j.status = 'queued';
    get diagnostics v_jobs = row_count;
  end if;

  insert into public.review_log (subject_type, subject_id, action, note, details, actor_id)
  select 'registration', x.id, p_decision, nullif(left(btrim(coalesce(p_note, '')), 4000), ''),
         jsonb_strip_nulls(jsonb_build_object(
           'gl_event_id', ev.id, 'status', v_to,
           'org_action', case when v_to = 'confirmed' then p_org_action end,
           'validate_person', case when v_to = 'confirmed' then coalesce(p_validate_person, true) end,
           'forced', case when coalesce(p_force, false) then true end,
           'info_request', case when v_to = 'needs_info' then v_info end)),
         p_actor
    from unnest(v_changed) as x(id);

  return jsonb_build_object('ok', true, 'decision', p_decision, 'status', v_to,
                            'changed', to_jsonb(v_changed),
                            'skipped', to_jsonb(array(select u from unnest(p_guest_ids) u where u <> all (v_changed))),
                            'jobs', v_jobs);
end
$function$;

revoke all on function public.gl_decide_v2(uuid, uuid[], text, uuid, jsonb, boolean, boolean, text, text) from public, anon, authenticated;
grant execute on function public.gl_decide_v2(uuid, uuid[], text, uuid, jsonb, boolean, boolean, text, text) to service_role;

drop function if exists public.gl_invite_v2(uuid, jsonb, text, uuid, boolean, jsonb, text);
drop function if exists public.gl_respond_invitation_v2(uuid, boolean);

drop policy if exists platform_settings_flags_admin_insert on public.platform_settings;
drop policy if exists platform_settings_flags_admin_update on public.platform_settings;
drop policy if exists platform_settings_flags_admin_delete on public.platform_settings;

-- ─── Checks ─────────────────────────────────────────────────────────────────────
do $dryrun$
declare
  n_pass integer := 0; n_fail integer := 0;
  results text := '';
  c record;
begin
  for c in
    select * from (values
      ('D01', 'gl_decide_v2 is the production body again (md5 0b3760d1...)',
       (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p
         where p.oid = to_regprocedure('public.gl_decide_v2(uuid,uuid[],text,uuid,jsonb,boolean,boolean,text,text)')) = '0b3760d1af5422ea754c46ad50c529e7'),
      ('D02', 'gl_invite_v2 and gl_respond_invitation_v2 are gone',
       to_regprocedure('public.gl_invite_v2(uuid,jsonb,text,uuid,boolean,jsonb,text)') is null
       and to_regprocedure('public.gl_respond_invitation_v2(uuid,boolean)') is null),
      ('D03', 'the three restrictive policies on platform_settings are gone',
       not exists (select 1 from pg_policies pl where pl.schemaname = 'public' and pl.policyname like 'platform_settings_flags_admin_%')),
      ('D04', 'gl_decide_v2 stays service role only',
       has_function_privilege('service_role', 'public.gl_decide_v2(uuid,uuid[],text,uuid,jsonb,boolean,boolean,text,text)', 'execute')
       and not has_function_privilege('authenticated', 'public.gl_decide_v2(uuid,uuid[],text,uuid,jsonb,boolean,boolean,text,text)', 'execute')
       and not has_function_privilege('anon', 'public.gl_decide_v2(uuid,uuid[],text,uuid,jsonb,boolean,boolean,text,text)', 'execute')),
      ('D05', 'no row and no other policy changed (registrations, jobs, review_log, settings)',
       not exists ((select * from _dr_before except select * from pg_temp.dr_snap())
                   union all (select * from pg_temp.dr_snap() except select * from _dr_before)))
    ) as x(id, label, ok)
  loop
    if coalesce(c.ok, false) then n_pass := n_pass + 1; else n_fail := n_fail + 1; end if;
    results := results || format(E'\n%s %s: %s', case when coalesce(c.ok, false) then 'PASS' else 'FAIL' end, c.id, c.label);
  end loop;
  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (onsite_invitations down dry run, run %s)', n_pass, n_fail, now()) || results;
end
$dryrun$;
