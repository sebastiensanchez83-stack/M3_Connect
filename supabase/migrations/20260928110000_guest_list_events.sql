-- Applied 28 Sep 2026 via MCP as `guest_list_events` + `gl_event_slug_for`.
--
-- Guest-list events: invitation-only events run on a simple guest list
-- (public "request an invitation" form, invitations we send with an RSVP link,
-- per-guest conference/gala access, entry QR, door check-in). Deliberately
-- separate from the sm_* engine, which is built for multi-role paid events.
-- First user: World Yachting Summit 2026 (slug wys26). The event rows
-- themselves (events + gl_event) were inserted as data, not in this file.

create table public.gl_event (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  title text not null,
  legacy_event_id uuid references public.events(id) on delete set null,
  capacity integer,
  notify_email text,
  requests_open boolean not null default false,
  -- tagline, description, date_label, venue, address, parts [{key,label,time}], themes, logo_url, contact_email
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.gl_guest (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.gl_event(id) on delete cascade,
  source text not null check (source in ('request','invitation','plus_one')),
  status text not null check (status in ('requested','invited','confirmed','declined','rejected','cancelled')),
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text,
  company text,
  job_title text,
  country text,
  motivation text,
  wants_conference boolean not null default true,
  wants_gala boolean not null default true,
  conference boolean not null default false,
  gala boolean not null default false,
  plus_one_of uuid references public.gl_guest(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  admin_note text,
  decided_at timestamptz,
  decided_by uuid,
  invited_at timestamptz,
  responded_at timestamptz,
  checked_in_at timestamptz,
  checked_in_by uuid,
  created_at timestamptz not null default now()
);
create unique index gl_guest_event_email on public.gl_guest (event_id, lower(email));
create index gl_guest_event_status on public.gl_guest (event_id, status);
create index gl_guest_plus_one_of on public.gl_guest (plus_one_of);

create table public.gl_email_log (
  id bigserial primary key,
  guest_id uuid references public.gl_guest(id) on delete cascade,
  event_id uuid references public.gl_event(id) on delete cascade,
  kind text not null,
  to_email text not null,
  sent_by uuid,
  sent_at timestamptz not null default now()
);
create index gl_email_log_guest on public.gl_email_log (guest_id);

alter table public.gl_event enable row level security;
alter table public.gl_guest enable row level security;
alter table public.gl_email_log enable row level security;

-- Staff only. The public never touches these tables directly: requests, RSVPs
-- and the guest's own page all go through the guest-list edge function.
create policy gl_event_staff on public.gl_event for all using (public.is_moderator()) with check (public.is_moderator());
create policy gl_guest_staff on public.gl_guest for all using (public.is_moderator()) with check (public.is_moderator());
create policy gl_email_log_staff on public.gl_email_log for select using (public.is_moderator());

-- Door check-in by QR token or by guest id (name lookup). Returns who it is and
-- whether they may enter, in words the desk can act on.
create or replace function public.gl_checkin(p_event_id uuid, p_token uuid default null, p_guest_id uuid default null, p_undo boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g public.gl_guest;
begin
  if not public.is_moderator() then raise exception 'forbidden'; end if;
  select * into g from public.gl_guest
   where event_id = p_event_id and ((p_token is not null and token = p_token) or (p_guest_id is not null and id = p_guest_id));
  if not found then return jsonb_build_object('ok', false, 'error', 'unknown_token'); end if;
  if p_undo then
    update public.gl_guest set checked_in_at = null, checked_in_by = null where id = g.id;
    return jsonb_build_object('ok', true, 'undone', true, 'guest_id', g.id);
  end if;
  if g.status <> 'confirmed' then
    return jsonb_build_object('ok', false, 'error', 'status_' || g.status, 'guest_id', g.id,
      'name', g.first_name || ' ' || g.last_name, 'company', g.company);
  end if;
  if g.checked_in_at is not null then
    return jsonb_build_object('ok', true, 'already', true, 'guest_id', g.id, 'name', g.first_name || ' ' || g.last_name,
      'company', g.company, 'conference', g.conference, 'gala', g.gala, 'checked_in_at', g.checked_in_at,
      'plus_one', g.plus_one_of is not null);
  end if;
  update public.gl_guest set checked_in_at = now(), checked_in_by = auth.uid() where id = g.id;
  return jsonb_build_object('ok', true, 'guest_id', g.id, 'name', g.first_name || ' ' || g.last_name,
    'company', g.company, 'conference', g.conference, 'gala', g.gala, 'plus_one', g.plus_one_of is not null);
end $$;
revoke all on function public.gl_checkin(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.gl_checkin(uuid, uuid, uuid, boolean) to authenticated;

-- Lets the public /events/:id page send "Request invitation" to the guest-list
-- page of an event, without exposing gl_event (it holds the staff alert email).
create or replace function public.gl_event_slug_for(p_event_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select slug from public.gl_event where legacy_event_id = p_event_id limit 1;
$$;
grant execute on function public.gl_event_slug_for(uuid) to anon, authenticated;
