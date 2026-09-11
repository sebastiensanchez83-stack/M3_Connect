-- Applied to the remote project via the Supabase MCP; kept here for traceability.
--
-- SM26 networking passes: connection codes that are not a badge.
--
-- Until now the only networking code was sm_badge.connect_token, and a badge is
-- the wrong home for anything printed or handed out. Badges are deleted and
-- re-minted with a fresh token whenever someone is toggled off and back on the
-- door list, a registration is withdrawn and revived, a juror changes their
-- on-site answer, or a roster row is removed — and the discretion triggers null
-- the token outright. That fragility is right for the door; it is wrong for a
-- code on an exhibitor's table or on a guest's phone.
--
-- A pass is a code that never changes once issued (token, event and kind are
-- frozen by trigger; passes are revoked, never re-minted). Three kinds:
--   guest  — someone with no platform account: name, company and email typed
--            once on their phone. No password, no approval.
--   member — a signed-in participant's own code, issued on request.
--   stand  — one per exhibiting company, printed on its table. Introductions go
--            to the registration's contact (live), falling back to the snapshot
--            taken when the code was issued if the registration disappears.
--
-- sm_connection gains to_pass_id / from_pass_id; to_registration_id becomes
-- nullable (a pass holder need not have a registration). A stand scan records
-- only to_pass_id — never to_registration_id, whose FK cascades — so deleting or
-- restarting an exhibitor's registration cannot wipe the leads its printed code
-- collected. Introductions are still made by hand by staff after the event:
-- nothing is shared on the spot.
--
-- A pass token is public (it is the QR). Presented back as p_pass it proves
-- nothing, so it is accepted only for guest passes, and an anonymous rescan
-- appends to a note rather than replacing it. Emails are never verified: staff
-- should read notes as unverified, and the admin list puts the most trustworthy
-- row of a pair first (signed in > member > guest pass > typed) so that is the
-- one an introduction is sent from.
--
-- Pairing is by email. The same person can appear through a badge, a pass, a
-- signed-in scan or the old type-your-details form; the introduction goes to an
-- email address in every case, so a pair of addresses is exactly "one
-- introduction". sm_connection_parties is the single place that resolves who
-- each side is; the admin list, the introduction email and "mark introduced"
-- all read it, so they cannot disagree.
--
-- Applied through the MCP apply_migration, which already wraps this file in a
-- transaction.

-- 1. The pass store ----------------------------------------------------------

create table if not exists public.sm_networking_pass (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.sm_event(id),
  kind            text not null check (kind in ('guest', 'member', 'stand')),
  token           text not null default replace(gen_random_uuid()::text, '-', ''),
  name            text,
  company         text,
  email           text not null,
  user_id         uuid,
  registration_id uuid references public.sm_registration(id) on delete set null,
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz,
  constraint sm_networking_pass_token_key unique (token),
  constraint sm_networking_pass_member_has_user check (kind <> 'member' or user_id is not null)
);

comment on table public.sm_networking_pass is
  'SM26 networking codes that are not badges (guest phones, members, exhibitor tables). Token never changes; revoke, never re-mint. Read only through SECURITY DEFINER functions.';
comment on column public.sm_networking_pass.registration_id is
  'stand: the exhibiting registration (introductions go to its contact). member: the registration they attend with, for display. ON DELETE SET NULL so a printed code survives.';

create unique index if not exists sm_networking_pass_member_uq
  on public.sm_networking_pass (event_id, user_id) where kind = 'member';
create unique index if not exists sm_networking_pass_stand_uq
  on public.sm_networking_pass (event_id, registration_id) where kind = 'stand' and revoked_at is null;
create index if not exists sm_networking_pass_event_created_idx
  on public.sm_networking_pass (event_id, created_at);
create index if not exists sm_networking_pass_email_created_idx
  on public.sm_networking_pass (lower(email), created_at);

