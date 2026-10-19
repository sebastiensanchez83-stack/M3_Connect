-- DRY RUN of supabase/migrations/20261016092000_onsite_invitations.sql (invitations of core_v2
-- events: gl_decide_v2 on invited rows, gl_invite_v2, gl_respond_invitation_v2; registration_flags
-- written by admins only). NOT A MIGRATION. ONE query text, ONE execute_sql call, BEFORE that file
-- is applied (any order with parts 1-4). A snapshot, the migration verbatim, then cases on test
-- events (rolled back; nothing is e-mailed: no edge function is called). Ends with
-- RAISE EXCEPTION 'DRYRUN ...'. Expected: "35 PASS, 0 FAIL".

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ─── A. Snapshot (read again after the migration, case S01: must be identical) ─
create function pg_temp.dr_snap() returns table (k text, v text) language sql as $f$
  select 'sm26', md5(concat_ws('|',
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_registration x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_role_assignment x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_attendee x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_badge x)))
  union all select 'gl_guest', (select md5(coalesce(string_agg(concat_ws('/', g.id, g.token, g.status, g.user_id, g.checkin_token, g.updated_at), ',' order by g.id), '')) from public.gl_guest g)
  union all select 'gl_event', (select md5(coalesce(string_agg(concat_ws('/', e.id, e.slug, e.engine, e.hidden, e.updated_at), ',' order by e.id), '')) from public.gl_event e)
  union all select 'jobs', (select md5(coalesce(string_agg(concat_ws('/', j.id, j.status, j.validate_person, j.created_by, j.email_due_at), ',' order by j.id), '')) from public.account_provision_job j)
  union all select 'tokens', (select count(*)::text || '/' || count(a.revoked_at)::text from public.gl_access_token a)
  union all select 'review_log', (select count(*)::text from public.review_log)
  union all select 'settings', (select md5(string_agg(s.key || '=' || s.value::text, ';' order by s.key)) from public.platform_settings s)
  union all select 'policies', (select md5(string_agg(format('%s|%s|%s|%s|%s|%s', pl.tablename, pl.policyname, pl.permissive, pl.roles, pl.qual, pl.with_check), ';' order by pl.tablename, pl.policyname))
                                  from pg_policies pl where pl.schemaname = 'public' and pl.policyname not like 'platform_settings_flags_admin_%')
$f$;
create temp table _dr_before on commit drop as select * from pg_temp.dr_snap();

