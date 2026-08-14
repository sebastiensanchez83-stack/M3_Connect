-- Fourth pass. Three defects, two of them introduced by the third pass — the
-- link-to-existing branch keeps producing them because it is the one place this
-- feature touches a record it does not own.
--
-- NOTE ON THIS FILE SET: 150000, 160000, 170000 and 180000 are successive
-- revisions of the same two functions, applied in that order on the same day.
-- Only this one is current. They are kept separate because the names are
-- recorded in supabase_migrations.schema_migrations and the manifest promises
-- the file set matches it — replaying them in order reproduces the database.

-- ─── 1. remove_guest never got the headcount guard ──────────────────────────
-- sync_guests was stopped from writing sm_registration.num_attendees on a
-- registration this feature did not create. Its sibling was not, and it is
-- worse: it wrote a raw count with no floor, so removing invited guests from a
-- company's own booking crushed a declared 7 to 1, and could write 0 —
-- sm_sync_headcount_to_roster deliberately floors at greatest(v_named, 1) and
-- this bypassed it. SM26Invoices bills from that column.
create or replace function public.sm_invitation_remove_guest(p_guest_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_g record; v_reg uuid; v_total int; v_source text;
begin
  if not sm_is_staff() then raise exception 'not authorized'; end if;

  select g.id as gid, g.attendee_id, i.registration_id
    into v_g
  from sm_invitation_guest g
  join sm_invitation i on i.id = g.invitation_id
  where g.id = p_guest_id;
  if v_g.gid is null then raise exception 'Guest not found'; end if;

  -- Deleting the attendee would cascade to sm_checkin, and losing the record
  -- that somebody physically walked into the venue is not a tidy-up.
  if v_g.attendee_id is not null
     and exists (select 1 from sm_checkin c where c.attendee_id = v_g.attendee_id) then
    raise exception 'This guest has already been checked in — remove them from the attendee list instead';
  end if;

  v_reg := v_g.registration_id;
  delete from sm_invitation_guest where id = p_guest_id;
  if v_g.attendee_id is not null then
    delete from sm_attendee where id = v_g.attendee_id;   -- takes the badge with it
  end if;

  if v_reg is not null then
    select r.source into v_source from sm_registration r where r.id = v_reg;
    select count(*)::int into v_total from sm_attendee a where a.registration_id = v_reg and a.attending;
    -- Only ours to write, and never below one: a registration always has its
    -- contact, and a headcount of zero is an invoice for nobody.
    if v_source = 'invitation' then
      update sm_registration set num_attendees = greatest(v_total, 1) where id = v_reg;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'attendees', coalesce(v_total, 0),
                            'headcount_written', v_source = 'invitation');
end $function$;

-- ─── 2. the discretion sweep hit bystanders ─────────────────────────────────
-- trg_sm_invitation_sweep_discretion scopes by registration_id. That is right
-- for a registration this feature created — every attendee on it IS the
-- delegation — and wrong on the link-to-existing branch, where the registration
-- belongs to a company and carries colleagues who registered and paid
-- independently. Linking one discreet invitation silently and irreversibly
-- stripped the whole company's networking badges.
--
-- The promise cannot be kept on somebody else's booking, so it is not kept
-- silently: both enforcers are scoped to registrations we own, and the RPC says
-- in its notes that the badge stays scannable and why.
create or replace function public.sm_invitation_sweep_discretion()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.discreet and new.registration_id is not null
     and exists (select 1 from sm_registration r
                  where r.id = new.registration_id and r.source = 'invitation') then
    update sm_badge set connect_token = null
     where registration_id = new.registration_id and connect_token is not null;
  end if;
  return null;
end $function$;

create or replace function public.sm_badge_respect_discretion()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.connect_token is not null
     and exists (select 1 from sm_invitation i
                  join sm_registration r on r.id = i.registration_id
                  where i.registration_id = new.registration_id
                    and i.discreet and r.source = 'invitation') then
    new.connect_token := null;
  end if;
  return new;