create or replace function public.sm_networking_pass_guard()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if tg_op = 'DELETE' then
    if old.kind = 'stand' then
      raise exception 'A stand code may already be printed: revoke it (set revoked_at) instead of deleting it.';
    end if;
    return old;
  end if;
  if new.token is distinct from old.token or new.event_id is distinct from old.event_id or new.kind is distinct from old.kind then
    raise exception 'A networking pass keeps its token, event and kind for life: it may be printed or on someone''s phone.';
  end if;
  return new;
end $function$;

drop trigger if exists trg_sm_networking_pass_guard on public.sm_networking_pass;
create trigger trg_sm_networking_pass_guard
  before update or delete on public.sm_networking_pass
  for each row execute function public.sm_networking_pass_guard();

alter table public.sm_networking_pass enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sm_networking_pass' and policyname = 'sm_networking_pass_staff_read') then
    create policy sm_networking_pass_staff_read on public.sm_networking_pass
      for select to authenticated using (public.sm_is_staff());
  end if;
end $$;
revoke all on public.sm_networking_pass from anon, authenticated;
grant select on public.sm_networking_pass to authenticated;

-- 2. Connections can point at a pass -----------------------------------------

alter table public.sm_connection alter column to_registration_id drop not null;
alter table public.sm_connection add column if not exists to_pass_id uuid references public.sm_networking_pass(id);
alter table public.sm_connection add column if not exists from_pass_id uuid references public.sm_networking_pass(id);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sm_connection_has_target') then
    alter table public.sm_connection add constraint sm_connection_has_target
      check (to_registration_id is not null or to_pass_id is not null);
  end if;
end $$;

-- One request per scanner per target. Badges and stands are matched on the
-- company (to_registration_id, as before); personal passes on the pass.
create unique index if not exists sm_connection_reg_pass_uq
  on public.sm_connection (event_id, to_registration_id, from_pass_id)
  where to_registration_id is not null and from_pass_id is not null;
create unique index if not exists sm_connection_pass_user_uq
  on public.sm_connection (event_id, to_pass_id, from_user_id)
  where to_registration_id is null and to_pass_id is not null and from_user_id is not null;
create unique index if not exists sm_connection_pass_pass_uq
  on public.sm_connection (event_id, to_pass_id, from_pass_id)
  where to_registration_id is null and to_pass_id is not null and from_pass_id is not null;
create unique index if not exists sm_connection_pass_email_uq
  on public.sm_connection (event_id, to_pass_id, lower(from_email))
  where to_registration_id is null and to_pass_id is not null and from_user_id is null and from_pass_id is null and from_email is not null;

-- 3. Who each side is — the single resolver ----------------------------------

