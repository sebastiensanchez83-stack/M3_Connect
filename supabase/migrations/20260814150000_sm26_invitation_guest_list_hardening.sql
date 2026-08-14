-- Three holes found reviewing the guest list, all in the same family: a rule
-- written once by one function, which other code was free to undo.

-- ─── 1. discretion has to survive somebody else minting the badge ───────────
-- sm_invitation_to_participant writes connect_token = NULL for a discreet guest,
-- but sm_ensure_badges — which runs on every load of the check-in console —
-- re-mints a badge for any attending person who has none, and its INSERT takes
-- the column DEFAULT: a fresh random token. Toggle an attendee to not-attending
-- and back, or refuse and re-confirm a registration, and a minister silently
-- acquires a badge other participants can scan for their contact details.
--
-- A one-time write cannot hold an invariant that other code can undo, so the
-- rule moves to the table, where every writer meets it.
create or replace function public.sm_badge_respect_discretion()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.connect_token is not null
     and exists (select 1 from sm_invitation i
                  where i.registration_id = new.registration_id and i.discreet) then
    new.connect_token := null;
  end if;
  return new;
end $function$;

drop trigger if exists trg_sm_badge_respect_discretion on public.sm_badge;
create trigger trg_sm_badge_respect_discretion
  before insert or update of connect_token, registration_id on public.sm_badge
  for each row execute function public.sm_badge_respect_discretion();

-- ─── 2. the networking print run must not carry a broken card ───────────────
-- The networking console prints one QR card per badge and never checked that
-- the badge has a connect token. A discreet guest came out as a card encoding
-- …/sm26/connect?c=null — a dead card with a minister's name on it, handed
-- round the room. "Connect links" means badges that have one.
create or replace function public.sm_admin_connect_links(p_event_id uuid)
returns table(registration_id uuid, name text, company text, connect_token text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not sm_is_staff() then raise exception 'Not authorized'; end if;
  return query
  select r.id,
    nullif(trim(coalesce(r.first_name,'')||' '||coalesce(r.last_name,'')), ''),
    nullif(trim(r.company_name), ''),
    b.connect_token
  from sm_badge b join sm_registration r on r.id = b.registration_id
  where b.event_id = p_event_id
    and r.status not in ('declined','cancelled')
    and b.connect_token is not null
  order by r.company_name nulls last, r.last_name;
end $function$;

-- ─── 3. a posted letter is not a letter drawn here ──────────────────────────
-- The importer had nowhere to put "courrier" but platform_letter, which claims
-- a PDF this platform can print and does not have — and the console offers a
-- Download button on that claim.
alter table public.sm_invitation drop constraint if exists sm_invitation_channel_chk;
alter table public.sm_invitation add constraint sm_invitation_channel_chk
  check (channel in ('platform_letter', 'email', 'post', 'phone', 'in_person', 'third_party'));