end $function$;

-- ─── 3. a shared mailbox let one guest swallow another ──────────────────────
-- The link lookup matched any live registration on (event_id, lower(email)) —
-- including one this feature had just created. Email is by design a shared
-- mailbox here ("we write to an embassy, not a person"), so inviting the
-- ambassador and then the cultural attaché at the same address linked the second
-- invitation to the first one's participant: two people, one badge, and the
-- console reporting success.
--
-- Registrations we created are excluded (each stands for one named person), as
-- are ones another invitation already claims. The branch also now says what it
-- did NOT do: it returns before roles and the fee waiver are applied, and the
-- convert dialog asks for both.
create or replace function public.sm_invitation_to_participant(
  p_invitation_id uuid,
  p_first_name    text    default null,
  p_last_name     text    default null,
  p_email         text    default null,
  p_company       text    default null,
  p_country       text    default null,
  p_job_title     text    default null,
  p_roles         text[]  default array['vip'],
  p_discreet      boolean default null,
  p_waive_fee     boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_inv record; v_reg uuid; v_att uuid; v_existing uuid; v_existing_status text;
  v_email text; v_domain text; v_user uuid; v_org uuid; v_org_name text;
  v_first text; v_last text; v_company text; v_country text; v_job text;
  v_discreet boolean; v_role text; v_notes text[] := '{}'; v_dom_count int;
  v_sync jsonb; v_pratt uuid; v_guests int;
  k_roles constant text[] := array['visitor','marina','startup','architect_pro','architect_student',
                                   'media','jury','investor','sponsor','speaker','vip'];
begin
  if not sm_is_staff() then raise exception 'not authorized'; end if;

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

  if v_email is not null then
    select r.id, r.status into v_existing, v_existing_status
      from sm_registration r
     where r.event_id = v_inv.event_id and lower(btrim(r.email)) = v_email
       and r.status not in ('declined', 'cancelled')
       -- ours stands for one named person; a shared mailbox must not merge two
       and r.source is distinct from 'invitation'
       -- and one booking answers to one invitation
       and not exists (select 1 from sm_invitation i2
                        where i2.registration_id = r.id and i2.id <> p_invitation_id)
     order by (r.status = 'confirmed') desc, r.created_at
     limit 1;
    if v_existing is not null then
      update sm_invitation
         set registration_id = v_existing, converted_at = now(), discreet = v_discreet
       where id = p_invitation_id;

      select count(*)::int into v_guests from sm_invitation_guest g
       where g.invitation_id = p_invitation_id;
      if v_guests > 0 then
        v_notes := array_append(v_notes,
          'the ' || v_guests || ' name(s) under "who comes with them" were NOT added — this is the company''s own registration and its headcount is what they are invoiced for. Add them from the registration if they really are part of that booking.');
      end if;
      v_notes := array_append(v_notes,
        'the role and the fee waiver you chose were NOT applied — their own registration already carries its roles and its payment');
      if v_discreet then
        v_notes := array_append(v_notes,
          'their badge stays scannable: it belongs to their company''s booking, and making it access-only would silently do the same to colleagues who registered themselves');
      end if;

      select a.id into v_pratt from sm_attendee a
       where a.registration_id = v_existing and a.is_primary limit 1;
      if v_existing_status <> 'confirmed' then
        v_notes := array_append(v_notes,
          'their own registration is still ' || v_existing_status || ' — the door refuses it until it is confirmed');
      end if;
      return jsonb_build_object(
        'ok', true, 'registration_id', v_existing, 'linked_existing', true,
        'guests_minted', 0,
        'attendees', (select count(*) from sm_attendee a where a.registration_id = v_existing and a.attending),
        'discreet', false,
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
grant execute on function public.sm_invitation_remove_guest(uuid) to authenticated;