create or replace function public.sm_connection_parties(p_event_id uuid, p_connection_id uuid default null)
returns table(id uuid, from_name text, from_email text, from_company text,
              to_name text, to_email text, to_company text, from_ident text, to_ident text)
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select c.id,
         f.name, f.email, f.company,
         t.name, t.email, t.company,
         coalesce('email:' || lower(nullif(trim(f.email), '')), f.ident),
         coalesce('email:' || lower(nullif(trim(t.email), '')), t.ident, 'to:' || c.id::text)
  from sm_connection c
  cross join lateral (
    select s.name, s.email, s.company, s.ident from (
      select nullif(trim(fp.name), '') as name, fp.email, nullif(trim(fp.company), '') as company,
             'pass:' || fp.id::text as ident, 1 as prio
        from sm_networking_pass fp where fp.id = c.from_pass_id
      union all
      select nullif(trim(coalesce(r.first_name, '') || ' ' || coalesce(r.last_name, '')), ''), r.email,
             nullif(trim(r.company_name), ''), 'reg:' || r.id::text, 2
        from sm_registration r where r.id = c.from_registration_id
      union all
      select nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), p.email,
             null, 'user:' || p.user_id::text, 3
        from profiles p where p.user_id = c.from_user_id
      union all
      select nullif(trim(c.from_name), ''), c.from_email, nullif(trim(c.from_company), ''), 'conn:' || c.id::text, 4
    ) s order by s.prio limit 1
  ) f
  left join lateral (
    select s.name, s.email, s.company, s.ident from (
      -- a person's own pass (guest or member)
      select nullif(trim(tp.name), '') as name, tp.email, nullif(trim(tp.company), '') as company,
             'pass:' || tp.id::text as ident, 1 as prio
        from sm_networking_pass tp where tp.id = c.to_pass_id and tp.kind <> 'stand'
      union all
      -- a badge: the registration contact
      select coalesce(nullif(trim(coalesce(r.first_name, '') || ' ' || coalesce(r.last_name, '')), ''),
                      nullif(trim(r.company_name), ''), 'Participant'),
             r.email, nullif(trim(r.company_name), ''), 'reg:' || r.id::text, 2
        from sm_registration r where r.id = c.to_registration_id
      union all
      -- a stand: its registration's contact, live
      select coalesce(nullif(trim(coalesce(r.first_name, '') || ' ' || coalesce(r.last_name, '')), ''),
                      nullif(trim(r.company_name), ''), 'Participant'),
             r.email, nullif(trim(r.company_name), ''), 'reg:' || r.id::text, 2
        from sm_networking_pass tp join sm_registration r on r.id = tp.registration_id
       where tp.id = c.to_pass_id and tp.kind = 'stand'
      union all
      -- a stand whose registration is gone: what was captured when it was printed
      select nullif(trim(tp.name), ''), tp.email, nullif(trim(tp.company), ''), 'pass:' || tp.id::text, 3
        from sm_networking_pass tp where tp.id = c.to_pass_id and tp.kind = 'stand'
    ) s order by s.prio limit 1
  ) t on true
  where c.event_id = p_event_id
    and (p_connection_id is null or c.id = p_connection_id);
$function$;

create or replace function public.sm_connection_party(p_connection_id uuid)
returns table(event_id uuid, note text, introduced_at timestamptz,
              from_name text, from_email text, from_company text,
              to_name text, to_email text, to_company text)
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select c.event_id, c.note, c.introduced_at,
         p.from_name, p.from_email, p.from_company, p.to_name, p.to_email, p.to_company
  from sm_connection c
  cross join lateral sm_connection_parties(c.event_id, c.id) p
  where c.id = p_connection_id;
$function$;

