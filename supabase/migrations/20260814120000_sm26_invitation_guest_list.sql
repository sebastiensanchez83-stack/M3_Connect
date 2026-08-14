-- SM26 — the invitation becomes a guest list.
--
-- Until now sm_invitation held letters and nothing else: a PDF, a date, and no
-- idea whether the person ever answered. Everything that happened after the
-- envelope was posted lived in somebody's inbox, and an invitation sent by hand
-- — a personal email, a phone call — left no trace on the platform at all.
--
-- One row of sm_invitation is now ONE INVITED PERSON, whatever the channel. The
-- letter becomes optional content of that row. Two independent axes:
--   status      draft → ready → sent      the sending
--   rsvp_status awaiting → accepted/…     the answer
-- An invitation that left through a personal mailbox is saved straight as
-- `sent` with its real date and no letter at all.
--
-- Accepting is not the end of it. sm_invitation_to_participant turns an accepted
-- invitation into a real SM26 participant — registration, role, attendee, badge,
-- fee waiver — so the guest appears at the door and in the badge print run
-- without anybody retyping them. Officials arrive with a delegation, so each
-- accompanying guest is named and carries their own badge.

-- Applied through the MCP `apply_migration`, which already wraps this file in a
-- transaction — an explicit begin/commit here would fight it.

-- ─── 1. the guest-list columns ──────────────────────────────────────────────
alter table public.sm_invitation
  add column if not exists channel         text not null default 'platform_letter',
  add column if not exists recipient_email text,
  add column if not exists recipient_phone text,
  add column if not exists rsvp_status     text not null default 'awaiting',
  add column if not exists rsvp_at         timestamptz,
  add column if not exists rsvp_by         uuid references auth.users(id) on delete set null,
  add column if not exists rsvp_note       text,
  -- An invited guest's badge opens the door and does nothing else: no
  -- connect_token is minted, so sm_connect_scan answers 'unknown_code' and
  -- another participant cannot turn a minister's badge into a lead. This is the
  -- rule for invited guests, hence the default; the column exists so a single
  -- guest can be opted back in without a schema change.
  add column if not exists discreet        boolean not null default true,
  add column if not exists registration_id uuid references public.sm_registration(id) on delete set null,
  add column if not exists converted_at    timestamptz;

