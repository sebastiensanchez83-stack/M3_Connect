-- Second review pass on the guest list. Four defects, both RPCs replaced.
-- Supersedes the bodies in 20260814120000_sm26_invitation_guest_list.sql; the
-- text below is what is actually deployed (pulled back with pg_get_functiondef
-- so the file and the database cannot drift).
--
-- (a) sync_guests overwrote sm_registration.num_attendees with a count of
--     attendee rows. That column is the company's OWN declared headcount and it
--     is what SM26Invoices bills from. On a registration this feature created
--     there is no prior declaration, so writing it is right; on one we merely
--     LINKED an invitation to — the company registered itself, then we invited
--     them — overwriting it silently rewrites the figure on their invoice.
--     Now scoped to source = 'invitation'.
-- (b) sync_guests only minted for guests with no attendee. A guest whose
--     attendee exists but whose badge was revoked (sm_ensure_badges self-heals
--     badges away when a registration is refused or an attendee is set to
--     not-attending) could never get one back: "Issue missing badges" saw
--     nothing to do.
-- (c) to_participant's link-to-existing branch matched ANY registration with
--     that email, including one already declined or cancelled, and reported
--     success — attaching the invitation to a registration the door refuses.
-- (d) That branch returned no door_ok, so the console read `undefined` and told
--     staff "The door still refuses: undefined" on a conversion that worked.
-- (e) No row lock: two clicks on "Create the participant" could both pass the
--     already-converted check and mint two registrations and two badges.