-- Marks the whole pair — both directions, however each side came in.
create or replace function public.sm_connection_mark_introduced(p_connection_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_event uuid; v_from text; v_to text; n int;
begin
  select c.event_id into v_event from sm_connection c where c.id = p_connection_id;
  if v_event is null then return 0; end if;
  select p.from_ident, p.to_ident into v_from, v_to from sm_connection_parties(v_event, p_connection_id) p;
  update sm_connection c set introduced_at = now()
    from sm_connection_parties(v_event) p
   where p.id = c.id and c.introduced_at is null
     and ((p.from_ident = v_from and p.to_ident = v_to) or (p.from_ident = v_to and p.to_ident = v_from));
  get diagnostics n = row_count;
  return n;
end $function$;

-- 4. Staff list, rebuilt on the resolver (same columns as before) -------------
-- Pairs are ordered by their latest activity; within a pair the most
-- trustworthy row comes first, because the screen shows — and introduces
-- from — the first row of each pair.

create or replace function public.sm_admin_connections(p_event_id uuid)
returns table(id uuid, note text, introduced boolean, created_at timestamptz, mutual boolean, pair_key text,
              from_name text, from_email text, from_company text, to_name text, to_email text, to_company text)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if not sm_is_staff() then raise exception 'Not authorized'; end if;
  return query
  with p as (select * from sm_connection_parties(p_event_id)),
  rws as (
    select c.id as cid, c.note as cnote, c.introduced_at as cintro, c.created_at as ccreated,
           exists (select 1 from p x where x.from_ident = p.to_ident and x.to_ident = p.from_ident) as cmutual,
           least(p.from_ident, p.to_ident) || '|' || greatest(p.from_ident, p.to_ident) as ckey,
           p.from_name as fname, p.from_email as femail, p.from_company as fcompany,
           p.to_name as tname, p.to_email as temail, p.to_company as tcompany,
           case when c.from_user_id is not null then 1
                when fp.kind = 'member' then 2
                when c.from_pass_id is not null then 3
                else 4 end as trust
    from sm_connection c
    join p on p.id = c.id
    left join sm_networking_pass fp on fp.id = c.from_pass_id
  )
  select r.cid, r.cnote, r.cintro is not null, r.ccreated, r.cmutual, r.ckey,
         coalesce(r.fname, r.femail, 'Guest'), r.femail, r.fcompany,
         coalesce(r.tname, r.tcompany, 'Participant'), r.temail, r.tcompany
  from rws r
  order by (r.cintro is not null), max(r.ccreated) over (partition by r.ckey) desc, r.ckey, r.trust, r.ccreated desc;
end $function$;

-- 5. Issuing passes ----------------------------------------------------------

-- Anyone, no account. Throttled per address, plus an event-wide ceiling set far
-- above real use so nobody can exhaust it for everyone (and not per IP: the
-- whole venue shares one Wi-Fi address).
create or replace function public.sm_networking_pass_create(p_name text, p_company text, p_email text)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_event uuid;
  v_name text := nullif(trim(p_name), '');
  v_company text := nullif(trim(p_company), '');
  v_email text := lower(nullif(trim(p_email), ''));
  v_token text;
  v_recent int;
begin
  select e.id into v_event from sm_event e where e.slug = 'sm26';
  if v_event is null then return jsonb_build_object('ok', false, 'error', 'no_event'); end if;
  if v_name is null or length(v_name) > 120 then return jsonb_build_object('ok', false, 'error', 'bad_name'); end if;
  if v_company is not null and length(v_company) > 160 then return jsonb_build_object('ok', false, 'error', 'bad_company'); end if;
  if v_email is null or length(v_email) > 254 or v_email !~ '^[^[:space:]@"<>]+@[^[:space:]@"<>]+\.[^[:space:]@"<>]+$' then
    return jsonb_build_object('ok', false, 'error', 'bad_email');
  end if;
  select count(*) into v_recent from sm_networking_pass p
   where lower(p.email) = v_email and p.created_at > now() - interval '1 hour';
  if v_recent >= 5 then return jsonb_build_object('ok', false, 'error', 'rate_limited'); end if;
  select count(*) into v_recent from sm_networking_pass p
   where p.event_id = v_event and p.kind = 'guest' and p.created_at > now() - interval '1 minute';
  if v_recent >= 300 then return jsonb_build_object('ok', false, 'error', 'rate_limited'); end if;
  insert into sm_networking_pass (event_id, kind, name, company, email)
  values (v_event, 'guest', v_name, v_company, v_email)
  returning token into v_token;
  return jsonb_build_object('ok', true, 'token', v_token);
end $function$;

-- A signed-in person's own code: issued once, then the same one every time.
create or replace function public.sm_my_networking_pass()
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_event uuid;
  v_pass sm_networking_pass;
  v_reg uuid; v_name text; v_profile_name text; v_company text; v_email text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  select e.id into v_event from sm_event e where e.slug = 'sm26';
  if v_event is null then return jsonb_build_object('ok', false, 'error', 'no_event'); end if;

  -- Who they are here, worked out on every call so a corrected name or a new
  -- registration shows up: the registration they attend under (their own roster
  -- row first), else one they own; the name from their own profile, since a
  -- roster row can be typed by a colleague.
  select a.registration_id, nullif(trim(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, '')), '')
    into v_reg, v_name
    from sm_attendee a join sm_registration r on r.id = a.registration_id
   where a.user_id = v_uid and a.event_id = v_event and a.attending and r.status not in ('declined', 'cancelled')
   order by a.is_primary desc, a.created_at
   limit 1;
  if v_reg is null then
    select r.id into v_reg from sm_registration r
     where r.user_id = v_uid and r.event_id = v_event and r.status not in ('declined', 'cancelled')
     order by r.created_at limit 1;
  end if;
  select nullif(trim(r.company_name), '') into v_company from sm_registration r where r.id = v_reg;
  -- (separate variable: SELECT INTO with no profile row would null v_name)
  select nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
         lower(nullif(trim(p.email), ''))
    into v_profile_name, v_email
    from profiles p where p.user_id = v_uid;
  v_name := coalesce(v_profile_name, v_name);
  if v_email is null then select lower(u.email) into v_email from auth.users u where u.id = v_uid; end if;

  select * into v_pass from sm_networking_pass p where p.event_id = v_event and p.kind = 'member' and p.user_id = v_uid;
  if v_pass.id is null then
    if v_email is null then return jsonb_build_object('ok', false, 'error', 'no_email'); end if;
    insert into sm_networking_pass (event_id, kind, user_id, registration_id, name, company, email)
    values (v_event, 'member', v_uid, v_reg, coalesce(v_name, split_part(v_email, '@', 1)), v_company, v_email)
    on conflict (event_id, user_id) where kind = 'member' do nothing;
    select * into v_pass from sm_networking_pass p where p.event_id = v_event and p.kind = 'member' and p.user_id = v_uid;
  elsif v_pass.revoked_at is null
        and (v_pass.name is distinct from coalesce(v_name, v_pass.name)
             or v_pass.company is distinct from v_company
             or v_pass.email is distinct from coalesce(v_email, v_pass.email)
             or v_pass.registration_id is distinct from v_reg) then
    update sm_networking_pass p
       set name = coalesce(v_name, p.name), company = v_company, email = coalesce(v_email, p.email), registration_id = v_reg
     where p.id = v_pass.id
    returning * into v_pass;
  end if;

  if v_pass.revoked_at is not null then return jsonb_build_object('ok', false, 'error', 'revoked'); end if;
  return jsonb_build_object('ok', true, 'token', v_pass.token, 'name', v_pass.name, 'company', v_pass.company);