-- ─── B. The migration, verbatim ─────────────────────────────────────────────────
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
--       e-mail (the editor sends none for a withdrawal unless asked).
--       org_action {mode: 'create'} needs a company type (marina, partner, media_partner,
--       developer, investor): provision-person creates a VERIFIED company, never an untyped one
--       (spec §3.9; fixer, 15 Oct). Everything else unchanged.
--  2. gl_invite_v2(...) (service role: the registration function, after its own staff check;
--     the actor is checked again here). 'invited' rows, source 'invitation', at most 500 per call,
--     an address already on the event is skipped ('already'). M3's choice for the person
--     (validate_person, org_action) and the author are kept on the review_log row 'invited'.
--     An invitation holds a seat: over the event's or the type's capacity it is refused
--     ('capacity' / 'ticket_capacity' with held, capacity, adding) unless p_force (staff chose
--     to go over), as guest-list's invite and gl_decide_v2 do (fixer, 15 Oct).
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
  if v_md5 is distinct from '0b3760d1af5422ea754c46ad50c529e7' and v_md5 is distinct from '75171c1bfeaf87e4409f915b11ee211c' then
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
  elsif v_mode = 'create' and (coalesce(btrim(p_org_action ->> 'name'), '') = ''
                               or coalesce(p_org_action ->> 'type', '') not in ('marina', 'partner', 'media_partner', 'developer', 'investor')) then
    -- A company M3 creates is verified: never without a name, never untyped (spec §3.9).
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
-- (The 7-argument draft of this function was never applied; dropped so a re-run never leaves two.)
drop function if exists public.gl_invite_v2(uuid, jsonb, text, uuid, boolean, jsonb, text);
create or replace function public.gl_invite_v2(
  p_gl_event_id uuid,
  p_people jsonb,
  p_ticket_key text default null,
  p_actor uuid default null,
  p_validate_person boolean default true,
  p_org_action jsonb default '{"mode": "none"}'::jsonb,
  p_message text default null,
  p_force boolean default false)
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
  c_email_re constant text := '^[^[:space:]@,;<>"()]+@[^[:space:]@,;<>"()]+\.[^[:space:]@,;<>"()]{2,}$';
  v_adding integer;
  v_held integer;
  v_tcap integer;
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
  elsif v_mode = 'create' and (coalesce(btrim(p_org_action ->> 'name'), '') = ''
                               or coalesce(p_org_action ->> 'type', '') not in ('marina', 'partner', 'media_partner', 'developer', 'investor')) then
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

  -- Capacity (spec 4.1: seats held = confirmed + invited + approved; the event row is locked
  -- above): the new addresses, each counted once. p_force = staff chose to go over.
  if not coalesce(p_force, false) then
    select count(distinct q.addr)::integer into v_adding
      from (select lower(btrim(coalesce(case when jsonb_typeof(pe.val) = 'object' then pe.val ->> 'email' end, ''))) as addr
              from jsonb_array_elements(p_people) as pe(val)) q
     where length(q.addr) <= 254 and q.addr ~ c_email_re
       and not exists (select 1 from public.gl_guest g where g.event_id = ev.id and lower(g.email) = q.addr);
    if v_adding > 0 then
      v_held := public.gl_seats_held(ev.id);
      if ev.capacity is not null and v_held + v_adding > ev.capacity then
        return jsonb_build_object('ok', false, 'error', 'capacity', 'held', v_held, 'capacity', ev.capacity, 'adding', v_adding);
      end if;
      select tk.capacity into v_tcap from public.gl_ticket tk where tk.event_id = ev.id and tk.key = v_ticket;
      if v_ticket is not null and v_tcap is not null then
        v_held := public.gl_seats_held(ev.id, v_ticket);
        if v_held + v_adding > v_tcap then
          return jsonb_build_object('ok', false, 'error', 'ticket_capacity', 'ticket_key', v_ticket,
                                    'held', v_held, 'capacity', v_tcap, 'adding', v_adding);
        end if;
      end if;
    end if;
  end if;

  for x in select * from jsonb_array_elements(p_people) loop
    v_email := lower(btrim(coalesce(case when jsonb_typeof(x) = 'object' then x ->> 'email' end, '')));
    if length(v_email) > 254 or v_email !~ c_email_re then
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
              'validate_person', v_validate, 'org_action', p_org_action, 'message', v_message,
              'forced', case when coalesce(p_force, false) then true end)),
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
revoke all on function public.gl_invite_v2(uuid, jsonb, text, uuid, boolean, jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.gl_invite_v2(uuid, jsonb, text, uuid, boolean, jsonb, text, boolean) to service_role;
revoke all on function public.gl_respond_invitation_v2(uuid, boolean) from public, anon, authenticated;
grant execute on function public.gl_respond_invitation_v2(uuid, boolean) to service_role;

comment on function public.gl_invite_v2(uuid, jsonb, text, uuid, boolean, jsonb, text, boolean) is 'Phase 3 (integration): M3 invites people to a core_v2 event (invited rows; an invitation holds a seat: capacity / ticket_capacity unless p_force); M3''s choice for the person is kept on review_log ''invited''. Service role (registration function).';
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

-- ─── C. Test helpers (temporary, gone with the rollback) ───────────────────────
-- An account: the auth.users row (handle_new_user makes the profile), then status, persona, proof.
create function pg_temp.dr_user(p_id uuid, p_email text, p_meta jsonb, p_proven boolean, p_status text, p_persona text)
returns void language plpgsql as $f$
begin
  insert into auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
  values (p_id, p_email, 'authenticated', 'authenticated', p_meta, now(), now(), now());
  update public.profiles
     set email_proven_at = case when p_proven then now() end,
         access_status = p_status::public.access_status_enum,
         persona = p_persona::public.persona_enum,
         onboarding_status = (case when p_status = 'verified' then 'completed' else 'submitted' end)::public.onboarding_status_enum
   where user_id = p_id;
end
$f$;

-- ─── D. Cases ───────────────────────────────────────────────────────────────────
do $dryrun$
declare
  tests jsonb := '[]'::jsonb;
  t jsonb;
  kv record;
  vars jsonb;
  s0 text;
  inv text;
  v_q text; v_setup text; v_chkq text; v_exp text;
  v_uid uuid; v_dml boolean; v_ret text; v_n bigint;
  v_err text; v_state text; v_chk boolean; v_pass boolean;
  n_pass integer := 0; n_fail integer := 0;
  results text := '';
  r8 text := substr(md5(random()::text), 1, 8);
begin
  vars := jsonb_build_object('adm', gen_random_uuid(), 'mem', gen_random_uuid(), 'mod', gen_random_uuid(),
    'ev', gen_random_uuid(), 'ev2', gen_random_uuid(), 'ev1', gen_random_uuid(),
    'g1', gen_random_uuid(), 'gi', gen_random_uuid(), 'gc', gen_random_uuid(), 'gv', gen_random_uuid(), 'r8', r8,
    'e_adm', 'dryrun-adm-' || r8 || '@example.invalid', 'e_adm_tag', 'dryrun-adm-' || r8 || '+t1@example.invalid',
    'e_mem', 'dryrun-mem-' || r8 || '@example.invalid', 'e_mod', 'dryrun-mod-' || r8 || '@example.invalid',
    'e_g1', 'dryrun-g1-' || r8 || '@m3monaco.com', 'e_i', 'dryrun-inv-' || r8 || '@example.invalid',
    'e_t', 'dryrun-' || r8 || '@m3monaco.com', 'e_out', 'dryrun-out-' || r8 || '@example.com');
  -- Three staff / member accounts; a hidden core_v2 on-site test event (ev: two types, VIP for
  -- 1, one request g1), a real one (ev2), a guest-list event (ev1) with one request (gv).
  s0 := $s$select pg_temp.dr_user({adm}, {e_adm}, '{}', true, 'verified', 'admin');
select pg_temp.dr_user({mem}, {e_mem}, '{}', true, 'verified', 'marina');
select pg_temp.dr_user({mod}, {e_mod}, '{}', true, 'verified', 'moderator');
insert into public.gl_event (id, slug, title, engine, door_token, kind, registration_mode, requests_open, hidden, settings)
values ({ev}, 'dryrun-inv-' || {r8}, 'Dryrun invitations', 'core_v2', 'separate', 'onsite', 'invitation', false, true, jsonb_build_object('starts_at', (now() + interval '10 days')::text)),
       ({ev2}, 'dryrun-inv2-' || {r8}, 'Dryrun real event', 'core_v2', 'separate', 'onsite', 'invitation', false, false, jsonb_build_object('starts_at', (now() + interval '10 days')::text));
insert into public.gl_event (id, slug, title, hidden) values ({ev1}, 'dryrun-inv1-' || {r8}, 'Dryrun guest list', true);
insert into public.gl_ticket (event_id, key, label, invite_only, capacity) values ({ev}, 'attendee', 'Attendee', false, null), ({ev}, 'vip', 'VIP', true, 1);
insert into public.gl_guest (id, event_id, source, status, first_name, last_name, email, ticket_key) values ({g1}, {ev}, 'registration', 'requested', 'Reg', 'Uest', {e_g1}, 'attendee');
insert into public.gl_guest (id, event_id, source, status, first_name, last_name, email) values ({gv}, {ev1}, 'request', 'requested', 'Vee', 'One', {e_g1})$s$;
  -- An invited VIP (gi) on ev, as gl_invite_v2 leaves it but without its review_log row.
  inv := $s$insert into public.gl_guest (id, event_id, source, status, first_name, last_name, email, ticket_key, invited_at)
values ({gi}, {ev}, 'invitation', 'invited', 'Ina', 'Vited', {e_i}, 'vip', now())$s$;
  tests := jsonb_build_array(
    jsonb_build_object('id', 'S01', 'who', 'postgres', 'bare', true, 'expect', 'ret:0', 'label', 'the migration changes no row (SM26, WYS, jobs, tokens, settings) and no other policy',
      'q', $q$select count(*)::text from ((select * from _dr_before except select * from pg_temp.dr_snap()) union all (select * from pg_temp.dr_snap() except select * from _dr_before)) d$q$),
    jsonb_build_object('id', 'S02', 'who', 'postgres', 'bare', true, 'expect', 'ret:75171c1bfeaf87e4409f915b11ee211c,abe4f10d74f0f10f67edd23622b74e7b,c6580c9b0b66c5cde88774b7bd5b4d15', 'label', 'stored bodies = this file (gl_decide_v2, gl_invite_v2, gl_respond_invitation_v2)',
      'q', $q$select string_agg(md5(replace(p.prosrc, chr(13), '')), ',' order by p.proname collate "C") from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('gl_decide_v2', 'gl_invite_v2', 'gl_respond_invitation_v2')$q$),
    jsonb_build_object('id', 'S03', 'who', 'postgres', 'bare', true, 'expect', 'ret:false/false/false/false/true/true/true', 'label', 'the three functions: service role only (not members, not visitors)',
      'q', $q$select concat_ws('/', has_function_privilege('authenticated', 'public.gl_invite_v2(uuid,jsonb,text,uuid,boolean,jsonb,text,boolean)', 'execute')::text,
                has_function_privilege('anon', 'public.gl_invite_v2(uuid,jsonb,text,uuid,boolean,jsonb,text,boolean)', 'execute')::text,
                has_function_privilege('authenticated', 'public.gl_respond_invitation_v2(uuid,boolean)', 'execute')::text,
                has_function_privilege('authenticated', 'public.gl_decide_v2(uuid,uuid[],text,uuid,jsonb,boolean,boolean,text,text)', 'execute')::text,
                has_function_privilege('service_role', 'public.gl_invite_v2(uuid,jsonb,text,uuid,boolean,jsonb,text,boolean)', 'execute')::text,
                has_function_privilege('service_role', 'public.gl_respond_invitation_v2(uuid,boolean)', 'execute')::text,
                has_function_privilege('service_role', 'public.gl_decide_v2(uuid,uuid[],text,uuid,jsonb,boolean,boolean,text,text)', 'execute')::text)$q$),
    -- gl_invite_v2
    jsonb_build_object('id', 'I01', 'who', 'service', 'expect', 'ret:2', 'label', 'hidden test: M3 and own (+tag) addresses invited as VIP (1 place: forced); M3''s choice kept on review_log ''invited''',
      'q', $q$select jsonb_array_length(public.gl_invite_v2({ev}, jsonb_build_array(jsonb_build_object('email', {e_t}, 'first_name', 'Tess', 'last_name', 'Ter', 'company', 'M3'), jsonb_build_object('email', {e_adm_tag})), 'vip', {adm}, true, '{"mode": "none"}', 'Welcome', true) -> 'invited')::text$q$,
      'chk', $c$select count(*) = 2 and bool_and(g.invited_at is not null and g.ticket_key = 'vip' and g.source = 'invitation' and g.checkin_token is null)
                 and count(*) filter (where l.actor_id = {adm}::uuid and l.details ->> 'validate_person' = 'true' and l.details ->> 'message' = 'Welcome' and l.details ->> 'forced' = 'true') = 2
               from public.gl_guest g join public.review_log l on l.subject_id = g.id and l.action = 'invited'
              where g.event_id = {ev} and g.status = 'invited'$c$),
    jsonb_build_object('id', 'I02', 'who', 'service', 'expect', 'ret:test_addresses_only/test_addresses_only', 'label', 'hidden test: an outside address, or more than 10 people, is refused',
      'q', $q$select (public.gl_invite_v2({ev}, jsonb_build_array(jsonb_build_object('email', {e_t}), jsonb_build_object('email', {e_out})), 'vip', {adm}) ->> 'error')
               || '/' || (public.gl_invite_v2({ev}, (select jsonb_agg(jsonb_build_object('email', 'dr' || i || '@m3monaco.com')) from generate_series(1, 11) i), 'vip', {adm}) ->> 'error')$q$,
      'chk', $c$select not exists (select 1 from public.gl_guest where event_id = {ev} and status = 'invited')$c$),
    jsonb_build_object('id', 'I03', 'who', 'service', 'expect', 'ret:onsite_not_live', 'label', 'a real on-site event: no invitation while onsite_v2 is off',
      'setup', $s$update public.platform_settings set value = value || '{"onsite_v2": false}'::jsonb where key = 'registration_flags'$s$,
      'q', $q$select public.gl_invite_v2({ev2}, jsonb_build_array(jsonb_build_object('email', {e_out})), null, {adm}) ->> 'error'$q$),
    jsonb_build_object('id', 'I04', 'who', 'service', 'expect', 'ret:1', 'label', 'a real on-site event with onsite_v2 on: any address (no type: none needed)',
      'setup', $s$update public.platform_settings set value = value || '{"onsite_v2": true}'::jsonb where key = 'registration_flags'$s$,
      'q', $q$select jsonb_array_length(public.gl_invite_v2({ev2}, jsonb_build_array(jsonb_build_object('email', {e_out})), null, {adm}) -> 'invited')::text$q$,
      'chk', $c$select ticket_key is null from public.gl_guest where event_id = {ev2} and email = {e_out}$c$),
    jsonb_build_object('id', 'I05', 'who', 'service', 'expect', 'ret:1/1', 'label', 'an address already on the event is skipped; the same address twice in the list counts once',
      'q', $q$select (select jsonb_array_length(r -> 'invited') || '/' || jsonb_array_length(r -> 'already')
                 from (select public.gl_invite_v2({ev}, jsonb_build_array(jsonb_build_object('email', upper({e_g1})), jsonb_build_object('email', {e_t}), jsonb_build_object('email', upper({e_t}))), 'attendee', {adm}) as r) x)$q$,
      'chk', $c$select (select status from public.gl_guest where id = {g1}) = 'requested' and (select count(*) from public.gl_guest where event_id = {ev} and lower(email) = lower({e_t})) = 1$c$),
    jsonb_build_object('id', 'I06', 'who', 'service', 'expect', 'ret:ticket_required/unknown_ticket/forbidden/wrong_engine', 'label', 'two types and none named; an unknown type; a member as actor; a guest-list event',
      'q', $q$select concat_ws('/', public.gl_invite_v2({ev}, jsonb_build_array(jsonb_build_object('email', {e_t})), null, {adm}) ->> 'error',
                public.gl_invite_v2({ev}, jsonb_build_array(jsonb_build_object('email', {e_t})), 'nope', {adm}) ->> 'error',
                public.gl_invite_v2({ev}, jsonb_build_array(jsonb_build_object('email', {e_t})), 'vip', {mem}) ->> 'error',
                public.gl_invite_v2({ev1}, jsonb_build_array(jsonb_build_object('email', {e_t})), null, {adm}) ->> 'error')$q$),
    jsonb_build_object('id', 'I07', 'who', 'service', 'expect', 'ret:0/2', 'label', 'malformed addresses are listed back, never inserted',
      'q', $q$select (select jsonb_array_length(r -> 'invited') || '/' || jsonb_array_length(r -> 'invalid')
                 from (select public.gl_invite_v2({ev2}, '[{"email": "not-an-address"}, {"email": "x@y"}]'::jsonb, null, {adm}) as r) x)$q$,
      'setup', $s$update public.platform_settings set value = value || '{"onsite_v2": true}'::jsonb where key = 'registration_flags'$s$),
    jsonb_build_object('id', 'I08', 'who', 'service', 'expect', 'ret:event_ended', 'label', 'an event that has ended takes no invitation',
      'setup', $s$update public.gl_event set settings = jsonb_build_object('starts_at', (now() - interval '3 days')::text) where id = {ev}$s$,
      'q', $q$select public.gl_invite_v2({ev}, jsonb_build_array(jsonb_build_object('email', {e_t})), 'vip', {adm}) ->> 'error'$q$),
    jsonb_build_object('id', 'I09', 'who', 'mem', 'expect', 'err:permission denied', 'label', 'a signed-in member cannot call it',
      'q', $q$select public.gl_invite_v2({ev}, jsonb_build_array(jsonb_build_object('email', {e_t})), 'vip', {mem})::text$q$),
    jsonb_build_object('id', 'I10', 'who', 'service', 'expect', 'ret:ticket_capacity/0/1/2', 'label', 'an invitation holds a seat: two people into the VIP type of 1 place is refused (held/capacity/adding), nothing written',
      'q', $q$select concat_ws('/', r ->> 'error', r ->> 'held', r ->> 'capacity', r ->> 'adding') from (select public.gl_invite_v2({ev}, jsonb_build_array(jsonb_build_object('email', {e_t}), jsonb_build_object('email', {e_adm_tag})), 'vip', {adm}) as r) x$q$,
      'chk', $c$select not exists (select 1 from public.gl_guest where event_id = {ev} and status = 'invited')$c$),
    jsonb_build_object('id', 'I11', 'who', 'service', 'expect', 'ret:capacity/0/1/2', 'label', 'the event''s capacity too; an address already on the event does not count',
      'setup', $s$update public.gl_event set capacity = 1 where id = {ev}$s$,
      'q', $q$select concat_ws('/', r ->> 'error', r ->> 'held', r ->> 'capacity', r ->> 'adding') from (select public.gl_invite_v2({ev}, jsonb_build_array(jsonb_build_object('email', {e_g1}), jsonb_build_object('email', {e_t}), jsonb_build_object('email', {e_adm_tag})), 'attendee', {adm}) as r) x$q$),
    jsonb_build_object('id', 'I12', 'who', 'service', 'expect', 'ret:2', 'label', 'p_force: staff go over the capacity, logged forced',
      'setup', $s$update public.gl_event set capacity = 1 where id = {ev}$s$,
      'q', $q$select jsonb_array_length(public.gl_invite_v2({ev}, jsonb_build_array(jsonb_build_object('email', {e_t}), jsonb_build_object('email', {e_adm_tag})), 'attendee', {adm}, p_force := true) -> 'invited')::text$q$,
      'chk', $c$select count(*) = 2 from public.review_log l join public.gl_guest g on g.id = l.subject_id where g.event_id = {ev} and l.action = 'invited' and l.details ->> 'forced' = 'true'$c$),
    jsonb_build_object('id', 'I13', 'who', 'service', 'expect', 'ret:bad_org_action/bad_org_action', 'label', 'a company to create needs a company type (none; not a company type)',
      'q', $q$select concat_ws('/', public.gl_invite_v2({ev}, jsonb_build_array(jsonb_build_object('email', {e_t})), 'vip', {adm}, true, '{"mode": "create", "name": "Dryrun Co"}') ->> 'error',
                public.gl_invite_v2({ev}, jsonb_build_array(jsonb_build_object('email', {e_t})), 'vip', {adm}, true, '{"mode": "create", "name": "Dryrun Co", "type": "admin"}') ->> 'error')$q$),
    -- gl_decide_v2
    jsonb_build_object('id', 'D01', 'who', 'service', 'expect', 'ret:["<gi>"]', 'label', 'approve an invited person (they said yes by phone): confirmed, pass minted, logged accepted_for_them',
      'setup', $s$<inv>$s$,
      'q', $q$select public.gl_decide_v2({ev}, array[{gi}::uuid], 'approve', {adm}) ->> 'accepted_for_them'$q$,
      'chk', $c$select g.status = 'confirmed' and g.responded_at is not null and g.checkin_token is not null and g.decided_by = {adm}::uuid
                 and exists (select 1 from public.review_log l where l.subject_id = g.id and l.action = 'accepted_for_them')
                 and exists (select 1 from public.account_provision_job j where j.source_id = g.id and j.created_by = {adm}::uuid)
               from public.gl_guest g where g.id = {gi}$c$),
    jsonb_build_object('id', 'D02', 'who', 'service', 'expect', 'ret:true', 'label', 'an invited person already holds their seat: approving them at full capacity (event and VIP type) is not refused',
      'setup', $s$<inv>; update public.gl_event set capacity = 1 where id = {ev}$s$,
      'q', $q$select public.gl_decide_v2({ev}, array[{gi}::uuid], 'approve', {adm}) ->> 'ok'$q$),
    jsonb_build_object('id', 'D03', 'who', 'service', 'expect', 'ret:["<gi>"]', 'label', 'reject an invited person = withdraw: cancelled, status links revoked, logged invitation_withdrawn',
      'setup', $s$<inv>; select public.gl_issue_access_token({gi})$s$,
      'q', $q$select public.gl_decide_v2({ev}, array[{gi}::uuid], 'reject', {adm}) ->> 'withdrawn'$q$,
      'chk', $c$select g.status = 'cancelled' and g.cancelled_at is not null
                 and not exists (select 1 from public.gl_access_token a where a.guest_id = g.id and a.revoked_at is null)
                 and exists (select 1 from public.gl_access_token a where a.guest_id = g.id)
                 and exists (select 1 from public.review_log l where l.subject_id = g.id and l.action = 'invitation_withdrawn' and l.details ->> 'status' = 'cancelled')
               from public.gl_guest g where g.id = {gi}$c$),
    jsonb_build_object('id', 'D04', 'who', 'service', 'expect', 'ret:[]/[]', 'label', 'a request is decided as before (confirmed, logged approve)',
      'q', $q$select (r ->> 'accepted_for_them') || '/' || (r ->> 'withdrawn') from (select public.gl_decide_v2({ev}, array[{g1}::uuid], 'approve', {adm}) as r) x$q$,
      'chk', $c$select g.status = 'confirmed' and exists (select 1 from public.review_log l where l.subject_id = g.id and l.action = 'approve') from public.gl_guest g where g.id = {g1}$c$),
    jsonb_build_object('id', 'D05', 'who', 'service', 'expect', 'ret:capacity', 'label', 'a request still counts against capacity (an invited seat is held)',
      'setup', $s$<inv>; update public.gl_event set capacity = 1 where id = {ev}$s$,
      'q', $q$select public.gl_decide_v2({ev}, array[{g1}::uuid], 'approve', {adm}) ->> 'error'$q$),
    jsonb_build_object('id', 'D06', 'who', 'service', 'expect', 'ret:[]/[]', 'label', 'waitlist and request_info still skip an invited person',
      'setup', $s$<inv>$s$,
      'q', $q$select (public.gl_decide_v2({ev}, array[{gi}::uuid], 'waitlist', {adm}) ->> 'changed') || '/' || (public.gl_decide_v2({ev}, array[{gi}::uuid], 'request_info', {adm}, p_info_request := 'Why?') ->> 'changed')$q$,
      'chk', $c$select status = 'invited' from public.gl_guest where id = {gi}$c$),
    jsonb_build_object('id', 'D07', 'who', 'service', 'expect', 'ret:wrong_engine', 'label', 'a guest-list (WYS) event is still refused',
      'q', $q$select public.gl_decide_v2({ev1}, array[{gv}::uuid], 'approve', {adm}) ->> 'error'$q$),
    jsonb_build_object('id', 'D08', 'who', 'service', 'expect', 'ret:bad_org_action/true', 'label', 'a company to create needs a type; with one, the job gets it',
      'q', $q$select concat_ws('/', public.gl_decide_v2({ev}, array[{g1}::uuid], 'approve', {adm}, '{"mode": "create", "name": "Dryrun Co"}') ->> 'error',
                public.gl_decide_v2({ev}, array[{g1}::uuid], 'approve', {adm}, '{"mode": "create", "name": "Dryrun Co", "type": "marina"}') ->> 'ok')$q$,
      'chk', $c$select exists (select 1 from public.account_provision_job j where j.source_id = {g1} and j.org_action ->> 'type' = 'marina')$c$),
    -- gl_respond_invitation_v2
    jsonb_build_object('id', 'R01', 'who', 'service', 'expect', 'ret:confirmed', 'label', 'the person accepts: confirmed, pass minted; the job gets M3''s recorded choice and author',
      'setup', $s$<inv>; insert into public.review_log (subject_type, subject_id, action, details, actor_id) values ('registration', {gi}, 'invited', '{"validate_person": true, "org_action": {"mode": "none"}}', {adm})$s$,
      'q', $q$select public.gl_respond_invitation_v2({gi}, true) ->> 'status'$q$,
      'chk', $c$select g.responded_at is not null and g.checkin_token is not null
                 and exists (select 1 from public.account_provision_job j where j.source_id = g.id and j.status = 'queued' and j.validate_person and j.created_by = {adm}::uuid)
                 and exists (select 1 from public.review_log l where l.subject_id = g.id and l.action = 'invitation_accepted' and l.details ->> 'validated_by' = {adm})
               from public.gl_guest g where g.id = {gi}$c$),
    jsonb_build_object('id', 'R02', 'who', 'service', 'expect', 'ret:confirmed', 'label', 'no recorded invitation: the account is NOT validated (M3 validates every person)',
      'setup', $s$<inv>$s$,
      'q', $q$select public.gl_respond_invitation_v2({gi}, true) ->> 'status'$q$,
      'chk', $c$select exists (select 1 from public.account_provision_job j where j.source_id = {gi} and not j.validate_person and j.created_by is null)$c$),
    jsonb_build_object('id', 'R03', 'who', 'service', 'expect', 'ret:declined', 'label', 'the person declines: declined, no account job, logged',
      'setup', $s$<inv>$s$,
      'q', $q$select public.gl_respond_invitation_v2({gi}, false) ->> 'status'$q$,
      'chk', $c$select not exists (select 1 from public.account_provision_job j where j.source_id = {gi})
                 and exists (select 1 from public.review_log l where l.subject_id = {gi} and l.action = 'invitation_declined')$c$),
    jsonb_build_object('id', 'R04', 'who', 'service', 'expect', 'ret:true/true/not_invited', 'label', 'the same answer twice is fine; changing it afterwards is not',
      'setup', $s$<inv>$s$,
      'q', $q$select concat_ws('/', public.gl_respond_invitation_v2({gi}, true) ->> 'ok', public.gl_respond_invitation_v2({gi}, true) ->> 'already',
                public.gl_respond_invitation_v2({gi}, false) ->> 'error')$q$),
    jsonb_build_object('id', 'R05', 'who', 'service', 'expect', 'ret:not_invited/wrong_engine/not_found', 'label', 'a request, a guest-list (WYS) guest, an unknown id',
      'q', $q$select concat_ws('/', public.gl_respond_invitation_v2({g1}, true) ->> 'error', public.gl_respond_invitation_v2({gv}, true) ->> 'error',
                public.gl_respond_invitation_v2(gen_random_uuid(), true) ->> 'error')$q$),
    jsonb_build_object('id', 'R06', 'who', 'anon', 'expect', 'err:permission denied', 'label', 'a visitor cannot answer for anyone (only the function, after the status token)',
      'setup', $s$<inv>$s$,
      'q', $q$select public.gl_respond_invitation_v2({gi}, true)::text$q$,
      'chk', $c$select status = 'invited' from public.gl_guest where id = {gi}$c$),
    -- platform_settings: registration_flags by admins only
    jsonb_build_object('id', 'P01', 'who', 'mod', 'expect', 'rls', 'label', 'a moderator can no longer write the registration switches',
      'q', $q$update public.platform_settings set value = value || '{"review_queue": true}'::jsonb where key = 'registration_flags'$q$,
      'chk', $c$select (value -> 'review_queue') is distinct from 'true'::jsonb from public.platform_settings where key = 'registration_flags'$c$),
    jsonb_build_object('id', 'P02', 'who', 'mod', 'expect', 'allow', 'label', 'a moderator still writes the other settings',
      'q', $q$update public.platform_settings set value = value where key = 'review_sla_text'$q$),
    jsonb_build_object('id', 'P03', 'who', 'adm', 'expect', 'allow', 'label', 'an admin writes the switches (Platform settings)',
      'q', $q$update public.platform_settings set value = value where key = 'registration_flags'$q$),
    jsonb_build_object('id', 'P04', 'who', 'mod', 'expect', 'rls', 'label', 'a moderator cannot delete the switches either',
      'q', $q$delete from public.platform_settings where key = 'registration_flags'$q$,
      'chk', $c$select exists (select 1 from public.platform_settings where key = 'registration_flags')$c$),
    jsonb_build_object('id', 'P05', 'who', 'anon', 'expect', 'ret:1', 'label', 'anyone still reads the switches (the site needs them)',
      'q', $q$select count(*)::text from public.platform_settings where key = 'registration_flags'$q$)
  );

  -- Runner: setup s0 + setup (postgres), q as the caller (an expected error is caught around q
  -- only, so chk still runs), chk (postgres), all rolled back. {x} = quoted vars.x; <x> = raw.
  for t in select * from jsonb_array_elements(tests) loop
    v_q := t ->> 'q'; v_setup := coalesce(t ->> 'setup', ''); v_chkq := coalesce(t ->> 'chk', ''); v_exp := t ->> 'expect';
    if not coalesce((t ->> 'bare')::boolean, false) then v_setup := s0 || ';' || v_setup; end if;
    v_setup := replace(v_setup, '<inv>', inv);
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

  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (onsite_invitations dry run, run %s)', n_pass, n_fail, now()) || results;
end
$dryrun$;
