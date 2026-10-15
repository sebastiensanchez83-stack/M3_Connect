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