end $function$;

-- 6. Scanning ----------------------------------------------------------------
-- Same contract as before plus p_pass: the scanner's own guest pass, so someone
-- without an account types their details once, not at every table.
-- Self-scans: a signed-in person is told "that's your own code" (own badge,
-- own pass, own company's badge or stand, own address). An anonymous scanner
-- whose address matches the target is simply not recorded, and told nothing —
-- otherwise the reply would confirm whose address a code belongs to.

drop function if exists public.sm_connect_scan(text, text, text, text, text);
create or replace function public.sm_connect_scan(p_token text, p_note text default null, p_name text default null,
                                                  p_email text default null, p_company text default null,
                                                  p_pass text default null)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_event uuid;
  v_to_reg uuid;         -- a badge's registration (the only target stored as to_registration_id)
  v_stand_reg uuid;      -- a stand's registration (for display and self checks only)
  v_to_pass sm_networking_pass;
  v_to_company text; v_to_name text; v_to_email text;
  v_from_reg uuid;
  v_from_pass sm_networking_pass;
  v_from_email text;
  v_typed boolean := false;
  v_existing uuid;
  v_note text := left(nullif(trim(p_note), ''), 1000);
begin
  if coalesce(p_token, '') = '' then return jsonb_build_object('ok', false, 'error', 'unknown_code'); end if;

  -- 1. What was scanned: a badge, or a pass.
  select b.registration_id, b.event_id into v_to_reg, v_event from sm_badge b where b.connect_token = p_token;
  if v_event is null then
    select * into v_to_pass from sm_networking_pass p where p.token = p_token and p.revoked_at is null;
    if v_to_pass.id is null then return jsonb_build_object('ok', false, 'error', 'unknown_code'); end if;
    v_event := v_to_pass.event_id;
    if v_to_pass.kind = 'stand' then v_stand_reg := v_to_pass.registration_id; end if;
  end if;

  if v_to_pass.id is not null and v_to_pass.kind <> 'stand' then
    v_to_company := coalesce(nullif(trim(v_to_pass.company), ''), nullif(trim(v_to_pass.name), ''), 'this participant');
    v_to_name := nullif(trim(v_to_pass.name), '');
    v_to_email := lower(v_to_pass.email);
  else
    select coalesce(nullif(trim(r.company_name), ''), nullif(trim(coalesce(r.first_name, '') || ' ' || coalesce(r.last_name, '')), ''), 'this participant'),
           nullif(trim(coalesce(r.first_name, '') || ' ' || coalesce(r.last_name, '')), ''),
           lower(nullif(trim(r.email), ''))
      into v_to_company, v_to_name, v_to_email
      from sm_registration r where r.id = coalesce(v_to_reg, v_stand_reg);
    if v_to_pass.id is not null then
      v_to_company := coalesce(v_to_company, nullif(trim(v_to_pass.company), ''), 'this exhibitor');
      v_to_email := coalesce(v_to_email, lower(v_to_pass.email));
      v_to_name := null;  -- a table code does not reveal who registered the stand
    end if;
  end if;

  -- 2. Who scanned.
  if v_uid is not null then
    select r.id, lower(nullif(trim(r.email), '')) into v_from_reg, v_from_email
      from sm_registration r
     where r.user_id = v_uid and r.event_id = v_event and r.status not in ('declined', 'cancelled')
     limit 1;
    if v_from_email is null then select lower(nullif(trim(p.email), '')) into v_from_email from profiles p where p.user_id = v_uid; end if;
  elsif coalesce(p_pass, '') <> '' then
    -- Guest passes only: a member proves who they are by signing in, not by a token anyone can read off their screen.
    select * into v_from_pass from sm_networking_pass p
     where p.token = p_pass and p.revoked_at is null and p.event_id = v_event and p.kind = 'guest';
    if v_from_pass.id is null then return jsonb_build_object('ok', false, 'error', 'bad_pass', 'to_company', v_to_company); end if;
    v_from_email := lower(v_from_pass.email);
  else
    v_typed := true;
    v_from_email := lower(nullif(trim(p_email), ''));
    if v_from_email is null or length(v_from_email) > 254 or v_from_email !~ '^[^[:space:]@"<>]+@[^[:space:]@"<>]+\.[^[:space:]@"<>]+$' then
      return jsonb_build_object('ok', false, 'error', 'need_contact', 'to_company', v_to_company);
    end if;
  end if;

  -- 3. Never connect someone to themselves or to their own company.
  if v_uid is not null then
    if (v_from_reg is not null and v_from_reg = coalesce(v_to_reg, v_stand_reg))
       or v_to_pass.user_id = v_uid
       or (v_from_email is not null and v_from_email = v_to_email)
       or exists (select 1 from sm_attendee a
                   where a.registration_id = coalesce(v_to_reg, v_stand_reg)
                     and (a.user_id = v_uid or (v_from_email is not null and lower(a.email) = v_from_email))) then
      return jsonb_build_object('ok', false, 'error', 'self', 'to_company', v_to_company);
    end if;
  else
    if v_from_pass.id is not null and v_from_pass.id = v_to_pass.id then
      return jsonb_build_object('ok', false, 'error', 'self', 'to_company', v_to_company);
    end if;
    if v_from_email = v_to_email
       or exists (select 1 from sm_attendee a
                   where a.registration_id = coalesce(v_to_reg, v_stand_reg) and lower(a.email) = v_from_email) then
      return jsonb_build_object('ok', true, 'to_company', v_to_company, 'to_name', v_to_name);
    end if;
  end if;

  -- 4. Record the request, or refresh it on a second scan.
  select c.id into v_existing from sm_connection c
   where c.event_id = v_event
     and (case when v_to_reg is not null then c.to_registration_id = v_to_reg
               else c.to_registration_id is null and c.to_pass_id = v_to_pass.id end)
     and (case when v_uid is not null then c.from_user_id = v_uid
               when v_from_pass.id is not null then c.from_pass_id = v_from_pass.id
               else c.from_user_id is null and c.from_pass_id is null and lower(c.from_email) = v_from_email end)
   limit 1;

  if v_existing is not null then
    update sm_connection c set
      -- Signed in: their note, replaced. Anonymous: added to, never overwritten.
      note = case when v_uid is not null then coalesce(v_note, c.note)
                  when v_note is null or c.note is null or position(v_note in c.note) > 0 then coalesce(c.note, v_note)
                  else left(c.note || E'\n' || v_note, 2000) end,
      created_at = now(),
      from_name = case when v_typed then coalesce(left(nullif(trim(p_name), ''), 120), c.from_name) else c.from_name end,
      from_company = case when v_typed then coalesce(left(nullif(trim(p_company), ''), 160), c.from_company) else c.from_company end
    where c.id = v_existing;
  else
    insert into sm_connection (event_id, to_registration_id, to_pass_id, from_user_id, from_registration_id, from_pass_id,
                               from_name, from_email, from_company, note)
    values (v_event, v_to_reg, v_to_pass.id, v_uid, v_from_reg, v_from_pass.id,
            case when v_typed then left(nullif(trim(p_name), ''), 120) end,
            case when v_typed then v_from_email end,
            case when v_typed then left(nullif(trim(p_company), ''), 160) end,
            v_note)
    on conflict do nothing;
  end if;

  return jsonb_build_object('ok', true, 'to_company', v_to_company, 'to_name', v_to_name);
end $function$;

-- A participant's own list now includes people and stands reached through passes.
create or replace function public.sm_my_connections(p_event_id uuid)
returns table(to_company text, to_name text, note text, introduced boolean, created_at timestamptz)
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(nullif(trim(r.company_name), ''), nullif(trim(sr.company_name), ''), nullif(trim(tp.company), ''),
                  nullif(trim(coalesce(r.first_name, '') || ' ' || coalesce(r.last_name, '')), ''),
                  nullif(trim(tp.name), ''), 'Participant'),
         case when tp.kind = 'stand' then null
              else coalesce(nullif(trim(tp.name), ''), nullif(trim(coalesce(r.first_name, '') || ' ' || coalesce(r.last_name, '')), '')) end,
         c.note, c.introduced_at is not null, c.created_at
  from sm_connection c
  left join sm_registration r on r.id = c.to_registration_id
  left join sm_networking_pass tp on tp.id = c.to_pass_id
  left join sm_registration sr on sr.id = tp.registration_id and tp.kind = 'stand'
  where c.event_id = p_event_id
    and auth.uid() is not null
    and (c.from_user_id = auth.uid()
         or c.from_pass_id in (select mp.id from sm_networking_pass mp where mp.kind = 'member' and mp.user_id = auth.uid()))
  order by c.created_at desc;
$function$;

-- The sponsor renewal report counts requests to their stand and their staff's
-- own codes too (only "Introductions you received" changes).
create or replace function public.sm_sponsor_report(p_sponsor_id uuid, p_event_id uuid)
 returns table(kind text, section text, label text, detail text, state text, sort_order integer)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_org uuid;
begin
  if not sm_is_staff() then raise exception 'Not authorized'; end if;
  select organization_id into v_org from sp_sponsor where id = p_sponsor_id;

  -- The agreement itself.
  return query
  select 'agreement', 'Agreement',
         coalesce(t.label, a.tier_key),
         concat_ws(' · ',
           nullif(to_char(coalesce(a.negotiated_fee_cents, 0) / 100.0, 'FM999G999D00') || ' ' || coalesce(a.currency, 'EUR'), ' EUR'),
           nullif(concat_ws(' to ', a.term_start::text, a.term_end::text), ''),
           case when a.renewal_date is not null then 'renews ' || a.renewal_date::text end),
         a.status, 0
    from sp_agreement a
    left join sp_tier t on t.tier_key = a.tier_key
   where a.sponsor_id = p_sponsor_id and a.status = 'active';

  -- Every commitment, grouped by the package it came from, newest sections last.
  return query
  select 'benefit', coalesce(ab.section, 'Other'),
         ab.name,
         nullif(concat_ws(' · ',
           nullif(ab.value_text, ''),
           case when ab.value_qty is not null then ab.value_qty::text || coalesce(' ' || ab.value_qualifier, '') end,
           ab.value_level), ''),
         -- One word a sponsor understands, not our internal enum.
         case
           when ab.delivered or ab.status = 'DELIVERED' then 'Delivered'
           when ab.status = 'REQUESTED_FROM_SPONSOR' then 'Waiting on you'
           else 'To come'
         end,
         coalesce(ab.display_order, 999)
    from sp_agreement_benefit ab
    join sp_agreement a on a.id = ab.agreement_id
   where a.sponsor_id = p_sponsor_id and a.status = 'active'
     and (ab.event_id is null or ab.event_id = p_event_id);

  -- What the audience was. These are the figures a sponsor is really buying,
  -- and they are the same for everyone — so they are stated, not sold.
  return query
  select 'audience', 'The audience', x.label, null::text, x.value, x.ord
  from (
    select 'Confirmed participants' as label,
           (select count(*)::text from sm_registration r
             where r.event_id = p_event_id and r.status = 'confirmed') as value, 1 as ord
    union all
    select 'People expected on site',
           (select coalesce(sum(r.num_attendees), 0)::text from sm_registration r
             where r.event_id = p_event_id and r.status not in ('cancelled', 'declined')), 2
    union all
    select 'Countries represented',
           (select count(distinct nullif(trim(r.country), ''))::text from sm_registration r
             where r.event_id = p_event_id and r.status not in ('cancelled', 'declined')), 3
    union all
    select 'Checked in on site',
           (select count(*)::text from sm_checkin c
             join sm_attendee at on at.id = c.attendee_id
            where at.event_id = p_event_id), 4
    union all
    select 'Innovations presented',
           (select count(*)::text from sm_role_assignment ra
             where ra.event_id = p_event_id and ra.role = 'startup' and ra.status <> 'declined'), 5
    union all
    select 'Introductions requested through the platform',
           (select count(*)::text from sm_connection c where c.event_id = p_event_id), 6
  ) x;

  -- Their own presence, when the sponsor is linked to an organisation.
  if v_org is not null then
    return query
    select 'audience', 'Your presence at the event', y.label, null::text, y.value, y.ord
    from (
      select 'Your team checked in' as label,
             (select count(*)::text from sm_checkin c
               join sm_attendee at on at.id = c.attendee_id
               join sm_registration r on r.id = at.registration_id
              where r.organization_id = v_org and at.event_id = p_event_id) as value, 10 as ord
      union all
      select 'Introductions you received',
             (select count(*)::text from sm_connection c
               left join sm_networking_pass tp on tp.id = c.to_pass_id
               join sm_registration r on r.id = coalesce(c.to_registration_id, tp.registration_id)
              where r.organization_id = v_org and c.event_id = p_event_id), 11
    ) y;
  end if;
end $function$;

-- 7. Grants ------------------------------------------------------------------
-- New functions are PUBLIC-executable by default in this project: say who may
-- call each one.

revoke execute on function public.sm_networking_pass_guard() from public, anon, authenticated;
revoke execute on function public.sm_connection_parties(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.sm_connection_party(uuid) from public, anon, authenticated;
revoke execute on function public.sm_connection_mark_introduced(uuid) from public, anon, authenticated;
grant execute on function public.sm_connection_parties(uuid, uuid) to service_role;
grant execute on function public.sm_connection_party(uuid) to service_role;
grant execute on function public.sm_connection_mark_introduced(uuid) to service_role;

revoke execute on function public.sm_my_networking_pass() from public, anon;
grant execute on function public.sm_my_networking_pass() to authenticated, service_role;

grant execute on function public.sm_networking_pass_create(text, text, text) to anon, authenticated, service_role;
grant execute on function public.sm_connect_scan(text, text, text, text, text, text) to anon, authenticated, service_role;