comment on column public.sm_invitation.channel         is 'How the invitation actually left: a letter drawn here, or one of the off-platform routes.';
comment on column public.sm_invitation.rsvp_status     is 'The answer, recorded by staff. Independent of `status`, which is about the sending.';
comment on column public.sm_invitation.rsvp_note       is 'How we know — "confirmed by email of 3 Sep", "called back, sending a deputy". The audit trail.';
comment on column public.sm_invitation.discreet        is 'Access badge only: no connect_token, so the badge cannot be scanned for contact exchange.';
comment on column public.sm_invitation.registration_id is 'Set once the accepted invitation has been turned into a participant.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sm_invitation_channel_chk') then
    alter table public.sm_invitation add constraint sm_invitation_channel_chk
      check (channel in ('platform_letter', 'email', 'phone', 'in_person', 'third_party'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sm_invitation_rsvp_chk') then
    alter table public.sm_invitation add constraint sm_invitation_rsvp_chk
      check (rsvp_status in ('awaiting', 'accepted', 'declined', 'tentative', 'no_reply'));
  end if;
end $$;

create index if not exists sm_invitation_registration_idx on public.sm_invitation (registration_id);

-- The letters already captured become guests we are waiting on rather than
-- archived PDFs: `channel` = platform_letter and `rsvp_status` = awaiting are
-- exactly what the column defaults give them, so there is nothing to backfill.

-- ─── 2. the delegation ──────────────────────────────────────────────────────
-- One row per accompanying person. Named, because each of them needs their own
-- badge label at the door — a head count would not print.
create table if not exists public.sm_invitation_guest (
  id            uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references public.sm_invitation(id) on delete cascade,
  first_name    text,
  last_name     text,
  job_title     text,
  email         text,
  -- Filled when the guest has been minted into a real attendee. Null means the
  -- name is known but no badge exists for them yet.
  attendee_id   uuid references public.sm_attendee(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists sm_invitation_guest_invitation_idx on public.sm_invitation_guest (invitation_id);
create index if not exists sm_invitation_guest_attendee_idx   on public.sm_invitation_guest (attendee_id);

drop trigger if exists trg_sm_invitation_guest_touch on public.sm_invitation_guest;
create trigger trg_sm_invitation_guest_touch
  before update on public.sm_invitation_guest
  for each row execute function public.sm_invitation_touch();

alter table public.sm_invitation_guest enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'sm_invitation_guest'
                    and policyname = 'sm_invitation_guest_staff') then
    create policy sm_invitation_guest_staff on public.sm_invitation_guest
      for all to authenticated using (sm_is_staff()) with check (sm_is_staff());
  end if;
end $$;

grant select, insert, update, delete on public.sm_invitation_guest to authenticated, service_role;

-- ─── 3. the print run ───────────────────────────────────────────────────────
-- Badges are printed blank by an outside supplier and labelled with the name
-- before the event, so the roster leaves in batches. Without a marker the second
-- export repeats everything already printed; with it the supplier only ever
-- receives what is new.
alter table public.sm_badge add column if not exists exported_at timestamptz;
comment on column public.sm_badge.exported_at is
  'When this badge last went to the badge printer. Null = never sent — it is what the delta export selects on.';

-- ─── 4. accepted invitation → participant ───────────────────────────────────

/**
 * Mint an attendee + badge for every named guest of an already-converted
 * invitation who has none yet, and keep the registration head count honest.
 *
 * Delegations arrive in pieces — the embassy confirms the ambassador in July
 * and names the two people accompanying them in September — so this is
 * deliberately re-runnable rather than a one-shot at conversion time.
 */
create or replace function public.sm_invitation_sync_guests(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_inv record; v_g record; v_att uuid; v_minted int := 0; v_total int;
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

    -- connect_token is left NULL on purpose for a discreet guest. It carries a
    -- random default, so it has to be written explicitly to stay empty.
    insert into sm_badge (event_id, registration_id, attendee_id, checkin_token, connect_token)
    values (v_inv.event_id, v_inv.registration_id, v_att,
            replace(gen_random_uuid()::text, '-', ''),
            case when v_inv.discreet then null else replace(gen_random_uuid()::text, '-', '') end);

    update sm_invitation_guest set attendee_id = v_att where id = v_g.id;
    v_minted := v_minted + 1;
  end loop;

  select count(*)::int into v_total from sm_attendee a
   where a.registration_id = v_inv.registration_id and a.attending;
  update sm_registration set num_attendees = v_total where id = v_inv.registration_id;

  return jsonb_build_object('ok', true, 'minted', v_minted, 'attendees', v_total);
end $function$;

/**
 * Turn an accepted invitation into a real SM26 participant.
 *
 * Mirrors sm_admin_create_registration, with the four differences the guest list
 * needs: the email is optional (we write to an embassy, not to a person), the
 * role defaults to vip, the fee is waived by default because the door refuses an
 * unpaid confirmed registration, and the delegation is minted alongside.
 *
 * If somebody we invited has meanwhile registered themselves, the invitation is
 * linked to that registration instead of a second one being created — two
 * badges for one person is exactly what this is meant to prevent.
 */
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
  v_inv record; v_reg uuid; v_att uuid; v_existing uuid;
  v_email text; v_domain text; v_user uuid; v_org uuid; v_org_name text;
  v_first text; v_last text; v_company text; v_country text; v_job text;
  v_discreet boolean; v_role text; v_notes text[] := '{}'; v_dom_count int;
  v_sync jsonb;
  k_roles constant text[] := array['visitor','marina','startup','architect_pro','architect_student',
                                   'media','jury','investor','sponsor','speaker','vip'];
begin
  if not sm_is_staff() then raise exception 'not authorized'; end if;

  select i.* into v_inv from sm_invitation i where i.id = p_invitation_id;
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
  -- A juror is judged by a different door rule (jury_not_onsite) that this path
  -- has no way to satisfy. Jurors are invited through the jury console.
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

  -- The letter addresses one string — "Dr. Tarek Dahroug" — and a badge label
  -- needs two halves. The console asks staff to split it; this is the fallback
  -- when it did not, and it keeps the whole name rather than guessing wrong.
  if v_first is null and v_last is null then
    v_last := nullif(btrim(coalesce(v_inv.recipient_name, '')), '');
    if v_last is null then raise exception 'A name is required'; end if;
    v_notes := array_append(v_notes, 'the name was not split — check how it prints on the badge');
  end if;

  if v_email is not null and position('@' in v_email) = 0 then
    raise exception 'That does not look like an email address: %', v_email;
  end if;

  -- Already here under their own steam? Link, do not duplicate.
  if v_email is not null then
    select r.id into v_existing from sm_registration r
     where r.event_id = v_inv.event_id and lower(btrim(r.email)) = v_email limit 1;
    if v_existing is not null then
      update sm_invitation
         set registration_id = v_existing, converted_at = now(), discreet = v_discreet
       where id = p_invitation_id;
      v_sync := sm_invitation_sync_guests(p_invitation_id);
      return jsonb_build_object(
        'ok', true, 'registration_id', v_existing, 'linked_existing', true,
        'guests_minted', v_sync->'minted',
        'notes', to_jsonb(array['this person was already registered — the invitation was linked to it rather than creating a second registration']));
    end if;
  end if;

  -- Land the participation on the account and the company that already exist,
  -- so it is not orphaned beside them.
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

  -- Without this the door reads payment_missing and refuses a guest of M3 at
  -- the welcome desk. It is the default for a reason.
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

/**
 * Remove one named guest, and the badge minted for them.
 *
 * A guest who has already walked through the door is kept: deleting the attendee
 * would take the check-in record with it (sm_checkin cascades on attendee), and
 * losing the record that somebody physically entered the venue is not a tidy-up.
 */
create or replace function public.sm_invitation_remove_guest(p_guest_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_g record; v_reg uuid; v_total int;
begin
  if not sm_is_staff() then raise exception 'not authorized'; end if;

  select g.id, g.attendee_id, i.registration_id
    into v_g
  from sm_invitation_guest g
  join sm_invitation i on i.id = g.invitation_id
  where g.id = p_guest_id;
  if v_g.id is null then raise exception 'Guest not found'; end if;

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
    select count(*)::int into v_total from sm_attendee a where a.registration_id = v_reg and a.attending;
    update sm_registration set num_attendees = v_total where id = v_reg;
  end if;

  return jsonb_build_object('ok', true, 'attendees', coalesce(v_total, 0));
end $function$;

-- ─── 5. what the console needs to draw one row ──────────────────────────────
/**
 * Per-invitation state that lives across four other tables: how many guests are
 * named, how many carry a badge, how many of those badges have gone to the
 * printer, who has already walked in, and what the door would say today.
 * One call instead of a query per row.
 */
create or replace function public.sm_invitation_board(p_event_id uuid)
returns table (
  invitation_id    uuid,
  registration_id  uuid,
  guest_count      int,
  guests_pending   int,
  attendee_count   int,
  badge_count      int,
  exported_count   int,
  checked_in_count int,
  has_account      boolean,
  door_ok          boolean,
  door_blocker     text
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not sm_is_staff() then raise exception 'not authorized'; end if;
  return query
  select
    i.id,
    i.registration_id,
    (select count(*)::int from sm_invitation_guest g where g.invitation_id = i.id),
    (select count(*)::int from sm_invitation_guest g where g.invitation_id = i.id and g.attendee_id is null),
    (select count(*)::int from sm_attendee  a where a.registration_id = i.registration_id and a.attending),
    (select count(*)::int from sm_badge     b where b.registration_id = i.registration_id),
    (select count(*)::int from sm_badge     b where b.registration_id = i.registration_id and b.exported_at is not null),
    (select count(distinct c.attendee_id)::int from sm_checkin c where c.registration_id = i.registration_id),
    (select r.user_id is not null from sm_registration r where r.id = i.registration_id),
    e.ok,
    e.reason
  from sm_invitation i
  left join lateral (
    select (x->>'ok')::boolean as ok, x->>'reason' as reason
    from (
      select sm_checkin_eligibility(a.id) as x
      from sm_attendee a
      where a.registration_id = i.registration_id and a.is_primary
      limit 1
    ) s
  ) e on true
  where i.event_id = p_event_id;
end $function$;

-- ─── 6. name the person who recorded the reply ──────────────────────────────
-- The console names the author of every action. rsvp_by is a third such person,
-- and without them the panel prints "recorded by staff" for a fact that has an
-- author. One extra union.
create or replace function public.sm_invitation_staff(p_event_id uuid)
returns table(user_id uuid, name text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not sm_is_staff() then raise exception 'Not authorized'; end if;
  return query
  select p.user_id,
         coalesce(nullif(trim(coalesce(p.first_name,'')||' '||coalesce(p.last_name,'')),''), p.email, 'Staff')
  from profiles p
  where p.user_id in (
    select created_by from sm_invitation where event_id = p_event_id and created_by is not null
    union
    select sent_by    from sm_invitation where event_id = p_event_id and sent_by is not null
    union
    select rsvp_by    from sm_invitation where event_id = p_event_id and rsvp_by is not null
  );
end $function$;

grant execute on function public.sm_invitation_to_participant(uuid,text,text,text,text,text,text,text[],boolean,boolean) to authenticated;
grant execute on function public.sm_invitation_sync_guests(uuid)   to authenticated;
grant execute on function public.sm_invitation_remove_guest(uuid)  to authenticated;
grant execute on function public.sm_invitation_board(uuid)         to authenticated;