CREATE OR REPLACE FUNCTION public.sm_invitation_sync_guests(p_invitation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_inv record; v_g record; v_att uuid; v_minted int := 0; v_reissued int := 0;
  v_total int; v_source text;
begin
  if not sm_is_staff() then raise exception 'not authorized'; end if;

  select i.id, i.event_id, i.registration_id, i.discreet
    into v_inv from sm_invitation i where i.id = p_invitation_id;
  if v_inv.id is null then raise exception 'Invitation not found'; end if;
  if v_inv.registration_id is null then
    raise exception 'This invitation has no participant yet — create it first';
  end if;

  for v_g in
    select g.* from sm_invitation_guest g
     where g.invitation_id = p_invitation_id and g.attendee_id is null
     order by g.created_at
  loop
    insert into sm_attendee (registration_id, event_id, first_name, last_name, email,
                             job_title, is_primary, attending)
    values (v_inv.registration_id, v_inv.event_id,
            nullif(btrim(coalesce(v_g.first_name, '')), ''),
            nullif(btrim(coalesce(v_g.last_name,  '')), ''),
            nullif(lower(btrim(coalesce(v_g.email, ''))), ''),
            nullif(btrim(coalesce(v_g.job_title, '')), ''),
            false, true)
    returning id into v_att;

    -- connect_token explicitly NULL for a discreet guest; the column default is
    -- a random token, and trg_sm_badge_respect_discretion backs this up.
    insert into sm_badge (event_id, registration_id, attendee_id, checkin_token, connect_token)
    values (v_inv.event_id, v_inv.registration_id, v_att,
            replace(gen_random_uuid()::text, '-', ''),
            case when v_inv.discreet then null else replace(gen_random_uuid()::text, '-', '') end);

    update sm_invitation_guest set attendee_id = v_att where id = v_g.id;
    v_minted := v_minted + 1;
  end loop;

  -- Re-issue a badge for a named guest who has an attendee but lost their badge.
  for v_g in
    select g.attendee_id from sm_invitation_guest g
     where g.invitation_id = p_invitation_id
       and g.attendee_id is not null
       and exists (select 1 from sm_attendee a where a.id = g.attendee_id and a.attending)
       and not exists (select 1 from sm_badge b where b.attendee_id = g.attendee_id)
  loop
    insert into sm_badge (event_id, registration_id, attendee_id, checkin_token, connect_token)
    values (v_inv.event_id, v_inv.registration_id, v_g.attendee_id,
            replace(gen_random_uuid()::text, '-', ''),
            case when v_inv.discreet then null else replace(gen_random_uuid()::text, '-', '') end);
    v_reissued := v_reissued + 1;
  end loop;

  select count(*)::int into v_total from sm_attendee a
   where a.registration_id = v_inv.registration_id and a.attending;

  select r.source into v_source from sm_registration r where r.id = v_inv.registration_id;
  if v_source = 'invitation' then
    update sm_registration set num_attendees = v_total where id = v_inv.registration_id;
  end if;

  return jsonb_build_object('ok', true, 'minted', v_minted, 'reissued', v_reissued,
                            'attendees', v_total, 'headcount_written', v_source = 'invitation');
end $function$;

CREATE OR REPLACE FUNCTION public.sm_invitation_to_participant(
  p_invitation_id uuid,
  p_first_name text DEFAULT NULL::text,
  p_last_name text DEFAULT NULL::text,
  p_email text DEFAULT NULL::text,
  p_company text DEFAULT NULL::text,
  p_country text DEFAULT NULL::text,
  p_job_title text DEFAULT NULL::text,
  p_roles text[] DEFAULT ARRAY['vip'::text],
  p_discreet boolean DEFAULT NULL::boolean,
  p_waive_fee boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_inv record; v_reg uuid; v_att uuid; v_existing uuid; v_existing_status text;
  v_email text; v_domain text; v_user uuid; v_org uuid; v_org_name text;
  v_first text; v_last text; v_company text; v_country text; v_job text;
  v_discreet boolean; v_role text; v_notes text[] := '{}'; v_dom_count int;
  v_sync jsonb; v_pratt uuid;
  k_roles constant text[] := array['visitor','marina','startup','architect_pro','architect_student',
                                   'media','jury','investor','sponsor','speaker','vip'];
begin
  if not sm_is_staff() then raise exception 'not authorized'; end if;

  -- for update: a double click must not mint two participants.
  select i.* into v_inv from sm_invitation i where i.id = p_invitation_id for update;
  if v_inv.id is null then raise exception 'Invitation not found'; end if;
  if v_inv.registration_id is not null then
    raise exception 'This invitation already has a participant';
  end if;
  if v_inv.rsvp_status <> 'accepted' then
    raise exception 'Record the acceptance first — only an accepted invitation becomes a participant';
  end if;

  if p_roles is null or array_length(p_roles, 1) is null then
    raise exception 'Pick at least one role';
  end if;
  foreach v_role in array p_roles loop
    if not (v_role = any (k_roles)) then raise exception 'Unknown role: %', v_role; end if;
  end loop;
  if 'jury' = any (p_roles) then
    raise exception 'Invite a juror from the jury console — the door has a separate rule for them';
  end if;

  v_discreet := coalesce(p_discreet, v_inv.discreet);
  v_email    := nullif(lower(btrim(coalesce(p_email, v_inv.recipient_email, ''))), '');
  v_first    := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last     := nullif(btrim(coalesce(p_last_name,  '')), '');
  v_company  := nullif(btrim(coalesce(p_company, v_inv.recipient_org, '')), '');
  v_country  := nullif(btrim(coalesce(p_country, v_inv.country, '')), '');
  v_job      := nullif(btrim(coalesce(p_job_title, v_inv.recipient_role, '')), '');

  if v_first is null and v_last is null then
    v_last := nullif(btrim(coalesce(v_inv.recipient_name, '')), '');
    if v_last is null then raise exception 'A name is required'; end if;
    v_notes := array_append(v_notes, 'the name was not split — check how it prints on the badge');
  end if;

  if v_email is not null and position('@' in v_email) = 0 then
    raise exception 'That does not look like an email address: %', v_email;
  end if;

  -- Already here under their own steam? Link, do not duplicate — but only to a
  -- registration that is actually live. Attaching to a withdrawn one and
  -- reporting success is worse than creating a fresh registration.
  if v_email is not null then
    select r.id, r.status into v_existing, v_existing_status
      from sm_registration r
     where r.event_id = v_inv.event_id and lower(btrim(r.email)) = v_email
       and r.status not in ('declined', 'cancelled')
     order by (r.status = 'confirmed') desc, r.created_at
     limit 1;
    if v_existing is not null then
      update sm_invitation
         set registration_id = v_existing, converted_at = now(), discreet = v_discreet
       where id = p_invitation_id;
      v_sync := sm_invitation_sync_guests(p_invitation_id);
      select a.id into v_pratt from sm_attendee a
       where a.registration_id = v_existing and a.is_primary limit 1;
      if v_existing_status <> 'confirmed' then
        v_notes := array_append(v_notes,
          'their own registration is still ' || v_existing_status || ' — the door refuses it until it is confirmed');
      end if;
      return jsonb_build_object(
        'ok', true, 'registration_id', v_existing, 'linked_existing', true,
        'guests_minted', v_sync->'minted',
        'attendees', v_sync->'attendees',
        'discreet', v_discreet,
        'door_ok', case when v_pratt is null then null else (sm_checkin_eligibility(v_pratt))->>'ok' end,
        'door_blocker', case when v_pratt is null then 'not_found' else (sm_checkin_eligibility(v_pratt))->>'reason' end,
        'notes', to_jsonb(array_prepend(
          'this person was already registered — the invitation was linked to it rather than creating a second registration',
          v_notes)));
    end if;
  end if;

  if v_email is not null then
    select p.user_id into v_user from profiles p where lower(btrim(p.email)) = v_email;
    if v_user is null then v_notes := array_append(v_notes, 'no platform account yet'); end if;
    v_domain := split_part(v_email, '@', 2);
  else
    v_notes := array_append(v_notes, 'no email — this guest cannot be emailed a badge or an account');
  end if;

  if v_company is not null then
    select o.id, o.name into v_org, v_org_name from organizations o
     where lower(btrim(o.name)) = lower(v_company) limit 1;
  end if;
  if v_org is null and v_domain is not null then
    select count(*) into v_dom_count from organizations o
     where lower(coalesce(o.primary_domain, '')) = v_domain;
    if v_dom_count = 1 then
      select o.id, o.name into v_org, v_org_name from organizations o
       where lower(coalesce(o.primary_domain, '')) = v_domain;
    elsif v_dom_count > 1 then
      v_notes := array_append(v_notes, 'several companies share this email domain, so none was linked');
    end if;
  end if;

  insert into sm_registration (event_id, user_id, organization_id, first_name, last_name,
                               email, company_name, country, job_title, status, source)
  values (v_inv.event_id, v_user, v_org, v_first, v_last, v_email,
          coalesce(v_company, v_org_name), v_country, v_job, 'confirmed', 'invitation')
  returning id into v_reg;

  foreach v_role in array p_roles loop
    insert into sm_role_assignment (registration_id, event_id, organization_id, role, status)
    values (v_reg, v_inv.event_id, v_org, v_role, 'confirmed');
  end loop;

  insert into sm_attendee (registration_id, event_id, first_name, last_name, email,
                           job_title, user_id, is_primary, attending)
  values (v_reg, v_inv.event_id, v_first, v_last, v_email, v_job, v_user, true, true)
  returning id into v_att;

  insert into sm_badge (event_id, registration_id, attendee_id, checkin_token, connect_token)
  values (v_inv.event_id, v_reg, v_att,
          replace(gen_random_uuid()::text, '-', ''),
          case when v_discreet then null else replace(gen_random_uuid()::text, '-', '') end);

  if p_waive_fee then
    insert into sm_payment (event_id, registration_id, status, note)
    values (v_inv.event_id, v_reg, 'waived', 'Guest of M3 — invited');
  else
    v_notes := array_append(v_notes, 'no payment recorded — the door refuses them until it is paid or waived');
  end if;

  update sm_invitation
     set registration_id = v_reg, converted_at = now(), discreet = v_discreet
   where id = p_invitation_id;

  v_sync := sm_invitation_sync_guests(p_invitation_id);

  return jsonb_build_object(
    'ok', true,
    'registration_id', v_reg,
    'linked_existing', false,
    'linked_user', v_user is not null,
    'linked_organization', v_org_name,
    'guests_minted', v_sync->'minted',
    'attendees', v_sync->'attendees',
    'discreet', v_discreet,
    'door_ok', (sm_checkin_eligibility(v_att))->>'ok',
    'door_blocker', (sm_checkin_eligibility(v_att))->>'reason',
    'notes', to_jsonb(v_notes));
end $function$;

grant execute on function public.sm_invitation_to_participant(uuid,text,text,text,text,text,text,text[],boolean,boolean) to authenticated;
grant execute on function public.sm_invitation_sync_guests(uuid) to authenticated;
